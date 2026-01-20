/**
 * Cell Protocol - Identity Engine
 *
 * Implementation of Identity & Membership management (PRD-04).
 * Handles identity creation, admission, and membership status.
 */

import {
  IdentityId,
  CellId,
  Timestamp,
  PublicKey,
  MembershipStatus,
  Units,
  now,
} from '../types/common';
import {
  CellIdentity,
  AdmissionInfo,
  AdmissionResult,
  AdmissionResultExtended,
  MembershipChange,
  IdentityError,
  IdentityErrorCode,
  MemberSearchCriteria,
  MemberSearchResult,
  IIdentityEngine,
} from '../types/identity';
import { Result, ok, err } from '../utils/result';
import { IStorage } from '../storage/pouchdb-adapter';
import { LedgerEngine, LedgerViolationError } from './ledger-engine';
import { CryptoAdapter } from '../crypto/crypto-adapter';

// Optional Sybil resistance imports (Phase 5)
// These are conditionally used if engines are provided
import type { SponsorBondEngine } from '../hardening/sybil/sponsor-bond-engine';
import type { ServiceBondEngine } from '../hardening/sybil/service-bond-engine';
import type { ProbationTracker } from '../hardening/sybil/probation-tracker';
import type { ReputationSignals } from '../hardening/sybil/reputation-signals';

// ============================================
// IDENTITY ENGINE IMPLEMENTATION
// ============================================

/**
 * Optional Sybil resistance engines for Phase 5 integration
 */
export interface SybilResistanceEngines {
  sponsorBonds?: SponsorBondEngine;
  serviceBonds?: ServiceBondEngine;
  probation?: ProbationTracker;
  reputation?: ReputationSignals;
}

export class IdentityEngine implements IIdentityEngine {
  private ledger: LedgerEngine;
  private storage: IStorage;
  private crypto: CryptoAdapter;

  // Optional Sybil resistance integration (Phase 5)
  private sybilEngines?: SybilResistanceEngines;

  constructor(
    ledger: LedgerEngine,
    storage: IStorage,
    crypto: CryptoAdapter,
    sybilEngines?: SybilResistanceEngines
  ) {
    this.ledger = ledger;
    this.storage = storage;
    this.crypto = crypto;
    this.sybilEngines = sybilEngines;
  }

  /**
   * Configure Sybil resistance engines after construction
   */
  configureSybilResistance(engines: SybilResistanceEngines): void {
    this.sybilEngines = engines;
  }

  /**
   * Get Sybil resistance engines (if configured)
   */
  getSybilEngines(): SybilResistanceEngines | undefined {
    return this.sybilEngines;
  }

  // ============================================
  // IDENTITY CREATION
  // ============================================

