/**
 * Cell Protocol - Federation Engine
 *
 * Implementation of the Federation Layer (PRD-06).
 * Manages inter-cell transactions, exposure caps, and quarantine.
 */

import {
  CellId,
  IdentityId,
  Timestamp,
  Units,
  BalanceChangeReason,
  MembershipStatus,
  now,
  generateId,
} from '../types/common';
import {
  FederationTxId,
  LinkProposalId,
  FederationStatus,
  LinkStatus,
  FederationTxStatus,
  QuarantineReason,
  FederationLink,
  LinkProposal,
  FederationTerms,
  FederationState,
  FederationTransaction,
  CreateFederationTxInput,
  FederationTxResult,
  QuarantineStatus,
  FederationParameters,
  ExposureAnalysis,
  FederationError,
  FederationErrorCode,
  IFederationEngine,
  DEFAULT_FEDERATION_TERMS,
  DEFAULT_FEDERATION_PARAMETERS,
  generateFederationTxId,
  generateLinkProposalId,
} from '../types/federation';
import { LedgerEngine } from './ledger-engine';
import { EmergencyEngine } from './emergency-engine';
import { IStorage } from '../storage/pouchdb-adapter';

// ============================================
// FEDERATION ENGINE IMPLEMENTATION
// ============================================

export class FederationEngine implements IFederationEngine {
  private cellId: CellId;
  private ledger: LedgerEngine;
  private storage: IStorage;
  private emergency?: EmergencyEngine;
  private parameters: FederationParameters;

  private state: FederationState;
  private clearingAccountId: IdentityId;

