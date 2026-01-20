/**
 * Cell Protocol - Commitment Engine
 *
 * Implementation of the Commitment System (PRD-03).
 * Manages commitments between members, including:
 * - Soft commitments (trust-based)
 * - Escrowed commitments (reserve capacity)
 * - Fulfillment and cancellation
 */

import {
  IdentityId,
  Timestamp,
  Units,
  MembershipStatus,
  BalanceChangeReason,
  now,
  generateId,
} from '../types/common';
import {
  Commitment,
  CommitmentId,
  CommitmentType,
  CommitmentStatus,
  TaskCategory,
  CreateCommitmentInput,
  FulfillmentConfirmation,
  CommitmentError,
  CommitmentErrorCode,
  MemberCommitmentStats,
  ICommitmentEngine,
} from '../types/commitment';
import { LedgerEngine } from './ledger-engine';
import { TransactionEngine } from './transaction-engine';
import { IStorage } from '../storage/pouchdb-adapter';

// ============================================
// COMMITMENT ENGINE IMPLEMENTATION
// ============================================

export class CommitmentEngine implements ICommitmentEngine {
  private ledger: LedgerEngine;
  private transactions: TransactionEngine;
  private storage: IStorage;

  constructor(
    ledger: LedgerEngine,
    transactions: TransactionEngine,
    storage: IStorage
  ) {
    this.ledger = ledger;
    this.transactions = transactions;
    this.storage = storage;
  }

  // ============================================
  // CREATION
  // ============================================

