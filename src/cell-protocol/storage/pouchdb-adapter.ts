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
