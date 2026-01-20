/**
 * Cell Protocol - Hardening: Health Score
 *
 * Computes overall health score from invariant, simulation, and adversarial results.
 * Target: >= 0.85
 */

import {
  HealthScore,
  HealthScoreComponents,
  InvariantId,
  AdversarialScenarioId,
} from '../types/validation';
import { InvariantTestResult } from '../types/invariant';
import { SimulationResult } from '../types/simulation';
import { now } from '../../types/common';

// ============================================
// HEALTH SCORE CALCULATOR
// ============================================

export interface HealthScoreConfig {
  // Component weights (must sum to 1.0)
  invariantWeight: number;    // Default: 0.4
  simulationWeight: number;   // Default: 0.3
  adversarialWeight: number;  // Default: 0.3

  // Simulation sub-weights
  survivalWeight: number;     // Default: 0.5
  freezeWeight: number;       // Default: 0.5

  // Thresholds
  passingThreshold: number;   // Default: 0.85
  warningThreshold: number;   // Default: 0.70
}

export const DEFAULT_HEALTH_SCORE_CONFIG: HealthScoreConfig = {
  invariantWeight: 0.4,
  simulationWeight: 0.3,
  adversarialWeight: 0.3,
  survivalWeight: 0.5,
  freezeWeight: 0.5,
  passingThreshold: 0.85,
  warningThreshold: 0.70,
};

/**
 * Calculates health score from test results
 */
export class HealthScoreCalculator {
  private config: HealthScoreConfig;

  constructor(config?: Partial<HealthScoreConfig>) {
    this.config = { ...DEFAULT_HEALTH_SCORE_CONFIG, ...config };
  }

  /**
   * Calculate overall health score
   *
   * Formula:
   *   healthScore = invariantScore * 0.4 + simScore * 0.3 + advScore * 0.3
   *
   * Where:
   *   invariantScore = (passing invariants / total invariants)
   *   simScore = survivalRate * 0.5 + (1 - freezeProb) * 0.5
   *   advScore = (passing scenarios / total scenarios)
   */
  calculate(
    invariantResults: InvariantTestResult[],
    simulationResults: SimulationResult[],
    adversarialResults: Map<AdversarialScenarioId, boolean>
  ): HealthScore {
    // Calculate component scores
    const invariantScore = this.calculateInvariantScore(invariantResults);
    const simulationScore = this.calculateSimulationScore(simulationResults);
    const adversarialScore = this.calculateAdversarialScore(adversarialResults);

    // Calculate weighted overall score, normalizing weights for skipped components
    // If a component has no results (e.g., adversarial tests skipped), redistribute its weight
    let invWeight = invariantResults.length > 0 ? this.config.invariantWeight : 0;
    let simWeight = simulationResults.length > 0 ? this.config.simulationWeight : 0;
    let advWeight = adversarialResults.size > 0 ? this.config.adversarialWeight : 0;

    const totalWeight = invWeight + simWeight + advWeight;
    if (totalWeight > 0) {
      invWeight = invWeight / totalWeight;
      simWeight = simWeight / totalWeight;
      advWeight = advWeight / totalWeight;
    }

    const overall =
      invariantScore.score * invWeight +
      simulationScore.score * simWeight +
      adversarialScore.score * advWeight;

    // Determine status
    let status: HealthScore['status'];
    if (overall >= this.config.passingThreshold) {
      status = 'HEALTHY';
    } else if (overall >= this.config.warningThreshold) {
      status = 'WARNING';
    } else {
      status = 'CRITICAL';
    }

    // Collect failing invariants
    const failingInvariants = invariantResults
      .filter(r => r.failedIterations > 0)
      .map(r => r.id);

    // Collect failing scenarios
    const failingScenarios: AdversarialScenarioId[] = [];
    for (const [id, passed] of adversarialResults) {
      if (!passed) {
        failingScenarios.push(id);
      }
    }

    const components: HealthScoreComponents = {
      invariantScore: invariantScore.score,
      simulationScore: simulationScore.score,
      adversarialScore: adversarialScore.score,
      // Alternative naming for compatibility
      invariants: invariantScore.score,
      simulation: simulationScore.score,
      adversarial: adversarialScore.score,
    };

    return {
      overall,
      components,
      status,
      computedAt: now(),
      passesThreshold: overall >= this.config.passingThreshold,
      issueCount: failingInvariants.length + failingScenarios.length,
      criticalIssueCount: failingInvariants.length, // Invariant failures are critical
      details: {
        invariantsPassing: invariantScore.passing,
        invariantsTotal: invariantScore.total,
        survivalRate: simulationScore.survivalRate,
        freezeProbability: simulationScore.freezeProbability,
        scenariosPassing: adversarialScore.passing,
        scenariosTotal: adversarialScore.total,
      },
      failingInvariants,
      failingScenarios,
    };
  }

