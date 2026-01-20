/**
 * Cell Protocol - Hardening: Operation Generator
 *
 * Generates random operations for property-based testing.
 * Uses seeded random number generation for reproducibility.
 */

import { IdentityId, CellId, Units, generateId } from '../../types/common';
import { CommitmentId } from '../../types/commitment';
import {
  Operation,
  TransactionOp,
  CommitmentCreateOp,
  CommitmentFulfillOp,
  CommitmentCancelOp,
  LimitAdjustOp,
  MemberAddOp,
  MemberRemoveOp,
  FederationTxOp,
  GeneratorConfig,
  OperationWeights,
  CellStateSnapshot,
  MemberSnapshot,
  CommitmentSnapshot,
  DEFAULT_OPERATION_WEIGHTS,
} from '../types/invariant';

// ============================================
// SEEDED RANDOM NUMBER GENERATOR
// ============================================

/**
 * Simple seeded PRNG (Mulberry32)
 * Provides reproducible random sequences from a seed
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Generate next random number in [0, 1) */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Generate random integer in [min, max] */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Generate random float in [min, max] */
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /** Pick random element from array */
  pick<T>(array: T[]): T | undefined {
    if (array.length === 0) return undefined;
    return array[this.nextInt(0, array.length - 1)];
  }

  /** Pick N random elements from array (without replacement) */
  pickN<T>(array: T[], n: number): T[] {
    const result: T[] = [];
    const copy = [...array];
    for (let i = 0; i < Math.min(n, copy.length); i++) {
      const idx = this.nextInt(0, copy.length - 1);
      result.push(copy[idx]);
      copy.splice(idx, 1);
    }
    return result;
  }

  /** Pick with probability */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Get current seed state (for reproduction) */
  getState(): number {
    return this.state;
  }

  /** Clone with same state */
  clone(): SeededRandom {
    const cloned = new SeededRandom(0);
    cloned.state = this.state;
    return cloned;
  }
}

// ============================================
// OPERATION GENERATOR
// ============================================

/**
 * Generates random but valid operations for property testing
 */
export class OperationGenerator {
  private rng: SeededRandom;
  private config: GeneratorConfig;
  private memberIds: IdentityId[] = [];
  private commitmentIds: CommitmentId[] = [];
  private activeCommitments: Map<CommitmentId, CommitmentSnapshot> = new Map();
  private nextMemberId = 1;

  constructor(config: GeneratorConfig) {
    this.rng = new SeededRandom(config.seed);
    this.config = config;
  }

  /**
   * Initialize generator with existing cell state
   */
  initializeFromState(state: CellStateSnapshot): void {
    this.memberIds = state.members.filter(m => m.isActive).map(m => m.memberId);
    this.activeCommitments.clear();
    for (const c of state.commitments.filter(c => c.isActive)) {
      this.activeCommitments.set(c.id, c);
      this.commitmentIds.push(c.id);
    }
  }

  /**
   * Generate a sequence of operations
   */
  generateSequence(count: number): Operation[] {
    const operations: Operation[] = [];
    for (let i = 0; i < count; i++) {
      const op = this.generateOperation();
      if (op) {
        operations.push(op);
        this.updateInternalState(op);
      }
    }
    return operations;
  }

  /**
   * Generate a single random operation
   */
  generateOperation(): Operation | null {
    const opType = this.selectOperationType();

    switch (opType) {
      case 'TRANSACTION':
        return this.generateTransaction();
      case 'COMMITMENT_CREATE':
        return this.generateCommitmentCreate();
      case 'COMMITMENT_FULFILL':
        return this.generateCommitmentFulfill();
      case 'COMMITMENT_CANCEL':
        return this.generateCommitmentCancel();
      case 'LIMIT_ADJUST':
        return this.generateLimitAdjust();
      case 'MEMBER_ADD':
        return this.generateMemberAdd();
      case 'MEMBER_REMOVE':
        return this.generateMemberRemove();
      case 'FEDERATION_TX':
        return this.generateFederationTx();
      default:
        return null;
    }
  }

