/**
 * Cell Protocol - Scheduler Engine
 *
 * Implementation of the Survival Scheduler (PRD-08).
 * Manages task scheduling, matching, and coverage.
 */

import {
  IdentityId,
  Timestamp,
  Units,
  MembershipStatus,
  now,
  generateId,
} from '../types/common';
import {
  TaskCategory,
  CommitmentType,
} from '../types/commitment';
import {
  TaskSlotId,
  TaskTemplateId,
  TaskSlotStatus,
  TaskSlot,
  TaskTemplate,
  TaskAssignment,
  MemberSupply,
  FeasibilityResult,
  MatchingResult,
  CoverageReport,
  CategoryCoverage,
  CreateSlotInput,
  CreateTemplateInput,
  SchedulerError,
  SchedulerErrorCode,
  ISchedulerEngine,
} from '../types/scheduler';
import { LedgerEngine } from './ledger-engine';
import { CommitmentEngine } from './commitment-engine';
import { IStorage } from '../storage/pouchdb-adapter';

// ============================================
// SCHEDULER ENGINE IMPLEMENTATION
// ============================================

export class SchedulerEngine implements ISchedulerEngine {
  private ledger: LedgerEngine;
  private commitments: CommitmentEngine;
  private storage: IStorage;
  private debtorPriorityEnabled = false;

  constructor(
    ledger: LedgerEngine,
    commitments: CommitmentEngine,
    storage: IStorage
  ) {
    this.ledger = ledger;
    this.commitments = commitments;
    this.storage = storage;
  }

  // ============================================
  // TEMPLATES
  // ============================================

  async createTaskTemplate(input: CreateTemplateInput): Promise<TaskTemplate> {
    const template: TaskTemplate = {
      id: generateId(),
      category: input.category,
      name: input.name,
      hoursRequired: input.hoursRequired,
      creditValue: input.creditValue,
      maxAssignees: input.maxAssignees,
      dayOfWeek: input.dayOfWeek,
      startHour: input.startHour,
      durationHours: input.durationHours,
      active: true,
      description: input.description,
    };

    const result = await this.storage.saveTaskTemplate(template);
    if (!result.ok) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }

