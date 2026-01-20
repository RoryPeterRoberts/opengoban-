/**
 * Cell Protocol - Public API
 *
 * Phase 1: Core Protocol MVP
 * - Core Ledger Engine (PRD-01)
 * - Transaction System (PRD-02)
 * - Identity & Membership Basic (PRD-04)
 *
 * Phase 2: Coordination Layer
 * - Commitment System (PRD-03)
 * - Governance System (PRD-05)
 * - Survival Scheduler Basic (PRD-08)
 *
 * Phase 3: Resilience Layer
 * - Emergency Mode System (PRD-07)
 * - Federation Network (PRD-06)
 *
 * Phase 4: Resource Management
 * - Energy Resource Layer (PRD-09)
 * - Survival Scheduler Full (PRD-08)
 */

// ============================================
// TYPE EXPORTS
// ============================================

// Common types
export {
  IdentityId,
  CellId,
  TransactionId,
  Timestamp,
  Units,
  PublicKey,
  Signature,
  SecretKey,
  BalanceChangeReason,
  MembershipStatus,
  EventMeta,
  AuditEntry,
  generateId,
  now,
} from './types/common';

// Ledger types
export {
  MemberState,
  MemberComputedState,
  LedgerParameters,
  CellLedgerState,
  BalanceUpdate,
  ReserveUpdate,
  BalanceUpdateResult,
  LedgerError,
  LedgerErrorCode,
  LedgerStatistics,
  ILedgerEngine,
} from './types/ledger';

// Transaction types
export {
  TransactionType,
  TransactionStatus,
  SpotTransaction,
  TransactionSignatures,
  CreateSpotTransactionInput,
  TransactionSigningData,
  TransactionResult,
  TransactionError,
  TransactionErrorCode,
  QueuedTransaction,
  ITransactionEngine,
} from './types/transaction';

// Identity types
export {
  CellIdentity,
  AdmissionInfo,
  AdmissionResult,
  MembershipChange,
  IdentityError,
  IdentityErrorCode,
  MemberSearchCriteria,
  MemberSearchResult,
  IIdentityEngine,
} from './types/identity';

// ============================================
// PHASE 2 TYPE EXPORTS
// ============================================

// Commitment types
export {
  CommitmentId,
  CommitmentType,
  CommitmentStatus,
  TaskCategory,
  Commitment,
  FulfillmentConfirmation,
  CreateCommitmentInput,
  CommitmentError,
  CommitmentErrorCode,
  MemberCommitmentStats,
  CategoryFulfillmentStats,
  ICommitmentEngine,
} from './types/commitment';

// Governance types
export {
  ProposalId,
  DisputeId,
  ProposalType,
  ProposalStatus,
  ActionCategory,
  DisputeType,
  DisputeStatus,
  VoteDecision,
  GovernanceCouncil,
  CouncilMember,
  QuorumRules,
  TermPolicy,
  Proposal,
  ProposalPayload,
  Vote,
  Evidence,
  DisputeResolution,
  DisputeAction,
  Dispute,
  CreateProposalInput,
  FileDisputeInput,
  GovernanceError,
  GovernanceErrorCode,
  IGovernanceEngine,
} from './types/governance';

// Scheduler types
export {
  TaskSlotId,
  TaskTemplateId,
  TaskSlotStatus,
  AssignmentStatus,
  TaskSlot,
  TaskTemplate,
  TaskAssignment,
  MemberSupply,
  FeasibilityResult,
  MatchingResult,
  CoverageReport,
  CategoryCoverage,
  CreateSlotInput,
  CreateTemplateInput,
  SchedulerError,
  SchedulerErrorCode,
  ISchedulerEngine,
  TaskCategoryDefinition,
} from './types/scheduler';

// ============================================
// PHASE 4 TYPE EXPORTS
// ============================================

// Energy types
export {
  EnergyCarrierId,
  EnergyCategory,
  EnergyCarrier,
  EnergyStock,
  EnergySource,
  EnergyConsumer,
  EnergyFlow,
  EnergyMode,
  TaskEnergyProfile,
  RationingPlan,
  MemberBundle,
  StockChangeRecord,
  StockChangeReason,
  ConsumptionRecord,
  WeeklyEnergyPlan,
  StressProjection,
  ProcurementAlert,
  EnergyState,
  EnergyError,
  EnergyErrorCode,
  IEnergyEngine,
  DEFAULT_CARRIERS,
  DEFAULT_TASK_PROFILES,
  HUMANITARIAN_FLOOR,
  VULNERABILITY_BONUS,
} from './types/energy';

