/**
 * Cell Protocol - Hardening: Reputation Signals
 *
 * Computes advisory reputation scores for members.
 * Reputation is informational only - does not enforce hard blocks.
 */

import { IdentityId, Timestamp, Units, now } from '../../types/common';
import { MembershipStatus } from '../../types/common';
import {
  ReputationSignal,
  ReputationComponents,
  RiskIndicator,
  ReputationConfig,
  DEFAULT_REPUTATION_CONFIG,
  SybilDetectionResult,
  SybilPattern,
} from '../types/sybil';
import { LedgerEngine } from '../../engines/ledger-engine';
import { CommitmentEngine } from '../../engines/commitment-engine';
import { IStorage } from '../../storage/pouchdb-adapter';

// ============================================
// REPUTATION SIGNALS ENGINE
// ============================================

/**
 * Computes reputation signals for members
 * Advisory only - influences recommendations, not hard blocks
 */
export class ReputationSignals {
  private ledger: LedgerEngine;
  private commitments: CommitmentEngine;
  private storage: IStorage;
  private config: ReputationConfig;

  // Cached reputation signals
  private signals: Map<IdentityId, ReputationSignal> = new Map();
  private lastUpdate: Map<IdentityId, Timestamp> = new Map();

  constructor(
    ledger: LedgerEngine,
    commitments: CommitmentEngine,
    storage: IStorage,
    config?: Partial<ReputationConfig>
  ) {
    this.ledger = ledger;
    this.commitments = commitments;
    this.storage = storage;
    this.config = { ...DEFAULT_REPUTATION_CONFIG, ...config };
  }

  /**
   * Compute reputation signal for a member
   */
  async computeReputation(memberId: IdentityId): Promise<ReputationSignal> {
    const memberState = this.ledger.getMemberState(memberId);
    if (!memberState) {
      throw new Error(`Member ${memberId} not found`);
    }

    // Compute components
    const components = await this.computeComponents(memberId, memberState);

    // Calculate weighted score
    const score = this.calculateScore(components);

    // Detect risk indicators
    const riskIndicators = await this.detectRiskIndicators(memberId, memberState, components);

    // Calculate trend (compare to previous signal)
    const previousSignal = this.signals.get(memberId);
    const trend = previousSignal ? score - previousSignal.score : 0;

    const signal: ReputationSignal = {
      memberId,
      score,
      components,
      computedAt: now(),
      trend,
      riskIndicators,
    };

    // Cache the signal
    this.signals.set(memberId, signal);
    this.lastUpdate.set(memberId, now());

    return signal;
  }

  /**
   * Get cached reputation signal
   */
  getReputation(memberId: IdentityId): ReputationSignal | undefined {
    return this.signals.get(memberId);
  }

  /**
   * Get reputation score (0-100)
   */
  getScore(memberId: IdentityId): number {
    const signal = this.signals.get(memberId);
    return signal?.score ?? 50; // Default to neutral
  }

  /**
   * Check if member's reputation is below warning threshold
   */
  isLowReputation(memberId: IdentityId): boolean {
    const score = this.getScore(memberId);
    return score < this.config.warningThreshold;
  }

  /**
   * Compute reputation components
   */
  private async computeComponents(
    memberId: IdentityId,
    memberState: { joinedAt: Timestamp; balance: Units; limit: Units }
  ): Promise<ReputationComponents> {
    // Tenure score (0-100)
    const tenureDays = (now() - memberState.joinedAt) / (24 * 60 * 60 * 1000);
    const tenureScore = Math.min(100, (tenureDays / this.config.tenureParams.maxDays) * 100);

    // Fulfillment score (0-100)
    const commitmentStats = await this.commitments.getMemberStats(memberId);
    const fulfillmentRate = commitmentStats.fulfilledAsPromisor /
      Math.max(1, commitmentStats.asPromisor);
    const fulfillmentScore = fulfillmentRate * 100;

    // Transaction quality score (0-100)
    // Based on balance relative to limit (positive = good, at floor = bad)
    const balanceRatio = (memberState.balance + memberState.limit) / (2 * memberState.limit);
    const transactionScore = Math.max(0, Math.min(100, balanceRatio * 100));

    // Sponsor score (inherited reputation)
    // Would need sponsor tracking - default to 50
    const sponsorScore = 50;

    // Disputes score (negative impact)
    // Would need dispute tracking - default to 100 (no disputes)
    const disputeScore = 100;

    // Endorsements score
    // Would need endorsement tracking - default to 0
    const endorsementScore = 0;

    return {
      tenure: tenureScore,
      fulfillment: fulfillmentScore,
      transactions: transactionScore,
      sponsor: sponsorScore,
      disputes: disputeScore,
      endorsements: endorsementScore,
    };
  }

