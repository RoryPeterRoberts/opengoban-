/**
 * Cell Protocol - Hardening: Validation & Dashboard Types
 *
 * Type definitions for health scoring, recommendations, and reporting (PRD-10).
 * Defines dashboard state, health metrics, and issue tracking.
 */

import { CellId, Timestamp, Units } from '../../types/common';
import { InvariantSuiteResult, InvariantId } from './invariant';

// Re-export for convenience
export { InvariantId } from './invariant';
import { SimulationResult, SimulationSummary } from './simulation';

// ============================================
// HEALTH SCORE TYPES
// ============================================

/** Health score components */
export interface HealthScoreComponents {
  /** Invariant score (0-1, % passing) */
  invariantScore: number;
  /** Simulation score (0-1, survival & freeze metrics) */
  simulationScore: number;
  /** Adversarial score (0-1, % scenarios passing) */
  adversarialScore: number;
  /** Alternative naming for calculator compatibility */
  invariants?: number;
  simulation?: number;
  adversarial?: number;
}

/** Health score status */
export type HealthScoreStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';

/** Health score details */
export interface HealthScoreDetails {
  invariantsPassing: number;
  invariantsTotal: number;
  survivalRate: number;
  freezeProbability: number;
  scenariosPassing: number;
  scenariosTotal: number;
}

/** Complete health score */
export interface HealthScore {
  /** Overall score (0-1) */
  overall: number;
  /** Component scores */
  components: HealthScoreComponents;
  /** Component weights used */
  weights?: HealthScoreWeights;
  /** Computed at */
  computedAt: Timestamp;
  /** Passes threshold (>= 0.85) */
  passesThreshold?: boolean;
  /** Issues detected */
  issueCount?: number;
  /** Critical issues */
  criticalIssueCount?: number;
  /** Health status */
  status?: HealthScoreStatus;
  /** Failing invariants */
  failingInvariants?: InvariantId[];
  /** Failing adversarial scenarios */
  failingScenarios?: AdversarialScenarioId[];
  /** Detailed metrics */
  details?: HealthScoreDetails;
}

/** Weights for health score computation */
export interface HealthScoreWeights {
  /** Weight for invariant score (default 0.4) */
  invariant: number;
  /** Weight for simulation score (default 0.3) */
  simulation: number;
  /** Weight for adversarial score (default 0.3) */
  adversarial: number;
}

/** Default health score weights */
export const DEFAULT_HEALTH_WEIGHTS: HealthScoreWeights = {
  invariant: 0.4,
  simulation: 0.3,
  adversarial: 0.3,
};

// ============================================
// ADVERSARIAL SCENARIO TYPES
// ============================================

/** Adversarial scenario IDs */
export type AdversarialScenarioId =
  | 'ADV-01'  // Exit scam wave
  | 'ADV-02'  // Sybil infiltration
  | 'ADV-03'  // Collusive pump
  | 'ADV-04'  // Resource shock
  | 'ADV-05'  // Federation severance
  | 'ADV-06'  // Intermittent connectivity
  | 'ADV-07'; // Governance capture

/** Adversarial scenario definition */
export interface AdversarialScenario {
  /** Scenario ID */
  id: AdversarialScenarioId;
  /** Scenario name */
  name: string;
  /** Description */
  description: string;
  /** Setup parameters */
  setup: AdversarialSetup;
  /** Success criteria */
  successCriteria: AdversarialCriteria;
}

/** Setup parameters for adversarial scenario */
export interface AdversarialSetup {
  /** Number of members */
  memberCount: number;
  /** Number of cells (for federation tests) */
  cellCount?: number;
  /** Attacker count/percentage */
  attackerCount?: number;
  attackerPercentage?: number;
  /** Attacker budget */
  attackerBudget?: Units;
  /** Simulation ticks */
  ticks: number;
  /** Custom parameters */
  customParams?: Record<string, unknown>;
}

/** Success criteria for adversarial scenario */
export interface AdversarialCriteria {
  /** Maximum extraction allowed */
  maxExtraction?: Units;
  /** Maximum extraction as fraction of capacity */
  maxExtractionFraction?: number;
  /** Minimum survival rate */
  minSurvivalRate?: number;
  /** Maximum admitted sybils */
  maxAdmittedSybils?: number;
  /** Maximum limit inflation */
  maxLimitInflation?: number;
  /** Maximum loss */
  maxLoss?: Units;
  /** Invariants must hold */
  invariantsHold?: InvariantId[];
  /** Custom criteria checker */
  customChecker?: string;
}

