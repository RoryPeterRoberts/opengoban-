/**
 * Cell Protocol - Commitment Engine Tests
 *
 * Tests for the Commitment System (PRD-03).
 * Verifies commitment lifecycle and escrow functionality.
 */

import { createLedgerEngine } from '../engines/ledger-engine';
import { createTransactionEngine } from '../engines/transaction-engine';
import { createIdentityEngine } from '../engines/identity-engine';
import { CommitmentEngine, CommitmentValidationError, createCommitmentEngine } from '../engines/commitment-engine';
import { createInMemoryStorage } from '../storage/pouchdb-adapter';
import { cryptoAdapter } from '../crypto/crypto-adapter';
import {
  CommitmentType,
  CommitmentStatus,
  TaskCategory,
  CommitmentErrorCode,
} from '../types/commitment';
import { MembershipStatus, BalanceChangeReason, now } from '../types/common';

describe('CommitmentEngine', () => {
  let commitments: CommitmentEngine;
  let storage: ReturnType<typeof createInMemoryStorage>;
  let ledger: Awaited<ReturnType<typeof createLedgerEngine>>;
  let transactions: ReturnType<typeof createTransactionEngine>;

  beforeEach(async () => {
    storage = createInMemoryStorage();
    ledger = await createLedgerEngine('test-cell', { defaultLimit: 100 }, storage);

    // Initialize crypto
    if (!cryptoAdapter.isInitialized()) {
      await cryptoAdapter.initialize();
    }

    const identity = createIdentityEngine(ledger, storage, cryptoAdapter);
    const publicKeyResolver = async (memberId: string) => {
      const id = await identity.getIdentity(memberId);
      return id?.publicKey;
    };
    transactions = createTransactionEngine(ledger, storage, cryptoAdapter, publicKeyResolver);
    commitments = createCommitmentEngine(ledger, transactions, storage);

    // Add test members
    await ledger.addMember('alice');
    await ledger.addMember('bob');
    await ledger.addMember('charlie');
  });

  describe('Create Commitment', () => {
    test('CM-01: Create soft commitment succeeds', async () => {
      const commitment = await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 20,
        category: TaskCategory.FOOD,
        description: 'Prepare dinner',
      });

      expect(commitment.id).toBeDefined();
      expect(commitment.type).toBe(CommitmentType.SOFT);
      expect(commitment.promisor).toBe('alice');
      expect(commitment.promisee).toBe('bob');
      expect(commitment.value).toBe(20);
      expect(commitment.status).toBe(CommitmentStatus.ACTIVE);

      // Soft commitment doesn't reserve capacity
      const bobState = ledger.getMemberState('bob');
      expect(bobState?.reserve).toBe(0);
    });

    test('CM-02: Create escrowed commitment reserves capacity', async () => {
      const commitment = await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'alice',
        promisee: 'bob',
        value: 30,
        category: TaskCategory.GENERAL,
        description: 'Clean house',
      });

      expect(commitment.type).toBe(CommitmentType.ESCROWED);
      expect(commitment.status).toBe(CommitmentStatus.ACTIVE);

      // Escrowed commitment reserves promisee's (payer) capacity
      const bobState = ledger.getMemberState('bob');
      expect(bobState?.reserve).toBe(30);

      // Available capacity should be reduced
      expect(ledger.getAvailableCapacity('bob')).toBe(70); // 100 - 30
    });

    test('Cannot create commitment with insufficient capacity', async () => {
      await expect(commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'alice',
        promisee: 'bob',
        value: 150, // Bob only has 100 capacity
        category: TaskCategory.GENERAL,
        description: 'Too expensive',
      })).rejects.toThrow('insufficient capacity');
    });

    test('Cannot create self-commitment', async () => {
      await expect(commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'alice',
        value: 10,
        category: TaskCategory.GENERAL,
        description: 'Self task',
      })).rejects.toThrow('yourself');
    });

    test('Cannot create commitment with non-active member', async () => {
      await ledger.updateMemberStatus('alice', MembershipStatus.FROZEN);

      await expect(commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 10,
        category: TaskCategory.GENERAL,
        description: 'Task',
      })).rejects.toThrow('not active');
    });

    test('Cannot create commitment with past due date', async () => {
      await expect(commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 10,
        category: TaskCategory.GENERAL,
        description: 'Task',
        dueDate: now() - 1000, // Past
      })).rejects.toThrow('future');
    });
  });

  describe('Fulfill Commitment', () => {
    test('CM-03: Fulfill commitment executes transaction', async () => {
      const commitment = await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 25,
        category: TaskCategory.FOOD,
        description: 'Cook meal',
      });

      // Bob confirms fulfillment (pays alice)
      const result = await commitments.fulfillCommitment(commitment.id, {
        commitmentId: commitment.id,
        confirmedBy: 'bob',
        rating: 5,
        timestamp: now(),
      });

      expect(result.commitment.status).toBe(CommitmentStatus.FULFILLED);
      expect(result.payerNewBalance).toBe(-25); // Bob paid
      expect(result.payeeNewBalance).toBe(25);  // Alice received

      // Verify conservation
      expect(ledger.verifyConservation()).toBe(true);
    });

    test('Fulfilling escrowed commitment releases reserve first', async () => {
      const commitment = await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'alice',
        promisee: 'bob',
        value: 30,
        category: TaskCategory.GENERAL,
        description: 'Task',
      });

      // Bob should have reserve
      expect(ledger.getMemberState('bob')?.reserve).toBe(30);

      await commitments.fulfillCommitment(commitment.id, {
        commitmentId: commitment.id,
        confirmedBy: 'bob',
        timestamp: now(),
      });

      // Reserve should be released
      expect(ledger.getMemberState('bob')?.reserve).toBe(0);
      // Balance should be -30
      expect(ledger.getMemberState('bob')?.balance).toBe(-30);
    });

    test('Only promisee can confirm fulfillment', async () => {
      const commitment = await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 10,
        category: TaskCategory.GENERAL,
        description: 'Task',
      });

      await expect(commitments.fulfillCommitment(commitment.id, {
        commitmentId: commitment.id,
        confirmedBy: 'charlie', // Not promisee
        timestamp: now(),
      })).rejects.toThrow('Only promisee');
    });
  });

  describe('Cancel Commitment', () => {
    test('CM-04: Cancel with mutual consent succeeds', async () => {
      const commitment = await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 20,
        category: TaskCategory.GENERAL,
        description: 'Task',
      });

      const cancelled = await commitments.cancelCommitment(
        commitment.id,
        'Changed plans',
        'bob' // Promisee cancels
      );

      expect(cancelled.status).toBe(CommitmentStatus.CANCELLED);
      expect(cancelled.cancelledAt).toBeDefined();
    });

    test('CM-05: Cancel escrowed releases reserve', async () => {
      const commitment = await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'alice',
        promisee: 'bob',
        value: 40,
        category: TaskCategory.GENERAL,
        description: 'Task',
      });

      expect(ledger.getMemberState('bob')?.reserve).toBe(40);

      await commitments.cancelCommitment(commitment.id, 'No longer needed', 'alice');

      // Reserve should be released
      expect(ledger.getMemberState('bob')?.reserve).toBe(0);
      // Balance should be unchanged
      expect(ledger.getMemberState('bob')?.balance).toBe(0);
    });

    test('Cannot cancel fulfilled commitment', async () => {
      const commitment = await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 10,
        category: TaskCategory.GENERAL,
        description: 'Task',
      });

      await commitments.fulfillCommitment(commitment.id, {
        commitmentId: commitment.id,
        confirmedBy: 'bob',
        timestamp: now(),
      });

      await expect(commitments.cancelCommitment(commitment.id, 'reason', 'bob'))
        .rejects.toThrow('Cannot cancel');
    });
  });

  describe('Dispute Commitment', () => {
    test('Can dispute active commitment', async () => {
      const commitment = await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 50,
        category: TaskCategory.MEDICAL,
        description: 'Health checkup',
      });

      const disputed = await commitments.disputeCommitment(
        commitment.id,
        'Quality issues',
        'bob'
      );

      expect(disputed.status).toBe(CommitmentStatus.DISPUTED);
    });

    test('Only parties can dispute', async () => {
      const commitment = await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 10,
        category: TaskCategory.GENERAL,
        description: 'Task',
      });

      await expect(commitments.disputeCommitment(
        commitment.id,
        'Reason',
        'charlie'
      )).rejects.toThrow('Only parties');
    });
  });

  describe('Queries', () => {
    test('CM-06: Overdue detection works', async () => {
      // Create commitment with immediate due date (already past)
      const futureDate = now() + 100; // 100ms in future
      await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 10,
        category: TaskCategory.GENERAL,
        description: 'Task 1',
        dueDate: futureDate,
      });

      // Wait for it to become overdue
      await new Promise(resolve => setTimeout(resolve, 150));

      const overdue = await commitments.getOverdueCommitments();
      expect(overdue.length).toBeGreaterThanOrEqual(1);
    });

    test('CM-07: Query by member works', async () => {
      await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 10,
        category: TaskCategory.FOOD,
        description: 'Task 1',
      });

      await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'bob',
        promisee: 'charlie',
        value: 15,
        category: TaskCategory.GENERAL,
        description: 'Task 2',
      });

      const aliceCommitments = await commitments.getCommitmentsByMember('alice');
      expect(aliceCommitments.length).toBe(1);

      const bobCommitments = await commitments.getCommitmentsByMember('bob');
      expect(bobCommitments.length).toBe(2); // As both promisor and promisee
    });

    test('CM-08: Query by category works', async () => {
      await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 10,
        category: TaskCategory.FOOD,
        description: 'Food task',
      });

      await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'charlie',
        value: 20,
        category: TaskCategory.FOOD,
        description: 'Another food task',
      });

      await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'bob',
        promisee: 'charlie',
        value: 15,
        category: TaskCategory.MEDICAL,
        description: 'Medical task',
      });

      const foodCommitments = await commitments.getCommitmentsByCategory(TaskCategory.FOOD);
      expect(foodCommitments.length).toBe(2);

      const medicalCommitments = await commitments.getCommitmentsByCategory(TaskCategory.MEDICAL);
      expect(medicalCommitments.length).toBe(1);
    });
  });

  describe('Analytics', () => {
    test('CM-09: Reserved capacity calculation correct', async () => {
      // Bob is promisee (payer) on multiple escrowed commitments
      await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'alice',
        promisee: 'bob',
        value: 20,
        category: TaskCategory.GENERAL,
        description: 'Task 1',
      });

      await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'charlie',
        promisee: 'bob',
        value: 30,
        category: TaskCategory.GENERAL,
        description: 'Task 2',
      });

      // Soft commitment doesn't affect reserve
      await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 10,
        category: TaskCategory.GENERAL,
        description: 'Task 3',
      });

      const reserved = commitments.getMemberReservedCapacity('bob');
      expect(reserved).toBe(50); // 20 + 30
    });

    test('Category fulfillment rate calculated correctly', async () => {
      // Create and fulfill some commitments
      const c1 = await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'bob',
        value: 10,
        category: TaskCategory.FOOD,
        description: 'Task 1',
      });

      const c2 = await commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'alice',
        promisee: 'charlie',
        value: 10,
        category: TaskCategory.FOOD,
        description: 'Task 2',
      });

      // Fulfill one
      await commitments.fulfillCommitment(c1.id, {
        commitmentId: c1.id,
        confirmedBy: 'bob',
        timestamp: now(),
      });

      // Cancel one
      await commitments.cancelCommitment(c2.id, 'Cancelled', 'charlie');

      const rate = await commitments.getCategoryFulfillmentRate(TaskCategory.FOOD);
      expect(rate).toBe(0.5); // 1 fulfilled, 1 cancelled = 50%
    });
  });

  describe('Invariants', () => {
    test('Conservation holds after commitment lifecycle', async () => {
      // Create multiple commitments
      const c1 = await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'alice',
        promisee: 'bob',
        value: 30,
        category: TaskCategory.GENERAL,
        description: 'Task 1',
      });

      const c2 = await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'bob',
        promisee: 'charlie',
        value: 20,
        category: TaskCategory.GENERAL,
        description: 'Task 2',
      });

      // Fulfill first
      await commitments.fulfillCommitment(c1.id, {
        commitmentId: c1.id,
        confirmedBy: 'bob',
        timestamp: now(),
      });

      // Cancel second
      await commitments.cancelCommitment(c2.id, 'Cancelled', 'bob');

      // Conservation must still hold
      expect(ledger.verifyConservation()).toBe(true);

      // All reserves should be released
      expect(ledger.getMemberState('bob')?.reserve).toBe(0);
      expect(ledger.getMemberState('charlie')?.reserve).toBe(0);
    });
  });
});
