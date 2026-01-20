/**
 * Cell Protocol - Hardening: Reporter
 *
 * Generates validation reports and dashboard state.
 */

import { Timestamp, now } from '../../types/common';
import {
  ValidationReport,
  DashboardState,
  HealthScore,
  DetectedIssue,
  InvariantId,
  AdversarialScenarioId,
} from '../types/validation';
import { InvariantTestResult, InvariantSummary } from '../types/invariant';
import { SimulationResult, SimulationSummary } from '../types/simulation';

// ============================================
// REPORTER
// ============================================

export interface ReporterConfig {
  // Report metadata
  version: string;
  environment: 'development' | 'staging' | 'production';

  // Report options
  includeDetails: boolean;
  includeRawResults: boolean;
  maxIssuesPerCategory: number;
}

export const DEFAULT_REPORTER_CONFIG: ReporterConfig = {
  version: '1.0.0',
  environment: 'development',
  includeDetails: true,
  includeRawResults: false,
  maxIssuesPerCategory: 10,
};

/**
 * Generates validation reports
 */
export class Reporter {
  private config: ReporterConfig;

  constructor(config?: Partial<ReporterConfig>) {
    this.config = { ...DEFAULT_REPORTER_CONFIG, ...config };
  }

  /**
   * Generate a full validation report
   */
  generateReport(
    healthScore: HealthScore,
    invariantResults: InvariantTestResult[],
    simulationResults: SimulationResult[],
    adversarialResults: Map<AdversarialScenarioId, { passed: boolean; details: string }>,
    issues: DetectedIssue[]
  ): ValidationReport {
    const timestamp = now();

    // Build invariant summary
    const invariantSummary = this.buildInvariantSummary(invariantResults);

    // Build simulation summary
    const simulationSummary = this.buildSimulationSummary(simulationResults);

    // Build adversarial summary
    const adversarialSummary = this.buildAdversarialSummary(adversarialResults);

    // Determine overall pass/fail
    const passed = healthScore.status === 'HEALTHY' &&
      invariantSummary.allPassing &&
      adversarialSummary.allPassing;

    // Build report summary
    const summary = {
      status: passed ? 'PASS' as const : (healthScore.status === 'WARNING' ? 'WARN' as const : 'FAIL' as const),
      healthScore: healthScore.overall,
      totalTests: invariantSummary.totalCount + adversarialSummary.totalScenarios,
      testsPassed: invariantSummary.passingCount + adversarialSummary.passingScenarios,
      testsFailed: (invariantSummary.totalCount - invariantSummary.passingCount) +
        (adversarialSummary.totalScenarios - adversarialSummary.passingScenarios),
      criticalIssues: issues.filter(i => i.severity === 'CRITICAL').length,
      highIssues: issues.filter(i => i.severity === 'HIGH').length,
      keyFindings: [] as string[],
      nextSteps: [] as string[],
    };

    return {
      timestamp,
      version: this.config.version,
      environment: this.config.environment,
      healthScore,
      invariantSummary,
      simulationSummary,
      adversarialSummary,
      issues: this.limitIssues(issues),
      passed,
      summary,
    };
  }

  /**
   * Build invariant summary
   */
  private buildInvariantSummary(results: InvariantTestResult[]): InvariantSummary {
    const totalIterations = results.reduce((sum, r) => sum + r.totalIterations, 0);
    const totalFailures = results.reduce((sum, r) => sum + r.failedIterations, 0);
    const passingCount = results.filter(r => r.failedIterations === 0).length;
    const totalCount = results.length;

    const byInvariant: Record<string, { iterations: number; failures: number; passing: boolean }> = {};
    for (const result of results) {
      byInvariant[result.id] = {
        iterations: result.totalIterations,
        failures: result.failedIterations,
        passing: result.failedIterations === 0,
      };
    }

    return {
      totalIterations,
      totalFailures,
      passingCount,
      totalCount,
      allPassing: totalFailures === 0,
      byInvariant,
    };
  }