// ============================================
// PHASE 3 TYPE EXPORTS
// ============================================

// Emergency types
export {
  RiskState,
  AdmissionMode,
  CommitmentMode,
  SchedulerPriority,
  StressIndicators,
  EmergencyPolicy,
  TransitionThresholds,
  TransitionReason,
  StateTransitionResult,
  StateHistoryEntry,
  ThresholdProximityReport,
  EmergencyState,
  EmergencyError,
  EmergencyErrorCode,
  IEmergencyEngine,
  DEFAULT_POLICIES,
  DEFAULT_THRESHOLDS,
} from './types/emergency';

// Federation types
export {
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
} from './types/federation';

// ============================================
// RESULT TYPE EXPORTS
// ============================================

export {
  Result,
  Ok,
  Err,
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  andThen,
  all,
  tryCatch,
  tryCatchAsync,
} from './utils/result';

// ============================================
// ENGINE EXPORTS
// ============================================

export {
  LedgerEngine,
  LedgerViolationError,
  createLedgerEngine,
} from './engines/ledger-engine';

export {
  TransactionEngine,
  TransactionValidationError,
  createTransactionEngine,
} from './engines/transaction-engine';

export {
  IdentityEngine,
  IdentityValidationError,
  createIdentityEngine,
} from './engines/identity-engine';

// ============================================
// PHASE 2 ENGINE EXPORTS
// ============================================

export {
  CommitmentEngine,
  CommitmentValidationError,
  createCommitmentEngine,
} from './engines/commitment-engine';

export {
  GovernanceEngine,
  GovernanceValidationError,
  createGovernanceEngine,
} from './engines/governance-engine';

export {
  SchedulerEngine,
  SchedulerValidationError,
  createSchedulerEngine,
} from './engines/scheduler-engine';

// ============================================
// PHASE 3 ENGINE EXPORTS
// ============================================

export {
  EmergencyEngine,
  EmergencyValidationError,
  createEmergencyEngine,
} from './engines/emergency-engine';

export {
  FederationEngine,
  FederationValidationError,
  createFederationEngine,
} from './engines/federation-engine';

// ============================================
// PHASE 4 ENGINE EXPORTS
// ============================================

export {
  EnergyEngine,
  EnergyValidationError,
  createEnergyEngine,
  createEnergyEngineWithScheduler,
} from './engines/energy-engine';

// ============================================
// STORAGE EXPORTS
// ============================================

export {
  IStorage,
  StorageError,
  StorageDocument,
  EventLogEntry,
  InMemoryStorage,
  PouchDBStorage,
  createInMemoryStorage,
  createPouchDBStorage,
} from './storage/pouchdb-adapter';

// ============================================
// CRYPTO EXPORTS
// ============================================

export {
  CryptoAdapter,
  KeyPair,
  CryptoError,
  cryptoAdapter,
  encodeBase64,
  decodeBase64,
  encodeHex,
  decodeHex,
  createTransactionSigningData,
  signTransaction,
  verifyTransactionSignature,
} from './crypto/crypto-adapter';

// ============================================
// CELL PROTOCOL FACTORY
// ============================================

import { CellId, IdentityId } from './types/common';
import { LedgerParameters } from './types/ledger';
import { TransitionThresholds } from './types/emergency';
import { FederationParameters } from './types/federation';
import { EnergyCarrier, TaskEnergyProfile } from './types/energy';
import { LedgerEngine, createLedgerEngine } from './engines/ledger-engine';
import { TransactionEngine, createTransactionEngine } from './engines/transaction-engine';
import { IdentityEngine, createIdentityEngine } from './engines/identity-engine';
import { CommitmentEngine, createCommitmentEngine } from './engines/commitment-engine';
import { GovernanceEngine, createGovernanceEngine } from './engines/governance-engine';
import { SchedulerEngine, createSchedulerEngine } from './engines/scheduler-engine';
import { EmergencyEngine, createEmergencyEngine } from './engines/emergency-engine';
import { FederationEngine, createFederationEngine } from './engines/federation-engine';
import { EnergyEngine, createEnergyEngine } from './engines/energy-engine';
import { IStorage, createInMemoryStorage } from './storage/pouchdb-adapter';
import { CryptoAdapter, cryptoAdapter } from './crypto/crypto-adapter';

