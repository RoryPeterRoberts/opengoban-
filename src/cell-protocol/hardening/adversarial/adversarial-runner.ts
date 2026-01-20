/**
 * Cell Protocol - Hardening: Adversarial Runner
 *
 * Executes adversarial scenarios and evaluates success criteria.
 * Coordinates attack simulations and collects results.
 */

import { now } from '../../types/common';
import { TaskCategory } from '../../types/commitment';
import {
  AdversarialScenarioId,
  AdversarialScenario,
  AdversarialScenarioResult,
  AdversarialSuiteResult,
  AdversarialSetup,
  AdversarialCriteria,
} from '../types/validation';
import { SimulationResult, AgentDistribution } from '../types/simulation';
import { SimulationEngine, createSimulationEngine } from '../simulation/simulation-engine';

// ============================================
// SCENARIO DEFINITIONS
// ============================================

/** Get all adversarial scenario definitions */
export function getAllScenarios(): AdversarialScenario[] {
  return [
    {
      id: 'ADV-01',
      name: 'Exit Scam Wave',
      description: '20% of members defect simultaneously after building up positive balances',
      setup: {
        memberCount: 80,
        attackerPercentage: 0.2,
        ticks: 100,
      },
      successCriteria: {
        maxExtractionFraction: 0.2, // extraction <= 0.2 * N * L
        minSurvivalRate: 0.7,
        invariantsHold: ['INV-01', 'INV-02'],
      },
    },
    {
      id: 'ADV-02',
      name: 'Sybil Infiltration',
      description: 'Attacker with budget 500 attempts to create multiple identities',
      setup: {
        memberCount: 50,
        attackerBudget: 500,
        ticks: 50,
        customParams: { targetSybils: 10 },
      },
      successCriteria: {
        maxAdmittedSybils: 5,
        maxExtractionFraction: 0.1, // extraction <= 5 * L
      },
    },
    {
      id: 'ADV-03',
      name: 'Collusive Pump',
      description: '5 colluders attempt to inflate mutual credit limits',
      setup: {
        memberCount: 50,
        attackerCount: 5,
        ticks: 100,
        customParams: { colluderRingSize: 5 },
      },
      successCriteria: {
        maxLimitInflation: 2.0, // Limit inflation <= eta * 20 (2x baseline)
        invariantsHold: ['INV-01', 'INV-02'],
      },
    },
    {
      id: 'ADV-04',
      name: 'Resource Shock',
      description: '50% resource availability drop tests emergency response',
      setup: {
        memberCount: 80,
        ticks: 100,
        customParams: { resourceReduction: 0.5 },
      },
      successCriteria: {
        minSurvivalRate: 0.9,
        invariantsHold: ['INV-01', 'INV-02', 'INV-03', 'INV-04'],
      },
    },
    {
      id: 'ADV-05',
      name: 'Federation Severance',
      description: '5 federated cells have all links severed',
      setup: {
        memberCount: 50,
        cellCount: 5,
        ticks: 100,
      },
      successCriteria: {
        invariantsHold: ['INV-01', 'INV-02', 'INV-05', 'INV-06'],
        maxLoss: 300, // Loss <= beta * Lambda
      },
    },
    {
      id: 'ADV-06',
      name: 'Intermittent Connectivity',
      description: '10% partition probability tests network resilience',
      setup: {
        memberCount: 50,
        cellCount: 3,
        ticks: 100,
        customParams: { partitionProbability: 0.1 },
      },
      successCriteria: {
        invariantsHold: ['INV-01', 'INV-02'],
        minSurvivalRate: 0.85,
      },
    },
    {
      id: 'ADV-07',
      name: 'Governance Capture',
      description: '3 infiltrators attempt to gain governance positions',
      setup: {
        memberCount: 50,
        attackerCount: 3,
        ticks: 100,
      },
      successCriteria: {
        invariantsHold: ['INV-01', 'INV-02'],
        minSurvivalRate: 0.9,
      },
    },
  ];
}

/** Get scenario by ID */
export function getScenario(id: AdversarialScenarioId): AdversarialScenario | undefined {
  return getAllScenarios().find(s => s.id === id);
}

