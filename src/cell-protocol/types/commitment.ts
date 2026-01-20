/**
 * Cell Protocol - Commitment Types
 *
 * Type definitions for the Commitment System (PRD-03).
 * Defines commitments, task categories, and fulfillment.
 */

import {
  IdentityId,
  Timestamp,
  Units,
  Signature,
} from './common';

// ============================================
// TYPE ALIASES
// ============================================

/** Unique identifier for a commitment */
export type CommitmentId = string;

// ============================================
// ENUMS
// ============================================

/** Type of commitment */
export enum CommitmentType {
  /** No reserve impact - trust-based */
  SOFT = 'SOFT',
  /** Reserves promisor capacity until fulfilled */
  ESCROWED = 'ESCROWED',
}

/** Status of a commitment */
export enum CommitmentStatus {
  /** Commitment created but not yet accepted */
  PROPOSED = 'PROPOSED',
  /** Commitment active and in progress */
  ACTIVE = 'ACTIVE',
  /** Commitment successfully completed */
  FULFILLED = 'FULFILLED',
  /** Commitment cancelled before completion */
  CANCELLED = 'CANCELLED',
  /** Commitment under dispute */
  DISPUTED = 'DISPUTED',
}

/** 9 essential task categories for survival */
export enum TaskCategory {
  /** Food preparation and distribution */
  FOOD = 'FOOD',
  /** Water access and sanitation */
  WATER_SANITATION = 'WATER_SANITATION',
  /** Energy and heating */
  ENERGY_HEAT = 'ENERGY_HEAT',
  /** Shelter maintenance and repair */
  SHELTER_REPAIR = 'SHELTER_REPAIR',
  /** Medical care and health */
  MEDICAL = 'MEDICAL',
  /** Childcare and dependent care */
  CHILDCARE_DEPENDENT = 'CHILDCARE_DEPENDENT',
  /** Security and coordination */
  SECURITY_COORDINATION = 'SECURITY_COORDINATION',
  /** Procurement and transport */
  PROCUREMENT_TRANSPORT = 'PROCUREMENT_TRANSPORT',
  /** General tasks */
  GENERAL = 'GENERAL',
}

// ============================================
// CORE INTERFACES
// ============================================

/** A commitment between two members */
export interface Commitment {
  /** Unique commitment identifier */
  id: CommitmentId;

  /** Type of commitment */
  type: CommitmentType;

  /** Provider (receives credits on completion) */
  promisor: IdentityId;

  /** Requester (pays credits on completion) */
  promisee: IdentityId;

  /** Credit value of the commitment */
  value: Units;

  /** Task category */
  category: TaskCategory;

  /** Human-readable description */
  description: string;

  /** When task should be completed by */
  dueDate?: Timestamp;

  /** Current status */
  status: CommitmentStatus;

  /** When commitment was created */
  createdAt: Timestamp;

  /** When commitment was fulfilled (if fulfilled) */
  fulfilledAt?: Timestamp;

  /** When commitment was cancelled (if cancelled) */
  cancelledAt?: Timestamp;

  /** Optional notes */
  notes?: string;
}

/** Confirmation of commitment fulfillment */
export interface FulfillmentConfirmation {
  /** The commitment being confirmed */
  commitmentId: CommitmentId;

  /** Who confirmed the fulfillment (usually promisee) */
  confirmedBy: IdentityId;

  /** Quality rating 1-5 */
  rating?: number;

  /** Optional feedback notes */
  notes?: string;

  /** When confirmation occurred */
  timestamp: Timestamp;

  /** Signature of confirmer */
  signature?: Signature;
}

// ============================================
// INPUT TYPES
// ============================================

/** Input for creating a new commitment */
export interface CreateCommitmentInput {
  /** Type of commitment */
  type: CommitmentType;

  /** Provider (receives credits) */
  promisor: IdentityId;

  /** Requester (pays credits) */
  promisee: IdentityId;

  /** Credit value */
  value: Units;

  /** Task category */
  category: TaskCategory;

  /** Description of the task */
  description: string;

  /** Due date (optional) */
  dueDate?: Timestamp;
}

// ============================================
// ERROR TYPES
// ============================================

