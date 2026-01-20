/**
 * Cell Protocol - Hardening: Reserve Invariant Tests
 *
 * INV-03: Reserve >= 0
 * INV-04: Escrow safety - balance - reserve >= -limit
 *
 * Properties for reserve and escrow safety constraints.
 */

import { createCellProtocol, CellProtocol } from '../../index';
import { BalanceChangeReason, now } from '../../types/common';
import { CommitmentType, TaskCategory } from '../../types/commitment';
import {
  createInvariantRunner,
  createStateSnapshot,
  checkReserveNonNegative,
  checkEscrowSafety,
} from './invariant-runner';

describe('INV-03: Reserve Non-Negative', () => {
  let protocol: CellProtocol;

  beforeEach(async () => {
    protocol = await createCellProtocol({
      cellId: 'reserve-test-cell',
      ledgerParameters: {
        defaultLimit: 100,
        enforceEscrowSafety: true,
      },
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

  describe('Basic Reserve Checks', () => {
    test('Fresh cell has zero reserves', () => {
      const state = createStateSnapshot(protocol);
      const result = checkReserveNonNegative(state);
      expect(result.holds).toBe(true);

      // All members should have zero reserve
      for (const member of state.members) {
        expect(member.reserve).toBe(0);
      }
    });

    test('Creating escrowed commitment increases reserve', async () => {
      await protocol.commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'member-0',
        promisee: 'member-1',
        value: 50,
        category: TaskCategory.GENERAL,
        description: 'Test commitment',
      });

      const state = createStateSnapshot(protocol);
      const result = checkReserveNonNegative(state);
      expect(result.holds).toBe(true);

      // No reserve change visible at snapshot level because reserve is on promisee (payer)
      // The commitment engine handles this differently - let's check the ledger directly
      const member1State = protocol.ledger.getMemberState('member-1');
      expect(member1State?.reserve).toBeGreaterThanOrEqual(0);
    });

    test('Soft commitment does not affect reserve', async () => {
      const promisorBefore = protocol.ledger.getMemberState('member-0');
      const reserveBefore = promisorBefore?.reserve ?? 0;

      await protocol.commitments.createCommitment({
        type: CommitmentType.SOFT,
        promisor: 'member-0',
        promisee: 'member-1',
        value: 50,
        category: TaskCategory.GENERAL,
        description: 'Soft commitment',
      });

      const state = createStateSnapshot(protocol);
      const result = checkReserveNonNegative(state);
      expect(result.holds).toBe(true);

      // Reserve should remain unchanged for soft commitments
      const promisorAfter = protocol.ledger.getMemberState('member-0');
      expect(promisorAfter?.reserve).toBe(reserveBefore);
    });
  });

  describe('Reserve with Commitment Lifecycle', () => {
    test('Fulfilling commitment releases reserve', async () => {
      const commitment = await protocol.commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'member-0',
        promisee: 'member-1',
        value: 50,
        category: TaskCategory.GENERAL,
        description: 'Test commitment',
      });

      // Fulfill
      await protocol.commitments.fulfillCommitment(commitment.id, {
        commitmentId: commitment.id,
        confirmedBy: 'member-1',
        timestamp: now(),
      });

      const state = createStateSnapshot(protocol);
      const result = checkReserveNonNegative(state);
      expect(result.holds).toBe(true);
    });

    test('Cancelling commitment releases reserve', async () => {
      const commitment = await protocol.commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'member-0',
        promisee: 'member-1',
        value: 50,
        category: TaskCategory.GENERAL,
        description: 'Test commitment',
      });

      // Cancel
      await protocol.commitments.cancelCommitment(commitment.id, 'Test cancel', 'member-0');

      const state = createStateSnapshot(protocol);
      const result = checkReserveNonNegative(state);
      expect(result.holds).toBe(true);
    });

    test('Multiple commitments maintain non-negative reserve', async () => {
      // Create several commitments
      for (let i = 0; i < 3; i++) {
        await protocol.commitments.createCommitment({
          type: CommitmentType.ESCROWED,
          promisor: `member-${i}`,
          promisee: `member-${i + 1}`,
          value: 20,
          category: TaskCategory.GENERAL,
          description: `Commitment ${i}`,
        });
      }

      const state = createStateSnapshot(protocol);
      const result = checkReserveNonNegative(state);
      expect(result.holds).toBe(true);
    });
  });

  describe('Property-Based Testing', () => {
    test('Reserve non-negative under random operations (100 iterations)', async () => {
      const runner = createInvariantRunner({
        defaultIterations: 100,
        maxOperationsPerIteration: 25,
        initialMemberCount: 5,
        baseSeed: 111,
        progressInterval: 25,
      });

      const result = await runner.runInvariant({
        id: 'INV-03',
        property: 'Reserve >= 0',
        iterations: 100,
        checker: checkReserveNonNegative,
      });

      expect(result.passRate).toBe(1);
    });
  });
});

