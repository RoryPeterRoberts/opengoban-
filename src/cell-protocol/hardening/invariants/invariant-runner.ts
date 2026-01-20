/**
 * Cell Protocol - Hardening: Invariant Test Runner
 *
 * Executes property-based tests against the Cell Protocol.
 * Supports high iteration counts with reproducible failures.
 */

import { CellId, Units, now } from '../../types/common';
import { MembershipStatus, BalanceChangeReason } from '../../types/common';
import { TaskCategory, CommitmentType } from '../../types/commitment';
import { CellProtocol, createCellProtocol } from '../../index';
import {
  InvariantTest,
  InvariantId,
  InvariantCheckResult,
  InvariantTestResult,
  InvariantSuiteResult,
  InvariantRunnerConfig,
  IterationResult,
  CellStateSnapshot,
  MemberSnapshot,
  CommitmentSnapshot,
  Operation,
  DEFAULT_RUNNER_CONFIG,
} from '../types/invariant';
import {
  OperationGenerator,
  createDefaultGeneratorConfig,
  createFederationGeneratorConfig,
} from '../generators/operation-generator';

// ============================================
// STATE SNAPSHOT
// ============================================

/**
 * Create a state snapshot from a CellProtocol instance
 */
export function createStateSnapshot(protocol: CellProtocol): CellStateSnapshot {
  const ledger = protocol.ledger;
  const memberStates = ledger.getAllMemberStates();

  const members: MemberSnapshot[] = [];
  memberStates.forEach((state, memberId) => {
    members.push({
      memberId,
      balance: state.balance,
      limit: state.limit,
      reserve: state.reserve,
      isActive: state.status === MembershipStatus.ACTIVE,
    });
  });

  // Get commitments (simplified - in real implementation would query commitment engine)
  const commitments: CommitmentSnapshot[] = [];

  // Federation state if available
  let federationPosition: Units | undefined;
  let federationCap: Units | undefined;
  if (protocol.federation) {
    federationPosition = protocol.federation.getPosition();
    federationCap = protocol.federation.getExposureCap();
  }

  return {
    cellId: protocol.cellId,
    members,
    commitments,
    federationPosition,
    federationCap,
    timestamp: now(),
  };
}

// ============================================
// INVARIANT CHECKERS
// ============================================

/**
 * INV-01: Conservation - SUM(balance) = 0
 */
export function checkConservation(state: CellStateSnapshot): InvariantCheckResult {
  const sum = state.members.reduce((acc, m) => acc + m.balance, 0);
  const holds = Math.abs(sum) < 0.001;

  return {
    holds,
    violation: holds ? undefined : {
      description: 'Conservation law violated: sum of balances is not zero',
      expected: '0',
      actual: sum.toString(),
      details: {
        memberBalances: state.members.map(m => ({ id: m.memberId, balance: m.balance })),
      },
    },
  };
}

/**
 * INV-02: Floor - balance >= -limit
 */
export function checkFloor(state: CellStateSnapshot): InvariantCheckResult {
  const violations = state.members.filter(m => m.balance < -m.limit);
  const holds = violations.length === 0;

  return {
    holds,
    violation: holds ? undefined : {
      description: 'Floor constraint violated: balance below negative limit',
      expected: 'All members: balance >= -limit',
      actual: `${violations.length} members below floor`,
      details: {
        violations: violations.map(m => ({
          id: m.memberId,
          balance: m.balance,
          limit: m.limit,
          floor: -m.limit,
        })),
      },
    },
  };
}

/**
 * INV-03: Reserve >= 0
 */
export function checkReserveNonNegative(state: CellStateSnapshot): InvariantCheckResult {
  const violations = state.members.filter(m => m.reserve < 0);
  const holds = violations.length === 0;

  return {
    holds,
    violation: holds ? undefined : {
      description: 'Reserve constraint violated: negative reserve',
      expected: 'All members: reserve >= 0',
      actual: `${violations.length} members with negative reserve`,
      details: {
        violations: violations.map(m => ({
          id: m.memberId,
          reserve: m.reserve,
        })),
      },
    },
  };
}

/**
 * INV-04: Escrow safety - balance - reserve >= -limit
 */
