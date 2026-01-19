# PRD-10: Security & Validation Suite

## Document Information
- **Version**: 1.0
- **Status**: Draft
- **Dependencies**: All other PRDs
- **Dependents**: None (Final integration)

---

## 1. Overview

The Security & Validation Suite provides the testing infrastructure to prove the protocol works under adversarial conditions. It includes invariant tests, economic simulations, and adversarial scenarios.

### Validation Layers
1. **Invariant Tests**: Mathematical properties that must always hold
2. **Economic Dynamics**: Agent-based simulation of behavior
3. **Adversarial Resilience**: Specific attack scenarios

---

## 2. Security Objectives

### 2.1 Formal Objectives

| ID | Objective | Description |
|----|-----------|-------------|
| S1 | Loss Boundedness | Max extraction per identity bounded by L |
| S2 | Attack Scalability Control | Multi-identity attack bounded by S*L |
| S3 | Contagion Resistance | Cell failure doesn't collapse federation |
| S4 | Censorship Tolerance | No single technical/social choke point |

### 2.2 Theorems to Validate

```typescript
interface TheoremStatement {
  id: string;
  statement: string;
  assumptions: string[];
  conclusion: string;
  testSuite: string;
}

const CORE_THEOREMS: TheoremStatement[] = [
  {
    id: 'T1',
    statement: 'Cell Conservation',
    assumptions: [
      'All state transitions via T1, C1 rules',
      'No external value injection'
    ],
    conclusion: 'SUM(b_i) = 0 for all t',
    testSuite: 'invariant_conservation'
  },
  {
    id: 'T2',
    statement: 'Bounded Individual Extraction',
    assumptions: [
      'Member starts at b_i(t0)',
      'Limit L_i(t0) at start',
      'Exclusion at b_i = -L_i'
    ],
    conclusion: 'G_i <= b_i(t0) + L_i(t0)',
    testSuite: 'extraction_bounds'
  },
  {
    id: 'T3',
    statement: 'Bounded Multi-Identity Extraction',
    assumptions: [
      'Attacker controls S admitted identities',
      'All start near b_i = 0'
    ],
    conclusion: 'G_total <= S * L',
    testSuite: 'sybil_bounds'
  },
  {
    id: 'T4',
    statement: 'Federation Contagion Bound',
    assumptions: [
      'Exposure cap |B_k| <= beta * Lambda_k enforced',
      'Cell k severed from federation'
    ],
    conclusion: 'Max loss to cell k from severance <= beta * Lambda_k',
    testSuite: 'federation_severability'
  }
];
```

---

## 3. Invariant Test Suite

### 3.1 Property-Based Tests

```typescript
interface InvariantTest {
  id: string;
  property: string;
  generator: () => Operation[];
  checker: (state: CellState) => boolean;
  iterations: number;
}

const INVARIANT_TESTS: InvariantTest[] = [
  {
    id: 'INV-01',
    property: 'Conservation holds after any valid operation sequence',
    generator: generateRandomOperations,
    checker: (state) => Math.abs(sumBalances(state)) < 0.001,
    iterations: 100000
  },
  {
    id: 'INV-02',
    property: 'No balance breaches floor after any valid operation',
    generator: generateRandomOperations,
    checker: (state) => state.members.every(m => m.balance >= -m.limit),
    iterations: 100000
  },
  {
    id: 'INV-03',
    property: 'Reserves are always non-negative',
    generator: generateCommitmentOperations,
    checker: (state) => state.members.every(m => m.reserve >= 0),
    iterations: 50000
  },
  {
    id: 'INV-04',
    property: 'Escrow safety: available >= -limit',
    generator: generateCommitmentOperations,
    checker: (state) => state.members.every(m =>
      m.balance - m.reserve >= -m.limit
    ),
    iterations: 50000
  },
  {
    id: 'INV-05',
    property: 'Federation position sum is zero',
    generator: generateFederationOperations,
    checker: (state) => Math.abs(sumFederationPositions(state)) < 0.001,
    iterations: 50000
  },
  {
    id: 'INV-06',
    property: 'Federation cap never exceeded',
    generator: generateFederationOperations,
    checker: (state) => state.cells.every(c =>
      Math.abs(c.federationPosition) <= c.exposureCap
    ),
    iterations: 50000
  }
];
```

### 3.2 Test Execution