  /**
   * Build simulation summary
   */
  private buildSimulationSummary(results: SimulationResult[]): SimulationSummary {
    if (results.length === 0) {
      return {
        minSurvivalRate: 0,
        avgSurvivalRate: 0,
        finalSurvivalRate: 0,
        freezeProbability: 0,
        totalExtraction: 0,
        contagionSize: 0,
        invariantsMaintained: true,
        invariantViolations: 0,
        passedCriteria: false,
        simulationsRun: 0,
        avgFreezeProbability: 0,
        avgExtraction: 0,
        worstSurvivalRate: 0,
        meetsTargets: false,
      };
    }

    const survivalRates = results.map(r => {
      const lastMetric = r.finalMetrics ?? r.history[r.history.length - 1];
      return lastMetric?.survival.survivalRate ?? 0;
    });

    const freezeProbs = results.map(r => {
      const lastMetric = r.finalMetrics ?? r.history[r.history.length - 1];
      const txVolume = lastMetric?.economic.transactionVolume ?? 0;
      const memberCount = lastMetric?.survival.totalAgents ?? 1;
      const txPerMember = txVolume / memberCount;
      return txPerMember < 0.1 ? 0.8 : txPerMember < 0.5 ? 0.4 : 0.1;
    });

    const extractions = results.map(r => {
      const lastMetric = r.finalMetrics ?? r.history[r.history.length - 1];
      return lastMetric?.economic.defectorExtraction ?? 0;
    });

    const avgSurvivalRate = survivalRates.reduce((a, b) => a + b, 0) / survivalRates.length;
    const avgFreezeProbability = freezeProbs.reduce((a, b) => a + b, 0) / freezeProbs.length;
    const avgExtraction = extractions.reduce((a, b) => a + b, 0) / extractions.length;
    const worstSurvivalRate = Math.min(...survivalRates);

    return {
      minSurvivalRate: worstSurvivalRate,
      avgSurvivalRate,
      finalSurvivalRate: survivalRates[survivalRates.length - 1] ?? 0,
      freezeProbability: avgFreezeProbability,
      totalExtraction: extractions.reduce((a, b) => a + b, 0),
      contagionSize: 0,
      invariantsMaintained: true,
      invariantViolations: 0,
      passedCriteria: avgSurvivalRate >= 0.9 && avgFreezeProbability <= 0.3,
      simulationsRun: results.length,
      avgFreezeProbability,
      avgExtraction,
      worstSurvivalRate,
      meetsTargets: avgSurvivalRate >= 0.9 && avgFreezeProbability <= 0.3,
    };
  }

  /**
   * Build adversarial summary
   */
  private buildAdversarialSummary(
    results: Map<AdversarialScenarioId, { passed: boolean; details: string }>
  ): {
    totalScenarios: number;
    passingScenarios: number;
    failingScenarios: AdversarialScenarioId[];
    allPassing: boolean;
    byScenario: Record<string, { passed: boolean; details: string }>;
  } {
    const failingScenarios: AdversarialScenarioId[] = [];
    const byScenario: Record<string, { passed: boolean; details: string }> = {};

    let passingCount = 0;
    for (const [id, result] of results) {
      byScenario[id] = result;
      if (result.passed) {
        passingCount++;
      } else {
        failingScenarios.push(id);
      }
    }

    return {
      totalScenarios: results.size,
      passingScenarios: passingCount,
      failingScenarios,
      allPassing: failingScenarios.length === 0,
      byScenario,
    };
  }

  /**
   * Limit issues per category
   */
  private limitIssues(issues: DetectedIssue[]): DetectedIssue[] {
    const byCategory = new Map<string, DetectedIssue[]>();

    for (const issue of issues) {
      const existing = byCategory.get(issue.category) ?? [];
      if (existing.length < this.config.maxIssuesPerCategory) {
        existing.push(issue);
        byCategory.set(issue.category, existing);
      }
    }

    const result: DetectedIssue[] = [];
    for (const categoryIssues of byCategory.values()) {
      result.push(...categoryIssues);
    }

    return result;
  }

  /**
   * Generate dashboard state
   */
  generateDashboardState(
    report: ValidationReport
  ): DashboardState {
    const criticalIssues = report.issues.filter(i => i.severity === 'CRITICAL');
    const highIssues = report.issues.filter(i => i.severity === 'HIGH');

    // Calculate trend (would need historical data in real implementation)
    const trend: DashboardState['trend'] = 'STABLE';

    // Get summary data with defaults
    const invSummary = report.invariantSummary ?? { passingCount: 0, totalCount: 0 };
    const simSummary = report.simulationSummary ?? { avgSurvivalRate: 0 };
    const advSummary = report.adversarialSummary ?? { passingScenarios: 0, totalScenarios: 0 };

    return {
      healthScore: report.healthScore,
      lastUpdated: report.timestamp,
      criticalIssueCount: criticalIssues.length,
      highIssueCount: highIssues.length,
      trend,
      topIssues: report.issues.slice(0, 5),
      quickStats: {
        invariantsPassing: `${invSummary.passingCount}/${invSummary.totalCount}`,
        survivalRate: `${(simSummary.avgSurvivalRate * 100).toFixed(1)}%`,
        scenariosPassing: `${advSummary.passingScenarios}/${advSummary.totalScenarios}`,
        activeIssues: report.issues.length,
      },
    };
  }