/** Result of running an adversarial scenario */
export interface AdversarialScenarioResult {
  /** Scenario ID */
  scenarioId: AdversarialScenarioId;
  /** Scenario passed */
  passed: boolean;
  /** Actual values vs criteria */
  actualValues: Record<string, number>;
  /** Criteria values */
  criteriaValues: Record<string, number>;
  /** Violations */
  violations: string[];
  /** Underlying simulation result */
  simulationResult?: SimulationResult;
  /** Duration in ms */
  durationMs: number;
  /** Detailed log */
  log?: string[];
}

/** Result of running all adversarial scenarios */
export interface AdversarialSuiteResult {
  /** Results for each scenario */
  results: AdversarialScenarioResult[];
  /** Overall pass rate */
  passRate: number;
  /** All passed */
  allPassed: boolean;
  /** Total duration */
  totalDurationMs: number;
  /** Started at */
  startedAt: Timestamp;
  /** Completed at */
  completedAt: Timestamp;
}

// ============================================
// ISSUE & RECOMMENDATION TYPES
// ============================================

/** Issue severity levels */
export type IssueSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/** Issue categories */
export type IssueCategory =
  | 'INVARIANT_VIOLATION'
  | 'SURVIVAL_RISK'
  | 'ECONOMIC_INSTABILITY'
  | 'FEDERATION_RISK'
  | 'SYBIL_RISK'
  | 'GOVERNANCE_RISK'
  | 'PERFORMANCE'
  | 'CONFIGURATION'
  | 'LOW_SURVIVAL_RATE'
  | 'HIGH_FREEZE_PROBABILITY'
  | 'HIGH_EXTRACTION'
  | 'LOW_REPUTATION'
  | 'SYBIL_DETECTED'
  | 'SCENARIO_FAILURE';

/** Detected issue */
export interface DetectedIssue {
  /** Issue ID */
  id: string;
  /** Issue category */
  category: IssueCategory;
  /** Severity */
  severity: IssueSeverity;
  /** Title */
  title: string;
  /** Description */
  description: string;
  /** Affected component */
  affectedComponent?: string;
  /** Evidence/metrics */
  evidence?: Record<string, unknown>;
  /** Recommended actions */
  recommendations: Recommendation[];
  /** Detected at */
  detectedAt: Timestamp;
  /** Related invariant (if applicable) */
  relatedInvariant?: InvariantId;
  /** Alternative: affectedInvariant (alias) */
  affectedInvariant?: InvariantId;
  /** Related scenario (if applicable) */
  relatedScenario?: AdversarialScenarioId;
  /** Affected member IDs (if applicable) */
  affectedMembers?: string[];
}

/** Recommendation for addressing an issue */
export interface Recommendation {
  /** Recommendation ID */
  id: string;
  /** Action to take */
  action: string;
  /** Detailed explanation */
  explanation?: string;
  /** Alternative: description (alias for explanation) */
  description?: string;
  /** Priority (1-5, 1 = highest) */
  priority: number;
  /** Effort estimate */
  effort: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Impact estimate */
  impact?: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Automated fix available */
  automatedFix?: boolean;
  /** Related configuration parameters */
  relatedParams?: string[];
}

// ============================================
// REPORT TYPES
// ============================================

/** Adversarial scenario summary for reports */
export interface AdversarialReportSummary {
  totalScenarios: number;
  passingScenarios: number;
  failingScenarios: AdversarialScenarioId[];
  allPassing: boolean;
  byScenario: Record<string, { passed: boolean; details: string }>;
}

/** Complete validation report */
export interface ValidationReport {
  /** Report ID */
  id?: string;
  /** Cell ID being validated */
  cellId?: CellId;
  /** Generated at */
  generatedAt?: Timestamp;
  /** Health score */
  healthScore: HealthScore;
  /** Invariant results */
  invariantResults?: InvariantSuiteResult;
  /** Simulation results (if run) */
  simulationResults?: SimulationResult;
  /** Adversarial results */
  adversarialResults?: AdversarialSuiteResult;
  /** Detected issues */
  issues: DetectedIssue[];
  /** Summary */
  summary: ReportSummary;
  /** Configuration used */
  configuration?: ValidationConfiguration;

  // Fields generated by reporter
  /** Report timestamp */
  timestamp?: Timestamp;
  /** Version */
  version?: string;
  /** Environment */
  environment?: 'development' | 'staging' | 'production';
  /** Invariant summary (generated by reporter) */
  invariantSummary?: {
    totalIterations: number;
    totalFailures: number;
    passingCount: number;
    totalCount: number;
    allPassing: boolean;
    byInvariant: Record<string, { iterations: number; failures: number; passing: boolean }>;
  };
  /** Simulation summary (generated by reporter) */
  simulationSummary?: SimulationSummary;
  /** Adversarial summary (generated by reporter) */
  adversarialSummary?: AdversarialReportSummary;
  /** Overall pass/fail */
  passed?: boolean;
}

