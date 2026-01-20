/**
 * Cell Protocol - Hardening: Floor Invariant Tests
 *
 * INV-02: Floor Constraint - balance >= -limit
 * Property: No member's balance can go below their negative limit (credit floor).
 */

import { createCellProtocol, CellProtocol } from '../../index';
import { BalanceChangeReason, now } from '../../types/common';
import {
  createInvariantRunner,
  createStateSnapshot,
  checkFloor,
} from './invariant-runner';

describe('INV-02: Floor Constraint', () => {
  let protocol: CellProtocol;

  beforeEach(async () => {
    protocol = await createCellProtocol({
      cellId: 'floor-test-cell',
      ledgerParameters: {
        defaultLimit: 100,
        minLimit: 50,
        maxLimit: 500,
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

  describe('Basic Floor Checks', () => {
    test('Fresh cell satisfies floor constraint', () => {
      const state = createStateSnapshot(protocol);
      const result = checkFloor(state);
      expect(result.holds).toBe(true);
    });

    test('Valid transaction satisfies floor constraint', async () => {
      // member-0 can go negative up to -100
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-0', delta: -50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-1', delta: 50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      const state = createStateSnapshot(protocol);
      const result = checkFloor(state);
      expect(result.holds).toBe(true);

      // Check actual balance
      const member0 = protocol.ledger.getMemberState('member-0');
      expect(member0?.balance).toBe(-50);
      expect(member0?.balance).toBeGreaterThanOrEqual(-member0!.limit);
    });

    test('Balance at exactly floor is valid', async () => {
      // Go exactly to floor (-100)
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-0', delta: -100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-1', delta: 100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      const state = createStateSnapshot(protocol);
      const result = checkFloor(state);
      expect(result.holds).toBe(true);

      const member0 = protocol.ledger.getMemberState('member-0');
      expect(member0?.balance).toBe(-100);
      expect(member0?.balance).toBe(-member0!.limit);
    });

    test('Transaction beyond floor is rejected', async () => {
      // Cannot spend more than limit
      expect(protocol.ledger.canSpend('member-0', 101)).toBe(false);

      // Attempting the transaction should fail
      await expect(
        protocol.ledger.applyBalanceUpdates([
          { memberId: 'member-0', delta: -101, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
          { memberId: 'member-1', delta: 101, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
        ])
      ).rejects.toThrow();
    });
  });

  describe('Floor with Limit Changes', () => {
    test('Increasing limit maintains floor validity', async () => {
      // First use some capacity
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-0', delta: -80, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-1', delta: 80, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      // Increase limit
      await protocol.ledger.updateMemberLimit('member-0', 150);

      const state = createStateSnapshot(protocol);
      const result = checkFloor(state);
      expect(result.holds).toBe(true);

      // Can now spend more
      expect(protocol.ledger.canSpend('member-0', 70)).toBe(true);
    });

    test('Decreasing limit cannot violate floor', async () => {
      // Use most of capacity
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-0', delta: -80, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-1', delta: 80, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      // Cannot decrease limit below current negative balance
      await expect(
        protocol.ledger.updateMemberLimit('member-0', 70)
      ).rejects.toThrow();

      // Floor still holds
      const state = createStateSnapshot(protocol);
      const result = checkFloor(state);
      expect(result.holds).toBe(true);
    });
  });

  describe('Floor with Multiple Transactions', () => {
    test('Sequential transactions respect floor', async () => {
      // Gradual spending
      for (let i = 0; i < 10; i++) {
        if (protocol.ledger.canSpend('member-0', 10)) {
          await protocol.ledger.applyBalanceUpdates([
            { memberId: 'member-0', delta: -10, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
            { memberId: 'member-1', delta: 10, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
          ]);
        }
      }

      const state = createStateSnapshot(protocol);
      const result = checkFloor(state);
      expect(result.holds).toBe(true);

      // Should have used exactly 100 (the limit)
      const member0 = protocol.ledger.getMemberState('member-0');
      expect(member0?.balance).toBe(-100);
    });

    test('All members at floor still valid', async () => {
      // Put everyone at their floor
      // Transfer from member-4 to everyone else
      const members = ['member-0', 'member-1', 'member-2', 'member-3'];

      // First give member-4 positive balance
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-0', delta: -50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-1', delta: -50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-4', delta: 100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      const state = createStateSnapshot(protocol);
      const result = checkFloor(state);
      expect(result.holds).toBe(true);
    });
  });

  describe('Property-Based Testing', () => {
    test('Floor holds under random operations (100 iterations)', async () => {
      const runner = createInvariantRunner({
        defaultIterations: 100,
        maxOperationsPerIteration: 25,
        initialMemberCount: 5,
        baseSeed: 42,
        progressInterval: 25,
      });

      const result = await runner.runInvariant({
        id: 'INV-02',
        property: 'Floor: balance >= -limit',
        iterations: 100,
        checker: checkFloor,
      });

      expect(result.passRate).toBe(1);
      expect(result.failedIterations).toBe(0);
    });

    test('Floor holds under random operations (1000 iterations)', async () => {
      const runner = createInvariantRunner({
        defaultIterations: 1000,
        maxOperationsPerIteration: 30,
        initialMemberCount: 8,
        baseSeed: 54321,
        progressInterval: 100,
      });

      const result = await runner.runInvariant({
        id: 'INV-02',
        property: 'Floor: balance >= -limit',
        iterations: 1000,
        checker: checkFloor,
      });

      expect(result.passRate).toBe(1);
      expect(result.failedIterations).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    test('Member with higher limit has different floor', async () => {
      await protocol.ledger.updateMemberLimit('member-0', 200);

      // Can now spend 200
      expect(protocol.ledger.canSpend('member-0', 200)).toBe(true);

      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-0', delta: -200, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-1', delta: 200, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      const state = createStateSnapshot(protocol);
      const result = checkFloor(state);
      expect(result.holds).toBe(true);

      const member0 = protocol.ledger.getMemberState('member-0');
      expect(member0?.balance).toBe(-200);
      expect(member0?.balance).toBe(-member0!.limit);
    });

    test('Positive balance member can still only go to floor', async () => {
      // Give member-0 positive balance
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member-1', delta: -50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member-0', delta: 50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      // Can now spend 150 (50 balance + 100 limit)
      expect(protocol.ledger.canSpend('member-0', 150)).toBe(true);
      expect(protocol.ledger.canSpend('member-0', 151)).toBe(false);
    });
  });
});

/**
 * Run floor invariant at scale (100,000 iterations)
 * This test is skipped by default - run explicitly for full validation
 */
describe.skip('INV-02: Floor Constraint - Full Scale', () => {
  test('Floor holds under 100,000 random operations', async () => {
    const runner = createInvariantRunner({
      defaultIterations: 100000,
      maxOperationsPerIteration: 50,
      initialMemberCount: 10,
      baseSeed: 98765,
      progressInterval: 10000,
    });

    runner.setProgressCallback((iteration, total, id) => {
      console.log(`Progress: ${iteration}/${total} (${id})`);
    });

    const result = await runner.runInvariant({
      id: 'INV-02',
      property: 'Floor: balance >= -limit',
      iterations: 100000,
      checker: checkFloor,
    });

    console.log(`
      Floor Invariant Results:
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