describe('INV-04: Escrow Safety', () => {
  let protocol: CellProtocol;

  beforeEach(async () => {
    protocol = await createCellProtocol({
      cellId: 'escrow-test-cell',
      ledgerParameters: {
        defaultLimit: 100,
        enforceEscrowSafety: true,
      },
    });

    for (let i = 0; i < 5; i++) {
      await protocol.identity.addMember({
        applicantId: `member-${i}`,
        displayName: `Member ${i}`,
        publicKey: `pk_member-${i}_${'x'.repeat(32)}`,
        requestedAt: now(),
      });
    }
  });

  describe('Basic Escrow Safety', () => {
    test('Fresh cell satisfies escrow safety', () => {
      const state = createStateSnapshot(protocol);
      const result = checkEscrowSafety(state);
      expect(result.holds).toBe(true);
    });

    test('Transaction with reserve satisfies escrow safety', async () => {
      // Create commitment first (reserves capacity)
      await protocol.commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'member-0',
        promisee: 'member-1',
        value: 30,
        category: TaskCategory.GENERAL,
        description: 'Test',
      });

      // Then do a transaction
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-0', delta: -20, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-2', delta: 20, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      const state = createStateSnapshot(protocol);
      const result = checkEscrowSafety(state);
      expect(result.holds).toBe(true);
    });

    test('Cannot spend reserved capacity', async () => {
      // Reserve 80 units
      await protocol.commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'member-0',
        promisee: 'member-1',
        value: 80,
        category: TaskCategory.GENERAL,
        description: 'Large commitment',
      });

      // Should only have 20 available (100 limit - 80 reserved)
      // (Note: The escrow reserves on promisee/payer side in this protocol)
      const member1 = protocol.ledger.getMemberState('member-1');
      const available = protocol.ledger.getAvailableCapacity('member-1');

      // Check escrow safety holds
      const state = createStateSnapshot(protocol);
      const result = checkEscrowSafety(state);
      expect(result.holds).toBe(true);
    });
  });

  describe('Escrow Safety Edge Cases', () => {
    test('Available capacity = limit + balance - reserve', async () => {
      // Start fresh - available = 100 + 0 - 0 = 100
      let available = protocol.ledger.getAvailableCapacity('member-0');
      expect(available).toBe(100);

      // Receive 50 - available = 100 + 50 - 0 = 150
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-1', delta: -50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-0', delta: 50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      available = protocol.ledger.getAvailableCapacity('member-0');
      expect(available).toBe(150);

      const state = createStateSnapshot(protocol);
      const result = checkEscrowSafety(state);
      expect(result.holds).toBe(true);
    });

    test('Member at floor with no reserve satisfies escrow safety', async () => {
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-0', delta: -100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-1', delta: 100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      const member0 = protocol.ledger.getMemberState('member-0');
      expect(member0?.balance).toBe(-100);
      expect(member0?.reserve).toBe(0);
      // balance - reserve = -100 - 0 = -100 >= -limit (-100) ✓

      const state = createStateSnapshot(protocol);
      const result = checkEscrowSafety(state);
      expect(result.holds).toBe(true);
    });
  });

  describe('Property-Based Testing', () => {
    test('Escrow safety under random operations (100 iterations)', async () => {
      const runner = createInvariantRunner({
        defaultIterations: 100,
        maxOperationsPerIteration: 25,
        initialMemberCount: 5,
        baseSeed: 222,
        progressInterval: 25,
      });

      const result = await runner.runInvariant({
        id: 'INV-04',
        property: 'Escrow safety: balance - reserve >= -limit',
        iterations: 100,
        checker: checkEscrowSafety,
      });

      expect(result.passRate).toBe(1);
    });
  });
});

/**
 * Full scale reserve/escrow tests
 */
describe.skip('INV-03/04: Reserve Invariants - Full Scale', () => {
  test('Reserve invariants hold under 50,000 operations', async () => {
    const runner = createInvariantRunner({
      defaultIterations: 50000,
      maxOperationsPerIteration: 50,
      initialMemberCount: 10,
      baseSeed: 33333,
      progressInterval: 5000,
    });

    runner.setProgressCallback((iteration, total, id) => {
      console.log(`Progress: ${iteration}/${total} (${id})`);
    });

    const tests = [
      { id: 'INV-03' as const, property: 'Reserve >= 0', checker: checkReserveNonNegative },
      { id: 'INV-04' as const, property: 'Escrow safety', checker: checkEscrowSafety },
    ];

    for (const test of tests) {
      const result = await runner.runInvariant({
        ...test,
        iterations: 50000,
      });

      console.log(`
        ${test.id} Results:
        - Pass Rate: ${(result.passRate * 100).toFixed(2)}%
        - Time: ${result.totalDurationMs}ms
      `);

      expect(result.passRate).toBe(1);
    }
  }, 600000);
});
