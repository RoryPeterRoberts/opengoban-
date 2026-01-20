/**
 * Cell Protocol - Hardening: Service Bond Engine
 *
 * Manages service bonds for Sybil resistance.
 * New members must earn before receiving full limits.
 */

import { IdentityId, Timestamp, Units, generateId, now } from '../../types/common';
import {
  ServiceBond,
  ServiceBondStatus,
  ServiceRecord,
  RecordServiceInput,
  ServiceBondConfig,
  DEFAULT_SERVICE_BOND_CONFIG,
  SybilErrorCode,
  SybilError,
} from '../types/sybil';
import { LedgerEngine } from '../../engines/ledger-engine';
import { IStorage } from '../../storage/pouchdb-adapter';

// ============================================
// SERVICE BOND ENGINE
// ============================================

/**
 * Manages service bonds for new members
 * Implements earn-before-limits mechanism
 */
export class ServiceBondEngine {
  private ledger: LedgerEngine;
  private storage: IStorage;
  private config: ServiceBondConfig;

  // In-memory state
  private bonds: Map<string, ServiceBond> = new Map();
  private bondsByMember: Map<IdentityId, string> = new Map();

  constructor(
    ledger: LedgerEngine,
    storage: IStorage,
    config?: Partial<ServiceBondConfig>
  ) {
    this.ledger = ledger;
    this.storage = storage;
    this.config = { ...DEFAULT_SERVICE_BOND_CONFIG, ...config };
  }

  /**
   * Create a service bond for a new member
   */
  async createBond(memberId: IdentityId): Promise<ServiceBond> {
    // Check if member already has a bond
    if (this.bondsByMember.has(memberId)) {
      throw new ServiceBondError({
        code: SybilErrorCode.INVALID_BOND_STATE,
        message: `Member ${memberId} already has a service bond`,
      });
    }

    // Get member's assigned limit
    const memberState = this.ledger.getMemberState(memberId);
    if (!memberState) {
      throw new ServiceBondError({
        code: SybilErrorCode.BOND_NOT_FOUND,
        message: `Member ${memberId} not found in ledger`,
      });
    }

    const fullLimit = memberState.limit;
    const limitDuringBond = Math.floor(fullLimit * this.config.limitMultiplier);

    const bond: ServiceBond = {
      id: `sbond-${generateId()}`,
      memberId,
      requiredHours: this.config.requiredHours,
      completedHours: 0,
      limitDuringBond,
      fullLimit,
      status: 'ACTIVE',
      createdAt: now(),
      serviceRecords: [],
    };

    // Store bond
    this.bonds.set(bond.id, bond);
    this.bondsByMember.set(memberId, bond.id);

    // Apply reduced limit
    await this.ledger.updateMemberLimit(memberId, limitDuringBond);

    return bond;
  }

  /**
   * Get bond by ID
   */
  getBond(bondId: string): ServiceBond | undefined {
    return this.bonds.get(bondId);
  }

  /**
   * Get bond for a member
   */
  getBondByMember(memberId: IdentityId): ServiceBond | undefined {
    const bondId = this.bondsByMember.get(memberId);
    return bondId ? this.bonds.get(bondId) : undefined;
  }

  /**
   * Check if member is under service bond
   */
  isUnderServiceBond(memberId: IdentityId): boolean {
    const bond = this.getBondByMember(memberId);
    return bond !== undefined && bond.status === 'ACTIVE';
  }

  /**
   * Record completed service
   */
  async recordService(input: RecordServiceInput): Promise<ServiceBond> {
    const bond = this.getBondByMember(input.memberId);
    if (!bond) {
      throw new ServiceBondError({
        code: SybilErrorCode.NOT_ON_PROBATION,
        message: `Member ${input.memberId} has no service bond`,
      });
    }

    if (bond.status !== 'ACTIVE') {
      throw new ServiceBondError({
        code: SybilErrorCode.INVALID_BOND_STATE,
        message: `Service bond is already ${bond.status}`,
      });
    }

    // Validate rating if provided
    if (input.rating !== undefined && input.rating < this.config.minAcceptableRating) {
      throw new ServiceBondError({
        code: SybilErrorCode.SERVICE_VERIFICATION_FAILED,
        message: `Service rating ${input.rating} below minimum ${this.config.minAcceptableRating}`,
      });
    }

    // Cap hours per day
    const today = new Date(now());
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();

    const hoursToday = bond.serviceRecords
      .filter(r => r.completedAt >= todayStart)
      .reduce((sum, r) => sum + r.hours, 0);

    const allowedHours = Math.min(
      input.hours,
      this.config.maxHoursPerDay - hoursToday
    );

    if (allowedHours <= 0) {
      throw new ServiceBondError({
        code: SybilErrorCode.SERVICE_VERIFICATION_FAILED,
        message: `Daily service hour limit reached (${this.config.maxHoursPerDay} hours)`,
      });
    }

    // Create service record
    const record: ServiceRecord = {
      id: `srec-${generateId()}`,
      commitmentId: input.commitmentId,
      hours: allowedHours,
      rating: input.rating,
      verifiedBy: input.verifiedBy,
      completedAt: now(),
    };

    bond.serviceRecords.push(record);
    bond.completedHours += allowedHours;

    // Check for graduation
    if (bond.completedHours >= bond.requiredHours) {
      await this.graduateBond(bond.id);
    }

    return bond;
  }