  constructor(
    cellId: CellId,
    ledger: LedgerEngine,
    storage: IStorage,
    parameters: Partial<FederationParameters> = {}
  ) {
    this.cellId = cellId;
    this.ledger = ledger;
    this.storage = storage;
    this.parameters = { ...DEFAULT_FEDERATION_PARAMETERS, ...parameters };

    // Generate clearing account ID
    this.clearingAccountId = `clearing-${cellId}`;

    // Initialize state
    const timestamp = now();
    this.state = {
      cellId,
      federationPosition: 0,
      clearingAccountId: this.clearingAccountId,
      exposureCap: 0, // Will be calculated on initialize
      betaFactor: this.parameters.baseBetaFactor,
      connectedCells: [],
      status: FederationStatus.ACTIVE,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  /** Initialize the federation engine (creates clearing account) */
  async initialize(): Promise<void> {
    // Create clearing account if it doesn't exist
    const existingMember = this.ledger.getMemberState(this.clearingAccountId);
    if (!existingMember) {
      await this.ledger.addMember(this.clearingAccountId, 0);
      // Set status to active
      await this.ledger.updateMemberStatus(this.clearingAccountId, MembershipStatus.ACTIVE);
    }

    // Calculate initial exposure cap
    await this.recalculateExposureCap();

    // Load state from storage if exists
    const result = await this.storage.getFederationState(this.cellId);
    if (result.ok && result.value) {
      this.state = result.value;
    } else {
      await this.saveState();
    }
  }

  /** Set the emergency engine (circular dependency resolution) */
  setEmergencyEngine(emergency: EmergencyEngine): void {
    this.emergency = emergency;
  }

  // ============================================
  // CORE INTERFACE METHODS
  // ============================================

  getCellId(): CellId {
    return this.cellId;
  }

  getFederationState(): FederationState {
    return {
      ...this.state,
      connectedCells: [...this.state.connectedCells.map(c => ({ ...c }))],
    };
  }

  getPosition(): Units {
    return this.state.federationPosition;
  }

  getExposureCap(): Units {
    return this.state.exposureCap;
  }

  getAvailableCapacity(): Units {
    return Math.max(0, this.state.exposureCap - Math.abs(this.state.federationPosition));
  }

  getConnectedCells(): FederationLink[] {
    return [...this.state.connectedCells.map(c => ({ ...c }))];
  }

  getLink(remoteCellId: CellId): FederationLink | undefined {
    const link = this.state.connectedCells.find(c => c.remoteCellId === remoteCellId);
    return link ? { ...link } : undefined;
  }

  getClearingAccountId(): IdentityId {
    return this.clearingAccountId;
  }

  // ============================================
  // LINK MANAGEMENT
  // ============================================

  async proposeLink(
    remoteCellId: CellId,
    terms: Partial<FederationTerms> = {}
  ): Promise<LinkProposal> {
    // Check if link already exists
    const existingLink = this.getLink(remoteCellId);
    if (existingLink && existingLink.status !== LinkStatus.PENDING) {
      throw new FederationValidationError({
        code: FederationErrorCode.LINK_SUSPENDED,
        message: `Link to ${remoteCellId} already exists`,
      });
    }

    const proposal: LinkProposal = {
      id: generateLinkProposalId(),
      initiatorCellId: this.cellId,
      targetCellId: remoteCellId,
      proposedTerms: { ...DEFAULT_FEDERATION_TERMS, ...terms },
      createdAt: now(),
      expiresAt: now() + (7 * 24 * 60 * 60 * 1000), // 7 days
      status: 'PENDING',
    };

    const result = await this.storage.saveLinkProposal(proposal);
    if (!result.ok) {
      throw new FederationValidationError({
        code: FederationErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }

    // Add pending link
    this.state.connectedCells.push({
      remoteCellId,
      status: LinkStatus.PENDING,
      bilateralPosition: 0,
      establishedAt: now(),
      lastActivity: now(),
    });

    await this.saveState();

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'LINK_PROPOSED',
      timestamp: now(),
      data: { proposalId: proposal.id, remoteCellId },
    });

    return proposal;
  }

  async acceptLink(proposalId: LinkProposalId): Promise<FederationLink> {
    const proposalResult = await this.storage.getLinkProposal(proposalId);
    if (!proposalResult.ok || !proposalResult.value) {
      throw new FederationValidationError({
        code: FederationErrorCode.PROPOSAL_NOT_FOUND,
        message: `Proposal ${proposalId} not found`,
      });
    }

    const proposal = proposalResult.value;

    if (proposal.status !== 'PENDING') {
      throw new FederationValidationError({
        code: FederationErrorCode.INVALID_TX_STATE,
        message: `Proposal is not pending: ${proposal.status}`,
      });
    }

    if (now() > proposal.expiresAt) {
      throw new FederationValidationError({
        code: FederationErrorCode.PROPOSAL_EXPIRED,
        message: 'Proposal has expired',
      });
    }

    // Update proposal
    proposal.status = 'ACCEPTED';
    proposal.respondedAt = now();
    await this.storage.saveLinkProposal(proposal);

    // Determine the remote cell ID based on which side we are
    // If we are the initiator (simulating round-trip), the remote is the target
    // If we are the target (normal case), the remote is the initiator
    const remoteCellId = this.cellId === proposal.initiatorCellId
      ? proposal.targetCellId
      : proposal.initiatorCellId;

    // Update or create link
    const existingLinkIndex = this.state.connectedCells.findIndex(
      c => c.remoteCellId === remoteCellId
    );

    const link: FederationLink = {
      remoteCellId,
      status: LinkStatus.ACTIVE,
      bilateralPosition: 0,
      establishedAt: now(),
      lastActivity: now(),
    };

    if (existingLinkIndex >= 0) {
      this.state.connectedCells[existingLinkIndex] = link;
    } else {
      this.state.connectedCells.push(link);
    }

    await this.saveState();

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'LINK_ACCEPTED',
      timestamp: now(),
      data: { proposalId, remoteCellId: proposal.initiatorCellId },
    });

    return link;
  }

  async rejectLink(proposalId: LinkProposalId, reason: string): Promise<void> {
    const proposalResult = await this.storage.getLinkProposal(proposalId);
    if (!proposalResult.ok || !proposalResult.value) {
      throw new FederationValidationError({
        code: FederationErrorCode.PROPOSAL_NOT_FOUND,
        message: `Proposal ${proposalId} not found`,
      });
    }

    const proposal = proposalResult.value;
    proposal.status = 'REJECTED';
    proposal.respondedAt = now();
    proposal.rejectionReason = reason;

    await this.storage.saveLinkProposal(proposal);

    // Remove pending link if exists
    this.state.connectedCells = this.state.connectedCells.filter(
      c => c.remoteCellId !== proposal.initiatorCellId || c.status !== LinkStatus.PENDING
    );

    await this.saveState();
  }

