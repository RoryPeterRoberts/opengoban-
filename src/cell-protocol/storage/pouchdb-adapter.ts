/**
 * Cell Protocol - PouchDB Storage Adapter
 *
 * Provides offline-first persistence for cell protocol data.
 * Supports in-memory storage for testing.
 */

import { CellId, IdentityId, TransactionId, Timestamp, now, generateId } from '../types/common';
import { CellLedgerState, MemberState, LedgerParameters } from '../types/ledger';
import { SpotTransaction, QueuedTransaction, TransactionStatus } from '../types/transaction';
import { CellIdentity, MembershipChange } from '../types/identity';
import { Commitment, CommitmentId, CommitmentStatus, TaskCategory } from '../types/commitment';
import { Proposal, ProposalId, ProposalStatus, Dispute, DisputeId, DisputeStatus, GovernanceCouncil } from '../types/governance';
import { TaskSlot, TaskSlotId, TaskSlotStatus, TaskTemplate, TaskTemplateId, MemberSupply } from '../types/scheduler';
import { EmergencyState, StateHistoryEntry } from '../types/emergency';
import { FederationState, FederationTransaction, FederationTxId, FederationTxStatus, LinkProposal, LinkProposalId } from '../types/federation';
import { Result, ok, err } from '../utils/result';

// ============================================
// STORAGE TYPES
// ============================================

export interface StorageError {
  code: 'NOT_FOUND' | 'ALREADY_EXISTS' | 'WRITE_FAILED' | 'READ_FAILED' | 'DELETE_FAILED';
  message: string;
}

export interface StorageDocument<T> {
  _id: string;
  _rev?: string;
  type: string;
  data: T;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface EventLogEntry {
  id: string;
  cellId: CellId;
  type: string;
  timestamp: Timestamp;
  sequenceNumber: number;
  data: Record<string, unknown>;
}

// ============================================
// STORAGE INTERFACE
// ============================================

export interface IStorage {
  // Ledger operations
  saveLedgerState(state: CellLedgerState): Promise<Result<void, StorageError>>;
  getLedgerState(cellId: CellId): Promise<Result<CellLedgerState | null, StorageError>>;

  // Identity operations
  saveIdentity(identity: CellIdentity): Promise<Result<void, StorageError>>;
  getIdentity(id: IdentityId): Promise<Result<CellIdentity | null, StorageError>>;
  getIdentityByPublicKey(publicKey: string): Promise<Result<CellIdentity | null, StorageError>>;
  getAllIdentities(cellId: CellId): Promise<Result<CellIdentity[], StorageError>>;
  deleteIdentity(id: IdentityId): Promise<Result<void, StorageError>>;

  // Transaction operations
  saveTransaction(tx: SpotTransaction): Promise<Result<void, StorageError>>;
  getTransaction(id: TransactionId): Promise<Result<SpotTransaction | null, StorageError>>;
  getTransactionsByMember(
    memberId: IdentityId,
    limit?: number,
    offset?: number
  ): Promise<Result<SpotTransaction[], StorageError>>;

  // Offline queue operations
  queueTransaction(tx: QueuedTransaction): Promise<Result<void, StorageError>>;
  getQueuedTransactions(): Promise<Result<QueuedTransaction[], StorageError>>;
  removeFromQueue(txId: TransactionId): Promise<Result<void, StorageError>>;

  // Event log operations
  appendEvent(event: Omit<EventLogEntry, 'id' | 'sequenceNumber'>): Promise<Result<EventLogEntry, StorageError>>;
  getEvents(cellId: CellId, since?: number): Promise<Result<EventLogEntry[], StorageError>>;

  // Membership change log
  saveMembershipChange(change: MembershipChange): Promise<Result<void, StorageError>>;
  getMembershipChanges(memberId: IdentityId): Promise<Result<MembershipChange[], StorageError>>;

  // ============================================
  // PHASE 2: COMMITMENT OPERATIONS
  // ============================================

  saveCommitment(commitment: Commitment): Promise<Result<void, StorageError>>;
  getCommitment(id: CommitmentId): Promise<Result<Commitment | null, StorageError>>;
  getCommitmentsByMember(memberId: IdentityId): Promise<Result<Commitment[], StorageError>>;
  getCommitmentsByStatus(status: CommitmentStatus): Promise<Result<Commitment[], StorageError>>;
  getCommitmentsByCategory(category: TaskCategory): Promise<Result<Commitment[], StorageError>>;
  getAllCommitments(): Promise<Result<Commitment[], StorageError>>;

  // ============================================
  // PHASE 2: GOVERNANCE OPERATIONS
  // ============================================

  saveProposal(proposal: Proposal): Promise<Result<void, StorageError>>;
  getProposal(id: ProposalId): Promise<Result<Proposal | null, StorageError>>;
  getProposalsByStatus(status: ProposalStatus): Promise<Result<Proposal[], StorageError>>;
  getAllProposals(): Promise<Result<Proposal[], StorageError>>;

  saveDispute(dispute: Dispute): Promise<Result<void, StorageError>>;
  getDispute(id: DisputeId): Promise<Result<Dispute | null, StorageError>>;
  getDisputesByStatus(status: DisputeStatus): Promise<Result<Dispute[], StorageError>>;
  getAllDisputes(): Promise<Result<Dispute[], StorageError>>;

  saveCouncil(council: GovernanceCouncil): Promise<Result<void, StorageError>>;
  getCouncil(cellId: CellId): Promise<Result<GovernanceCouncil | null, StorageError>>;

  // ============================================
  // PHASE 2: SCHEDULER OPERATIONS
  // ============================================

  saveTaskSlot(slot: TaskSlot): Promise<Result<void, StorageError>>;
  getTaskSlot(id: TaskSlotId): Promise<Result<TaskSlot | null, StorageError>>;
  getTaskSlotsByPeriod(start: Timestamp, end: Timestamp): Promise<Result<TaskSlot[], StorageError>>;
  getTaskSlotsByStatus(status: TaskSlotStatus): Promise<Result<TaskSlot[], StorageError>>;
  getAllTaskSlots(): Promise<Result<TaskSlot[], StorageError>>;

  saveTaskTemplate(template: TaskTemplate): Promise<Result<void, StorageError>>;
  getTaskTemplate(id: TaskTemplateId): Promise<Result<TaskTemplate | null, StorageError>>;
  getAllTaskTemplates(): Promise<Result<TaskTemplate[], StorageError>>;

