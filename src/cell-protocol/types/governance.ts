/**
 * Cell Protocol - Governance Types
 *
 * Type definitions for the Governance System (PRD-05).
 * Defines councils, proposals, votes, and disputes.
 */

import {
  IdentityId,
  CellId,
  Timestamp,
  Units,
  Signature,
} from './common';
import { AdmissionInfo } from './identity';
import { CommitmentId } from './commitment';

// ============================================
// TYPE ALIASES
// ============================================

/** Unique identifier for a proposal */
export type ProposalId = string;

/** Unique identifier for a dispute */
export type DisputeId = string;

// ============================================
// ENUMS
// ============================================

/** Type of proposal */
export enum ProposalType {
  /** Admit a new member */
  MEMBER_ADMISSION = 'MEMBER_ADMISSION',
  /** Exclude an existing member */
  MEMBER_EXCLUSION = 'MEMBER_EXCLUSION',
  /** Adjust a member's credit limit */
  LIMIT_ADJUSTMENT = 'LIMIT_ADJUSTMENT',
  /** Cancel a disputed commitment */
  COMMITMENT_CANCELLATION = 'COMMITMENT_CANCELLATION',
  /** Resolve a dispute */
  DISPUTE_RESOLUTION = 'DISPUTE_RESOLUTION',
  /** Change system parameters */
  PARAMETER_CHANGE = 'PARAMETER_CHANGE',
  /** Declare emergency state */
  EMERGENCY_STATE = 'EMERGENCY_STATE',
  /** Elect council members */
  COUNCIL_ELECTION = 'COUNCIL_ELECTION',
}

/** Status of a proposal */
export enum ProposalStatus {
  /** Proposal created but not yet open */
  DRAFT = 'DRAFT',
  /** Voting is open */
  OPEN = 'OPEN',
  /** Voting is closed, awaiting tally */
  CLOSED = 'CLOSED',
  /** Proposal passed */
  PASSED = 'PASSED',
  /** Proposal rejected */
  REJECTED = 'REJECTED',
  /** Proposal executed */
  EXECUTED = 'EXECUTED',
  /** Proposal expired without resolution */
  EXPIRED = 'EXPIRED',
}

/** Category of action (determines voting threshold) */
export enum ActionCategory {
  /** Routine actions - 50% quorum */
  ROUTINE = 'ROUTINE',
  /** Significant actions - 50% quorum */
  SIGNIFICANT = 'SIGNIFICANT',
  /** Critical actions - 67% supermajority */
  CRITICAL = 'CRITICAL',
  /** Constitutional actions - 67% + member vote */
  CONSTITUTIONAL = 'CONSTITUTIONAL',
}

/** Type of dispute */
export enum DisputeType {
  /** Service not delivered */
  NON_DELIVERY = 'NON_DELIVERY',
  /** Quality issues */
  QUALITY = 'QUALITY',
  /** Fraudulent behavior */
  FRAUD = 'FRAUD',
  /** Identity issues */
  IDENTITY = 'IDENTITY',
  /** Other disputes */
  OTHER = 'OTHER',
}

/** Status of a dispute */
export enum DisputeStatus {
  /** Dispute filed */
  FILED = 'FILED',
  /** Under council review */
  UNDER_REVIEW = 'UNDER_REVIEW',
  /** Hearing scheduled */
  HEARING_SCHEDULED = 'HEARING_SCHEDULED',
  /** Dispute resolved */
  RESOLVED = 'RESOLVED',
  /** Escalated to higher authority */
  ESCALATED = 'ESCALATED',
  /** Dispute closed */
  CLOSED = 'CLOSED',
}

/** Vote decision */
export type VoteDecision = 'APPROVE' | 'REJECT' | 'ABSTAIN';

// ============================================
// COUNCIL TYPES
// ============================================

/** A council member */
export interface CouncilMember {
  /** Member identity ID */
  memberId: IdentityId;

  /** Role on the council */
  role: 'CHAIR' | 'MEMBER';

  /** When term started */
  termStart: Timestamp;

  /** When term ends */
  termEnd: Timestamp;
}

/** Rules for quorum calculation */
export interface QuorumRules {
  /** Standard quorum (percentage of council) */
  standardQuorum: number;

  /** Supermajority threshold */
  supermajorityThreshold: number;

  /** Minimum votes required */
  minimumVotes: number;
}

/** Policy for council terms */
export interface TermPolicy {
  /** Term duration in days */
  termDurationDays: number;

  /** Maximum consecutive terms */
  maxConsecutiveTerms: number;

  /** Minimum members on council */
  minCouncilSize: number;

  /** Maximum members on council */
  maxCouncilSize: number;
}

/** Governance council for a cell */
export interface GovernanceCouncil {
  /** Cell this council governs */
  cellId: CellId;

  /** Council members */
  members: CouncilMember[];

