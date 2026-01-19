# PRD-07: Emergency Mode System

## Document Information
- **Version**: 1.0
- **Status**: Draft
- **Dependencies**: PRD-01 (Core Ledger), PRD-05 (Governance), PRD-06 (Federation)
- **Dependents**: PRD-08 (Survival Scheduler), PRD-09 (Energy Layer)

---

## 1. Overview

The Emergency Mode System provides state-dependent parameter controls that automatically tighten constraints when stress indicators rise. It operationalizes the cooperation condition inequality by reducing limits when continuation probability drops.

### Core Insight
From game theory: cooperation is rational when `L <= u^C / (1 - delta)`. When delta drops (panic/flight), L must decrease to maintain cooperation incentives.

---

## 2. Risk State Model

### 2.1 State Definitions

```typescript
type RiskState = 'NORMAL' | 'STRESSED' | 'PANIC';

interface RiskStateConfig {
  state: RiskState;
  description: string;
  triggers: RiskTriggers;
  policy: EmergencyPolicy;
}

const RISK_STATES: RiskStateConfig[] = [
  {
    state: 'NORMAL',
    description: 'Cooperative equilibrium, standard operations',
    triggers: { maxStress: 1.0 },
    policy: normalPolicy
  },
  {
    state: 'STRESSED',
    description: 'Elevated risk, tightened controls',
    triggers: { minStress: 1.0, maxStress: 1.3 },
    policy: stressedPolicy
  },
  {
    state: 'PANIC',
    description: 'Crisis mode, maximum restrictions',
    triggers: { minStress: 1.3 },
    policy: panicPolicy
  }
];
```

### 2.2 Stress Indicators

```typescript
interface StressIndicators {
  // Economic indicators
  floorMass: number;           // F(t): fraction near debt floor
  balanceVariance: number;     // sigma^2(t): balance dispersion
  disputeRate: number;         // D_r(t): disputes per transaction
  memberChurn: number;         // C_r(t): exits per period

  // Energy indicators (from PRD-09)
  energyStress: number;        // S_E(t): energy scarcity index

  // Composite
  economicStress: number;      // S_M(t): combined economic index
  overallStress: number;       // max(S_M, S_E)
}

function calculateStressIndicators(): StressIndicators {
  const N = ledger.getMemberCount();
  const avgLimit = ledger.getAggregateCapacity() / N;

  // Floor mass: fraction of members near -L
  const floorMass = ledger.getFloorMass(0.8);  // rho = 0.8

  // Balance variance (normalized)
  const variance = ledger.getBalanceVariance();
  const normalizedVariance = variance / (avgLimit * avgLimit);

  // Dispute rate (from recent period)
  const recentDisputes = governance.getRecentDisputeCount(WEEK);
  const recentTransactions = transactions.getRecentCount(WEEK);
  const disputeRate = recentDisputes / Math.max(recentTransactions, 1);

  // Member churn
  const recentExits = identity.getRecentExitCount(WEEK);
  const churnRate = recentExits / N;

  // Energy stress (if available)
  const energyStress = energy?.getStressIndex() ?? 0;

  // Composite economic stress
  const economicStress = Math.max(
    floorMass / FLOOR_MASS_THRESHOLD,
    normalizedVariance / VARIANCE_THRESHOLD,
    disputeRate / DISPUTE_RATE_THRESHOLD,
    churnRate / CHURN_THRESHOLD
  );

  return {
    floorMass,
    balanceVariance: variance,
    disputeRate,
    memberChurn: churnRate,
    energyStress,
    economicStress,
    overallStress: Math.max(economicStress, energyStress)
  };
}
```

---

## 3. State Transition Rules

### 3.1 Transition Logic

