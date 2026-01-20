/**
 * Cell Protocol - Hardening: Sponsor Bond Engine
 *
 * Manages sponsor bonds for Sybil resistance.
 * Sponsors risk their own capacity when vouching for new members.
 */

import { IdentityId, Timestamp, Units, generateId, now } from '../../types/common';
import { MembershipStatus } from '../../types/common';
import {
  SponsorBond,
  SponsorBondStatus,
  CreateSponsorBondInput,
  SponsorBondConfig,
  DEFAULT_SPONSOR_BOND_CONFIG,
  SybilErrorCode,
  SybilError,
} from '../types/sybil';
import { LedgerEngine } from '../../engines/ledger-engine';
import { IStorage } from '../../storage/pouchdb-adapter';

// ============================================
// SPONSOR BOND ENGINE
// ============================================

/**
 * Manages sponsor bonds for new member admission
 */
export class SponsorBondEngine {
  private ledger: LedgerEngine;
  private storage: IStorage;
  private config: SponsorBondConfig;

  // In-memory cache of active bonds
  private bonds: Map<string, SponsorBond> = new Map();
  private bondsBySponsor: Map<IdentityId, Set<string>> = new Map();
  private bondsBySponsee: Map<IdentityId, string> = new Map();

  constructor(
    ledger: LedgerEngine,
    storage: IStorage,
    config?: Partial<SponsorBondConfig>
  ) {
    this.ledger = ledger;
    this.storage = storage;
    this.config = { ...DEFAULT_SPONSOR_BOND_CONFIG, ...config };
  }

  /**
   * Load bonds from storage
   */
  async loadBonds(): Promise<void> {
    // In a full implementation, this would load from storage
    // For now, we work with in-memory state
  }

  /**
   * Check if a sponsor is eligible to sponsor new members
   */
  async canSponsor(sponsorId: IdentityId): Promise<{
    eligible: boolean;
    reason?: string;
  }> {
    // Check sponsor exists and is active
    const sponsorState = this.ledger.getMemberState(sponsorId);
    if (!sponsorState) {
      return { eligible: false, reason: 'Sponsor not found' };
    }

    if (sponsorState.status !== MembershipStatus.ACTIVE) {
      return { eligible: false, reason: 'Sponsor is not an active member' };
    }

    // Check tenure
    const tenure = now() - sponsorState.joinedAt;
    const minTenureDays = this.config.minSponsorTenureDays;
    const minTenureMs = minTenureDays * 24 * 60 * 60 * 1000;

    if (tenure < minTenureMs) {
      return {
        eligible: false,
        reason: `Sponsor must have ${minTenureDays} days tenure (has ${Math.floor(tenure / (24 * 60 * 60 * 1000))} days)`,
      };
    }

    // Check current sponsee count
    const currentSponsees = this.bondsBySponsor.get(sponsorId)?.size ?? 0;
    if (currentSponsees >= this.config.maxActiveSponsees) {
      return {
        eligible: false,
        reason: `Sponsor has reached maximum sponsees (${this.config.maxActiveSponsees})`,
      };
    }

    // Check available capacity for bond
    const bondAmount = Math.floor(sponsorState.limit * this.config.defaultBondFraction);
    const availableCapacity = this.ledger.getAvailableCapacity(sponsorId);

    // Account for existing bonds
    const existingBondTotal = this.getActiveBondTotal(sponsorId);
    const effectiveCapacity = availableCapacity - existingBondTotal;

    if (effectiveCapacity < bondAmount) {
      return {
        eligible: false,
        reason: `Insufficient capacity for bond (need ${bondAmount}, have ${effectiveCapacity})`,
      };
    }

    return { eligible: true };
  }

  /**
   * Create a sponsor bond
   */
  async createBond(input: CreateSponsorBondInput): Promise<SponsorBond> {
    // Validate sponsor eligibility
    const eligibility = await this.canSponsor(input.sponsorId);
    if (!eligibility.eligible) {
      throw new SponsorBondError({
        code: SybilErrorCode.SPONSOR_NOT_ELIGIBLE,
        message: eligibility.reason ?? 'Sponsor not eligible',
      });
    }

    const sponsorState = this.ledger.getMemberState(input.sponsorId)!;

    // Calculate bond parameters
    const bondAmount = input.bondAmount ??
      Math.floor(sponsorState.limit * this.config.defaultBondFraction);
    const riskShare = input.riskShare ?? this.config.defaultRiskShare;
    const probationDays = input.probationDays ?? this.config.defaultProbationDays;

    const timestamp = now();
    const maturesAt = timestamp + (probationDays * 24 * 60 * 60 * 1000);

    const bond: SponsorBond = {
      id: `bond-${generateId()}`,
      sponsorId: input.sponsorId,
      sponseeId: input.sponseeId,
      bondAmount,
      riskShare,
      status: 'ACTIVE',
      createdAt: timestamp,
      maturesAt,
    };

    // Store bond
    this.bonds.set(bond.id, bond);

    // Update indices
    if (!this.bondsBySponsor.has(input.sponsorId)) {
      this.bondsBySponsor.set(input.sponsorId, new Set());
    }
    this.bondsBySponsor.get(input.sponsorId)!.add(bond.id);
    this.bondsBySponsee.set(input.sponseeId, bond.id);

    // In a full implementation, would also persist to storage

    return bond;
  }