// ============================================
// ADVERSARIAL RUNNER
// ============================================

/**
 * Adversarial Scenario Runner
 * Executes attack scenarios and evaluates results
 */
export class AdversarialRunner {
  private onProgress?: (scenarioId: AdversarialScenarioId, progress: string) => void;

  /**
   * Set progress callback
   */
  setProgressCallback(
    callback: (scenarioId: AdversarialScenarioId, progress: string) => void
  ): void {
    this.onProgress = callback;
  }

  /**
   * Run a single adversarial scenario
   */
  async runScenario(scenario: AdversarialScenario): Promise<AdversarialScenarioResult> {
    const startTime = Date.now();
    const log: string[] = [];

    this.log(scenario.id, `Starting scenario: ${scenario.name}`, log);

    try {
      // Build simulation configuration based on scenario
      const simConfig = this.buildSimulationConfig(scenario);
      const engine = createSimulationEngine(simConfig);

      // Run simulation
      this.log(scenario.id, 'Running simulation...', log);
      const simResult = await engine.run();

      // Evaluate criteria
      this.log(scenario.id, 'Evaluating criteria...', log);
      const evaluation = this.evaluateCriteria(scenario.successCriteria, simResult, scenario.setup);

      const durationMs = Date.now() - startTime;
      this.log(scenario.id, `Completed in ${durationMs}ms - ${evaluation.passed ? 'PASSED' : 'FAILED'}`, log);

      return {
        scenarioId: scenario.id,
        passed: evaluation.passed,
        actualValues: evaluation.actualValues,
        criteriaValues: evaluation.criteriaValues,
        violations: evaluation.violations,
        simulationResult: simResult,
        durationMs,
        log,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.log(scenario.id, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`, log);

      return {
        scenarioId: scenario.id,
        passed: false,
        actualValues: {},
        criteriaValues: {},
        violations: [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`],
        durationMs,
        log,
      };
    }
  }

  /**
   * Run all adversarial scenarios
   */
  async runAll(
    scenarios?: AdversarialScenarioId[]
  ): Promise<AdversarialSuiteResult> {
    const startedAt = now();
    const scenariosToRun = scenarios
      ? getAllScenarios().filter(s => scenarios.includes(s.id))
      : getAllScenarios();

    const results: AdversarialScenarioResult[] = [];

    for (const scenario of scenariosToRun) {
      const result = await this.runScenario(scenario);
      results.push(result);
    }

    const completedAt = now();
    const passedCount = results.filter(r => r.passed).length;

    return {
      results,
      passRate: passedCount / results.length,
      allPassed: passedCount === results.length,
      totalDurationMs: completedAt - startedAt,
      startedAt,
      completedAt,
    };
  }

  /**
   * Build simulation config from scenario
   */
  private buildSimulationConfig(scenario: AdversarialScenario): Parameters<typeof createSimulationEngine>[0] {
    const { setup } = scenario;
    const memberCount = setup.memberCount;
    const cellCount = setup.cellCount ?? 1;
    const attackerCount = setup.attackerCount ??
      (setup.attackerPercentage ? Math.floor(memberCount * setup.attackerPercentage) : 0);

    // Calculate agent distribution based on scenario
    const agentDistribution = this.calculateAgentDistribution(scenario.id, memberCount, attackerCount);

    // Build cells config
    const cells = Array.from({ length: cellCount }, (_, i) => ({
      id: `cell-${i}`,
      initialMembers: Math.floor(memberCount / cellCount),
      defaultLimit: 100,
      federationBeta: 0.3,
    }));

    // Build shocks based on scenario
    const shocks = this.buildShocks(scenario);

    return {
      id: `adversarial-${scenario.id}`,
      ticks: setup.ticks,
      seed: 42,
      cells,
      agentDistribution,
      shocks,
      federationEnabled: cellCount > 1,
      tradeFrequency: 2,
      commitmentFrequency: 0.5,
    };
  }

