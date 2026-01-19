/**
 * Cell Protocol - Common Types
 *
 * Fundamental type aliases and shared types used across the protocol.
 */

// ============================================
// CORE TYPE ALIASES
// ============================================

/** Unique identifier for an identity/member within a cell */
export type IdentityId = string;

/** Unique identifier for a cell */
export type CellId = string;

/** Unique identifier for a transaction */
export type TransactionId = string;

/** Unix timestamp in milliseconds */
export type Timestamp = number;

/** Credit units (positive integer, smallest divisible unit) */
export type Units = number;

/** Base64-encoded public key */
export type PublicKey = string;

/** Base64-encoded signature */
export type Signature = string;

/** Base64-encoded secret key */
export type SecretKey = string;

// ============================================
// COMMON ENUMS
// ============================================

/** Reasons for balance changes */
export enum BalanceChangeReason {
  SPOT_TRANSACTION_PAYER = 'SPOT_TRANSACTION_PAYER',
  SPOT_TRANSACTION_PAYEE = 'SPOT_TRANSACTION_PAYEE',
  COMMITMENT_RESERVE = 'COMMITMENT_RESERVE',
  COMMITMENT_RELEASE = 'COMMITMENT_RELEASE',
  COMMITMENT_EXECUTE = 'COMMITMENT_EXECUTE',
  LIMIT_ADJUSTMENT = 'LIMIT_ADJUSTMENT',
  MEMBER_SETTLEMENT = 'MEMBER_SETTLEMENT',
}

/** Status of a member within a cell */
export enum MembershipStatus {
  PENDING = 'PENDING',       // Applied but not yet admitted
  PROBATION = 'PROBATION',   // Admitted with limited privileges
  ACTIVE = 'ACTIVE',         // Full member
  FROZEN = 'FROZEN',         // Temporarily suspended
  EXCLUDED = 'EXCLUDED',     // Permanently removed
}

// ============================================
// COMMON INTERFACES
// ============================================

/** Generic event metadata */
export interface EventMeta {
  id: string;
  timestamp: Timestamp;
  cellId: CellId;
}

/** Audit log entry for any state change */
export interface AuditEntry extends EventMeta {
  type: string;
  actorId: IdentityId;
  details: Record<string, unknown>;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/** Generate a unique ID using timestamp and random bytes */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/** Get current timestamp */
export function now(): Timestamp {
  return Date.now();
}