  /**
   * Get bond by ID
   */
  getBond(bondId: string): SponsorBond | undefined {
    return this.bonds.get(bondId);
  }

  /**
   * Get bond for a sponsee
   */
  getBondBySponsee(sponseeId: IdentityId): SponsorBond | undefined {
    const bondId = this.bondsBySponsee.get(sponseeId);
    return bondId ? this.bonds.get(bondId) : undefined;
  }

  /**
   * Get all bonds for a sponsor
   */
  getBondsBySponsor(sponsorId: IdentityId): SponsorBond[] {
    const bondIds = this.bondsBySponsor.get(sponsorId);
    if (!bondIds) return [];

    return Array.from(bondIds)
      .map(id => this.bonds.get(id))
      .filter((b): b is SponsorBond => b !== undefined);
  }

  /**
   * Get total active bond amount for a sponsor
   */
  getActiveBondTotal(sponsorId: IdentityId): Units {
    const bonds = this.getBondsBySponsor(sponsorId);
    return bonds
      .filter(b => b.status === 'ACTIVE')
      .reduce((sum, b) => sum + b.bondAmount, 0);
  }

  /**
   * Release a bond (sponsee graduated successfully)
   */
  async releaseBond(bondId: string, reason?: string): Promise<SponsorBond> {
    const bond = this.bonds.get(bondId);
    if (!bond) {
      throw new SponsorBondError({
        code: SybilErrorCode.BOND_NOT_FOUND,
        message: `Bond ${bondId} not found`,
      });
    }

    if (bond.status !== 'ACTIVE') {
      throw new SponsorBondError({
        code: SybilErrorCode.INVALID_BOND_STATE,
        message: `Bond is already ${bond.status}`,
      });
    }

    // Release the bond
    bond.status = 'RELEASED';
    bond.resolvedAt = now();
    bond.resolutionReason = reason ?? 'Sponsee graduated';

    // Sponsor's capacity is now fully available again

    return bond;
  }

  /**
   * Forfeit a bond (sponsee defaulted/excluded)
   */
  async forfeitBond(
    bondId: string,
    defaultAmount: Units,
    reason: string
  ): Promise<SponsorBond> {
    const bond = this.bonds.get(bondId);
    if (!bond) {
      throw new SponsorBondError({
        code: SybilErrorCode.BOND_NOT_FOUND,
        message: `Bond ${bondId} not found`,
      });
    }

    if (bond.status !== 'ACTIVE') {
      throw new SponsorBondError({
        code: SybilErrorCode.INVALID_BOND_STATE,
        message: `Bond is already ${bond.status}`,
      });
    }

    // Calculate forfeiture amount
    // Sponsor absorbs (riskShare * defaultAmount) up to bondAmount
    const forfeitureAmount = Math.min(
      bond.bondAmount,
      Math.floor(defaultAmount * bond.riskShare)
    );

    bond.status = 'FORFEITED';
    bond.resolvedAt = now();
    bond.amountForfeited = forfeitureAmount;
    bond.resolutionReason = reason;

    // In a full implementation, would transfer forfeiture to recovery pool
    // or distribute to affected parties

    return bond;
  }

  /**
   * Check for bonds ready to mature
   */
  async checkMaturedBonds(): Promise<SponsorBond[]> {
    const matured: SponsorBond[] = [];
    const currentTime = now();

    for (const bond of this.bonds.values()) {
      if (bond.status === 'ACTIVE' && bond.maturesAt <= currentTime) {
        matured.push(bond);
      }
    }

    return matured;
  }

  /**
   * Get sponsor's effective capacity (reduced by active bonds)
   */
  getEffectiveCapacity(sponsorId: IdentityId): Units {
    const baseCapacity = this.ledger.getAvailableCapacity(sponsorId);
    const bondTotal = this.getActiveBondTotal(sponsorId);
    return Math.max(0, baseCapacity - bondTotal);
  }

  /**
   * Get bond statistics for a sponsor
   */
  getSponsorStats(sponsorId: IdentityId): {
    totalSponsored: number;
    activeSponsees: number;
    graduatedSponsees: number;
    forfeitedBonds: number;
    totalForfeited: Units;
    activeBondAmount: Units;
  } {
    const allBonds = this.getBondsBySponsor(sponsorId);

    return {
      totalSponsored: allBonds.length,
      activeSponsees: allBonds.filter(b => b.status === 'ACTIVE').length,
      graduatedSponsees: allBonds.filter(b => b.status === 'RELEASED').length,
      forfeitedBonds: allBonds.filter(b => b.status === 'FORFEITED').length,
      totalForfeited: allBonds
        .filter(b => b.status === 'FORFEITED')
        .reduce((sum, b) => sum + (b.amountForfeited ?? 0), 0),
      activeBondAmount: this.getActiveBondTotal(sponsorId),
    };
  }
}

// ============================================
// ERROR CLASS
// ============================================

export class SponsorBondError extends Error {
  public readonly code: SybilErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(error: SybilError) {
    super(error.message);
    this.name = 'SponsorBondError';
    this.code = error.code;
    this.details = error.details;
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create a sponsor bond engine
 */
export function createSponsorBondEngine(
  ledger: LedgerEngine,
  storage: IStorage,
  config?: Partial<SponsorBondConfig>
): SponsorBondEngine {
  return new SponsorBondEngine(ledger, storage, config);
}