  /**
   * Calculate agent distribution for scenario
   */
  private calculateAgentDistribution(
    scenarioId: AdversarialScenarioId,
    totalMembers: number,
    attackerCount: number
  ): AgentDistribution {
    // Base distribution
    const base = {
      cooperators: Math.floor(totalMembers * 0.6),
      conditional: Math.floor(totalMembers * 0.2),
      defectors: 0,
      shirkers: Math.floor(totalMembers * 0.05),
      colluders: 0,
      sybils: 0,
    };

    // Adjust based on scenario
    switch (scenarioId) {
      case 'ADV-01': // Exit Scam Wave
        base.defectors = attackerCount;
        base.cooperators -= attackerCount;
        break;

      case 'ADV-02': // Sybil Infiltration
        base.sybils = attackerCount;
        base.cooperators -= attackerCount;
        break;

      case 'ADV-03': // Collusive Pump
        base.colluders = attackerCount;
        base.cooperators -= attackerCount;
        break;

      case 'ADV-07': // Governance Capture
        base.defectors = attackerCount;
        base.cooperators -= attackerCount;
        break;

      default:
        // Default distribution for other scenarios
        break;
    }

    // Ensure no negative values
    base.cooperators = Math.max(0, base.cooperators);

    return base;
  }

  /**
   * Build shocks for scenario
   */
  private buildShocks(scenario: AdversarialScenario): Parameters<typeof createSimulationEngine>[0]['shocks'] {
    const shocks: Parameters<typeof createSimulationEngine>[0]['shocks'] = [];
    const { setup } = scenario;

    switch (scenario.id) {
      case 'ADV-01': // Exit Scam Wave
        shocks.push({
          type: 'DEFECTION_WAVE',
          tick: Math.floor(setup.ticks * 0.5), // Mid-simulation
          intensity: 1,
          duration: 0,
          parameters: {
            type: 'DEFECTION_WAVE',
            defectionRate: setup.attackerPercentage ?? 0.2,
          },
        });
        break;

      case 'ADV-02': // Sybil Infiltration
        shocks.push({
          type: 'SYBIL_INFILTRATION',
          tick: 10,
          intensity: 1,
          duration: setup.ticks - 10,
          parameters: {
            type: 'SYBIL_INFILTRATION',
            budget: setup.attackerBudget ?? 500,
            targetCount: (setup.customParams?.targetSybils as number) ?? 10,
          },
        });
        break;

      case 'ADV-04': // Resource Shock
        shocks.push({
          type: 'RESOURCE_SCARCITY',
          tick: 20,
          intensity: 0.5,
          duration: 50,
          parameters: {
            type: 'RESOURCE_SCARCITY',
            affectedCategories: [TaskCategory.FOOD, TaskCategory.ENERGY_HEAT],
            reductionFactor: (setup.customParams?.resourceReduction as number) ?? 0.5,
          },
        });
        break;

      case 'ADV-05': // Federation Severance
        shocks.push({
          type: 'FEDERATION_SEVERANCE',
          tick: 30,
          intensity: 1,
          duration: 40,
          parameters: {
            type: 'FEDERATION_SEVERANCE',
          },
        });
        break;

      case 'ADV-06': // Intermittent Connectivity
        shocks.push({
          type: 'CONNECTIVITY_LOSS',
          tick: 10,
          intensity: 1,
          duration: setup.ticks - 20,
          parameters: {
            type: 'CONNECTIVITY_LOSS',
            partitionProbability: (setup.customParams?.partitionProbability as number) ?? 0.1,
          },
        });
        break;

      case 'ADV-07': // Governance Capture
        shocks.push({
          type: 'GOVERNANCE_CAPTURE',
          tick: 10,
          intensity: 1,
          duration: 0,
          parameters: {
            type: 'GOVERNANCE_CAPTURE',
            infiltratorCount: setup.attackerCount ?? 3,
            highReputation: true,
          },
        });
        break;
    }

    return shocks;
  }

