/**
 * Cell Protocol - Hardening: ADV-02 Sybil Infiltration
 *
 * Scenario: Attacker with limited budget attempts to create
 * multiple fake identities to extract value.
 *
 * Success Criteria:
 * - admittedSybils <= 5
 * - extraction <= 5 * L (5 sybil identities * limit)
 */

import { AdversarialScenario, AdversarialScenarioId } from '../../types/validation';

export const SYBIL_INFILTRATION_SCENARIO: AdversarialScenario = {
  id: 'ADV-02' as AdversarialScenarioId,
  name: 'Sybil Infiltration',
  description: `
    Tests Sybil resistance mechanisms against identity multiplication attacks.

    Attack Pattern:
    1. Attacker has a budget of 500 units
    2. Attempts to create multiple identities
    3. Each identity requires sponsor bond or service bond
    4. Coordinates between sybil identities to extract value

    Defense Mechanisms Tested:
    - Sponsor bonds (sponsor risks their own limit)
    - Service bonds (must earn before spending)
    - Probation period (reduced limits initially)
    - Sybil detection patterns
  `,
  setup: {
    memberCount: 50,
    attackerBudget: 500,
    ticks: 50,
    customParams: {
      targetSybils: 10, // Attacker wants 10 identities
      bondRequirement: 50, // Bond required per identity
    },
  },
  successCriteria: {
    // At most 5 sybil identities should be admitted
    maxAdmittedSybils: 5,

    // Extraction limited to 5 * default limit
    maxExtractionFraction: 0.1, // 5 * 100 / 5000 = 10%
  },
};

/**
 * Analysis of Sybil attack attempt
 */
export interface SybilAnalysis {
  /** Number of sybil identities attempted */
  sybilsAttempted: number;
  /** Number successfully admitted */
  sybilsAdmitted: number;
  /** Number blocked by sponsor bond requirement */
  blockedByBond: number;
  /** Number blocked by service bond */
  blockedByService: number;
  /** Number detected by pattern analysis */
  detectedAsSybil: number;
  /** Total budget consumed */
  budgetConsumed: number;
  /** Total extraction by sybil identities */
  sybilExtraction: number;
  /** Detection confidence scores */
  detectionScores: Map<string, number>;
}

/**
 * Calculate cost per sybil identity
 * Includes: sponsor bond + any initial capital needed
 */
export function calculateSybilCost(
  sponsorBondFraction: number,
  serviceBondHours: number,
  hourlyRate: number,
  defaultLimit: number
): number {
  // Sponsor must lock up fraction of their limit
  const sponsorBondCost = defaultLimit * sponsorBondFraction;

  // Service bond requires earning before spending
  // Cost in time/opportunity
  const serviceCost = serviceBondHours * hourlyRate;

  return sponsorBondCost + serviceCost;
}

/**
 * Calculate maximum sybils possible with budget
 */
export function maxSybilsWithBudget(
  budget: number,
  costPerSybil: number
): number {
  return Math.floor(budget / costPerSybil);
}

/**
 * Evaluate sybil resistance effectiveness
 */
export function evaluateSybilResistance(
  admitted: number,
  extraction: number,
  maxAdmitted: number,
  maxExtraction: number
): {
  passed: boolean;
  score: number;
  analysis: string;
} {
  const admissionOk = admitted <= maxAdmitted;
  const extractionOk = extraction <= maxExtraction;
  const passed = admissionOk && extractionOk;

  // Score based on how well sybils were blocked
  const admissionScore = admissionOk
    ? 1 - (admitted / maxAdmitted)
    : 0;
  const extractionScore = extractionOk
    ? 1 - (extraction / maxExtraction)
    : 0;
  const score = (admissionScore * 0.6 + extractionScore * 0.4);

  let analysis = '';
  if (passed) {
    analysis = `Sybil attack contained: ${admitted}/${maxAdmitted} admitted, extraction ${extraction}/${maxExtraction}`;
  } else {
    if (!admissionOk) {
      analysis += `Too many sybils admitted: ${admitted} > ${maxAdmitted}. `;
    }
    if (!extractionOk) {
      analysis += `Sybil extraction too high: ${extraction} > ${maxExtraction}. `;
    }
  }

  return { passed, score, analysis };
}

/**
 * Sybil detection heuristics
 */
export interface SybilDetectionHeuristics {
  /** Similar transaction patterns between accounts */
  transactionPatternSimilarity: number;
  /** Coordinated timing of actions */
  timingCorrelation: number;
  /** Shared sponsor (all sybils have same sponsor) */
  sharedSponsor: boolean;
  /** Rapid sequential account creation */
  rapidCreation: boolean;
  /** Mutual transactions (washing) */
  mutualTransactionRatio: number;
}

/**
 * Calculate sybil probability from heuristics
 */
export function calculateSybilProbability(
  heuristics: SybilDetectionHeuristics
): number {
  let score = 0;

  // Each heuristic contributes to suspicion
  if (heuristics.transactionPatternSimilarity > 0.8) score += 0.3;
  if (heuristics.timingCorrelation > 0.9) score += 0.25;
  if (heuristics.sharedSponsor) score += 0.2;
  if (heuristics.rapidCreation) score += 0.15;
  if (heuristics.mutualTransactionRatio > 0.5) score += 0.1;

  return Math.min(1, score);
}