export function checkEscrowSafety(state: CellStateSnapshot): InvariantCheckResult {
  const violations = state.members.filter(m => (m.balance - m.reserve) < -m.limit);
  const holds = violations.length === 0;

  return {
    holds,
    violation: holds ? undefined : {
      description: 'Escrow safety violated: available balance below floor',
      expected: 'All members: balance - reserve >= -limit',
      actual: `${violations.length} members with escrow safety violation`,
      details: {
        violations: violations.map(m => ({
          id: m.memberId,
          balance: m.balance,
          reserve: m.reserve,
          available: m.balance - m.reserve,
          floor: -m.limit,
        })),
      },
    },
  };
}

/**
 * INV-05: Federation sum = 0 (across all cells)
 * Note: This requires checking across multiple cells
 */
export function checkFederationSum(
  states: Map<CellId, CellStateSnapshot>
): InvariantCheckResult {
  let sum = 0;
  for (const state of states.values()) {
    if (state.federationPosition !== undefined) {
      sum += state.federationPosition;
    }
  }
  const holds = Math.abs(sum) < 0.001;

  return {
    holds,
    violation: holds ? undefined : {
      description: 'Federation sum violated: positions do not sum to zero',
      expected: '0',
      actual: sum.toString(),
      details: {
        positions: Array.from(states.entries()).map(([cellId, state]) => ({
          cellId,
          position: state.federationPosition,
        })),
      },
    },
  };
}

/**
 * INV-06: Federation cap respected
 */
export function checkFederationCap(state: CellStateSnapshot): InvariantCheckResult {
  if (state.federationPosition === undefined || state.federationCap === undefined) {
    return { holds: true };
  }

  const holds = Math.abs(state.federationPosition) <= state.federationCap;

  return {
    holds,
    violation: holds ? undefined : {
      description: 'Federation cap violated: position exceeds cap',
      expected: `|position| <= ${state.federationCap}`,
      actual: `|${state.federationPosition}| = ${Math.abs(state.federationPosition)}`,
      details: {
        position: state.federationPosition,
        cap: state.federationCap,
      },
    },
  };
}

// ============================================
// OPERATION EXECUTOR
// ============================================

/**
 * Execute an operation against a CellProtocol instance
 * Returns true if operation succeeded, false if it failed (expected failures are OK)
 */