  saveMemberSupply(supply: MemberSupply): Promise<Result<void, StorageError>>;
  getMemberSupply(memberId: IdentityId): Promise<Result<MemberSupply | null, StorageError>>;
  getAllMemberSupplies(): Promise<Result<MemberSupply[], StorageError>>;

  // ============================================
  // PHASE 3: EMERGENCY OPERATIONS
  // ============================================

  saveEmergencyState(state: EmergencyState): Promise<Result<void, StorageError>>;
  getEmergencyState(cellId: CellId): Promise<Result<EmergencyState | null, StorageError>>;
  appendStateHistoryEntry(entry: StateHistoryEntry, cellId: CellId): Promise<Result<void, StorageError>>;
  getStateHistory(cellId: CellId, since: Timestamp): Promise<Result<StateHistoryEntry[], StorageError>>;

  // ============================================
  // PHASE 3: FEDERATION OPERATIONS
  // ============================================

  saveFederationState(state: FederationState): Promise<Result<void, StorageError>>;
  getFederationState(cellId: CellId): Promise<Result<FederationState | null, StorageError>>;
  saveFederationTransaction(tx: FederationTransaction): Promise<Result<void, StorageError>>;
  getFederationTransaction(id: FederationTxId): Promise<Result<FederationTransaction | null, StorageError>>;
  getFederationTransactions(filter: {
    cellId?: CellId;
    remoteCellId?: CellId;
    status?: FederationTxStatus;
    since?: Timestamp;
  }): Promise<Result<FederationTransaction[], StorageError>>;
  saveLinkProposal(proposal: LinkProposal): Promise<Result<void, StorageError>>;
  getLinkProposal(id: LinkProposalId): Promise<Result<LinkProposal | null, StorageError>>;
}

// ============================================
// IN-MEMORY STORAGE (for testing)
// ============================================

export class InMemoryStorage implements IStorage {
  private ledgerStates = new Map<CellId, CellLedgerState>();
  private identities = new Map<IdentityId, CellIdentity>();
  private identitiesByPublicKey = new Map<string, IdentityId>();
  private transactions = new Map<TransactionId, SpotTransaction>();
  private transactionsByMember = new Map<IdentityId, Set<TransactionId>>();
  private offlineQueue = new Map<TransactionId, QueuedTransaction>();
  private events: EventLogEntry[] = [];
  private eventSequence = 0;
  private membershipChanges = new Map<IdentityId, MembershipChange[]>();

  // Phase 2 storage
  private commitments = new Map<CommitmentId, Commitment>();
  private proposals = new Map<ProposalId, Proposal>();
  private disputes = new Map<DisputeId, Dispute>();
  private councils = new Map<CellId, GovernanceCouncil>();
  private taskSlots = new Map<TaskSlotId, TaskSlot>();
  private taskTemplates = new Map<TaskTemplateId, TaskTemplate>();
  private memberSupplies = new Map<IdentityId, MemberSupply>();

  // Phase 3 storage
  private emergencyStates = new Map<CellId, EmergencyState>();
  private stateHistories = new Map<CellId, StateHistoryEntry[]>();
  private federationStates = new Map<CellId, FederationState>();
  private federationTransactions = new Map<FederationTxId, FederationTransaction>();
  private linkProposals = new Map<LinkProposalId, LinkProposal>();

  // Ledger operations
  async saveLedgerState(state: CellLedgerState): Promise<Result<void, StorageError>> {
    // Deep clone to prevent mutation issues
    const cloned: CellLedgerState = {
      ...state,
      members: new Map(state.members),
      parameters: { ...state.parameters },
    };
    this.ledgerStates.set(state.cellId, cloned);
    return ok(undefined);
  }

  async getLedgerState(cellId: CellId): Promise<Result<CellLedgerState | null, StorageError>> {
    const state = this.ledgerStates.get(cellId);
    if (!state) {
      return ok(null);
    }
    // Return a clone to prevent mutation
    return ok({
      ...state,
      members: new Map(state.members),
      parameters: { ...state.parameters },
    });
  }

  // Identity operations
  async saveIdentity(identity: CellIdentity): Promise<Result<void, StorageError>> {
    this.identities.set(identity.id, { ...identity });
    this.identitiesByPublicKey.set(identity.publicKey, identity.id);
    return ok(undefined);
  }

  async getIdentity(id: IdentityId): Promise<Result<CellIdentity | null, StorageError>> {
    const identity = this.identities.get(id);
    return ok(identity ? { ...identity } : null);
  }

  async getIdentityByPublicKey(publicKey: string): Promise<Result<CellIdentity | null, StorageError>> {
    const id = this.identitiesByPublicKey.get(publicKey);
    if (!id) {
      return ok(null);
    }
    return this.getIdentity(id);
  }

  async getAllIdentities(cellId: CellId): Promise<Result<CellIdentity[], StorageError>> {
    const identities = Array.from(this.identities.values())
      .filter(i => i.cellId === cellId)
      .map(i => ({ ...i }));
    return ok(identities);
  }

  async deleteIdentity(id: IdentityId): Promise<Result<void, StorageError>> {
    const identity = this.identities.get(id);
    if (identity) {
      this.identitiesByPublicKey.delete(identity.publicKey);
      this.identities.delete(id);
    }
    return ok(undefined);
  }

  // Transaction operations
  async saveTransaction(tx: SpotTransaction): Promise<Result<void, StorageError>> {
    this.transactions.set(tx.id, { ...tx });

    // Index by payer
    if (!this.transactionsByMember.has(tx.payer)) {
      this.transactionsByMember.set(tx.payer, new Set());
    }
    this.transactionsByMember.get(tx.payer)!.add(tx.id);

    // Index by payee
    if (!this.transactionsByMember.has(tx.payee)) {
      this.transactionsByMember.set(tx.payee, new Set());
    }
    this.transactionsByMember.get(tx.payee)!.add(tx.id);

    return ok(undefined);
  }

  async getTransaction(id: TransactionId): Promise<Result<SpotTransaction | null, StorageError>> {
    const tx = this.transactions.get(id);
    return ok(tx ? { ...tx } : null);
  }

  async getTransactionsByMember(
    memberId: IdentityId,
    limit: number = 100,
    offset: number = 0
  ): Promise<Result<SpotTransaction[], StorageError>> {
    const txIds = this.transactionsByMember.get(memberId);
    if (!txIds) {
      return ok([]);
    }

    const transactions = Array.from(txIds)
      .map(id => this.transactions.get(id)!)
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(offset, offset + limit)
      .map(tx => ({ ...tx }));

    return ok(transactions);
  }

