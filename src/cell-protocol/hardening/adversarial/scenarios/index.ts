/**
 * Cell Protocol - Hardening: Adversarial Scenarios Index
 *
 * Exports all adversarial scenario definitions.
 */

export * from './exit-scam';
export * from './sybil-infiltration';
export * from './collusive-pump';

// Re-export all scenario constants for easy access
import { EXIT_SCAM_SCENARIO } from './exit-scam';
import { SYBIL_INFILTRATION_SCENARIO } from './sybil-infiltration';
import { COLLUSIVE_PUMP_SCENARIO } from './collusive-pump';
import { AdversarialScenario, AdversarialScenarioId } from '../../types/validation';

/**
 * ADV-04: Resource Shock
 * Tests emergency response to 50% resource availability drop
 */
export const RESOURCE_SHOCK_SCENARIO: AdversarialScenario = {
  id: 'ADV-04' as AdversarialScenarioId,
  name: 'Resource Shock',
  description: `
    Tests system response to sudden resource scarcity.

    Shock Pattern:
    1. Normal operation for 20 ticks
    2. 50% reduction in resource availability
    3. System must trigger emergency protocols
    4. Rationing plan should activate
    5. Recovery as resources return

    Defense Mechanisms Tested:
    - Emergency mode detection
    - PANIC state transitions
    - Rationing plan generation
    - Humanitarian floor protection
  `,
  setup: {
    memberCount: 80,
    ticks: 100,
    customParams: {
      resourceReduction: 0.5,
      shockStart: 20,
      shockDuration: 50,
    },
  },
  successCriteria: {
    minSurvivalRate: 0.9,
    invariantsHold: ['INV-01', 'INV-02', 'INV-03', 'INV-04'],
  },
};

/**
 * ADV-05: Federation Severance
 * Tests resilience when all federation links are cut
 */
export const FEDERATION_SEVERANCE_SCENARIO: AdversarialScenario = {
  id: 'ADV-05' as AdversarialScenarioId,
  name: 'Federation Severance',
  description: `
    Tests system behavior when federation network is partitioned.

    Attack Pattern:
    1. 5 cells in federation network
    2. All inter-cell links severed
    3. Cells must operate independently
    4. Outstanding obligations must be handled

    Defense Mechanisms Tested:
    - Federation quarantine
    - Internal transaction validity
    - Position limits maintained
  `,
  setup: {
    memberCount: 50,
    cellCount: 5,
    ticks: 100,
  },
  successCriteria: {
    invariantsHold: ['INV-01', 'INV-02', 'INV-05', 'INV-06'],
    maxLoss: 300, // Loss <= beta * Lambda (assuming 1000 capacity, 30% beta)
  },
};

/**
 * ADV-06: Intermittent Connectivity
 * Tests resilience under network instability
 */
export const INTERMITTENT_CONNECTIVITY_SCENARIO: AdversarialScenario = {
  id: 'ADV-06' as AdversarialScenarioId,
  name: 'Intermittent Connectivity',
  description: `
    Tests system under unstable network conditions.

    Disruption Pattern:
    1. 10% probability of partition each tick
    2. Partitions heal after random duration
    3. Messages may be delayed or lost
    4. System must maintain consistency

    Defense Mechanisms Tested:
    - Eventual consistency
    - Transaction retry logic
    - State reconciliation
  `,
  setup: {
    memberCount: 50,
    cellCount: 3,
    ticks: 100,
    customParams: {
      partitionProbability: 0.1,
    },
  },
  successCriteria: {
    invariantsHold: ['INV-01', 'INV-02'],
    minSurvivalRate: 0.85,
  },
};

/**
 * ADV-07: Governance Capture
 * Tests resistance to infiltrator control of governance
 */
export const GOVERNANCE_CAPTURE_SCENARIO: AdversarialScenario = {
  id: 'ADV-07' as AdversarialScenarioId,
  name: 'Governance Capture',
  description: `
    Tests system resilience when infiltrators gain council positions.

    Attack Pattern:
    1. 3 infiltrators join as normal members
    2. Build reputation through service
    3. Seek election to governance council
    4. Attempt to manipulate rules in their favor

    Defense Mechanisms Tested:
    - Council quorum requirements
    - Proposal veto mechanisms
    - Constitutional constraints
    - Emergency council dissolution
  `,
  setup: {
    memberCount: 50,
    attackerCount: 3,
    ticks: 100,
  },
  successCriteria: {
    invariantsHold: ['INV-01', 'INV-02'],
    minSurvivalRate: 0.9,
  },
};

/**
 * All scenarios in order
 */
export const ALL_SCENARIOS: AdversarialScenario[] = [
  EXIT_SCAM_SCENARIO,
  SYBIL_INFILTRATION_SCENARIO,
  COLLUSIVE_PUMP_SCENARIO,
  RESOURCE_SHOCK_SCENARIO,
  FEDERATION_SEVERANCE_SCENARIO,
  INTERMITTENT_CONNECTIVITY_SCENARIO,
  GOVERNANCE_CAPTURE_SCENARIO,
];

/**
 * Get scenario by ID
 */
export function getScenarioById(id: AdversarialScenarioId): AdversarialScenario | undefined {
  return ALL_SCENARIOS.find(s => s.id === id);
}