export async function executeOperation(
  protocol: CellProtocol,
  operation: Operation
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (operation.type) {
      case 'TRANSACTION': {
        // Check if both members exist and are active
        const payerState = protocol.ledger.getMemberState(operation.payer);
        const payeeState = protocol.ledger.getMemberState(operation.payee);

        if (!payerState || !payeeState) {
          return { success: false, error: 'Member not found' };
        }
        if (payerState.status !== MembershipStatus.ACTIVE ||
            payeeState.status !== MembershipStatus.ACTIVE) {
          return { success: false, error: 'Member not active' };
        }

        // Check if payer can spend
        if (!protocol.ledger.canSpend(operation.payer, operation.amount)) {
          return { success: false, error: 'Insufficient capacity' };
        }

        // Execute transaction
        await protocol.ledger.applyBalanceUpdates([
          { memberId: operation.payer, delta: -operation.amount, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
          { memberId: operation.payee, delta: operation.amount, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
        ]);
        return { success: true };
      }

      case 'COMMITMENT_CREATE': {
        const promisorState = protocol.ledger.getMemberState(operation.promisor);
        const promiseeState = protocol.ledger.getMemberState(operation.promisee);

        if (!promisorState || !promiseeState) {
          return { success: false, error: 'Member not found' };
        }

        // Create commitment through commitment engine
        try {
          await protocol.commitments.createCommitment({
            type: operation.escrowed ? CommitmentType.ESCROWED : CommitmentType.SOFT,
            promisor: operation.promisor,
            promisee: operation.promisee,
            value: operation.value,
            category: TaskCategory.GENERAL,
            description: 'Test commitment',
          });
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : 'Commitment creation failed' };
        }
      }

      case 'COMMITMENT_FULFILL': {
        try {
          const commitment = await protocol.commitments.getCommitment(operation.commitmentId);
          if (!commitment) {
            return { success: false, error: 'Commitment not found' };
          }
          await protocol.commitments.fulfillCommitment(operation.commitmentId, {
            commitmentId: operation.commitmentId,
            confirmedBy: commitment.promisee,
            timestamp: now(),
          });
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : 'Fulfillment failed' };
        }
      }

      case 'COMMITMENT_CANCEL': {
        try {
          await protocol.commitments.cancelCommitment(
            operation.commitmentId,
            'Test cancellation',
            operation.initiatorId
          );
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : 'Cancellation failed' };
        }
      }

      case 'LIMIT_ADJUST': {
        const memberState = protocol.ledger.getMemberState(operation.memberId);
        if (!memberState) {
          return { success: false, error: 'Member not found' };
        }

        // Check if new limit would violate floor
        if (operation.newLimit < -memberState.balance) {
          return { success: false, error: 'New limit would violate floor' };
        }

        try {
          await protocol.ledger.updateMemberLimit(operation.memberId, operation.newLimit);
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : 'Limit adjustment failed' };
        }
      }

      case 'MEMBER_ADD': {
        try {
          // Generate a fake public key for testing
          const publicKey = `pk_${operation.memberId}_${'x'.repeat(32)}`;
          await protocol.identity.addMember({
            applicantId: operation.memberId,
            displayName: operation.displayName,
            publicKey,
            initialLimit: operation.limit,
            requestedAt: now(),
          });
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : 'Member add failed' };
        }
      }

      case 'MEMBER_REMOVE': {
        const memberState = protocol.ledger.getMemberState(operation.memberId);
        if (!memberState) {
          return { success: false, error: 'Member not found' };
        }

        // Cannot remove member with non-zero balance
        if (memberState.balance !== 0) {
          return { success: false, error: 'Non-zero balance' };
        }

        try {
          await protocol.identity.removeMember(
            operation.memberId,
            'Test removal',
            'system'
          );
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : 'Member removal failed' };
        }
      }

      case 'FEDERATION_TX': {
        if (!protocol.federation) {
          return { success: false, error: 'Federation not enabled' };
        }
        // Federation transactions require more complex setup
        // For now, skip federation operations in single-cell tests
        return { success: false, error: 'Federation TX not implemented in runner' };
      }

      default:
        return { success: false, error: `Unknown operation type` };
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}

// ============================================
// INVARIANT TEST RUNNER
// ============================================

/**
 * Invariant Test Runner
 * Executes property-based tests with high iteration counts
 */
export class InvariantRunner {
  private config: InvariantRunnerConfig;
  private onProgress?: (iteration: number, total: number, invariantId: InvariantId) => void;

  constructor(config: Partial<InvariantRunnerConfig> = {}) {
    this.config = { ...DEFAULT_RUNNER_CONFIG, ...config };
  }

  /**
   * Set progress callback
   */
  setProgressCallback(
    callback: (iteration: number, total: number, invariantId: InvariantId) => void
  ): void {
    this.onProgress = callback;
  }

  /**
   * Run a single invariant test
   */
  async runInvariant(test: InvariantTest): Promise<InvariantTestResult> {
    const startTime = Date.now();
    const results: IterationResult[] = [];
    let firstFailure: IterationResult | undefined;

    for (let i = 0; i < test.iterations; i++) {
      const seed = this.config.baseSeed + i;
      const iterationResult = await this.runIteration(test, seed, i);
      results.push(iterationResult);

      if (!iterationResult.invariantHeld && !firstFailure) {
        firstFailure = iterationResult;
      }

      // Report progress
      if (this.onProgress && (i + 1) % this.config.progressInterval === 0) {
        this.onProgress(i + 1, test.iterations, test.id);
      }
    }

    const passedIterations = results.filter(r => r.invariantHeld).length;
    const totalDurationMs = Date.now() - startTime;

    return {
      id: test.id,
      property: test.property,
      totalIterations: test.iterations,
      passedIterations,
      failedIterations: test.iterations - passedIterations,
      passRate: passedIterations / test.iterations,
      firstFailure,
      totalDurationMs,
      avgDurationMs: totalDurationMs / test.iterations,
    };
  }

