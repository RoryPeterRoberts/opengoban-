/**
 * Cell Protocol - Transaction Engine
 *
 * Implementation of the Transaction System (PRD-02).
 * Handles spot transactions with dual-signature verification.
 */

import {
  IdentityId,
  TransactionId,
  Timestamp,
  Units,
  Signature,
  MembershipStatus,
  BalanceChangeReason,
  now,
  generateId,
} from '../types/common';
import {
  SpotTransaction,
  TransactionType,
  TransactionStatus,
  TransactionSignatures,
  CreateSpotTransactionInput,
  TransactionSigningData,
  TransactionResult,
  TransactionError,
  TransactionErrorCode,
  QueuedTransaction,
  ITransactionEngine,
} from '../types/transaction';
import { BalanceUpdate } from '../types/ledger';
import { Result, ok, err } from '../utils/result';
import { IStorage } from '../storage/pouchdb-adapter';
import { LedgerEngine, LedgerViolationError } from './ledger-engine';
import {
  CryptoAdapter,
  createTransactionSigningData,
} from '../crypto/crypto-adapter';

// ============================================
// TRANSACTION ENGINE IMPLEMENTATION
// ============================================

export class TransactionEngine implements ITransactionEngine {
  private ledger: LedgerEngine;
  private storage: IStorage;
  private crypto: CryptoAdapter;
  private publicKeyResolver: (memberId: IdentityId) => Promise<string | undefined>;

  constructor(
    ledger: LedgerEngine,
    storage: IStorage,
    crypto: CryptoAdapter,
    publicKeyResolver: (memberId: IdentityId) => Promise<string | undefined>
  ) {
    this.ledger = ledger;
    this.storage = storage;
    this.crypto = crypto;
    this.publicKeyResolver = publicKeyResolver;
  }

  // ============================================
  // TRANSACTION CREATION
  // ============================================

  /**
   * Create a new spot transaction (unsigned)
   */
  async createSpotTransaction(input: CreateSpotTransactionInput): Promise<SpotTransaction> {
    // Generate unique ID and nonce
    const id = generateId();
    const nonce = this.crypto.generateNonce();
    const createdAt = now();

    // Validate input
    const validationError = this.validateInput(input);
    if (validationError) {
      throw new TransactionValidationError(validationError);
    }

    const transaction: SpotTransaction = {
      id,
      type: TransactionType.SPOT,
      payer: input.payer,
      payee: input.payee,
      amount: input.amount,
      description: input.description,
      createdAt,
      status: TransactionStatus.PENDING,
      signatures: {},
      nonce,
    };

    // Save to storage
    const result = await this.storage.saveTransaction(transaction);
    if (!result.ok) {
      throw new Error(`Failed to save transaction: ${result.error.message}`);
    }

    return transaction;
  }

  /**
   * Validate transaction input
   */
  private validateInput(input: CreateSpotTransactionInput): TransactionError | null {
    // Self-transaction check
    if (input.payer === input.payee) {
      return {
        code: TransactionErrorCode.SELF_TRANSACTION,
        message: 'Cannot pay yourself',
      };
    }

    // Positive amount check
    if (input.amount <= 0) {
      return {
        code: TransactionErrorCode.INVALID_AMOUNT,
        message: 'Amount must be positive',
        details: { amount: input.amount },
      };
    }

    // Check payer membership
    const payerState = this.ledger.getMemberState(input.payer);
    if (!payerState) {
      return {
        code: TransactionErrorCode.PAYER_NOT_MEMBER,
        message: `Payer ${input.payer} is not a member`,
      };
    }
    if (payerState.status !== MembershipStatus.ACTIVE) {
      return {
        code: TransactionErrorCode.PAYER_NOT_MEMBER,
        message: `Payer ${input.payer} is not active (status: ${payerState.status})`,
      };
    }

    // Check payee membership
    const payeeState = this.ledger.getMemberState(input.payee);
    if (!payeeState) {
      return {
        code: TransactionErrorCode.PAYEE_NOT_MEMBER,
        message: `Payee ${input.payee} is not a member`,
      };
    }
    if (payeeState.status !== MembershipStatus.ACTIVE) {
      return {
        code: TransactionErrorCode.PAYEE_NOT_MEMBER,
        message: `Payee ${input.payee} is not active (status: ${payeeState.status})`,
      };
    }

    // Check spending capacity
    if (!this.ledger.canSpend(input.payer, input.amount)) {
      const capacity = this.ledger.getAvailableCapacity(input.payer);
      return {
        code: TransactionErrorCode.INSUFFICIENT_CAPACITY,
        message: `Payer has insufficient capacity. Available: ${capacity}, Required: ${input.amount}`,
        details: {
          availableCapacity: capacity,
          requestedAmount: input.amount,
        },
      };
    }

    return null;
  }