  /**
   * Select operation type based on weights
   */
  private selectOperationType(): keyof OperationWeights {
    const weights = this.config.operationWeights;
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    let random = this.rng.nextFloat(0, totalWeight);

    for (const [type, weight] of Object.entries(weights)) {
      random -= weight;
      if (random <= 0) {
        return type as keyof OperationWeights;
      }
    }
    return 'TRANSACTION';
  }

  /**
   * Generate a spot transaction
   */
  private generateTransaction(): TransactionOp | null {
    if (this.memberIds.length < 2) return null;

    const [payer, payee] = this.rng.pickN(this.memberIds, 2);
    if (!payer || !payee) return null;

    const amount = this.rng.nextInt(
      this.config.amountRange.min,
      this.config.amountRange.max
    );

    return {
      type: 'TRANSACTION',
      payer,
      payee,
      amount,
    };
  }

  /**
   * Generate a commitment creation
   */
  private generateCommitmentCreate(): CommitmentCreateOp | null {
    if (this.memberIds.length < 2) return null;

    const [promisor, promisee] = this.rng.pickN(this.memberIds, 2);
    if (!promisor || !promisee) return null;

    const value = this.rng.nextInt(
      this.config.amountRange.min,
      this.config.amountRange.max
    );

    const escrowed = this.rng.chance(0.6); // 60% escrowed

    return {
      type: 'COMMITMENT_CREATE',
      promisor,
      promisee,
      value,
      escrowed,
    };
  }

  /**
   * Generate a commitment fulfillment
   */
  private generateCommitmentFulfill(): CommitmentFulfillOp | null {
    if (this.activeCommitments.size === 0) return null;

    const commitmentId = this.rng.pick([...this.activeCommitments.keys()]);
    if (!commitmentId) return null;

    return {
      type: 'COMMITMENT_FULFILL',
      commitmentId,
    };
  }

  /**
   * Generate a commitment cancellation
   */
  private generateCommitmentCancel(): CommitmentCancelOp | null {
    if (this.activeCommitments.size === 0) return null;

    const commitmentId = this.rng.pick([...this.activeCommitments.keys()]);
    if (!commitmentId) return null;

    const commitment = this.activeCommitments.get(commitmentId);
    if (!commitment) return null;

    // Either promisor or promisee can cancel
    const initiatorId = this.rng.chance(0.5)
      ? commitment.promisor
      : commitment.promisee;

    return {
      type: 'COMMITMENT_CANCEL',
      commitmentId,
      initiatorId,
    };
  }

  /**
   * Generate a limit adjustment
   */
  private generateLimitAdjust(): LimitAdjustOp | null {
    if (this.memberIds.length === 0) return null;

    const memberId = this.rng.pick(this.memberIds);
    if (!memberId) return null;

    const newLimit = this.rng.nextInt(
      this.config.limitRange.min,
      this.config.limitRange.max
    );

    return {
      type: 'LIMIT_ADJUST',
      memberId,
      newLimit,
    };
  }

  /**
   * Generate a member addition
   */
  private generateMemberAdd(): MemberAddOp {
    // Use seeded RNG for deterministic member IDs (important for reproducibility)
    const randomSuffix = this.rng.nextInt(1000, 9999);
    const memberId = `member-${this.nextMemberId++}-${randomSuffix}`;
    const displayName = `Member ${this.nextMemberId}`;
    const limit = this.rng.nextInt(
      this.config.limitRange.min,
      this.config.limitRange.max
    );

    return {
      type: 'MEMBER_ADD',
      memberId,
      displayName,
      limit,
    };
  }

  /**
   * Generate a member removal
   */
  private generateMemberRemove(): MemberRemoveOp | null {
    if (this.memberIds.length < 3) return null; // Keep at least 2 members

    const memberId = this.rng.pick(this.memberIds);
    if (!memberId) return null;

    return {
      type: 'MEMBER_REMOVE',
      memberId,
    };
  }

