/**
 * Cell Protocol - Governance Engine
 *
 * Implementation of the Governance System (PRD-05).
 * Manages councils, proposals, voting, and disputes.
 */

import {
  IdentityId,
  CellId,
  Timestamp,
  Units,
  MembershipStatus,
  now,
  generateId,
} from '../types/common';
import { AdmissionInfo } from '../types/identity';
import {
  ProposalId,
  DisputeId,
  ProposalType,
  ProposalStatus,
  ActionCategory,
  DisputeType,
  DisputeStatus,
  GovernanceCouncil,
  CouncilMember,
  QuorumRules,
  TermPolicy,
  Proposal,
  ProposalPayload,
  Vote,
  Dispute,
  Evidence,
  DisputeResolution,
  CreateProposalInput,
  FileDisputeInput,
  GovernanceError,
  GovernanceErrorCode,
  IGovernanceEngine,
} from '../types/governance';
import { LedgerEngine } from './ledger-engine';
import { IdentityEngine } from './identity-engine';
import { CommitmentEngine } from './commitment-engine';
import { IStorage } from '../storage/pouchdb-adapter';

// ============================================
// GOVERNANCE ENGINE IMPLEMENTATION
// ============================================

export class GovernanceEngine implements IGovernanceEngine {
  private cellId: CellId;
  private ledger: LedgerEngine;
  private identity: IdentityEngine;
  private commitments: CommitmentEngine;
  private storage: IStorage;

  constructor(
    cellId: CellId,
    ledger: LedgerEngine,
    identity: IdentityEngine,
    commitments: CommitmentEngine,
    storage: IStorage
  ) {
    this.cellId = cellId;
    this.ledger = ledger;
    this.identity = identity;
    this.commitments = commitments;
    this.storage = storage;
  }

  // ============================================
  // COUNCIL MANAGEMENT
  // ============================================

  async getCouncil(): Promise<GovernanceCouncil | undefined> {
    const result = await this.storage.getCouncil(this.cellId);
    if (!result.ok) return undefined;
    return result.value ?? undefined;
  }

  async isCouncilMember(memberId: IdentityId): Promise<boolean> {
    const council = await this.getCouncil();
    if (!council) return false;
    return council.members.some(m => m.memberId === memberId);
  }

