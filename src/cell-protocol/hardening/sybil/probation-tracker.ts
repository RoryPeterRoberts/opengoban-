/**
 * Cell Protocol - Hardening: Probation Tracker
 *
 * Tracks and manages member probation states.
 * Implements restrictions and graduation requirements.
 */

import { IdentityId, Timestamp, generateId, now } from '../../types/common';
import { MembershipStatus } from '../../types/common';
import {
  ProbationState,
  ProbationStatus,
  ProbationRestrictions,
  ProbationWarning,
  ProbationProgress,
  ProbationConfig,
  DEFAULT_PROBATION_CONFIG,
  SybilErrorCode,
  SybilError,
} from '../types/sybil';
import { LedgerEngine } from '../../engines/ledger-engine';
import { IStorage } from '../../storage/pouchdb-adapter';

// ============================================
// PROBATION TRACKER
// ============================================

/**
 * Tracks probation states for members
 */
export class ProbationTracker {
  private ledger: LedgerEngine;
  private storage: IStorage;
  private config: ProbationConfig;

  // In-memory state
  private probationStates: Map<IdentityId, ProbationState> = new Map();

  constructor(
    ledger: LedgerEngine,
    storage: IStorage,
    config?: Partial<ProbationConfig>
  ) {
    this.ledger = ledger;
    this.storage = storage;
    this.config = { ...DEFAULT_PROBATION_CONFIG, ...config };
  }

  /**
   * Start probation for a member
   */
  async startProbation(
    memberId: IdentityId,
    durationDays: number,
    sponsorBondId?: string,
    serviceBondId?: string,
    customRestrictions?: Partial<ProbationRestrictions>
  ): Promise<ProbationState> {
    // Check member exists and is pending/active
    const memberState = this.ledger.getMemberState(memberId);
    if (!memberState) {
      throw new ProbationError({
        code: SybilErrorCode.NOT_ON_PROBATION,
        message: `Member ${memberId} not found`,
      });
    }

    const timestamp = now();
    const durationMs = durationDays * 24 * 60 * 60 * 1000;

    const restrictions: ProbationRestrictions = {
      ...this.config.defaultRestrictions,
      ...customRestrictions,
    };

    const state: ProbationState = {
      memberId,
      status: 'PROBATION',
      restrictions,
      startedAt: timestamp,
      scheduledEndAt: timestamp + durationMs,
      sponsorBondId,
      serviceBondId,
      warnings: [],
      progress: {
        commitmentsFulfilled: 0,
        commitmentsCancelled: 0,
        avgRating: 0,
        daysWithoutWarnings: 0,
        serviceHoursCompleted: 0,
      },
    };

    this.probationStates.set(memberId, state);

    // Update ledger status to PROBATION
    await this.ledger.updateMemberStatus(memberId, MembershipStatus.PROBATION);

    // Apply limit restriction
    const currentLimit = memberState.limit;
    const restrictedLimit = Math.floor(currentLimit * restrictions.limitMultiplier);
    await this.ledger.updateMemberLimit(memberId, restrictedLimit);

    return state;
  }

  /**
   * Get probation state for a member
   */
  getProbationState(memberId: IdentityId): ProbationState | undefined {
    return this.probationStates.get(memberId);
  }

  /**
   * Check if member is on probation
   */
  isOnProbation(memberId: IdentityId): boolean {
    const state = this.probationStates.get(memberId);
    return state !== undefined && state.status === 'PROBATION';
  }

  /**
   * Get restrictions for a member
   */
  getRestrictions(memberId: IdentityId): ProbationRestrictions | undefined {
    const state = this.probationStates.get(memberId);
    if (!state || state.status !== 'PROBATION') return undefined;
    return state.restrictions;
  }

  /**
   * Check if member can perform an action
   */
  canPerformAction(
    memberId: IdentityId,
    action: 'transaction' | 'commitment' | 'governance' | 'sponsor' | 'federate'
  ): boolean {
    const state = this.probationStates.get(memberId);
    if (!state || state.status !== 'PROBATION') return true; // Not on probation, no restrictions

    switch (action) {
      case 'transaction':
        return true; // Transactions always allowed (within limits)
      case 'commitment':
        // If escrowedOnly, can still create commitments but must be escrowed
        return true;
      case 'governance':
        return state.restrictions.governanceVoting;
      case 'sponsor':
        return state.restrictions.canSponsor;
      case 'federate':
        return state.restrictions.canFederate;
      default:
        return true;
    }
  }

  /**
   * Issue a warning to a probationary member
   */
  async issueWarning(
    memberId: IdentityId,
    type: ProbationWarning['type'],
    description: string,
    issuedBy: IdentityId
  ): Promise<ProbationState> {
    const state = this.probationStates.get(memberId);
    if (!state || state.status !== 'PROBATION') {
      throw new ProbationError({
        code: SybilErrorCode.NOT_ON_PROBATION,
        message: `Member ${memberId} is not on probation`,
      });
    }

    const warning: ProbationWarning = {
      id: `warn-${generateId()}`,
      type,
      description,
      issuedAt: now(),
      issuedBy,
    };

    state.warnings.push(warning);
    state.progress.daysWithoutWarnings = 0;

    // Check if exceeded max warnings
    if (state.warnings.length >= this.config.maxWarnings) {
      await this.failProbation(memberId, 'Exceeded maximum warnings');
    }

    return state;
  }