  // ============================================
  // TRANSACTION RETRIEVAL
  // ============================================

  /**
   * Get a transaction by ID
   */
  async getTransaction(id: TransactionId): Promise<SpotTransaction | undefined> {
    const result = await this.storage.getTransaction(id);
    if (!result.ok) {
      throw new Error(`Failed to get transaction: ${result.error.message}`);
    }
    return result.value ?? undefined;
  }

  // ============================================
  // SIGNATURE HANDLING
  // ============================================

  /**
   * Get the canonical signing data for a transaction
   */
  getSigningData(transaction: SpotTransaction): TransactionSigningData {
    return {
      payer: transaction.payer,
      payee: transaction.payee,
      amount: transaction.amount,
      description: transaction.description,
      createdAt: transaction.createdAt,
      nonce: transaction.nonce,
    };
  }

  /**
   * Add payer signature to transaction
   */
  async signAsPayer(id: TransactionId, signature: Signature): Promise<SpotTransaction> {
    const transaction = await this.getTransaction(id);
    if (!transaction) {
      throw new TransactionValidationError({
        code: TransactionErrorCode.NOT_FOUND,
        message: `Transaction ${id} not found`,
      });
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      throw new TransactionValidationError({
        code: TransactionErrorCode.INVALID_STATUS,
        message: `Cannot sign transaction in status ${transaction.status}`,
      });
    }

    // Verify signature
    const publicKey = await this.publicKeyResolver(transaction.payer);
    if (!publicKey) {
      throw new TransactionValidationError({
        code: TransactionErrorCode.INVALID_PAYER_SIGNATURE,
        message: `Could not resolve public key for payer ${transaction.payer}`,
      });
    }

    const signingData = this.getSigningData(transaction);
    const message = createTransactionSigningData(signingData);
    const isValid = this.crypto.verify(message, signature, publicKey);

    if (!isValid) {
      throw new TransactionValidationError({
        code: TransactionErrorCode.INVALID_PAYER_SIGNATURE,
        message: 'Invalid payer signature',
      });
    }

    // Update transaction
    transaction.signatures.payer = signature;

    // Update status if both signatures present
    if (transaction.signatures.payee) {
      transaction.status = TransactionStatus.READY;
    }

    await this.storage.saveTransaction(transaction);
    return transaction;
  }

  /**
   * Add payee signature to transaction
   */
  async signAsPayee(id: TransactionId, signature: Signature): Promise<SpotTransaction> {
    const transaction = await this.getTransaction(id);
    if (!transaction) {
      throw new TransactionValidationError({
        code: TransactionErrorCode.NOT_FOUND,
        message: `Transaction ${id} not found`,
      });
    }

    if (transaction.status !== TransactionStatus.PENDING) {
      throw new TransactionValidationError({
        code: TransactionErrorCode.INVALID_STATUS,
        message: `Cannot sign transaction in status ${transaction.status}`,
      });
    }

    // Verify signature
    const publicKey = await this.publicKeyResolver(transaction.payee);
    if (!publicKey) {
      throw new TransactionValidationError({
        code: TransactionErrorCode.INVALID_PAYEE_SIGNATURE,
        message: `Could not resolve public key for payee ${transaction.payee}`,
      });
    }

    const signingData = this.getSigningData(transaction);
    const message = createTransactionSigningData(signingData);
    const isValid = this.crypto.verify(message, signature, publicKey);

    if (!isValid) {
      throw new TransactionValidationError({
        code: TransactionErrorCode.INVALID_PAYEE_SIGNATURE,
        message: 'Invalid payee signature',
      });
    }

    // Update transaction
    transaction.signatures.payee = signature;

    // Update status if both signatures present
    if (transaction.signatures.payer) {
      transaction.status = TransactionStatus.READY;
    }

    await this.storage.saveTransaction(transaction);
    return transaction;
  }

  // ============================================
  // TRANSACTION EXECUTION
  // ============================================