  /**
   * Evaluate success criteria
   */
  private evaluateCriteria(
    criteria: AdversarialCriteria,
    result: SimulationResult,
    setup: AdversarialSetup
  ): {
    passed: boolean;
    actualValues: Record<string, number>;
    criteriaValues: Record<string, number>;
    violations: string[];
  } {
    const actualValues: Record<string, number> = {};
    const criteriaValues: Record<string, number> = {};
    const violations: string[] = [];

    // Check max extraction
    if (criteria.maxExtraction !== undefined) {
      actualValues['extraction'] = result.summary.totalExtraction;
      criteriaValues['maxExtraction'] = criteria.maxExtraction;
      if (result.summary.totalExtraction > criteria.maxExtraction) {
        violations.push(`Extraction ${result.summary.totalExtraction} exceeds max ${criteria.maxExtraction}`);
      }
    }

    // Check max extraction as fraction
    if (criteria.maxExtractionFraction !== undefined) {
      const totalCapacity = setup.memberCount * 100; // Assume 100 default limit
      const maxExtraction = criteria.maxExtractionFraction * totalCapacity;
      actualValues['extraction'] = result.summary.totalExtraction;
      criteriaValues['maxExtractionFraction'] = maxExtraction;
      if (result.summary.totalExtraction > maxExtraction) {
        violations.push(`Extraction ${result.summary.totalExtraction} exceeds ${(criteria.maxExtractionFraction * 100).toFixed(0)}% of capacity (${maxExtraction})`);
      }
    }

    // Check min survival rate
    if (criteria.minSurvivalRate !== undefined) {
      actualValues['survivalRate'] = result.summary.finalSurvivalRate;
      criteriaValues['minSurvivalRate'] = criteria.minSurvivalRate;
      if (result.summary.finalSurvivalRate < criteria.minSurvivalRate) {
        violations.push(`Survival rate ${(result.summary.finalSurvivalRate * 100).toFixed(1)}% below minimum ${(criteria.minSurvivalRate * 100).toFixed(0)}%`);
      }
    }

    // Check max admitted sybils
    if (criteria.maxAdmittedSybils !== undefined) {
      const sybilCount = Array.from(result.agentStates.keys())
        .filter(id => id.startsWith('sybil-')).length;
      actualValues['admittedSybils'] = sybilCount;
      criteriaValues['maxAdmittedSybils'] = criteria.maxAdmittedSybils;
      if (sybilCount > criteria.maxAdmittedSybils) {
        violations.push(`Admitted sybils ${sybilCount} exceeds max ${criteria.maxAdmittedSybils}`);
      }
    }

    // Check max limit inflation
    if (criteria.maxLimitInflation !== undefined) {
      // Calculate average limit inflation
      const avgLimit = Array.from(result.agentStates.values())
        .reduce((sum, s) => sum + s.limit, 0) / result.agentStates.size;
      const inflation = avgLimit / 100; // Compare to default 100
      actualValues['limitInflation'] = inflation;
      criteriaValues['maxLimitInflation'] = criteria.maxLimitInflation;
      if (inflation > criteria.maxLimitInflation) {
        violations.push(`Limit inflation ${inflation.toFixed(2)}x exceeds max ${criteria.maxLimitInflation}x`);
      }
    }

    // Check max loss
    if (criteria.maxLoss !== undefined) {
      // Simplified: use extraction as proxy for loss
      actualValues['loss'] = result.summary.totalExtraction;
      criteriaValues['maxLoss'] = criteria.maxLoss;
      if (result.summary.totalExtraction > criteria.maxLoss) {
        violations.push(`Loss ${result.summary.totalExtraction} exceeds max ${criteria.maxLoss}`);
      }
    }

    // Check invariants
    if (criteria.invariantsHold) {
      actualValues['invariantViolations'] = result.summary.invariantViolations;
      criteriaValues['invariantsRequired'] = criteria.invariantsHold.length;
      if (result.summary.invariantViolations > 0) {
        violations.push(`${result.summary.invariantViolations} invariant violations detected`);
      }
    }

    return {
      passed: violations.length === 0,
      actualValues,
      criteriaValues,
      violations,
    };
  }

  /**
   * Log progress
   */
  private log(scenarioId: AdversarialScenarioId, message: string, log: string[]): void {
    log.push(`[${new Date().toISOString()}] ${message}`);
    if (this.onProgress) {
      this.onProgress(scenarioId, message);
    }
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create an adversarial runner
 */
export function createAdversarialRunner(): AdversarialRunner {
  return new AdversarialRunner();
}