/** Report summary */
export interface ReportSummary {
  /** Overall status */
  status: 'PASS' | 'WARN' | 'FAIL';
  /** Health score */
  healthScore: number;
  /** Total tests run */
  totalTests: number;
  /** Tests passed */
  testsPassed: number;
  /** Tests failed */
  testsFailed: number;
  /** Critical issues */
  criticalIssues: number;
  /** High issues */
  highIssues: number;
  /** Key findings */
  keyFindings: string[];
  /** Recommended next steps */
  nextSteps: string[];
}

// ============================================
// CONFIGURATION TYPES
// ============================================

/** Configuration for validation runs */
export interface ValidationConfiguration {
  /** Invariant test config */
  invariant: {
    /** Iterations per test */
    iterations: number;
    /** Enabled invariants */
    enabledInvariants: InvariantId[];
    /** Fail fast on first violation */
    failFast: boolean;
  };
  /** Simulation config */
  simulation: {
    /** Run economic simulations */
    enabled: boolean;
    /** Simulation ticks */
    ticks: number;
    /** Member count */
    memberCount: number;
  };
  /** Adversarial config */
  adversarial: {
    /** Enabled scenarios */
    enabledScenarios: AdversarialScenarioId[];
    /** Fail fast on first failure */
    failFast: boolean;
  };
  /** Health score config */
  healthScore: {
    /** Required threshold */
    threshold: number;
    /** Weights */
    weights: HealthScoreWeights;
  };
}

/** Default validation configuration */
export const DEFAULT_VALIDATION_CONFIG: ValidationConfiguration = {
  invariant: {
    iterations: 100000,
    enabledInvariants: ['INV-01', 'INV-02', 'INV-03', 'INV-04', 'INV-05', 'INV-06'],
    failFast: false,
  },
  simulation: {
    enabled: true,
    ticks: 100,
    memberCount: 80,
  },
  adversarial: {
    enabledScenarios: ['ADV-01', 'ADV-02', 'ADV-03', 'ADV-04', 'ADV-05', 'ADV-06', 'ADV-07'],
    failFast: false,
  },
  healthScore: {
    threshold: 0.85,
    weights: DEFAULT_HEALTH_WEIGHTS,
  },
};

// ============================================
// DASHBOARD STATE TYPES
// ============================================

/** Dashboard state */
export interface DashboardState {
  /** Current health score */
  currentHealth?: HealthScore;
  /** Health history (last N scores) */
  healthHistory?: HealthScore[];
  /** Active issues */
  activeIssues?: DetectedIssue[];
  /** Recent reports */
  recentReports?: ValidationReport[];
  /** Last validation run */
  lastValidationAt?: Timestamp;
  /** Next scheduled validation */
  nextValidationAt?: Timestamp;
  /** Validation in progress */
  validationInProgress?: boolean;

  // Fields generated by reporter
  /** Health score (alternative naming) */
  healthScore?: HealthScore;
  /** Last updated */
  lastUpdated?: Timestamp;
  /** Critical issue count */
  criticalIssueCount?: number;
  /** Trend indicator */
  trend?: 'IMPROVING' | 'STABLE' | 'DECLINING';
  /** High issue count */
  highIssueCount?: number;
  /** Top issues */
  topIssues?: DetectedIssue[];
  /** Quick stats */
  quickStats?: {
    invariantsPassing: string;
    survivalRate: string;
    scenariosPassing: string;
    activeIssues?: number;
  };
}

// ============================================
// CI PIPELINE TYPES
// ============================================

/** CI job status */
export type CIJobStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'SKIPPED';

/** CI job result */
export interface CIJobResult {
  /** Job name */
  name: string;
  /** Job status */
  status: CIJobStatus;
  /** Duration in ms */
  durationMs: number;
  /** Output summary */
  summary: string;
  /** Artifacts produced */
  artifacts?: string[];
  /** Error if failed */
  error?: string;
}

/** CI pipeline result */
export interface CIPipelineResult {
  /** Pipeline ID */
  id: string;
  /** Overall status */
  status: CIJobStatus;
  /** Job results */
  jobs: CIJobResult[];
  /** Total duration */
  totalDurationMs: number;
  /** Started at */
  startedAt: Timestamp;
  /** Completed at */
  completedAt: Timestamp;
  /** Commit/version info */
  version?: string;
}
