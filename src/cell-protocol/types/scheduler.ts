/**
 * Cell Protocol - Scheduler Types
 *
 * Type definitions for the Survival Scheduler (PRD-08).
 * Defines task slots, assignments, matching, and coverage.
 */

import {
  IdentityId,
  Timestamp,
  Units,
} from './common';
import { TaskCategory, CommitmentId } from './commitment';

// ============================================
// TYPE ALIASES
// ============================================

/** Unique identifier for a task slot */
export type TaskSlotId = string;

/** Unique identifier for a task template */
export type TaskTemplateId = string;

// ============================================
// ENUMS
// ============================================

/** Status of a task slot */
export enum TaskSlotStatus {
  /** Slot is open for assignment */
  OPEN = 'OPEN',
  /** Some but not all positions filled */
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  /** All positions filled */
  FILLED = 'FILLED',
  /** Task is currently being performed */
  IN_PROGRESS = 'IN_PROGRESS',
  /** Task completed successfully */
  COMPLETED = 'COMPLETED',
  /** Task not completed fully */
  INCOMPLETE = 'INCOMPLETE',
  /** Task was cancelled */
  CANCELLED = 'CANCELLED',
}

/** Status of an assignment */
export type AssignmentStatus = 'ASSIGNED' | 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW';

// ============================================
// CORE INTERFACES
// ============================================

/** An assignment of a member to a task slot */
export interface TaskAssignment {
  /** The slot this assignment is for */
  slotId: TaskSlotId;

  /** The member assigned */
  memberId: IdentityId;

  /** Hours assigned */
  hoursAssigned: number;

  /** Linked commitment (if escrowed) */
  commitmentId?: CommitmentId;

  /** Assignment status */
  status: AssignmentStatus;

  /** Quality rating (1-5) after completion */
  rating?: number;

  /** When assigned */
  assignedAt: Timestamp;

  /** When confirmed */
  confirmedAt?: Timestamp;

  /** When completed */
  completedAt?: Timestamp;
}

/** A task slot that needs to be filled */
export interface TaskSlot {
  /** Unique identifier */
  id: TaskSlotId;

  /** Task category */
  category: TaskCategory;

  /** Human-readable name */
  name: string;

  /** When task starts */
  startTime: Timestamp;

  /** When task ends */
  endTime: Timestamp;

  /** Total hours required */
  hoursRequired: number;

  /** Credit value for full completion */
  creditValue: Units;

  /** Maximum number of assignees */
  maxAssignees: number;

  /** Current status */
  status: TaskSlotStatus;

  /** Current assignments */
  assignments: TaskAssignment[];

  /** Template this was generated from (if any) */
  templateId?: TaskTemplateId;

  /** Description */
  description?: string;

  /** Notes */
  notes?: string;
}

/** A template for recurring tasks */
export interface TaskTemplate {
  /** Unique identifier */
  id: TaskTemplateId;

  /** Task category */
  category: TaskCategory;

  /** Template name */
  name: string;

  /** Hours required per occurrence */
  hoursRequired: number;

  /** Credit value per occurrence */
  creditValue: Units;

  /** Maximum assignees per occurrence */
  maxAssignees: number;

  /** Day of week (0=Sunday, 6=Saturday), null for daily */
  dayOfWeek?: number | null;

  /** Start hour (0-23) */
  startHour: number;

  /** Duration in hours */
  durationHours: number;

  /** Whether template is active */
  active: boolean;

  /** Description */
  description?: string;
}

/** Member's supply/availability information */
export interface MemberSupply {
  /** Member ID */
  memberId: IdentityId;

  /** Weekly available hours */
  weeklyAvailableHours: number;

  /** Skills by category (effectiveness 0-1) */
  skills: Map<TaskCategory, number>;

  /** Preferred categories */
  preferences: TaskCategory[];

  /** Constraints (e.g., "no evenings", "mornings only") */
  constraints: string[];

  /** When last updated */
  updatedAt: Timestamp;
}

// ============================================
// MATCHING & COVERAGE TYPES
// ============================================

/** Result of feasibility check */
export interface FeasibilityResult {
  /** Whether full coverage is feasible */
  feasible: boolean;

  /** Total hours required */
  totalRequired: number;

  /** Total hours available */
  totalAvailable: number;

  /** Gap by category (negative = shortage) */
  categoryGaps: Map<TaskCategory, number>;

  /** Identified bottlenecks */
  bottlenecks: string[];

  /** Recommendations for improvement */
  recommendations: string[];
}

/** Result of matching algorithm */
export interface MatchingResult {
  /** Assignments made */
  assignments: TaskAssignment[];

  /** Slots that couldn't be filled */
  unfilledSlots: TaskSlotId[];

  /** Members who couldn't be assigned */
  unassignedMembers: IdentityId[];

  /** Coverage achieved (0-1) */
  coverageAchieved: number;

  /** Matching score/quality */
  matchingScore: number;
}

/** Coverage report for a period */
export interface CoverageReport {
  /** Start of period */
  periodStart: Timestamp;

  /** End of period */
  periodEnd: Timestamp;

  /** Overall coverage percentage */
  overallCoverage: number;

  /** Coverage by category */
  categoryBreakdown: Map<TaskCategory, CategoryCoverage>;

  /** Total slots */
  totalSlots: number;

  /** Filled slots */
  filledSlots: number;

  /** Total hours scheduled */
  totalHoursScheduled: number;

  /** Total hours completed */
  totalHoursCompleted: number;
}

