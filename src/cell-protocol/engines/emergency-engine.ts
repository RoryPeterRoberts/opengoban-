/**
 * Cell Protocol - Emergency Engine
 *
 * Implementation of the Emergency Mode System (PRD-07).
 * Manages risk states, stress indicators, and policy application.
 */

import {
  CellId,
  IdentityId,
  Timestamp,
  Units,
  now,
} from '../types/common';
import {
  RiskState,
  AdmissionMode,
  CommitmentMode,
  SchedulerPriority,
  StressIndicators,
  EmergencyPolicy,
  TransitionThresholds,
  TransitionReason,
  StateTransitionResult,
  StateHistoryEntry,
  ThresholdProximityReport,
  EmergencyState,
  EmergencyError,
  EmergencyErrorCode,
  IEmergencyEngine,
  DEFAULT_POLICIES,
  DEFAULT_THRESHOLDS,
} from '../types/emergency';
import { LedgerEngine } from './ledger-engine';
import { GovernanceEngine } from './governance-engine';
import { IdentityEngine } from './identity-engine';
import { IStorage } from '../storage/pouchdb-adapter';

// ============================================
// EMERGENCY ENGINE IMPLEMENTATION
// ============================================

export class EmergencyEngine implements IEmergencyEngine {
  private cellId: CellId;
  private ledger: LedgerEngine;
  private governance?: GovernanceEngine;
  private identity?: IdentityEngine;
  private storage: IStorage;

  private state: EmergencyState;

