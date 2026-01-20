/**
 * Cell Protocol - Hardening: Recommendations Engine
 *
 * Detects issues and generates actionable recommendations.
 */

import { IdentityId, Timestamp, now } from '../../types/common';
import {
  DetectedIssue,
  IssueSeverity,
  IssueCategory,
  Recommendation,
  HealthScore,
  InvariantId,
  AdversarialScenarioId,
} from '../types/validation';
import { InvariantTestResult } from '../types/invariant';
import { SimulationResult, MetricSnapshot } from '../types/simulation';
import { ReputationSignal, SybilDetectionResult } from '../types/sybil';

// ============================================
// RECOMMENDATIONS ENGINE
// ============================================

export interface RecommendationsConfig {
  // Thresholds for issue detection
  lowSurvivalThreshold: number;           // Default: 0.9
  highFreezeThreshold: number;            // Default: 0.3
  lowReputationThreshold: number;         // Default: 30
  sybilConfidenceThreshold: number;       // Default: 0.5
  extractionRatioThreshold: number;       // Default: 0.1
}

export const DEFAULT_RECOMMENDATIONS_CONFIG: RecommendationsConfig = {
  lowSurvivalThreshold: 0.9,
  highFreezeThreshold: 0.3,
  lowReputationThreshold: 30,
  sybilConfidenceThreshold: 0.5,
  extractionRatioThreshold: 0.1,
};

/**
 * Generates recommendations based on detected issues
 */
export class RecommendationsEngine {
  private config: RecommendationsConfig;
  private issues: DetectedIssue[] = [];
  private issueIdCounter = 0;

  constructor(config?: Partial<RecommendationsConfig>) {
    this.config = { ...DEFAULT_RECOMMENDATIONS_CONFIG, ...config };
  }

  /**
   * Analyze all inputs and generate issues/recommendations
   */
  analyze(
    healthScore: HealthScore,
    invariantResults: InvariantTestResult[],
    simulationResults: SimulationResult[],
    reputationSignals: ReputationSignal[],
    sybilDetections: SybilDetectionResult[]
  ): DetectedIssue[] {
    this.issues = [];
    this.issueIdCounter = 0;

    // Check invariant failures
    this.analyzeInvariants(invariantResults);

    // Check simulation health
    this.analyzeSimulations(simulationResults);

    // Check reputation concerns
    this.analyzeReputations(reputationSignals);

    // Check Sybil detections
    this.analyzeSybilDetections(sybilDetections);

    // Check overall health
    this.analyzeHealthScore(healthScore);

    return this.issues;
  }

  /**
   * Analyze invariant test results
   */
  private analyzeInvariants(results: InvariantTestResult[]): void {
    for (const result of results) {
      if (result.failedIterations > 0) {
        const severity = this.getInvariantSeverity(result);
        const recommendations = this.getInvariantRecommendations(result);

        this.addIssue({
          category: 'INVARIANT_VIOLATION',
          severity,
          title: `Invariant ${result.id} Failing`,
          description: `${result.failedIterations} failures out of ${result.totalIterations} iterations (${((result.failedIterations / result.totalIterations) * 100).toFixed(2)}% failure rate)`,
          affectedInvariant: result.id,
          recommendations,
        });
      }
    }
  }