  /** Quorum rules */
  quorumRules: QuorumRules;

  /** Term policy */
  termPolicy: TermPolicy;

  /** When council was formed */
  createdAt: Timestamp;

  /** When council was last updated */
  updatedAt: Timestamp;
}

// ============================================
// PROPOSAL TYPES
// ============================================

/** Payload types for different proposals */
export type ProposalPayload =
  | { type: ProposalType.MEMBER_ADMISSION; admission: AdmissionInfo }
  | { type: ProposalType.MEMBER_EXCLUSION; memberId: IdentityId; reason: string }
  | { type: ProposalType.LIMIT_ADJUSTMENT; memberId: IdentityId; newLimit: Units; reason: string }
  | { type: ProposalType.COMMITMENT_CANCELLATION; commitmentId: CommitmentId; reason: string }
  | { type: ProposalType.DISPUTE_RESOLUTION; disputeId: DisputeId; resolution: DisputeResolution }
  | { type: ProposalType.PARAMETER_CHANGE; parameter: string; newValue: unknown; reason: string }
  | { type: ProposalType.EMERGENCY_STATE; active: boolean; reason: string }
  | { type: ProposalType.COUNCIL_ELECTION; nominees: IdentityId[] };

/** A vote on a proposal */
export interface Vote {
  /** Proposal being voted on */
  proposalId: ProposalId;

  /** Voter identity */
  voterId: IdentityId;

  /** Vote decision */
  decision: VoteDecision;

  /** Optional reason for vote */
  reason?: string;

  /** Voter's signature */
  signature: Signature;

  /** When vote was cast */
  timestamp: Timestamp;
}

/** A governance proposal */
export interface Proposal {
  /** Unique proposal identifier */
  id: ProposalId;

  /** Type of proposal */
  type: ProposalType;

  /** Current status */
  status: ProposalStatus;

  /** Who created the proposal */
  proposer: IdentityId;

  /** Proposal payload */
  payload: ProposalPayload;

  /** Votes cast */
  votes: Vote[];

  /** When proposal was created */
  createdAt: Timestamp;

  /** When voting closes */
  closesAt: Timestamp;

  /** When proposal was executed (if executed) */
  executedAt?: Timestamp;

  /** Description of the proposal */
  description?: string;
}

// ============================================
// DISPUTE TYPES
// ============================================

/** Evidence for a dispute */
export interface Evidence {
  /** Evidence identifier */
  id: string;

  /** Who submitted the evidence */
  submittedBy: IdentityId;

  /** Type of evidence */
  type: 'TEXT' | 'DOCUMENT' | 'TESTIMONY' | 'TRANSACTION_RECORD';

  /** Evidence content or reference */
  content: string;

  /** When submitted */
  timestamp: Timestamp;
}

/** Resolution of a dispute */
export interface DisputeResolution {
  /** How the dispute was resolved */
  outcome: 'COMPLAINANT_WINS' | 'RESPONDENT_WINS' | 'SETTLED' | 'DISMISSED';

  /** Compensation awarded (if any) */
  compensation?: Units;

  /** Explanation of decision */
  explanation: string;

  /** Who made the decision */
  decidedBy: IdentityId;

  /** When decision was made */
  decidedAt: Timestamp;

  /** Actions to be taken */
  actions?: DisputeAction[];
}

/** Action resulting from dispute */
export interface DisputeAction {
  type: 'CANCEL_COMMITMENT' | 'ADJUST_LIMIT' | 'FREEZE_MEMBER' | 'COMPENSATION';
  targetId: string;
  details: Record<string, unknown>;
}

/** A dispute between members */
export interface Dispute {
  /** Unique dispute identifier */
  id: DisputeId;

  /** Type of dispute */
  type: DisputeType;

  /** Current status */
  status: DisputeStatus;

  /** Who filed the complaint */
  complainant: IdentityId;

  /** Who the complaint is against */
  respondent: IdentityId;

  /** Related commitment (if any) */
  commitmentId?: CommitmentId;

  /** Description of the dispute */
  description: string;

  /** Evidence submitted */
  evidence: Evidence[];

  /** Assigned reviewer (council member) */
  reviewer?: IdentityId;

  /** Resolution (if resolved) */
  resolution?: DisputeResolution;

  /** When dispute was filed */
  filedAt: Timestamp;

  /** When dispute was resolved (if resolved) */
  resolvedAt?: Timestamp;
}

// ============================================
// INPUT TYPES
// ============================================

/** Input for creating a proposal */
export interface CreateProposalInput {
  /** Type of proposal */
  type: ProposalType;

  /** Who is creating the proposal */
  proposer: IdentityId;

  /** Proposal payload */
  payload: ProposalPayload;

  /** Voting duration in hours */
  votingDurationHours?: number;

  /** Description */
  description?: string;
}

/** Input for filing a dispute */
export interface FileDisputeInput {
  /** Type of dispute */
  type: DisputeType;