  /**
   * Update probation progress
   */
  async updateProgress(
    memberId: IdentityId,
    update: Partial<ProbationProgress>
  ): Promise<ProbationState> {
    const state = this.probationStates.get(memberId);
    if (!state || state.status !== 'PROBATION') {
      throw new ProbationError({
        code: SybilErrorCode.NOT_ON_PROBATION,
        message: `Member ${memberId} is not on probation`,
      });
    }

    // Update progress fields
    if (update.commitmentsFulfilled !== undefined) {
      state.progress.commitmentsFulfilled = update.commitmentsFulfilled;
    }
    if (update.commitmentsCancelled !== undefined) {
      state.progress.commitmentsCancelled = update.commitmentsCancelled;
    }
    if (update.avgRating !== undefined) {
      state.progress.avgRating = update.avgRating;
    }
    if (update.serviceHoursCompleted !== undefined) {
      state.progress.serviceHoursCompleted = update.serviceHoursCompleted;
    }

    // Check for automatic graduation
    await this.checkGraduation(memberId);

    return state;
  }

  /**
   * Check if member qualifies for graduation
   */
  async checkGraduation(memberId: IdentityId): Promise<boolean> {
    const state = this.probationStates.get(memberId);
    if (!state || state.status !== 'PROBATION') return false;

    const currentTime = now();

    // Must have passed scheduled end time
    if (currentTime < state.scheduledEndAt) return false;

    // Must meet fulfillment rate requirement
    const totalCommitments = state.progress.commitmentsFulfilled + state.progress.commitmentsCancelled;
    if (totalCommitments > 0) {
      const fulfillmentRate = state.progress.commitmentsFulfilled / totalCommitments;
      if (fulfillmentRate < this.config.requiredFulfillmentRate) return false;
    }

    // Must have minimum commitments
    if (state.progress.commitmentsFulfilled < this.config.minCommitmentsForGraduation) return false;

    // If all checks pass, graduate
    await this.graduateProbation(memberId);
    return true;
  }

  /**
   * Graduate a member from probation
   */
  async graduateProbation(memberId: IdentityId): Promise<ProbationState> {
    const state = this.probationStates.get(memberId);
    if (!state || state.status !== 'PROBATION') {
      throw new ProbationError({
        code: SybilErrorCode.NOT_ON_PROBATION,
        message: `Member ${memberId} is not on probation`,
      });
    }

    state.status = 'GRADUATED';
    state.graduatedAt = now();

    // Restore full status and limits
    await this.ledger.updateMemberStatus(memberId, MembershipStatus.ACTIVE);

    // Restore full limit (limit multiplier was applied at start)
    const memberState = this.ledger.getMemberState(memberId);
    if (memberState) {
      const fullLimit = Math.floor(memberState.limit / state.restrictions.limitMultiplier);
      await this.ledger.updateMemberLimit(memberId, fullLimit);
    }

    return state;
  }

  /**
   * Fail a member's probation
   */
  async failProbation(memberId: IdentityId, reason: string): Promise<ProbationState> {
    const state = this.probationStates.get(memberId);
    if (!state || state.status !== 'PROBATION') {
      throw new ProbationError({
        code: SybilErrorCode.NOT_ON_PROBATION,
        message: `Member ${memberId} is not on probation`,
      });
    }

    state.status = 'FAILED';
    state.failedAt = now();
    state.failureReason = reason;

    // Freeze or further restrict the member
    await this.ledger.updateMemberStatus(memberId, MembershipStatus.FROZEN);

    return state;
  }

  /**
   * Get time remaining in probation
   */
  getTimeRemaining(memberId: IdentityId): number {
    const state = this.probationStates.get(memberId);
    if (!state || state.status !== 'PROBATION') return 0;

    return Math.max(0, state.scheduledEndAt - now());
  }

  /**
   * Get days remaining in probation
   */
  getDaysRemaining(memberId: IdentityId): number {
    return Math.ceil(this.getTimeRemaining(memberId) / (24 * 60 * 60 * 1000));
  }

  /**
   * Get all members on probation
   */
  getAllOnProbation(): ProbationState[] {
    return Array.from(this.probationStates.values())
      .filter(s => s.status === 'PROBATION');
  }

  /**
   * Process daily updates (e.g., increment days without warnings)
   */
  async processDailyUpdate(): Promise<void> {
    for (const state of this.probationStates.values()) {
      if (state.status !== 'PROBATION') continue;

      // Increment days without warnings if no recent warnings
      const lastWarning = state.warnings[state.warnings.length - 1];
      const dayAgo = now() - (24 * 60 * 60 * 1000);

      if (!lastWarning || lastWarning.issuedAt < dayAgo) {
        state.progress.daysWithoutWarnings++;
      }

      // Check for automatic graduation
      await this.checkGraduation(state.memberId);
    }
  }
}

// ============================================
// ERROR CLASS
// ============================================

export class ProbationError extends Error {
  public readonly code: SybilErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(error: SybilError) {
    super(error.message);
    this.name = 'ProbationError';
    this.code = error.code;
    this.details = error.details;
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create a probation tracker
 */
export function createProbationTracker(
  ledger: LedgerEngine,
  storage: IStorage,
  config?: Partial<ProbationConfig>
): ProbationTracker {
  return new ProbationTracker(ledger, storage, config);
}