  async initializeCouncil(members: CouncilMember[]): Promise<GovernanceCouncil> {
    const council: GovernanceCouncil = {
      cellId: this.cellId,
      members,
      quorumRules: {
        standardQuorum: 0.5,
        supermajorityThreshold: 0.67,
        minimumVotes: 1,
      },
      termPolicy: {
        termDurationDays: 90,
        maxConsecutiveTerms: 3,
        minCouncilSize: 1,
        maxCouncilSize: 9,
      },
      createdAt: now(),
      updatedAt: now(),
    };

    const result = await this.storage.saveCouncil(council);
    if (!result.ok) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'COUNCIL_INITIALIZED',
      timestamp: now(),
      data: { memberIds: members.map(m => m.memberId) },
    });

    return council;
  }

  // ============================================
  // PROPOSALS
  // ============================================

  async createProposal(input: CreateProposalInput): Promise<Proposal> {
    // Validate proposer is council member
    const isCouncil = await this.isCouncilMember(input.proposer);
    if (!isCouncil) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.NOT_COUNCIL_MEMBER,
        message: `${input.proposer} is not a council member`,
      });
    }

    const votingDurationHours = input.votingDurationHours ?? 72; // Default 3 days
    const closesAt = now() + (votingDurationHours * 60 * 60 * 1000);

    const proposal: Proposal = {
      id: generateId(),
      type: input.type,
      status: ProposalStatus.OPEN,
      proposer: input.proposer,
      payload: input.payload,
      votes: [],
      createdAt: now(),
      closesAt,
      description: input.description,
    };

    const result = await this.storage.saveProposal(proposal);
    if (!result.ok) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'PROPOSAL_CREATED',
      timestamp: now(),
      data: {
        proposalId: proposal.id,
        type: proposal.type,
        proposer: proposal.proposer,
      },
    });

    return proposal;
  }

  async castVote(proposalId: ProposalId, vote: Omit<Vote, 'proposalId'>): Promise<Proposal> {
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.PROPOSAL_NOT_FOUND,
        message: `Proposal ${proposalId} not found`,
      });
    }

    if (proposal.status !== ProposalStatus.OPEN) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.VOTING_CLOSED,
        message: `Voting is closed for proposal ${proposalId}`,
      });
    }

    // Verify voter is council member
    const isCouncil = await this.isCouncilMember(vote.voterId);
    if (!isCouncil) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.NOT_COUNCIL_MEMBER,
        message: `${vote.voterId} is not a council member`,
      });
    }

    // Check if already voted
    if (proposal.votes.some(v => v.voterId === vote.voterId)) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.ALREADY_VOTED,
        message: `${vote.voterId} has already voted`,
      });
    }

    const fullVote: Vote = {
      ...vote,
      proposalId,
    };

    proposal.votes.push(fullVote);

    await this.storage.saveProposal(proposal);

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'VOTE_CAST',
      timestamp: now(),
      data: {
        proposalId,
        voterId: vote.voterId,
        decision: vote.decision,
      },
    });

    return proposal;
  }

  async closeVoting(proposalId: ProposalId): Promise<Proposal> {
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.PROPOSAL_NOT_FOUND,
        message: `Proposal ${proposalId} not found`,
      });
    }

    if (proposal.status !== ProposalStatus.OPEN) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.INVALID_STATUS_TRANSITION,
        message: `Cannot close voting for proposal in status ${proposal.status}`,
      });
    }

    const council = await this.getCouncil();
    if (!council) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.COUNCIL_NOT_FOUND,
        message: 'Council not found',
      });
    }

    // Calculate outcome
    const outcome = this.calculateOutcome(proposal, council);

    proposal.status = outcome;

    await this.storage.saveProposal(proposal);

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'VOTING_CLOSED',
      timestamp: now(),
      data: {
        proposalId,
        outcome,
      },
    });

    return proposal;
  }

  private calculateOutcome(proposal: Proposal, council: GovernanceCouncil): ProposalStatus {
    const category = this.getActionCategory(proposal.type);
    const threshold = category === ActionCategory.CRITICAL || category === ActionCategory.CONSTITUTIONAL
      ? council.quorumRules.supermajorityThreshold
      : 0.5;
    const quorum = council.quorumRules.standardQuorum;

    const approvals = proposal.votes.filter(v => v.decision === 'APPROVE').length;
    const rejections = proposal.votes.filter(v => v.decision === 'REJECT').length;
    const totalVotes = approvals + rejections;
    const participation = totalVotes / council.members.length;

    if (participation < quorum) {
      return ProposalStatus.REJECTED; // No quorum
    }

    if (totalVotes === 0) {
      return ProposalStatus.REJECTED;
    }

    const approvalRate = approvals / totalVotes;
    if (approvalRate >= threshold) {
      return ProposalStatus.PASSED;
    }

    return ProposalStatus.REJECTED;
  }

  async executeProposal(proposalId: ProposalId): Promise<void> {
    const proposal = await this.getProposal(proposalId);
    if (!proposal) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.PROPOSAL_NOT_FOUND,
        message: `Proposal ${proposalId} not found`,
      });
    }

    if (proposal.status !== ProposalStatus.PASSED) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.PROPOSAL_NOT_PASSED,
        message: `Proposal ${proposalId} has not passed`,
      });
    }

    // Execute based on type
    switch (proposal.payload.type) {
      case ProposalType.MEMBER_ADMISSION:
        await this.identity.addMember(proposal.payload.admission);
        break;

      case ProposalType.MEMBER_EXCLUSION:
        await this.identity.removeMember(
          proposal.payload.memberId,
          proposal.payload.reason,
          proposal.proposer
        );
        break;

      case ProposalType.LIMIT_ADJUSTMENT:
        await this.ledger.updateMemberLimit(
          proposal.payload.memberId,
          proposal.payload.newLimit
        );
        break;

      case ProposalType.COMMITMENT_CANCELLATION:
        await this.commitments.cancelCommitment(
          proposal.payload.commitmentId,
          proposal.payload.reason,
          proposal.proposer
        );
        break;

      case ProposalType.DISPUTE_RESOLUTION:
        await this.resolveDispute(
          proposal.payload.disputeId,
          proposal.payload.resolution
        );
        break;

      default:
        // Other types not yet implemented
        break;
    }

    proposal.status = ProposalStatus.EXECUTED;
    proposal.executedAt = now();

    await this.storage.saveProposal(proposal);

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'PROPOSAL_EXECUTED',
      timestamp: now(),
      data: { proposalId },
    });
  }

  async getProposal(id: ProposalId): Promise<Proposal | undefined> {
    const result = await this.storage.getProposal(id);
    if (!result.ok) return undefined;
    return result.value ?? undefined;
  }

  async getActiveProposals(): Promise<Proposal[]> {
    const result = await this.storage.getProposalsByStatus(ProposalStatus.OPEN);
    if (!result.ok) return [];
    return result.value;
  }

  // ============================================
  // DIRECT ACTIONS (COUNCIL)
  // ============================================

  async admitMember(admission: AdmissionInfo, approverId: IdentityId): Promise<void> {
    const isCouncil = await this.isCouncilMember(approverId);
    if (!isCouncil) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.NOT_COUNCIL_MEMBER,
        message: `${approverId} is not a council member`,
      });
    }

    await this.identity.addMember(admission);

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'MEMBER_ADMITTED_DIRECT',
      timestamp: now(),
      data: {
        memberId: admission.applicantId,
        approverId,
      },
    });
  }

  async excludeMember(memberId: IdentityId, reason: string, approverId: IdentityId): Promise<void> {
    const isCouncil = await this.isCouncilMember(approverId);
    if (!isCouncil) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.NOT_COUNCIL_MEMBER,
        message: `${approverId} is not a council member`,
      });
    }

    // Check member balance
    const memberState = this.ledger.getMemberState(memberId);
    if (memberState && memberState.balance !== 0) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.NON_ZERO_BALANCE,
        message: `Cannot exclude member with non-zero balance: ${memberState.balance}`,
      });
    }

    // Check for active commitments
    const commitments = await this.commitments.getCommitmentsByMember(memberId);
    const activeCommitments = commitments.filter(c =>
      c.status === 'ACTIVE' || c.status === 'PROPOSED'
    );
    if (activeCommitments.length > 0) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.ACTIVE_COMMITMENTS,
        message: `Member has ${activeCommitments.length} active commitments`,
      });
    }

    await this.identity.removeMember(memberId, reason, approverId);

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'MEMBER_EXCLUDED_DIRECT',
      timestamp: now(),
      data: { memberId, reason, approverId },
    });
  }

  async adjustLimit(memberId: IdentityId, newLimit: Units, approverId: IdentityId): Promise<void> {
    const isCouncil = await this.isCouncilMember(approverId);
    if (!isCouncil) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.NOT_COUNCIL_MEMBER,
        message: `${approverId} is not a council member`,
      });
    }

    const params = this.ledger.getParameters();
    if (newLimit < params.minLimit || newLimit > params.maxLimit) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.INVALID_LIMIT,
        message: `Limit ${newLimit} out of range [${params.minLimit}, ${params.maxLimit}]`,
      });
    }

    await this.ledger.updateMemberLimit(memberId, newLimit);

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'LIMIT_ADJUSTED_DIRECT',
      timestamp: now(),
      data: { memberId, newLimit, approverId },
    });
  }

  // ============================================
  // DISPUTES
  // ============================================

  async fileDispute(input: FileDisputeInput): Promise<Dispute> {
    // Validate complainant
    const complainantState = this.ledger.getMemberState(input.complainant);
    if (!complainantState || complainantState.status !== MembershipStatus.ACTIVE) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.UNAUTHORIZED,
        message: `Complainant ${input.complainant} is not an active member`,
      });
    }

    // Validate respondent
    const respondentState = this.ledger.getMemberState(input.respondent);
    if (!respondentState) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.UNAUTHORIZED,
        message: `Respondent ${input.respondent} not found`,
      });
    }

    const evidence: Evidence[] = (input.evidence ?? []).map(e => ({
      ...e,
      id: generateId(),
      timestamp: now(),
    }));

    const dispute: Dispute = {
      id: generateId(),
      type: input.type,
      status: DisputeStatus.FILED,
      complainant: input.complainant,
      respondent: input.respondent,
      commitmentId: input.commitmentId,
      description: input.description,
      evidence,
      filedAt: now(),
    };

    const result = await this.storage.saveDispute(dispute);
    if (!result.ok) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'DISPUTE_FILED',
      timestamp: now(),
      data: {
        disputeId: dispute.id,
        complainant: dispute.complainant,
        respondent: dispute.respondent,
        type: dispute.type,
      },
    });

    return dispute;
  }

  async assignDisputeReviewer(disputeId: DisputeId, reviewerId: IdentityId): Promise<Dispute> {
    const dispute = await this.getDispute(disputeId);
    if (!dispute) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.DISPUTE_NOT_FOUND,
        message: `Dispute ${disputeId} not found`,
      });
    }

    // Reviewer must be council member
    const isCouncil = await this.isCouncilMember(reviewerId);
    if (!isCouncil) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.NOT_COUNCIL_MEMBER,
        message: `${reviewerId} is not a council member`,
      });
    }

    // Reviewer cannot be a party to the dispute
    if (reviewerId === dispute.complainant || reviewerId === dispute.respondent) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.UNAUTHORIZED,
        message: 'Reviewer cannot be a party to the dispute',
      });
    }

    dispute.reviewer = reviewerId;
    dispute.status = DisputeStatus.UNDER_REVIEW;

    await this.storage.saveDispute(dispute);

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'DISPUTE_REVIEWER_ASSIGNED',
      timestamp: now(),
      data: { disputeId, reviewerId },
    });

    return dispute;
  }

  async addEvidence(disputeId: DisputeId, evidence: Omit<Evidence, 'id' | 'timestamp'>): Promise<Dispute> {
    const dispute = await this.getDispute(disputeId);
    if (!dispute) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.DISPUTE_NOT_FOUND,
        message: `Dispute ${disputeId} not found`,
      });
    }

    // Must be open dispute
    if (dispute.status === DisputeStatus.RESOLVED || dispute.status === DisputeStatus.CLOSED) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.INVALID_STATUS_TRANSITION,
        message: 'Cannot add evidence to resolved dispute',
      });
    }

    // Must be a party to the dispute
    if (evidence.submittedBy !== dispute.complainant &&
        evidence.submittedBy !== dispute.respondent &&
        evidence.submittedBy !== dispute.reviewer) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.UNAUTHORIZED,
        message: 'Only parties to the dispute can add evidence',
      });
    }

    const fullEvidence: Evidence = {
      ...evidence,
      id: generateId(),
      timestamp: now(),
    };

    dispute.evidence.push(fullEvidence);

    await this.storage.saveDispute(dispute);

    return dispute;
  }

  async resolveDispute(disputeId: DisputeId, resolution: DisputeResolution): Promise<Dispute> {
    const dispute = await this.getDispute(disputeId);
    if (!dispute) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.DISPUTE_NOT_FOUND,
        message: `Dispute ${disputeId} not found`,
      });
    }

    // Resolver must be council member
    const isCouncil = await this.isCouncilMember(resolution.decidedBy);
    if (!isCouncil) {
      throw new GovernanceValidationError({
        code: GovernanceErrorCode.NOT_COUNCIL_MEMBER,
        message: `${resolution.decidedBy} is not a council member`,
      });
    }

    dispute.resolution = resolution;
    dispute.status = DisputeStatus.RESOLVED;
    dispute.resolvedAt = now();

    // Execute resolution actions if any
    if (resolution.actions) {
      for (const action of resolution.actions) {
        switch (action.type) {
          case 'CANCEL_COMMITMENT':
            if (dispute.commitmentId) {
              // Use complainant as initiator since they are a party to the commitment
              // and the governance resolution authorizes the cancellation
              await this.commitments.cancelCommitment(
                dispute.commitmentId,
                resolution.explanation,
                dispute.complainant
              );
            }
            break;
          case 'COMPENSATION':
            // Would need to execute a transaction
            break;
          // Other actions...
        }
      }
    }

    await this.storage.saveDispute(dispute);

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'DISPUTE_RESOLVED',
      timestamp: now(),
      data: {
        disputeId,
        outcome: resolution.outcome,
        decidedBy: resolution.decidedBy,
      },
    });

    return dispute;
  }

  async getDispute(id: DisputeId): Promise<Dispute | undefined> {
    const result = await this.storage.getDispute(id);
    if (!result.ok) return undefined;
    return result.value ?? undefined;
  }

  async getActiveDisputes(): Promise<Dispute[]> {
    const statuses = [DisputeStatus.FILED, DisputeStatus.UNDER_REVIEW, DisputeStatus.HEARING_SCHEDULED];
    const results = await Promise.all(statuses.map(s => this.storage.getDisputesByStatus(s)));
    const disputes: Dispute[] = [];
    for (const result of results) {
      if (result.ok) {
        disputes.push(...result.value);
      }
    }
    return disputes;
  }

  // ============================================
  // AUTHORIZATION
  // ============================================

  async checkActionPermission(action: ProposalType, actorId: IdentityId): Promise<boolean> {
    return this.isCouncilMember(actorId);
  }

  getActionCategory(action: ProposalType): ActionCategory {
    switch (action) {
      case ProposalType.MEMBER_EXCLUSION:
      case ProposalType.EMERGENCY_STATE:
      case ProposalType.PARAMETER_CHANGE:
        return ActionCategory.CRITICAL;

      case ProposalType.COUNCIL_ELECTION:
        return ActionCategory.CONSTITUTIONAL;

      case ProposalType.MEMBER_ADMISSION:
      case ProposalType.LIMIT_ADJUSTMENT:
        return ActionCategory.SIGNIFICANT;

      default:
        return ActionCategory.ROUTINE;
    }
  }
}

// ============================================
// CUSTOM ERROR CLASS
// ============================================

export class GovernanceValidationError extends Error {
  public readonly code: GovernanceErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(error: GovernanceError) {
    super(error.message);
    this.name = 'GovernanceValidationError';
    this.code = error.code;
    this.details = error.details;
  }

  toJSON(): GovernanceError {
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
 * Create a new governance engine
 */
export function createGovernanceEngine(
  cellId: CellId,
  ledger: LedgerEngine,
  identity: IdentityEngine,
  commitments: CommitmentEngine,
  storage: IStorage
): GovernanceEngine {
  return new GovernanceEngine(cellId, ledger, identity, commitments, storage);
}
