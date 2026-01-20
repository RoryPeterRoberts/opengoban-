/**
 * Cell Protocol - Federation Types
 *
 * Type definitions for the Federation Layer (PRD-06).
 * Defines federation state, links, transactions, and exposure management.
 */

import {
  CellId,
  IdentityId,
  Timestamp,
  Units,
  generateId,
} from './common';

// ============================================
// CORE TYPE ALIASES
// ============================================

/** Unique identifier for a federation transaction */
export type FederationTxId = string;

/** Unique identifier for a link proposal */
export type LinkProposalId = string;

// ============================================
// CORE ENUMS
// ============================================

/** Status of a cell's federation participation */
export enum FederationStatus {
  ACTIVE = 'ACTIVE',           // Normal federation operations
  SUSPENDED = 'SUSPENDED',     // Temporarily suspended (can resume)
  QUARANTINED = 'QUARANTINED', // Isolated due to cap violation or PANIC
}

/** Status of a bilateral federation link */
export enum LinkStatus {
  ACTIVE = 'ACTIVE',     // Link is operational
  SUSPENDED = 'SUSPENDED', // Link temporarily suspended
  PENDING = 'PENDING',   // Link proposal pending acceptance
}

/** Status of a federation transaction */
export enum FederationTxStatus {
  PENDING = 'PENDING',           // Transaction initiated
  SOURCE_CONFIRMED = 'SOURCE_CONFIRMED', // Source cell has confirmed
  TARGET_CONFIRMED = 'TARGET_CONFIRMED', // Target cell has confirmed
  COMPLETED = 'COMPLETED',       // Transaction fully executed
  FAILED = 'FAILED',             // Transaction failed
  ROLLED_BACK = 'ROLLED_BACK',   // Transaction was rolled back
}

/** Reason for quarantine */
export enum QuarantineReason {
  CAP_VIOLATION = 'CAP_VIOLATION',     // Position exceeds cap
  PANIC_MODE = 'PANIC_MODE',           // Cell in PANIC state
  SYNC_TIMEOUT = 'SYNC_TIMEOUT',       // Failed to sync with network
  MANUAL_SUSPENSION = 'MANUAL_SUSPENSION', // Governance suspended
  REMOTE_VIOLATION = 'REMOTE_VIOLATION',   // Remote cell violated terms
}

// ============================================
// FEDERATION LINK
// ============================================

/** Bilateral link between two cells */
export interface FederationLink {
  /** ID of the remote cell */
  remoteCellId: CellId;

  /** Current link status */
  status: LinkStatus;

  /** Net position with this specific cell (positive = they owe us) */
  bilateralPosition: Units;

  /** Timestamp when link was established */
  establishedAt: Timestamp;

  /** Timestamp of last activity on this link */
  lastActivity: Timestamp;

  /** Reason for suspension if suspended */
  suspensionReason?: string;

  /** Timestamp of suspension if suspended */
  suspendedAt?: Timestamp;
}

/** Proposal to establish a federation link */
export interface LinkProposal {
  /** Unique proposal ID */
  id: LinkProposalId;

  /** Cell that initiated the proposal */
  initiatorCellId: CellId;

  /** Target cell for the link */
  targetCellId: CellId;

  /** Proposed terms */
  proposedTerms: FederationTerms;

  /** Timestamp of proposal creation */
  createdAt: Timestamp;

  /** Expiration timestamp */
  expiresAt: Timestamp;

  /** Status */
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

  /** Response timestamp if accepted/rejected */
  respondedAt?: Timestamp;

  /** Rejection reason if rejected */
  rejectionReason?: string;
}

/** Terms of a federation link */
export interface FederationTerms {
  /** Maximum bilateral position allowed */
  maxBilateralPosition: Units;

  /** Settlement period in hours */
  settlementPeriodHours: number;

  /** Whether to allow automatic settlement */
  autoSettlement: boolean;

  /** Minimum transaction amount */
  minTransactionAmount: Units;
}

/** Default federation terms */
export const DEFAULT_FEDERATION_TERMS: FederationTerms = {
  maxBilateralPosition: 10000,
  settlementPeriodHours: 168, // 1 week
  autoSettlement: false,
  minTransactionAmount: 1,
};

// ============================================
// FEDERATION STATE
// ============================================

/** Complete federation state for a cell */
export interface FederationState {
  /** This cell's ID */
  cellId: CellId;

  /** Net federation position B_k (sum of all bilateral positions) */
  federationPosition: Units;

  /** ID of the clearing account member in the ledger */
  clearingAccountId: IdentityId;