```typescript
async function runInvariantSuite(): Promise<InvariantTestResults> {
  const results: InvariantTestResult[] = [];

  for (const test of INVARIANT_TESTS) {
    console.log(`Running ${test.id}: ${test.property}`);

    let failures = 0;
    let failureExamples: any[] = [];

    for (let i = 0; i < test.iterations; i++) {
      const state = createFreshState();
      const operations = test.generator();

      for (const op of operations) {
        applyOperation(state, op);
      }

      if (!test.checker(state)) {
        failures++;
        if (failureExamples.length < 5) {
          failureExamples.push({ iteration: i, operations, finalState: state });
        }
      }
    }

    results.push({
      testId: test.id,
      property: test.property,
      iterations: test.iterations,
      failures,
      failureRate: failures / test.iterations,
      passed: failures === 0,
      failureExamples
    });
  }

  return {
    totalTests: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results
  };
}
```

---

## 4. Economic Simulation Suite

### 4.1 Agent Model

```typescript
interface SimulatedAgent {
  id: string;
  strategy: AgentStrategy;
  needs: NeedsVector;
  skills: SkillVector;
  laborSupply: number;
  balanceHistory: number[];
  actions: AgentAction[];
}

type AgentStrategy =
  | 'COOPERATOR'              // Always cooperates
  | 'CONDITIONAL'             // Tit-for-tat, reputation-threshold
  | 'DEFECTOR'                // Defects optimally then exits
  | 'SHIRKER'                 // Provides low quality, delays
  | 'COLLUDER'                // Coordinates with other colluders
  | 'SYBIL';                  // Attempts multiple identities

interface NeedsVector {
  food: number;
  energy: number;
  shelter: number;
  medical: number;
  childcare: number;
}

interface SkillVector {
  cooking: number;
  farming: number;
  repair: number;
  medical: number;
  transport: number;
}
```

### 4.2 Simulation Environment

```typescript
interface SimulationEnvironment {
  cells: SimulatedCell[];
  federationLinks: FederationLink[];
  shocks: ScheduledShock[];
  globalTime: number;
  parameters: SimulationParameters;
}

interface ScheduledShock {
  time: number;
  type: ShockType;
  magnitude: number;
  target?: string;
}

type ShockType =
  | 'RESOURCE_SCARCITY'       // Food/energy supply drops
  | 'DEFECTION_WAVE'          // X% of agents switch to defect
  | 'FEDERATION_SEVERANCE'    // Cut federation links
  | 'SYBIL_INFILTRATION'      // Attacker admits multiple identities
  | 'GOVERNANCE_CAPTURE'      // Colluders gain council seats
  | 'CONNECTIVITY_LOSS';      // Network partitions
```

### 4.3 Metrics

```typescript
interface SimulationMetrics {
  // Survival metrics
  survivalRate: number;               // Fraction meeting min needs
  timeToFailure: number;              // Periods until first death
  roleCoverageFeasibility: number;    // % of periods with feasible allocation

  // Market/ledger metrics
  transactionThroughput: number;
  floorMassSeries: number[];
  varianceSeries: number[];
  freezeProbability: number;          // Seller acceptance collapse

  // Security metrics
  totalAttackerExtraction: number;
  timeToDetection: number;
  damagePerSybil: number;
  contagionSize: number;              // Cells affected by failure

  // Governance metrics
  disputeRate: number;
  resolutionLatency: number;
  expulsionRate: number;
}
```

### 4.4 Simulation Execution

```typescript
async function runSimulation(
  config: SimulationConfig
): Promise<SimulationResults> {
  const env = createEnvironment(config);

  for (let t = 0; t < config.maxPeriods; t++) {
    // Apply scheduled shocks
    applyShocks(env, t);

    // Each agent takes actions
    for (const cell of env.cells) {
      for (const agent of cell.agents) {
        const action = agent.strategy.decide(cell.state, agent);
        executeAction(cell, agent, action);
      }
    }

    // Run scheduler
    for (const cell of env.cells) {
      runScheduler(cell);
    }

    // Check emergency mode
    for (const cell of env.cells) {
      updateEmergencyState(cell);
    }

    // Process federation
    processFederationTransactions(env);

    // Record metrics
    recordPeriodMetrics(env, t);

    // Check termination conditions
    if (checkTermination(env)) break;
  }

  return compileResults(env);
}
```

---

## 5. Adversarial Test Scenarios

### 5.1 Scenario Definitions