  // Offline queue operations
  async queueTransaction(tx: QueuedTransaction): Promise<Result<void, StorageError>> {
    this.offlineQueue.set(tx.transaction.id, { ...tx });
    return ok(undefined);
  }

  async getQueuedTransactions(): Promise<Result<QueuedTransaction[], StorageError>> {
    const queued = Array.from(this.offlineQueue.values())
      .map(q => ({ ...q }))
      .sort((a, b) => a.queuedAt - b.queuedAt);
    return ok(queued);
  }

  async removeFromQueue(txId: TransactionId): Promise<Result<void, StorageError>> {
    this.offlineQueue.delete(txId);
    return ok(undefined);
  }

  // Event log operations
  async appendEvent(
    event: Omit<EventLogEntry, 'id' | 'sequenceNumber'>
  ): Promise<Result<EventLogEntry, StorageError>> {
    const fullEvent: EventLogEntry = {
      ...event,
      id: generateId(),
      sequenceNumber: ++this.eventSequence,
    };
    this.events.push(fullEvent);
    return ok(fullEvent);
  }

  async getEvents(cellId: CellId, since: number = 0): Promise<Result<EventLogEntry[], StorageError>> {
    const events = this.events
      .filter(e => e.cellId === cellId && e.sequenceNumber > since)
      .map(e => ({ ...e }));
    return ok(events);
  }

  // Membership change log
  async saveMembershipChange(change: MembershipChange): Promise<Result<void, StorageError>> {
    if (!this.membershipChanges.has(change.memberId)) {
      this.membershipChanges.set(change.memberId, []);
    }
    this.membershipChanges.get(change.memberId)!.push({ ...change });
    return ok(undefined);
  }

  async getMembershipChanges(memberId: IdentityId): Promise<Result<MembershipChange[], StorageError>> {
    const changes = this.membershipChanges.get(memberId) || [];
    return ok(changes.map(c => ({ ...c })));
  }

  // ============================================
  // PHASE 2: COMMITMENT OPERATIONS
  // ============================================

  async saveCommitment(commitment: Commitment): Promise<Result<void, StorageError>> {
    this.commitments.set(commitment.id, { ...commitment });
    return ok(undefined);
  }

  async getCommitment(id: CommitmentId): Promise<Result<Commitment | null, StorageError>> {
    const commitment = this.commitments.get(id);
    return ok(commitment ? { ...commitment } : null);
  }

  async getCommitmentsByMember(memberId: IdentityId): Promise<Result<Commitment[], StorageError>> {
    const commitments = Array.from(this.commitments.values())
      .filter(c => c.promisor === memberId || c.promisee === memberId)
      .map(c => ({ ...c }));
    return ok(commitments);
  }

  async getCommitmentsByStatus(status: CommitmentStatus): Promise<Result<Commitment[], StorageError>> {
    const commitments = Array.from(this.commitments.values())
      .filter(c => c.status === status)
      .map(c => ({ ...c }));
    return ok(commitments);
  }

  async getCommitmentsByCategory(category: TaskCategory): Promise<Result<Commitment[], StorageError>> {
    const commitments = Array.from(this.commitments.values())
      .filter(c => c.category === category)
      .map(c => ({ ...c }));
    return ok(commitments);
  }

  async getAllCommitments(): Promise<Result<Commitment[], StorageError>> {
    const commitments = Array.from(this.commitments.values()).map(c => ({ ...c }));
    return ok(commitments);
  }

  // ============================================
  // PHASE 2: GOVERNANCE OPERATIONS
  // ============================================

  async saveProposal(proposal: Proposal): Promise<Result<void, StorageError>> {
    this.proposals.set(proposal.id, { ...proposal, votes: [...proposal.votes] });
    return ok(undefined);
  }

  async getProposal(id: ProposalId): Promise<Result<Proposal | null, StorageError>> {
    const proposal = this.proposals.get(id);
    return ok(proposal ? { ...proposal, votes: [...proposal.votes] } : null);
  }

  async getProposalsByStatus(status: ProposalStatus): Promise<Result<Proposal[], StorageError>> {
    const proposals = Array.from(this.proposals.values())
      .filter(p => p.status === status)
      .map(p => ({ ...p, votes: [...p.votes] }));
    return ok(proposals);
  }

  async getAllProposals(): Promise<Result<Proposal[], StorageError>> {
    const proposals = Array.from(this.proposals.values()).map(p => ({ ...p, votes: [...p.votes] }));
    return ok(proposals);
  }

  async saveDispute(dispute: Dispute): Promise<Result<void, StorageError>> {
    this.disputes.set(dispute.id, { ...dispute, evidence: [...dispute.evidence] });
    return ok(undefined);
  }

  async getDispute(id: DisputeId): Promise<Result<Dispute | null, StorageError>> {
    const dispute = this.disputes.get(id);
    return ok(dispute ? { ...dispute, evidence: [...dispute.evidence] } : null);
  }

  async getDisputesByStatus(status: DisputeStatus): Promise<Result<Dispute[], StorageError>> {
    const disputes = Array.from(this.disputes.values())
      .filter(d => d.status === status)
      .map(d => ({ ...d, evidence: [...d.evidence] }));
    return ok(disputes);
  }

  async getAllDisputes(): Promise<Result<Dispute[], StorageError>> {
    const disputes = Array.from(this.disputes.values()).map(d => ({ ...d, evidence: [...d.evidence] }));
    return ok(disputes);
  }

  async saveCouncil(council: GovernanceCouncil): Promise<Result<void, StorageError>> {
    this.councils.set(council.cellId, { ...council, members: [...council.members] });
    return ok(undefined);
  }

  async getCouncil(cellId: CellId): Promise<Result<GovernanceCouncil | null, StorageError>> {
    const council = this.councils.get(cellId);
    return ok(council ? { ...council, members: [...council.members] } : null);
  }

  // ============================================
  // PHASE 2: SCHEDULER OPERATIONS
  // ============================================

  async saveTaskSlot(slot: TaskSlot): Promise<Result<void, StorageError>> {
    this.taskSlots.set(slot.id, { ...slot, assignments: [...slot.assignments] });
    return ok(undefined);
  }

  async getTaskSlot(id: TaskSlotId): Promise<Result<TaskSlot | null, StorageError>> {
    const slot = this.taskSlots.get(id);
    return ok(slot ? { ...slot, assignments: [...slot.assignments] } : null);
  }