  /**
   * Generate a federation transaction
   */
  private generateFederationTx(): FederationTxOp | null {
    if (!this.config.federationEnabled) return null;
    if (!this.config.federationCellIds || this.config.federationCellIds.length < 2) return null;
    if (this.memberIds.length < 2) return null;

    const [sourceCell, targetCell] = this.rng.pickN(this.config.federationCellIds, 2);
    if (!sourceCell || !targetCell) return null;

    const payer = this.rng.pick(this.memberIds);
    const payee = this.rng.pick(this.memberIds);
    if (!payer || !payee) return null;

    const amount = this.rng.nextInt(
      this.config.amountRange.min,
      this.config.amountRange.max
    );

    return {
      type: 'FEDERATION_TX',
      sourceCell,
      targetCell,
      payer,
      payee,
      amount,
    };
  }

  /**
   * Update internal state after operation
   */
  private updateInternalState(op: Operation): void {
    switch (op.type) {
      case 'MEMBER_ADD':
        this.memberIds.push(op.memberId);
        break;
      case 'MEMBER_REMOVE':
        this.memberIds = this.memberIds.filter(id => id !== op.memberId);
        break;
      case 'COMMITMENT_CREATE':
        // Will be tracked when commitment is actually created
        break;
      case 'COMMITMENT_FULFILL':
      case 'COMMITMENT_CANCEL':
        this.activeCommitments.delete(op.commitmentId);
        break;
    }
  }

  /**
   * Track a new commitment
   */
  trackCommitment(id: CommitmentId, snapshot: CommitmentSnapshot): void {
    this.activeCommitments.set(id, snapshot);
    this.commitmentIds.push(id);
  }

  /**
   * Remove a commitment
   */
  removeCommitment(id: CommitmentId): void {
    this.activeCommitments.delete(id);
  }

  /**
   * Get current RNG state for reproduction
   */
  getRngState(): number {
    return this.rng.getState();
  }

  /**
   * Reset RNG with new seed
   */
  reset(seed: number): void {
    this.rng = new SeededRandom(seed);
    this.memberIds = [];
    this.commitmentIds = [];
    this.activeCommitments.clear();
    this.nextMemberId = 1;
  }

  /**
   * Get member count
   */
  getMemberCount(): number {
    return this.memberIds.length;
  }

  /**
   * Get active commitment count
   */
  getActiveCommitmentCount(): number {
    return this.activeCommitments.size;
  }
}

// ============================================
// FACTORY FUNCTIONS
// ============================================

/**
 * Create a generator with default config
 */
export function createOperationGenerator(seed: number): OperationGenerator {
  return new OperationGenerator({
    seed,
    operationWeights: DEFAULT_OPERATION_WEIGHTS,
    amountRange: { min: 1, max: 500 },
    limitRange: { min: 100, max: 1000 },
    maxOperations: 50,
    federationEnabled: false,
  });
}

/**
 * Create a generator with custom config
 */
export function createCustomOperationGenerator(config: GeneratorConfig): OperationGenerator {
  return new OperationGenerator(config);
}

/**
 * Create default generator config
 */
export function createDefaultGeneratorConfig(seed: number): GeneratorConfig {
  return {
    seed,
    operationWeights: { ...DEFAULT_OPERATION_WEIGHTS },
    amountRange: { min: 1, max: 500 },
    limitRange: { min: 100, max: 1000 },
    maxOperations: 50,
    federationEnabled: false,
  };
}

/**
 * Create federation-enabled generator config
 */
export function createFederationGeneratorConfig(
  seed: number,
  cellIds: CellId[]
): GeneratorConfig {
  return {
    seed,
    operationWeights: { ...DEFAULT_OPERATION_WEIGHTS },
    amountRange: { min: 1, max: 500 },
    limitRange: { min: 100, max: 1000 },
    maxOperations: 50,
    federationEnabled: true,
    federationCellIds: cellIds,
  };
}