```typescript
interface TransitionThresholds {
  // Enter STRESSED when above these
  stressedFloorMass: number;      // e.g., 0.25
  stressedVarianceFactor: number; // e.g., 0.5 * kappa * L
  stressedDisputeRate: number;    // e.g., 0.05

  // Enter PANIC when above these
  panicFloorMass: number;         // e.g., 0.40
  panicEnergyStress: number;      // e.g., 1.2 (infeasibility)

  // Return to NORMAL when below these (hysteresis)
  normalFloorMass: number;        // e.g., 0.15
  normalVarianceFactor: number;   // e.g., 0.3 * kappa * L
}

function determineRiskState(
  indicators: StressIndicators,
  currentState: RiskState,
  thresholds: TransitionThresholds
): RiskState {
  const { floorMass, balanceVariance, disputeRate, energyStress, overallStress } = indicators;

  // PANIC conditions (highest priority)
  if (floorMass > thresholds.panicFloorMass ||
      energyStress > thresholds.panicEnergyStress) {
    return 'PANIC';
  }

  // STRESSED conditions
  if (floorMass > thresholds.stressedFloorMass ||
      disputeRate > thresholds.stressedDisputeRate ||
      overallStress > 1.0) {
    return 'STRESSED';
  }

  // NORMAL conditions (with hysteresis for de-escalation)
  if (currentState !== 'NORMAL') {
    // More conservative thresholds to return to NORMAL
    if (floorMass < thresholds.normalFloorMass &&
        overallStress < 0.8) {
      return 'NORMAL';
    }
    return currentState;  // Stay in elevated state
  }

  return 'NORMAL';
}
```

### 3.2 Hysteresis

To prevent rapid oscillation between states:
- Escalation thresholds are lower than de-escalation thresholds
- Minimum time in elevated state before de-escalation allowed
- Governance can override automatic de-escalation

---

## 4. Emergency Policies

### 4.1 NORMAL Policy

```typescript
const normalPolicy: EmergencyPolicy = {
  limitFactor: 1.0,              // Full limits
  newMemberLimitFactor: 1.0,     // Standard onboarding
  federationBetaFactor: 1.0,     // Full federation
  admissionMode: 'STANDARD',     // Normal governance approval
  commitmentMode: 'STANDARD',    // Escrow recommended for essentials
  schedulerPriority: 'BALANCED', // Normal task matching
  description: 'Standard operating parameters'
};
```

### 4.2 STRESSED Policy

```typescript
const stressedPolicy: EmergencyPolicy = {
  limitFactor: 1.0,              // Existing limits unchanged
  newMemberLimitFactor: 0.7,     // Reduced limits for newcomers
  federationBetaFactor: 0.7,     // Reduced federation exposure
  admissionMode: 'BONDED',       // Require sponsor/service bond
  commitmentMode: 'ESCROW_ESSENTIALS', // Mandatory escrow for essentials
  schedulerPriority: 'ESSENTIALS_FIRST', // Prioritize critical tasks
  description: 'Elevated risk - tightened onboarding and exposure'
};
```

### 4.3 PANIC Policy

```typescript
const panicPolicy: EmergencyPolicy = {
  limitFactor: 0.8,              // Reduce all limits by 20%
  newMemberLimitFactor: 0.5,     // Severely reduced for newcomers
  federationBetaFactor: 0.0,     // Federation frozen
  admissionMode: 'SUPERMAJORITY_BONDED', // High barrier
  commitmentMode: 'ESCROW_ALL',  // Mandatory escrow for all commitments
  schedulerPriority: 'SURVIVAL', // Only essential tasks
  debtorPriorityMatching: true,  // Route debtors to earning opportunities
  description: 'Crisis mode - maximum restrictions, survival focus'
};
```

### 4.4 Policy Application

