/**
 * Cell Protocol - Ledger Engine Tests
 *
 * Tests for the Core Ledger Engine (PRD-01).
 * Verifies invariant enforcement and correct behavior.
 */

import {
  LedgerEngine,
  LedgerViolationError,
  createLedgerEngine,
} from '../engines/ledger-engine';
import { createInMemoryStorage } from '../storage/pouchdb-adapter';
import { LedgerErrorCode, BalanceUpdate } from '../types/ledger';
import { MembershipStatus, BalanceChangeReason } from '../types/common';

describe('LedgerEngine', () => {
  let ledger: LedgerEngine;

  beforeEach(async () => {
    const storage = createInMemoryStorage();
    ledger = await createLedgerEngine('test-cell', { defaultLimit: 100 }, storage);
  });

  describe('Member Management', () => {
    test('should add a member with default limit', async () => {
      const member = await ledger.addMember('alice');

      expect(member.memberId).toBe('alice');
      expect(member.balance).toBe(0);
      expect(member.limit).toBe(100);
      expect(member.reserve).toBe(0);
      expect(member.status).toBe(MembershipStatus.ACTIVE);
    });

    test('should add a member with custom limit', async () => {
      const member = await ledger.addMember('alice', 50);

      expect(member.limit).toBe(50);
    });

    test('should reject duplicate member', async () => {
      await ledger.addMember('alice');

      await expect(ledger.addMember('alice'))
        .rejects.toThrow('already exists');
    });

    test('should reject limit outside range', async () => {
      await expect(ledger.addMember('alice', -10))
        .rejects.toThrow('out of range');

      await expect(ledger.addMember('bob', 100000))
        .rejects.toThrow('out of range');
    });

    test('should remove member with zero balance', async () => {
      await ledger.addMember('alice');

      await expect(ledger.removeMember('alice')).resolves.toBeUndefined();
      expect(ledger.getMemberState('alice')).toBeUndefined();
    });
  });

  describe('Conservation Law (Invariant I1)', () => {
    test('L-01: balanced update succeeds', async () => {
      await ledger.addMember('alice');
      await ledger.addMember('bob');

      const updates: BalanceUpdate[] = [
        { memberId: 'alice', delta: -10, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: +10, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ];

      const results = await ledger.applyBalanceUpdates(updates);

      expect(results[0].newBalance).toBe(-10);
      expect(results[1].newBalance).toBe(10);
      expect(ledger.verifyConservation()).toBe(true);
    });

    test('L-02: unbalanced update fails with CONSERVATION_VIOLATION', async () => {
      await ledger.addMember('alice');

      const updates: BalanceUpdate[] = [
        { memberId: 'alice', delta: +10, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ];

      try {
        await ledger.applyBalanceUpdates(updates);
        fail('Expected CONSERVATION_VIOLATION error');
      } catch (e) {
        expect(e).toBeInstanceOf(LedgerViolationError);
        expect((e as LedgerViolationError).code).toBe(LedgerErrorCode.CONSERVATION_VIOLATION);
      }
    });

    test('conservation holds after multiple transactions', async () => {
      await ledger.addMember('alice');
      await ledger.addMember('bob');
      await ledger.addMember('charlie');

      // Multiple transactions
      await ledger.applyBalanceUpdates([
        { memberId: 'alice', delta: -20, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: +20, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      await ledger.applyBalanceUpdates([
        { memberId: 'bob', delta: -15, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'charlie', delta: +15, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      await ledger.applyBalanceUpdates([
        { memberId: 'charlie', delta: -5, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'alice', delta: +5, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      expect(ledger.verifyConservation()).toBe(true);

      const stats = ledger.getStatistics();
      expect(stats.balanceSum).toBe(0);
    });
  });

  describe('Floor Constraint (Invariant I2)', () => {
    test('L-03: spend to exactly -L succeeds', async () => {
      await ledger.addMember('alice', 50);
      await ledger.addMember('bob');

      // Alice spends exactly her limit
      await ledger.applyBalanceUpdates([
        { memberId: 'alice', delta: -50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: +50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      const alice = ledger.getMemberState('alice');
      expect(alice?.balance).toBe(-50);
      expect(alice?.balance).toBe(-alice!.limit);
    });

    test('L-04: spend beyond -L fails with FLOOR_VIOLATION', async () => {
      await ledger.addMember('alice', 50);
      await ledger.addMember('bob');

      // Alice tries to spend more than her limit
      const updates: BalanceUpdate[] = [
        { memberId: 'alice', delta: -51, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: +51, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ];

      try {
        await ledger.applyBalanceUpdates(updates);
        fail('Expected FLOOR_VIOLATION error');
      } catch (e) {
        expect(e).toBeInstanceOf(LedgerViolationError);
        expect((e as LedgerViolationError).code).toBe(LedgerErrorCode.FLOOR_VIOLATION);
      }
    });

    test('floor check applies to all members in batch', async () => {
      await ledger.addMember('alice', 20);
      await ledger.addMember('bob', 20);
      await ledger.addMember('charlie', 20);

      // Alice and Bob both try to spend their limits to Charlie
      const updates: BalanceUpdate[] = [
        { memberId: 'alice', delta: -25, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: -25, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'charlie', delta: +50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ];

      try {
        await ledger.applyBalanceUpdates(updates);
        fail('Expected FLOOR_VIOLATION error');
      } catch (e) {
        expect(e).toBeInstanceOf(LedgerViolationError);
        expect((e as LedgerViolationError).code).toBe(LedgerErrorCode.FLOOR_VIOLATION);
      }
    });
  });

  describe('Spending Capacity', () => {
    test('canSpend returns true when capacity available', async () => {
      await ledger.addMember('alice', 100);

      expect(ledger.canSpend('alice', 50)).toBe(true);
      expect(ledger.canSpend('alice', 100)).toBe(true);
    });

    test('canSpend returns false when insufficient capacity', async () => {
      await ledger.addMember('alice', 100);

      expect(ledger.canSpend('alice', 101)).toBe(false);
    });

    test('canSpend accounts for current balance', async () => {
      await ledger.addMember('alice', 100);
      await ledger.addMember('bob', 100);

      // Alice receives 50
      await ledger.applyBalanceUpdates([
        { memberId: 'bob', delta: -50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'alice', delta: +50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      // Alice can now spend up to 150 (100 limit + 50 balance)
      expect(ledger.canSpend('alice', 150)).toBe(true);
      expect(ledger.canSpend('alice', 151)).toBe(false);
    });

    test('canSpend returns false for non-member', async () => {
      expect(ledger.canSpend('nobody', 10)).toBe(false);
    });

    test('canSpend returns false for frozen member', async () => {
      await ledger.addMember('alice', 100);
      await ledger.updateMemberStatus('alice', MembershipStatus.FROZEN);

      expect(ledger.canSpend('alice', 50)).toBe(false);
    });

    test('canSpend returns false for zero or negative amount', async () => {
      await ledger.addMember('alice', 100);

      expect(ledger.canSpend('alice', 0)).toBe(false);
      expect(ledger.canSpend('alice', -10)).toBe(false);
    });
  });

  describe('Reserve Operations (Escrow Safety)', () => {
    test('can add reserve when capacity available', async () => {
      await ledger.addMember('alice', 100);

      await ledger.applyReserveUpdate({
        memberId: 'alice',
        delta: 30,
        reason: BalanceChangeReason.COMMITMENT_RESERVE,
        commitmentId: 'commitment-1',
      });

      const alice = ledger.getMemberState('alice');
      expect(alice?.reserve).toBe(30);
    });

    test('reserve reduces available capacity', async () => {
      await ledger.addMember('alice', 100);

      await ledger.applyReserveUpdate({
        memberId: 'alice',
        delta: 30,
        reason: BalanceChangeReason.COMMITMENT_RESERVE,
        commitmentId: 'commitment-1',
      });

      // Available capacity is now 70 (100 limit - 30 reserve)
      expect(ledger.getAvailableCapacity('alice')).toBe(70);
      expect(ledger.canSpend('alice', 70)).toBe(true);
      expect(ledger.canSpend('alice', 71)).toBe(false);
    });

    test('cannot reserve more than available', async () => {
      await ledger.addMember('alice', 100);

      try {
        await ledger.applyReserveUpdate({
          memberId: 'alice',
          delta: 101,
          reason: BalanceChangeReason.COMMITMENT_RESERVE,
          commitmentId: 'commitment-1',
        });
        fail('Expected ESCROW_VIOLATION error');
      } catch (e) {
        expect(e).toBeInstanceOf(LedgerViolationError);
        expect((e as LedgerViolationError).code).toBe(LedgerErrorCode.ESCROW_VIOLATION);
      }
    });

    test('can release reserve', async () => {
      await ledger.addMember('alice', 100);

      await ledger.applyReserveUpdate({
        memberId: 'alice',
        delta: 30,
        reason: BalanceChangeReason.COMMITMENT_RESERVE,
        commitmentId: 'commitment-1',
      });

      await ledger.applyReserveUpdate({
        memberId: 'alice',
        delta: -30,
        reason: BalanceChangeReason.COMMITMENT_RELEASE,
        commitmentId: 'commitment-1',
      });

      const alice = ledger.getMemberState('alice');
      expect(alice?.reserve).toBe(0);
      expect(ledger.getAvailableCapacity('alice')).toBe(100);
    });

    test('cannot make reserve negative', async () => {
      await ledger.addMember('alice', 100);

      try {
        await ledger.applyReserveUpdate({
          memberId: 'alice',
          delta: -10,
          reason: BalanceChangeReason.COMMITMENT_RELEASE,
          commitmentId: 'commitment-1',
        });
        fail('Expected NEGATIVE_RESERVE error');
      } catch (e) {
        expect(e).toBeInstanceOf(LedgerViolationError);
        expect((e as LedgerViolationError).code).toBe(LedgerErrorCode.NEGATIVE_RESERVE);
      }
    });
  });

  describe('Limit Updates', () => {
    test('can increase limit', async () => {
      await ledger.addMember('alice', 50);
      await ledger.updateMemberLimit('alice', 100);

      const alice = ledger.getMemberState('alice');
      expect(alice?.limit).toBe(100);
    });

    test('can decrease limit if balance allows', async () => {
      await ledger.addMember('alice', 100);
      await ledger.updateMemberLimit('alice', 50);

      const alice = ledger.getMemberState('alice');
      expect(alice?.limit).toBe(50);
    });

    test('cannot decrease limit below current negative balance', async () => {
      await ledger.addMember('alice', 100);
      await ledger.addMember('bob', 100);

      // Alice goes to -50
      await ledger.applyBalanceUpdates([
        { memberId: 'alice', delta: -50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: +50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      // Cannot reduce limit below 50
      try {
        await ledger.updateMemberLimit('alice', 40);
        fail('Expected FLOOR_VIOLATION error');
      } catch (e) {
        expect(e).toBeInstanceOf(LedgerViolationError);
        expect((e as LedgerViolationError).code).toBe(LedgerErrorCode.FLOOR_VIOLATION);
      }
    });
  });

  describe('Statistics', () => {
    test('getStatistics returns correct aggregate data', async () => {
      await ledger.addMember('alice', 100);
      await ledger.addMember('bob', 50);
      await ledger.addMember('charlie', 75);

      // alice pays bob
      await ledger.applyBalanceUpdates([
        { memberId: 'alice', delta: -30, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: +30, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      const stats = ledger.getStatistics();

      expect(stats.memberCount).toBe(3);
      expect(stats.activeMemberCount).toBe(3);
      expect(stats.aggregateCapacity).toBe(225); // 100 + 50 + 75
      expect(stats.positiveBalanceSum).toBe(30);
      expect(stats.negativeBalanceSum).toBe(30);
      expect(stats.balanceSum).toBe(0); // Conservation
    });
  });

  describe('Verification Methods', () => {
    test('verifyConservation returns true for valid state', async () => {
      await ledger.addMember('alice', 100);
      await ledger.addMember('bob', 100);

      await ledger.applyBalanceUpdates([
        { memberId: 'alice', delta: -50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: +50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      expect(ledger.verifyConservation()).toBe(true);
    });

    test('verifyAllFloors returns true for valid state', async () => {
      await ledger.addMember('alice', 100);
      await ledger.addMember('bob', 100);

      await ledger.applyBalanceUpdates([
        { memberId: 'alice', delta: -100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: +100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      expect(ledger.verifyAllFloors()).toBe(true);
    });
  });

  describe('Member Status', () => {
    test('cannot transact with frozen member', async () => {
      await ledger.addMember('alice', 100);
      await ledger.addMember('bob', 100);
      await ledger.updateMemberStatus('alice', MembershipStatus.FROZEN);

      const updates: BalanceUpdate[] = [
        { memberId: 'alice', delta: -10, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: +10, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ];

      try {
        await ledger.applyBalanceUpdates(updates);
        fail('Expected MEMBER_NOT_ACTIVE error');
      } catch (e) {
        expect(e).toBeInstanceOf(LedgerViolationError);
        expect((e as LedgerViolationError).code).toBe(LedgerErrorCode.MEMBER_NOT_ACTIVE);
      }
    });

    test('cannot remove member with non-zero balance', async () => {
      await ledger.addMember('alice', 100);
      await ledger.addMember('bob', 100);

      await ledger.applyBalanceUpdates([
        { memberId: 'alice', delta: -50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: +50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      await expect(ledger.removeMember('alice'))
        .rejects.toThrow('non-zero balance');
    });
  });

  describe('Atomicity', () => {
    test('failed batch leaves state unchanged', async () => {
      await ledger.addMember('alice', 50);
      await ledger.addMember('bob', 100);

      const aliceBefore = ledger.getMemberState('alice');
      const bobBefore = ledger.getMemberState('bob');

      // This batch should fail because alice doesn't have enough capacity
      const updates: BalanceUpdate[] = [
        { memberId: 'alice', delta: -60, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'bob', delta: +60, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ];

      try {
        await ledger.applyBalanceUpdates(updates);
      } catch (e) {
        // Expected
      }

      // State should be unchanged
      const aliceAfter = ledger.getMemberState('alice');
      const bobAfter = ledger.getMemberState('bob');

      expect(aliceAfter?.balance).toBe(aliceBefore?.balance);
      expect(bobAfter?.balance).toBe(bobBefore?.balance);
    });
  });
});