  /**
   * Format report as text
   */
  formatAsText(report: ValidationReport): string {
    const lines: string[] = [];

    // Get summary data with defaults
    const invSummary = report.invariantSummary ?? { totalIterations: 0, totalFailures: 0, passingCount: 0, totalCount: 0, allPassing: true, byInvariant: {} };
    const simSummary = report.simulationSummary ?? { simulationsRun: 0, avgSurvivalRate: 0, worstSurvivalRate: 0, avgFreezeProbability: 0, meetsTargets: false };
    const advSummary = report.adversarialSummary ?? { passingScenarios: 0, totalScenarios: 0, failingScenarios: [], allPassing: true, byScenario: {} };
    const components = report.healthScore.components;

    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('                    CELL PROTOCOL VALIDATION REPORT');
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('');

    // Health Score
    lines.push('HEALTH SCORE');
    lines.push('────────────');
    lines.push(`  Overall:      ${(report.healthScore.overall * 100).toFixed(1)}% (${report.healthScore.status ?? 'UNKNOWN'})`);
    lines.push(`  Invariants:   ${((components.invariants ?? components.invariantScore) * 100).toFixed(1)}%`);
    lines.push(`  Simulation:   ${((components.simulation ?? components.simulationScore) * 100).toFixed(1)}%`);
    lines.push(`  Adversarial:  ${((components.adversarial ?? components.adversarialScore) * 100).toFixed(1)}%`);
    lines.push('');

    // Invariants
    lines.push('INVARIANT TESTS');
    lines.push('───────────────');
    lines.push(`  Total Iterations: ${invSummary.totalIterations.toLocaleString()}`);
    lines.push(`  Total Failures:   ${invSummary.totalFailures}`);
    lines.push(`  Passing:          ${invSummary.passingCount}/${invSummary.totalCount}`);
    lines.push('');
    lines.push('  By Invariant:');
    for (const [id, data] of Object.entries(invSummary.byInvariant)) {
      const status = data.passing ? '✓' : '✗';
      lines.push(`    ${status} ${id}: ${data.iterations.toLocaleString()} iterations, ${data.failures} failures`);
    }
    lines.push('');

    // Simulations
    lines.push('SIMULATION RESULTS');
    lines.push('──────────────────');
    lines.push(`  Simulations Run:    ${simSummary.simulationsRun ?? 0}`);
    lines.push(`  Avg Survival Rate:  ${(simSummary.avgSurvivalRate * 100).toFixed(1)}%`);
    lines.push(`  Worst Survival:     ${((simSummary.worstSurvivalRate ?? 0) * 100).toFixed(1)}%`);
    lines.push(`  Freeze Probability: ${((simSummary.avgFreezeProbability ?? 0) * 100).toFixed(1)}%`);
    lines.push(`  Meets Targets:      ${simSummary.meetsTargets ? 'Yes' : 'No'}`);
    lines.push('');

    // Adversarial
    lines.push('ADVERSARIAL SCENARIOS');
    lines.push('─────────────────────');
    lines.push(`  Passing: ${advSummary.passingScenarios}/${advSummary.totalScenarios}`);
    if (advSummary.failingScenarios.length > 0) {
      lines.push(`  Failing: ${advSummary.failingScenarios.join(', ')}`);
    }
    lines.push('');
    lines.push('  By Scenario:');
    for (const [id, data] of Object.entries(advSummary.byScenario)) {
      const status = data.passed ? '✓' : '✗';
      lines.push(`    ${status} ${id}: ${data.details}`);
    }
    lines.push('');

    // Issues
    if (report.issues.length > 0) {
      lines.push('DETECTED ISSUES');
      lines.push('───────────────');
      for (const issue of report.issues) {
        lines.push(`  [${issue.severity}] ${issue.title}`);
        lines.push(`    ${issue.description}`);
        if (issue.recommendations.length > 0) {
          lines.push(`    Recommendations:`);
          for (const rec of issue.recommendations) {
            lines.push(`      • ${rec.action}`);
          }
        }
        lines.push('');
      }
    }

    // Final Verdict
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push(`  FINAL VERDICT: ${report.passed ? 'PASS ✓' : 'FAIL ✗'}`);
    lines.push('═══════════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Format report as JSON
   */
  formatAsJson(report: ValidationReport): string {
    return JSON.stringify(report, null, 2);
  }

  /**
   * Format report as Markdown
   */
  formatAsMarkdown(report: ValidationReport): string {
    const lines: string[] = [];

    // Get summary data with defaults
    const invSummary = report.invariantSummary ?? { totalIterations: 0, totalFailures: 0, passingCount: 0, totalCount: 0, allPassing: true, byInvariant: {} };
    const simSummary = report.simulationSummary ?? { simulationsRun: 0, avgSurvivalRate: 0, worstSurvivalRate: 0, avgFreezeProbability: 0, meetsTargets: false };
    const advSummary = report.adversarialSummary ?? { passingScenarios: 0, totalScenarios: 0, failingScenarios: [], allPassing: true, byScenario: {} };
    const components = report.healthScore.components;

    lines.push('# Cell Protocol Validation Report');
    lines.push('');
    lines.push(`**Generated:** ${new Date(report.timestamp ?? Date.now()).toISOString()}`);
    lines.push(`**Version:** ${report.version ?? 'unknown'}`);
    lines.push(`**Environment:** ${report.environment ?? 'development'}`);
    lines.push('');

    // Health Score
    lines.push('## Health Score');
    lines.push('');
    lines.push(`| Component | Score |`);
    lines.push(`|-----------|-------|`);
    lines.push(`| **Overall** | **${(report.healthScore.overall * 100).toFixed(1)}%** (${report.healthScore.status ?? 'UNKNOWN'}) |`);
    lines.push(`| Invariants | ${((components.invariants ?? components.invariantScore) * 100).toFixed(1)}% |`);
    lines.push(`| Simulation | ${((components.simulation ?? components.simulationScore) * 100).toFixed(1)}% |`);
    lines.push(`| Adversarial | ${((components.adversarial ?? components.adversarialScore) * 100).toFixed(1)}% |`);
    lines.push('');

    // Invariants
    lines.push('## Invariant Tests');
    lines.push('');
    lines.push(`- **Total Iterations:** ${invSummary.totalIterations.toLocaleString()}`);
    lines.push(`- **Failures:** ${invSummary.totalFailures}`);
    lines.push(`- **Status:** ${invSummary.allPassing ? '✅ All Passing' : '❌ Some Failing'}`);
    lines.push('');
    lines.push('| Invariant | Iterations | Failures | Status |');
    lines.push('|-----------|------------|----------|--------|');
    for (const [id, data] of Object.entries(invSummary.byInvariant)) {
      const status = data.passing ? '✅' : '❌';
      lines.push(`| ${id} | ${data.iterations.toLocaleString()} | ${data.failures} | ${status} |`);
    }
    lines.push('');

    // Simulations
    lines.push('## Simulation Results');
    lines.push('');
    lines.push(`- **Simulations Run:** ${simSummary.simulationsRun ?? 0}`);
    lines.push(`- **Avg Survival Rate:** ${(simSummary.avgSurvivalRate * 100).toFixed(1)}%`);
    lines.push(`- **Worst Survival:** ${((simSummary.worstSurvivalRate ?? 0) * 100).toFixed(1)}%`);
    lines.push(`- **Freeze Probability:** ${((simSummary.avgFreezeProbability ?? 0) * 100).toFixed(1)}%`);
    lines.push(`- **Meets Targets:** ${simSummary.meetsTargets ? '✅ Yes' : '❌ No'}`);
    lines.push('');

    // Adversarial
    lines.push('## Adversarial Scenarios');
    lines.push('');
    lines.push(`**Passing:** ${advSummary.passingScenarios}/${advSummary.totalScenarios}`);
    lines.push('');
    lines.push('| Scenario | Status | Details |');
    lines.push('|----------|--------|---------|');
    for (const [id, data] of Object.entries(advSummary.byScenario)) {
      const status = data.passed ? '✅' : '❌';
      lines.push(`| ${id} | ${status} | ${data.details} |`);
    }
    lines.push('');

    // Issues
    if (report.issues.length > 0) {
      lines.push('## Detected Issues');
      lines.push('');
      for (const issue of report.issues) {
        const severityEmoji: Record<string, string> = {
          'CRITICAL': '🔴',
          'HIGH': '🟠',
          'MEDIUM': '🟡',
          'LOW': '🟢',
          'INFO': '🔵',
        };
        const emoji = severityEmoji[issue.severity] ?? '⚪';
        lines.push(`### ${emoji} ${issue.title}`);
        lines.push('');
        lines.push(`**Severity:** ${issue.severity}`);
        lines.push('');
        lines.push(issue.description);
        lines.push('');
        if (issue.recommendations.length > 0) {
          lines.push('**Recommendations:**');
          for (const rec of issue.recommendations) {
            lines.push(`- ${rec.action} (${rec.effort} effort)`);
          }
          lines.push('');
        }
      }
    }

    // Final Verdict
    lines.push('---');
    lines.push('');
    lines.push(`## Final Verdict: ${report.passed ? '✅ PASS' : '❌ FAIL'}`);

    return lines.join('\n');
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create a reporter
 */
export function createReporter(config?: Partial<ReporterConfig>): Reporter {
  return new Reporter(config);
}