  /**
   * Calculate weighted score from components
   */
  private calculateScore(components: ReputationComponents): number {
    const w = this.config.weights;

    const score =
      components.tenure * w.tenure +
      components.fulfillment * w.fulfillment +
      components.transactions * w.transactions +
      components.sponsor * w.sponsor +
      (100 - components.disputes) * w.disputes + // Invert disputes (100 = no disputes)
      components.endorsements * w.endorsements;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Detect risk indicators
   */
  private async detectRiskIndicators(
    memberId: IdentityId,
    memberState: { balance: Units; limit: Units },
    components: ReputationComponents
  ): Promise<RiskIndicator[]> {
    const indicators: RiskIndicator[] = [];

    // High velocity indicator
    // Would need transaction history - simplified check
    if (Math.abs(memberState.balance) > memberState.limit * 0.8) {
      indicators.push({
        type: 'HIGH_VELOCITY',
        severity: 0.5,
        description: 'High transaction velocity detected',
      });
    }

    // Approaching floor indicator
    if (memberState.balance < -memberState.limit * 0.8) {
      indicators.push({
        type: 'APPROACHING_FLOOR',
        severity: 0.7,
        description: 'Balance approaching credit floor',
      });
    }

    // Low fulfillment indicator
    if (components.fulfillment < 70) {
      indicators.push({
        type: 'LOW_FULFILLMENT',
        severity: (70 - components.fulfillment) / 70,
        description: `Fulfillment rate ${components.fulfillment.toFixed(0)}% below expected`,
      });
    }

    return indicators;
  }

  /**
   * Detect potential Sybil patterns
   */
  async detectSybilPatterns(memberId: IdentityId): Promise<SybilDetectionResult> {
    const patterns: SybilPattern[] = [];
    let totalConfidence = 0;

    // Get transaction patterns (simplified)
    const memberState = this.ledger.getMemberState(memberId);
    if (!memberState) {
      return {
        memberId,
        isLikelySybil: false,
        confidence: 0,
        patterns: [],
        relatedAccounts: [],
        recommendedAction: 'NONE',
      };
    }

    // Check for similar behavior patterns
    // In a full implementation, would analyze transaction graphs

    // Check timing patterns
    const recentJoin = (now() - memberState.joinedAt) < (7 * 24 * 60 * 60 * 1000);
    if (recentJoin) {
      patterns.push({
        type: 'TIMING_PATTERN',
        description: 'Recently joined member',
        confidence: 0.2,
        evidence: { joinedDaysAgo: (now() - memberState.joinedAt) / (24 * 60 * 60 * 1000) },
      });
      totalConfidence += 0.2;
    }

    // Check transaction patterns
    // Would analyze actual transaction history
    if (memberState.balance > memberState.limit * 0.5 && recentJoin) {
      patterns.push({
        type: 'TRANSACTION_PATTERN',
        description: 'Rapid balance accumulation',
        confidence: 0.3,
        evidence: { balance: memberState.balance, limit: memberState.limit },
      });
      totalConfidence += 0.3;
    }

    const confidence = Math.min(1, totalConfidence);
    const isLikelySybil = confidence > 0.5;

    let recommendedAction: SybilDetectionResult['recommendedAction'] = 'NONE';
    if (confidence > 0.8) recommendedAction = 'INVESTIGATE';
    else if (confidence > 0.5) recommendedAction = 'RESTRICT';
    else if (confidence > 0.3) recommendedAction = 'MONITOR';

    return {
      memberId,
      isLikelySybil,
      confidence,
      patterns,
      relatedAccounts: [], // Would identify related accounts
      recommendedAction,
    };
  }

  /**
   * Refresh all reputation signals
   */
  async refreshAll(): Promise<void> {
    const allMembers = this.ledger.getAllMemberStates();

    for (const [memberId, state] of allMembers) {
      if (state.status === MembershipStatus.ACTIVE ||
          state.status === MembershipStatus.PROBATION) {
        await this.computeReputation(memberId);
      }
    }
  }

  /**
   * Get members with low reputation
   */
  getLowReputationMembers(): Array<{ memberId: IdentityId; score: number }> {
    const result: Array<{ memberId: IdentityId; score: number }> = [];

    for (const [memberId, signal] of this.signals) {
      if (signal.score < this.config.warningThreshold) {
        result.push({ memberId, score: signal.score });
      }
    }

    return result.sort((a, b) => a.score - b.score);
  }

  /**
   * Get reputation leaderboard
   */
  getLeaderboard(limit: number = 10): Array<{ memberId: IdentityId; score: number }> {
    return Array.from(this.signals.entries())
      .map(([memberId, signal]) => ({ memberId, score: signal.score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Compare two members' reputations
   */
  compareReputations(member1: IdentityId, member2: IdentityId): {
    winner: IdentityId | null;
    score1: number;
    score2: number;
    difference: number;
  } {
    const score1 = this.getScore(member1);
    const score2 = this.getScore(member2);
    const difference = score1 - score2;

    return {
      winner: difference > 0 ? member1 : difference < 0 ? member2 : null,
      score1,
      score2,
      difference: Math.abs(difference),
    };
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create a reputation signals engine
 */
export function createReputationSignals(
  ledger: LedgerEngine,
  commitments: CommitmentEngine,
  storage: IStorage,
  config?: Partial<ReputationConfig>
): ReputationSignals {
  return new ReputationSignals(ledger, commitments, storage, config);
}