  /** Current exposure cap = beta * Lambda_k */
  exposureCap: Units;

  /** Beta factor (0-1), affected by emergency state */
  betaFactor: number;

  /** Connected cells with their link status */
  connectedCells: FederationLink[];

  /** Current federation status */
  status: FederationStatus;

  /** Quarantine reason if quarantined */
  quarantineReason?: QuarantineReason;

  /** Timestamp of quarantine if quarantined */
  quarantinedAt?: Timestamp;

  /** Created timestamp */
  createdAt: Timestamp;

  /** Updated timestamp */
  updatedAt: Timestamp;
}

// ============================================
// FEDERATION TRANSACTIONS
// ============================================

/** Inter-cell transaction */
export interface FederationTransaction {
  /** Unique transaction ID */
  id: FederationTxId;

  /** Source cell (where funds originate) */
  sourceCell: CellId;

  /** Target cell (where funds go) */
  targetCell: CellId;

  /** Payer identity in source cell */
  payer: IdentityId;

  /** Payee identity in target cell */
  payee: IdentityId;

  /** Amount being transferred */
  amount: Units;

  /** Current status */
  status: FederationTxStatus;

  /** Transaction memo/description */
  memo?: string;

  /** Created timestamp */
  createdAt: Timestamp;

  /** Timestamp of source confirmation */
  sourceConfirmedAt?: Timestamp;

  /** Timestamp of target confirmation */
  targetConfirmedAt?: Timestamp;

  /** Timestamp of completion or failure */
  completedAt?: Timestamp;

  /** Failure reason if failed */
  failureReason?: string;

  /** ID of source leg transaction */
  sourceLegTxId?: string;

  /** ID of target leg transaction */
  targetLegTxId?: string;
}

/** Input for creating a federation transaction */
export interface CreateFederationTxInput {
  /** Source cell */
  sourceCell: CellId;

  /** Target cell */
  targetCell: CellId;

  /** Payer in source cell */
  payer: IdentityId;

  /** Payee in target cell */
  payee: IdentityId;

  /** Amount */
  amount: Units;

  /** Memo */
  memo?: string;
}

/** Result of a federation transaction */
export interface FederationTxResult {
  /** Transaction details */
  transaction: FederationTransaction;

  /** New federation position after transaction */
  newPosition: Units;

  /** Remaining capacity */
  remainingCapacity: Units;

  /** Whether cap was close to being reached */
  nearCap: boolean;
}

// ============================================
// QUARANTINE
// ============================================

/** Quarantine status information */
export interface QuarantineStatus {
  /** Whether cell is quarantined */
  isQuarantined: boolean;

  /** Reason for quarantine */
  reason?: QuarantineReason;

  /** Timestamp of quarantine */
  since?: Timestamp;

  /** Current position that caused violation */
  violatingPosition?: Units;

  /** Cap that was exceeded */
  exceededCap?: Units;

  /** Steps to resolve quarantine */
  resolutionSteps?: string[];
}

// ============================================
// EXPOSURE MANAGEMENT
// ============================================

/** Federation parameters */
export interface FederationParameters {
  /** Base beta factor (before emergency adjustments) */
  baseBetaFactor: number;

  /** Minimum exposure cap */
  minExposureCap: Units;

  /** Maximum exposure cap */
  maxExposureCap: Units;

  /** Warning threshold as fraction of cap (0-1) */
  warningThreshold: number;

  /** Critical threshold as fraction of cap (0-1) */
  criticalThreshold: number;
}

/** Default federation parameters */
export const DEFAULT_FEDERATION_PARAMETERS: FederationParameters = {
  baseBetaFactor: 0.3, // 30% of aggregate capacity
  minExposureCap: 0,
  maxExposureCap: 1000000,
  warningThreshold: 0.75,
  criticalThreshold: 0.90,
};

/** Exposure analysis */
export interface ExposureAnalysis {
  /** Current position */
  position: Units;

  /** Current cap */
  cap: Units;

  /** Available capacity (cap - |position|) */
  availableCapacity: Units;

  /** Utilization ratio (|position| / cap) */
  utilization: number;

  /** Warning threshold reached */
  atWarning: boolean;

  /** Critical threshold reached */
  atCritical: boolean;

  /** Cap exceeded */
  capExceeded: boolean;
}

// ============================================
// ERROR TYPES
// ============================================

/** Errors that can occur during federation operations */
export enum FederationErrorCode {
  /** Transaction would exceed source cell's cap */
  CAP_EXCEEDED = 'CAP_EXCEEDED',