```typescript
interface EmergencyPolicy {
  limitFactor: number;           // Multiply existing L_i
  newMemberLimitFactor: number;  // Factor for new members
  federationBetaFactor: number;  // Multiply beta
  admissionMode: AdmissionMode;
  commitmentMode: CommitmentMode;
  schedulerPriority: SchedulerPriority;
  debtorPriorityMatching?: boolean;
  description: string;
}

function applyEmergencyPolicy(policy: EmergencyPolicy): void {
  // 1. Adjust limits (bounded, rate-limited)
  if (policy.limitFactor < 1.0) {
    for (const member of ledger.getActiveMembers()) {
      const newLimit = Math.max(
        parameters.L_min,
        member.limit * policy.limitFactor
      );
      // Rate limit the change
      const maxChange = parameters.eta;
      const actualNewLimit = Math.max(
        member.limit - maxChange,
        newLimit
      );
      ledger.setMemberLimit(member.id, actualNewLimit);
    }
  }

  // 2. Update federation beta
  const newBeta = parameters.federationBaseBeta * policy.federationBetaFactor;
  federation.setExposureCapFactor(newBeta);

  // 3. Update admission rules
  identity.setAdmissionMode(policy.admissionMode);

  // 4. Update commitment rules
  commitments.setCommitmentMode(policy.commitmentMode);

  // 5. Update scheduler priority
  scheduler.setPriority(policy.schedulerPriority);

  // 6. Enable debtor priority if specified
  if (policy.debtorPriorityMatching) {
    scheduler.enableDebtorPriorityMatching();
  }

  // Log state change
  eventLog.append({
    type: 'EMERGENCY_POLICY_APPLIED',
    policy,
    timestamp: Date.now()
  });
}
```

---

## 5. Functional Requirements

### 5.1 Monitoring

#### FR-1.1: Continuous Monitoring
- Calculate stress indicators at regular intervals (e.g., hourly)
- Store indicator history for trend analysis
- Detect rapid changes that may require immediate response

#### FR-1.2: Alert Generation
- Generate alerts when indicators approach thresholds
- Notify governance council of state changes
- Provide explanation of triggers

### 5.2 State Management

#### FR-2.1: Automatic Transitions
- System automatically transitions based on indicators
- Transitions are deterministic and auditable
- No AI involvement in state determination

#### FR-2.2: Governance Override
- Governance can manually trigger state changes
- Requires super quorum for manual PANIC trigger
- Manual overrides logged with justification

#### FR-2.3: Policy Application
- Policies applied immediately on state change
- All changes bounded by system constraints
- Changes are reversible (except actual losses)

### 5.3 Recovery

#### FR-3.1: De-escalation Path
- Clear criteria for returning to lower states
- Minimum stabilization period before de-escalation
- Gradual parameter restoration

#### FR-3.2: Post-Crisis Analysis
- Generate report on crisis period
- Analyze what triggered the crisis
- Recommend parameter adjustments

---

## 6. API Specification

```typescript
interface IEmergencyEngine {
  // State
  getCurrentRiskState(): RiskState;
  getStressIndicators(): StressIndicators;
  getCurrentPolicy(): EmergencyPolicy;

  // Monitoring
  updateIndicators(): StressIndicators;
  checkStateTransition(): StateTransitionResult;

  // Manual Control (via Governance)
  triggerStateChange(
    newState: RiskState,
    reason: string,
    governanceApprovalId: string
  ): Result<void, EmergencyError>;

  forceDeEscalation(
    reason: string,
    governanceApprovalId: string
  ): Result<void, EmergencyError>;

  // Queries
  getStateHistory(timeRange: TimeRange): StateHistoryEntry[];
  getIndicatorHistory(timeRange: TimeRange): StressIndicators[];
  getPolicyChanges(timeRange: TimeRange): PolicyChangeEntry[];

  // Analysis
  analyzeThresholdProximity(): ThresholdProximityReport;
  generateCrisisReport(crisisId: string): CrisisReport;
}

interface StateTransitionResult {
  transitioned: boolean;
  previousState: RiskState;
  newState: RiskState;
  triggers: string[];
  policyChanges: string[];
}

interface ThresholdProximityReport {
  currentState: RiskState;
  indicators: StressIndicators;
  distanceToStressed: number;  // Negative if already stressed+
  distanceToPanic: number;     // Negative if already panic
  distanceToNormal: number;    // For de-escalation
  recommendations: string[];
}

interface CrisisReport {
  crisisId: string;
  startedAt: Timestamp;
  endedAt?: Timestamp;
  peakState: RiskState;
  triggerIndicators: StressIndicators;
  peakIndicators: StressIndicators;
  policiesApplied: EmergencyPolicy[];
  memberImpact: {
    limitReductions: number;
    federationSuspensions: number;
    admissionsBlocked: number;
  };
  recoveryPath: StateHistoryEntry[];
  lessonsLearned?: string;
}

type EmergencyError =
  | { type: 'INVALID_STATE_TRANSITION'; from: RiskState; to: RiskState }
  | { type: 'GOVERNANCE_APPROVAL_REQUIRED' }
  | { type: 'MINIMUM_STABILIZATION_NOT_MET'; remaining: number }
  | { type: 'INDICATORS_STILL_ELEVATED'; indicators: string[] };
```