    return template;
  }

  async getTaskTemplate(id: TaskTemplateId): Promise<TaskTemplate | undefined> {
    const result = await this.storage.getTaskTemplate(id);
    if (!result.ok) return undefined;
    return result.value ?? undefined;
  }

  async generateSlotsFromTemplate(templateId: TaskTemplateId, weekStart: Timestamp): Promise<TaskSlot[]> {
    const template = await this.getTaskTemplate(templateId);
    if (!template) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.TEMPLATE_NOT_FOUND,
        message: `Template ${templateId} not found`,
      });
    }

    const slots: TaskSlot[] = [];
    const weekStartDate = new Date(weekStart);

    // Generate slots for each day in the week
    for (let day = 0; day < 7; day++) {
      // If template is for specific day, only generate for that day
      if (template.dayOfWeek !== null && template.dayOfWeek !== undefined && template.dayOfWeek !== day) {
        continue;
      }

      const slotDate = new Date(weekStartDate);
      slotDate.setDate(slotDate.getDate() + day);
      slotDate.setHours(template.startHour, 0, 0, 0);

      const startTime = slotDate.getTime();
      const endTime = startTime + (template.durationHours * 60 * 60 * 1000);

      const slot: TaskSlot = {
        id: generateId(),
        category: template.category,
        name: template.name,
        startTime,
        endTime,
        hoursRequired: template.hoursRequired,
        creditValue: template.creditValue,
        maxAssignees: template.maxAssignees,
        status: TaskSlotStatus.OPEN,
        assignments: [],
        templateId,
        description: template.description,
      };

      const saveResult = await this.storage.saveTaskSlot(slot);
      if (saveResult.ok) {
        slots.push(slot);
      }
    }

    return slots;
  }

  async getActiveTemplates(): Promise<TaskTemplate[]> {
    const result = await this.storage.getAllTaskTemplates();
    if (!result.ok) return [];
    return result.value.filter(t => t.active);
  }

  // ============================================
  // SLOTS
  // ============================================

  async createTaskSlot(input: CreateSlotInput): Promise<TaskSlot> {
    if (input.endTime <= input.startTime) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.INVALID_TIME_RANGE,
        message: 'End time must be after start time',
      });
    }

    if (input.hoursRequired <= 0) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.INVALID_HOURS,
        message: 'Hours required must be positive',
      });
    }

    const slot: TaskSlot = {
      id: generateId(),
      category: input.category,
      name: input.name,
      startTime: input.startTime,
      endTime: input.endTime,
      hoursRequired: input.hoursRequired,
      creditValue: input.creditValue,
      maxAssignees: input.maxAssignees,
      status: TaskSlotStatus.OPEN,
      assignments: [],
      description: input.description,
    };

    const result = await this.storage.saveTaskSlot(slot);
    if (!result.ok) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }

    return slot;
  }

  async getTaskSlot(id: TaskSlotId): Promise<TaskSlot | undefined> {
    const result = await this.storage.getTaskSlot(id);
    if (!result.ok) return undefined;
    return result.value ?? undefined;
  }

  async getOpenSlots(category?: TaskCategory): Promise<TaskSlot[]> {
    const result = await this.storage.getTaskSlotsByStatus(TaskSlotStatus.OPEN);
    if (!result.ok) return [];

    let slots = result.value;
    if (category) {
      slots = slots.filter(s => s.category === category);
    }

    return slots;
  }

  async getSlotsByPeriod(start: Timestamp, end: Timestamp): Promise<TaskSlot[]> {
    const result = await this.storage.getTaskSlotsByPeriod(start, end);
    if (!result.ok) return [];
    return result.value;
  }

  // ============================================
  // ASSIGNMENT
  // ============================================

  async runMatching(weekStart: Timestamp): Promise<MatchingResult> {
    const weekEnd = weekStart + (7 * 24 * 60 * 60 * 1000);
    const slots = await this.getSlotsByPeriod(weekStart, weekEnd);
    const openSlots = slots.filter(s =>
      s.status === TaskSlotStatus.OPEN || s.status === TaskSlotStatus.PARTIALLY_FILLED
    );

    const suppliesResult = await this.storage.getAllMemberSupplies();
    const supplies = suppliesResult.ok ? suppliesResult.value : [];

    const assignments: TaskAssignment[] = [];
    const unfilledSlots: TaskSlotId[] = [];
    const assignedMembers = new Set<IdentityId>();

    // Sort slots by category priority (essential first)
    const categoryPriority: TaskCategory[] = [
      TaskCategory.MEDICAL,
      TaskCategory.FOOD,
      TaskCategory.WATER_SANITATION,
      TaskCategory.ENERGY_HEAT,
      TaskCategory.CHILDCARE_DEPENDENT,
      TaskCategory.SECURITY_COORDINATION,
      TaskCategory.SHELTER_REPAIR,
      TaskCategory.PROCUREMENT_TRANSPORT,
      TaskCategory.GENERAL,
    ];

    openSlots.sort((a, b) => {
      const aIdx = categoryPriority.indexOf(a.category);
      const bIdx = categoryPriority.indexOf(b.category);
      return aIdx - bIdx;
    });

    for (const slot of openSlots) {
      const neededAssignees = slot.maxAssignees - slot.assignments.length;
      if (neededAssignees <= 0) continue;

      // Score and rank candidates
      const candidates = supplies
        .filter(s => !assignedMembers.has(s.memberId))
        .filter(s => {
          const state = this.ledger.getMemberState(s.memberId);
          return state && state.status === MembershipStatus.ACTIVE;
        })
        .map(s => ({
          supply: s,
          score: this.scoreCandidate(s, slot),
        }))
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score);

      // Assign top candidates
      for (let i = 0; i < Math.min(neededAssignees, candidates.length); i++) {
        const candidate = candidates[i];
        try {
          const assignment = await this.assignMember(
            slot.id,
            candidate.supply.memberId,
            slot.hoursRequired / slot.maxAssignees
          );
          assignments.push(assignment);
          assignedMembers.add(candidate.supply.memberId);
        } catch (e) {
          // Skip if assignment fails
        }
      }

      // Check if slot is still unfilled
      const updatedSlot = await this.getTaskSlot(slot.id);
      if (updatedSlot && updatedSlot.assignments.length < updatedSlot.maxAssignees) {
        unfilledSlots.push(slot.id);
      }
    }

    // Find members who weren't assigned
    const unassignedMembers = supplies
      .filter(s => !assignedMembers.has(s.memberId))
      .map(s => s.memberId);

    // Calculate coverage
    const totalSlots = openSlots.length;
    const filledSlots = totalSlots - unfilledSlots.length;
    const coverageAchieved = totalSlots > 0 ? filledSlots / totalSlots : 1;

    return {
      assignments,
      unfilledSlots,
      unassignedMembers,
      coverageAchieved,
      matchingScore: coverageAchieved,
    };
  }

  private scoreCandidate(member: MemberSupply, slot: TaskSlot): number {
    const effectiveness = member.skills.get(slot.category) ?? 0.5;
    const preference = member.preferences.includes(slot.category) ? 1 : 0;

    // Debtor priority: members with negative balance get priority for earning
    let debtorScore = 0;
    if (this.debtorPriorityEnabled) {
      const state = this.ledger.getMemberState(member.memberId);
      if (state && state.balance < 0) {
        // Higher score for members closer to floor
        debtorScore = (-state.balance / state.limit) * 2; // 0-2 range
      }
    }

    return effectiveness * 0.4 + preference * 0.2 + debtorScore * 0.4;
  }

  async assignMember(slotId: TaskSlotId, memberId: IdentityId, hours: number): Promise<TaskAssignment> {
    const slot = await this.getTaskSlot(slotId);
    if (!slot) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.SLOT_NOT_FOUND,
        message: `Slot ${slotId} not found`,
      });
    }

    if (slot.status !== TaskSlotStatus.OPEN && slot.status !== TaskSlotStatus.PARTIALLY_FILLED) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.INVALID_SLOT_STATUS,
        message: `Cannot assign to slot in status ${slot.status}`,
      });
    }

    if (slot.assignments.length >= slot.maxAssignees) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.SLOT_FULL,
        message: 'Slot is full',
      });
    }

    // Check if member already assigned
    if (slot.assignments.some(a => a.memberId === memberId)) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.ALREADY_ASSIGNED,
        message: `Member ${memberId} already assigned to slot`,
      });
    }

    // Validate member
    const memberState = this.ledger.getMemberState(memberId);
    if (!memberState || memberState.status !== MembershipStatus.ACTIVE) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.MEMBER_NOT_FOUND,
        message: `Member ${memberId} not found or not active`,
      });
    }

    // Calculate credit value for this assignment
    const creditValue = Math.floor((hours / slot.hoursRequired) * slot.creditValue);

    // Create escrowed commitment for the assignment
    // The cell (represented by a system account or pool) is the promisee
    // For simplicity, we'll skip commitment creation here and handle it differently
    // In a real implementation, there would be a cell treasury or pool account

    const assignment: TaskAssignment = {
      slotId,
      memberId,
      hoursAssigned: hours,
      status: 'ASSIGNED',
      assignedAt: now(),
    };

    slot.assignments.push(assignment);

    // Update slot status
    if (slot.assignments.length >= slot.maxAssignees) {
      slot.status = TaskSlotStatus.FILLED;
    } else {
      slot.status = TaskSlotStatus.PARTIALLY_FILLED;
    }

    await this.storage.saveTaskSlot(slot);

    await this.storage.appendEvent({
      cellId: this.ledger.getCellId(),
      type: 'MEMBER_ASSIGNED_TO_SLOT',
      timestamp: now(),
      data: { slotId, memberId, hours },
    });

    return assignment;
  }

  async confirmAssignment(slotId: TaskSlotId, memberId: IdentityId): Promise<TaskAssignment> {
    const slot = await this.getTaskSlot(slotId);
    if (!slot) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.SLOT_NOT_FOUND,
        message: `Slot ${slotId} not found`,
      });
    }

    const assignment = slot.assignments.find(a => a.memberId === memberId);
    if (!assignment) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.NOT_ASSIGNED,
        message: `Member ${memberId} not assigned to slot`,
      });
    }

    assignment.status = 'CONFIRMED';
    assignment.confirmedAt = now();

    await this.storage.saveTaskSlot(slot);

    return assignment;
  }

  async unassignMember(slotId: TaskSlotId, memberId: IdentityId): Promise<void> {
    const slot = await this.getTaskSlot(slotId);
    if (!slot) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.SLOT_NOT_FOUND,
        message: `Slot ${slotId} not found`,
      });
    }

    const assignmentIndex = slot.assignments.findIndex(a => a.memberId === memberId);
    if (assignmentIndex === -1) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.NOT_ASSIGNED,
        message: `Member ${memberId} not assigned to slot`,
      });
    }

    // Cancel associated commitment if any
    const assignment = slot.assignments[assignmentIndex];
    if (assignment.commitmentId) {
      await this.commitments.cancelCommitment(
        assignment.commitmentId,
        'Unassigned from slot',
        memberId
      );
    }

    slot.assignments.splice(assignmentIndex, 1);

    // Update slot status
    if (slot.assignments.length === 0) {
      slot.status = TaskSlotStatus.OPEN;
    } else if (slot.assignments.length < slot.maxAssignees) {
      slot.status = TaskSlotStatus.PARTIALLY_FILLED;
    }

    await this.storage.saveTaskSlot(slot);

    await this.storage.appendEvent({
      cellId: this.ledger.getCellId(),
      type: 'MEMBER_UNASSIGNED_FROM_SLOT',
      timestamp: now(),
      data: { slotId, memberId },
    });
  }

  // ============================================
  // COMPLETION
  // ============================================

  async recordCompletion(
    slotId: TaskSlotId,
    memberId: IdentityId,
    rating?: number
  ): Promise<{ assignment: TaskAssignment; payerNewBalance?: Units; payeeNewBalance?: Units }> {
    const slot = await this.getTaskSlot(slotId);
    if (!slot) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.SLOT_NOT_FOUND,
        message: `Slot ${slotId} not found`,
      });
    }

    const assignment = slot.assignments.find(a => a.memberId === memberId);
    if (!assignment) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.NOT_ASSIGNED,
        message: `Member ${memberId} not assigned to slot`,
      });
    }

    assignment.status = 'COMPLETED';
    assignment.completedAt = now();
    if (rating !== undefined) {
      assignment.rating = rating;
    }

    // Check if all assignments are complete
    const allComplete = slot.assignments.every(a => a.status === 'COMPLETED' || a.status === 'NO_SHOW');
    if (allComplete) {
      slot.status = TaskSlotStatus.COMPLETED;
    } else {
      slot.status = TaskSlotStatus.IN_PROGRESS;
    }

    await this.storage.saveTaskSlot(slot);

    await this.storage.appendEvent({
      cellId: this.ledger.getCellId(),
      type: 'TASK_COMPLETED',
      timestamp: now(),
      data: { slotId, memberId, rating },
    });

    // If there's a linked commitment, fulfill it
    if (assignment.commitmentId) {
      const result = await this.commitments.fulfillCommitment(assignment.commitmentId, {
        commitmentId: assignment.commitmentId,
        confirmedBy: memberId, // In reality, this would be a supervisor
        rating,
        timestamp: now(),
      });
      return {
        assignment,
        payerNewBalance: result.payerNewBalance,
        payeeNewBalance: result.payeeNewBalance,
      };
    }

    return { assignment };
  }

  async recordNoShow(slotId: TaskSlotId, memberId: IdentityId): Promise<void> {
    const slot = await this.getTaskSlot(slotId);
    if (!slot) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.SLOT_NOT_FOUND,
        message: `Slot ${slotId} not found`,
      });
    }

    const assignment = slot.assignments.find(a => a.memberId === memberId);
    if (!assignment) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.NOT_ASSIGNED,
        message: `Member ${memberId} not assigned to slot`,
      });
    }

    assignment.status = 'NO_SHOW';

    // Cancel associated commitment if any
    if (assignment.commitmentId) {
      await this.commitments.cancelCommitment(
        assignment.commitmentId,
        'No show',
        memberId
      );
    }

    // Check if slot is now incomplete
    const allDone = slot.assignments.every(a => a.status === 'COMPLETED' || a.status === 'NO_SHOW');
    if (allDone) {
      const anyComplete = slot.assignments.some(a => a.status === 'COMPLETED');
      slot.status = anyComplete ? TaskSlotStatus.COMPLETED : TaskSlotStatus.INCOMPLETE;
    }

    await this.storage.saveTaskSlot(slot);

    await this.storage.appendEvent({
      cellId: this.ledger.getCellId(),
      type: 'MEMBER_NO_SHOW',
      timestamp: now(),
      data: { slotId, memberId },
    });
  }

  // ============================================
  // COVERAGE
  // ============================================

  async checkCoverageFeasibility(weekStart: Timestamp): Promise<FeasibilityResult> {
    const weekEnd = weekStart + (7 * 24 * 60 * 60 * 1000);
    const slots = await this.getSlotsByPeriod(weekStart, weekEnd);
    const suppliesResult = await this.storage.getAllMemberSupplies();
    const supplies = suppliesResult.ok ? suppliesResult.value : [];

    // Calculate total required by category
    const categoryRequired = new Map<TaskCategory, number>();
    for (const slot of slots) {
      const current = categoryRequired.get(slot.category) ?? 0;
      categoryRequired.set(slot.category, current + slot.hoursRequired);
    }

    // Calculate total available by category
    const categoryAvailable = new Map<TaskCategory, number>();
    for (const supply of supplies) {
      // Distribute hours based on skill levels
      const totalSkill = Array.from(supply.skills.values()).reduce((sum, v) => sum + v, 0) || 1;
      for (const [cat, skill] of supply.skills) {
        const hours = (skill / totalSkill) * supply.weeklyAvailableHours;
        const current = categoryAvailable.get(cat) ?? 0;
        categoryAvailable.set(cat, current + hours);
      }
    }

    // Calculate gaps
    const categoryGaps = new Map<TaskCategory, number>();
    const bottlenecks: string[] = [];
    const recommendations: string[] = [];

    let totalRequired = 0;
    let totalAvailable = 0;

    for (const [category, required] of categoryRequired) {
      totalRequired += required;
      const available = categoryAvailable.get(category) ?? 0;
      totalAvailable += available;
      const gap = available - required;
      categoryGaps.set(category, gap);

      if (gap < 0) {
        bottlenecks.push(`${category}: ${Math.abs(gap)} hours short`);
        recommendations.push(`Recruit more members skilled in ${category}`);
      }
    }

    const feasible = bottlenecks.length === 0;

    return {
      feasible,
      totalRequired,
      totalAvailable,
      categoryGaps,
      bottlenecks,
      recommendations,
    };
  }

  async getCoverageReport(weekStart: Timestamp): Promise<CoverageReport> {
    const weekEnd = weekStart + (7 * 24 * 60 * 60 * 1000);
    const slots = await this.getSlotsByPeriod(weekStart, weekEnd);

    // Group by category
    const categoryStats = new Map<TaskCategory, {
      total: number;
      filled: number;
      completed: number;
      hours: number;
      coveredHours: number;
    }>();

    let totalSlots = 0;
    let filledSlots = 0;
    let totalHoursScheduled = 0;
    let totalHoursCompleted = 0;

    for (const slot of slots) {
      totalSlots++;
      totalHoursScheduled += slot.hoursRequired;

      const isFilled = slot.status === TaskSlotStatus.FILLED ||
                       slot.status === TaskSlotStatus.IN_PROGRESS ||
                       slot.status === TaskSlotStatus.COMPLETED;
      if (isFilled) filledSlots++;

      const completedAssignments = slot.assignments.filter(a => a.status === 'COMPLETED');
      const completedHours = completedAssignments.reduce((sum, a) => sum + a.hoursAssigned, 0);
      totalHoursCompleted += completedHours;

      // Update category stats
      const stats = categoryStats.get(slot.category) ?? {
        total: 0,
        filled: 0,
        completed: 0,
        hours: 0,
        coveredHours: 0,
      };
      stats.total++;
      if (isFilled) stats.filled++;
      if (slot.status === TaskSlotStatus.COMPLETED) stats.completed++;
      stats.hours += slot.hoursRequired;
      stats.coveredHours += completedHours;
      categoryStats.set(slot.category, stats);
    }

    // Build category breakdown
    const categoryBreakdown = new Map<TaskCategory, CategoryCoverage>();
    for (const [category, stats] of categoryStats) {
      categoryBreakdown.set(category, {
        category,
        totalSlots: stats.total,
        filledSlots: stats.filled,
        completedSlots: stats.completed,
        totalHours: stats.hours,
        coveredHours: stats.coveredHours,
        coverageRate: stats.total > 0 ? stats.filled / stats.total : 1,
      });
    }

    return {
      periodStart: weekStart,
      periodEnd: weekEnd,
      overallCoverage: totalSlots > 0 ? filledSlots / totalSlots : 1,
      categoryBreakdown,
      totalSlots,
      filledSlots,
      totalHoursScheduled,
      totalHoursCompleted,
    };
  }

  // ============================================
  // MEMBER
  // ============================================

  async getMemberSchedule(memberId: IdentityId, weekStart: Timestamp): Promise<TaskSlot[]> {
    const weekEnd = weekStart + (7 * 24 * 60 * 60 * 1000);
    const slots = await this.getSlotsByPeriod(weekStart, weekEnd);
    return slots.filter(s => s.assignments.some(a => a.memberId === memberId));
  }

  async updateMemberSupply(supply: MemberSupply): Promise<void> {
    const result = await this.storage.saveMemberSupply(supply);
    if (!result.ok) {
      throw new SchedulerValidationError({
        code: SchedulerErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }
  }

  async getMemberSupply(memberId: IdentityId): Promise<MemberSupply | undefined> {
    const result = await this.storage.getMemberSupply(memberId);
    if (!result.ok) return undefined;
    return result.value ?? undefined;
  }

  // ============================================
  // DEBTOR PRIORITY
  // ============================================

  enableDebtorPriorityMatching(): void {
    this.debtorPriorityEnabled = true;
  }

  disableDebtorPriorityMatching(): void {
    this.debtorPriorityEnabled = false;
  }

  isDebtorPriorityEnabled(): boolean {
    return this.debtorPriorityEnabled;
  }
}

// ============================================
// CUSTOM ERROR CLASS
// ============================================

export class SchedulerValidationError extends Error {
  public readonly code: SchedulerErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(error: SchedulerError) {
    super(error.message);
    this.name = 'SchedulerValidationError';
    this.code = error.code;
    this.details = error.details;
  }

  toJSON(): SchedulerError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

// ============================================
// FACTORY
// ============================================

/**
 * Create a new scheduler engine
 */
export function createSchedulerEngine(
  ledger: LedgerEngine,
  commitments: CommitmentEngine,
  storage: IStorage
): SchedulerEngine {
  return new SchedulerEngine(ledger, commitments, storage);
}