  /** Transaction would exceed remote cell's cap */
  REMOTE_CAP_EXCEEDED = 'REMOTE_CAP_EXCEEDED',

  /** Link to remote cell is suspended */
  LINK_SUSPENDED = 'LINK_SUSPENDED',

  /** Link to remote cell doesn't exist */
  LINK_NOT_FOUND = 'LINK_NOT_FOUND',

  /** Cell is quarantined */
  CELL_QUARANTINED = 'CELL_QUARANTINED',

  /** Remote cell is quarantined */
  REMOTE_QUARANTINED = 'REMOTE_QUARANTINED',

  /** Federation is frozen (PANIC mode) */
  FEDERATION_FROZEN = 'FEDERATION_FROZEN',

  /** Transaction not found */
  TRANSACTION_NOT_FOUND = 'TRANSACTION_NOT_FOUND',

  /** Invalid transaction state */
  INVALID_TX_STATE = 'INVALID_TX_STATE',

  /** Proposal not found */
  PROPOSAL_NOT_FOUND = 'PROPOSAL_NOT_FOUND',

  /** Proposal expired */
  PROPOSAL_EXPIRED = 'PROPOSAL_EXPIRED',

  /** Invalid amount */
  INVALID_AMOUNT = 'INVALID_AMOUNT',

  /** Storage operation failed */
  STORAGE_ERROR = 'STORAGE_ERROR',

  /** Clearing account error */
  CLEARING_ACCOUNT_ERROR = 'CLEARING_ACCOUNT_ERROR',

  /** Ledger operation failed */
  LEDGER_ERROR = 'LEDGER_ERROR',
}

/** Detailed error information */
export interface FederationError {
  code: FederationErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================
// INTERFACE
// ============================================

/** Interface for the Federation Engine */
export interface IFederationEngine {
  /** Get the cell ID */
  getCellId(): CellId;

  /** Get complete federation state */
  getFederationState(): FederationState;

  /** Get current federation position (B_k) */
  getPosition(): Units;

  /** Get current exposure cap */
  getExposureCap(): Units;

  /** Get available capacity (cap - |position|) */
  getAvailableCapacity(): Units;

  /** Get all connected cells */
  getConnectedCells(): FederationLink[];

  /** Get specific link to a remote cell */
  getLink(remoteCellId: CellId): FederationLink | undefined;

  /** Propose a new link to a remote cell */
  proposeLink(remoteCellId: CellId, terms?: Partial<FederationTerms>): Promise<LinkProposal>;

  /** Accept a link proposal */
  acceptLink(proposalId: LinkProposalId): Promise<FederationLink>;

  /** Reject a link proposal */
  rejectLink(proposalId: LinkProposalId, reason: string): Promise<void>;

  /** Suspend a link */
  suspendLink(remoteCellId: CellId, reason: string): Promise<void>;

  /** Resume a suspended link */
  resumeLink(remoteCellId: CellId): Promise<void>;

  /** Validate an inter-cell transaction before execution */
  validateInterCellTx(input: CreateFederationTxInput): Promise<void>;

  /** Execute an inter-cell transaction */
  executeInterCellTx(input: CreateFederationTxInput): Promise<FederationTxResult>;

  /** Get a transaction by ID */
  getTransaction(id: FederationTxId): Promise<FederationTransaction | undefined>;

  /** Get transactions with filters */
  getTransactions(filter?: {
    remoteCellId?: CellId;
    status?: FederationTxStatus;
    since?: Timestamp;
  }): Promise<FederationTransaction[]>;

  /** Roll back a failed transaction */
  rollbackTransaction(id: FederationTxId, reason: string): Promise<void>;

  /** Check quarantine status */
  checkQuarantineStatus(): QuarantineStatus;

  /** Enter quarantine */
  enterQuarantine(reason: QuarantineReason): Promise<void>;

  /** Exit quarantine (requires conditions to be met) */
  exitQuarantine(): Promise<void>;

  /** Set exposure cap factor (called by emergency engine) */
  setExposureCapFactor(betaFactor: number): Promise<void>;

  /** Recalculate exposure cap based on current ledger aggregate capacity */
  recalculateExposureCap(): Promise<void>;

  /** Analyze current exposure */
  analyzeExposure(): ExposureAnalysis;

  /** Get clearing account ID */
  getClearingAccountId(): IdentityId;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/** Generate a federation transaction ID */
export function generateFederationTxId(): FederationTxId {
  return `ftx-${generateId()}`;
}

/** Generate a link proposal ID */
export function generateLinkProposalId(): LinkProposalId {
  return `lp-${generateId()}`;
}