---

## 7. State Transition Algorithm

```typescript
function runEmergencyCheck(): StateTransitionResult {
  const currentState = emergency.getCurrentRiskState();
  const indicators = calculateStressIndicators();

  // Determine appropriate state
  const newState = determineRiskState(
    indicators,
    currentState,
    parameters.thresholds
  );

  // Check if transition needed
  if (newState === currentState) {
    return {
      transitioned: false,
      previousState: currentState,
      newState: currentState,
      triggers: [],
      policyChanges: []
    };
  }

  // Escalation doesn't need delay
  // De-escalation requires stabilization period
  if (isDeEscalation(currentState, newState)) {
    const lastStateChange = emergency.getLastStateChangeTime();
    const minStabilization = parameters.minStabilizationPeriod;
    if (Date.now() - lastStateChange < minStabilization) {
      return {
        transitioned: false,
        previousState: currentState,
        newState: currentState,
        triggers: ['STABILIZATION_PERIOD_NOT_MET'],
        policyChanges: []
      };
    }
  }

  // Execute transition
  const triggers = identifyTriggers(indicators, newState);
  const newPolicy = getPolicy(newState);
  const oldPolicy = getPolicy(currentState);
  const policyChanges = diffPolicies(oldPolicy, newPolicy);

  // Apply new policy
  applyEmergencyPolicy(newPolicy);

  // Update state
  emergency.setState(newState);

  // Notify
  notifyGovernance({
    type: 'STATE_TRANSITION',
    from: currentState,
    to: newState,
    triggers,
    policyChanges
  });

  return {
    transitioned: true,
    previousState: currentState,
    newState,
    triggers,
    policyChanges
  };
}

function isDeEscalation(from: RiskState, to: RiskState): boolean {
  const severity = { 'NORMAL': 0, 'STRESSED': 1, 'PANIC': 2 };
  return severity[to] < severity[from];
}
```

---

## 8. Test Cases

### 8.1 Unit Tests

| ID | Test | Expected |
|----|------|----------|
| EM-01 | NORMAL with low indicators | Stay NORMAL |
| EM-02 | NORMAL with high floor mass | Transition to STRESSED |
| EM-03 | STRESSED with very high floor mass | Transition to PANIC |
| EM-04 | PANIC with indicators dropping | Stay PANIC (stabilization) |
| EM-05 | PANIC after stabilization | Transition to STRESSED |
| EM-06 | Policy application reduces limits | Limits reduced within bounds |
| EM-07 | Federation freeze in PANIC | Beta = 0 |

### 8.2 Integration Tests

| ID | Test |
|----|------|
| EM-I1 | Full escalation path: NORMAL -> STRESSED -> PANIC |
| EM-I2 | Full recovery path: PANIC -> STRESSED -> NORMAL |
| EM-I3 | Governance manual override |
| EM-I4 | Policy effects on transaction validation |

---

## 9. Invariants

The Emergency Mode System NEVER violates core invariants:

1. **Conservation** (`SUM(b_i) = 0`): Limit changes don't affect balances
2. **Debt Floor** (`b_i >= -L_i`): If limit reduced below current debt, member just can't spend more
3. **Limit Bounds** (`L_min <= L_i <= L_max`): All adjustments stay within bounds
4. **Rate Limits** (`|L_i(t+1) - L_i(t)| <= eta`): Changes are gradual

---

## 10. Acceptance Criteria

- [ ] Stress indicators calculated correctly
- [ ] State transitions follow rules
- [ ] Hysteresis prevents oscillation
- [ ] Policies apply correctly
- [ ] Governance override works
- [ ] Recovery path functions
- [ ] All invariants preserved
- [ ] Audit trail complete
