/**
 * Cell Protocol - Federation Engine Tests
 *
 * Tests for the Federation Layer (PRD-06).
 * Verifies inter-cell transactions, exposure caps, and quarantine.
 */

import { createLedgerEngine, LedgerEngine } from '../engines/ledger-engine';
import { FederationEngine, FederationValidationError, createFederationEngine } from '../engines/federation-engine';
import { EmergencyEngine, createEmergencyEngine } from '../engines/emergency-engine';
import { createInMemoryStorage, InMemoryStorage } from '../storage/pouchdb-adapter';
import {
  FederationStatus,
  LinkStatus,
  FederationTxStatus,
  QuarantineReason,
  FederationErrorCode,
} from '../types/federation';
import { RiskState, TransitionReason } from '../types/emergency';
import { BalanceChangeReason, now } from '../types/common';

describe('FederationEngine', () => {
  let federation: FederationEngine;
  let ledger: LedgerEngine;
  let storage: InMemoryStorage;
  let emergency: EmergencyEngine;

  beforeEach(async () => {
    storage = createInMemoryStorage();
    ledger = await createLedgerEngine('cell-a', { defaultLimit: 1000 }, storage);

    // Add members
    await ledger.addMember('alice', 1000);
    await ledger.addMember('bob', 1000);

    // Give alice some positive balance to spend
    await ledger.applyBalanceUpdates([
      { memberId: 'alice', delta: 500, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      { memberId: 'bob', delta: -500, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
    ]);

    // Create federation with reasonable beta
    federation = await createFederationEngine('cell-a', ledger, storage, {
      baseBetaFactor: 0.3, // 30% of aggregate capacity
    });

    // Create emergency engine
    emergency = createEmergencyEngine('cell-a', ledger, storage);
    federation.setEmergencyEngine(emergency);
  });

  describe('Initialization', () => {
    test('Creates clearing account', () => {
      const clearingId = federation.getClearingAccountId();
      expect(clearingId).toBe('clearing-cell-a');

      const clearingState = ledger.getMemberState(clearingId);
      expect(clearingState).toBeDefined();
    });

    test('Calculates initial exposure cap', () => {
      // Aggregate capacity = 1000 + 1000 + clearing account limit = 2000
      // But clearing account has limit 0, so 2000 * 0.3 = 600
      const cap = federation.getExposureCap();
      expect(cap).toBe(600); // 2000 * 0.3
    });

    test('Starts in ACTIVE status', () => {
      const state = federation.getFederationState();
      expect(state.status).toBe(FederationStatus.ACTIVE);
    });

    test('Starts with zero position', () => {
      expect(federation.getPosition()).toBe(0);
    });
  });

  describe('Link Management', () => {
    test('Can propose a link', async () => {
      const proposal = await federation.proposeLink('cell-b');

      expect(proposal.id).toBeDefined();
      expect(proposal.initiatorCellId).toBe('cell-a');
      expect(proposal.targetCellId).toBe('cell-b');
      expect(proposal.status).toBe('PENDING');
    });

    test('Proposal creates pending link', async () => {
      await federation.proposeLink('cell-b');

      const link = federation.getLink('cell-b');
      expect(link).toBeDefined();
      expect(link?.status).toBe(LinkStatus.PENDING);
    });

    test('Can accept a link proposal', async () => {
      const proposal = await federation.proposeLink('cell-b');

      const link = await federation.acceptLink(proposal.id);

      expect(link.status).toBe(LinkStatus.ACTIVE);
      expect(link.bilateralPosition).toBe(0);
    });

    test('Can reject a link proposal', async () => {
      const proposal = await federation.proposeLink('cell-b');

      await federation.rejectLink(proposal.id, 'Terms not acceptable');

      const result = await storage.getLinkProposal(proposal.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.status).toBe('REJECTED');
      }
    });

    test('Can suspend a link', async () => {
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);

      await federation.suspendLink('cell-b', 'Maintenance');

      const link = federation.getLink('cell-b');
      expect(link?.status).toBe(LinkStatus.SUSPENDED);
      expect(link?.suspensionReason).toBe('Maintenance');
    });

    test('Can resume a suspended link', async () => {
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);
      await federation.suspendLink('cell-b', 'Maintenance');

      await federation.resumeLink('cell-b');

      const link = federation.getLink('cell-b');
      expect(link?.status).toBe(LinkStatus.ACTIVE);
    });
  });

  describe('Inter-Cell Transactions - FD-01 to FD-07', () => {
    beforeEach(async () => {
      // Set up link to cell-b
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);
    });

    test('FD-01: Valid inter-cell transaction succeeds', async () => {
      const result = await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 100,
        memo: 'Test payment',
      });

      expect(result.transaction.status).toBe(FederationTxStatus.COMPLETED);
      expect(result.newPosition).toBe(100); // Outgoing increases position
      expect(result.remainingCapacity).toBe(500); // 600 - 100
    });

    test('Transaction updates bilateral position', async () => {
      await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 100,
      });

      const link = federation.getLink('cell-b');
      expect(link?.bilateralPosition).toBe(100);
    });

    test('Transaction updates payer balance', async () => {
      const beforeBalance = ledger.getMemberState('alice')?.balance ?? 0;

      await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 100,
      });

      const afterBalance = ledger.getMemberState('alice')?.balance ?? 0;
      expect(afterBalance).toBe(beforeBalance - 100);
    });

    test('Transaction credits clearing account', async () => {
      const clearingId = federation.getClearingAccountId();
      const beforeBalance = ledger.getMemberState(clearingId)?.balance ?? 0;

      await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 100,
      });

      const afterBalance = ledger.getMemberState(clearingId)?.balance ?? 0;
      expect(afterBalance).toBe(beforeBalance + 100);
    });

    test('FD-02: Transaction exceeds source cap → CAP_EXCEEDED', async () => {
      // Try to exceed cap (600)
      await expect(
        federation.executeInterCellTx({
          sourceCell: 'cell-a',
          targetCell: 'cell-b',
          payer: 'alice',
          payee: 'bob-in-cell-b',
          amount: 700, // > 600 cap
        })
      ).rejects.toThrow('exceed exposure cap');
    });

    test('FD-04: Transaction to suspended link → LINK_SUSPENDED', async () => {
      await federation.suspendLink('cell-b', 'Maintenance');

      await expect(
        federation.executeInterCellTx({
          sourceCell: 'cell-a',
          targetCell: 'cell-b',
          payer: 'alice',
          payee: 'bob-in-cell-b',
          amount: 100,
        })
      ).rejects.toThrow('suspended');
    });

    test('FD-05: Position calculation after transaction is correct', async () => {
      // Execute multiple transactions
      await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 100,
      });

      await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 50,
      });

      expect(federation.getPosition()).toBe(150);
      expect(federation.getAvailableCapacity()).toBe(450); // 600 - 150
    });

    test('FD-07: Isolation preserves internal ledger conservation', async () => {
      // Before transaction
      const beforeConservation = ledger.verifyConservation();
      expect(beforeConservation).toBe(true);

      await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 100,
      });

      // After transaction
      const afterConservation = ledger.verifyConservation();
      expect(afterConservation).toBe(true);
    });

    test('Transaction to non-existent link fails', async () => {
      await expect(
        federation.executeInterCellTx({
          sourceCell: 'cell-a',
          targetCell: 'cell-c', // No link
          payer: 'alice',
          payee: 'someone',
          amount: 100,
        })
      ).rejects.toThrow('No link to cell');
    });

    test('Transaction with insufficient payer balance fails', async () => {
      // Add a new member with limited capacity
      await ledger.addMember('poor-charlie', 100);
      // charlie has balance 0, limit 100, so can spend up to 100

      await expect(
        federation.executeInterCellTx({
          sourceCell: 'cell-a',
          targetCell: 'cell-b',
          payer: 'poor-charlie',
          payee: 'bob-in-cell-b',
          amount: 150, // more than charlie's capacity of 100
        })
      ).rejects.toThrow('cannot spend');
    });
  });

  describe('Quarantine - FD-06', () => {
    test('FD-06: Quarantine triggered on cap violation', async () => {
      // Reduce cap by setting beta to very low value
      await federation.setExposureCapFactor(0.01); // 1% = 20

      // Set up link and make a transaction that causes cap to be exceeded
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);

      // Current position is 0, cap is 20
      // Make transaction for 15
      await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 15,
      });

      // Now reduce cap further to trigger violation
      await federation.setExposureCapFactor(0.005); // Cap becomes 10, position is 15

      const state = federation.getFederationState();
      expect(state.status).toBe(FederationStatus.QUARANTINED);
      expect(state.quarantineReason).toBe(QuarantineReason.CAP_VIOLATION);
    });

    test('Quarantine on PANIC mode (beta = 0)', async () => {
      await federation.setExposureCapFactor(0);

      const state = federation.getFederationState();
      expect(state.status).toBe(FederationStatus.QUARANTINED);
      expect(state.quarantineReason).toBe(QuarantineReason.PANIC_MODE);
    });

    test('Cannot transact while quarantined', async () => {
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);

      await federation.enterQuarantine(QuarantineReason.MANUAL_SUSPENSION);

      await expect(
        federation.executeInterCellTx({
          sourceCell: 'cell-a',
          targetCell: 'cell-b',
          payer: 'alice',
          payee: 'bob-in-cell-b',
          amount: 100,
        })
      ).rejects.toThrow('quarantined');
    });

    test('Can exit quarantine when conditions met', async () => {
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);

      // Enter quarantine manually
      await federation.enterQuarantine(QuarantineReason.MANUAL_SUSPENSION);

      // Exit (manual suspension can always exit)
      await federation.exitQuarantine();

      const state = federation.getFederationState();
      expect(state.status).toBe(FederationStatus.ACTIVE);
    });

    test('Cannot exit cap violation quarantine while over cap', async () => {
      // Set up link and make transaction
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);

      await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 100,
      });

      // Reduce cap to cause violation
      await federation.setExposureCapFactor(0.01); // Cap = 20, position = 100

      // Try to exit
      await expect(federation.exitQuarantine()).rejects.toThrow('position still exceeds cap');
    });
  });

  describe('Emergency Integration', () => {
    test('Federation frozen in PANIC mode', async () => {
      // Enter PANIC via emergency engine
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      // Set up link
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);

      // Try transaction
      await expect(
        federation.executeInterCellTx({
          sourceCell: 'cell-a',
          targetCell: 'cell-b',
          payer: 'alice',
          payee: 'bob-in-cell-b',
          amount: 100,
        })
      ).rejects.toThrow('frozen');
    });

    test('Beta factor updates exposure cap', async () => {
      const originalCap = federation.getExposureCap();

      await federation.setExposureCapFactor(0.5);

      const newCap = federation.getExposureCap();
      expect(newCap).toBeGreaterThan(originalCap);
    });
  });

  describe('Transaction Rollback', () => {
    test('Can rollback pending transaction', async () => {
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);

      const result = await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 100,
      });

      // Our mock completes immediately, but in real system could be pending
      // For testing, let's manually set status back to SOURCE_CONFIRMED
      const txResult = await storage.getFederationTransaction(result.transaction.id);
      if (txResult.ok && txResult.value) {
        txResult.value.status = FederationTxStatus.SOURCE_CONFIRMED;
        txResult.value.completedAt = undefined;
        await storage.saveFederationTransaction(txResult.value);
      }

      // Now rollback
      await federation.rollbackTransaction(result.transaction.id, 'Target rejected');

      // Position should be back to 0
      expect(federation.getPosition()).toBe(0);

      // Transaction should be rolled back
      const rolledBackTx = await federation.getTransaction(result.transaction.id);
      expect(rolledBackTx?.status).toBe(FederationTxStatus.ROLLED_BACK);
    });

    test('Cannot rollback completed transaction', async () => {
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);

      const result = await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 100,
      });

      await expect(
        federation.rollbackTransaction(result.transaction.id, 'Changed mind')
      ).rejects.toThrow('Cannot rollback completed');
    });
  });

  describe('Exposure Analysis', () => {
    test('Reports correct exposure metrics', async () => {
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);

      await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 450, // 75% of 600 cap
      });

      const analysis = federation.analyzeExposure();

      expect(analysis.position).toBe(450);
      expect(analysis.cap).toBe(600);
      expect(analysis.availableCapacity).toBe(150);
      expect(analysis.utilization).toBe(0.75);
      expect(analysis.atWarning).toBe(true); // >= 0.75
      expect(analysis.atCritical).toBe(false); // < 0.90
      expect(analysis.capExceeded).toBe(false);
    });

    test('Transaction result reports near cap status', async () => {
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);

      const result = await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 500, // ~83% of cap
      });

      expect(result.nearCap).toBe(true);
    });
  });

  describe('Transaction Queries', () => {
    test('Can retrieve transaction by ID', async () => {
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);

      const result = await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 100,
      });

      const tx = await federation.getTransaction(result.transaction.id);
      expect(tx).toBeDefined();
      expect(tx?.amount).toBe(100);
    });

    test('Can retrieve transactions with filters', async () => {
      const proposal = await federation.proposeLink('cell-b');
      await federation.acceptLink(proposal.id);

      await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 100,
      });

      await federation.executeInterCellTx({
        sourceCell: 'cell-a',
        targetCell: 'cell-b',
        payer: 'alice',
        payee: 'bob-in-cell-b',
        amount: 50,
      });

      const transactions = await federation.getTransactions({
        status: FederationTxStatus.COMPLETED,
      });

      expect(transactions.length).toBe(2);
    });
  });

  describe('Persistence', () => {
    test('State is saved to storage', async () => {
      const proposal = await federation.proposeLink('cell-persist');
      await federation.acceptLink(proposal.id);

      const result = await storage.getFederationState('cell-a');
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Check that cell-persist link exists and is active
        const activeLinks = result.value?.connectedCells.filter(c => c.status === 'ACTIVE') || [];
        expect(activeLinks.some(c => c.remoteCellId === 'cell-persist')).toBe(true);
      }
    });

    test('State can be loaded from storage', async () => {
      // Use a fresh storage for this test to avoid interference
      const freshStorage = createInMemoryStorage();
      const freshLedger = await createLedgerEngine('cell-fresh', { defaultLimit: 1000 }, freshStorage);
      await freshLedger.addMember('alice', 1000);
      await freshLedger.addMember('bob', 1000);

      const freshFederation = await createFederationEngine('cell-fresh', freshLedger, freshStorage, {
        baseBetaFactor: 0.3,
      });

      // proposeLink creates a pending link
      const proposal = await freshFederation.proposeLink('cell-remote');
      // Verify the pending link was created correctly
      expect(freshFederation.getLink('cell-remote')?.status).toBe('PENDING');

      // Accept makes it active
      await freshFederation.acceptLink(proposal.id);

      // Create new federation engine and load state
      const federation2 = new FederationEngine('cell-fresh', freshLedger, freshStorage);
      await federation2.loadState();

      // Should be able to find the link to cell-remote
      const link = federation2.getLink('cell-remote');
      expect(link).toBeDefined();
      expect(link?.status).toBe('ACTIVE');
    });
  });
});