  /**
   * Create a new identity with generated keys
   */
  async createIdentity(
    cellId: CellId,
    displayName: string
  ): Promise<{ identity: CellIdentity; secretKey: string }> {
    // Validate display name
    if (!displayName || displayName.trim().length === 0) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.INVALID_DISPLAY_NAME,
        message: 'Display name cannot be empty',
      });
    }

    // Generate keypair
    const keyPairResult = this.crypto.generateKeyPair();
    if (!keyPairResult.ok) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.CRYPTO_ERROR,
        message: `Failed to generate keypair: ${keyPairResult.error.message}`,
      });
    }

    const { publicKey, secretKey } = keyPairResult.value;
    const identityId = this.crypto.deriveIdentityId(publicKey);

    // Check for duplicate
    const existingResult = await this.storage.getIdentity(identityId);
    if (existingResult.ok && existingResult.value) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.ALREADY_EXISTS,
        message: `Identity ${identityId} already exists`,
      });
    }

    const timestamp = now();
    const identity: CellIdentity = {
      id: identityId,
      cellId,
      displayName: displayName.trim(),
      publicKey,
      membershipStatus: MembershipStatus.PENDING,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Save identity
    const saveResult = await this.storage.saveIdentity(identity);
    if (!saveResult.ok) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.STORAGE_ERROR,
        message: `Failed to save identity: ${saveResult.error.message}`,
      });
    }

    return { identity, secretKey };
  }

  /**
   * Import an existing identity (with known public key)
   */
  async importIdentity(
    cellId: CellId,
    displayName: string,
    publicKey: PublicKey
  ): Promise<CellIdentity> {
    // Validate display name
    if (!displayName || displayName.trim().length === 0) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.INVALID_DISPLAY_NAME,
        message: 'Display name cannot be empty',
      });
    }

    // Validate public key format (basic check)
    if (!publicKey || publicKey.length < 32) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.INVALID_PUBLIC_KEY,
        message: 'Invalid public key format',
      });
    }

    const identityId = this.crypto.deriveIdentityId(publicKey);

    // Check for duplicate
    const existingResult = await this.storage.getIdentity(identityId);
    if (existingResult.ok && existingResult.value) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.ALREADY_EXISTS,
        message: `Identity ${identityId} already exists`,
      });
    }

    const timestamp = now();
    const identity: CellIdentity = {
      id: identityId,
      cellId,
      displayName: displayName.trim(),
      publicKey,
      membershipStatus: MembershipStatus.PENDING,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    // Save identity
    const saveResult = await this.storage.saveIdentity(identity);
    if (!saveResult.ok) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.STORAGE_ERROR,
        message: `Failed to save identity: ${saveResult.error.message}`,
      });
    }

    return identity;
  }

  // ============================================
  // IDENTITY RETRIEVAL
  // ============================================

  /**
   * Get an identity by ID
   */
  async getIdentity(id: IdentityId): Promise<CellIdentity | undefined> {
    const result = await this.storage.getIdentity(id);
    if (!result.ok) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.STORAGE_ERROR,
        message: `Failed to get identity: ${result.error.message}`,
      });
    }
    return result.value ?? undefined;
  }

  /**
   * Get identity by public key
   */
  async getIdentityByPublicKey(publicKey: PublicKey): Promise<CellIdentity | undefined> {
    const result = await this.storage.getIdentityByPublicKey(publicKey);
    if (!result.ok) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.STORAGE_ERROR,
        message: `Failed to get identity: ${result.error.message}`,
      });
    }
    return result.value ?? undefined;
  }

  /**
   * Update identity display name
   */
  async updateDisplayName(id: IdentityId, displayName: string): Promise<CellIdentity> {
    const identity = await this.getIdentity(id);
    if (!identity) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.NOT_FOUND,
        message: `Identity ${id} not found`,
      });
    }

    if (!displayName || displayName.trim().length === 0) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.INVALID_DISPLAY_NAME,
        message: 'Display name cannot be empty',
      });
    }

    identity.displayName = displayName.trim();
    identity.updatedAt = now();

    const saveResult = await this.storage.saveIdentity(identity);
    if (!saveResult.ok) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.STORAGE_ERROR,
        message: `Failed to save identity: ${saveResult.error.message}`,
      });
    }

    return identity;
  }

  // ============================================
  // MEMBERSHIP MANAGEMENT
  // ============================================

  /**
   * Add a member to the cell (creates ledger entry)
   * Basic admission without Sybil resistance features
   */
  async addMember(admission: AdmissionInfo): Promise<AdmissionResult> {
    const timestamp = now();

    // Check if identity exists
    let identity = await this.getIdentity(admission.applicantId);

    // If identity doesn't exist, create it from admission info
    if (!identity) {
      identity = await this.importIdentity(
        this.ledger.getCellId(),
        admission.displayName,
        admission.publicKey
      );
    }

    // Validate sponsor if provided
    if (admission.sponsorId) {
      const sponsor = this.ledger.getMemberState(admission.sponsorId);
      if (!sponsor || sponsor.status !== MembershipStatus.ACTIVE) {
        return {
          approved: false,
          rejectionReason: 'Sponsor is not an active member',
          decidedAt: timestamp,
        };
      }
    }

    // Add to ledger
    try {
      await this.ledger.addMember(admission.applicantId, admission.initialLimit);
    } catch (e) {
      return {
        approved: false,
        rejectionReason: e instanceof Error ? e.message : 'Failed to add member to ledger',
        decidedAt: timestamp,
      };
    }

    // Update identity status
    identity.membershipStatus = MembershipStatus.ACTIVE;
    identity.updatedAt = timestamp;

    await this.storage.saveIdentity(identity);

    // Log membership change
    const change: MembershipChange = {
      memberId: admission.applicantId,
      previousStatus: MembershipStatus.PENDING,
      newStatus: MembershipStatus.ACTIVE,
      reason: admission.notes || 'Admitted',
      initiatorId: admission.sponsorId || admission.applicantId,
      changedAt: timestamp,
    };
    await this.storage.saveMembershipChange(change);

    return {
      approved: true,
      identity,
      decidedAt: timestamp,
    };
  }

  /**
   * Add a member with full Sybil resistance integration (Phase 5)
   * Creates sponsor bonds, service bonds, and probation as configured
   */
  async addMemberWithSybilResistance(
    admission: AdmissionInfo
  ): Promise<AdmissionResultExtended> {
    const timestamp = now();

    // Check if identity exists
    let identity = await this.getIdentity(admission.applicantId);

    // If identity doesn't exist, create it from admission info
    if (!identity) {
      identity = await this.importIdentity(
        this.ledger.getCellId(),
        admission.displayName,
        admission.publicKey
      );
    }

    // Validate sponsor if required
    if (admission.requireSponsorBond && !admission.sponsorId) {
      return {
        approved: false,
        rejectionReason: 'Sponsor bond required but no sponsor provided',
        decidedAt: timestamp,
      };
    }

    // Validate sponsor eligibility for bond
    if (admission.sponsorId && this.sybilEngines?.sponsorBonds) {
      const eligibility = await this.sybilEngines.sponsorBonds.canSponsor(admission.sponsorId);
      if (!eligibility.eligible) {
        return {
          approved: false,
          rejectionReason: `Sponsor not eligible: ${eligibility.reason}`,
          decidedAt: timestamp,
        };
      }
    } else if (admission.sponsorId) {
      // Fallback check without sponsor bond engine
      const sponsor = this.ledger.getMemberState(admission.sponsorId);
      if (!sponsor || sponsor.status !== MembershipStatus.ACTIVE) {
        return {
          approved: false,
          rejectionReason: 'Sponsor is not an active member',
          decidedAt: timestamp,
        };
      }
    }

    // Add to ledger
    try {
      await this.ledger.addMember(admission.applicantId, admission.initialLimit);
    } catch (e) {
      return {
        approved: false,
        rejectionReason: e instanceof Error ? e.message : 'Failed to add member to ledger',
        decidedAt: timestamp,
      };
    }

    // Track created bonds and probation
    let sponsorBondId: string | undefined;
    let serviceBondId: string | undefined;
    let onProbation = false;
    let probationEndsAt: Timestamp | undefined;

    // Create sponsor bond if requested and engine available
    if (admission.requireSponsorBond && admission.sponsorId && this.sybilEngines?.sponsorBonds) {
      try {
        const bond = await this.sybilEngines.sponsorBonds.createBond({
          sponsorId: admission.sponsorId,
          sponseeId: admission.applicantId,
          bondAmount: admission.sponsorBondAmount,
          probationDays: admission.probationDays,
        });
        sponsorBondId = bond.id;
      } catch (e) {
        // Rollback member addition on bond failure
        await this.ledger.removeMember(admission.applicantId);
        return {
          approved: false,
          rejectionReason: e instanceof Error ? e.message : 'Failed to create sponsor bond',
          decidedAt: timestamp,
        };
      }
    }

    // Create service bond if requested and engine available
    if (admission.requireServiceBond && this.sybilEngines?.serviceBonds) {
      try {
        const bond = await this.sybilEngines.serviceBonds.createBond(admission.applicantId);
        serviceBondId = bond.id;
      } catch (e) {
        // Rollback sponsor bond and member
        if (sponsorBondId && this.sybilEngines?.sponsorBonds) {
          try {
            await this.sybilEngines.sponsorBonds.releaseBond(sponsorBondId, 'Admission rollback');
          } catch { /* ignore rollback errors */ }
        }
        await this.ledger.removeMember(admission.applicantId);
        return {
          approved: false,
          rejectionReason: e instanceof Error ? e.message : 'Failed to create service bond',
          decidedAt: timestamp,
        };
      }
    }

    // Start probation if requested and tracker available
    if (admission.startWithProbation && this.sybilEngines?.probation) {
      try {
        const probationDays = admission.probationDays ?? 90;
        const probationState = await this.sybilEngines.probation.startProbation(
          admission.applicantId,
          probationDays,
          sponsorBondId,
          serviceBondId
        );
        onProbation = true;
        probationEndsAt = probationState.scheduledEndAt;
      } catch (e) {
        // Probation failure is non-fatal - member is still admitted
        console.warn(`Failed to start probation for ${admission.applicantId}:`, e);
      }
    }

    // Update identity status based on probation
    identity.membershipStatus = onProbation ? MembershipStatus.PROBATION : MembershipStatus.ACTIVE;
    identity.updatedAt = timestamp;

    await this.storage.saveIdentity(identity);

    // Log membership change
    const change: MembershipChange = {
      memberId: admission.applicantId,
      previousStatus: MembershipStatus.PENDING,
      newStatus: identity.membershipStatus,
      reason: admission.notes || (onProbation ? 'Admitted with probation' : 'Admitted'),
      initiatorId: admission.sponsorId || admission.applicantId,
      changedAt: timestamp,
    };
    await this.storage.saveMembershipChange(change);

    return {
      approved: true,
      identity,
      decidedAt: timestamp,
      sponsorBondId,
      serviceBondId,
      onProbation,
      probationEndsAt,
    };
  }

  /**
   * Graduate a member from probation
   */
  async graduateProbation(
    memberId: IdentityId,
    initiatorId: IdentityId
  ): Promise<MembershipChange> {
    if (!this.sybilEngines?.probation) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.INVALID_STATUS_TRANSITION,
        message: 'Probation tracker not configured',
      });
    }

    const identity = await this.getIdentity(memberId);
    if (!identity) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.NOT_FOUND,
        message: `Identity ${memberId} not found`,
      });
    }

    if (identity.membershipStatus !== MembershipStatus.PROBATION) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.INVALID_STATUS_TRANSITION,
        message: `Member ${memberId} is not on probation`,
      });
    }

    const timestamp = now();

    // Graduate through probation tracker
    await this.sybilEngines.probation.graduateProbation(memberId);

    // Update identity
    identity.membershipStatus = MembershipStatus.ACTIVE;
    identity.updatedAt = timestamp;
    await this.storage.saveIdentity(identity);

    // Log change
    const change: MembershipChange = {
      memberId,
      previousStatus: MembershipStatus.PROBATION,
      newStatus: MembershipStatus.ACTIVE,
      reason: 'Graduated from probation',
      initiatorId,
      changedAt: timestamp,
    };
    await this.storage.saveMembershipChange(change);

    // Release sponsor bond if exists
    const probationState = this.sybilEngines.probation.getProbationState(memberId);
    if (probationState?.sponsorBondId && this.sybilEngines.sponsorBonds) {
      try {
        await this.sybilEngines.sponsorBonds.releaseBond(
          probationState.sponsorBondId,
          'Sponsee graduated'
        );
      } catch (e) {
        console.warn(`Failed to release sponsor bond for ${memberId}:`, e);
      }
    }

    return change;
  }

  /**
   * Check if member is on probation
   */
  isOnProbation(memberId: IdentityId): boolean {
    if (!this.sybilEngines?.probation) {
      return false;
    }
    return this.sybilEngines.probation.isOnProbation(memberId);
  }

  /**
   * Get member's reputation score (advisory only)
   */
  async getReputationScore(memberId: IdentityId): Promise<number | undefined> {
    if (!this.sybilEngines?.reputation) {
      return undefined;
    }
    return this.sybilEngines.reputation.getScore(memberId);
  }

  /**
   * Compute and cache reputation for a member
   */
  async computeReputation(memberId: IdentityId): Promise<void> {
    if (!this.sybilEngines?.reputation) {
      return;
    }
    await this.sybilEngines.reputation.computeReputation(memberId);
  }

  /**
   * Freeze a member
   */
  async freezeMember(
    memberId: IdentityId,
    reason: string,
    initiatorId: IdentityId
  ): Promise<MembershipChange> {
    const identity = await this.getIdentity(memberId);
    if (!identity) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.NOT_FOUND,
        message: `Identity ${memberId} not found`,
      });
    }

    const memberState = this.ledger.getMemberState(memberId);
    if (!memberState) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.NOT_FOUND,
        message: `Member ${memberId} not found in ledger`,
      });
    }

    // Validate transition
    if (memberState.status === MembershipStatus.FROZEN) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.INVALID_STATUS_TRANSITION,
        message: 'Member is already frozen',
      });
    }

    if (memberState.status === MembershipStatus.EXCLUDED) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.INVALID_STATUS_TRANSITION,
        message: 'Cannot freeze an excluded member',
      });
    }

    const previousStatus = identity.membershipStatus;
    const timestamp = now();

    // Update ledger status
    await this.ledger.updateMemberStatus(memberId, MembershipStatus.FROZEN);

    // Update identity
    identity.membershipStatus = MembershipStatus.FROZEN;
    identity.updatedAt = timestamp;
    await this.storage.saveIdentity(identity);

    // Log change
    const change: MembershipChange = {
      memberId,
      previousStatus,
      newStatus: MembershipStatus.FROZEN,
      reason,
      initiatorId,
      changedAt: timestamp,
    };
    await this.storage.saveMembershipChange(change);

    return change;
  }

  /**
   * Unfreeze a member
   */
  async unfreezeMember(
    memberId: IdentityId,
    reason: string,
    initiatorId: IdentityId
  ): Promise<MembershipChange> {
    const identity = await this.getIdentity(memberId);
    if (!identity) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.NOT_FOUND,
        message: `Identity ${memberId} not found`,
      });
    }

    const memberState = this.ledger.getMemberState(memberId);
    if (!memberState) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.NOT_FOUND,
        message: `Member ${memberId} not found in ledger`,
      });
    }

    // Validate transition
    if (memberState.status !== MembershipStatus.FROZEN) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.INVALID_STATUS_TRANSITION,
        message: `Cannot unfreeze member in status ${memberState.status}`,
      });
    }

    const timestamp = now();

    // Update ledger status
    await this.ledger.updateMemberStatus(memberId, MembershipStatus.ACTIVE);

    // Update identity
    identity.membershipStatus = MembershipStatus.ACTIVE;
    identity.updatedAt = timestamp;
    await this.storage.saveIdentity(identity);

    // Log change
    const change: MembershipChange = {
      memberId,
      previousStatus: MembershipStatus.FROZEN,
      newStatus: MembershipStatus.ACTIVE,
      reason,
      initiatorId,
      changedAt: timestamp,
    };
    await this.storage.saveMembershipChange(change);

    return change;
  }

  /**
   * Remove a member (must have zero balance)
   */
  async removeMember(
    memberId: IdentityId,
    reason: string,
    initiatorId: IdentityId
  ): Promise<MembershipChange> {
    const identity = await this.getIdentity(memberId);
    if (!identity) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.NOT_FOUND,
        message: `Identity ${memberId} not found`,
      });
    }

    const memberState = this.ledger.getMemberState(memberId);
    if (!memberState) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.NOT_FOUND,
        message: `Member ${memberId} not found in ledger`,
      });
    }

    // Check balance
    if (memberState.balance !== 0) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.NON_ZERO_BALANCE,
        message: `Cannot remove member with balance ${memberState.balance}`,
        details: { balance: memberState.balance },
      });
    }

    // Check reserves
    if (memberState.reserve !== 0) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.PENDING_COMMITMENTS,
        message: `Cannot remove member with active reserves: ${memberState.reserve}`,
        details: { reserve: memberState.reserve },
      });
    }

    const previousStatus = identity.membershipStatus;
    const timestamp = now();

    // Remove from ledger
    await this.ledger.removeMember(memberId);

    // Update identity
    identity.membershipStatus = MembershipStatus.EXCLUDED;
    identity.updatedAt = timestamp;
    await this.storage.saveIdentity(identity);

    // Log change
    const change: MembershipChange = {
      memberId,
      previousStatus,
      newStatus: MembershipStatus.EXCLUDED,
      reason,
      initiatorId,
      changedAt: timestamp,
    };
    await this.storage.saveMembershipChange(change);

    return change;
  }

  // ============================================
  // MEMBER SEARCH
  // ============================================

  /**
   * Get all members
   */
  async getMembers(cellId: CellId): Promise<CellIdentity[]> {
    const result = await this.storage.getAllIdentities(cellId);
    if (!result.ok) {
      throw new IdentityValidationError({
        code: IdentityErrorCode.STORAGE_ERROR,
        message: `Failed to get members: ${result.error.message}`,
      });
    }
    return result.value;
  }

  /**
   * Search members
   */
  async searchMembers(
    cellId: CellId,
    criteria: MemberSearchCriteria
  ): Promise<MemberSearchResult> {
    // Get all identities
    const allIdentities = await this.getMembers(cellId);

    // Filter
    let filtered = allIdentities;

    if (criteria.displayName) {
      const searchLower = criteria.displayName.toLowerCase();
      filtered = filtered.filter(i =>
        i.displayName.toLowerCase().includes(searchLower)
      );
    }

    if (criteria.status) {
      const statuses = Array.isArray(criteria.status) ? criteria.status : [criteria.status];
      filtered = filtered.filter(i => statuses.includes(i.membershipStatus));
    }

    // Filter by balance if specified
    if (criteria.minBalance !== undefined || criteria.maxBalance !== undefined) {
      filtered = filtered.filter(identity => {
        const memberState = this.ledger.getMemberState(identity.id);
        if (!memberState) return false;

        if (criteria.minBalance !== undefined && memberState.balance < criteria.minBalance) {
          return false;
        }
        if (criteria.maxBalance !== undefined && memberState.balance > criteria.maxBalance) {
          return false;
        }
        return true;
      });
    }

    const totalCount = filtered.length;

    // Apply pagination
    const offset = criteria.offset ?? 0;
    const limit = criteria.limit ?? 100;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      members: paginated,
      totalCount,
    };
  }

  // ============================================
  // SIGNATURE VERIFICATION
  // ============================================

  /**
   * Verify a signature from a member
   */
  async verifySignature(
    memberId: IdentityId,
    message: string | object,
    signature: string
  ): Promise<boolean> {
    const identity = await this.getIdentity(memberId);
    if (!identity) {
      return false;
    }

    return this.crypto.verify(message, signature, identity.publicKey);
  }
}

// ============================================
// CUSTOM ERROR CLASS
// ============================================

export class IdentityValidationError extends Error {
  public readonly code: IdentityErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(error: IdentityError) {
    super(error.message);
    this.name = 'IdentityValidationError';
    this.code = error.code;
    this.details = error.details;
  }

  toJSON(): IdentityError {
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
 * Create a new identity engine
 */
export function createIdentityEngine(
  ledger: LedgerEngine,
  storage: IStorage,
  crypto: CryptoAdapter,
  sybilEngines?: SybilResistanceEngines
): IdentityEngine {
  return new IdentityEngine(ledger, storage, crypto, sybilEngines);
}