  async getTaskSlotsByPeriod(start: Timestamp, end: Timestamp): Promise<Result<TaskSlot[], StorageError>> {
    const slots = Array.from(this.taskSlots.values())
      .filter(s => s.startTime >= start && s.startTime < end)
      .map(s => ({ ...s, assignments: [...s.assignments] }))
      .sort((a, b) => a.startTime - b.startTime);
    return ok(slots);
  }

  async getTaskSlotsByStatus(status: TaskSlotStatus): Promise<Result<TaskSlot[], StorageError>> {
    const slots = Array.from(this.taskSlots.values())
      .filter(s => s.status === status)
      .map(s => ({ ...s, assignments: [...s.assignments] }));
    return ok(slots);
  }

  async getAllTaskSlots(): Promise<Result<TaskSlot[], StorageError>> {
    const slots = Array.from(this.taskSlots.values()).map(s => ({ ...s, assignments: [...s.assignments] }));
    return ok(slots);
  }

  async saveTaskTemplate(template: TaskTemplate): Promise<Result<void, StorageError>> {
    this.taskTemplates.set(template.id, { ...template });
    return ok(undefined);
  }

  async getTaskTemplate(id: TaskTemplateId): Promise<Result<TaskTemplate | null, StorageError>> {
    const template = this.taskTemplates.get(id);
    return ok(template ? { ...template } : null);
  }

  async getAllTaskTemplates(): Promise<Result<TaskTemplate[], StorageError>> {
    const templates = Array.from(this.taskTemplates.values()).map(t => ({ ...t }));
    return ok(templates);
  }

  async saveMemberSupply(supply: MemberSupply): Promise<Result<void, StorageError>> {
    // Clone the supply, converting Map to a new Map
    const cloned: MemberSupply = {
      ...supply,
      skills: new Map(supply.skills),
      preferences: [...supply.preferences],
      constraints: [...supply.constraints],
    };
    this.memberSupplies.set(supply.memberId, cloned);
    return ok(undefined);
  }

  async getMemberSupply(memberId: IdentityId): Promise<Result<MemberSupply | null, StorageError>> {
    const supply = this.memberSupplies.get(memberId);
    if (!supply) return ok(null);
    return ok({
      ...supply,
      skills: new Map(supply.skills),
      preferences: [...supply.preferences],
      constraints: [...supply.constraints],
    });
  }

  async getAllMemberSupplies(): Promise<Result<MemberSupply[], StorageError>> {
    const supplies = Array.from(this.memberSupplies.values()).map(s => ({
      ...s,
      skills: new Map(s.skills),
      preferences: [...s.preferences],
      constraints: [...s.constraints],
    }));
    return ok(supplies);
  }

  // ============================================
  // PHASE 3: EMERGENCY OPERATIONS
  // ============================================

  async saveEmergencyState(state: EmergencyState): Promise<Result<void, StorageError>> {
    this.emergencyStates.set(state.cellId, { ...state });
    return ok(undefined);
  }

  async getEmergencyState(cellId: CellId): Promise<Result<EmergencyState | null, StorageError>> {
    const state = this.emergencyStates.get(cellId);
    return ok(state ? { ...state } : null);
  }

  async appendStateHistoryEntry(entry: StateHistoryEntry, cellId: CellId): Promise<Result<void, StorageError>> {
    if (!this.stateHistories.has(cellId)) {
      this.stateHistories.set(cellId, []);
    }
    this.stateHistories.get(cellId)!.push({ ...entry });
    return ok(undefined);
  }

  async getStateHistory(cellId: CellId, since: Timestamp): Promise<Result<StateHistoryEntry[], StorageError>> {
    const history = this.stateHistories.get(cellId) || [];
    const filtered = history
      .filter(e => e.timestamp >= since)
      .map(e => ({ ...e }))
      .sort((a, b) => a.timestamp - b.timestamp);
    return ok(filtered);
  }

  // ============================================
  // PHASE 3: FEDERATION OPERATIONS
  // ============================================

  async saveFederationState(state: FederationState): Promise<Result<void, StorageError>> {
    this.federationStates.set(state.cellId, {
      ...state,
      connectedCells: [...state.connectedCells.map(c => ({ ...c }))],
    });
    return ok(undefined);
  }

  async getFederationState(cellId: CellId): Promise<Result<FederationState | null, StorageError>> {
    const state = this.federationStates.get(cellId);
    if (!state) return ok(null);
    return ok({
      ...state,
      connectedCells: [...state.connectedCells.map(c => ({ ...c }))],
    });
  }

  async saveFederationTransaction(tx: FederationTransaction): Promise<Result<void, StorageError>> {
    this.federationTransactions.set(tx.id, { ...tx });
    return ok(undefined);
  }

  async getFederationTransaction(id: FederationTxId): Promise<Result<FederationTransaction | null, StorageError>> {
    const tx = this.federationTransactions.get(id);
    return ok(tx ? { ...tx } : null);
  }

  async getFederationTransactions(filter: {
    cellId?: CellId;
    remoteCellId?: CellId;
    status?: FederationTxStatus;
    since?: Timestamp;
  }): Promise<Result<FederationTransaction[], StorageError>> {
    let transactions = Array.from(this.federationTransactions.values());

    if (filter.cellId) {
      transactions = transactions.filter(t =>
        t.sourceCell === filter.cellId || t.targetCell === filter.cellId
      );
    }

    if (filter.remoteCellId) {
      transactions = transactions.filter(t =>
        t.sourceCell === filter.remoteCellId || t.targetCell === filter.remoteCellId
      );
    }

    if (filter.status) {
      transactions = transactions.filter(t => t.status === filter.status);
    }

    if (filter.since) {
      transactions = transactions.filter(t => t.createdAt >= filter.since!);
    }

    return ok(transactions.map(t => ({ ...t })).sort((a, b) => b.createdAt - a.createdAt));
  }

  async saveLinkProposal(proposal: LinkProposal): Promise<Result<void, StorageError>> {
    this.linkProposals.set(proposal.id, { ...proposal, proposedTerms: { ...proposal.proposedTerms } });
    return ok(undefined);
  }

  async getLinkProposal(id: LinkProposalId): Promise<Result<LinkProposal | null, StorageError>> {
    const proposal = this.linkProposals.get(id);
    return ok(proposal ? { ...proposal, proposedTerms: { ...proposal.proposedTerms } } : null);
  }