  /** Who is filing */
  complainant: IdentityId;

  /** Who complaint is against */
  respondent: IdentityId;

  /** Related commitment (if any) */
  commitmentId?: CommitmentId;

  /** Description of the issue */
  description: string;

  /** Initial evidence (optional) */
  evidence?: Omit<Evidence, 'id' | 'timestamp'>[];
}

// ============================================
// ERROR TYPES
// ============================================

/** Errors that can occur during governance operations */
export enum GovernanceErrorCode {
  /** Proposal not found */
  PROPOSAL_NOT_FOUND = 'PROPOSAL_NOT_FOUND',

  /** Dispute not found */
  DISPUTE_NOT_FOUND = 'DISPUTE_NOT_FOUND',

  /** Council not found */
  COUNCIL_NOT_FOUND = 'COUNCIL_NOT_FOUND',

  /** Not a council member */
  NOT_COUNCIL_MEMBER = 'NOT_COUNCIL_MEMBER',

  /** Already voted */
  ALREADY_VOTED = 'ALREADY_VOTED',

  /** Voting is closed */
  VOTING_CLOSED = 'VOTING_CLOSED',

  /** Proposal not passed */
  PROPOSAL_NOT_PASSED = 'PROPOSAL_NOT_PASSED',

  /** Proposal already executed */
  ALREADY_EXECUTED = 'ALREADY_EXECUTED',

  /** Invalid status transition */
  INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',

  /** Quorum not reached */
  QUORUM_NOT_REACHED = 'QUORUM_NOT_REACHED',

  /** Member has non-zero balance (for exclusion) */
  NON_ZERO_BALANCE = 'NON_ZERO_BALANCE',

  /** Member has active commitments (for exclusion) */
  ACTIVE_COMMITMENTS = 'ACTIVE_COMMITMENTS',

  /** Invalid limit value */
  INVALID_LIMIT = 'INVALID_LIMIT',

  /** Unauthorized action */
  UNAUTHORIZED = 'UNAUTHORIZED',

  /** Storage operation failed */
  STORAGE_ERROR = 'STORAGE_ERROR',
}

/** Detailed governance error */
export interface GovernanceError {
  code: GovernanceErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================
// INTERFACE
// ============================================

/** Interface for the Governance Engine */
export interface IGovernanceEngine {
  // Council
  /** Get the governance council */
  getCouncil(): Promise<GovernanceCouncil | undefined>;

  /** Check if a member is on the council */
  isCouncilMember(memberId: IdentityId): Promise<boolean>;

  /** Initialize or update the council */
  initializeCouncil(members: CouncilMember[]): Promise<GovernanceCouncil>;

  // Proposals
  /** Create a new proposal */
  createProposal(input: CreateProposalInput): Promise<Proposal>;

  /** Cast a vote on a proposal */
  castVote(proposalId: ProposalId, vote: Omit<Vote, 'proposalId'>): Promise<Proposal>;

  /** Close voting on a proposal */
  closeVoting(proposalId: ProposalId): Promise<Proposal>;

  /** Execute a passed proposal */
  executeProposal(proposalId: ProposalId): Promise<void>;

  /** Get a proposal by ID */
  getProposal(id: ProposalId): Promise<Proposal | undefined>;

  /** Get all active proposals */
  getActiveProposals(): Promise<Proposal[]>;

  // Direct actions (for council)
  /** Directly admit a member (council action) */
  admitMember(admission: AdmissionInfo, approverId: IdentityId): Promise<void>;

  /** Directly exclude a member (council action) */
  excludeMember(memberId: IdentityId, reason: string, approverId: IdentityId): Promise<void>;

  /** Directly adjust a member's limit (council action) */
  adjustLimit(memberId: IdentityId, newLimit: Units, approverId: IdentityId): Promise<void>;

  // Disputes
  /** File a new dispute */
  fileDispute(input: FileDisputeInput): Promise<Dispute>;

  /** Assign a reviewer to a dispute */
  assignDisputeReviewer(disputeId: DisputeId, reviewerId: IdentityId): Promise<Dispute>;

  /** Add evidence to a dispute */
  addEvidence(disputeId: DisputeId, evidence: Omit<Evidence, 'id' | 'timestamp'>): Promise<Dispute>;

  /** Resolve a dispute */
  resolveDispute(disputeId: DisputeId, resolution: DisputeResolution): Promise<Dispute>;

  /** Get a dispute by ID */
  getDispute(id: DisputeId): Promise<Dispute | undefined>;

  /** Get all active disputes */
  getActiveDisputes(): Promise<Dispute[]>;

  // Authorization
  /** Check if an actor has permission for an action */
  checkActionPermission(action: ProposalType, actorId: IdentityId): Promise<boolean>;

  /** Get action category for determining voting threshold */
  getActionCategory(action: ProposalType): ActionCategory;
}