/** Errors that can occur during commitment operations */
export enum CommitmentErrorCode {
  /** Commitment not found */
  NOT_FOUND = 'NOT_FOUND',

  /** Commitment already exists */
  ALREADY_EXISTS = 'ALREADY_EXISTS',

  /** Promisor not found or not active */
  INVALID_PROMISOR = 'INVALID_PROMISOR',

  /** Promisee not found or not active */
  INVALID_PROMISEE = 'INVALID_PROMISEE',

  /** Cannot commit to yourself */
  SELF_COMMITMENT = 'SELF_COMMITMENT',

  /** Value must be positive */
  INVALID_VALUE = 'INVALID_VALUE',

  /** Promisor doesn't have sufficient capacity */
  INSUFFICIENT_CAPACITY = 'INSUFFICIENT_CAPACITY',

  /** Due date must be in the future */
  INVALID_DUE_DATE = 'INVALID_DUE_DATE',

  /** Invalid status transition */
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',

  /** Only promisee can confirm fulfillment */
  UNAUTHORIZED_CONFIRMATION = 'UNAUTHORIZED_CONFIRMATION',

  /** Cannot cancel commitment in current status */
  CANNOT_CANCEL = 'CANNOT_CANCEL',

  /** Ledger operation failed */
  LEDGER_ERROR = 'LEDGER_ERROR',

  /** Storage operation failed */
  STORAGE_ERROR = 'STORAGE_ERROR',
}

/** Detailed commitment error */
export interface CommitmentError {
  code: CommitmentErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================
// ANALYTICS TYPES
// ============================================

/** Statistics for a member's commitments */
export interface MemberCommitmentStats {
  /** Total commitments as promisor */
  asPromisor: number;

  /** Total commitments as promisee */
  asPromisee: number;

  /** Fulfilled as promisor */
  fulfilledAsPromisor: number;

  /** Average rating received */
  averageRating?: number;

  /** Total value committed (active escrowed) */
  activeReservedValue: Units;
}

/** Fulfillment rate by category */
export interface CategoryFulfillmentStats {
  category: TaskCategory;
  totalCommitments: number;
  fulfilled: number;
  cancelled: number;
  disputed: number;
  fulfillmentRate: number;
}

// ============================================
// INTERFACE
// ============================================

/** Interface for the Commitment Engine */
export interface ICommitmentEngine {
  // Creation
  /** Create a new commitment */
  createCommitment(input: CreateCommitmentInput): Promise<Commitment>;

  // Lifecycle
  /** Accept a proposed commitment (makes it active) */
  acceptCommitment(id: CommitmentId, accepterId: IdentityId): Promise<Commitment>;

  /** Fulfill a commitment (executes transaction) */
  fulfillCommitment(
    id: CommitmentId,
    confirmation: FulfillmentConfirmation
  ): Promise<{ commitment: Commitment; payerNewBalance: Units; payeeNewBalance: Units }>;

  /** Cancel a commitment */
  cancelCommitment(
    id: CommitmentId,
    reason: string,
    initiatorId: IdentityId
  ): Promise<Commitment>;

  /** Mark commitment as disputed */
  disputeCommitment(
    id: CommitmentId,
    reason: string,
    initiatorId: IdentityId
  ): Promise<Commitment>;

  // Queries
  /** Get a commitment by ID */
  getCommitment(id: CommitmentId): Promise<Commitment | undefined>;

  /** Get all commitments for a member */
  getCommitmentsByMember(memberId: IdentityId): Promise<Commitment[]>;

  /** Get all active commitments */
  getActiveCommitments(): Promise<Commitment[]>;

  /** Get overdue commitments */
  getOverdueCommitments(): Promise<Commitment[]>;

  /** Get commitments by category */
  getCommitmentsByCategory(category: TaskCategory): Promise<Commitment[]>;

  // Analytics
  /** Get total reserved capacity for a member */
  getMemberReservedCapacity(memberId: IdentityId): Units;

  /** Get fulfillment rate for a category */
  getCategoryFulfillmentRate(category: TaskCategory): Promise<number>;

  /** Get member commitment statistics */
  getMemberStats(memberId: IdentityId): Promise<MemberCommitmentStats>;
}
