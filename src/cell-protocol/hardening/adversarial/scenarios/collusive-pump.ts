/**
 * Cell Protocol - Hardening: ADV-03 Collusive Pump
 *
 * Scenario: 5 colluders attempt to inflate their mutual
 * credit limits through coordinated transactions.
 *
 * Success Criteria:
 * - limitInflation <= eta * 20 (2x baseline)
 * - invariants maintained
 */

import { AdversarialScenario, AdversarialScenarioId } from '../../types/validation';

export const COLLUSIVE_PUMP_SCENARIO: AdversarialScenario = {
  id: 'ADV-03' as AdversarialScenarioId,
  name: 'Collusive Pump',
  description: `
    Tests resistance against coordinated limit inflation attacks.

    Attack Pattern:
    1. 5 colluders form a ring
    2. Execute circular transactions to appear active
    3. Mutual commitments and fulfillments to inflate reputation
    4. Use inflated reputation to request limit increases
    5. Extract value using inflated limits

    Defense Mechanisms Tested:
    - Limit change governance (requires council approval)
    - Transaction pattern analysis
    - Commitment validation
    - Ring detection algorithms
  `,
  setup: {
    memberCount: 50,
    attackerCount: 5,
    ticks: 100,
    customParams: {
      colluderRingSize: 5,
      targetLimitIncrease: 200, // Try to double limits
    },
  },
  successCriteria: {
    // Limit inflation should be contained
    // eta = governance threshold, assume 20% allowed
    // max inflation = 1 + 0.2 * 2 = 1.4x, round to 2x
    maxLimitInflation: 2.0,

    // Core invariants must hold
    invariantsHold: ['INV-01', 'INV-02'],
  },
};

/**
 * Analysis of collusive pump attack
 */
export interface CollusivePumpAnalysis {
  /** Number of colluders in ring */
  ringSize: number;
  /** Total transactions within ring */
  intraRingTransactions: number;
  /** Total transactions outside ring */
  externalTransactions: number;
  /** Ratio of internal to external (high = suspicious) */
  internalTransactionRatio: number;
  /** Limit increases requested */
  limitIncreaseRequests: number;
  /** Limit increases approved */
  limitIncreasesApproved: number;
  /** Average limit before attack */
  avgLimitBefore: number;
  /** Average limit after attack */
  avgLimitAfter: number;
  /** Limit inflation factor */
  limitInflation: number;
  /** Ring detected */
  ringDetected: boolean;
}

/**
 * Detect potential collusion ring
 * Uses transaction graph analysis
 */
export function detectCollusionRing(
  transactionGraph: Map<string, Map<string, number>>
): {
  detected: boolean;
  ringMembers: string[];
  confidence: number;
} {
  // Simple heuristic: look for strongly connected components
  // with high mutual transaction volumes

  const suspiciousGroups: string[][] = [];
  const visited = new Set<string>();

  // Find clusters with high internal transaction ratios
  for (const [nodeA, edges] of transactionGraph) {
    if (visited.has(nodeA)) continue;

    const cluster = [nodeA];
    visited.add(nodeA);

    // Find tightly connected neighbors
    for (const [nodeB, volume] of edges) {
      if (visited.has(nodeB)) continue;

      const reverseVolume = transactionGraph.get(nodeB)?.get(nodeA) ?? 0;

      // High bidirectional volume suggests coordination
      if (volume > 100 && reverseVolume > 100) {
        cluster.push(nodeB);
        visited.add(nodeB);
      }
    }

    if (cluster.length >= 3) {
      suspiciousGroups.push(cluster);
    }
  }

  if (suspiciousGroups.length === 0) {
    return { detected: false, ringMembers: [], confidence: 0 };
  }

  // Return largest suspicious group
  const largestGroup = suspiciousGroups.reduce(
    (a, b) => a.length > b.length ? a : b
  );

  // Confidence based on group size and transaction patterns
  const confidence = Math.min(1, largestGroup.length / 5 * 0.8);

  return {
    detected: largestGroup.length >= 3,
    ringMembers: largestGroup,
    confidence,
  };
}

/**
 * Calculate internal transaction ratio for a group
 */
export function calculateInternalRatio(
  groupMembers: Set<string>,
  transactions: Array<{ from: string; to: string; amount: number }>
): number {
  let internal = 0;
  let total = 0;

  for (const tx of transactions) {
    if (groupMembers.has(tx.from) || groupMembers.has(tx.to)) {
      total += tx.amount;
      if (groupMembers.has(tx.from) && groupMembers.has(tx.to)) {
        internal += tx.amount;
      }
    }
  }

  return total > 0 ? internal / total : 0;
}

/**
 * Evaluate collusive pump scenario
 */
export function evaluateCollusivePump(
  limitInflation: number,
  invariantsHold: boolean,
  maxInflation: number
): {
  passed: boolean;
  score: number;
  analysis: string;
} {
  const inflationOk = limitInflation <= maxInflation;
  const passed = inflationOk && invariantsHold;

  // Score based on how well inflation was contained
  const inflationScore = inflationOk
    ? 1 - ((limitInflation - 1) / (maxInflation - 1))
    : 0;
  const invariantScore = invariantsHold ? 1 : 0;
  const score = inflationScore * 0.7 + invariantScore * 0.3;

  let analysis = '';
  if (passed) {
    analysis = `Collusive pump contained: inflation ${limitInflation.toFixed(2)}x (max ${maxInflation}x), invariants OK`;
  } else {
    if (!inflationOk) {
      analysis += `Limit inflation too high: ${limitInflation.toFixed(2)}x > ${maxInflation}x. `;
    }
    if (!invariantsHold) {
      analysis += 'Invariant violations detected. ';
    }
  }

  return { passed, score, analysis };
}