  /**
   * Create a new commitment
   */
  async createCommitment(input: CreateCommitmentInput): Promise<Commitment> {
    // Validate promisor
    const promisorState = this.ledger.getMemberState(input.promisor);
    if (!promisorState) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.INVALID_PROMISOR,
        message: `Promisor ${input.promisor} not found`,
      });
    }
    if (promisorState.status !== MembershipStatus.ACTIVE) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.INVALID_PROMISOR,
        message: `Promisor ${input.promisor} is not active`,
      });
    }

    // Validate promisee
    const promiseeState = this.ledger.getMemberState(input.promisee);
    if (!promiseeState) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.INVALID_PROMISEE,
        message: `Promisee ${input.promisee} not found`,
      });
    }
    if (promiseeState.status !== MembershipStatus.ACTIVE) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.INVALID_PROMISEE,
        message: `Promisee ${input.promisee} is not active`,
      });
    }

    // Cannot commit to yourself
    if (input.promisor === input.promisee) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.SELF_COMMITMENT,
        message: 'Cannot create commitment to yourself',
      });
    }

    // Validate value
    if (input.value <= 0) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.INVALID_VALUE,
        message: 'Commitment value must be positive',
      });
    }

    // Validate due date if provided
    if (input.dueDate && input.dueDate <= now()) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.INVALID_DUE_DATE,
        message: 'Due date must be in the future',
      });
    }

    // For escrowed commitments, check and reserve capacity
    if (input.type === CommitmentType.ESCROWED) {
      // The promisee (payer) needs the capacity
      const availableCapacity = this.ledger.getAvailableCapacity(input.promisee);
      if (input.value > availableCapacity) {
        throw new CommitmentValidationError({
          code: CommitmentErrorCode.INSUFFICIENT_CAPACITY,
          message: `Promisee ${input.promisee} has insufficient capacity: ${availableCapacity} < ${input.value}`,
          details: { availableCapacity, required: input.value },
        });
      }
    }

    // Create the commitment
    const commitment: Commitment = {
      id: generateId(),
      type: input.type,
      promisor: input.promisor,
      promisee: input.promisee,
      value: input.value,
      category: input.category,
      description: input.description,
      dueDate: input.dueDate,
      status: CommitmentStatus.ACTIVE, // Start as active for simplicity
      createdAt: now(),
    };

    // For escrowed commitments, reserve capacity on promisee (payer)
    if (input.type === CommitmentType.ESCROWED) {
      await this.ledger.applyReserveUpdate({
        memberId: input.promisee,
        delta: input.value,
        reason: BalanceChangeReason.COMMITMENT_RESERVE,
        commitmentId: commitment.id,
      });
    }

    // Save to storage
    const result = await this.storage.saveCommitment(commitment);
    if (!result.ok) {
      // Rollback reserve if save fails
      if (input.type === CommitmentType.ESCROWED) {
        await this.ledger.applyReserveUpdate({
          memberId: input.promisee,
          delta: -input.value,
          reason: BalanceChangeReason.COMMITMENT_RELEASE,
          commitmentId: commitment.id,
        });
      }
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }

    // Log event
    await this.storage.appendEvent({
      cellId: this.ledger.getCellId(),
      type: 'COMMITMENT_CREATED',
      timestamp: now(),
      data: {
        commitmentId: commitment.id,
        promisor: commitment.promisor,
        promisee: commitment.promisee,
        value: commitment.value,
        category: commitment.category,
        type: commitment.type,
      },
    });

    return commitment;
  }

  // ============================================
  // LIFECYCLE
  // ============================================

  /**
   * Accept a proposed commitment (makes it active)
   */
  async acceptCommitment(id: CommitmentId, accepterId: IdentityId): Promise<Commitment> {
    const commitment = await this.getCommitment(id);
    if (!commitment) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.NOT_FOUND,
        message: `Commitment ${id} not found`,
      });
    }

    if (commitment.status !== CommitmentStatus.PROPOSED) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.INVALID_STATUS_TRANSITION,
        message: `Cannot accept commitment in status ${commitment.status}`,
      });
    }

    // Only promisor can accept (they are committing to do the work)
    if (accepterId !== commitment.promisor) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.UNAUTHORIZED_CONFIRMATION,
        message: 'Only promisor can accept commitment',
      });
    }

    commitment.status = CommitmentStatus.ACTIVE;

    await this.storage.saveCommitment(commitment);

    return commitment;
  }

  /**
   * Fulfill a commitment - executes the transaction
   */
  async fulfillCommitment(
    id: CommitmentId,
    confirmation: FulfillmentConfirmation
  ): Promise<{ commitment: Commitment; payerNewBalance: Units; payeeNewBalance: Units }> {
    const commitment = await this.getCommitment(id);
    if (!commitment) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.NOT_FOUND,
        message: `Commitment ${id} not found`,
      });
    }

    if (commitment.status !== CommitmentStatus.ACTIVE) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.INVALID_STATUS_TRANSITION,
        message: `Cannot fulfill commitment in status ${commitment.status}`,
      });
    }

    // Only promisee (payer/requester) can confirm fulfillment
    if (confirmation.confirmedBy !== commitment.promisee) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.UNAUTHORIZED_CONFIRMATION,
        message: 'Only promisee can confirm fulfillment',
      });
    }

    // For escrowed commitments, release the reserve first
    if (commitment.type === CommitmentType.ESCROWED) {
      await this.ledger.applyReserveUpdate({
        memberId: commitment.promisee,
        delta: -commitment.value,
        reason: BalanceChangeReason.COMMITMENT_RELEASE,
        commitmentId: commitment.id,
      });
    }

    // Execute the transaction: promisee pays promisor
    // Create the transaction
    const tx = await this.transactions.createSpotTransaction({
      payer: commitment.promisee,
      payee: commitment.promisor,
      amount: commitment.value,
      description: `Commitment fulfilled: ${commitment.description}`,
    });

    // For simplicity in this implementation, we execute immediately without signatures
    // In a real system, we'd need to handle the signature flow
    const txResult = await this.ledger.applyBalanceUpdates([
      {
        memberId: commitment.promisee,
        delta: -commitment.value,
        reason: BalanceChangeReason.COMMITMENT_EXECUTE,
        referenceId: commitment.id,
      },
      {
        memberId: commitment.promisor,
        delta: commitment.value,
        reason: BalanceChangeReason.COMMITMENT_EXECUTE,
        referenceId: commitment.id,
      },
    ]);

    // Update commitment status
    commitment.status = CommitmentStatus.FULFILLED;
    commitment.fulfilledAt = now();

    await this.storage.saveCommitment(commitment);

    // Log event
    await this.storage.appendEvent({
      cellId: this.ledger.getCellId(),
      type: 'COMMITMENT_FULFILLED',
      timestamp: now(),
      data: {
        commitmentId: commitment.id,
        confirmedBy: confirmation.confirmedBy,
        rating: confirmation.rating,
      },
    });

    return {
      commitment,
      payerNewBalance: txResult[0].newBalance,
      payeeNewBalance: txResult[1].newBalance,
    };
  }

  /**
   * Cancel a commitment
   */
  async cancelCommitment(
    id: CommitmentId,
    reason: string,
    initiatorId: IdentityId
  ): Promise<Commitment> {
    const commitment = await this.getCommitment(id);
    if (!commitment) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.NOT_FOUND,
        message: `Commitment ${id} not found`,
      });
    }

    // Can only cancel PROPOSED or ACTIVE commitments
    if (commitment.status !== CommitmentStatus.PROPOSED &&
        commitment.status !== CommitmentStatus.ACTIVE) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.CANNOT_CANCEL,
        message: `Cannot cancel commitment in status ${commitment.status}`,
      });
    }

    // Must be a party to the commitment
    if (initiatorId !== commitment.promisor && initiatorId !== commitment.promisee) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.UNAUTHORIZED_CONFIRMATION,
        message: 'Only parties to the commitment can cancel it',
      });
    }

    // For escrowed commitments, release the reserve
    if (commitment.type === CommitmentType.ESCROWED &&
        commitment.status === CommitmentStatus.ACTIVE) {
      await this.ledger.applyReserveUpdate({
        memberId: commitment.promisee,
        delta: -commitment.value,
        reason: BalanceChangeReason.COMMITMENT_RELEASE,
        commitmentId: commitment.id,
      });
    }

    commitment.status = CommitmentStatus.CANCELLED;
    commitment.cancelledAt = now();
    commitment.notes = reason;

    await this.storage.saveCommitment(commitment);

    // Log event
    await this.storage.appendEvent({
      cellId: this.ledger.getCellId(),
      type: 'COMMITMENT_CANCELLED',
      timestamp: now(),
      data: {
        commitmentId: commitment.id,
        initiator: initiatorId,
        reason,
      },
    });

    return commitment;
  }

  /**
   * Mark commitment as disputed
   */
  async disputeCommitment(
    id: CommitmentId,
    reason: string,
    initiatorId: IdentityId
  ): Promise<Commitment> {
    const commitment = await this.getCommitment(id);
    if (!commitment) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.NOT_FOUND,
        message: `Commitment ${id} not found`,
      });
    }

    if (commitment.status !== CommitmentStatus.ACTIVE) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.INVALID_STATUS_TRANSITION,
        message: `Cannot dispute commitment in status ${commitment.status}`,
      });
    }

    // Must be a party to the commitment
    if (initiatorId !== commitment.promisor && initiatorId !== commitment.promisee) {
      throw new CommitmentValidationError({
        code: CommitmentErrorCode.UNAUTHORIZED_CONFIRMATION,
        message: 'Only parties to the commitment can dispute it',
      });
    }

    commitment.status = CommitmentStatus.DISPUTED;
    commitment.notes = reason;

    await this.storage.saveCommitment(commitment);

    // Log event
    await this.storage.appendEvent({
      cellId: this.ledger.getCellId(),
      type: 'COMMITMENT_DISPUTED',
      timestamp: now(),
      data: {
        commitmentId: commitment.id,
        initiator: initiatorId,
        reason,
      },
    });

    return commitment;
  }

  // ============================================
  // QUERIES
  // ============================================

  async getCommitment(id: CommitmentId): Promise<Commitment | undefined> {
    const result = await this.storage.getCommitment(id);
    if (!result.ok) return undefined;
    return result.value ?? undefined;
  }

  async getCommitmentsByMember(memberId: IdentityId): Promise<Commitment[]> {
    const result = await this.storage.getCommitmentsByMember(memberId);
    if (!result.ok) return [];
    return result.value;
  }

  async getActiveCommitments(): Promise<Commitment[]> {
    const result = await this.storage.getCommitmentsByStatus(CommitmentStatus.ACTIVE);
    if (!result.ok) return [];
    return result.value;
  }

  async getOverdueCommitments(): Promise<Commitment[]> {
    const active = await this.getActiveCommitments();
    const currentTime = now();
    return active.filter(c => c.dueDate && c.dueDate < currentTime);
  }

  async getCommitmentsByCategory(category: TaskCategory): Promise<Commitment[]> {
    const result = await this.storage.getCommitmentsByCategory(category);
    if (!result.ok) return [];
    return result.value;
  }

  // ============================================
  // ANALYTICS
  // ============================================

  /**
   * Get total reserved capacity for a member
   */
  getMemberReservedCapacity(memberId: IdentityId): Units {
    const state = this.ledger.getMemberState(memberId);
    return state?.reserve ?? 0;
  }

  /**
   * Get fulfillment rate for a category
   */
  async getCategoryFulfillmentRate(category: TaskCategory): Promise<number> {
    const commitments = await this.getCommitmentsByCategory(category);
    if (commitments.length === 0) return 0;

    const fulfilled = commitments.filter(c => c.status === CommitmentStatus.FULFILLED).length;
    const completed = commitments.filter(c =>
      c.status === CommitmentStatus.FULFILLED ||
      c.status === CommitmentStatus.CANCELLED
    ).length;

    if (completed === 0) return 0;
    return fulfilled / completed;
  }

  /**
   * Get member commitment statistics
   */
  async getMemberStats(memberId: IdentityId): Promise<MemberCommitmentStats> {
    const commitments = await this.getCommitmentsByMember(memberId);

    const asPromisor = commitments.filter(c => c.promisor === memberId);
    const asPromisee = commitments.filter(c => c.promisee === memberId);
    const fulfilledAsPromisor = asPromisor.filter(c => c.status === CommitmentStatus.FULFILLED);

    // Calculate active reserved value (commitments where member is promisee with escrow)
    const activeReservedValue = commitments
      .filter(c =>
        c.promisee === memberId &&
        c.type === CommitmentType.ESCROWED &&
        c.status === CommitmentStatus.ACTIVE
      )
      .reduce((sum, c) => sum + c.value, 0);

    return {
      asPromisor: asPromisor.length,
      asPromisee: asPromisee.length,
      fulfilledAsPromisor: fulfilledAsPromisor.length,
      averageRating: undefined, // Would need to track ratings
      activeReservedValue,
    };
  }
}

// ============================================
// CUSTOM ERROR CLASS
// ============================================

export class CommitmentValidationError extends Error {
  public readonly code: CommitmentErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(error: CommitmentError) {
    super(error.message);
    this.name = 'CommitmentValidationError';
    this.code = error.code;
    this.details = error.details;
  }

  toJSON(): CommitmentError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

// ============================================
// FACTORY
// ============================================

/**
 * Create a new commitment engine
 */
export function createCommitmentEngine(
  ledger: LedgerEngine,
  transactions: TransactionEngine,
  storage: IStorage
): CommitmentEngine {
  return new CommitmentEngine(ledger, transactions, storage);
}
