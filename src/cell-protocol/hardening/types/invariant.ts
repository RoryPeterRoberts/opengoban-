/**
 * Cell Protocol - Hardening: Invariant Test Types
 *
 * Type definitions for property-based invariant testing (PRD-10).
 * Defines invariant tests, operations, and test results.
 */

import { IdentityId, CellId, Units, Timestamp } from '../../types/common';
import { CommitmentId } from '../../types/commitment';
import { CellProtocol } from '../../index';

// ============================================
// OPERATION TYPES
// ============================================

/** Types of operations that can be generated for property testing */
export type Operation =
  | TransactionOp
  | CommitmentCreateOp
  | CommitmentFulfillOp
  | CommitmentCancelOp
  | LimitAdjustOp
  | MemberAddOp
  | MemberRemoveOp
  | FederationTxOp;

/** Spot transaction operation */
export interface TransactionOp {
  type: 'TRANSACTION';
  payer: IdentityId;
  payee: IdentityId;
  amount: Units;
}

/** Create commitment operation */
export interface CommitmentCreateOp {
  type: 'COMMITMENT_CREATE';
  promisor: IdentityId;
  promisee: IdentityId;
  value: Units;
  escrowed: boolean;
}

/** Fulfill commitment operation */
export interface CommitmentFulfillOp {
  type: 'COMMITMENT_FULFILL';
  commitmentId: CommitmentId;
}

/** Cancel commitment operation */
export interface CommitmentCancelOp {
  type: 'COMMITMENT_CANCEL';
  commitmentId: CommitmentId;
  initiatorId: IdentityId;
}

/** Adjust credit limit operation */
export interface LimitAdjustOp {
  type: 'LIMIT_ADJUST';
  memberId: IdentityId;
  newLimit: Units;
}

/** Add member operation */
export interface MemberAddOp {
  type: 'MEMBER_ADD';
  memberId: IdentityId;
  displayName: string;
  limit: Units;
}

/** Remove member operation */
export interface MemberRemoveOp {
  type: 'MEMBER_REMOVE';
  memberId: IdentityId;
}

/** Federation transaction operation */
export interface FederationTxOp {
  type: 'FEDERATION_TX';
  sourceCell: CellId;
  targetCell: CellId;
  payer: IdentityId;
  payee: IdentityId;
  amount: Units;
}

// ============================================
// CELL STATE (for checking)
// ============================================

/** Lightweight state snapshot for invariant checking */
export interface CellStateSnapshot {
  cellId: CellId;
  members: MemberSnapshot[];
  commitments: CommitmentSnapshot[];
  federationPosition?: Units;
  federationCap?: Units;
  timestamp: Timestamp;
}

/** Member state snapshot */
export interface MemberSnapshot {
  memberId: IdentityId;
  balance: Units;
  limit: Units;
  reserve: Units;
  isActive: boolean;
}

/** Commitment state snapshot */
export interface CommitmentSnapshot {
  id: CommitmentId;
  promisor: IdentityId;
  promisee: IdentityId;
  value: Units;
  escrowed: boolean;
  isActive: boolean;
}

// ============================================
// GENERATOR TYPES
// ============================================

/** Configuration for operation generators */
export interface GeneratorConfig {
  /** Seed for reproducibility */
  seed: number;
  /** Weights for operation types */
  operationWeights: OperationWeights;
  /** Min/max values for amounts */
  amountRange: { min: Units; max: Units };
  /** Min/max values for limits */
  limitRange: { min: Units; max: Units };
  /** Max operations per sequence */
  maxOperations: number;
  /** Federation enabled */
  federationEnabled: boolean;
  /** Cell IDs for federation tests */
  federationCellIds?: CellId[];
}

/** Weights for random operation selection */
export interface OperationWeights {
  TRANSACTION: number;
  COMMITMENT_CREATE: number;
  COMMITMENT_FULFILL: number;
  COMMITMENT_CANCEL: number;
  LIMIT_ADJUST: number;
  MEMBER_ADD: number;
  MEMBER_REMOVE: number;
  FEDERATION_TX: number;
}

/** Default operation weights */
export const DEFAULT_OPERATION_WEIGHTS: OperationWeights = {
  TRANSACTION: 40,
  COMMITMENT_CREATE: 20,
  COMMITMENT_FULFILL: 15,
  COMMITMENT_CANCEL: 5,
  LIMIT_ADJUST: 5,
  MEMBER_ADD: 5,
  MEMBER_REMOVE: 2,
  FEDERATION_TX: 8,
};