  // Utility methods for testing
  clear(): void {
    this.ledgerStates.clear();
    this.identities.clear();
    this.identitiesByPublicKey.clear();
    this.transactions.clear();
    this.transactionsByMember.clear();
    this.offlineQueue.clear();
    this.events = [];
    this.eventSequence = 0;
    this.membershipChanges.clear();
    // Phase 2
    this.commitments.clear();
    this.proposals.clear();
    this.disputes.clear();
    this.councils.clear();
    this.taskSlots.clear();
    this.taskTemplates.clear();
    this.memberSupplies.clear();
    // Phase 3
    this.emergencyStates.clear();
    this.stateHistories.clear();
    this.federationStates.clear();
    this.federationTransactions.clear();
    this.linkProposals.clear();
  }
}

// ============================================
// POUCHDB STORAGE (for production)
// ============================================

/** PouchDB database interface (minimal typing) */
interface PouchDBLike {
  get(id: string): Promise<any>;
  put(doc: any): Promise<{ ok: boolean; id: string; rev: string }>;
  remove(doc: any): Promise<{ ok: boolean }>;
  allDocs(options?: any): Promise<{ rows: any[] }>;
  find(query: any): Promise<{ docs: any[] }>;
  createIndex(index: any): Promise<any>;
}

export class PouchDBStorage implements IStorage {
  private db: PouchDBLike;
  private eventSequence = 0;
  private initialized = false;

  constructor(db: PouchDBLike) {
    this.db = db;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create indexes for efficient queries
    await this.db.createIndex({
      index: { fields: ['type', 'data.cellId'] },
    });
    await this.db.createIndex({
      index: { fields: ['type', 'data.publicKey'] },
    });
    await this.db.createIndex({
      index: { fields: ['type', 'data.payer'] },
    });
    await this.db.createIndex({
      index: { fields: ['type', 'data.payee'] },
    });

    // Get current event sequence
    const events = await this.db.find({
      selector: { type: 'event' },
      sort: [{ 'data.sequenceNumber': 'desc' }],
      limit: 1,
    });
    if (events.docs.length > 0) {
      this.eventSequence = events.docs[0].data.sequenceNumber;
    }

    this.initialized = true;
  }