  /**
   * Run a single iteration of an invariant test
   */
  private async runIteration(
    test: InvariantTest,
    seed: number,
    iteration: number
  ): Promise<IterationResult> {
    const startTime = Date.now();

    // Create fresh protocol instance
    const protocol = await createCellProtocol({
      cellId: `test-cell-${seed}`,
      enableFederation: this.config.federationEnabled,
    });

    // Setup initial members
    const memberIds: string[] = [];
    for (let m = 0; m < this.config.initialMemberCount; m++) {
      const memberId = `member-${m}`;
      const publicKey = `pk_${memberId}_${'x'.repeat(32)}`;
      await protocol.identity.addMember({
        applicantId: memberId,
        displayName: `Member ${m}`,
        publicKey,
        requestedAt: now(),
      });
      memberIds.push(memberId);
    }

    // Create operation generator
    const generatorConfig = test.generatorConfig
      ? { ...createDefaultGeneratorConfig(seed), ...test.generatorConfig }
      : createDefaultGeneratorConfig(seed);
    const generator = new OperationGenerator(generatorConfig);

    // Initialize generator with current state
    generator.initializeFromState(createStateSnapshot(protocol));

    // Generate and execute operations
    const operations = generator.generateSequence(this.config.maxOperationsPerIteration);
    let operationsExecuted = 0;
    let operationsFailed = 0;

    for (const op of operations) {
      const result = await executeOperation(protocol, op);
      if (result.success) {
        operationsExecuted++;
      } else {
        operationsFailed++;
      }
    }

    // Check invariant
    const state = createStateSnapshot(protocol);
    const checkResult = test.checker(state);

    return {
      iteration,
      seed,
      operationsExecuted,
      operationsFailed,
      invariantHeld: checkResult.holds,
      violation: checkResult.violation,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Run all invariant tests
   */
  async runAll(tests: InvariantTest[]): Promise<InvariantSuiteResult> {
    const startTime = now();
    const results: InvariantTestResult[] = [];

    for (const test of tests) {
      const result = await this.runInvariant(test);
      results.push(result);
    }

    const completedAt = now();
    const totalIterations = results.reduce((acc, r) => acc + r.totalIterations, 0);
    const passedTests = results.filter(r => r.passRate === 1).length;

    return {
      results,
      overallPassRate: passedTests / results.length,
      allPassed: passedTests === results.length,
      totalDurationMs: completedAt - startTime,
      totalIterations,
      startedAt: startTime,
      completedAt,
    };
  }
}

// ============================================
// PREDEFINED INVARIANT TESTS
// ============================================

/**
 * Create standard invariant test definitions
 */
export function createStandardInvariantTests(
  config: Partial<InvariantRunnerConfig> = {}
): InvariantTest[] {
  const iterations = config.defaultIterations ?? DEFAULT_RUNNER_CONFIG.defaultIterations;

  return [
    {
      id: 'INV-01',
      property: 'Conservation: SUM(balance) = 0',
      iterations,
      checker: checkConservation,
    },
    {
      id: 'INV-02',
      property: 'Floor: balance >= -limit',
      iterations,
      checker: checkFloor,
    },
    {
      id: 'INV-03',
      property: 'Reserve >= 0',
      iterations: Math.floor(iterations / 2), // Fewer iterations for simpler check
      checker: checkReserveNonNegative,
    },
    {
      id: 'INV-04',
      property: 'Escrow safety: balance - reserve >= -limit',
      iterations: Math.floor(iterations / 2),
      checker: checkEscrowSafety,
    },
    {
      id: 'INV-05',
      property: 'Federation sum = 0',
      iterations: Math.floor(iterations / 2),
      checker: (state) => checkFederationSum(new Map([[state.cellId, state]])),
      generatorConfig: { federationEnabled: true },
    },
    {
      id: 'INV-06',
      property: 'Federation cap respected',
      iterations: Math.floor(iterations / 2),
      checker: checkFederationCap,
      generatorConfig: { federationEnabled: true },
    },
  ];
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

/**
 * Create an invariant runner with default config
 */
export function createInvariantRunner(
  config?: Partial<InvariantRunnerConfig>
): InvariantRunner {
  return new InvariantRunner(config);
}

// Re-export default config from types
export { DEFAULT_RUNNER_CONFIG } from '../types/invariant';