// ============================================
// INVARIANT TEST TYPES
// ============================================

/** Invariant IDs */
export type InvariantId =
  | 'INV-01' // Conservation: SUM(balance) = 0
  | 'INV-02' // Floor: balance >= -limit
  | 'INV-03' // Reserve >= 0
  | 'INV-04' // Escrow safety: balance - reserve >= -limit
  | 'INV-05' // Federation sum = 0
  | 'INV-06'; // Federation cap respected

/** Invariant test definition */
export interface InvariantTest {
  /** Invariant ID */
  id: InvariantId;
  /** Human-readable property description */
  property: string;
  /** Number of iterations to run */
  iterations: number;
  /** Check function that verifies the invariant holds */
  checker: (state: CellStateSnapshot) => InvariantCheckResult;
  /** Optional: specific generator config for this invariant */
  generatorConfig?: Partial<GeneratorConfig>;
}

/** Result of checking an invariant */
export interface InvariantCheckResult {
  /** Whether the invariant holds */
  holds: boolean;
  /** Violation details if it doesn't hold */
  violation?: {
    description: string;
    expected: string;
    actual: string;
    details?: Record<string, unknown>;
  };
}

// ============================================
// TEST EXECUTION TYPES
// ============================================

/** Result of a single invariant test iteration */
export interface IterationResult {
  /** Iteration number */
  iteration: number;
  /** Seed used for this iteration */
  seed: number;
  /** Operations executed */
  operationsExecuted: number;
  /** Operations that failed (expected failures like insufficient funds) */
  operationsFailed: number;
  /** Whether invariant held after all operations */
  invariantHeld: boolean;
  /** Violation if invariant failed */
  violation?: InvariantCheckResult['violation'];
  /** Duration in ms */
  durationMs: number;
}

/** Result of a complete invariant test */
export interface InvariantTestResult {
  /** Invariant ID */
  id: InvariantId;
  /** Property being tested */
  property: string;
  /** Total iterations */
  totalIterations: number;
  /** Passed iterations */
  passedIterations: number;
  /** Failed iterations */
  failedIterations: number;
  /** Pass rate (0-1) */
  passRate: number;
  /** First failure (if any) */
  firstFailure?: IterationResult;
  /** Total duration in ms */
  totalDurationMs: number;
  /** Average duration per iteration */
  avgDurationMs: number;
}

/** Result of running all invariant tests */
export interface InvariantSuiteResult {
  /** Results for each invariant */
  results: InvariantTestResult[];
  /** Overall pass rate */
  overallPassRate: number;
  /** All invariants passed? */
  allPassed: boolean;
  /** Total duration */
  totalDurationMs: number;
  /** Total iterations across all tests */
  totalIterations: number;
  /** Timestamp when run started */
  startedAt: Timestamp;
  /** Timestamp when run completed */
  completedAt: Timestamp;
}

/** Summary for invariant results (used by reporter) */
export interface InvariantSummary {
  totalIterations: number;
  totalFailures: number;
  passingCount: number;
  totalCount: number;
  allPassing: boolean;
  byInvariant: Record<string, { iterations: number; failures: number; passing: boolean }>;
}

// ============================================
// TEST RUNNER CONFIGURATION
// ============================================

/** Configuration for the invariant test runner */
export interface InvariantRunnerConfig {
  /** Default iterations per test */
  defaultIterations: number;
  /** Max operations per iteration */
  maxOperationsPerIteration: number;
  /** Initial members to create */
  initialMemberCount: number;
  /** Base seed for reproducibility */
  baseSeed: number;
  /** Parallelism (iterations to run concurrently) */
  parallelism: number;
  /** Log progress every N iterations */
  progressInterval: number;
  /** Enable federation tests */
  federationEnabled: boolean;
  /** Number of cells for federation tests */
  federationCellCount: number;
  /** Operation amount range */
  amountRange: { min: Units; max: Units };
  /** Credit limit range */
  limitRange: { min: Units; max: Units };
}

/** Default runner configuration */
export const DEFAULT_RUNNER_CONFIG: InvariantRunnerConfig = {
  defaultIterations: 100000,
  maxOperationsPerIteration: 50,
  initialMemberCount: 10,
  baseSeed: 12345,
  parallelism: 1, // Sequential for determinism
  progressInterval: 10000,
  federationEnabled: true,
  federationCellCount: 3,
  amountRange: { min: 1, max: 500 },
  limitRange: { min: 100, max: 1000 },
};
