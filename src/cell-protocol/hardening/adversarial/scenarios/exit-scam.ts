/**
 * Cell Protocol - Hardening: ADV-01 Exit Scam Wave
 *
 * Scenario: 20% of members defect simultaneously after building
 * up positive balances, attempting to extract maximum value.
 *
 * Success Criteria:
 * - extraction <= 0.2 * N * L
 * - survival rate >= 70%
 */

import { AdversarialScenario, AdversarialScenarioId } from '../../types/validation';

export const EXIT_SCAM_SCENARIO: AdversarialScenario = {
  id: 'ADV-01' as AdversarialScenarioId,
  name: 'Exit Scam Wave',
  description: `
    Tests system resilience against coordinated defection.

    Attack Pattern:
    1. Defectors join as normal members
    2. Build positive balances by receiving payments
    3. At threshold, all defectors simultaneously:
       - Stop fulfilling commitments
       - Attempt to extract remaining capacity
       - Exit the system

    Defense Mechanisms Tested:
    - Floor constraints prevent over-extraction
    - Escrow protects pending commitments
    - Emergency mode triggers on high floor mass
  `,
  setup: {
    memberCount: 80,
    attackerPercentage: 0.2, // 20% defectors (16 agents)
    ticks: 100,
    customParams: {
      defectionTick: 50, // Defect midway through simulation
      targetBalance: 150, // Build up balance before defecting
    },
  },
  successCriteria: {
    // Extraction limited to 20% of total capacity (N * L)
    // With 80 members at 100 limit = 8000 capacity
    // Max extraction = 1600
    maxExtractionFraction: 0.2,

    // At least 70% of honest members survive
    minSurvivalRate: 0.7,

    // Core invariants must hold
    invariantsHold: ['INV-01', 'INV-02'],
  },
};

/**
 * Detailed analysis of exit scam attack
 */
export interface ExitScamAnalysis {
  /** Total value extracted by defectors */
  totalExtraction: number;
  /** Number of defectors that successfully extracted */
  successfulDefectors: number;
  /** Average extraction per defector */
  avgExtractionPerDefector: number;
  /** Time when defection wave occurred */
  defectionTick: number;
  /** System state before defection */
  preDefectionState: {
    avgBalance: number;
    defectorAvgBalance: number;
    totalCapacity: number;
  };
  /** System state after defection */
  postDefectionState: {
    avgBalance: number;
    frozenAccounts: number;
    emergencyModeTriggered: boolean;
  };
  /** Defenses that activated */
  defensesTriggered: string[];
}

/**
 * Calculate maximum theoretical extraction
 * Each defector can extract at most their balance + limit
 * But conservation law means they can only extract what others have
 */
export function calculateMaxExtraction(
  memberCount: number,
  defectorPercentage: number,
  defaultLimit: number
): number {
  const defectorCount = Math.floor(memberCount * defectorPercentage);
  const honestCount = memberCount - defectorCount;

  // Defectors can only extract what honest members have available
  // Honest members collectively have (honestCount * defaultLimit) capacity
  // But defectors need counterparties to transact with
  // Actual extraction limited by:
  // 1. Defector's own capacity (limit)
  // 2. Counterparty capacity
  // 3. Conservation law

  // Worst case: each defector extracts their full limit
  return defectorCount * defaultLimit;
}

/**
 * Evaluate exit scam scenario result
 */
export function evaluateExitScam(
  extraction: number,
  survivalRate: number,
  memberCount: number,
  defectorPercentage: number,
  defaultLimit: number
): {
  passed: boolean;
  score: number;
  analysis: string;
} {
  const maxAllowedExtraction = memberCount * defaultLimit * 0.2;
  const minSurvivalRate = 0.7;

  const extractionOk = extraction <= maxAllowedExtraction;
  const survivalOk = survivalRate >= minSurvivalRate;
  const passed = extractionOk && survivalOk;

  // Score based on how much better than threshold
  const extractionScore = extractionOk
    ? 1 - (extraction / maxAllowedExtraction)
    : 0;
  const survivalScore = survivalOk
    ? (survivalRate - minSurvivalRate) / (1 - minSurvivalRate)
    : 0;
  const score = (extractionScore + survivalScore) / 2;

  let analysis = '';
  if (passed) {
    analysis = `Exit scam contained: extraction ${(extraction / maxAllowedExtraction * 100).toFixed(1)}% of limit, survival ${(survivalRate * 100).toFixed(1)}%`;
  } else {
    if (!extractionOk) {
      analysis += `Extraction exceeded limit: ${extraction} > ${maxAllowedExtraction}. `;
    }
    if (!survivalOk) {
      analysis += `Survival rate too low: ${(survivalRate * 100).toFixed(1)}% < 70%. `;
    }
  }

  return { passed, score, analysis };
}
