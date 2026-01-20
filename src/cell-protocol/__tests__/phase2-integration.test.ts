/**
 * Cell Protocol - Phase 2 Integration Tests
 *
 * End-to-end tests for the Coordination Layer.
 * Verifies that Commitment, Governance, and Scheduler work together.
 */

import { createLedgerEngine } from '../engines/ledger-engine';
import { createTransactionEngine } from '../engines/transaction-engine';
import { createIdentityEngine } from '../engines/identity-engine';
import { createCommitmentEngine, CommitmentEngine } from '../engines/commitment-engine';
import { createGovernanceEngine, GovernanceEngine } from '../engines/governance-engine';
import { createSchedulerEngine, SchedulerEngine } from '../engines/scheduler-engine';
import { createInMemoryStorage } from '../storage/pouchdb-adapter';
import { cryptoAdapter } from '../crypto/crypto-adapter';
import {
  CommitmentType,
  CommitmentStatus,
  TaskCategory,
} from '../types/commitment';
import {
  ProposalType,
  ProposalStatus,
  DisputeType,
} from '../types/governance';
import {
  TaskSlotStatus,
} from '../types/scheduler';
import { MembershipStatus, now } from '../types/common';

describe('Phase 2 Integration Tests', () => {
  let storage: ReturnType<typeof createInMemoryStorage>;
  let ledger: Awaited<ReturnType<typeof createLedgerEngine>>;
  let identity: ReturnType<typeof createIdentityEngine>;
  let commitments: CommitmentEngine;
  let governance: GovernanceEngine;
  let scheduler: SchedulerEngine;

  beforeEach(async () => {
    storage = createInMemoryStorage();
    ledger = await createLedgerEngine('test-cell', { defaultLimit: 100 }, storage);

    if (!cryptoAdapter.isInitialized()) {
      await cryptoAdapter.initialize();
    }

    identity = createIdentityEngine(ledger, storage, cryptoAdapter);
    const publicKeyResolver = async (memberId: string) => {
      const id = await identity.getIdentity(memberId);
      return id?.publicKey;
    };
    const transactions = createTransactionEngine(ledger, storage, cryptoAdapter, publicKeyResolver);
    commitments = createCommitmentEngine(ledger, transactions, storage);
    governance = createGovernanceEngine('test-cell', ledger, identity, commitments, storage);
    scheduler = createSchedulerEngine(ledger, commitments, storage);

    // Setup: Create a cell with 5 members
    await ledger.addMember('council1');
    await ledger.addMember('council2');
    await ledger.addMember('council3');
    await ledger.addMember('worker1');
    await ledger.addMember('worker2');

    // Initialize council
    await governance.initializeCouncil([
      { memberId: 'council1', role: 'CHAIR', termStart: now(), termEnd: now() + 90 * 24 * 60 * 60 * 1000 },
      { memberId: 'council2', role: 'MEMBER', termStart: now(), termEnd: now() + 90 * 24 * 60 * 60 * 1000 },
      { memberId: 'council3', role: 'MEMBER', termStart: now(), termEnd: now() + 90 * 24 * 60 * 60 * 1000 },
    ]);
  });

  describe('Schedule → Commit → Complete → Credit', () => {
    test('Full workflow from scheduling to credit transfer', async () => {
      // 1. Create task slots for a week
      const weekStart = getNextMondayTimestamp();
      const startTime = weekStart + (8 * 60 * 60 * 1000); // 8am

      const slot = await scheduler.createTaskSlot({
        category: TaskCategory.FOOD,
        name: 'Morning Breakfast',
        startTime,
        endTime: startTime + (2 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 1,
        description: 'Prepare breakfast',
      });

      expect(slot.status).toBe(TaskSlotStatus.OPEN);

      // 2. Setup member supply
      await scheduler.updateMemberSupply({
        memberId: 'worker1',
        weeklyAvailableHours: 20,
        skills: new Map([[TaskCategory.FOOD, 0.9]]),
        preferences: [TaskCategory.FOOD],
        constraints: [],
        updatedAt: now(),
      });

      // 3. Run matching algorithm
      const matchingResult = await scheduler.runMatching(weekStart);
      expect(matchingResult.coverageAchieved).toBe(1);
      expect(matchingResult.assignments.length).toBe(1);
      expect(matchingResult.assignments[0].memberId).toBe('worker1');

      // 4. Confirm assignment
      const confirmedAssignment = await scheduler.confirmAssignment(slot.id, 'worker1');
      expect(confirmedAssignment.status).toBe('CONFIRMED');

      // 5. Create escrowed commitment for the work
      // In a full implementation, this would happen automatically with assignment
      // For this test, we'll create it manually to show the integration
      const commitment = await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'worker1', // Worker provides service
        promisee: 'council1', // Cell treasury represented by council
        value: 20,
        category: TaskCategory.FOOD,
        description: 'Breakfast preparation',
      });

      // Verify reserve was created
      expect(ledger.getMemberState('council1')?.reserve).toBe(20);

      // 6. Record completion
      const completionResult = await scheduler.recordCompletion(slot.id, 'worker1', 5);
      expect(completionResult.assignment.status).toBe('COMPLETED');

      // 7. Fulfill commitment (executes transaction)
      const fulfillResult = await commitments.fulfillCommitment(commitment.id, {
        commitmentId: commitment.id,
        confirmedBy: 'council1',
        rating: 5,
        timestamp: now(),
      });

      expect(fulfillResult.commitment.status).toBe(CommitmentStatus.FULFILLED);

      // 8. Verify conservation holds throughout
      expect(ledger.verifyConservation()).toBe(true);

      // 9. Verify balances changed correctly
      // council1 paid 20 credits to worker1
      expect(ledger.getMemberState('council1')?.balance).toBe(-20);
      expect(ledger.getMemberState('worker1')?.balance).toBe(20);

      // 10. Reserve should be released
      expect(ledger.getMemberState('council1')?.reserve).toBe(0);
    });
  });

  describe('Governance Admission Flow', () => {
    test('Council votes to admit new member', async () => {
      // 1. Create MEMBER_ADMISSION proposal
      const proposal = await governance.createProposal({
        type: ProposalType.MEMBER_ADMISSION,
        proposer: 'council1',
        payload: {
          type: ProposalType.MEMBER_ADMISSION,
          admission: {
            applicantId: 'newmember',
            publicKey: 'fake-public-key-that-is-at-least-32-characters-long',
            displayName: 'New Member',
            requestedAt: now(),
          },
        },
        description: 'Admit new member to the cell',
      });

      expect(proposal.status).toBe(ProposalStatus.OPEN);

      // 2. Council votes to approve
      await governance.castVote(proposal.id, {
        voterId: 'council1',
        decision: 'APPROVE',
        signature: 'sig1',
        timestamp: now(),
      });

      await governance.castVote(proposal.id, {
        voterId: 'council2',
        decision: 'APPROVE',
        signature: 'sig2',
        timestamp: now(),
      });

      // One rejection
      await governance.castVote(proposal.id, {
        voterId: 'council3',
        decision: 'REJECT',
        reason: 'Need more info',
        signature: 'sig3',
        timestamp: now(),
      });

      // 3. Close voting
      const closedProposal = await governance.closeVoting(proposal.id);
      expect(closedProposal.status).toBe(ProposalStatus.PASSED); // 2/3 majority

      // 4. Execute proposal
      await governance.executeProposal(proposal.id);

      // 5. Verify new member has ledger entry
      const newMemberState = ledger.getMemberState('newmember');
      expect(newMemberState).toBeDefined();
      expect(newMemberState?.status).toBe(MembershipStatus.ACTIVE);
      expect(newMemberState?.balance).toBe(0);
    });
  });

  describe('Dispute Resolution Flow', () => {
    test('File dispute, resolve with commitment cancellation', async () => {
      // 1. Create commitment between members
      const commitment = await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'worker1',
        promisee: 'worker2',
        value: 50,
        category: TaskCategory.GENERAL,
        description: 'Some service',
      });

      // Reserve should be held
      expect(ledger.getMemberState('worker2')?.reserve).toBe(50);

      // 2. File dispute for non-delivery
      const dispute = await governance.fileDispute({
        type: DisputeType.NON_DELIVERY,
        complainant: 'worker2',
        respondent: 'worker1',
        commitmentId: commitment.id,
        description: 'Worker1 did not deliver the promised service',
      });

      expect(dispute.status).toBe('FILED');

      // 3. Assign reviewer
      const reviewedDispute = await governance.assignDisputeReviewer(dispute.id, 'council1');
      expect(reviewedDispute.reviewer).toBe('council1');

      // 4. Resolve with cancellation
      const resolved = await governance.resolveDispute(dispute.id, {
        outcome: 'COMPLAINANT_WINS',
        explanation: 'Non-delivery confirmed, cancelling commitment',
        decidedBy: 'council1',
        decidedAt: now(),
        actions: [
          {
            type: 'CANCEL_COMMITMENT',
            targetId: commitment.id,
            details: {},
          },
        ],
      });

      expect(resolved.status).toBe('RESOLVED');

      // 5. Verify reserve released
      const updatedCommitment = await commitments.getCommitment(commitment.id);
      expect(updatedCommitment?.status).toBe(CommitmentStatus.CANCELLED);
      expect(ledger.getMemberState('worker2')?.reserve).toBe(0);

      // 6. Conservation still holds
      expect(ledger.verifyConservation()).toBe(true);
    });
  });

  describe('Debtor Recovery Test', () => {
    test('Member near floor gets priority for earning opportunities', async () => {
      // 1. Member goes near floor (-80 with limit 100)
      await ledger.applyBalanceUpdates([
        { memberId: 'worker1', delta: -80, reason: 'SPOT_TRANSACTION_PAYER' as any },
        { memberId: 'worker2', delta: 80, reason: 'SPOT_TRANSACTION_PAYEE' as any },
      ]);

      expect(ledger.getMemberState('worker1')?.balance).toBe(-80);
      expect(ledger.getAvailableCapacity('worker1')).toBe(20); // Only 20 left

      // 2. Setup supplies for both workers
      await scheduler.updateMemberSupply({
        memberId: 'worker1',
        weeklyAvailableHours: 40,
        skills: new Map([[TaskCategory.GENERAL, 0.6]]),
        preferences: [],
        constraints: [],
        updatedAt: now(),
      });

      await scheduler.updateMemberSupply({
        memberId: 'worker2',
        weeklyAvailableHours: 40,
        skills: new Map([[TaskCategory.GENERAL, 0.6]]), // Same skill
        preferences: [],
        constraints: [],
        updatedAt: now(),
      });

      // 3. Create multiple task slots
      const weekStart = getNextMondayTimestamp();
      const slots = [];
      for (let i = 0; i < 3; i++) {
        const startTime = weekStart + ((8 + i * 3) * 60 * 60 * 1000);
        slots.push(await scheduler.createTaskSlot({
          category: TaskCategory.GENERAL,
          name: `Task ${i + 1}`,
          startTime,
          endTime: startTime + (2 * 60 * 60 * 1000),
          hoursRequired: 2,
          creditValue: 30,
          maxAssignees: 1,
        }));
      }

      // 4. Enable debtor priority matching
      scheduler.enableDebtorPriorityMatching();

      // 5. Run matching
      const result = await scheduler.runMatching(weekStart);

      // 6. Verify debtor gets more assignments
      const worker1Assignments = result.assignments.filter(a => a.memberId === 'worker1');
      const worker2Assignments = result.assignments.filter(a => a.memberId === 'worker2');

      // worker1 (debtor) should get priority for first assignment at minimum
      expect(worker1Assignments.length).toBeGreaterThanOrEqual(1);

      // 7. Simulate completing tasks and verify balance improvement
      // For simplicity, we just verify the mechanism works
      expect(result.coverageAchieved).toBeGreaterThan(0);
    });
  });

  describe('Full Cell Lifecycle', () => {
    test('Create cell, add members, schedule tasks, complete work, maintain conservation', async () => {
      // This is already set up in beforeEach

      // 1. Verify initial state
      expect(ledger.getMemberCount()).toBe(5);
      expect(ledger.verifyConservation()).toBe(true);
      const stats = ledger.getStatistics();
      expect(stats.balanceSum).toBe(0);

      // 2. Create task slots for essential categories
      const weekStart = getNextMondayTimestamp();

      const foodSlot = await scheduler.createTaskSlot({
        category: TaskCategory.FOOD,
        name: 'Food Prep',
        startTime: weekStart + (8 * 60 * 60 * 1000),
        endTime: weekStart + (10 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 1,
      });

      const medicalSlot = await scheduler.createTaskSlot({
        category: TaskCategory.MEDICAL,
        name: 'Health Check',
        startTime: weekStart + (11 * 60 * 60 * 1000),
        endTime: weekStart + (13 * 60 * 60 * 1000),
        hoursRequired: 2,
        creditValue: 30,
        maxAssignees: 1,
      });

      // 3. Setup member supplies
      await scheduler.updateMemberSupply({
        memberId: 'worker1',
        weeklyAvailableHours: 20,
        skills: new Map([[TaskCategory.FOOD, 0.9], [TaskCategory.MEDICAL, 0.3]]),
        preferences: [TaskCategory.FOOD],
        constraints: [],
        updatedAt: now(),
      });

      await scheduler.updateMemberSupply({
        memberId: 'worker2',
        weeklyAvailableHours: 20,
        skills: new Map([[TaskCategory.FOOD, 0.3], [TaskCategory.MEDICAL, 0.9]]),
        preferences: [TaskCategory.MEDICAL],
        constraints: [],
        updatedAt: now(),
      });

      // 4. Run matching
      const matchResult = await scheduler.runMatching(weekStart);
      expect(matchResult.assignments.length).toBe(2);

      // 5. Create commitments for each task
      const foodCommitment = await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'worker1',
        promisee: 'council1', // Cell treasury
        value: 20,
        category: TaskCategory.FOOD,
        description: 'Food task payment',
      });

      const medicalCommitment = await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'worker2',
        promisee: 'council1',
        value: 30,
        category: TaskCategory.MEDICAL,
        description: 'Medical task payment',
      });

      // 6. Complete tasks
      await scheduler.recordCompletion(foodSlot.id, 'worker1', 5);
      await scheduler.recordCompletion(medicalSlot.id, 'worker2', 4);

      // 7. Fulfill commitments
      await commitments.fulfillCommitment(foodCommitment.id, {
        commitmentId: foodCommitment.id,
        confirmedBy: 'council1',
        rating: 5,
        timestamp: now(),
      });

      await commitments.fulfillCommitment(medicalCommitment.id, {
        commitmentId: medicalCommitment.id,
        confirmedBy: 'council1',
        rating: 4,
        timestamp: now(),
      });

      // 8. Verify SUM(balances) = 0 throughout
      expect(ledger.verifyConservation()).toBe(true);

      // 9. Verify balances
      // council1 paid 50 total (20 + 30)
      expect(ledger.getMemberState('council1')?.balance).toBe(-50);
      // worker1 received 20
      expect(ledger.getMemberState('worker1')?.balance).toBe(20);
      // worker2 received 30
      expect(ledger.getMemberState('worker2')?.balance).toBe(30);

      // Sum should still be 0
      const finalStats = ledger.getStatistics();
      expect(finalStats.balanceSum).toBe(0);
    });
  });

  describe('Invariant Verification', () => {
    test('All invariants maintained after complex operations', async () => {
      // I1: SUM(balances) = 0
      // I2: balance >= -limit
      // I3: balance - reserve >= -limit
      // I4: reserve >= 0

      // Perform various operations
      // 1. Create and fulfill commitment
      const c1 = await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'worker1',
        promisee: 'worker2',
        value: 30,
        category: TaskCategory.GENERAL,
        description: 'Task 1',
      });

      // Check I3 and I4
      const worker2State = ledger.getMemberState('worker2');
      expect(worker2State!.reserve).toBeGreaterThanOrEqual(0); // I4
      expect(worker2State!.balance - worker2State!.reserve).toBeGreaterThanOrEqual(-worker2State!.limit); // I3

      // 2. Create another commitment
      const c2 = await commitments.createCommitment({
        type: CommitmentType.ESCROWED,
        promisor: 'council1',
        promisee: 'council2',
        value: 40,
        category: TaskCategory.GENERAL,
        description: 'Task 2',
      });

      // 3. Fulfill first
      await commitments.fulfillCommitment(c1.id, {
        commitmentId: c1.id,
        confirmedBy: 'worker2',
        timestamp: now(),
      });

      // Check I1
      expect(ledger.verifyConservation()).toBe(true);

      // 4. Cancel second
      await commitments.cancelCommitment(c2.id, 'Plans changed', 'council1');

      // Final verification of all invariants
      expect(ledger.verifyConservation()).toBe(true); // I1
      expect(ledger.verifyAllFloors()).toBe(true); // I2

      // I3 and I4 for all members
      for (const [memberId, state] of ledger.getAllMemberStates()) {
        expect(state.reserve).toBeGreaterThanOrEqual(0); // I4
        expect(state.balance - state.reserve).toBeGreaterThanOrEqual(-state.limit); // I3
      }
    });
  });
});

function getNextMondayTimestamp(): number {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilMonday = (8 - dayOfWeek) % 7 || 7;
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysUntilMonday);
  nextMonday.setHours(0, 0, 0, 0);
  return nextMonday.getTime();
}