/** Coverage for a specific category */
export interface CategoryCoverage {
  category: TaskCategory;
  totalSlots: number;
  filledSlots: number;
  completedSlots: number;
  totalHours: number;
  coveredHours: number;
  coverageRate: number;
}

// ============================================
// INPUT TYPES
// ============================================

/** Input for creating a task slot */
export interface CreateSlotInput {
  /** Task category */
  category: TaskCategory;

  /** Name */
  name: string;

  /** Start time */
  startTime: Timestamp;

  /** End time */
  endTime: Timestamp;

  /** Hours required */
  hoursRequired: number;

  /** Credit value */
  creditValue: Units;

  /** Max assignees */
  maxAssignees: number;

  /** Description */
  description?: string;
}

/** Input for creating a template */
export interface CreateTemplateInput {
  /** Task category */
  category: TaskCategory;

  /** Name */
  name: string;

  /** Hours required */
  hoursRequired: number;

  /** Credit value */
  creditValue: Units;

  /** Max assignees */
  maxAssignees: number;

  /** Day of week (null for daily) */
  dayOfWeek?: number | null;

  /** Start hour */
  startHour: number;

  /** Duration hours */
  durationHours: number;

  /** Description */
  description?: string;
}

// ============================================
// ERROR TYPES
// ============================================

/** Errors that can occur during scheduler operations */
export enum SchedulerErrorCode {
  /** Slot not found */
  SLOT_NOT_FOUND = 'SLOT_NOT_FOUND',

  /** Template not found */
  TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND',

  /** Member not found */
  MEMBER_NOT_FOUND = 'MEMBER_NOT_FOUND',

  /** Slot is full */
  SLOT_FULL = 'SLOT_FULL',

  /** Member already assigned */
  ALREADY_ASSIGNED = 'ALREADY_ASSIGNED',

  /** Member not assigned */
  NOT_ASSIGNED = 'NOT_ASSIGNED',

  /** Invalid time range */
  INVALID_TIME_RANGE = 'INVALID_TIME_RANGE',

  /** Invalid hours */
  INVALID_HOURS = 'INVALID_HOURS',

  /** Slot not in assignable status */
  INVALID_SLOT_STATUS = 'INVALID_SLOT_STATUS',

  /** Commitment creation failed */
  COMMITMENT_ERROR = 'COMMITMENT_ERROR',

  /** Storage operation failed */
  STORAGE_ERROR = 'STORAGE_ERROR',
}

/** Detailed scheduler error */
export interface SchedulerError {
  code: SchedulerErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================
// INTERFACE
// ============================================

/** Interface for the Scheduler Engine */
export interface ISchedulerEngine {
  // Templates
  /** Create a task template */
  createTaskTemplate(input: CreateTemplateInput): Promise<TaskTemplate>;

  /** Get a template by ID */
  getTaskTemplate(id: TaskTemplateId): Promise<TaskTemplate | undefined>;

  /** Generate slots from a template for a week */
  generateSlotsFromTemplate(templateId: TaskTemplateId, weekStart: Timestamp): Promise<TaskSlot[]>;

  /** Get all active templates */
  getActiveTemplates(): Promise<TaskTemplate[]>;

  // Slots
  /** Create a task slot */
  createTaskSlot(input: CreateSlotInput): Promise<TaskSlot>;

  /** Get a slot by ID */
  getTaskSlot(id: TaskSlotId): Promise<TaskSlot | undefined>;

  /** Get open slots, optionally filtered by category */
  getOpenSlots(category?: TaskCategory): Promise<TaskSlot[]>;

  /** Get slots for a time period */
  getSlotsByPeriod(start: Timestamp, end: Timestamp): Promise<TaskSlot[]>;

  // Assignment
  /** Run automatic matching for a week */
  runMatching(weekStart: Timestamp): Promise<MatchingResult>;

  /** Manually assign a member to a slot */
  assignMember(slotId: TaskSlotId, memberId: IdentityId, hours: number): Promise<TaskAssignment>;

  /** Confirm an assignment */
  confirmAssignment(slotId: TaskSlotId, memberId: IdentityId): Promise<TaskAssignment>;

  /** Unassign a member from a slot */
  unassignMember(slotId: TaskSlotId, memberId: IdentityId): Promise<void>;

  // Completion
  /** Record completion of a task */
  recordCompletion(
    slotId: TaskSlotId,
    memberId: IdentityId,
    rating?: number
  ): Promise<{ assignment: TaskAssignment; payerNewBalance?: Units; payeeNewBalance?: Units }>;

  /** Record a no-show */
  recordNoShow(slotId: TaskSlotId, memberId: IdentityId): Promise<void>;

  // Coverage
  /** Check if full coverage is feasible for a week */
  checkCoverageFeasibility(weekStart: Timestamp): Promise<FeasibilityResult>;

  /** Get coverage report for a period */
  getCoverageReport(weekStart: Timestamp): Promise<CoverageReport>;

  // Member
  /** Get a member's schedule for a week */
  getMemberSchedule(memberId: IdentityId, weekStart: Timestamp): Promise<TaskSlot[]>;

  /** Update member supply/availability */
  updateMemberSupply(supply: MemberSupply): Promise<void>;

  /** Get member supply info */
  getMemberSupply(memberId: IdentityId): Promise<MemberSupply | undefined>;

  // Debtor priority
  /** Enable debtor priority matching */
  enableDebtorPriorityMatching(): void;

  /** Disable debtor priority matching */
  disableDebtorPriorityMatching(): void;

  /** Check if debtor priority is enabled */
  isDebtorPriorityEnabled(): boolean;
}