```typescript
interface AdversarialScenario {
  id: string;
  name: string;
  description: string;
  setup: ScenarioSetup;
  attackSequence: AttackStep[];
  successCriteria: SuccessCriterion[];
}

const ADVERSARIAL_SCENARIOS: AdversarialScenario[] = [
  {
    id: 'ADV-01',
    name: 'Exit Scam Wave',
    description: 'X% of agents simultaneously defect',
    setup: { cellSize: 80, defectorFraction: 0.2 },
    attackSequence: [
      { time: 10, action: 'MASS_DEFECTION' }
    ],
    successCriteria: [
      { metric: 'totalExtraction', operator: '<=', value: '0.2 * N * L' },
      { metric: 'survivalRate', operator: '>=', value: 0.7 }
    ]
  },
  {
    id: 'ADV-02',
    name: 'Sybil Infiltration',
    description: 'Attacker attempts to maximize admitted identities',
    setup: { cellSize: 80, attackerBudget: 500 },
    attackSequence: [
      { time: 0, action: 'BEGIN_SYBIL_ATTACK', params: { rate: 2 } }
    ],
    successCriteria: [
      { metric: 'admittedSybils', operator: '<=', value: 5 },
      { metric: 'totalExtraction', operator: '<=', value: '5 * L' }
    ]
  },
  {
    id: 'ADV-03',
    name: 'Collusive Pump',
    description: 'Ring attempts to inflate each other\'s limits',
    setup: { cellSize: 80, colluderCount: 5 },
    attackSequence: [
      { time: 0, action: 'FORM_COLLUSION_RING' },
      { time: 5, action: 'MUTUAL_REPUTATION_INFLATION' },
      { time: 20, action: 'COORDINATED_EXTRACTION' }
    ],
    successCriteria: [
      { metric: 'limitInflation', operator: '<=', value: 'eta * 20' },
      { metric: 'totalExtraction', operator: '<=', value: '5 * L_max' }
    ]
  },
  {
    id: 'ADV-04',
    name: 'Resource Shock',
    description: 'Food/energy availability drops 50%',
    setup: { cellSize: 80, resourceMultiplier: 0.5 },
    attackSequence: [
      { time: 10, action: 'APPLY_RESOURCE_SHOCK' }
    ],
    successCriteria: [
      { metric: 'panicModeTriggered', operator: '==', value: true },
      { metric: 'survivalRate', operator: '>=', value: 0.9 },
      { metric: 'recoveryTime', operator: '<=', value: 10 }
    ]
  },
  {
    id: 'ADV-05',
    name: 'Federation Severance',
    description: 'All cross-cell links cut',
    setup: { cellCount: 5, federationDegree: 3 },
    attackSequence: [
      { time: 20, action: 'SEVER_ALL_FEDERATION' }
    ],
    successCriteria: [
      { metric: 'internalLedgersValid', operator: '==', value: true },
      { metric: 'maxCellLoss', operator: '<=', value: 'beta * Lambda' },
      { metric: 'survivalRate', operator: '>=', value: 0.95 }
    ]
  },
  {
    id: 'ADV-06',
    name: 'Intermittent Connectivity',
    description: 'Network partitions randomly',
    setup: { cellSize: 80, partitionProbability: 0.1 },
    attackSequence: [
      { time: 0, action: 'ENABLE_RANDOM_PARTITIONS' }
    ],
    successCriteria: [
      { metric: 'dataConsistency', operator: '==', value: true },
      { metric: 'transactionSuccess', operator: '>=', value: 0.8 }
    ]
  },
  {
    id: 'ADV-07',
    name: 'Governance Capture',
    description: 'Infiltrators seek council seats',
    setup: { cellSize: 80, infiltratorCount: 3 },
    attackSequence: [
      { time: 0, action: 'INFILTRATE_CELL' },
      { time: 30, action: 'SEEK_COUNCIL_SEATS' },
      { time: 50, action: 'ATTEMPT_POLICY_CAPTURE' }
    ],
    successCriteria: [
      { metric: 'conservationMaintained', operator: '==', value: true },
      { metric: 'floorNeverBroken', operator: '==', value: true },
      { metric: 'netIssuance', operator: '==', value: 0 }
    ]
  }
];
```

### 5.2 Scenario Execution

```typescript
async function runAdversarialScenario(
  scenario: AdversarialScenario
): Promise<ScenarioResult> {
  const env = setupScenario(scenario.setup);
  const metrics: Map<string, any> = new Map();

  for (const step of scenario.attackSequence) {
    // Advance to attack time
    while (env.globalTime < step.time) {
      runSimulationStep(env);
    }

    // Execute attack
    executeAttack(env, step);
  }

  // Continue simulation to observe aftermath
  for (let i = 0; i < 50; i++) {
    runSimulationStep(env);
  }

  // Collect metrics
  for (const criterion of scenario.successCriteria) {
    metrics.set(criterion.metric, collectMetric(env, criterion.metric));
  }

  // Evaluate success
  const results = scenario.successCriteria.map(c => ({
    criterion: c,
    actualValue: metrics.get(c.metric),
    passed: evaluateCriterion(c, metrics.get(c.metric))
  }));

  return {
    scenarioId: scenario.id,
    passed: results.every(r => r.passed),
    criteriaResults: results,
    environmentSnapshot: captureSnapshot(env)
  };
}
```