  constructor(
    cellId: CellId,
    ledger: LedgerEngine,
    storage: IStorage,
    thresholds: Partial<TransitionThresholds> = {}
  ) {
    this.cellId = cellId;
    this.ledger = ledger;
    this.storage = storage;

    // Initialize state
    const timestamp = now();
    this.state = {
      cellId,
      riskState: RiskState.NORMAL,
      currentPolicy: { ...DEFAULT_POLICIES[RiskState.NORMAL] },
      indicators: this.createEmptyIndicators(timestamp),
      thresholds: { ...DEFAULT_THRESHOLDS, ...thresholds },
      lastStateChange: timestamp,
      panicEnteredAt: null,
      lastIndicatorUpdate: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  /** Set the governance engine (circular dependency resolution) */
  setGovernanceEngine(governance: GovernanceEngine): void {
    this.governance = governance;
  }

  /** Set the identity engine (circular dependency resolution) */
  setIdentityEngine(identity: IdentityEngine): void {
    this.identity = identity;
  }

  // ============================================
  // CORE INTERFACE METHODS
  // ============================================

  getCellId(): CellId {
    return this.cellId;
  }

  getCurrentRiskState(): RiskState {
    return this.state.riskState;
  }

  getStressIndicators(): StressIndicators {
    return { ...this.state.indicators };
  }

  getCurrentPolicy(): EmergencyPolicy {
    return { ...this.state.currentPolicy };
  }

  getThresholds(): TransitionThresholds {
    return { ...this.state.thresholds };
  }

  // ============================================
  // INDICATOR CALCULATION
  // ============================================

  async updateIndicators(): Promise<StressIndicators> {
    const timestamp = now();
    const stats = this.ledger.getStatistics();

    // Calculate floor mass: fraction of total limit held by members at floor
    // A member is "at floor" when balance + limit <= small threshold (e.g., 5% of limit)
    let floorMassNumerator = 0;
    const members = this.ledger.getAllMemberStates();
    const floorThresholdFraction = 0.05;

    for (const [, member] of members) {
      const distanceToFloor = member.balance + member.limit;
      const threshold = member.limit * floorThresholdFraction;
      if (distanceToFloor <= threshold) {
        floorMassNumerator += member.limit;
      }
    }

    const floorMass = stats.aggregateCapacity > 0
      ? floorMassNumerator / stats.aggregateCapacity
      : 0;

    // Calculate balance variance (coefficient of variation)
    const balances = Array.from(members.values()).map(m => m.balance);
    const balanceVariance = this.calculateVarianceCoefficient(balances);

    // Calculate dispute rate (disputes per transaction in recent period)
    let disputeRate = 0;
    if (this.governance) {
      const disputes = await this.governance.getActiveDisputes();
      // Simple approximation: disputes / member count as a proxy
      disputeRate = stats.memberCount > 0 ? disputes.length / stats.memberCount : 0;
    }

    // Calculate member churn (exits per period)
    // For now, use a simple placeholder - would need historical data
    const memberChurn = 0; // TODO: Calculate from membership changes

    // Energy stress (future) - placeholder
    const energyStress = 0;

    // Economic stress combines floor mass, variance, and dispute rate
    const economicStress = (floorMass * 0.5) + (disputeRate * 0.3) + (balanceVariance * 0.2);

    // Overall stress is max of economic and energy
    const overallStress = Math.max(economicStress, energyStress);

    const indicators: StressIndicators = {
      floorMass,
      balanceVariance,
      disputeRate,
      memberChurn,
      energyStress,
      economicStress,
      overallStress,
      calculatedAt: timestamp,
    };

    this.state.indicators = indicators;
    this.state.lastIndicatorUpdate = timestamp;
    this.state.updatedAt = timestamp;

    await this.saveState();

    return indicators;
  }

  private calculateVarianceCoefficient(values: number[]): number {
    if (values.length === 0) return 0;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) return 0;

    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return stdDev / Math.abs(mean);
  }

  // ============================================
  // STATE TRANSITIONS
  // ============================================

  async checkStateTransition(): Promise<StateTransitionResult> {
    const { indicators, thresholds, riskState } = this.state;

    // Check for escalation first
    if (riskState === RiskState.NORMAL) {
      // Check NORMAL → STRESSED
      if (indicators.floorMass >= thresholds.stressedFloorMass) {
        return {
          shouldTransition: true,
          targetState: RiskState.STRESSED,
          reason: TransitionReason.INDICATOR_TRIGGERED,
          explanation: `Floor mass ${(indicators.floorMass * 100).toFixed(1)}% >= threshold ${(thresholds.stressedFloorMass * 100).toFixed(1)}%`,
          triggeringIndicators: { floorMass: indicators.floorMass },
        };
      }

      if (indicators.disputeRate >= thresholds.stressedDisputeRate) {
        return {
          shouldTransition: true,
          targetState: RiskState.STRESSED,
          reason: TransitionReason.INDICATOR_TRIGGERED,
          explanation: `Dispute rate ${(indicators.disputeRate * 100).toFixed(1)}% >= threshold ${(thresholds.stressedDisputeRate * 100).toFixed(1)}%`,
          triggeringIndicators: { disputeRate: indicators.disputeRate },
        };
      }
    }

    if (riskState === RiskState.STRESSED) {
      // Check STRESSED → PANIC
      if (indicators.floorMass >= thresholds.panicFloorMass) {
        return {
          shouldTransition: true,
          targetState: RiskState.PANIC,
          reason: TransitionReason.INDICATOR_TRIGGERED,
          explanation: `Floor mass ${(indicators.floorMass * 100).toFixed(1)}% >= panic threshold ${(thresholds.panicFloorMass * 100).toFixed(1)}%`,
          triggeringIndicators: { floorMass: indicators.floorMass },
        };
      }

      if (indicators.energyStress >= thresholds.panicEnergyStress) {
        return {
          shouldTransition: true,
          targetState: RiskState.PANIC,
          reason: TransitionReason.INDICATOR_TRIGGERED,
          explanation: `Energy stress ${indicators.energyStress.toFixed(2)} >= threshold ${thresholds.panicEnergyStress.toFixed(2)}`,
          triggeringIndicators: { energyStress: indicators.energyStress },
        };
      }

      // Check STRESSED → NORMAL (with hysteresis)
      if (indicators.floorMass <= thresholds.normalFloorMass &&
          indicators.overallStress <= thresholds.normalOverallStress) {
        return {
          shouldTransition: true,
          targetState: RiskState.NORMAL,
          reason: TransitionReason.INDICATOR_TRIGGERED,
          explanation: `Indicators below de-escalation thresholds`,
          triggeringIndicators: {
            floorMass: indicators.floorMass,
            overallStress: indicators.overallStress,
          },
        };
      }
    }

    if (riskState === RiskState.PANIC) {
      // Check PANIC → STRESSED (requires stabilization period)
      const timeSincePanic = this.state.panicEnteredAt
        ? now() - this.state.panicEnteredAt
        : Infinity;

      if (timeSincePanic >= thresholds.panicStabilizationPeriod) {
        if (indicators.floorMass <= thresholds.normalFloorMass &&
            indicators.overallStress <= thresholds.normalOverallStress) {
          return {
            shouldTransition: true,
            targetState: RiskState.STRESSED,
            reason: TransitionReason.STABILIZATION_COMPLETE,
            explanation: `Stabilization period complete and indicators below thresholds`,
            triggeringIndicators: {
              floorMass: indicators.floorMass,
              overallStress: indicators.overallStress,
            },
          };
        }
      }
    }

    return { shouldTransition: false };
  }

  async triggerStateChange(
    newState: RiskState,
    reason: TransitionReason,
    governanceApprovalId?: string,
    initiatedBy?: IdentityId
  ): Promise<void> {
    const oldState = this.state.riskState;

    // Validate transition
    if (!this.isValidTransition(oldState, newState, reason)) {
      throw new EmergencyValidationError({
        code: EmergencyErrorCode.INVALID_TRANSITION,
        message: `Invalid transition from ${oldState} to ${newState}`,
      });
    }

    // Record history entry
    const historyEntry: StateHistoryEntry = {
      fromState: oldState,
      toState: newState,
      reason,
      timestamp: now(),
      indicators: { ...this.state.indicators },
      governanceApprovalId,
      initiatedBy,
    };

    await this.storage.appendStateHistoryEntry(historyEntry, this.cellId);

    // Update state
    this.state.riskState = newState;
    this.state.currentPolicy = { ...DEFAULT_POLICIES[newState] };
    this.state.lastStateChange = now();
    this.state.updatedAt = now();

    if (newState === RiskState.PANIC) {
      this.state.panicEnteredAt = now();
    } else if (oldState === RiskState.PANIC) {
      this.state.panicEnteredAt = null;
    }

    await this.saveState();

    // Log event
    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'EMERGENCY_STATE_CHANGE',
      timestamp: now(),
      data: {
        fromState: oldState,
        toState: newState,
        reason,
        governanceApprovalId,
        initiatedBy,
      },
    });
  }

  private isValidTransition(
    from: RiskState,
    to: RiskState,
    reason: TransitionReason
  ): boolean {
    // Same state is always invalid
    if (from === to) return false;

    // Governance can override any transition
    if (reason === TransitionReason.GOVERNANCE_OVERRIDE ||
        reason === TransitionReason.FORCED_DEESCALATION) {
      return true;
    }

    // Automatic transitions follow strict order
    const stateOrder = [RiskState.NORMAL, RiskState.STRESSED, RiskState.PANIC];
    const fromIndex = stateOrder.indexOf(from);
    const toIndex = stateOrder.indexOf(to);

    // Can escalate by 1 step or de-escalate by 1 step
    return Math.abs(toIndex - fromIndex) === 1;
  }

  async forceDeEscalation(
    reason: string,
    governanceApprovalId: string,
    initiatedBy: IdentityId
  ): Promise<void> {
    const current = this.state.riskState;

    if (current === RiskState.NORMAL) {
      throw new EmergencyValidationError({
        code: EmergencyErrorCode.INVALID_TRANSITION,
        message: 'Already in NORMAL state, cannot de-escalate further',
      });
    }

    // De-escalate one level
    const targetState = current === RiskState.PANIC
      ? RiskState.STRESSED
      : RiskState.NORMAL;

    await this.triggerStateChange(
      targetState,
      TransitionReason.FORCED_DEESCALATION,
      governanceApprovalId,
      initiatedBy
    );

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'FORCED_DEESCALATION',
      timestamp: now(),
      data: {
        reason,
        governanceApprovalId,
        initiatedBy,
        fromState: current,
        toState: targetState,
      },
    });
  }

  // ============================================
  // THRESHOLD ANALYSIS
  // ============================================

  analyzeThresholdProximity(): ThresholdProximityReport {
    const { indicators, thresholds, riskState, panicEnteredAt } = this.state;

    let distanceToEscalation = Infinity;
    let distanceToDeescalation = Infinity;
    let criticalIndicator = 'none';
    let deescalationBlocked = false;
    let blockReason: string | undefined;

    if (riskState === RiskState.NORMAL) {
      // Distance to STRESSED
      const floorDistance = thresholds.stressedFloorMass - indicators.floorMass;
      const disputeDistance = thresholds.stressedDisputeRate - indicators.disputeRate;
      distanceToEscalation = Math.min(floorDistance, disputeDistance);
      criticalIndicator = floorDistance < disputeDistance ? 'floorMass' : 'disputeRate';
      distanceToDeescalation = Infinity; // Already at lowest
    } else if (riskState === RiskState.STRESSED) {
      // Distance to PANIC
      const floorDistance = thresholds.panicFloorMass - indicators.floorMass;
      const energyDistance = thresholds.panicEnergyStress - indicators.energyStress;
      distanceToEscalation = Math.min(floorDistance, energyDistance);
      criticalIndicator = floorDistance < energyDistance ? 'floorMass' : 'energyStress';

      // Distance to NORMAL
      distanceToDeescalation = Math.max(
        indicators.floorMass - thresholds.normalFloorMass,
        indicators.overallStress - thresholds.normalOverallStress
      );
    } else if (riskState === RiskState.PANIC) {
      distanceToEscalation = Infinity; // Already at highest

      // Distance to STRESSED (check stabilization)
      const timeSincePanic = panicEnteredAt ? now() - panicEnteredAt : 0;
      const timeRemaining = Math.max(0, thresholds.panicStabilizationPeriod - timeSincePanic);

      if (timeRemaining > 0) {
        deescalationBlocked = true;
        blockReason = `Stabilization period: ${Math.ceil(timeRemaining / (60 * 60 * 1000))}h remaining`;
        distanceToDeescalation = Infinity;
      } else {
        distanceToDeescalation = Math.max(
          indicators.floorMass - thresholds.normalFloorMass,
          indicators.overallStress - thresholds.normalOverallStress
        );
      }
      criticalIndicator = 'floorMass';
    }

    const timeUntilStabilization = riskState === RiskState.PANIC && panicEnteredAt
      ? Math.max(0, thresholds.panicStabilizationPeriod - (now() - panicEnteredAt))
      : null;

    return {
      currentState: riskState,
      distanceToEscalation,
      distanceToDeescalation,
      criticalIndicator,
      timeUntilStabilization,
      deescalationBlocked,
      blockReason,
    };
  }

  // ============================================
  // HISTORY
  // ============================================

  async getStateHistory(since: Timestamp): Promise<StateHistoryEntry[]> {
    const result = await this.storage.getStateHistory(this.cellId, since);
    if (!result.ok) return [];
    return result.value;
  }

  // ============================================
  // POLICY HELPERS
  // ============================================

  isFederationFrozen(): boolean {
    return this.state.currentPolicy.federationBetaFactor === 0;
  }

  getEffectiveLimitFactor(isNewMember: boolean): number {
    return isNewMember
      ? this.state.currentPolicy.newMemberLimitFactor
      : this.state.currentPolicy.limitFactor;
  }

  // ============================================
  // PERSISTENCE
  // ============================================

  private async saveState(): Promise<void> {
    const result = await this.storage.saveEmergencyState(this.state);
    if (!result.ok) {
      throw new EmergencyValidationError({
        code: EmergencyErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }
  }

  async loadState(): Promise<void> {
    const result = await this.storage.getEmergencyState(this.cellId);
    if (result.ok && result.value) {
      this.state = result.value;
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  private createEmptyIndicators(timestamp: Timestamp): StressIndicators {
    return {
      floorMass: 0,
      balanceVariance: 0,
      disputeRate: 0,
      memberChurn: 0,
      energyStress: 0,
      economicStress: 0,
      overallStress: 0,
      calculatedAt: timestamp,
    };
  }
}

// ============================================
// CUSTOM ERROR CLASS
// ============================================

export class EmergencyValidationError extends Error {
  public readonly code: EmergencyErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(error: EmergencyError) {
    super(error.message);
    this.name = 'EmergencyValidationError';
    this.code = error.code;
    this.details = error.details;
  }

  toJSON(): EmergencyError {
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
 * Create a new emergency engine
 */
export function createEmergencyEngine(
  cellId: CellId,
  ledger: LedgerEngine,
  storage: IStorage,
  thresholds: Partial<TransitionThresholds> = {}
): EmergencyEngine {
  return new EmergencyEngine(cellId, ledger, storage, thresholds);
}