/**
 * Complete Cell Protocol instance
 */
export interface CellProtocol {
  cellId: CellId;
  ledger: LedgerEngine;
  transactions: TransactionEngine;
  identity: IdentityEngine;
  commitments: CommitmentEngine;      // Phase 2
  governance: GovernanceEngine;        // Phase 2
  scheduler: SchedulerEngine;          // Phase 2
  emergency: EmergencyEngine;          // Phase 3
  federation?: FederationEngine;       // Phase 3 (optional)
  energy?: EnergyEngine;               // Phase 4 (optional)
  storage: IStorage;
  crypto: CryptoAdapter;
}

/**
 * Options for creating a Cell Protocol instance
 */
export interface CellProtocolOptions {
  cellId: CellId;
  ledgerParameters?: Partial<LedgerParameters>;
  storage?: IStorage;
  crypto?: CryptoAdapter;
  // Phase 3 options
  enableFederation?: boolean;
  federationParameters?: Partial<FederationParameters>;
  emergencyThresholds?: Partial<TransitionThresholds>;
  // Phase 4 options
  enableEnergy?: boolean;
  energyCarriers?: EnergyCarrier[];
  energyTaskProfiles?: TaskEnergyProfile[];
}

/**
 * Create a complete Cell Protocol instance
 */
export async function createCellProtocol(options: CellProtocolOptions): Promise<CellProtocol> {
  const { cellId, ledgerParameters = {} } = options;

  // Use provided storage or create in-memory storage
  const storage = options.storage ?? createInMemoryStorage();

  // Use provided crypto adapter or the default singleton
  const crypto = options.crypto ?? cryptoAdapter;

  // Initialize crypto if needed
  if (!crypto.isInitialized()) {
    const initResult = await crypto.initialize();
    if (!initResult.ok) {
      throw new Error(`Failed to initialize crypto: ${initResult.error.message}`);
    }
  }

  // Create ledger engine
  const ledger = await createLedgerEngine(cellId, ledgerParameters, storage);

  // Create identity engine
  const identity = createIdentityEngine(ledger, storage, crypto);

  // Create transaction engine with public key resolver
  const publicKeyResolver = async (memberId: IdentityId): Promise<string | undefined> => {
    const memberIdentity = await identity.getIdentity(memberId);
    return memberIdentity?.publicKey;
  };

  const transactions = createTransactionEngine(ledger, storage, crypto, publicKeyResolver);

  // Phase 2: Create coordination layer engines
  const commitments = createCommitmentEngine(ledger, transactions, storage);
  const governance = createGovernanceEngine(cellId, ledger, identity, commitments, storage);
  const scheduler = createSchedulerEngine(ledger, commitments, storage);

  // Phase 3: Create resilience layer engines
  const emergency = createEmergencyEngine(cellId, ledger, storage, options.emergencyThresholds);

  // Wire up circular dependencies
  emergency.setGovernanceEngine(governance);
  emergency.setIdentityEngine(identity);

  // Create federation if enabled
  let federation: FederationEngine | undefined;
  if (options.enableFederation) {
    federation = await createFederationEngine(cellId, ledger, storage, options.federationParameters);
    federation.setEmergencyEngine(emergency);
  }

  // Phase 4: Create energy engine if enabled
  let energy: EnergyEngine | undefined;
  if (options.enableEnergy) {
    energy = createEnergyEngine(
      cellId,
      ledger,
      storage,
      options.energyCarriers,
      options.energyTaskProfiles
    );
    energy.setSchedulerEngine(scheduler);
    scheduler.setEnergyEngine(energy);
    emergency.setEnergyEngine(energy);
    await energy.loadState();
  }

  return {
    cellId,
    ledger,
    transactions,
    identity,
    commitments,
    governance,
    scheduler,
    emergency,
    federation,
    energy,
    storage,
    crypto,
  };
}

// ============================================
// VERSION
// ============================================

export const VERSION = '0.1.0';
export const PROTOCOL_VERSION = 1;