---

## 6. Validation Dashboard

### 6.1 Metrics Display

```typescript
interface ValidationDashboard {
  invariantResults: InvariantTestResults;
  simulationResults: SimulationResults[];
  adversarialResults: ScenarioResult[];
  overallHealthScore: number;
  recommendations: string[];
}

function computeHealthScore(dashboard: ValidationDashboard): number {
  const invariantScore = dashboard.invariantResults.passed /
    dashboard.invariantResults.totalTests;

  const simScore = dashboard.simulationResults.reduce((sum, r) =>
    sum + (r.metrics.survivalRate * 0.5 + (1 - r.metrics.freezeProbability) * 0.5)
  , 0) / dashboard.simulationResults.length;

  const advScore = dashboard.adversarialResults.filter(r => r.passed).length /
    dashboard.adversarialResults.length;

  // Weighted average
  return invariantScore * 0.4 + simScore * 0.3 + advScore * 0.3;
}
```

---

## 7. Continuous Integration

### 7.1 CI Pipeline

```yaml
# .github/workflows/validation.yml
name: Protocol Validation

on:
  push:
    branches: [main]
  pull_request:

jobs:
  invariants:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Invariant Tests
        run: npm run test:invariants
      - name: Assert 100% Pass
        run: |
          if [ $(cat invariant-results.json | jq '.failures') -ne 0 ]; then
            exit 1
          fi

  simulations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Economic Simulations
        run: npm run test:simulations
      - name: Check Survival Rate
        run: |
          rate=$(cat sim-results.json | jq '.survivalRate')
          if (( $(echo "$rate < 0.9" | bc -l) )); then
            exit 1
          fi

  adversarial:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Adversarial Scenarios
        run: npm run test:adversarial
      - name: Check All Pass
        run: |
          passed=$(cat adv-results.json | jq '.allPassed')
          if [ "$passed" != "true" ]; then
            exit 1
          fi
```

---

## 8. Test Data Generators

### 8.1 Random Operation Generator

```typescript
function generateRandomOperations(count: number = 100): Operation[] {
  const operations: Operation[] = [];

  for (let i = 0; i < count; i++) {
    const opType = weightedRandom([
      { type: 'TRANSACTION', weight: 50 },
      { type: 'COMMITMENT_CREATE', weight: 20 },
      { type: 'COMMITMENT_FULFILL', weight: 15 },
      { type: 'LIMIT_ADJUST', weight: 5 },
      { type: 'MEMBER_ADD', weight: 5 },
      { type: 'MEMBER_REMOVE', weight: 5 }
    ]);

    operations.push(generateOperation(opType));
  }

  return operations;
}
```

---

## 9. Acceptance Criteria

### 9.1 Invariant Suite
- [ ] All 6 core invariants pass 100% of iterations
- [ ] 100,000+ iterations per invariant
- [ ] Zero failures tolerated

### 9.2 Economic Simulations
- [ ] Survival rate >= 90% under normal conditions
- [ ] Survival rate >= 70% under 2x resource shock
- [ ] Recovery time <= 10 periods from PANIC

### 9.3 Adversarial Scenarios
- [ ] All 7 scenarios pass their success criteria
- [ ] No invariant violations under any attack
- [ ] Bounded extraction verified

### 9.4 Overall
- [ ] Health score >= 0.85
- [ ] CI pipeline green on main branch
- [ ] All test results documented

---

## 10. Reporting

### 10.1 Validation Report Template

```markdown
# Protocol Validation Report

## Summary
- Date: {{date}}
- Version: {{version}}
- Health Score: {{healthScore}}/1.0

## Invariant Tests
- Total: {{invariantTotal}}
- Passed: {{invariantPassed}}
- Failed: {{invariantFailed}}

## Economic Simulations
- Scenarios Run: {{simCount}}
- Average Survival Rate: {{avgSurvival}}
- Average Freeze Probability: {{avgFreeze}}

## Adversarial Scenarios
- Total: {{advTotal}}
- Passed: {{advPassed}}
- Failed: {{advFailed}}

## Recommendations
{{#each recommendations}}
- {{this}}
{{/each}}
```
