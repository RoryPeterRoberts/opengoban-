/**
 * Cell Protocol - Transaction Types
 *
 * Type definitions for the Transaction System (PRD-02).
 * Defines spot transactions, validation, and execution.
 */

import {
  IdentityId,
  TransactionId,
  Timestamp,
  Units,
  Signature,
} from './common';

// ============================================
// TRANSACTION TYPES
// ============================================

/** Type of transaction */
export enum TransactionType {
  /** Immediate point-of-sale exchange */
  SPOT = 'SPOT',
}

/** Status of a transaction */
export enum TransactionStatus {
  /** Transaction created but not yet signed by all parties */
  PENDING = 'PENDING',

  /** All signatures collected, ready for execution */
  READY = 'READY',

  /** Successfully executed and applied to ledger */
  EXECUTED = 'EXECUTED',

  /** Failed validation or execution */
  FAILED = 'FAILED',

  /** Cancelled before execution */
  CANCELLED = 'CANCELLED',
}

// ============================================
// SPOT TRANSACTION
// ============================================

/** A spot transaction for immediate credit exchange */
export interface SpotTransaction {
  /** Unique transaction identifier */
  id: TransactionId;

  /** Transaction type */
  type: TransactionType.SPOT;

  /** Member paying (balance decreases) */
  payer: IdentityId;

  /** Member receiving (balance increases) */
  payee: IdentityId;

  /** Amount of credits to transfer */
  amount: Units;

  /** Human-readable description */
  description: string;

  /** When transaction was created */
  createdAt: Timestamp;

  /** When transaction was executed (if executed) */
  executedAt?: Timestamp;

  /** Current status */
  status: TransactionStatus;

  /** Signatures from both parties */
  signatures: TransactionSignatures;

  /** Nonce for uniqueness/idempotency */
  nonce: string;
}

/** Signatures for a transaction */
export interface TransactionSignatures {
  /** Payer's signature (required to debit their account) */
  payer?: Signature;

  /** Payee's signature (required to complete transaction) */
  payee?: Signature;
}

// ============================================
// TRANSACTION CREATION
// ============================================

/** Input for creating a new spot transaction */
export interface CreateSpotTransactionInput {
  /** Member paying */
  payer: IdentityId;

  /** Member receiving */
  payee: IdentityId;

  /** Amount to transfer (must be positive) */
  amount: Units;

  /** Description of the transaction */
  description: string;
}

/** Data that gets signed for a transaction */
export interface TransactionSigningData {
  payer: IdentityId;
  payee: IdentityId;
  amount: Units;
  description: string;
  createdAt: Timestamp;
  nonce: string;
}

// ============================================
// TRANSACTION RESULT
// ============================================

/** Result of a successful transaction execution */
export interface TransactionResult {
  /** The executed transaction */
  transaction: SpotTransaction;

  /** Payer's new balance */
  payerNewBalance: Units;

  /** Payee's new balance */
  payeeNewBalance: Units;

  /** Sequence number in the ledger */
  sequenceNumber: number;
}

// ============================================
// ERROR TYPES
// ============================================

/** Errors that can occur during transaction operations */
export enum TransactionErrorCode {
  /** Payer is not an active member */
  PAYER_NOT_MEMBER = 'PAYER_NOT_MEMBER',

  /** Payee is not an active member */
  PAYEE_NOT_MEMBER = 'PAYEE_NOT_MEMBER',

  /** Cannot pay yourself */
  SELF_TRANSACTION = 'SELF_TRANSACTION',

  /** Amount must be positive */
  INVALID_AMOUNT = 'INVALID_AMOUNT',

  /** Payer doesn't have sufficient capacity */
  INSUFFICIENT_CAPACITY = 'INSUFFICIENT_CAPACITY',

  /** Transaction with this ID already exists */
  DUPLICATE_TRANSACTION = 'DUPLICATE_TRANSACTION',

  /** Payer signature missing or invalid */
  INVALID_PAYER_SIGNATURE = 'INVALID_PAYER_SIGNATURE',

  /** Payee signature missing or invalid */
  INVALID_PAYEE_SIGNATURE = 'INVALID_PAYEE_SIGNATURE',

  /** Transaction is not in the expected status */
  INVALID_STATUS = 'INVALID_STATUS',

  /** Transaction not found */
  NOT_FOUND = 'NOT_FOUND',

  /** Ledger operation failed */
  LEDGER_ERROR = 'LEDGER_ERROR',

  /** Storage operation failed */
  STORAGE_ERROR = 'STORAGE_ERROR',
}

/** Detailed transaction error */
export interface TransactionError {
  code: TransactionErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================
// OFFLINE QUEUE
// ============================================

/** A queued transaction waiting for sync */
export interface QueuedTransaction {
  /** The transaction to execute */
  transaction: SpotTransaction;

  /** When it was queued */
  queuedAt: Timestamp;

  /** Number of execution attempts */
  attempts: number;

  /** Last error if any */
  lastError?: TransactionError;
}

// ============================================
// INTERFACES
// ============================================

/** Interface for the Transaction Engine */
export interface ITransactionEngine {
  /** Create a new spot transaction (unsigned) */
  createSpotTransaction(input: CreateSpotTransactionInput): Promise<SpotTransaction>;

  /** Get a transaction by ID */
  getTransaction(id: TransactionId): Promise<SpotTransaction | undefined>;

  /** Add payer signature to transaction */
  signAsPayer(id: TransactionId, signature: Signature): Promise<SpotTransaction>;

  /** Add payee signature to transaction */
  signAsPayee(id: TransactionId, signature: Signature): Promise<SpotTransaction>;

  /** Execute a fully signed transaction */
  executeTransaction(id: TransactionId): Promise<TransactionResult>;

  /** Validate a transaction without executing */
  validateTransaction(transaction: SpotTransaction): TransactionError | null;

  /** Get the canonical signing data for a transaction */
  getSigningData(transaction: SpotTransaction): TransactionSigningData;

  /** Queue a transaction for offline execution */
  queueForOffline(transaction: SpotTransaction): Promise<void>;

  /** Get all queued transactions */
  getOfflineQueue(): Promise<QueuedTransaction[]>;

  /** Process offline queue (execute pending transactions) */
  processOfflineQueue(): Promise<TransactionResult[]>;

  /** Get transaction history for a member */
  getMemberTransactions(
    memberId: IdentityId,
    limit?: number,
    offset?: number
  ): Promise<SpotTransaction[]>;
}