  // Ledger operations
  async saveLedgerState(state: CellLedgerState): Promise<Result<void, StorageError>> {
    try {
      const docId = `ledger:${state.cellId}`;

      // Convert Map to object for storage
      const membersObj: Record<string, MemberState> = {};
      state.members.forEach((v, k) => {
        membersObj[k] = v;
      });

      let doc: any = {
        _id: docId,
        type: 'ledger',
        data: {
          ...state,
          members: membersObj,
        },
        createdAt: now(),
        updatedAt: now(),
      };

      // Try to get existing doc for revision
      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save ledger state: ${e}` });
    }
  }

  async getLedgerState(cellId: CellId): Promise<Result<CellLedgerState | null, StorageError>> {
    try {
      const doc = await this.db.get(`ledger:${cellId}`);

      // Convert members object back to Map
      const members = new Map<IdentityId, MemberState>();
      const membersObj = doc.data.members as Record<string, MemberState>;
      for (const [k, v] of Object.entries(membersObj)) {
        members.set(k, v);
      }

      return ok({
        ...doc.data,
        members,
      });
    } catch (e: any) {
      if (e.status === 404) {
        return ok(null);
      }
      return err({ code: 'READ_FAILED', message: `Failed to get ledger state: ${e}` });
    }
  }

  // Identity operations
  async saveIdentity(identity: CellIdentity): Promise<Result<void, StorageError>> {
    try {
      const docId = `identity:${identity.id}`;
      let doc: any = {
        _id: docId,
        type: 'identity',
        data: identity,
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save identity: ${e}` });
    }
  }

  async getIdentity(id: IdentityId): Promise<Result<CellIdentity | null, StorageError>> {
    try {
      const doc = await this.db.get(`identity:${id}`);
      return ok(doc.data);
    } catch (e: any) {
      if (e.status === 404) {
        return ok(null);
      }
      return err({ code: 'READ_FAILED', message: `Failed to get identity: ${e}` });
    }
  }

  async getIdentityByPublicKey(publicKey: string): Promise<Result<CellIdentity | null, StorageError>> {
    try {
      const result = await this.db.find({
        selector: {
          type: 'identity',
          'data.publicKey': publicKey,
        },
      });
      if (result.docs.length === 0) {
        return ok(null);
      }
      return ok(result.docs[0].data);
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get identity by public key: ${e}` });
    }
  }

  async getAllIdentities(cellId: CellId): Promise<Result<CellIdentity[], StorageError>> {
    try {
      const result = await this.db.find({
        selector: {
          type: 'identity',
          'data.cellId': cellId,
        },
      });
      return ok(result.docs.map(d => d.data));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get identities: ${e}` });
    }
  }

  async deleteIdentity(id: IdentityId): Promise<Result<void, StorageError>> {
    try {
      const doc = await this.db.get(`identity:${id}`);
      await this.db.remove(doc);
      return ok(undefined);
    } catch (e: any) {
      if (e.status === 404) {
        return ok(undefined);
      }
      return err({ code: 'DELETE_FAILED', message: `Failed to delete identity: ${e}` });
    }
  }

  // Transaction operations
  async saveTransaction(tx: SpotTransaction): Promise<Result<void, StorageError>> {
    try {
      const docId = `transaction:${tx.id}`;
      let doc: any = {
        _id: docId,
        type: 'transaction',
        data: tx,
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save transaction: ${e}` });
    }
  }

  async getTransaction(id: TransactionId): Promise<Result<SpotTransaction | null, StorageError>> {
    try {
      const doc = await this.db.get(`transaction:${id}`);
      return ok(doc.data);
    } catch (e: any) {
      if (e.status === 404) {
        return ok(null);
      }
      return err({ code: 'READ_FAILED', message: `Failed to get transaction: ${e}` });
    }
  }

  async getTransactionsByMember(
    memberId: IdentityId,
    limit: number = 100,
    offset: number = 0
  ): Promise<Result<SpotTransaction[], StorageError>> {
    try {
      // Get transactions where member is payer or payee
      const [payerResult, payeeResult] = await Promise.all([
        this.db.find({
          selector: { type: 'transaction', 'data.payer': memberId },
        }),
        this.db.find({
          selector: { type: 'transaction', 'data.payee': memberId },
        }),
      ]);

      // Merge and dedupe
      const txMap = new Map<string, SpotTransaction>();
      for (const doc of [...payerResult.docs, ...payeeResult.docs]) {
        txMap.set(doc.data.id, doc.data);
      }

      // Sort by createdAt descending and apply pagination
      const transactions = Array.from(txMap.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(offset, offset + limit);

      return ok(transactions);
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get transactions: ${e}` });
    }
  }

  // Offline queue operations
  async queueTransaction(tx: QueuedTransaction): Promise<Result<void, StorageError>> {
    try {
      const docId = `queue:${tx.transaction.id}`;
      await this.db.put({
        _id: docId,
        type: 'queue',
        data: tx,
        createdAt: now(),
        updatedAt: now(),
      });
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to queue transaction: ${e}` });
    }
  }

  async getQueuedTransactions(): Promise<Result<QueuedTransaction[], StorageError>> {
    try {
      const result = await this.db.find({
        selector: { type: 'queue' },
      });
      const queued = result.docs
        .map(d => d.data)
        .sort((a: QueuedTransaction, b: QueuedTransaction) => a.queuedAt - b.queuedAt);
      return ok(queued);
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get queued transactions: ${e}` });
    }
  }

  async removeFromQueue(txId: TransactionId): Promise<Result<void, StorageError>> {
    try {
      const doc = await this.db.get(`queue:${txId}`);
      await this.db.remove(doc);
      return ok(undefined);
    } catch (e: any) {
      if (e.status === 404) {
        return ok(undefined);
      }
      return err({ code: 'DELETE_FAILED', message: `Failed to remove from queue: ${e}` });
    }
  }

  // Event log operations
  async appendEvent(
    event: Omit<EventLogEntry, 'id' | 'sequenceNumber'>
  ): Promise<Result<EventLogEntry, StorageError>> {
    try {
      const fullEvent: EventLogEntry = {
        ...event,
        id: generateId(),
        sequenceNumber: ++this.eventSequence,
      };

      await this.db.put({
        _id: `event:${fullEvent.id}`,
        type: 'event',
        data: fullEvent,
        createdAt: now(),
        updatedAt: now(),
      });

      return ok(fullEvent);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to append event: ${e}` });
    }
  }

  async getEvents(cellId: CellId, since: number = 0): Promise<Result<EventLogEntry[], StorageError>> {
    try {
      const result = await this.db.find({
        selector: {
          type: 'event',
          'data.cellId': cellId,
          'data.sequenceNumber': { $gt: since },
        },
      });
      const events = result.docs
        .map(d => d.data)
        .sort((a: EventLogEntry, b: EventLogEntry) => a.sequenceNumber - b.sequenceNumber);
      return ok(events);
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get events: ${e}` });
    }
  }

  // Membership change log
  async saveMembershipChange(change: MembershipChange): Promise<Result<void, StorageError>> {
    try {
      const docId = `membership-change:${change.memberId}:${change.changedAt}`;
      await this.db.put({
        _id: docId,
        type: 'membership-change',
        data: change,
        createdAt: now(),
        updatedAt: now(),
      });
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save membership change: ${e}` });
    }
  }

  async getMembershipChanges(memberId: IdentityId): Promise<Result<MembershipChange[], StorageError>> {
    try {
      const result = await this.db.find({
        selector: {
          type: 'membership-change',
          'data.memberId': memberId,
        },
      });
      const changes = result.docs
        .map(d => d.data)
        .sort((a: MembershipChange, b: MembershipChange) => a.changedAt - b.changedAt);
      return ok(changes);
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get membership changes: ${e}` });
    }
  }

  // ============================================
  // PHASE 2: COMMITMENT OPERATIONS
  // ============================================

  async saveCommitment(commitment: Commitment): Promise<Result<void, StorageError>> {
    try {
      const docId = `commitment:${commitment.id}`;
      let doc: any = {
        _id: docId,
        type: 'commitment',
        data: commitment,
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save commitment: ${e}` });
    }
  }

  async getCommitment(id: CommitmentId): Promise<Result<Commitment | null, StorageError>> {
    try {
      const doc = await this.db.get(`commitment:${id}`);
      return ok(doc.data);
    } catch (e: any) {
      if (e.status === 404) return ok(null);
      return err({ code: 'READ_FAILED', message: `Failed to get commitment: ${e}` });
    }
  }

  async getCommitmentsByMember(memberId: IdentityId): Promise<Result<Commitment[], StorageError>> {
    try {
      const [promisorResult, promiseeResult] = await Promise.all([
        this.db.find({ selector: { type: 'commitment', 'data.promisor': memberId } }),
        this.db.find({ selector: { type: 'commitment', 'data.promisee': memberId } }),
      ]);
      const commitmentMap = new Map<string, Commitment>();
      for (const doc of [...promisorResult.docs, ...promiseeResult.docs]) {
        commitmentMap.set(doc.data.id, doc.data);
      }
      return ok(Array.from(commitmentMap.values()));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get commitments: ${e}` });
    }
  }

  async getCommitmentsByStatus(status: CommitmentStatus): Promise<Result<Commitment[], StorageError>> {
    try {
      const result = await this.db.find({ selector: { type: 'commitment', 'data.status': status } });
      return ok(result.docs.map(d => d.data));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get commitments by status: ${e}` });
    }
  }

  async getCommitmentsByCategory(category: TaskCategory): Promise<Result<Commitment[], StorageError>> {
    try {
      const result = await this.db.find({ selector: { type: 'commitment', 'data.category': category } });
      return ok(result.docs.map(d => d.data));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get commitments by category: ${e}` });
    }
  }

  async getAllCommitments(): Promise<Result<Commitment[], StorageError>> {
    try {
      const result = await this.db.find({ selector: { type: 'commitment' } });
      return ok(result.docs.map(d => d.data));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get all commitments: ${e}` });
    }
  }

  // ============================================
  // PHASE 2: GOVERNANCE OPERATIONS
  // ============================================

  async saveProposal(proposal: Proposal): Promise<Result<void, StorageError>> {
    try {
      const docId = `proposal:${proposal.id}`;
      let doc: any = {
        _id: docId,
        type: 'proposal',
        data: proposal,
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save proposal: ${e}` });
    }
  }

  async getProposal(id: ProposalId): Promise<Result<Proposal | null, StorageError>> {
    try {
      const doc = await this.db.get(`proposal:${id}`);
      return ok(doc.data);
    } catch (e: any) {
      if (e.status === 404) return ok(null);
      return err({ code: 'READ_FAILED', message: `Failed to get proposal: ${e}` });
    }
  }

  async getProposalsByStatus(status: ProposalStatus): Promise<Result<Proposal[], StorageError>> {
    try {
      const result = await this.db.find({ selector: { type: 'proposal', 'data.status': status } });
      return ok(result.docs.map(d => d.data));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get proposals by status: ${e}` });
    }
  }

  async getAllProposals(): Promise<Result<Proposal[], StorageError>> {
    try {
      const result = await this.db.find({ selector: { type: 'proposal' } });
      return ok(result.docs.map(d => d.data));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get all proposals: ${e}` });
    }
  }

  async saveDispute(dispute: Dispute): Promise<Result<void, StorageError>> {
    try {
      const docId = `dispute:${dispute.id}`;
      let doc: any = {
        _id: docId,
        type: 'dispute',
        data: dispute,
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save dispute: ${e}` });
    }
  }

  async getDispute(id: DisputeId): Promise<Result<Dispute | null, StorageError>> {
    try {
      const doc = await this.db.get(`dispute:${id}`);
      return ok(doc.data);
    } catch (e: any) {
      if (e.status === 404) return ok(null);
      return err({ code: 'READ_FAILED', message: `Failed to get dispute: ${e}` });
    }
  }

  async getDisputesByStatus(status: DisputeStatus): Promise<Result<Dispute[], StorageError>> {
    try {
      const result = await this.db.find({ selector: { type: 'dispute', 'data.status': status } });
      return ok(result.docs.map(d => d.data));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get disputes by status: ${e}` });
    }
  }

  async getAllDisputes(): Promise<Result<Dispute[], StorageError>> {
    try {
      const result = await this.db.find({ selector: { type: 'dispute' } });
      return ok(result.docs.map(d => d.data));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get all disputes: ${e}` });
    }
  }

  async saveCouncil(council: GovernanceCouncil): Promise<Result<void, StorageError>> {
    try {
      const docId = `council:${council.cellId}`;
      let doc: any = {
        _id: docId,
        type: 'council',
        data: council,
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save council: ${e}` });
    }
  }

  async getCouncil(cellId: CellId): Promise<Result<GovernanceCouncil | null, StorageError>> {
    try {
      const doc = await this.db.get(`council:${cellId}`);
      return ok(doc.data);
    } catch (e: any) {
      if (e.status === 404) return ok(null);
      return err({ code: 'READ_FAILED', message: `Failed to get council: ${e}` });
    }
  }

  // ============================================
  // PHASE 2: SCHEDULER OPERATIONS
  // ============================================

  async saveTaskSlot(slot: TaskSlot): Promise<Result<void, StorageError>> {
    try {
      const docId = `taskslot:${slot.id}`;
      let doc: any = {
        _id: docId,
        type: 'taskslot',
        data: slot,
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save task slot: ${e}` });
    }
  }

  async getTaskSlot(id: TaskSlotId): Promise<Result<TaskSlot | null, StorageError>> {
    try {
      const doc = await this.db.get(`taskslot:${id}`);
      return ok(doc.data);
    } catch (e: any) {
      if (e.status === 404) return ok(null);
      return err({ code: 'READ_FAILED', message: `Failed to get task slot: ${e}` });
    }
  }

  async getTaskSlotsByPeriod(start: Timestamp, end: Timestamp): Promise<Result<TaskSlot[], StorageError>> {
    try {
      const result = await this.db.find({
        selector: {
          type: 'taskslot',
          'data.startTime': { $gte: start, $lt: end },
        },
      });
      const slots = result.docs
        .map(d => d.data)
        .sort((a: TaskSlot, b: TaskSlot) => a.startTime - b.startTime);
      return ok(slots);
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get task slots by period: ${e}` });
    }
  }

  async getTaskSlotsByStatus(status: TaskSlotStatus): Promise<Result<TaskSlot[], StorageError>> {
    try {
      const result = await this.db.find({ selector: { type: 'taskslot', 'data.status': status } });
      return ok(result.docs.map(d => d.data));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get task slots by status: ${e}` });
    }
  }

  async getAllTaskSlots(): Promise<Result<TaskSlot[], StorageError>> {
    try {
      const result = await this.db.find({ selector: { type: 'taskslot' } });
      return ok(result.docs.map(d => d.data));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get all task slots: ${e}` });
    }
  }

  async saveTaskTemplate(template: TaskTemplate): Promise<Result<void, StorageError>> {
    try {
      const docId = `tasktemplate:${template.id}`;
      let doc: any = {
        _id: docId,
        type: 'tasktemplate',
        data: template,
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save task template: ${e}` });
    }
  }

  async getTaskTemplate(id: TaskTemplateId): Promise<Result<TaskTemplate | null, StorageError>> {
    try {
      const doc = await this.db.get(`tasktemplate:${id}`);
      return ok(doc.data);
    } catch (e: any) {
      if (e.status === 404) return ok(null);
      return err({ code: 'READ_FAILED', message: `Failed to get task template: ${e}` });
    }
  }

  async getAllTaskTemplates(): Promise<Result<TaskTemplate[], StorageError>> {
    try {
      const result = await this.db.find({ selector: { type: 'tasktemplate' } });
      return ok(result.docs.map(d => d.data));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get all task templates: ${e}` });
    }
  }

  async saveMemberSupply(supply: MemberSupply): Promise<Result<void, StorageError>> {
    try {
      const docId = `membersupply:${supply.memberId}`;

      // Convert Map to object for storage
      const skillsObj: Record<string, number> = {};
      supply.skills.forEach((v, k) => {
        skillsObj[k] = v;
      });

      let doc: any = {
        _id: docId,
        type: 'membersupply',
        data: {
          ...supply,
          skills: skillsObj,
        },
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save member supply: ${e}` });
    }
  }

  async getMemberSupply(memberId: IdentityId): Promise<Result<MemberSupply | null, StorageError>> {
    try {
      const doc = await this.db.get(`membersupply:${memberId}`);
      // Convert skills object back to Map
      const skills = new Map<TaskCategory, number>();
      const skillsObj = doc.data.skills as Record<string, number>;
      for (const [k, v] of Object.entries(skillsObj)) {
        skills.set(k as TaskCategory, v);
      }
      return ok({
        ...doc.data,
        skills,
      });
    } catch (e: any) {
      if (e.status === 404) return ok(null);
      return err({ code: 'READ_FAILED', message: `Failed to get member supply: ${e}` });
    }
  }

  async getAllMemberSupplies(): Promise<Result<MemberSupply[], StorageError>> {
    try {
      const result = await this.db.find({ selector: { type: 'membersupply' } });
      return ok(result.docs.map(d => {
        // Convert skills object back to Map
        const skills = new Map<TaskCategory, number>();
        const skillsObj = d.data.skills as Record<string, number>;
        for (const [k, v] of Object.entries(skillsObj)) {
          skills.set(k as TaskCategory, v);
        }
        return {
          ...d.data,
          skills,
        };
      }));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get all member supplies: ${e}` });
    }
  }

  // ============================================
  // PHASE 3: EMERGENCY OPERATIONS
  // ============================================

  async saveEmergencyState(state: EmergencyState): Promise<Result<void, StorageError>> {
    try {
      const docId = `emergency:${state.cellId}`;
      let doc: any = {
        _id: docId,
        type: 'emergency',
        data: state,
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save emergency state: ${e}` });
    }
  }

  async getEmergencyState(cellId: CellId): Promise<Result<EmergencyState | null, StorageError>> {
    try {
      const doc = await this.db.get(`emergency:${cellId}`);
      return ok(doc.data);
    } catch (e: any) {
      if (e.status === 404) return ok(null);
      return err({ code: 'READ_FAILED', message: `Failed to get emergency state: ${e}` });
    }
  }

  async appendStateHistoryEntry(entry: StateHistoryEntry, cellId: CellId): Promise<Result<void, StorageError>> {
    try {
      const docId = `statehistory:${cellId}:${entry.timestamp}`;
      await this.db.put({
        _id: docId,
        type: 'statehistory',
        data: { ...entry, cellId },
        createdAt: now(),
        updatedAt: now(),
      });
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to append state history: ${e}` });
    }
  }

  async getStateHistory(cellId: CellId, since: Timestamp): Promise<Result<StateHistoryEntry[], StorageError>> {
    try {
      const result = await this.db.find({
        selector: {
          type: 'statehistory',
          'data.cellId': cellId,
          'data.timestamp': { $gte: since },
        },
      });
      const history = result.docs
        .map(d => d.data as StateHistoryEntry)
        .sort((a, b) => a.timestamp - b.timestamp);
      return ok(history);
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get state history: ${e}` });
    }
  }

  // ============================================
  // PHASE 3: FEDERATION OPERATIONS
  // ============================================

  async saveFederationState(state: FederationState): Promise<Result<void, StorageError>> {
    try {
      const docId = `federation:${state.cellId}`;
      let doc: any = {
        _id: docId,
        type: 'federation',
        data: state,
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save federation state: ${e}` });
    }
  }

  async getFederationState(cellId: CellId): Promise<Result<FederationState | null, StorageError>> {
    try {
      const doc = await this.db.get(`federation:${cellId}`);
      return ok(doc.data);
    } catch (e: any) {
      if (e.status === 404) return ok(null);
      return err({ code: 'READ_FAILED', message: `Failed to get federation state: ${e}` });
    }
  }

  async saveFederationTransaction(tx: FederationTransaction): Promise<Result<void, StorageError>> {
    try {
      const docId = `fedtx:${tx.id}`;
      let doc: any = {
        _id: docId,
        type: 'fedtx',
        data: tx,
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save federation transaction: ${e}` });
    }
  }

  async getFederationTransaction(id: FederationTxId): Promise<Result<FederationTransaction | null, StorageError>> {
    try {
      const doc = await this.db.get(`fedtx:${id}`);
      return ok(doc.data);
    } catch (e: any) {
      if (e.status === 404) return ok(null);
      return err({ code: 'READ_FAILED', message: `Failed to get federation transaction: ${e}` });
    }
  }

  async getFederationTransactions(filter: {
    cellId?: CellId;
    remoteCellId?: CellId;
    status?: FederationTxStatus;
    since?: Timestamp;
  }): Promise<Result<FederationTransaction[], StorageError>> {
    try {
      const selector: any = { type: 'fedtx' };

      if (filter.status) {
        selector['data.status'] = filter.status;
      }
      if (filter.since) {
        selector['data.createdAt'] = { $gte: filter.since };
      }

      const result = await this.db.find({ selector });

      let transactions = result.docs.map(d => d.data as FederationTransaction);

      // Apply cellId filter (need to check both source and target)
      if (filter.cellId) {
        transactions = transactions.filter(t =>
          t.sourceCell === filter.cellId || t.targetCell === filter.cellId
        );
      }

      // Apply remoteCellId filter
      if (filter.remoteCellId) {
        transactions = transactions.filter(t =>
          t.sourceCell === filter.remoteCellId || t.targetCell === filter.remoteCellId
        );
      }

      return ok(transactions.sort((a, b) => b.createdAt - a.createdAt));
    } catch (e) {
      return err({ code: 'READ_FAILED', message: `Failed to get federation transactions: ${e}` });
    }
  }

  async saveLinkProposal(proposal: LinkProposal): Promise<Result<void, StorageError>> {
    try {
      const docId = `linkproposal:${proposal.id}`;
      let doc: any = {
        _id: docId,
        type: 'linkproposal',
        data: proposal,
        createdAt: now(),
        updatedAt: now(),
      };

      try {
        const existing = await this.db.get(docId);
        doc._rev = existing._rev;
        doc.createdAt = existing.createdAt;
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      await this.db.put(doc);
      return ok(undefined);
    } catch (e) {
      return err({ code: 'WRITE_FAILED', message: `Failed to save link proposal: ${e}` });
    }
  }

  async getLinkProposal(id: LinkProposalId): Promise<Result<LinkProposal | null, StorageError>> {
    try {
      const doc = await this.db.get(`linkproposal:${id}`);
      return ok(doc.data);
    } catch (e: any) {
      if (e.status === 404) return ok(null);
      return err({ code: 'READ_FAILED', message: `Failed to get link proposal: ${e}` });
    }
  }
}

// ============================================
// FACTORY
// ============================================

/** Create an in-memory storage instance (for testing) */
export function createInMemoryStorage(): InMemoryStorage {
  return new InMemoryStorage();
}

/** Create a PouchDB storage instance (for production) */
export function createPouchDBStorage(db: PouchDBLike): PouchDBStorage {
  return new PouchDBStorage(db);
}
