/**
 * Cell Protocol - Scheduler Engine Tests
 *
 * Tests for the Survival Scheduler (PRD-08).
 * Verifies scheduling, matching, and coverage functionality.
 */

import { createLedgerEngine } from '../engines/ledger-engine';
import { createTransactionEngine } from '../engines/transaction-engine';
import { createIdentityEngine } from '../engines/identity-engine';
import { createCommitmentEngine } from '../engines/commitment-engine';
import { SchedulerEngine, SchedulerValidationError, createSchedulerEngine } from '../engines/scheduler-engine';
import { createInMemoryStorage } from '../storage/pouchdb-adapter';
import { cryptoAdapter } from '../crypto/crypto-adapter';
import {
  TaskSlotStatus,
  SchedulerErrorCode,
} from '../types/scheduler';
import { TaskCategory } from '../types/commitment';
import { MembershipStatus, now } from '../types/common';

describe('SchedulerEngine', () => {
  let scheduler: SchedulerEngine;
  let storage: ReturnType<typeof createInMemoryStorage>;
  let ledger: Awaited<ReturnType<typeof createLedgerEngine>>;
  let commitments: ReturnType<typeof createCommitmentEngine>;

  beforeEach(async () => {
    storage = createInMemoryStorage();
    ledger = await createLedgerEngine('test-cell', { defaultLimit: 100 }, storage);

    if (!cryptoAdapter.isInitialized()) {
      await cryptoAdapter.initialize();
    }

    const identity = createIdentityEngine(ledger, storage, cryptoAdapter);
    const publicKeyResolver = async (memberId: string) => {
      const id = await identity.getIdentity(memberId);
      return id?.publicKey;
    };
    const transactions = createTransactionEngine(ledger, storage, cryptoAdapter, publicKeyResolver);
    commitments = createCommitmentEngine(ledger, transactions, storage);
    scheduler = createSchedulerEngine(ledger, commitments, storage);

    // Add test members
    await ledger.addMember('alice');
    await ledger.addMember('bob');
    await ledger.addMember('charlie');
  });

  describe('Task Templates', () => {
    test('Create template succeeds', async () => {
      const template = await scheduler.createTaskTemplate({
        category: TaskCategory.FOOD,
        name: 'Daily Breakfast',
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 2,
        dayOfWeek: null, // Daily
        startHour: 6,
        durationHours: 2,
        description: 'Prepare breakfast for the community',
      });

      expect(template.id).toBeDefined();
      expect(template.category).toBe(TaskCategory.FOOD);
      expect(template.name).toBe('Daily Breakfast');
      expect(template.active).toBe(true);
    });

    test('Generate slots from template', async () => {
      const template = await scheduler.createTaskTemplate({
        category: TaskCategory.FOOD,
        name: 'Daily Dinner',
        hoursRequired: 3,
        creditValue: 30,
        maxAssignees: 2,
        dayOfWeek: null, // Every day
        startHour: 17,
        durationHours: 3,
      });

      const weekStart = getNextMondayTimestamp();
      const slots = await scheduler.generateSlotsFromTemplate(template.id, weekStart);

      expect(slots.length).toBe(7); // One for each day
      expect(slots[0].category).toBe(TaskCategory.FOOD);
      expect(slots[0].status).toBe(TaskSlotStatus.OPEN);
    });

    test('Generate slots for specific day only', async () => {
      const template = await scheduler.createTaskTemplate({
        category: TaskCategory.GENERAL,
        name: 'Monday Meeting',
        hoursRequired: 1,
        creditValue: 10,
        maxAssignees: 5,
        dayOfWeek: 1, // Monday only
        startHour: 9,
        durationHours: 1,
      });

      const weekStart = getNextMondayTimestamp();
      const slots = await scheduler.generateSlotsFromTemplate(template.id, weekStart);

      expect(slots.length).toBe(1); // Only Monday
    });
  });

  describe('Task Slots', () => {
    test('Create task slot succeeds', async () => {
      const startTime = now() + (24 * 60 * 60 * 1000); // Tomorrow
      const slot = await scheduler.createTaskSlot({
        category: TaskCategory.MEDICAL,
        name: 'Health Check',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 40,
        maxAssignees: 1,
        description: 'Perform routine health checks',
      });

      expect(slot.id).toBeDefined();
      expect(slot.category).toBe(TaskCategory.MEDICAL);
      expect(slot.status).toBe(TaskSlotStatus.OPEN);
      expect(slot.assignments).toHaveLength(0);
    });

    test('Invalid time range rejected', async () => {
      const startTime = now();
      await expect(scheduler.createTaskSlot({
        category: TaskCategory.GENERAL,
        name: 'Bad Slot',
        startTime,
        endTime: startTime - 1000, // Before start
        hoursRequired: 1,
        creditValue: 10,
        maxAssignees: 1,
      })).rejects.toThrow('after start');
    });

    test('Get open slots by category', async () => {
      const startTime = now() + (24 * 60 * 60 * 1000);

      await scheduler.createTaskSlot({
        category: TaskCategory.FOOD,
        name: 'Food Task',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 1,
      });

      await scheduler.createTaskSlot({
        category: TaskCategory.MEDICAL,
        name: 'Medical Task',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 30,
        maxAssignees: 1,
      });

      const foodSlots = await scheduler.getOpenSlots(TaskCategory.FOOD);
      expect(foodSlots.length).toBe(1);
      expect(foodSlots[0].name).toBe('Food Task');
    });
  });

  describe('Assignment', () => {
    test('Assign member to slot succeeds', async () => {
      const startTime = now() + (24 * 60 * 60 * 1000);
      const slot = await scheduler.createTaskSlot({
        category: TaskCategory.GENERAL,
        name: 'General Task',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 2,
      });

      const assignment = await scheduler.assignMember(slot.id, 'alice', 1);

      expect(assignment.memberId).toBe('alice');
      expect(assignment.hoursAssigned).toBe(1);
      expect(assignment.status).toBe('ASSIGNED');

      const updatedSlot = await scheduler.getTaskSlot(slot.id);
      expect(updatedSlot?.status).toBe(TaskSlotStatus.PARTIALLY_FILLED);
    });

    test('SC-04: Assignment updates slot status to filled', async () => {
      const startTime = now() + (24 * 60 * 60 * 1000);
      const slot = await scheduler.createTaskSlot({
        category: TaskCategory.GENERAL,
        name: 'General Task',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 2,
      });

      await scheduler.assignMember(slot.id, 'alice', 1);
      await scheduler.assignMember(slot.id, 'bob', 1);

      const updatedSlot = await scheduler.getTaskSlot(slot.id);
      expect(updatedSlot?.status).toBe(TaskSlotStatus.FILLED);
    });

    test('Cannot assign same member twice', async () => {
      const startTime = now() + (24 * 60 * 60 * 1000);
      const slot = await scheduler.createTaskSlot({
        category: TaskCategory.GENERAL,
        name: 'Task',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 3,
      });

      await scheduler.assignMember(slot.id, 'alice', 1);

      await expect(scheduler.assignMember(slot.id, 'alice', 1))
        .rejects.toThrow('already assigned');
    });

    test('Cannot assign to full slot', async () => {
      const startTime = now() + (24 * 60 * 60 * 1000);
      const slot = await scheduler.createTaskSlot({
        category: TaskCategory.GENERAL,
        name: 'Task',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 1,
        creditValue: 10,
        maxAssignees: 1,
      });

      await scheduler.assignMember(slot.id, 'alice', 1);

      await expect(scheduler.assignMember(slot.id, 'bob', 1))
        .rejects.toThrow('FILLED');
    });

    test('Confirm assignment succeeds', async () => {
      const startTime = now() + (24 * 60 * 60 * 1000);
      const slot = await scheduler.createTaskSlot({
        category: TaskCategory.GENERAL,
        name: 'Task',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 1,
        creditValue: 10,
        maxAssignees: 1,
      });

      await scheduler.assignMember(slot.id, 'alice', 1);
      const confirmed = await scheduler.confirmAssignment(slot.id, 'alice');

      expect(confirmed.status).toBe('CONFIRMED');
      expect(confirmed.confirmedAt).toBeDefined();
    });

    test('Unassign member succeeds', async () => {
      const startTime = now() + (24 * 60 * 60 * 1000);
      const slot = await scheduler.createTaskSlot({
        category: TaskCategory.GENERAL,
        name: 'Task',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 2,
      });

      await scheduler.assignMember(slot.id, 'alice', 1);
      await scheduler.assignMember(slot.id, 'bob', 1);

      await scheduler.unassignMember(slot.id, 'alice');

      const updatedSlot = await scheduler.getTaskSlot(slot.id);
      expect(updatedSlot?.assignments.length).toBe(1);
      expect(updatedSlot?.status).toBe(TaskSlotStatus.PARTIALLY_FILLED);
    });
  });

  describe('Completion', () => {
    test('SC-05: Completion records correctly', async () => {
      const startTime = now() + (24 * 60 * 60 * 1000);
      const slot = await scheduler.createTaskSlot({
        category: TaskCategory.GENERAL,
        name: 'Task',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 1,
        creditValue: 10,
        maxAssignees: 1,
      });

      await scheduler.assignMember(slot.id, 'alice', 1);

      const result = await scheduler.recordCompletion(slot.id, 'alice', 5);

      expect(result.assignment.status).toBe('COMPLETED');
      expect(result.assignment.rating).toBe(5);
      expect(result.assignment.completedAt).toBeDefined();

      const updatedSlot = await scheduler.getTaskSlot(slot.id);
      expect(updatedSlot?.status).toBe(TaskSlotStatus.COMPLETED);
    });

    test('SC-06: No-show recorded correctly', async () => {
      const startTime = now() + (24 * 60 * 60 * 1000);
      const slot = await scheduler.createTaskSlot({
        category: TaskCategory.GENERAL,
        name: 'Task',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 1,
        creditValue: 10,
        maxAssignees: 1,
      });

      await scheduler.assignMember(slot.id, 'alice', 1);
      await scheduler.recordNoShow(slot.id, 'alice');

      const updatedSlot = await scheduler.getTaskSlot(slot.id);
      expect(updatedSlot?.assignments[0].status).toBe('NO_SHOW');
      expect(updatedSlot?.status).toBe(TaskSlotStatus.INCOMPLETE);
    });
  });

  describe('Matching', () => {
    test('SC-02: Matching assigns by skill', async () => {
      // Set up member supplies with different skills
      await scheduler.updateMemberSupply({
        memberId: 'alice',
        weeklyAvailableHours: 20,
        skills: new Map([[TaskCategory.FOOD, 0.9], [TaskCategory.MEDICAL, 0.3]]),
        preferences: [TaskCategory.FOOD],
        constraints: [],
        updatedAt: now(),
      });

      await scheduler.updateMemberSupply({
        memberId: 'bob',
        weeklyAvailableHours: 20,
        skills: new Map([[TaskCategory.FOOD, 0.4], [TaskCategory.MEDICAL, 0.8]]),
        preferences: [TaskCategory.MEDICAL],
        constraints: [],
        updatedAt: now(),
      });

      // Create slots
      const weekStart = getNextMondayTimestamp();
      const startTime = weekStart + (8 * 60 * 60 * 1000); // 8am Monday

      await scheduler.createTaskSlot({
        category: TaskCategory.FOOD,
        name: 'Cooking',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 1,
      });

      await scheduler.createTaskSlot({
        category: TaskCategory.MEDICAL,
        name: 'Health Check',
        startTime: startTime + (3 * 60 * 60 * 1000),
        endTime: startTime + (5 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 30,
        maxAssignees: 1,
      });

      const result = await scheduler.runMatching(weekStart);

      // Alice should be assigned to FOOD (higher skill)
      // Bob should be assigned to MEDICAL (higher skill)
      expect(result.assignments.length).toBe(2);
      expect(result.coverageAchieved).toBe(1);
    });

    test('SC-03: Debtor priority increases assignment', async () => {
      // Give alice negative balance (debtor)
      await ledger.applyBalanceUpdates([
        { memberId: 'alice', delta: -80, reason: 'SPOT_TRANSACTION_PAYER' as any },
        { memberId: 'bob', delta: 80, reason: 'SPOT_TRANSACTION_PAYEE' as any },
      ]);

      // Set up equal supplies
      await scheduler.updateMemberSupply({
        memberId: 'alice',
        weeklyAvailableHours: 20,
        skills: new Map([[TaskCategory.GENERAL, 0.5]]),
        preferences: [],
        constraints: [],
        updatedAt: now(),
      });

      await scheduler.updateMemberSupply({
        memberId: 'bob',
        weeklyAvailableHours: 20,
        skills: new Map([[TaskCategory.GENERAL, 0.5]]),
        preferences: [],
        constraints: [],
        updatedAt: now(),
      });

      // Create one slot
      const weekStart = getNextMondayTimestamp();
      const startTime = weekStart + (8 * 60 * 60 * 1000);

      await scheduler.createTaskSlot({
        category: TaskCategory.GENERAL,
        name: 'Task',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 1,
      });

      // Enable debtor priority
      scheduler.enableDebtorPriorityMatching();
      expect(scheduler.isDebtorPriorityEnabled()).toBe(true);

      const result = await scheduler.runMatching(weekStart);

      // Alice (debtor) should be assigned due to priority
      expect(result.assignments.length).toBe(1);
      expect(result.assignments[0].memberId).toBe('alice');
    });
  });

  describe('Coverage', () => {
    test('SC-01: Feasibility check identifies gaps', async () => {
      // Set up limited member supply
      await scheduler.updateMemberSupply({
        memberId: 'alice',
        weeklyAvailableHours: 10,
        skills: new Map([[TaskCategory.FOOD, 0.8]]),
        preferences: [],
        constraints: [],
        updatedAt: now(),
      });

      // Create more demand than supply
      const weekStart = getNextMondayTimestamp();
      const startTime = weekStart + (8 * 60 * 60 * 1000);

      await scheduler.createTaskSlot({
        category: TaskCategory.FOOD,
        name: 'Breakfast',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 20, // More than available
        creditValue: 100,
        maxAssignees: 4,
      });

      const feasibility = await scheduler.checkCoverageFeasibility(weekStart);

      expect(feasibility.feasible).toBe(false);
      expect(feasibility.totalRequired).toBe(20);
      expect(feasibility.bottlenecks.length).toBeGreaterThan(0);
      expect(feasibility.recommendations.length).toBeGreaterThan(0);
    });

    test('Coverage report calculates correctly', async () => {
      const weekStart = getNextMondayTimestamp();
      const startTime = weekStart + (8 * 60 * 60 * 1000);

      const slot = await scheduler.createTaskSlot({
        category: TaskCategory.FOOD,
        name: 'Cooking',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 1,
      });

      await scheduler.assignMember(slot.id, 'alice', 2);
      await scheduler.recordCompletion(slot.id, 'alice', 5);

      const report = await scheduler.getCoverageReport(weekStart);

      expect(report.totalSlots).toBe(1);
      expect(report.filledSlots).toBe(1);
      expect(report.overallCoverage).toBe(1);
      expect(report.totalHoursCompleted).toBe(2);
    });
  });

  describe('Member Schedule', () => {
    test('Get member schedule returns assigned slots', async () => {
      const weekStart = getNextMondayTimestamp();
      const startTime = weekStart + (8 * 60 * 60 * 1000);

      const slot1 = await scheduler.createTaskSlot({
        category: TaskCategory.FOOD,
        name: 'Breakfast',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 1,
      });

      const slot2 = await scheduler.createTaskSlot({
        category: TaskCategory.GENERAL,
        name: 'Other',
        startTime: startTime + (4 * 60 * 60 * 1000),
        endTime: startTime + (6 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 1,
      });

      await scheduler.assignMember(slot1.id, 'alice', 2);
      await scheduler.assignMember(slot2.id, 'bob', 2);

      const aliceSchedule = await scheduler.getMemberSchedule('alice', weekStart);
      expect(aliceSchedule.length).toBe(1);
      expect(aliceSchedule[0].id).toBe(slot1.id);
    });
  });

  describe('Debtor Priority', () => {
    test('Debtor priority can be toggled', () => {
      expect(scheduler.isDebtorPriorityEnabled()).toBe(false);

      scheduler.enableDebtorPriorityMatching();
      expect(scheduler.isDebtorPriorityEnabled()).toBe(true);

      scheduler.disableDebtorPriorityMatching();
      expect(scheduler.isDebtorPriorityEnabled()).toBe(false);
    });
  });
});

// Helper function to get next Monday timestamp
function getNextMondayTimestamp(): number {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilMonday = (8 - dayOfWeek) % 7 || 7; // If today is Monday, go to next Monday
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysUntilMonday);
  nextMonday.setHours(0, 0, 0, 0);
  return nextMonday.getTime();
}
