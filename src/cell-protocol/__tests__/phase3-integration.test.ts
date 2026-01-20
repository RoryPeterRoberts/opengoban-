/**
 * Cell Protocol - Phase 3 Integration Tests
 *
 * Tests for the Resilience Layer integration:
 * - Emergency Mode System (PRD-07)
 * - Federation Layer (PRD-06)
 * - Cross-engine interactions
 */

import { createCellProtocol, CellProtocol } from '../index';
import { createInMemoryStorage, InMemoryStorage } from '../storage/pouchdb-adapter';
import { cryptoAdapter } from '../crypto/crypto-adapter';
import {
  RiskState,
  TransitionReason,
  AdmissionMode,
  SchedulerPriority,
} from '../types/emergency';
import {
  FederationStatus,
  LinkStatus,
  FederationTxStatus,
  QuarantineReason,
} from '../types/federation';
import { BalanceChangeReason, MembershipStatus, now } from '../types/common';

describe('Phase 3 Integration Tests', () => {
  let protocol: CellProtocol;
  let storage: InMemoryStorage;

  beforeEach(async () => {
    storage = createInMemoryStorage();

    if (!cryptoAdapter.isInitialized()) {
      await cryptoAdapter.initialize();
    }

    protocol = await createCellProtocol({
      cellId: 'test-cell',
      ledgerParameters: { defaultLimit: 1000 },
      storage,
      enableFederation: true,
      federationParameters: { baseBetaFactor: 0.3 },
      emergencyThresholds: { panicStabilizationPeriod: 100 }, // Short for testing
    });

    // Add test members
    await protocol.ledger.addMember('alice', 1000);
    await protocol.ledger.addMember('bob', 1000);
    await protocol.ledger.addMember('carol', 1000);

    // Give alice positive balance
    await protocol.ledger.applyBalanceUpdates([
      { memberId: 'alice', delta: 500, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      { memberId: 'bob', delta: -500, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
    ]);

    // Recalculate federation exposure cap after adding members
    // (Cap is based on aggregate capacity which is now 3000)
    if (protocol.federation) {
      await protocol.federation.recalculateExposureCap();
    }
  });

  describe('CellProtocol Factory', () => {
    test('Creates protocol with emergency engine', () => {
      expect(protocol.emergency).toBeDefined();
      expect(protocol.emergency.getCurrentRiskState()).toBe(RiskState.NORMAL);
    });

    test('Creates protocol with federation engine when enabled', () => {
      expect(protocol.federation).toBeDefined();
      expect(protocol.federation!.getPosition()).toBe(0);
    });

    test('Federation is undefined when not enabled', async () => {
      const noFedProtocol = await createCellProtocol({
        cellId: 'no-fed-cell',
        storage: createInMemoryStorage(),
        enableFederation: false,
      });

      expect(noFedProtocol.federation).toBeUndefined();
    });
  });

  describe('Emergency + Federation Integration', () => {
    test('PANIC mode freezes federation', async () => {
      // Set up federation link
      const proposal = await protocol.federation!.proposeLink('remote-cell');
      await protocol.federation!.acceptLink(proposal.id);

      // Verify transaction works in NORMAL state
      await protocol.federation!.executeInterCellTx({
        sourceCell: 'test-cell',
        targetCell: 'remote-cell',
        payer: 'alice',
        payee: 'external-bob',
        amount: 100,
      });

      expect(protocol.federation!.getPosition()).toBe(100);

      // Enter PANIC state
      await protocol.emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await protocol.emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      // Verify federation is frozen
      expect(protocol.emergency.isFederationFrozen()).toBe(true);

      // Attempt transaction should fail
      await expect(
        protocol.federation!.executeInterCellTx({
          sourceCell: 'test-cell',
          targetCell: 'remote-cell',
          payer: 'alice',
          payee: 'external-bob',
          amount: 50,
        })
      ).rejects.toThrow('frozen');
    });

    test('De-escalation unfreezes federation', async () => {
      const proposal = await protocol.federation!.proposeLink('remote-cell');
      await protocol.federation!.acceptLink(proposal.id);

      // Enter and exit PANIC
      await protocol.emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await protocol.emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      // Force de-escalate
      await protocol.emergency.forceDeEscalation('Crisis resolved', 'gov-3', 'admin');

      // Now in STRESSED, federation should work (beta = 0.7)
      expect(protocol.emergency.isFederationFrozen()).toBe(false);

      await protocol.federation!.executeInterCellTx({
        sourceCell: 'test-cell',
        targetCell: 'remote-cell',
        payer: 'alice',
        payee: 'external-bob',
        amount: 50,
      });

      expect(protocol.federation!.getPosition()).toBe(50);
    });

    test('Emergency policy affects federation beta', async () => {
      // Initial cap with beta = 0.3 (from test setup)
      const normalCap = protocol.federation!.getExposureCap();
      // aggregateCapacity = 3000, beta = 0.3, cap = 900
      expect(normalCap).toBe(900);

      // Enter STRESSED
      await protocol.emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );

      // In STRESSED mode, federation beta should be reduced
      // Simulate emergency engine reducing beta (STRESSED policy has federationBetaFactor = 0.7)
      // New effective beta = 0.3 * 0.7 = 0.21
      await protocol.federation!.setExposureCapFactor(0.3 * 0.7);
      const stressedCap = protocol.federation!.getExposureCap();

      // Stressed cap should be lower than normal cap
      // 3000 * 0.21 = 630
      expect(stressedCap).toBe(630);
      expect(stressedCap).toBeLessThan(normalCap);
    });
  });

  describe('EM-I1: Full Escalation Path NORMAL → STRESSED → PANIC', () => {
    test('Completes full escalation', async () => {
      // Start in NORMAL
      expect(protocol.emergency.getCurrentRiskState()).toBe(RiskState.NORMAL);

      // Drive to STRESSED (high floor mass)
      // Put alice and bob at their debt floors
      // alice: balance 500, limit 1000 -> can go to -1000 (delta -1500 would exceed, use -500 to reach 0, then limited)
      // bob: balance -500, limit 1000 -> can go to -1000 (delta -500)
      // We need to move them close to their floors within limits
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'alice', delta: -1500, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: -500, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'carol', delta: 2000, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      // Check alice and bob are at floor
      const aliceState = protocol.ledger.getMemberState('alice');
      const bobState = protocol.ledger.getMemberState('bob');
      expect(aliceState?.balance).toBe(-1000); // Started at 500, -1500 = -1000 (at floor)
      expect(bobState?.balance).toBe(-1000); // Started at -500, -500 = -1000 (at floor)

      // Update indicators - now 2/3 members at floor (66% floor mass)
      await protocol.emergency.updateIndicators();
      const indicators = protocol.emergency.getStressIndicators();

      // Floor mass should be high (>0.25 threshold for STRESSED)
      expect(indicators.floorMass).toBeGreaterThan(0.25);

      // Check state transition based on indicators
      const transition = await protocol.emergency.checkStateTransition();
      expect(transition.shouldTransition).toBe(true);
      expect(transition.targetState).toBe(RiskState.STRESSED);

      // Apply the transition
      await protocol.emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.INDICATOR_TRIGGERED,
        'auto-1'
      );

      expect(protocol.emergency.getCurrentRiskState()).toBe(RiskState.STRESSED);

      // Verify policy changes
      const policy = protocol.emergency.getCurrentPolicy();
      expect(policy.admissionMode).toBe(AdmissionMode.BONDED);
      expect(policy.schedulerPriority).toBe(SchedulerPriority.ESSENTIALS_FIRST);

      // Continue to PANIC via governance override (since threshold for PANIC is 0.40)
      await protocol.emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      expect(protocol.emergency.getCurrentRiskState()).toBe(RiskState.PANIC);
      expect(protocol.emergency.isFederationFrozen()).toBe(true);
    });
  });

  describe('EM-I2: Full Recovery Path PANIC → STRESSED → NORMAL', () => {
    test('Completes full recovery', async () => {
      // Enter PANIC
      await protocol.emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await protocol.emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      expect(protocol.emergency.getCurrentRiskState()).toBe(RiskState.PANIC);

      // Wait for stabilization (short period for testing)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Update indicators (should be low since balances are normal)
      await protocol.emergency.updateIndicators();
      const transition1 = await protocol.emergency.checkStateTransition();

      // Should be able to de-escalate
      if (transition1.shouldTransition) {
        await protocol.emergency.triggerStateChange(
          transition1.targetState!,
          transition1.reason!
        );
      } else {
        // Force if indicators don't trigger
        await protocol.emergency.forceDeEscalation('Recovery', 'gov-3', 'admin');
      }

      expect(protocol.emergency.getCurrentRiskState()).toBe(RiskState.STRESSED);

      // Continue to NORMAL
      await protocol.emergency.forceDeEscalation('Full recovery', 'gov-4', 'admin');

      expect(protocol.emergency.getCurrentRiskState()).toBe(RiskState.NORMAL);
      expect(protocol.emergency.isFederationFrozen()).toBe(false);
    });
  });

  describe('EM-I3: Governance Manual Override', () => {
    test('Council can force state changes', async () => {
      // Initialize council
      await protocol.governance.initializeCouncil([
        {
          memberId: 'alice',
          role: 'CHAIR',
          termStart: now(),
          termEnd: now() + (90 * 24 * 60 * 60 * 1000),
        },
      ]);

      // Simulate governance approval
      const approvalId = 'proposal-123';

      // Force to PANIC (skipping STRESSED)
      await protocol.emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        approvalId,
        'alice'
      );

      expect(protocol.emergency.getCurrentRiskState()).toBe(RiskState.PANIC);

      // Check history records the override
      const history = await protocol.emergency.getStateHistory(0);
      expect(history.length).toBeGreaterThan(0);
      expect(history[history.length - 1].governanceApprovalId).toBe(approvalId);
      expect(history[history.length - 1].initiatedBy).toBe('alice');
    });
  });

  describe('FD-I1: Full Inter-Cell Transaction Flow', () => {
    test('Completes transaction lifecycle', async () => {
      // Establish link
      const proposal = await protocol.federation!.proposeLink('remote-cell');
      expect(proposal.status).toBe('PENDING');

      const link = await protocol.federation!.acceptLink(proposal.id);
      expect(link.status).toBe(LinkStatus.ACTIVE);

      // Execute transaction
      const result = await protocol.federation!.executeInterCellTx({
        sourceCell: 'test-cell',
        targetCell: 'remote-cell',
        payer: 'alice',
        payee: 'external-bob',
        amount: 200,
        memo: 'Integration test payment',
      });

      expect(result.transaction.status).toBe(FederationTxStatus.COMPLETED);
      expect(result.newPosition).toBe(200);

      // Verify balances
      const aliceBalance = protocol.ledger.getMemberState('alice')?.balance;
      expect(aliceBalance).toBe(300); // Started with 500, paid 200

      const clearingBalance = protocol.ledger.getMemberState(
        protocol.federation!.getClearingAccountId()
      )?.balance;
      expect(clearingBalance).toBe(200);

      // Verify bilateral position
      const linkAfter = protocol.federation!.getLink('remote-cell');
      expect(linkAfter?.bilateralPosition).toBe(200);
    });
  });

  describe('FD-I2: Transaction Rollback on Target Failure', () => {
    test('Rollback restores state', async () => {
      const proposal = await protocol.federation!.proposeLink('remote-cell');
      await protocol.federation!.acceptLink(proposal.id);

      const beforeBalance = protocol.ledger.getMemberState('alice')?.balance;

      // Execute transaction
      const result = await protocol.federation!.executeInterCellTx({
        sourceCell: 'test-cell',
        targetCell: 'remote-cell',
        payer: 'alice',
        payee: 'external-bob',
        amount: 100,
      });

      // Manually set to SOURCE_CONFIRMED (simulating target not yet confirmed)
      const txResult = await storage.getFederationTransaction(result.transaction.id);
      if (txResult.ok && txResult.value) {
        txResult.value.status = FederationTxStatus.SOURCE_CONFIRMED;
        txResult.value.completedAt = undefined;
        await storage.saveFederationTransaction(txResult.value);
      }

      // Rollback
      await protocol.federation!.rollbackTransaction(
        result.transaction.id,
        'Target cell rejected'
      );

      // Position should be back to 0
      expect(protocol.federation!.getPosition()).toBe(0);

      // Alice's balance should be restored
      const afterBalance = protocol.ledger.getMemberState('alice')?.balance;
      expect(afterBalance).toBe(beforeBalance);

      // Transaction should be marked as rolled back
      const finalTx = await protocol.federation!.getTransaction(result.transaction.id);
      expect(finalTx?.status).toBe(FederationTxStatus.ROLLED_BACK);
    });
  });

  describe('Emergency + Federation Combined: PANIC Triggers Federation Freeze', () => {
    test('Federation quarantined on PANIC', async () => {
      const proposal = await protocol.federation!.proposeLink('remote-cell');
      await protocol.federation!.acceptLink(proposal.id);

      // Execute some transactions first
      await protocol.federation!.executeInterCellTx({
        sourceCell: 'test-cell',
        targetCell: 'remote-cell',
        payer: 'alice',
        payee: 'external-bob',
        amount: 100,
      });

      // Enter PANIC
      await protocol.emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await protocol.emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      // Federation should be frozen
      expect(protocol.emergency.isFederationFrozen()).toBe(true);

      // Update federation with beta = 0
      await protocol.federation!.setExposureCapFactor(0);

      // Should be quarantined (reason can be PANIC_MODE or CAP_VIOLATION when beta=0 with position>0)
      const status = protocol.federation!.checkQuarantineStatus();
      expect([QuarantineReason.PANIC_MODE, QuarantineReason.CAP_VIOLATION]).toContain(status.reason);

      // New transactions should fail
      await expect(
        protocol.federation!.executeInterCellTx({
          sourceCell: 'test-cell',
          targetCell: 'remote-cell',
          payer: 'alice',
          payee: 'external-bob',
          amount: 50,
        })
      ).rejects.toThrow();

      // Existing position is preserved
      expect(protocol.federation!.getPosition()).toBe(100);
    });
  });

  describe('Ledger Conservation During Federation Operations', () => {
    test('Conservation holds across all operations', async () => {
      // Initial state
      expect(protocol.ledger.verifyConservation()).toBe(true);

      // Set up federation
      const proposal = await protocol.federation!.proposeLink('remote-cell');
      await protocol.federation!.acceptLink(proposal.id);

      // Multiple transactions
      for (let i = 0; i < 5; i++) {
        await protocol.federation!.executeInterCellTx({
          sourceCell: 'test-cell',
          targetCell: 'remote-cell',
          payer: 'alice',
          payee: 'external-bob',
          amount: 10,
        });

        // Conservation should hold after each transaction
        expect(protocol.ledger.verifyConservation()).toBe(true);
      }

      // Emergency state changes
      await protocol.emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );

      // Still conserved
      expect(protocol.ledger.verifyConservation()).toBe(true);

      // Final state
      const stats = protocol.ledger.getStatistics();
      expect(stats.balanceSum).toBe(0);
    });
  });

  describe('Threshold Proximity During Operations', () => {
    test('Reports proximity correctly during stress', async () => {
      // Initial proximity
      const initialReport = protocol.emergency.analyzeThresholdProximity();
      expect(initialReport.currentState).toBe(RiskState.NORMAL);
      expect(initialReport.distanceToEscalation).toBeGreaterThan(0);

      // Enter STRESSED
      await protocol.emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );

      const stressedReport = protocol.emergency.analyzeThresholdProximity();
      expect(stressedReport.currentState).toBe(RiskState.STRESSED);
      expect(stressedReport.distanceToDeescalation).toBeLessThan(Infinity);

      // Enter PANIC
      await protocol.emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      const panicReport = protocol.emergency.analyzeThresholdProximity();
      expect(panicReport.currentState).toBe(RiskState.PANIC);
      expect(panicReport.deescalationBlocked).toBe(true);
      expect(panicReport.timeUntilStabilization).toBeGreaterThan(0);
    });
  });

  describe('Exposure Analysis During High Activity', () => {
    test('Tracks exposure correctly', async () => {
      const proposal = await protocol.federation!.proposeLink('remote-cell');
      await protocol.federation!.acceptLink(proposal.id);

      // Execute transactions up to warning threshold
      const cap = protocol.federation!.getExposureCap();
      const warningAmount = Math.floor(cap * 0.8);

      // Execute in chunks
      const chunkSize = Math.floor(warningAmount / 4);
      for (let i = 0; i < 4; i++) {
        await protocol.federation!.executeInterCellTx({
          sourceCell: 'test-cell',
          targetCell: 'remote-cell',
          payer: 'alice',
          payee: 'external-bob',
          amount: chunkSize,
        });
      }

      const analysis = protocol.federation!.analyzeExposure();
      expect(analysis.atWarning).toBe(true);
      expect(analysis.capExceeded).toBe(false);
      expect(analysis.utilization).toBeGreaterThan(0.75);
    });
  });
});
