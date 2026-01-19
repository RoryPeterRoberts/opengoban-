/**
 * Cell Protocol - Public API
 *
 * Phase 1: Core Protocol MVP
 * - Core Ledger Engine (PRD-01)
 * - Transaction System (PRD-02)
 * - Identity & Membership Basic (PRD-04)
 */

// ============================================
// TYPE EXPORTS
// ============================================

// Common types
export {
  IdentityId,
  CellId,
  TransactionId,
  Timestamp,
  Units,
  PublicKey,
  Signature,
  SecretKey,
  BalanceChangeReason,
  MembershipStatus,
  EventMeta,
  AuditEntry,
  generateId,
  now,
} from './types/common';

// Ledger types
export {
  MemberState,
  MemberComputedState,
  LedgerParameters,
  CellLedgerState,
  BalanceUpdate,
  ReserveUpdate,
  BalanceUpdateResult,
  LedgerError,
  LedgerErrorCode,
  LedgerStatistics,
  ILedgerEngine,
} from './types/ledger';

// Transaction types
export {
  TransactionType,
  TransactionStatus,
  SpotTransaction,
  TransactionSignatures,
  CreateSpotTransactionInput,
  TransactionSigningData,
  TransactionResult,
  TransactionError,
  TransactionErrorCode,
  QueuedTransaction,
  ITransactionEngine,
} from './types/transaction';

// Identity types
export {
  CellIdentity,
  AdmissionInfo,
  AdmissionResult,
  MembershipChange,
  IdentityError,
  IdentityErrorCode,
  MemberSearchCriteria,
  MemberSearchResult,
  IIdentityEngine,
} from './types/identity';

// ============================================
// RESULT TYPE EXPORTS
// ============================================

export {
  Result,
  Ok,
  Err,
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  andThen,
  all,
  tryCatch,
  tryCatchAsync,
} from './utils/result';

// ============================================
// ENGINE EXPORTS
// ============================================

export {
  LedgerEngine,
  LedgerViolationError,
  createLedgerEngine,
} from './engines/ledger-engine';

export {
  TransactionEngine,
  TransactionValidationError,
  createTransactionEngine,
} from './engines/transaction-engine';

export {
  IdentityEngine,
  IdentityValidationError,
  createIdentityEngine,
} from './engines/identity-engine';

// ============================================
// STORAGE EXPORTS
// ============================================

export {
  IStorage,
  StorageError,
  StorageDocument,
  EventLogEntry,
  InMemoryStorage,
  PouchDBStorage,
  createInMemoryStorage,
  createPouchDBStorage,
} from './storage/pouchdb-adapter';

// ============================================
// CRYPTO EXPORTS
// ============================================

export {
  CryptoAdapter,
  KeyPair,
  CryptoError,
  cryptoAdapter,
  encodeBase64,
  decodeBase64,
  encodeHex,
  decodeHex,
  createTransactionSigningData,
  signTransaction,
  verifyTransactionSignature,
} from './crypto/crypto-adapter';

// ============================================
// CELL PROTOCOL FACTORY
// ============================================

import { CellId, IdentityId } from './types/common';
import { LedgerParameters } from './types/ledger';
import { LedgerEngine, createLedgerEngine } from './engines/ledger-engine';
import { TransactionEngine, createTransactionEngine } from './engines/transaction-engine';
import { IdentityEngine, createIdentityEngine } from './engines/identity-engine';
import { IStorage, createInMemoryStorage } from './storage/pouchdb-adapter';
import { CryptoAdapter, cryptoAdapter } from './crypto/crypto-adapter';

/**
 * Complete Cell Protocol instance
 */
export interface CellProtocol {
  cellId: CellId;
  ledger: LedgerEngine;
  transactions: TransactionEngine;
  identity: IdentityEngine;
  storage: IStorage;
  crypto: CryptoAdapter;
}

/**
 * Options for creating a Cell Protocol instance
 */
export interface CellProtocolOptions {
  cellId: CellId;
  ledgerParameters?: Partial<LedgerParameters>;
  storage?: IStorage;
  crypto?: CryptoAdapter;
}

/**
 * Create a complete Cell Protocol instance
 */
export async function createCellProtocol(options: CellProtocolOptions): Promise<CellProtocol> {
  const { cellId, ledgerParameters = {} } = options;

  // Use provided storage or create in-memory storage
  const storage = options.storage ?? createInMemoryStorage();

  // Use provided crypto adapter or the default singleton
  const crypto = options.crypto ?? cryptoAdapter;

  // Initialize crypto if needed
  if (!crypto.isInitialized()) {
    const initResult = await crypto.initialize();
    if (!initResult.ok) {
      throw new Error(`Failed to initialize crypto: ${initResult.error.message}`);
    }
  }

  // Create ledger engine
  const ledger = await createLedgerEngine(cellId, ledgerParameters, storage);

  // Create identity engine
  const identity = createIdentityEngine(ledger, storage, crypto);

  // Create transaction engine with public key resolver
  const publicKeyResolver = async (memberId: IdentityId): Promise<string | undefined> => {
    const memberIdentity = await identity.getIdentity(memberId);
    return memberIdentity?.publicKey;
  };

  const transactions = createTransactionEngine(ledger, storage, crypto, publicKeyResolver);

  return {
    cellId,
    ledger,
    transactions,
    identity,
    storage,
    crypto,
  };
}

// ============================================
// VERSION
// ============================================

export const VERSION = '0.1.0';
export const PROTOCOL_VERSION = 1;
