/**
 * Cell Protocol - Emergency Types
 *
 * Type definitions for the Emergency Mode System (PRD-07).
 * Defines risk states, policies, stress indicators, and state transitions.
 */

import {
  CellId,
  IdentityId,
  Timestamp,
  Units,
} from './common';

// ============================================
// CORE ENUMS
// ============================================

/** Risk state of the cell - determines policy parameters */
export enum RiskState {
  NORMAL = 'NORMAL',       // Standard operating conditions
  STRESSED = 'STRESSED',   // Elevated risk indicators
  PANIC = 'PANIC',         // Critical risk - emergency measures active
}

/** Admission modes for new members */
export enum AdmissionMode {
  STANDARD = 'STANDARD',                     // Normal admission process
  BONDED = 'BONDED',                         // Requires bond/deposit
  SUPERMAJORITY_BONDED = 'SUPERMAJORITY_BONDED', // Bond + supermajority approval
}

/** Commitment escrow modes */
export enum CommitmentMode {
  STANDARD = 'STANDARD',           // Normal commitment handling
  ESCROW_ESSENTIALS = 'ESCROW_ESSENTIALS', // Escrow required for essential commitments
  ESCROW_ALL = 'ESCROW_ALL',       // Escrow required for all commitments
}

/** Scheduler priority modes */
export enum SchedulerPriority {
  BALANCED = 'BALANCED',           // Balance all task categories
  ESSENTIALS_FIRST = 'ESSENTIALS_FIRST', // Prioritize essential tasks
  SURVIVAL = 'SURVIVAL',           // Only survival-critical tasks
}

// ============================================
// STRESS INDICATORS
// ============================================

/** Stress indicators used to determine risk state */
export interface StressIndicators {
  /** Fraction of total limit held by members at their debt floor (0-1) */
  floorMass: number;

  /** Balance dispersion across members (variance coefficient) */
  balanceVariance: number;

  /** Disputes filed per transaction in recent period */
  disputeRate: number;

  /** Member exits per period (churn rate) */
  memberChurn: number;

  /** Energy stress indicator (for future use) */
  energyStress: number;

  /** Combined economic stress index */
  economicStress: number;

  /** Overall stress = max(economic, energy) */
  overallStress: number;

  /** Timestamp when indicators were calculated */
  calculatedAt: Timestamp;
}

// ============================================
// EMERGENCY POLICY
// ============================================

/** Policy parameters that change based on risk state */
export interface EmergencyPolicy {
  /** Factor to multiply existing credit limits (0-1) */
  limitFactor: number;

  /** Factor for new member limits (typically lower than limitFactor) */
  newMemberLimitFactor: number;

  /** Factor to multiply federation exposure cap */
  federationBetaFactor: number;

  /** Current admission mode */
  admissionMode: AdmissionMode;

  /** Current commitment mode */
  commitmentMode: CommitmentMode;

  /** Current scheduler priority */
  schedulerPriority: SchedulerPriority;

  /** Whether to enable debtor priority matching */
  debtorPriorityMatching: boolean;
}

/** Default policies for each risk state */
export const DEFAULT_POLICIES: Record<RiskState, EmergencyPolicy> = {
  [RiskState.NORMAL]: {
    limitFactor: 1.0,
    newMemberLimitFactor: 1.0,
    federationBetaFactor: 1.0,
    admissionMode: AdmissionMode.STANDARD,
    commitmentMode: CommitmentMode.STANDARD,
    schedulerPriority: SchedulerPriority.BALANCED,
    debtorPriorityMatching: false,
  },
  [RiskState.STRESSED]: {
    limitFactor: 1.0,
    newMemberLimitFactor: 0.8,
    federationBetaFactor: 0.7,
    admissionMode: AdmissionMode.BONDED,
    commitmentMode: CommitmentMode.ESCROW_ESSENTIALS,
    schedulerPriority: SchedulerPriority.ESSENTIALS_FIRST,
    debtorPriorityMatching: true,
  },
  [RiskState.PANIC]: {
    limitFactor: 0.8,
    newMemberLimitFactor: 0.5,
    federationBetaFactor: 0.0, // Federation frozen
    admissionMode: AdmissionMode.SUPERMAJORITY_BONDED,
    commitmentMode: CommitmentMode.ESCROW_ALL,
    schedulerPriority: SchedulerPriority.SURVIVAL,
    debtorPriorityMatching: true,
  },
};

// ============================================
// TRANSITION THRESHOLDS
// ============================================

/** Thresholds for state transitions */
export interface TransitionThresholds {
  /** Floor mass to trigger NORMAL → STRESSED */
  stressedFloorMass: number;

  /** Dispute rate to trigger NORMAL → STRESSED */
  stressedDisputeRate: number;

  /** Floor mass to trigger STRESSED → PANIC */
  panicFloorMass: number;

  /** Energy stress to trigger STRESSED → PANIC */
  panicEnergyStress: number;

  /** Floor mass to allow PANIC → STRESSED (hysteresis) */
  normalFloorMass: number;

  /** Overall stress to allow de-escalation */
  normalOverallStress: number;

  /** Minimum time in PANIC before de-escalation (ms) */
  panicStabilizationPeriod: number;
}

/** Default thresholds */
export const DEFAULT_THRESHOLDS: TransitionThresholds = {
  stressedFloorMass: 0.25,
  stressedDisputeRate: 0.05,
  panicFloorMass: 0.40,
  panicEnergyStress: 1.2,
  normalFloorMass: 0.15,
  normalOverallStress: 0.8,
  panicStabilizationPeriod: 24 * 60 * 60 * 1000, // 24 hours
};

// ============================================
// STATE TRANSITIONS
// ============================================

