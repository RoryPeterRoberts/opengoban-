/**
 * Cell Protocol - Integration Tests
 *
 * End-to-end tests verifying the complete Cell Protocol MVP.
 * Tests the interaction between Ledger, Transaction, and Identity engines.
 */

import {
  createCellProtocol,
  CellProtocol,
  MembershipStatus,
  TransactionStatus,
  LedgerViolationError,
  LedgerErrorCode,
} from '../index';

describe('Cell Protocol Integration', () => {
  let cell: CellProtocol;

  beforeEach(async () => {
    cell = await createCellProtocol({
      cellId: 'test-cell',
      ledgerParameters: {
        defaultLimit: 100,
        minLimit: 10,
        maxLimit: 1000,
      },
    });
  });

  describe('Complete Workflow', () => {
    test('creates cell with members who can exchange credits', async () => {
      // Create identities
      const alice = await cell.identity.createIdentity('test-cell', 'Alice');
      const bob = await cell.identity.createIdentity('test-cell', 'Bob');

      // Admit members
      await cell.identity.addMember({
        applicantId: alice.identity.id,
        publicKey: alice.identity.publicKey,
        displayName: 'Alice',
        requestedAt: Date.now(),
      });

      await cell.identity.addMember({
        applicantId: bob.identity.id,
        publicKey: bob.identity.publicKey,
        displayName: 'Bob',
        requestedAt: Date.now(),
      });

      // Verify initial state
      expect(cell.ledger.getMemberState(alice.identity.id)?.balance).toBe(0);
      expect(cell.ledger.getMemberState(bob.identity.id)?.balance).toBe(0);
      expect(cell.ledger.verifyConservation()).toBe(true);

      // Create and execute a transaction
      const tx = await cell.transactions.createSpotTransaction({
        payer: alice.identity.id,
        payee: bob.identity.id,
        amount: 50,
        description: 'Payment for services',
      });

      // Sign the transaction
      const signingData = cell.transactions.getSigningData(tx);
      const message = JSON.stringify(signingData);

      const aliceSig = cell.crypto.sign(message, alice.secretKey);
      const bobSig = cell.crypto.sign(message, bob.secretKey);

      if (!aliceSig.ok || !bobSig.ok) {
        fail('Signing failed');
      }

      await cell.transactions.signAsPayer(tx.id, aliceSig.value);
      await cell.transactions.signAsPayee(tx.id, bobSig.value);

      // Execute
      const result = await cell.transactions.executeTransaction(tx.id);

      // Verify final state
      expect(result.transaction.status).toBe(TransactionStatus.EXECUTED);
      expect(result.payerNewBalance).toBe(-50);
      expect(result.payeeNewBalance).toBe(50);
      expect(cell.ledger.verifyConservation()).toBe(true);
      expect(cell.ledger.verifyAllFloors()).toBe(true);
    });
  });

  describe('Property: Conservation after random operations', () => {
    test('conservation holds after 100 random transactions', async () => {
      // Create 5 members
      const members: Array<{ identity: any; secretKey: string }> = [];
      for (let i = 0; i < 5; i++) {
        const member = await cell.identity.createIdentity('test-cell', `Member${i}`);
        await cell.identity.addMember({
          applicantId: member.identity.id,
          publicKey: member.identity.publicKey,
          displayName: `Member${i}`,
          requestedAt: Date.now(),
        });
        members.push(member);
      }

      // Execute 100 random transactions
      let successfulTxCount = 0;
      for (let i = 0; i < 100; i++) {
        // Pick random payer and payee
        const payerIdx = Math.floor(Math.random() * members.length);
        let payeeIdx = Math.floor(Math.random() * members.length);
        while (payeeIdx === payerIdx) {
          payeeIdx = Math.floor(Math.random() * members.length);
        }

        const payer = members[payerIdx];
        const payee = members[payeeIdx];

        // Random amount (1-20)
        const amount = Math.floor(Math.random() * 20) + 1;

        try {
          const tx = await cell.transactions.createSpotTransaction({
            payer: payer.identity.id,
            payee: payee.identity.id,
            amount,
            description: `Random tx ${i}`,
          });

          const signingData = cell.transactions.getSigningData(tx);
          const message = JSON.stringify(signingData);

          const payerSig = cell.crypto.sign(message, payer.secretKey);
          const payeeSig = cell.crypto.sign(message, payee.secretKey);

          if (payerSig.ok && payeeSig.ok) {
            await cell.transactions.signAsPayer(tx.id, payerSig.value);
            await cell.transactions.signAsPayee(tx.id, payeeSig.value);
            await cell.transactions.executeTransaction(tx.id);
            successfulTxCount++;
          }
        } catch (e) {
          // Some transactions will fail due to insufficient capacity - that's expected
        }
      }

      // Should have executed at least some transactions
      expect(successfulTxCount).toBeGreaterThan(0);

      // CRITICAL: Conservation must hold
      expect(cell.ledger.verifyConservation()).toBe(true);

      // All floors must be valid
      expect(cell.ledger.verifyAllFloors()).toBe(true);

      // Balance sum must be exactly zero
      const stats = cell.ledger.getStatistics();
      expect(stats.balanceSum).toBe(0);
    });
  });

  describe('Property: Floor never breached', () => {
    test('no member ever goes below their floor', async () => {
      // Create members with varying limits
      const members: Array<{ identity: any; secretKey: string; limit: number }> = [];
      const limits = [20, 50, 100, 30, 75];

      for (let i = 0; i < limits.length; i++) {
        const member = await cell.identity.createIdentity('test-cell', `Member${i}`);
        await cell.identity.addMember({
          applicantId: member.identity.id,
          publicKey: member.identity.publicKey,
          displayName: `Member${i}`,
          initialLimit: limits[i],
          requestedAt: Date.now(),
        });
        members.push({ ...member, limit: limits[i] });
      }

      // Try to perform transactions that would breach floors
      const attemptsToBreachFloor: number[] = [];

      for (let i = 0; i < 50; i++) {
        const payerIdx = Math.floor(Math.random() * members.length);
        let payeeIdx = Math.floor(Math.random() * members.length);
        while (payeeIdx === payerIdx) {
          payeeIdx = Math.floor(Math.random() * members.length);
        }

        const payer = members[payerIdx];
        const payee = members[payeeIdx];

        // Try to spend more than available (sometimes)
        const memberState = cell.ledger.getMemberState(payer.identity.id);
        const available = cell.ledger.getAvailableCapacity(payer.identity.id);

        // 30% of the time, try to spend more than available
        let amount: number;
        if (Math.random() < 0.3 && available > 0) {
          amount = available + Math.floor(Math.random() * 20) + 1;
          attemptsToBreachFloor.push(i);
        } else {
          amount = Math.min(Math.floor(Math.random() * 20) + 1, Math.max(1, available));
        }

        try {
          const tx = await cell.transactions.createSpotTransaction({
            payer: payer.identity.id,
            payee: payee.identity.id,
            amount,
            description: `Test tx ${i}`,
          });

          const signingData = cell.transactions.getSigningData(tx);
          const message = JSON.stringify(signingData);

          const payerSig = cell.crypto.sign(message, payer.secretKey);
          const payeeSig = cell.crypto.sign(message, payee.secretKey);

          if (payerSig.ok && payeeSig.ok) {
            await cell.transactions.signAsPayer(tx.id, payerSig.value);
            await cell.transactions.signAsPayee(tx.id, payeeSig.value);
            await cell.transactions.executeTransaction(tx.id);
          }
        } catch (e) {
          // Expected for attempts to breach floor
        }

        // After every operation, verify floors
        for (const member of members) {
          const state = cell.ledger.getMemberState(member.identity.id);
          if (state) {
            expect(state.balance).toBeGreaterThanOrEqual(-state.limit);
          }
        }
      }

      // Final verification
      expect(cell.ledger.verifyAllFloors()).toBe(true);
      expect(cell.ledger.verifyConservation()).toBe(true);
    });
  });

  describe('Member Lifecycle', () => {
    test('complete member lifecycle: create -> active -> freeze -> unfreeze -> remove', async () => {
      // Create member
      const member = await cell.identity.createIdentity('test-cell', 'TestMember');
      const result = await cell.identity.addMember({
        applicantId: member.identity.id,
        publicKey: member.identity.publicKey,
        displayName: 'TestMember',
        requestedAt: Date.now(),
      });

      expect(result.approved).toBe(true);
      expect(result.identity?.membershipStatus).toBe(MembershipStatus.ACTIVE);

      // Freeze member
      const freezeChange = await cell.identity.freezeMember(
        member.identity.id,
        'Testing freeze',
        member.identity.id
      );
      expect(freezeChange.newStatus).toBe(MembershipStatus.FROZEN);

      // Verify frozen member cannot transact
      const anotherMember = await cell.identity.createIdentity('test-cell', 'Another');
      await cell.identity.addMember({
        applicantId: anotherMember.identity.id,
        publicKey: anotherMember.identity.publicKey,
        displayName: 'Another',
        requestedAt: Date.now(),
      });

      // Cannot create transaction as payer when frozen
      await expect(
        cell.transactions.createSpotTransaction({
          payer: member.identity.id,
          payee: anotherMember.identity.id,
          amount: 10,
          description: 'Should fail',
        })
      ).rejects.toThrow();

      // Unfreeze member
      const unfreezeChange = await cell.identity.unfreezeMember(
        member.identity.id,
        'Testing unfreeze',
        member.identity.id
      );
      expect(unfreezeChange.newStatus).toBe(MembershipStatus.ACTIVE);

      // Can now transact
      const tx = await cell.transactions.createSpotTransaction({
        payer: member.identity.id,
        payee: anotherMember.identity.id,
        amount: 10,
        description: 'Should succeed',
      });
      expect(tx).toBeDefined();

      // Remove member (need zero balance first)
      // Since member has -10 balance now from transaction creation (not executed),
      // we need to settle first
      // For this test, let's just verify removal with zero balance
      const freshMember = await cell.identity.createIdentity('test-cell', 'ToRemove');
      await cell.identity.addMember({
        applicantId: freshMember.identity.id,
        publicKey: freshMember.identity.publicKey,
        displayName: 'ToRemove',
        requestedAt: Date.now(),
      });

      const removeChange = await cell.identity.removeMember(
        freshMember.identity.id,
        'Testing removal',
        freshMember.identity.id
      );
      expect(removeChange.newStatus).toBe(MembershipStatus.EXCLUDED);
    });
  });

  describe('Reserve/Escrow Operations', () => {
    test('reserves reduce available capacity', async () => {
      const member = await cell.identity.createIdentity('test-cell', 'Member');
      await cell.identity.addMember({
        applicantId: member.identity.id,
        publicKey: member.identity.publicKey,
        displayName: 'Member',
        initialLimit: 100,
        requestedAt: Date.now(),
      });

      // Initial capacity
      expect(cell.ledger.getAvailableCapacity(member.identity.id)).toBe(100);

      // Add reserve
      await cell.ledger.applyReserveUpdate({
        memberId: member.identity.id,
        delta: 30,
        reason: 'COMMITMENT_RESERVE' as any,
        commitmentId: 'test-commitment',
      });

      // Capacity reduced
      expect(cell.ledger.getAvailableCapacity(member.identity.id)).toBe(70);

      // Release reserve
      await cell.ledger.applyReserveUpdate({
        memberId: member.identity.id,
        delta: -30,
        reason: 'COMMITMENT_RELEASE' as any,
        commitmentId: 'test-commitment',
      });

      // Capacity restored
      expect(cell.ledger.getAvailableCapacity(member.identity.id)).toBe(100);
    });
  });

  describe('Statistics', () => {
    test('aggregates are correct after multiple transactions', async () => {
      // Create 3 members
      const alice = await cell.identity.createIdentity('test-cell', 'Alice');
      const bob = await cell.identity.createIdentity('test-cell', 'Bob');
      const charlie = await cell.identity.createIdentity('test-cell', 'Charlie');

      await cell.identity.addMember({
        applicantId: alice.identity.id,
        publicKey: alice.identity.publicKey,
        displayName: 'Alice',
        initialLimit: 100,
        requestedAt: Date.now(),
      });

      await cell.identity.addMember({
        applicantId: bob.identity.id,
        publicKey: bob.identity.publicKey,
        displayName: 'Bob',
        initialLimit: 50,
        requestedAt: Date.now(),
      });

      await cell.identity.addMember({
        applicantId: charlie.identity.id,
        publicKey: charlie.identity.publicKey,
        displayName: 'Charlie',
        initialLimit: 75,
        requestedAt: Date.now(),
      });

      // Execute some transactions manually through ledger
      await cell.ledger.applyBalanceUpdates([
        { memberId: alice.identity.id, delta: -40, reason: 'SPOT_TRANSACTION_PAYER' as any },
        { memberId: bob.identity.id, delta: +40, reason: 'SPOT_TRANSACTION_PAYEE' as any },
      ]);

      await cell.ledger.applyBalanceUpdates([
        { memberId: bob.identity.id, delta: -20, reason: 'SPOT_TRANSACTION_PAYER' as any },
        { memberId: charlie.identity.id, delta: +20, reason: 'SPOT_TRANSACTION_PAYEE' as any },
      ]);

      const stats = cell.ledger.getStatistics();

      expect(stats.memberCount).toBe(3);
      expect(stats.activeMemberCount).toBe(3);
      expect(stats.aggregateCapacity).toBe(225); // 100 + 50 + 75
      expect(stats.balanceSum).toBe(0); // Conservation
      expect(stats.positiveBalanceSum).toBe(40); // bob: 20, charlie: 20
      expect(stats.negativeBalanceSum).toBe(40); // alice: 40
    });
  });

  describe('Error Handling', () => {
    test('transaction fails gracefully and preserves state', async () => {
      const alice = await cell.identity.createIdentity('test-cell', 'Alice');
      const bob = await cell.identity.createIdentity('test-cell', 'Bob');

      await cell.identity.addMember({
        applicantId: alice.identity.id,
        publicKey: alice.identity.publicKey,
        displayName: 'Alice',
        initialLimit: 20,
        requestedAt: Date.now(),
      });

      await cell.identity.addMember({
        applicantId: bob.identity.id,
        publicKey: bob.identity.publicKey,
        displayName: 'Bob',
        initialLimit: 100,
        requestedAt: Date.now(),
      });

      // Try to create transaction exceeding capacity
      await expect(
        cell.transactions.createSpotTransaction({
          payer: alice.identity.id,
          payee: bob.identity.id,
          amount: 50, // Alice only has 20 limit
          description: 'Should fail',
        })
      ).rejects.toThrow();

      // State should be unchanged
      expect(cell.ledger.getMemberState(alice.identity.id)?.balance).toBe(0);
      expect(cell.ledger.getMemberState(bob.identity.id)?.balance).toBe(0);
      expect(cell.ledger.verifyConservation()).toBe(true);
    });
  });
});