  /**
   * Get severity for invariant failure
   */
  private getInvariantSeverity(result: InvariantTestResult): IssueSeverity {
    const failureRate = result.failedIterations / result.totalIterations;

    // Conservation (INV-01) and Floor (INV-02) are critical
    if (result.id === 'INV-01' || result.id === 'INV-02') {
      if (failureRate > 0.01) return 'CRITICAL';
      if (failureRate > 0.001) return 'HIGH';
      return 'MEDIUM';
    }

    // Other invariants
    if (failureRate > 0.05) return 'HIGH';
    if (failureRate > 0.01) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Get recommendations for invariant failures
   */
  private getInvariantRecommendations(result: InvariantTestResult): Recommendation[] {
    const recommendations: Recommendation[] = [];

    switch (result.id) {
      case 'INV-01':
        recommendations.push({
          id: `rec-${this.issueIdCounter++}`,
          action: 'Review transaction processing logic',
          priority: 1,
          effort: 'HIGH',
          description: 'Conservation law violation indicates transaction logic is creating/destroying units. Audit all balance modification paths.',
        });
        recommendations.push({
          id: `rec-${this.issueIdCounter++}`,
          action: 'Add transaction audit logging',
          priority: 2,
          effort: 'MEDIUM',
          description: 'Enable detailed logging of all balance changes to identify the source of conservation violations.',
        });
        break;

      case 'INV-02':
        recommendations.push({
          id: `rec-${this.issueIdCounter++}`,
          action: 'Review floor enforcement',
          priority: 1,
          effort: 'HIGH',
          description: 'Members exceeding their credit floor. Check that all transaction paths validate against floor constraint.',
        });
        recommendations.push({
          id: `rec-${this.issueIdCounter++}`,
          action: 'Audit limit adjustment logic',
          priority: 2,
          effort: 'MEDIUM',
          description: 'Ensure limit reductions properly check current balance before applying.',
        });
        break;

      case 'INV-03':
        recommendations.push({
          id: `rec-${this.issueIdCounter++}`,
          action: 'Review reserve management',
          priority: 1,
          effort: 'MEDIUM',
          description: 'Negative reserves detected. Check escrow release and reserve deduction logic.',
        });
        break;

      case 'INV-04':
        recommendations.push({
          id: `rec-${this.issueIdCounter++}`,
          action: 'Review escrow constraints',
          priority: 1,
          effort: 'MEDIUM',
          description: 'Escrow safety violated. Ensure commitment creation validates available capacity after reserve.',
        });
        break;

      case 'INV-05':
      case 'INV-06':
        recommendations.push({
          id: `rec-${this.issueIdCounter++}`,
          action: 'Review federation transaction logic',
          priority: 1,
          effort: 'HIGH',
          description: 'Federation invariant violated. Audit cross-cell transaction and position tracking.',
        });
        break;
    }

    return recommendations;
  }

  /**
   * Analyze simulation results
   */
  private analyzeSimulations(results: SimulationResult[]): void {
    for (const result of results) {
      const lastMetric = result.finalMetrics ?? result.history[result.history.length - 1];
      if (!lastMetric) continue;

      // Check survival rate
      if (lastMetric.survival.survivalRate < this.config.lowSurvivalThreshold) {
        this.addIssue({
          category: 'LOW_SURVIVAL_RATE',
          severity: lastMetric.survival.survivalRate < 0.7 ? 'CRITICAL' : 'HIGH',
          title: 'Low Member Survival Rate',
          description: `Only ${(lastMetric.survival.survivalRate * 100).toFixed(1)}% of members meeting minimum needs (threshold: ${this.config.lowSurvivalThreshold * 100}%)`,
          recommendations: [
            {
              id: `rec-${this.issueIdCounter++}`,
              action: 'Review resource distribution',
              priority: 1,
              effort: 'HIGH',
              description: 'Analyze which member segments are failing and why. Check if limits are appropriately set.',
            },
            {
              id: `rec-${this.issueIdCounter++}`,
              action: 'Consider emergency protocols',
              priority: 2,
              effort: 'MEDIUM',
              description: 'If survival rate drops during shock events, ensure emergency rationing is properly configured.',
            },
          ],
        });
      }

      // Check for potential freeze (low transaction volume)
      const txPerMember = lastMetric.economic.transactionVolume / lastMetric.survival.totalAgents;
      if (txPerMember < 0.1) {
        this.addIssue({
          category: 'HIGH_FREEZE_PROBABILITY',
          severity: txPerMember < 0.05 ? 'CRITICAL' : 'HIGH',
          title: 'Transaction Freeze Risk',
          description: `Very low transaction volume (${txPerMember.toFixed(2)} per member). Sellers may be refusing transactions.`,
          recommendations: [
            {
              id: `rec-${this.issueIdCounter++}`,
              action: 'Investigate seller confidence',
              priority: 1,
              effort: 'MEDIUM',
              description: 'Survey sellers about their willingness to accept payment. Check if defection concerns are spreading.',
            },
            {
              id: `rec-${this.issueIdCounter++}`,
              action: 'Review commitment escrow rates',
              priority: 2,
              effort: 'MEDIUM',
              description: 'Higher escrow rates may restore seller confidence in transaction completion.',
            },
          ],
        });
      }

      // Check extraction ratio (attacker gains)
      const extraction = lastMetric.economic.defectorExtraction ?? 0;
      const totalCapacity = lastMetric.survival.totalAgents * 1000; // Assuming average 1000 limit
      const extractionRatio = extraction / totalCapacity;

      if (extractionRatio > this.config.extractionRatioThreshold) {
        this.addIssue({
          category: 'HIGH_EXTRACTION',
          severity: extractionRatio > 0.2 ? 'CRITICAL' : 'HIGH',
          title: 'High Attacker Extraction',
          description: `Attackers extracted ${(extractionRatio * 100).toFixed(1)}% of system capacity`,
          recommendations: [
            {
              id: `rec-${this.issueIdCounter++}`,
              action: 'Strengthen admission controls',
              priority: 1,
              effort: 'HIGH',
              description: 'Review sponsor bond requirements and probation periods. Consider increasing bond amounts.',
            },
            {
              id: `rec-${this.issueIdCounter++}`,
              action: 'Enhance defection detection',
              priority: 2,
              effort: 'MEDIUM',
              description: 'Implement earlier warning signals for potential defectors based on behavior patterns.',
            },
          ],
        });
      }
    }
  }

  /**
   * Analyze reputation signals
   */
  private analyzeReputations(signals: ReputationSignal[]): void {
    const lowRepMembers = signals.filter(s => s.score < this.config.lowReputationThreshold);

    if (lowRepMembers.length > 0) {
      const affectedMembers = lowRepMembers.map(s => s.memberId);
      const avgScore = lowRepMembers.reduce((sum, s) => sum + s.score, 0) / lowRepMembers.length;

      this.addIssue({
        category: 'LOW_REPUTATION',
        severity: lowRepMembers.length > 5 ? 'HIGH' : 'MEDIUM',
        title: 'Members with Low Reputation',
        description: `${lowRepMembers.length} members with reputation below ${this.config.lowReputationThreshold} (avg: ${avgScore.toFixed(1)})`,
        affectedMembers,
        recommendations: [
          {
            id: `rec-${this.issueIdCounter++}`,
            action: 'Review low-reputation members',
            priority: 2,
            effort: 'MEDIUM',
            description: 'Manually review members with consistently low reputation scores for potential intervention.',
          },
          {
            id: `rec-${this.issueIdCounter++}`,
            action: 'Consider probation restrictions',
            priority: 3,
            effort: 'LOW',
            description: 'Apply temporary limit restrictions to members with declining reputation trends.',
          },
        ],
      });
    }
  }

  /**
   * Analyze Sybil detection results
   */
  private analyzeSybilDetections(detections: SybilDetectionResult[]): void {
    const likelySybils = detections.filter(
      d => d.isLikelySybil && d.confidence >= this.config.sybilConfidenceThreshold
    );

    if (likelySybils.length > 0) {
      for (const detection of likelySybils) {
        const severity: IssueSeverity =
          detection.confidence >= 0.8 ? 'CRITICAL' :
          detection.confidence >= 0.6 ? 'HIGH' : 'MEDIUM';

        this.addIssue({
          category: 'SYBIL_DETECTED',
          severity,
          title: `Potential Sybil: ${detection.memberId}`,
          description: `Sybil confidence: ${(detection.confidence * 100).toFixed(0)}%. Patterns: ${detection.patterns.map(p => p.type).join(', ')}`,
          affectedMembers: [detection.memberId, ...detection.relatedAccounts],
          recommendations: [
            {
              id: `rec-${this.issueIdCounter++}`,
              action: `${detection.recommendedAction} member ${detection.memberId}`,
              priority: 1,
              effort: detection.recommendedAction === 'INVESTIGATE' ? 'MEDIUM' : 'LOW',
              description: this.getSybilActionDescription(detection.recommendedAction),
            },
          ],
        });
      }
    }
  }

  /**
   * Get description for Sybil action
   */
  private getSybilActionDescription(action: string): string {
    switch (action) {
      case 'INVESTIGATE':
        return 'Manual investigation required. Review sponsor relationship, transaction patterns, and device/network indicators.';
      case 'RESTRICT':
        return 'Apply probation restrictions while investigation proceeds. Reduce limit and require escrowed commitments.';
      case 'MONITOR':
        return 'Add to watch list for ongoing monitoring. No immediate action required but flag for future review.';
      default:
        return 'No specific action required at this time.';
    }
  }

  /**
   * Analyze overall health score
   */
  private analyzeHealthScore(score: HealthScore): void {
    const failingInvariantCount = score.failingInvariants?.length ?? 0;
    const failingScenarioCount = score.failingScenarios?.length ?? 0;

    if (score.status === 'CRITICAL') {
      this.addIssue({
        category: 'SCENARIO_FAILURE',
        severity: 'CRITICAL',
        title: 'System Health Critical',
        description: `Overall health score ${(score.overall * 100).toFixed(1)}% is below critical threshold. ${failingInvariantCount} invariants failing, ${failingScenarioCount} scenarios failing.`,
        recommendations: [
          {
            id: `rec-${this.issueIdCounter++}`,
            action: 'Immediate system review',
            priority: 1,
            effort: 'HIGH',
            description: 'Critical health score requires immediate attention. Review all failing components and prioritize fixes.',
          },
        ],
      });
    } else if (score.status === 'WARNING') {
      this.addIssue({
        category: 'SCENARIO_FAILURE',
        severity: 'MEDIUM',
        title: 'System Health Warning',
        description: `Overall health score ${(score.overall * 100).toFixed(1)}% is below target (85%). Review failing components.`,
        recommendations: [
          {
            id: `rec-${this.issueIdCounter++}`,
            action: 'Address failing components',
            priority: 2,
            effort: 'MEDIUM',
            description: 'Health score below target. Review and address failing invariants and scenarios to improve system resilience.',
          },
        ],
      });
    }
  }

  /**
   * Add an issue to the list
   */
  private addIssue(issue: Omit<DetectedIssue, 'id' | 'detectedAt'>): void {
    this.issues.push({
      ...issue,
      id: `issue-${this.issueIdCounter++}`,
      detectedAt: now(),
    });
  }

  /**
   * Get issues sorted by severity
   */
  getIssuesBySeverity(): DetectedIssue[] {
    const severityOrder: Record<IssueSeverity, number> = {
      'CRITICAL': 0,
      'HIGH': 1,
      'MEDIUM': 2,
      'LOW': 3,
      'INFO': 4,
    };

    return [...this.issues].sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    );
  }

  /**
   * Get issues by category
   */
  getIssuesByCategory(category: IssueCategory): DetectedIssue[] {
    return this.issues.filter(i => i.category === category);
  }

  /**
   * Get critical issues only
   */
  getCriticalIssues(): DetectedIssue[] {
    return this.issues.filter(i => i.severity === 'CRITICAL');
  }

  /**
   * Get all recommendations sorted by priority
   */
  getAllRecommendations(): Recommendation[] {
    const allRecs: Recommendation[] = [];
    for (const issue of this.issues) {
      allRecs.push(...issue.recommendations);
    }
    return allRecs.sort((a, b) => a.priority - b.priority);
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create a recommendations engine
 */
export function createRecommendationsEngine(
  config?: Partial<RecommendationsConfig>
): RecommendationsEngine {
  return new RecommendationsEngine(config);
}
