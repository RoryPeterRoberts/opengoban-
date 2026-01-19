/**
 * Cell Protocol - Ledger Engine
 *
 * Core implementation of the Cell Ledger (PRD-01).
 * Enforces the fundamental invariants:
 * - I1: SUM(balances) = 0 (Conservation Law)
 * - I2: balance_i >= -limit_i (Floor Constraint)
 * - I3: balance_i - reserve_i >= -limit_i (Escrow Safety)
 * - I4: reserve_i >= 0 (Non-negative Reserves)
 */

import {
  IdentityId,
  CellId,
  Timestamp,
  Units,
  MembershipStatus,
  now,
} from '../types/common';
import {
  MemberState,
  CellLedgerState,
  LedgerParameters,
  BalanceUpdate,
  ReserveUpdate,
  BalanceUpdateResult,
  LedgerError,
  LedgerErrorCode,
  LedgerStatistics,
  ILedgerEngine,
} from '../types/ledger';
import { Result, ok, err } from '../utils/result';
import { IStorage } from '../storage/pouchdb-adapter';

// ============================================
// LEDGER ENGINE IMPLEMENTATION
// ============================================

export class LedgerEngine implements ILedgerEngine {
  private state: CellLedgerState;
  private storage: IStorage;

  constructor(
    cellId: CellId,
    parameters: Partial<LedgerParameters>,
    storage: IStorage
  ) {
    const fullParams: LedgerParameters = {
      cellId,
      defaultLimit: parameters.defaultLimit ?? 100,
      minLimit: parameters.minLimit ?? 0,
      maxLimit: parameters.maxLimit ?? 10000,
      enforceEscrowSafety: parameters.enforceEscrowSafety ?? true,
    };

    this.state = {
      cellId,
      parameters: fullParams,
      members: new Map(),
      sequenceNumber: 0,
      lastUpdated: now(),
    };

    this.storage = storage;
  }