  /**
   * Calculate invariant component score
   */
  private calculateInvariantScore(results: InvariantTestResult[]): {
    score: number;
    passing: number;
    total: number;
  } {
    if (results.length === 0) {
      return { score: 0, passing: 0, total: 0 };
    }

    const passing = results.filter(r => r.failedIterations === 0).length;
    const total = results.length;
    const score = passing / total;

    return { score, passing, total };
  }

  /**
   * Calculate simulation component score
   *
   * simScore = survivalRate * 0.5 + (1 - freezeProb) * 0.5
   */
  private calculateSimulationScore(results: SimulationResult[]): {
    score: number;
    survivalRate: number;
    freezeProbability: number;
  } {
    if (results.length === 0) {
      return { score: 0.5, survivalRate: 0.5, freezeProbability: 0.5 };
    }

    // Average survival rate across simulations
    const survivalRates = results.map(r => {
      // Use finalMetrics or the last entry in history
      const lastMetric = r.finalMetrics ?? r.history[r.history.length - 1];
      return lastMetric?.survival.survivalRate ?? 0.5;
    });
    const avgSurvivalRate = survivalRates.reduce((a, b) => a + b, 0) / survivalRates.length;

    // Average freeze probability (seller acceptance collapse)
    // Lower freeze probability = healthier system
    // This heuristic estimates freeze risk from transaction activity
    const freezeProbs = results.map(r => {
      // Use finalMetrics or the last entry in history
      const lastMetric = r.finalMetrics ?? r.history[r.history.length - 1];
      // If transaction volume drops significantly, consider it a freeze
      const txVolume = lastMetric?.economic.transactionVolume ?? 0;
      const memberCount = lastMetric?.survival.totalAgents ?? 1;
      // Heuristic: tx volume per member indicates activity level
      // Simulation agents average ~0.5-2 tx/member over full run
      const txPerMember = txVolume / memberCount;
      // More lenient thresholds to avoid penalizing healthy simulations
      if (txPerMember < 0.01) return 0.7;  // Almost no activity
      if (txPerMember < 0.1) return 0.4;   // Very low activity
      if (txPerMember < 0.3) return 0.2;   // Low activity
      return 0.1;                           // Healthy activity
    });
    const avgFreezeProb = freezeProbs.reduce((a, b) => a + b, 0) / freezeProbs.length;

    const score =
      avgSurvivalRate * this.config.survivalWeight +
      (1 - avgFreezeProb) * this.config.freezeWeight;

    return {
      score,
      survivalRate: avgSurvivalRate,
      freezeProbability: avgFreezeProb,
    };
  }

  /**
   * Calculate adversarial component score
   */
  private calculateAdversarialScore(results: Map<AdversarialScenarioId, boolean>): {
    score: number;
    passing: number;
    total: number;
  } {
    if (results.size === 0) {
      return { score: 0, passing: 0, total: 0 };
    }

    let passing = 0;
    for (const passed of results.values()) {
      if (passed) passing++;
    }

    const total = results.size;
    const score = passing / total;

    return { score, passing, total };
  }

  /**
   * Check if health score is passing
   */
  isPassing(score: HealthScore): boolean {
    return score.overall >= this.config.passingThreshold;
  }

  /**
   * Get score status label
   */
  getStatusLabel(score: HealthScore): string {
    switch (score.status) {
      case 'HEALTHY':
        return 'System Healthy';
      case 'WARNING':
        return 'Warning - Issues Detected';
      case 'CRITICAL':
        return 'Critical - Intervention Required';
      default:
        return 'Unknown';
    }
  }

  /**
   * Get summary of failing components
   */
  getFailingSummary(score: HealthScore): string[] {
    const issues: string[] = [];

    if (score.failingInvariants && score.failingInvariants.length > 0) {
      issues.push(`Failing invariants: ${score.failingInvariants.join(', ')}`);
    }

    if (score.failingScenarios && score.failingScenarios.length > 0) {
      issues.push(`Failing scenarios: ${score.failingScenarios.join(', ')}`);
    }

    if (score.details) {
      if (score.details.survivalRate < 0.9) {
        issues.push(`Low survival rate: ${(score.details.survivalRate * 100).toFixed(1)}%`);
      }
      if (score.details.freezeProbability > 0.3) {
        issues.push(`High freeze probability: ${(score.details.freezeProbability * 100).toFixed(1)}%`);
      }
    }

    return issues;
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create a health score calculator
 */
export function createHealthScoreCalculator(
  config?: Partial<HealthScoreConfig>
): HealthScoreCalculator {
  return new HealthScoreCalculator(config);
}
