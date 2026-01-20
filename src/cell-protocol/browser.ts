/**
 * Cell Protocol - Browser Entry Point
 *
 * Exports the Cell Protocol for use in browser environments.
 * This file is compiled by esbuild into a browser-compatible bundle.
 */

// Core protocol
export { createCellProtocol, CellProtocol } from './index';

// Types
export type {
  IdentityId,
  CellId,
  Units,
  Timestamp,
  MembershipStatus,
  BalanceChangeReason,
} from './types/common';

export type {
  CellIdentity,
  MemberProfile,
  AdmissionApplication,
  AdmissionInfo,
} from './types/identity';

export type {
  SpotTransaction,
  TransactionStatus,
  TransactionResult,
} from './types/transaction';

export type {
  Commitment,
  CommitmentType,
  CommitmentStatus,
  TaskCategory,
} from './types/commitment';

// Utility functions
export { generateId, now } from './types/common';

// Re-export individual engines for direct access if needed
export { LedgerEngine } from './engines/ledger-engine';
export { TransactionEngine } from './engines/transaction-engine';
export { IdentityEngine } from './engines/identity-engine';
export { CommitmentEngine } from './engines/commitment-engine';
export { GovernanceEngine } from './engines/governance-engine';
export { FederationEngine } from './engines/federation-engine';
export { EmergencyEngine } from './engines/emergency-engine';
export { SchedulerEngine } from './engines/scheduler-engine';
export { EnergyEngine } from './engines/energy-engine';

// Storage adapter
export { createPouchDBStorage, createInMemoryStorage } from './storage/pouchdb-adapter';
