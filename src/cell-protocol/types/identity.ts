/**
 * Cell Protocol - Identity Types
 *
 * Type definitions for Identity & Membership (PRD-04).
 * Defines cell identities, membership management, and admission.
 */

import {
  IdentityId,
  CellId,
  Timestamp,
  PublicKey,
  MembershipStatus,
  Units,
} from './common';

// ============================================
// CELL IDENTITY
// ============================================

/** A member's identity within a cell */
export interface CellIdentity {
  /** Unique identifier (derived from public key) */
  id: IdentityId;

  /** Cell this identity belongs to */
  cellId: CellId;

  /** Display name (human-readable) */
  displayName: string;

  /** Ed25519 public key for signing (base64) */
  publicKey: PublicKey;

  /** X25519 public key for encryption (base64) */
  encryptionPublicKey?: PublicKey;

  /** Current membership status */
  membershipStatus: MembershipStatus;

  /** When identity was created */
  createdAt: Timestamp;

  /** When identity was last updated */
  updatedAt: Timestamp;

  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

// ============================================
// ADMISSION
// ============================================

/** Information for admitting a new member */
export interface AdmissionInfo {
  /** Applicant's identity ID */
  applicantId: IdentityId;

  /** Applicant's public key */
  publicKey: PublicKey;

  /** Requested display name */
  displayName: string;

  /** Sponsor (existing member who vouches for applicant) */
  sponsorId?: IdentityId;

  /** Initial credit limit (if different from default) */
  initialLimit?: Units;

  /** Admission notes */
  notes?: string;

  /** When admission was requested */
  requestedAt: Timestamp;
}

/** Result of an admission decision */
export interface AdmissionResult {
  /** Whether admission was approved */
  approved: boolean;

  /** The created identity (if approved) */
  identity?: CellIdentity;

  /** Reason for rejection (if not approved) */
  rejectionReason?: string;

  /** When decision was made */
  decidedAt: Timestamp;
}

// ============================================
// MEMBERSHIP CHANGES
// ============================================

/** Record of a membership status change */
export interface MembershipChange {
  /** Member affected */
  memberId: IdentityId;

  /** Previous status */
  previousStatus: MembershipStatus;

  /** New status */
  newStatus: MembershipStatus;

  /** Reason for change */
  reason: string;

  /** Who initiated the change */
  initiatorId: IdentityId;

  /** When change occurred */
  changedAt: Timestamp;
}

// ============================================
// ERROR TYPES
// ============================================

/** Errors that can occur during identity operations */
export enum IdentityErrorCode {
  /** Identity not found */
  NOT_FOUND = 'NOT_FOUND',

  /** Identity already exists */
  ALREADY_EXISTS = 'ALREADY_EXISTS',

  /** Invalid public key format */
  INVALID_PUBLIC_KEY = 'INVALID_PUBLIC_KEY',

  /** Display name is invalid or taken */
  INVALID_DISPLAY_NAME = 'INVALID_DISPLAY_NAME',

  /** Member has non-zero balance */
  NON_ZERO_BALANCE = 'NON_ZERO_BALANCE',

  /** Member has pending commitments */
  PENDING_COMMITMENTS = 'PENDING_COMMITMENTS',

  /** Invalid status transition */
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',

  /** Sponsor not found or not active */
  INVALID_SPONSOR = 'INVALID_SPONSOR',

  /** Storage operation failed */
  STORAGE_ERROR = 'STORAGE_ERROR',

  /** Crypto operation failed */
  CRYPTO_ERROR = 'CRYPTO_ERROR',
}

/** Detailed identity error */
export interface IdentityError {
  code: IdentityErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================
// SEARCH & QUERY
// ============================================

/** Criteria for searching members */
export interface MemberSearchCriteria {
  /** Search by display name (partial match) */
  displayName?: string;

  /** Filter by membership status */
  status?: MembershipStatus | MembershipStatus[];

  /** Filter by minimum balance */
  minBalance?: Units;

  /** Filter by maximum balance */
  maxBalance?: Units;

  /** Limit results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;
}

/** Result of a member search */
export interface MemberSearchResult {
  /** Matching identities */
  members: CellIdentity[];

  /** Total count (for pagination) */
  totalCount: number;
}

// ============================================
// INTERFACES
// ============================================

/** Interface for the Identity Engine */
export interface IIdentityEngine {
  /** Create a new identity with generated keys */
  createIdentity(
    cellId: CellId,
    displayName: string
  ): Promise<{ identity: CellIdentity; secretKey: string }>;

  /** Import an existing identity */
  importIdentity(
    cellId: CellId,
    displayName: string,
    publicKey: PublicKey
  ): Promise<CellIdentity>;

  /** Get an identity by ID */
  getIdentity(id: IdentityId): Promise<CellIdentity | undefined>;

  /** Get identity by public key */
  getIdentityByPublicKey(publicKey: PublicKey): Promise<CellIdentity | undefined>;

  /** Update identity display name */
  updateDisplayName(id: IdentityId, displayName: string): Promise<CellIdentity>;

  /** Add a member to the cell (creates ledger entry) */
  addMember(
    admission: AdmissionInfo
  ): Promise<AdmissionResult>;

  /** Freeze a member */
  freezeMember(
    memberId: IdentityId,
    reason: string,
    initiatorId: IdentityId
  ): Promise<MembershipChange>;

  /** Unfreeze a member */
  unfreezeMember(
    memberId: IdentityId,
    reason: string,
    initiatorId: IdentityId
  ): Promise<MembershipChange>;

  /** Remove a member (must have zero balance) */
  removeMember(
    memberId: IdentityId,
    reason: string,
    initiatorId: IdentityId
  ): Promise<MembershipChange>;

  /** Get all members */
  getMembers(cellId: CellId): Promise<CellIdentity[]>;

  /** Search members */
  searchMembers(
    cellId: CellId,
    criteria: MemberSearchCriteria
  ): Promise<MemberSearchResult>;

  /** Verify a signature from a member */
  verifySignature(
    memberId: IdentityId,
    message: string | object,
    signature: string
  ): Promise<boolean>;
}