  /**
   * Initialize from storage (load existing state)
   */
  async initialize(): Promise<Result<void, LedgerError>> {
    const result = await this.storage.getLedgerState(this.state.cellId);
    if (!result.ok) {
      return err({
        code: LedgerErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }

    if (result.value) {
      this.state = result.value;
    }

    return ok(undefined);
  }

  /**
   * Persist state to storage
   */
  private async persist(): Promise<Result<void, LedgerError>> {
    const result = await this.storage.saveLedgerState(this.state);
    if (!result.ok) {
      return err({
        code: LedgerErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }
    return ok(undefined);
  }

  // ============================================
  // QUERY METHODS
  // ============================================

  getCellId(): CellId {
    return this.state.cellId;
  }

  getParameters(): LedgerParameters {
    return { ...this.state.parameters };
  }

  getMemberState(memberId: IdentityId): MemberState | undefined {
    const state = this.state.members.get(memberId);
    return state ? { ...state } : undefined;
  }

  getAllMemberStates(): Map<IdentityId, MemberState> {
    const result = new Map<IdentityId, MemberState>();
    this.state.members.forEach((state, id) => {
      result.set(id, { ...state });
    });
    return result;
  }

  /**
   * Check if a member can spend a given amount
   * Takes into account: balance, limit, reserve, and escrow safety
   */
  canSpend(memberId: IdentityId, amount: Units): boolean {
    if (amount <= 0) return false;

    const member = this.state.members.get(memberId);
    if (!member) return false;
    if (member.status !== MembershipStatus.ACTIVE) return false;

    const availableCapacity = this.getAvailableCapacity(memberId);
    return amount <= availableCapacity;
  }

  /**
   * Get member's available spending capacity
   * Available = limit + balance - reserve
   */
  getAvailableCapacity(memberId: IdentityId): Units {
    const member = this.state.members.get(memberId);
    if (!member) return 0;

    // Available capacity = limit + balance - reserve
    // This is the amount the member can spend before hitting escrow floor
    return member.limit + member.balance - member.reserve;
  }

  getMemberCount(): number {
    return this.state.members.size;
  }

  // ============================================
  // MEMBER MANAGEMENT
  // ============================================

  /**
   * Add a new member to the ledger
   */
  async addMember(memberId: IdentityId, initialLimit?: Units): Promise<MemberState> {
    if (this.state.members.has(memberId)) {
      throw new Error(`Member ${memberId} already exists`);
    }

    const limit = initialLimit ?? this.state.parameters.defaultLimit;

    // Validate limit
    if (limit < this.state.parameters.minLimit || limit > this.state.parameters.maxLimit) {
      throw new Error(
        `Limit ${limit} out of range [${this.state.parameters.minLimit}, ${this.state.parameters.maxLimit}]`
      );
    }

    const memberState: MemberState = {
      memberId,
      balance: 0, // Always start at zero (conservation law)
      limit,
      reserve: 0,
      status: MembershipStatus.ACTIVE,
      lastActivity: now(),
      joinedAt: now(),
    };

    this.state.members.set(memberId, memberState);
    this.state.sequenceNumber++;
    this.state.lastUpdated = now();

    await this.persist();

    // Log event
    await this.storage.appendEvent({
      cellId: this.state.cellId,
      type: 'MEMBER_ADDED',
      timestamp: now(),
      data: { memberId, limit },
    });

    return { ...memberState };
  }

  /**
   * Remove a member from the ledger (balance must be zero)
   */
  async removeMember(memberId: IdentityId): Promise<void> {
    const member = this.state.members.get(memberId);
    if (!member) {
      throw new Error(`Member ${memberId} not found`);
    }

    if (member.balance !== 0) {
      throw new Error(`Cannot remove member with non-zero balance: ${member.balance}`);
    }

    if (member.reserve !== 0) {
      throw new Error(`Cannot remove member with active reserves: ${member.reserve}`);
    }

    this.state.members.delete(memberId);
    this.state.sequenceNumber++;
    this.state.lastUpdated = now();

    await this.persist();

    await this.storage.appendEvent({
      cellId: this.state.cellId,
      type: 'MEMBER_REMOVED',
      timestamp: now(),
      data: { memberId },
    });
  }

  // ============================================
  // BALANCE OPERATIONS (ATOMIC)
  // ============================================

  /**
   * Apply atomic balance updates
   *
   * CRITICAL INVARIANTS ENFORCED:
   * - I1: SUM(deltas) must equal 0 (Conservation Law)
   * - I2: newBalance >= -limit for all members (Floor Constraint)
   * - I3: newBalance - reserve >= -limit (Escrow Safety, if enabled)
   */
  async applyBalanceUpdates(updates: BalanceUpdate[]): Promise<BalanceUpdateResult[]> {
    if (updates.length === 0) {
      return [];
    }

    // =========================================
    // INVARIANT I1: Conservation Check
    // =========================================
    const sumDeltas = updates.reduce((sum, u) => sum + u.delta, 0);
    if (sumDeltas !== 0) {
      throw new LedgerViolationError({
        code: LedgerErrorCode.CONSERVATION_VIOLATION,
        message: `Sum of deltas is ${sumDeltas}, must be 0`,
        details: { sumDeltas, updates },
      });
    }

    // =========================================
    // VALIDATION PHASE
    // =========================================
    const validationResults: Array<{
      update: BalanceUpdate;
      member: MemberState;
      newBalance: Units;
    }> = [];

    for (const update of updates) {
      const member = this.state.members.get(update.memberId);

      // Member must exist
      if (!member) {
        throw new LedgerViolationError({
          code: LedgerErrorCode.MEMBER_NOT_FOUND,
          message: `Member ${update.memberId} not found`,
          details: { memberId: update.memberId },
        });
      }

      // Member must be active
      if (member.status !== MembershipStatus.ACTIVE) {
        throw new LedgerViolationError({
          code: LedgerErrorCode.MEMBER_NOT_ACTIVE,
          message: `Member ${update.memberId} is not active (status: ${member.status})`,
          details: { memberId: update.memberId, status: member.status },
        });
      }

      const newBalance = member.balance + update.delta;

      // =========================================
      // INVARIANT I2: Floor Constraint
      // =========================================
      if (newBalance < -member.limit) {
        throw new LedgerViolationError({
          code: LedgerErrorCode.FLOOR_VIOLATION,
          message: `Balance ${newBalance} would breach floor -${member.limit} for member ${update.memberId}`,
          details: {
            memberId: update.memberId,
            currentBalance: member.balance,
            delta: update.delta,
            newBalance,
            limit: member.limit,
            floor: -member.limit,
          },
        });
      }

      // =========================================
      // INVARIANT I3: Escrow Safety
      // =========================================
      if (this.state.parameters.enforceEscrowSafety) {
        const escrowFloor = -member.limit + member.reserve;
        if (newBalance < escrowFloor) {
          throw new LedgerViolationError({
            code: LedgerErrorCode.ESCROW_VIOLATION,
            message: `Balance ${newBalance} would breach escrow floor ${escrowFloor} for member ${update.memberId}`,
            details: {
              memberId: update.memberId,
              currentBalance: member.balance,
              delta: update.delta,
              newBalance,
              reserve: member.reserve,
              escrowFloor,
            },
          });
        }
      }

      validationResults.push({ update, member, newBalance });
    }

    // =========================================
    // COMMIT PHASE (all validations passed)
    // =========================================
    const results: BalanceUpdateResult[] = [];
    const timestamp = now();

    for (const { update, member, newBalance } of validationResults) {
      const previousBalance = member.balance;

      // Update in place
      member.balance = newBalance;
      member.lastActivity = timestamp;

      results.push({
        success: true,
        newBalance,
        previousBalance,
        sequenceNumber: ++this.state.sequenceNumber,
      });
    }

    this.state.lastUpdated = timestamp;
    await this.persist();

    // Log the balance update event
    await this.storage.appendEvent({
      cellId: this.state.cellId,
      type: 'BALANCE_UPDATES',
      timestamp,
      data: {
        updates: updates.map((u, i) => ({
          memberId: u.memberId,
          delta: u.delta,
          reason: u.reason,
          referenceId: u.referenceId,
          newBalance: results[i].newBalance,
        })),
      },
    });

    return results;
  }

  /**
   * Apply a reserve update (for escrow/commitments)
   *
   * INVARIANT I4: reserve >= 0
   */
  async applyReserveUpdate(update: ReserveUpdate): Promise<void> {
    const member = this.state.members.get(update.memberId);

    if (!member) {
      throw new LedgerViolationError({
        code: LedgerErrorCode.MEMBER_NOT_FOUND,
        message: `Member ${update.memberId} not found`,
      });
    }

    const newReserve = member.reserve + update.delta;

    // =========================================
    // INVARIANT I4: Non-negative Reserves
    // =========================================
    if (newReserve < 0) {
      throw new LedgerViolationError({
        code: LedgerErrorCode.NEGATIVE_RESERVE,
        message: `Reserve ${newReserve} would be negative for member ${update.memberId}`,
        details: {
          memberId: update.memberId,
          currentReserve: member.reserve,
          delta: update.delta,
          newReserve,
        },
      });
    }

    // =========================================
    // INVARIANT I3: Escrow Safety (increasing reserve)
    // =========================================
    if (update.delta > 0 && this.state.parameters.enforceEscrowSafety) {
      const escrowFloor = -member.limit + newReserve;
      if (member.balance < escrowFloor) {
        throw new LedgerViolationError({
          code: LedgerErrorCode.ESCROW_VIOLATION,
          message: `Cannot reserve ${update.delta}: would breach escrow floor`,
          details: {
            memberId: update.memberId,
            balance: member.balance,
            newReserve,
            escrowFloor,
          },
        });
      }
    }

    member.reserve = newReserve;
    member.lastActivity = now();
    this.state.sequenceNumber++;
    this.state.lastUpdated = now();

    await this.persist();

    await this.storage.appendEvent({
      cellId: this.state.cellId,
      type: 'RESERVE_UPDATE',
      timestamp: now(),
      data: {
        memberId: update.memberId,
        delta: update.delta,
        reason: update.reason,
        commitmentId: update.commitmentId,
        newReserve,
      },
    });
  }

  // ============================================
  // LIMIT & STATUS MANAGEMENT
  // ============================================

  /**
   * Update a member's credit limit
   */
  async updateMemberLimit(memberId: IdentityId, newLimit: Units): Promise<void> {
    const member = this.state.members.get(memberId);
    if (!member) {
      throw new LedgerViolationError({
        code: LedgerErrorCode.MEMBER_NOT_FOUND,
        message: `Member ${memberId} not found`,
      });
    }

    // Validate limit range
    if (newLimit < this.state.parameters.minLimit || newLimit > this.state.parameters.maxLimit) {
      throw new LedgerViolationError({
        code: LedgerErrorCode.INVALID_AMOUNT,
        message: `Limit ${newLimit} out of range [${this.state.parameters.minLimit}, ${this.state.parameters.maxLimit}]`,
      });
    }

    // Check that reducing limit doesn't breach floor
    if (newLimit < member.limit) {
      const newFloor = -newLimit;
      if (member.balance < newFloor) {
        throw new LedgerViolationError({
          code: LedgerErrorCode.FLOOR_VIOLATION,
          message: `Cannot reduce limit: current balance ${member.balance} would breach new floor ${newFloor}`,
        });
      }
    }

    const oldLimit = member.limit;
    member.limit = newLimit;
    member.lastActivity = now();
    this.state.sequenceNumber++;
    this.state.lastUpdated = now();

    await this.persist();

    await this.storage.appendEvent({
      cellId: this.state.cellId,
      type: 'LIMIT_UPDATED',
      timestamp: now(),
      data: { memberId, oldLimit, newLimit },
    });
  }

  /**
   * Update a member's status
   */
  async updateMemberStatus(memberId: IdentityId, status: MembershipStatus): Promise<void> {
    const member = this.state.members.get(memberId);
    if (!member) {
      throw new LedgerViolationError({
        code: LedgerErrorCode.MEMBER_NOT_FOUND,
        message: `Member ${memberId} not found`,
      });
    }

    const oldStatus = member.status;
    member.status = status;
    member.lastActivity = now();
    this.state.sequenceNumber++;
    this.state.lastUpdated = now();

    await this.persist();

    await this.storage.appendEvent({
      cellId: this.state.cellId,
      type: 'STATUS_UPDATED',
      timestamp: now(),
      data: { memberId, oldStatus, newStatus: status },
    });
  }

  // ============================================
  // VERIFICATION METHODS
  // ============================================

  /**
   * Verify conservation law: SUM(balances) = 0
   */
  verifyConservation(): boolean {
    let sum = 0;
    this.state.members.forEach(member => {
      sum += member.balance;
    });
    return sum === 0;
  }

  /**
   * Verify all floor constraints: balance >= -limit for all members
   */
  verifyAllFloors(): boolean {
    for (const member of this.state.members.values()) {
      if (member.balance < -member.limit) {
        return false;
      }
    }
    return true;
  }

  // ============================================
  // STATISTICS
  // ============================================

  /**
   * Get aggregate statistics for the ledger
   */
  getStatistics(): LedgerStatistics {
    let positiveBalanceSum = 0;
    let negativeBalanceSum = 0;
    let aggregateCapacity = 0;
    let floorMass = 0;
    let totalReserved = 0;
    let balanceSum = 0;
    let activeMemberCount = 0;

    this.state.members.forEach(member => {
      balanceSum += member.balance;
      aggregateCapacity += member.limit;
      totalReserved += member.reserve;

      if (member.balance > 0) {
        positiveBalanceSum += member.balance;
      } else {
        negativeBalanceSum += Math.abs(member.balance);
      }

      // Floor mass: sum of limits for members at floor
      if (member.balance <= -member.limit) {
        floorMass += member.limit;
      }

      if (member.status === MembershipStatus.ACTIVE) {
        activeMemberCount++;
      }
    });

    return {
      memberCount: this.state.members.size,
      activeMemberCount,
      positiveBalanceSum,
      negativeBalanceSum,
      aggregateCapacity,
      floorMass,
      totalReserved,
      balanceSum,
    };
  }
}

// ============================================
// CUSTOM ERROR CLASS
// ============================================

export class LedgerViolationError extends Error {
  public readonly code: LedgerErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(error: LedgerError) {
    super(error.message);
    this.name = 'LedgerViolationError';
    this.code = error.code;
    this.details = error.details;
  }

  toJSON(): LedgerError {
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
 * Create a new ledger engine
 */
export async function createLedgerEngine(
  cellId: CellId,
  parameters: Partial<LedgerParameters>,
  storage: IStorage
): Promise<LedgerEngine> {
  const engine = new LedgerEngine(cellId, parameters, storage);
  await engine.initialize();
  return engine;
}
