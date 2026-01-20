/**
 * Cell Protocol - Hardening: Conservation Invariant Tests
 *
 * INV-01: Conservation Law - SUM(balance) = 0
 * Property: The sum of all member balances must always be zero.
 */

import { createCellProtocol, CellProtocol } from '../../index';
import { BalanceChangeReason, now } from '../../types/common';
import {
  InvariantRunner,
  createInvariantRunner,
  createStateSnapshot,
  checkConservation,
} from './invariant-runner';
import {
  OperationGenerator,
  SeededRandom,
} from '../generators/operation-generator';
import { DEFAULT_RUNNER_CONFIG } from '../types/invariant';

describe('INV-01: Conservation Law', () => {
  let protocol: CellProtocol;

  beforeEach(async () => {
    protocol = await createCellProtocol({
      cellId: 'conservation-test-cell',
    });

    // Add initial members
    for (let i = 0; i < 5; i++) {
      await protocol.identity.addMember({
        applicantId: `member-${i}`,
        displayName: `Member ${i}`,
        publicKey: `pk_member-${i}_${'x'.repeat(32)}`,
        requestedAt: now(),
      });
    }
  });

  describe('Basic Conservation', () => {
    test('Fresh cell has zero sum', () => {
      const state = createStateSnapshot(protocol);
      const result = checkConservation(state);
      expect(result.holds).toBe(true);
    });

    test('After balanced transaction, sum remains zero', async () => {
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-0', delta: -50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-1', delta: 50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      const state = createStateSnapshot(protocol);
      const result = checkConservation(state);
      expect(result.holds).toBe(true);
    });

    test('Multiple transactions maintain conservation', async () => {
      // Series of transactions
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-0', delta: -30, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-1', delta: 30, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-1', delta: -20, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-2', delta: 20, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-2', delta: -45, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-3', delta: 25, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
        { memberId: 'member-4', delta: 20, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      const state = createStateSnapshot(protocol);
      const result = checkConservation(state);
      expect(result.holds).toBe(true);
    });

    test('Multi-party transaction maintains conservation', async () => {
      // Complex multi-party transaction
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-0', delta: -100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-1', delta: 40, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
        { memberId: 'member-2', delta: 30, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
        { memberId: 'member-3', delta: 20, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
        { memberId: 'member-4', delta: 10, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      const state = createStateSnapshot(protocol);
      const result = checkConservation(state);
      expect(result.holds).toBe(true);
    });
  });

  describe('Conservation with Commitments', () => {
    test('Commitment reserve/release maintains conservation', async () => {
      // Create escrowed commitment (reserves capacity but doesn't change balance)
      await protocol.commitments.createCommitment({
        type: 'ESCROWED',
        promisor: 'member-0',
        promisee: 'member-1',
        value: 50,
        category: 'GENERAL',
        description: 'Test commitment',
      });

      const state = createStateSnapshot(protocol);
      const result = checkConservation(state);
      expect(result.holds).toBe(true);
    });

    test('Commitment fulfillment maintains conservation', async () => {
      const commitment = await protocol.commitments.createCommitment({
        type: 'ESCROWED',
        promisor: 'member-0',
        promisee: 'member-1',
        value: 50,
        category: 'GENERAL',
        description: 'Test commitment',
      });

      // Fulfill the commitment (transfers value)
      await protocol.commitments.fulfillCommitment(commitment.id, {
        commitmentId: commitment.id,
        confirmedBy: 'member-1',
        timestamp: now(),
      });

      const state = createStateSnapshot(protocol);
      const result = checkConservation(state);
      expect(result.holds).toBe(true);
    });

    test('Commitment cancellation maintains conservation', async () => {
      const commitment = await protocol.commitments.createCommitment({
        type: 'ESCROWED',
        promisor: 'member-0',
        promisee: 'member-1',
        value: 50,
        category: 'GENERAL',
        description: 'Test commitment',
      });

      // Cancel the commitment
      await protocol.commitments.cancelCommitment(commitment.id, 'Test cancel', 'member-0');

      const state = createStateSnapshot(protocol);
      const result = checkConservation(state);
      expect(result.holds).toBe(true);
    });
  });

  describe('Conservation with Member Changes', () => {
    test('Adding member with zero balance maintains conservation', async () => {
      await protocol.identity.addMember({
        applicantId: 'new-member',
        displayName: 'New Member',
        publicKey: `pk_new-member_${'x'.repeat(32)}`,
        requestedAt: now(),
      });

      const state = createStateSnapshot(protocol);
      const result = checkConservation(state);
      expect(result.holds).toBe(true);
    });

    test('Removing member with zero balance maintains conservation', async () => {
      // Member-4 has zero balance, can be removed
      await protocol.identity.removeMember('member-4', 'Test removal', 'system');

      const state = createStateSnapshot(protocol);
      const result = checkConservation(state);
      expect(result.holds).toBe(true);
    });
  });

  describe('Property-Based Testing', () => {
    test('Conservation holds under random operations (100 iterations)', async () => {
      const runner = createInvariantRunner({
        defaultIterations: 100,
        maxOperationsPerIteration: 20,
        initialMemberCount: 5,
        baseSeed: 42,
        progressInterval: 25,
      });

      const result = await runner.runInvariant({
        id: 'INV-01',
        property: 'Conservation: SUM(balance) = 0',
        iterations: 100,
        checker: checkConservation,
      });

      expect(result.passRate).toBe(1);
      expect(result.failedIterations).toBe(0);
    });

    test('Conservation holds under random operations (1000 iterations)', async () => {
      const runner = createInvariantRunner({
        defaultIterations: 1000,
        maxOperationsPerIteration: 30,
        initialMemberCount: 8,
        baseSeed: 12345,
        progressInterval: 100,
      });

      const result = await runner.runInvariant({
        id: 'INV-01',
        property: 'Conservation: SUM(balance) = 0',
        iterations: 1000,
        checker: checkConservation,
      });

      expect(result.passRate).toBe(1);
      expect(result.failedIterations).toBe(0);
    });
  });
});

/**
 * Run conservation invariant at scale (100,000 iterations)
 * This test is skipped by default - run explicitly for full validation
 */
describe.skip('INV-01: Conservation Law - Full Scale', () => {
  test('Conservation holds under 100,000 random operations', async () => {
    const runner = createInvariantRunner({
      defaultIterations: 100000,
      maxOperationsPerIteration: 50,
      initialMemberCount: 10,
      baseSeed: 12345,
      progressInterval: 10000,
    });

    runner.setProgressCallback((iteration, total, id) => {
      console.log(`Progress: ${iteration}/${total} (${id})`);
    });

    const result = await runner.runInvariant({
      id: 'INV-01',
      property: 'Conservation: SUM(balance) = 0',
      iterations: 100000,
      checker: checkConservation,
    });

    console.log(`
      Conservation Invariant Results:
      - Iterations: ${result.totalIterations}
      - Passed: ${result.passedIterations}
      - Failed: ${result.failedIterations}
      - Pass Rate: ${(result.passRate * 100).toFixed(2)}%
      - Total Time: ${result.totalDurationMs}ms
      - Avg Time/Iteration: ${result.avgDurationMs.toFixed(2)}ms
    `);

    expect(result.passRate).toBe(1);
    expect(result.failedIterations).toBe(0);
  }, 600000); // 10 minute timeout
});