  async suspendLink(remoteCellId: CellId, reason: string): Promise<void> {
    const linkIndex = this.state.connectedCells.findIndex(
      c => c.remoteCellId === remoteCellId
    );

    if (linkIndex < 0) {
      throw new FederationValidationError({
        code: FederationErrorCode.LINK_NOT_FOUND,
        message: `Link to ${remoteCellId} not found`,
      });
    }

    this.state.connectedCells[linkIndex].status = LinkStatus.SUSPENDED;
    this.state.connectedCells[linkIndex].suspensionReason = reason;
    this.state.connectedCells[linkIndex].suspendedAt = now();

    await this.saveState();

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'LINK_SUSPENDED',
      timestamp: now(),
      data: { remoteCellId, reason },
    });
  }

  async resumeLink(remoteCellId: CellId): Promise<void> {
    const linkIndex = this.state.connectedCells.findIndex(
      c => c.remoteCellId === remoteCellId
    );

    if (linkIndex < 0) {
      throw new FederationValidationError({
        code: FederationErrorCode.LINK_NOT_FOUND,
        message: `Link to ${remoteCellId} not found`,
      });
    }

    this.state.connectedCells[linkIndex].status = LinkStatus.ACTIVE;
    this.state.connectedCells[linkIndex].suspensionReason = undefined;
    this.state.connectedCells[linkIndex].suspendedAt = undefined;

    await this.saveState();

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'LINK_RESUMED',
      timestamp: now(),
      data: { remoteCellId },
    });
  }

  // ============================================
  // TRANSACTION VALIDATION
  // ============================================

  async validateInterCellTx(input: CreateFederationTxInput): Promise<void> {
    // Check if federation is frozen (PANIC mode)
    if (this.emergency?.isFederationFrozen()) {
      throw new FederationValidationError({
        code: FederationErrorCode.FEDERATION_FROZEN,
        message: 'Federation is frozen due to PANIC mode',
      });
    }

    // Check if cell is quarantined
    if (this.state.status === FederationStatus.QUARANTINED) {
      throw new FederationValidationError({
        code: FederationErrorCode.CELL_QUARANTINED,
        message: `Cell is quarantined: ${this.state.quarantineReason}`,
      });
    }

    // Validate amount
    if (input.amount <= 0) {
      throw new FederationValidationError({
        code: FederationErrorCode.INVALID_AMOUNT,
        message: 'Amount must be positive',
      });
    }

    // Determine if we're source or target
    const isSource = input.sourceCell === this.cellId;

    if (isSource) {
      // Check link exists and is active
      const link = this.getLink(input.targetCell);
      if (!link) {
        throw new FederationValidationError({
          code: FederationErrorCode.LINK_NOT_FOUND,
          message: `No link to cell ${input.targetCell}`,
        });
      }

      if (link.status === LinkStatus.SUSPENDED) {
        throw new FederationValidationError({
          code: FederationErrorCode.LINK_SUSPENDED,
          message: `Link to ${input.targetCell} is suspended`,
        });
      }

      // Check payer can spend
      if (!this.ledger.canSpend(input.payer, input.amount)) {
        throw new FederationValidationError({
          code: FederationErrorCode.LEDGER_ERROR,
          message: 'Payer cannot spend the requested amount',
        });
      }

      // Check cap feasibility (outgoing increases our position)
      // For outgoing: we give credit, position increases
      const newPosition = this.state.federationPosition + input.amount;
      if (Math.abs(newPosition) > this.state.exposureCap) {
        throw new FederationValidationError({
          code: FederationErrorCode.CAP_EXCEEDED,
          message: `Transaction would exceed exposure cap: |${newPosition}| > ${this.state.exposureCap}`,
          details: { newPosition, cap: this.state.exposureCap },
        });
      }
    }
  }

  // ============================================
  // TRANSACTION EXECUTION
  // ============================================

  async executeInterCellTx(input: CreateFederationTxInput): Promise<FederationTxResult> {
    // Validate first
    await this.validateInterCellTx(input);

    const isSource = input.sourceCell === this.cellId;

    // Create transaction record
    const transaction: FederationTransaction = {
      id: generateFederationTxId(),
      sourceCell: input.sourceCell,
      targetCell: input.targetCell,
      payer: input.payer,
      payee: input.payee,
      amount: input.amount,
      status: FederationTxStatus.PENDING,
      memo: input.memo,
      createdAt: now(),
    };

    await this.storage.saveFederationTransaction(transaction);

    if (isSource) {
      // Execute source leg: payer pays clearing account
      try {
        await this.ledger.applyBalanceUpdates([
          {
            memberId: input.payer,
            delta: -input.amount,
            reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER,
            referenceId: transaction.id,
          },
          {
            memberId: this.clearingAccountId,
            delta: input.amount,
            reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE,
            referenceId: transaction.id,
          },
        ]);

        transaction.status = FederationTxStatus.SOURCE_CONFIRMED;
        transaction.sourceConfirmedAt = now();
        transaction.sourceLegTxId = transaction.id;
      } catch (error) {
        transaction.status = FederationTxStatus.FAILED;
        transaction.failureReason = error instanceof Error ? error.message : 'Unknown error';
        await this.storage.saveFederationTransaction(transaction);
        throw new FederationValidationError({
          code: FederationErrorCode.LEDGER_ERROR,
          message: `Source leg failed: ${transaction.failureReason}`,
        });
      }

      // Update federation position (outgoing increases)
      this.state.federationPosition += input.amount;

      // Update bilateral position
      const linkIndex = this.state.connectedCells.findIndex(
        c => c.remoteCellId === input.targetCell
      );
      if (linkIndex >= 0) {
        this.state.connectedCells[linkIndex].bilateralPosition += input.amount;
        this.state.connectedCells[linkIndex].lastActivity = now();
      }

      // For this implementation, we'll mock the target confirmation
      // In a real system, this would involve network communication
      transaction.status = FederationTxStatus.COMPLETED;
      transaction.targetConfirmedAt = now();
      transaction.completedAt = now();
    }

    await this.storage.saveFederationTransaction(transaction);
    await this.saveState();

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'FEDERATION_TX_COMPLETED',
      timestamp: now(),
      data: {
        transactionId: transaction.id,
        amount: input.amount,
        direction: isSource ? 'OUTGOING' : 'INCOMING',
        newPosition: this.state.federationPosition,
      },
    });

    // Check if we're near cap
    const analysis = this.analyzeExposure();

    return {
      transaction,
      newPosition: this.state.federationPosition,
      remainingCapacity: this.getAvailableCapacity(),
      nearCap: analysis.atWarning || analysis.atCritical,
    };
  }

  async getTransaction(id: FederationTxId): Promise<FederationTransaction | undefined> {
    const result = await this.storage.getFederationTransaction(id);
    if (!result.ok || !result.value) return undefined;
    return result.value;
  }

  async getTransactions(filter?: {
    remoteCellId?: CellId;
    status?: FederationTxStatus;
    since?: Timestamp;
  }): Promise<FederationTransaction[]> {
    const result = await this.storage.getFederationTransactions({
      cellId: this.cellId,
      ...filter,
    });
    if (!result.ok) return [];
    return result.value;
  }

  async rollbackTransaction(id: FederationTxId, reason: string): Promise<void> {
    const transaction = await this.getTransaction(id);
    if (!transaction) {
      throw new FederationValidationError({
        code: FederationErrorCode.TRANSACTION_NOT_FOUND,
        message: `Transaction ${id} not found`,
      });
    }

    if (transaction.status === FederationTxStatus.COMPLETED) {
      throw new FederationValidationError({
        code: FederationErrorCode.INVALID_TX_STATE,
        message: 'Cannot rollback completed transaction',
      });
    }

    if (transaction.status === FederationTxStatus.ROLLED_BACK) {
      return; // Already rolled back
    }

    // Reverse the source leg if it was executed
    if (transaction.sourceConfirmedAt && transaction.sourceCell === this.cellId) {
      await this.ledger.applyBalanceUpdates([
        {
          memberId: transaction.payer,
          delta: transaction.amount,
          reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE,
          referenceId: `rollback-${transaction.id}`,
        },
        {
          memberId: this.clearingAccountId,
          delta: -transaction.amount,
          reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER,
          referenceId: `rollback-${transaction.id}`,
        },
      ]);

      // Reverse position change
      this.state.federationPosition -= transaction.amount;

      // Reverse bilateral position
      const linkIndex = this.state.connectedCells.findIndex(
        c => c.remoteCellId === transaction.targetCell
      );
      if (linkIndex >= 0) {
        this.state.connectedCells[linkIndex].bilateralPosition -= transaction.amount;
      }
    }

    transaction.status = FederationTxStatus.ROLLED_BACK;
    transaction.failureReason = reason;
    transaction.completedAt = now();

    await this.storage.saveFederationTransaction(transaction);
    await this.saveState();

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'FEDERATION_TX_ROLLED_BACK',
      timestamp: now(),
      data: { transactionId: id, reason },
    });
  }

  // ============================================
  // QUARANTINE
  // ============================================

  checkQuarantineStatus(): QuarantineStatus {
    const positionExceedsCap = Math.abs(this.state.federationPosition) > this.state.exposureCap;
    const inPanic = this.emergency?.isFederationFrozen() ?? false;

    if (this.state.status === FederationStatus.QUARANTINED) {
      return {
        isQuarantined: true,
        reason: this.state.quarantineReason,
        since: this.state.quarantinedAt,
        violatingPosition: positionExceedsCap ? this.state.federationPosition : undefined,
        exceededCap: positionExceedsCap ? this.state.exposureCap : undefined,
        resolutionSteps: this.getResolutionSteps(),
      };
    }

    // Check if should be quarantined
    if (positionExceedsCap) {
      return {
        isQuarantined: false,
        reason: QuarantineReason.CAP_VIOLATION,
        violatingPosition: this.state.federationPosition,
        exceededCap: this.state.exposureCap,
        resolutionSteps: ['Reduce federation position below cap', 'Wait for cap to increase'],
      };
    }

    if (inPanic) {
      return {
        isQuarantined: false,
        reason: QuarantineReason.PANIC_MODE,
        resolutionSteps: ['Wait for de-escalation from PANIC state'],
      };
    }

    return { isQuarantined: false };
  }

  private getResolutionSteps(): string[] {
    switch (this.state.quarantineReason) {
      case QuarantineReason.CAP_VIOLATION:
        return [
          'Reduce federation position by settling with connected cells',
          'Increase aggregate capacity (more members or higher limits)',
        ];
      case QuarantineReason.PANIC_MODE:
        return ['Wait for emergency state to de-escalate from PANIC'];
      case QuarantineReason.MANUAL_SUSPENSION:
        return ['Request governance review', 'Address suspension reason'];
      default:
        return [];
    }
  }

  async enterQuarantine(reason: QuarantineReason): Promise<void> {
    this.state.status = FederationStatus.QUARANTINED;
    this.state.quarantineReason = reason;
    this.state.quarantinedAt = now();

    await this.saveState();

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'FEDERATION_QUARANTINED',
      timestamp: now(),
      data: { reason },
    });
  }

  async exitQuarantine(): Promise<void> {
    // Check if conditions are met
    const status = this.checkQuarantineStatus();

    if (status.reason === QuarantineReason.CAP_VIOLATION) {
      if (Math.abs(this.state.federationPosition) > this.state.exposureCap) {
        throw new FederationValidationError({
          code: FederationErrorCode.CAP_EXCEEDED,
          message: 'Cannot exit quarantine: position still exceeds cap',
        });
      }
    }

    if (status.reason === QuarantineReason.PANIC_MODE) {
      if (this.emergency?.isFederationFrozen()) {
        throw new FederationValidationError({
          code: FederationErrorCode.FEDERATION_FROZEN,
          message: 'Cannot exit quarantine: still in PANIC mode',
        });
      }
    }

    this.state.status = FederationStatus.ACTIVE;
    this.state.quarantineReason = undefined;
    this.state.quarantinedAt = undefined;

    await this.saveState();

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'FEDERATION_QUARANTINE_EXIT',
      timestamp: now(),
      data: {},
    });
  }

  // ============================================
  // EXPOSURE MANAGEMENT
  // ============================================

  async setExposureCapFactor(betaFactor: number): Promise<void> {
    if (betaFactor < 0 || betaFactor > 1) {
      throw new FederationValidationError({
        code: FederationErrorCode.INVALID_AMOUNT,
        message: 'Beta factor must be between 0 and 1',
      });
    }

    this.state.betaFactor = betaFactor;
    await this.recalculateExposureCap();

    // Check if we need to enter quarantine
    if (Math.abs(this.state.federationPosition) > this.state.exposureCap) {
      if (this.state.status !== FederationStatus.QUARANTINED) {
        await this.enterQuarantine(QuarantineReason.CAP_VIOLATION);
      }
    }

    // If beta is 0, enter quarantine for PANIC mode
    if (betaFactor === 0 && this.state.status !== FederationStatus.QUARANTINED) {
      await this.enterQuarantine(QuarantineReason.PANIC_MODE);
    }

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'EXPOSURE_CAP_UPDATED',
      timestamp: now(),
      data: { betaFactor, newCap: this.state.exposureCap },
    });
  }

  /**
   * Recalculate exposure cap based on current ledger aggregate capacity.
   * Call this after adding/removing members to update the cap.
   */
  async recalculateExposureCap(): Promise<void> {
    const stats = this.ledger.getStatistics();
    const aggregateCapacity = stats.aggregateCapacity;

    let cap = Math.floor(aggregateCapacity * this.state.betaFactor);

    // Apply min/max bounds
    cap = Math.max(this.parameters.minExposureCap, cap);
    cap = Math.min(this.parameters.maxExposureCap, cap);

    this.state.exposureCap = cap;
    this.state.updatedAt = now();

    await this.saveState();
  }

  analyzeExposure(): ExposureAnalysis {
    const position = Math.abs(this.state.federationPosition);
    const cap = this.state.exposureCap;
    const availableCapacity = Math.max(0, cap - position);
    const utilization = cap > 0 ? position / cap : 0;

    return {
      position: this.state.federationPosition,
      cap,
      availableCapacity,
      utilization,
      atWarning: utilization >= this.parameters.warningThreshold,
      atCritical: utilization >= this.parameters.criticalThreshold,
      capExceeded: position > cap,
    };
  }

  // ============================================
  // PERSISTENCE
  // ============================================

  private async saveState(): Promise<void> {
    const result = await this.storage.saveFederationState(this.state);
    if (!result.ok) {
      throw new FederationValidationError({
        code: FederationErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }
  }

  async loadState(): Promise<void> {
    const result = await this.storage.getFederationState(this.cellId);
    if (result.ok && result.value) {
      this.state = result.value;
    }
  }
}

// ============================================
// CUSTOM ERROR CLASS
// ============================================

export class FederationValidationError extends Error {
  public readonly code: FederationErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(error: FederationError) {
    super(error.message);
    this.name = 'FederationValidationError';
    this.code = error.code;
    this.details = error.details;
  }

  toJSON(): FederationError {
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
 * Create a new federation engine
 */
export async function createFederationEngine(
  cellId: CellId,
  ledger: LedgerEngine,
  storage: IStorage,
  parameters: Partial<FederationParameters> = {}
): Promise<FederationEngine> {
  const engine = new FederationEngine(cellId, ledger, storage, parameters);
  await engine.initialize();
  return engine;
}