  /**
   * Graduate a member (restore full limits)
   */
  async graduateBond(bondId: string): Promise<ServiceBond> {
    const bond = this.bonds.get(bondId);
    if (!bond) {
      throw new ServiceBondError({
        code: SybilErrorCode.BOND_NOT_FOUND,
        message: `Bond ${bondId} not found`,
      });
    }

    if (bond.status !== 'ACTIVE') {
      throw new ServiceBondError({
        code: SybilErrorCode.INVALID_BOND_STATE,
        message: `Bond is already ${bond.status}`,
      });
    }

    bond.status = 'GRADUATED';
    bond.graduatedAt = now();

    // Restore full limit
    await this.ledger.updateMemberLimit(bond.memberId, bond.fullLimit);

    return bond;
  }

  /**
   * Fail a service bond (member excluded or gave up)
   */
  async failBond(bondId: string, reason: string): Promise<ServiceBond> {
    const bond = this.bonds.get(bondId);
    if (!bond) {
      throw new ServiceBondError({
        code: SybilErrorCode.BOND_NOT_FOUND,
        message: `Bond ${bondId} not found`,
      });
    }

    if (bond.status !== 'ACTIVE') {
      throw new ServiceBondError({
        code: SybilErrorCode.INVALID_BOND_STATE,
        message: `Bond is already ${bond.status}`,
      });
    }

    bond.status = 'FAILED';

    // Leave limit at reduced level (member still has account but limited)

    return bond;
  }

  /**
   * Get progress toward graduation
   */
  getProgress(memberId: IdentityId): {
    hoursCompleted: number;
    hoursRequired: number;
    progressPercent: number;
    currentLimit: Units;
    fullLimit: Units;
    recentService: ServiceRecord[];
  } | undefined {
    const bond = this.getBondByMember(memberId);
    if (!bond) return undefined;

    return {
      hoursCompleted: bond.completedHours,
      hoursRequired: bond.requiredHours,
      progressPercent: Math.min(100, (bond.completedHours / bond.requiredHours) * 100),
      currentLimit: bond.limitDuringBond,
      fullLimit: bond.fullLimit,
      recentService: bond.serviceRecords.slice(-5),
    };
  }

  /**
   * Get hours remaining for a member
   */
  getHoursRemaining(memberId: IdentityId): number {
    const bond = this.getBondByMember(memberId);
    if (!bond || bond.status !== 'ACTIVE') return 0;

    return Math.max(0, bond.requiredHours - bond.completedHours);
  }

  /**
   * Get average rating for a member's service
   */
  getAverageRating(memberId: IdentityId): number | undefined {
    const bond = this.getBondByMember(memberId);
    if (!bond) return undefined;

    const ratedRecords = bond.serviceRecords.filter(r => r.rating !== undefined);
    if (ratedRecords.length === 0) return undefined;

    const sum = ratedRecords.reduce((s, r) => s + (r.rating ?? 0), 0);
    return sum / ratedRecords.length;
  }

  /**
   * Get all active service bonds
   */
  getActiveServiceBonds(): ServiceBond[] {
    return Array.from(this.bonds.values())
      .filter(b => b.status === 'ACTIVE');
  }

  /**
   * Check how many hours a member can still record today
   */
  getRemainingHoursToday(memberId: IdentityId): number {
    const bond = this.getBondByMember(memberId);
    if (!bond || bond.status !== 'ACTIVE') return 0;

    const today = new Date(now());
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();

    const hoursToday = bond.serviceRecords
      .filter(r => r.completedAt >= todayStart)
      .reduce((sum, r) => sum + r.hours, 0);

    return Math.max(0, this.config.maxHoursPerDay - hoursToday);
  }
}

// ============================================
// ERROR CLASS
// ============================================

export class ServiceBondError extends Error {
  public readonly code: SybilErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(error: SybilError) {
    super(error.message);
    this.name = 'ServiceBondError';
    this.code = error.code;
    this.details = error.details;
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create a service bond engine
 */
export function createServiceBondEngine(
  ledger: LedgerEngine,
  storage: IStorage,
  config?: Partial<ServiceBondConfig>
): ServiceBondEngine {
  return new ServiceBondEngine(ledger, storage, config);
}