/** Reasons for state transitions */
export enum TransitionReason {
  /** Automatic transition based on indicators */
  INDICATOR_TRIGGERED = 'INDICATOR_TRIGGERED',
  /** Manual override by governance */
  GOVERNANCE_OVERRIDE = 'GOVERNANCE_OVERRIDE',
  /** Forced de-escalation by governance */
  FORCED_DEESCALATION = 'FORCED_DEESCALATION',
  /** Time-based de-escalation after stabilization */
  STABILIZATION_COMPLETE = 'STABILIZATION_COMPLETE',
  /** Initial state on engine creation */
  INITIALIZATION = 'INITIALIZATION',
}

/** Result of checking for state transition */
export interface StateTransitionResult {
  /** Whether a transition should occur */
  shouldTransition: boolean;

  /** Target state if transition should occur */
  targetState?: RiskState;

  /** Reason for transition */
  reason?: TransitionReason;

  /** Detailed explanation */
  explanation?: string;

  /** Current indicators that triggered transition */
  triggeringIndicators?: Partial<StressIndicators>;
}

/** Entry in state history */
export interface StateHistoryEntry {
  /** Previous risk state */
  fromState: RiskState;

  /** New risk state */
  toState: RiskState;

  /** Reason for transition */
  reason: TransitionReason;

  /** Timestamp of transition */
  timestamp: Timestamp;

  /** Indicators at time of transition */
  indicators: StressIndicators;

  /** ID of governance approval if manual override */
  governanceApprovalId?: string;

  /** Actor who initiated the transition */
  initiatedBy?: IdentityId;
}

/** Report on proximity to thresholds */
export interface ThresholdProximityReport {
  /** Current risk state */
  currentState: RiskState;

  /** Distance to escalation (0 = at threshold, negative = past threshold) */
  distanceToEscalation: number;

  /** Distance to de-escalation (0 = at threshold, positive = above threshold) */
  distanceToDeescalation: number;

  /** Most critical indicator name */
  criticalIndicator: string;

  /** Time until stabilization complete (if in PANIC, else null) */
  timeUntilStabilization: number | null;

  /** Whether de-escalation is currently blocked */
  deescalationBlocked: boolean;

  /** Reason for blocked de-escalation */
  blockReason?: string;
}

// ============================================
// EMERGENCY STATE
// ============================================

/** Complete emergency state for a cell */
export interface EmergencyState {
  /** Cell identifier */
  cellId: CellId;

  /** Current risk state */
  riskState: RiskState;

  /** Current policy (derived from state) */
  currentPolicy: EmergencyPolicy;

  /** Latest stress indicators */
  indicators: StressIndicators;

  /** Transition thresholds */
  thresholds: TransitionThresholds;

  /** Timestamp of last state change */
  lastStateChange: Timestamp;

  /** Timestamp when PANIC was entered (null if not in PANIC) */
  panicEnteredAt: Timestamp | null;

  /** Timestamp of last indicator update */
  lastIndicatorUpdate: Timestamp;

  /** Created timestamp */
  createdAt: Timestamp;

  /** Updated timestamp */
  updatedAt: Timestamp;
}

// ============================================
// ERROR TYPES
// ============================================

/** Errors that can occur during emergency operations */
export enum EmergencyErrorCode {
  /** Invalid state transition requested */
  INVALID_TRANSITION = 'INVALID_TRANSITION',

  /** De-escalation blocked by stabilization period */
  STABILIZATION_REQUIRED = 'STABILIZATION_REQUIRED',

  /** Missing governance approval for manual override */
  GOVERNANCE_APPROVAL_REQUIRED = 'GOVERNANCE_APPROVAL_REQUIRED',

  /** Invalid threshold configuration */
  INVALID_THRESHOLDS = 'INVALID_THRESHOLDS',

  /** Storage operation failed */
  STORAGE_ERROR = 'STORAGE_ERROR',

  /** Dependencies not available */
  DEPENDENCY_ERROR = 'DEPENDENCY_ERROR',
}

/** Detailed error information */
export interface EmergencyError {
  code: EmergencyErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================
// INTERFACE
// ============================================

/** Interface for the Emergency Engine */
export interface IEmergencyEngine {
  /** Get the cell ID this engine manages */
  getCellId(): CellId;

  /** Get current risk state */
  getCurrentRiskState(): RiskState;

  /** Get current stress indicators */
  getStressIndicators(): StressIndicators;

  /** Get current policy based on risk state */
  getCurrentPolicy(): EmergencyPolicy;

  /** Get transition thresholds */
  getThresholds(): TransitionThresholds;

  /** Recalculate stress indicators from current ledger/governance state */
  updateIndicators(): Promise<StressIndicators>;

  /** Check if state transition should occur based on current indicators */
  checkStateTransition(): Promise<StateTransitionResult>;

  /** Trigger state change (called after governance approval for manual changes) */
  triggerStateChange(
    newState: RiskState,
    reason: TransitionReason,
    governanceApprovalId?: string,
    initiatedBy?: IdentityId
  ): Promise<void>;

  /** Force de-escalation (requires governance approval) */
  forceDeEscalation(
    reason: string,
    governanceApprovalId: string,
    initiatedBy: IdentityId
  ): Promise<void>;

  /** Analyze proximity to thresholds */
  analyzeThresholdProximity(): ThresholdProximityReport;

  /** Get state history since timestamp */
  getStateHistory(since: Timestamp): Promise<StateHistoryEntry[]>;

  /** Check if federation is frozen (PANIC mode with beta=0) */
  isFederationFrozen(): boolean;

  /** Get effective limit factor for a member */
  getEffectiveLimitFactor(isNewMember: boolean): number;
}
