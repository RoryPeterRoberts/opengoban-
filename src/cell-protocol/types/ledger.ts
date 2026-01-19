/**
 * Cell Protocol - Ledger Types
 *
 * Type definitions for the Core Ledger Engine (PRD-01).
 * Defines member states, cell ledger state, and balance operations.
 */

import {
  IdentityId,
  CellId,
  Timestamp,
  Units,
  MembershipStatus,
  BalanceChangeReason,
} from './common';

// ============================================
// MEMBER STATE
// ============================================

/** Complete state of a single member's ledger entry */
export interface MemberState {
  /** Member's identity ID */
  memberId: IdentityId;

  /** Current balance (can be negative down to -limit) */
  balance: Units;

  /** Credit limit (maximum negative balance allowed) */
  limit: Units;

  /** Reserved amount for pending commitments */
  reserve: Units;

  /** Current membership status */
  status: MembershipStatus;

  /** Timestamp of last balance change */
  lastActivity: Timestamp;

  /** Timestamp when member joined the cell */
  joinedAt: Timestamp;
}

/** Computed properties for a member */
export interface MemberComputedState {
  /** Available capacity = limit + balance - reserve */
  availableCapacity: Units;

  /** Distance to floor = balance + limit */
  distanceToFloor: Units;

  /** Whether member can spend */
  canSpend: boolean;
}

// ============================================
// CELL LEDGER STATE
// ============================================

/** Parameters that govern a cell's ledger behavior */
export interface LedgerParameters {
  /** Cell identifier */
  cellId: CellId;

  /** Default credit limit for new members */
  defaultLimit: Units;

  /** Minimum credit limit allowed */
  minLimit: Units;

  /** Maximum credit limit allowed */
  maxLimit: Units;

  /** Whether to enforce escrow safety checks */
  enforceEscrowSafety: boolean;
}

/** Complete state of a cell's ledger */
export interface CellLedgerState {
  /** Cell identifier */
  cellId: CellId;

  /** Ledger parameters */
  parameters: LedgerParameters;

  /** Member states keyed by member ID */
  members: Map<IdentityId, MemberState>;

  /** Event sequence number for ordering */
  sequenceNumber: number;

  /** Timestamp of last state change */
  lastUpdated: Timestamp;
}

// ============================================
// BALANCE OPERATIONS
// ============================================

/** Request to update a member's balance */
export interface BalanceUpdate {
  /** Member to update */
  memberId: IdentityId;

  /** Amount to add (positive) or subtract (negative) */
  delta: Units;

  /** Reason for the change */
  reason: BalanceChangeReason;

  /** Optional reference to related transaction/commitment */
  referenceId?: string;
}

/** Request to update a member's reserve */
export interface ReserveUpdate {
  /** Member to update */
  memberId: IdentityId;

  /** Amount to add to reserve (negative to release) */
  delta: Units;

  /** Reason for the change */
  reason: BalanceChangeReason;

  /** Reference to the commitment */
  commitmentId: string;
}

/** Result of a balance update operation */
export interface BalanceUpdateResult {
  /** Whether the update was successful */
  success: boolean;

  /** New balance after update */
  newBalance: Units;

  /** Previous balance before update */
  previousBalance: Units;

  /** Sequence number of this update */
  sequenceNumber: number;
}

// ============================================
// ERROR TYPES
// ============================================

/** Errors that can occur during ledger operations */
export enum LedgerErrorCode {
  /** Sum of balance deltas is not zero */
  CONSERVATION_VIOLATION = 'CONSERVATION_VIOLATION',

  /** Balance would go below -limit */
  FLOOR_VIOLATION = 'FLOOR_VIOLATION',

  /** Balance - reserve would go below -limit */
  ESCROW_VIOLATION = 'ESCROW_VIOLATION',

  /** Reserve would become negative */
  NEGATIVE_RESERVE = 'NEGATIVE_RESERVE',

  /** Member not found in ledger */
  MEMBER_NOT_FOUND = 'MEMBER_NOT_FOUND',

  /** Member is not in ACTIVE status */
  MEMBER_NOT_ACTIVE = 'MEMBER_NOT_ACTIVE',

  /** Member already exists */
  MEMBER_ALREADY_EXISTS = 'MEMBER_ALREADY_EXISTS',

  /** Invalid amount (e.g., negative when positive required) */
  INVALID_AMOUNT = 'INVALID_AMOUNT',

  /** Storage operation failed */
  STORAGE_ERROR = 'STORAGE_ERROR',

  /** Generic internal error */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/** Detailed error information */
export interface LedgerError {
  code: LedgerErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================
// STATISTICS
// ============================================

/** Aggregate statistics for a cell's ledger */
export interface LedgerStatistics {
  /** Number of members */
  memberCount: number;

  /** Number of active members */
  activeMemberCount: number;

  /** Sum of all positive balances */
  positiveBalanceSum: Units;

  /** Sum of all negative balances (absolute value) */
  negativeBalanceSum: Units;

  /** Total aggregate capacity (sum of all limits) */
  aggregateCapacity: Units;

  /** Floor mass (sum of limits for members at floor) */
  floorMass: Units;

  /** Total reserved amount */
  totalReserved: Units;

  /** Conservation check (should always be 0) */
  balanceSum: Units;
}

// ============================================
// INTERFACES
// ============================================

/** Interface for the Ledger Engine */
export interface ILedgerEngine {
  /** Get the cell ID this engine manages */
  getCellId(): CellId;

  /** Get ledger parameters */
  getParameters(): LedgerParameters;

  /** Get a member's state */
  getMemberState(memberId: IdentityId): MemberState | undefined;

  /** Get all member states */
  getAllMemberStates(): Map<IdentityId, MemberState>;

  /** Check if member can spend a given amount */
  canSpend(memberId: IdentityId, amount: Units): boolean;

  /** Get member's available capacity */
  getAvailableCapacity(memberId: IdentityId): Units;

  /** Add a new member to the ledger */
  addMember(memberId: IdentityId, initialLimit?: Units): Promise<MemberState>;

  /** Remove a member from the ledger (balance must be zero) */
  removeMember(memberId: IdentityId): Promise<void>;

  /** Apply atomic balance updates (conservation must hold) */
  applyBalanceUpdates(updates: BalanceUpdate[]): Promise<BalanceUpdateResult[]>;

  /** Apply a reserve update */
  applyReserveUpdate(update: ReserveUpdate): Promise<void>;

  /** Update a member's credit limit */
  updateMemberLimit(memberId: IdentityId, newLimit: Units): Promise<void>;

  /** Update a member's status */
  updateMemberStatus(memberId: IdentityId, status: MembershipStatus): Promise<void>;

  /** Verify conservation law holds */
  verifyConservation(): boolean;

  /** Verify all floor constraints hold */
  verifyAllFloors(): boolean;

  /** Get aggregate statistics */
  getStatistics(): LedgerStatistics;

  /** Get member count */
  getMemberCount(): number;
}