  /**
   * Execute a fully signed transaction
   */
  async executeTransaction(id: TransactionId): Promise<TransactionResult> {
    const transaction = await this.getTransaction(id);
    if (!transaction) {
      throw new TransactionValidationError({
        code: TransactionErrorCode.NOT_FOUND,
        message: `Transaction ${id} not found`,
      });
    }

    // Validate before execution
    const validationError = this.validateTransaction(transaction);
    if (validationError) {
      transaction.status = TransactionStatus.FAILED;
      await this.storage.saveTransaction(transaction);
      throw new TransactionValidationError(validationError);
    }

    // Prepare balance updates
    const updates: BalanceUpdate[] = [
      {
        memberId: transaction.payer,
        delta: -transaction.amount,
        reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER,
        referenceId: transaction.id,
      },
      {
        memberId: transaction.payee,
        delta: +transaction.amount,
        reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE,
        referenceId: transaction.id,
      },
    ];

    // Execute atomic balance update
    try {
      const results = await this.ledger.applyBalanceUpdates(updates);

      // Update transaction status
      transaction.status = TransactionStatus.EXECUTED;
      transaction.executedAt = now();
      await this.storage.saveTransaction(transaction);

      return {
        transaction,
        payerNewBalance: results[0].newBalance,
        payeeNewBalance: results[1].newBalance,
        sequenceNumber: results[0].sequenceNumber,
      };
    } catch (e) {
      // Mark as failed
      transaction.status = TransactionStatus.FAILED;
      await this.storage.saveTransaction(transaction);

      if (e instanceof LedgerViolationError) {
        throw new TransactionValidationError({
          code: TransactionErrorCode.LEDGER_ERROR,
          message: e.message,
          details: e.details,
        });
      }
      throw e;
    }
  }

  /**
   * Validate a transaction without executing
   */
  validateTransaction(transaction: SpotTransaction): TransactionError | null {
    // Check status
    if (transaction.status !== TransactionStatus.PENDING &&
        transaction.status !== TransactionStatus.READY) {
      return {
        code: TransactionErrorCode.INVALID_STATUS,
        message: `Transaction in invalid status for execution: ${transaction.status}`,
      };
    }

    // Check signatures
    if (!transaction.signatures.payer) {
      return {
        code: TransactionErrorCode.INVALID_PAYER_SIGNATURE,
        message: 'Missing payer signature',
      };
    }

    if (!transaction.signatures.payee) {
      return {
        code: TransactionErrorCode.INVALID_PAYEE_SIGNATURE,
        message: 'Missing payee signature',
      };
    }

    // Re-validate input (state may have changed)
    return this.validateInput({
      payer: transaction.payer,
      payee: transaction.payee,
      amount: transaction.amount,
      description: transaction.description,
    });
  }

  // ============================================
  // OFFLINE QUEUE
  // ============================================

  /**
   * Queue a transaction for offline execution
   */
  async queueForOffline(transaction: SpotTransaction): Promise<void> {
    const queued: QueuedTransaction = {
      transaction,
      queuedAt: now(),
      attempts: 0,
    };

    const result = await this.storage.queueTransaction(queued);
    if (!result.ok) {
      throw new Error(`Failed to queue transaction: ${result.error.message}`);
    }
  }

  /**
   * Get all queued transactions
   */
  async getOfflineQueue(): Promise<QueuedTransaction[]> {
    const result = await this.storage.getQueuedTransactions();
    if (!result.ok) {
      throw new Error(`Failed to get offline queue: ${result.error.message}`);
    }
    return result.value;
  }

  /**
   * Process offline queue
   */
  async processOfflineQueue(): Promise<TransactionResult[]> {
    const queued = await this.getOfflineQueue();
    const results: TransactionResult[] = [];

    for (const item of queued) {
      try {
        // Try to execute
        const result = await this.executeTransaction(item.transaction.id);
        results.push(result);

        // Remove from queue on success
        await this.storage.removeFromQueue(item.transaction.id);
      } catch (e) {
        // Update attempt count
        item.attempts++;
        if (e instanceof TransactionValidationError) {
          item.lastError = e.toJSON();
        }
        await this.storage.queueTransaction(item);
      }
    }

    return results;
  }

  // ============================================
  // HISTORY
  // ============================================

  /**
   * Get transaction history for a member
   */
  async getMemberTransactions(
    memberId: IdentityId,
    limit: number = 100,
    offset: number = 0
  ): Promise<SpotTransaction[]> {
    const result = await this.storage.getTransactionsByMember(memberId, limit, offset);
    if (!result.ok) {
      throw new Error(`Failed to get transactions: ${result.error.message}`);
    }
    return result.value;
  }
}

// ============================================
// CUSTOM ERROR CLASS
// ============================================

export class TransactionValidationError extends Error {
  public readonly code: TransactionErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(error: TransactionError) {
    super(error.message);
    this.name = 'TransactionValidationError';
    this.code = error.code;
    this.details = error.details;
  }

  toJSON(): TransactionError {
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
 * Create a new transaction engine
 */
export function createTransactionEngine(
  ledger: LedgerEngine,
  storage: IStorage,
  crypto: CryptoAdapter,
  publicKeyResolver: (memberId: IdentityId) => Promise<string | undefined>
): TransactionEngine {
  return new TransactionEngine(ledger, storage, crypto, publicKeyResolver);
}
