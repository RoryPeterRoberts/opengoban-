/**
 * Cell Protocol - Hardening: Sybil Resistance Types
 *
 * Type definitions for Sybil resistance mechanisms (PRD-10).
 * Defines sponsor bonds, service bonds, probation, and reputation.
 */

import { IdentityId, Timestamp, Units } from '../../types/common';

// ============================================
// SPONSOR BOND TYPES
// ============================================

/** Status of a sponsor bond */
export type SponsorBondStatus = 'ACTIVE' | 'RELEASED' | 'FORFEITED';

/** Sponsor bond for vouching for new members */
export interface SponsorBond {
  /** Unique bond ID */
  id: string;
  /** Sponsor member ID */
  sponsorId: IdentityId;
  /** Sponsee (new member) ID */
  sponseeId: IdentityId;
  /** Amount at risk (portion of sponsor's limit) */
  bondAmount: Units;
  /** Risk share fraction (0-1, portion of default to absorb) */
  riskShare: number;
  /** Current bond status */
  status: SponsorBondStatus;
  /** When bond was created */
  createdAt: Timestamp;
  /** When bond matures (can be released) */
  maturesAt: Timestamp;
  /** When bond was released/forfeited */
  resolvedAt?: Timestamp;
  /** Amount forfeited (if forfeited) */
  amountForfeited?: Units;
  /** Resolution reason */
  resolutionReason?: string;
}

/** Input for creating a sponsor bond */
export interface CreateSponsorBondInput {
  /** Sponsor member ID */
  sponsorId: IdentityId;
  /** Sponsee (applicant) ID */
  sponseeId: IdentityId;
  /** Bond amount (defaults to sponsor config) */
  bondAmount?: Units;
  /** Risk share (defaults to sponsor config) */
  riskShare?: number;
  /** Probation duration in days */
  probationDays?: number;
}

/** Configuration for sponsor bonds */
export interface SponsorBondConfig {
  /** Default bond amount as fraction of sponsor's limit (0-1) */
  defaultBondFraction: number;
  /** Default risk share (0-1) */
  defaultRiskShare: number;
  /** Default probation duration in days */
  defaultProbationDays: number;
  /** Maximum active sponsees per sponsor */
  maxActiveSponsees: number;
  /** Minimum sponsor tenure in days */
  minSponsorTenureDays: number;
  /** Minimum sponsor fulfillment rate */
  minSponsorFulfillmentRate: number;
}

/** Default sponsor bond configuration */
export const DEFAULT_SPONSOR_BOND_CONFIG: SponsorBondConfig = {
  defaultBondFraction: 0.2,    // 20% of sponsor's limit
  defaultRiskShare: 0.5,       // Sponsor absorbs 50% of default
  defaultProbationDays: 90,    // 3 month probation
  maxActiveSponsees: 3,        // Max 3 active sponsees
  minSponsorTenureDays: 180,   // 6 months minimum tenure
  minSponsorFulfillmentRate: 0.8, // 80% fulfillment rate
};

// ============================================
// SERVICE BOND TYPES
// ============================================

/** Status of a service bond */
export type ServiceBondStatus = 'ACTIVE' | 'GRADUATED' | 'FAILED';

/** Service bond for earning before full limits */
export interface ServiceBond {
  /** Bond ID */
  id: string;
  /** Member ID */
  memberId: IdentityId;
  /** Required service hours to earn full limits */
  requiredHours: number;
  /** Completed service hours */
  completedHours: number;
  /** Credit limit during bond period (reduced) */
  limitDuringBond: Units;
  /** Full credit limit after graduation */
  fullLimit: Units;
  /** Current bond status */
  status: ServiceBondStatus;
  /** When bond was created */
  createdAt: Timestamp;
  /** When member graduated */
  graduatedAt?: Timestamp;
  /** Service records */
  serviceRecords: ServiceRecord[];
}

/** Record of service completed */
export interface ServiceRecord {
  /** Record ID */
  id: string;
  /** Associated commitment ID (if applicable) */
  commitmentId?: string;
  /** Hours of service */
  hours: number;
  /** Quality rating (1-5) */
  rating?: number;
  /** Verified by */
  verifiedBy: IdentityId;
  /** When service was completed */
  completedAt: Timestamp;
}

/** Input for recording service */
export interface RecordServiceInput {
  /** Member ID */
  memberId: IdentityId;
  /** Hours of service */
  hours: number;
  /** Associated commitment ID */
  commitmentId?: string;
  /** Quality rating */
  rating?: number;
  /** Verifier ID */
  verifiedBy: IdentityId;
}

/** Configuration for service bonds */
export interface ServiceBondConfig {
  /** Required hours for graduation */
  requiredHours: number;
  /** Limit multiplier during bond (0-1) */
  limitMultiplier: number;
  /** Minimum rating to count service */
  minAcceptableRating: number;
  /** Maximum hours per day that count */
  maxHoursPerDay: number;
}

/** Default service bond configuration */
export const DEFAULT_SERVICE_BOND_CONFIG: ServiceBondConfig = {
  requiredHours: 40,           // 40 hours to graduate
  limitMultiplier: 0.5,        // 50% of full limit during bond
  minAcceptableRating: 3,      // 3/5 minimum rating
  maxHoursPerDay: 8,           // Max 8 hours/day count
};

// ============================================
// PROBATION TYPES
// ============================================

/** Probation status */
export type ProbationStatus = 'PROBATION' | 'GRADUATED' | 'FAILED';

/** Restrictions during probation */
export interface ProbationRestrictions {
  /** Limit multiplier (0-1, e.g., 0.5 = 50% of normal limit) */
  limitMultiplier: number;
  /** Can only create escrowed commitments */
  escrowedOnly: boolean;
  /** Can vote in governance */
  governanceVoting: boolean;
  /** Can sponsor new members */
  canSponsor: boolean;
  /** Can participate in federation transactions */
  canFederate: boolean;
}

/** Probation state for a member */
export interface ProbationState {
  /** Member ID */
  memberId: IdentityId;
  /** Current status */
  status: ProbationStatus;
  /** Active restrictions */
  restrictions: ProbationRestrictions;
  /** When probation started */
  startedAt: Timestamp;
  /** When probation ends (if on schedule) */
  scheduledEndAt: Timestamp;
  /** When member graduated */
  graduatedAt?: Timestamp;
  /** When member failed */
  failedAt?: Timestamp;
  /** Failure reason */
  failureReason?: string;
  /** Sponsor bond ID (if sponsored) */
  sponsorBondId?: string;
  /** Service bond ID (if applicable) */
  serviceBondId?: string;
  /** Warnings received */
  warnings: ProbationWarning[];
  /** Progress metrics */
  progress: ProbationProgress;
}

/** Warning issued during probation */
export interface ProbationWarning {
  /** Warning ID */
  id: string;
  /** Warning type */
  type: 'LATE_FULFILLMENT' | 'LOW_QUALITY' | 'DISPUTE' | 'LIMIT_VIOLATION' | 'OTHER';
  /** Description */
  description: string;
  /** When issued */
  issuedAt: Timestamp;
  /** Issued by */
  issuedBy: IdentityId;
}

/** Progress metrics during probation */
export interface ProbationProgress {
  /** Commitments fulfilled */
  commitmentsFulfilled: number;
  /** Commitments cancelled */
  commitmentsCancelled: number;
  /** Average fulfillment rating */
  avgRating: number;
  /** Days without warnings */
  daysWithoutWarnings: number;
  /** Service hours completed (if service bond) */
  serviceHoursCompleted: number;
}

/** Configuration for probation */
export interface ProbationConfig {
  /** Default restrictions */
  defaultRestrictions: ProbationRestrictions;
  /** Warnings before failure */
  maxWarnings: number;
  /** Required fulfillment rate for graduation */
  requiredFulfillmentRate: number;
  /** Minimum commitments to graduate */
  minCommitmentsForGraduation: number;
  /** Grace period for new members (days) */
  gracePeriodDays: number;
}

/** Default probation configuration */
export const DEFAULT_PROBATION_CONFIG: ProbationConfig = {
  defaultRestrictions: {
    limitMultiplier: 0.5,
    escrowedOnly: true,
    governanceVoting: false,
    canSponsor: false,
    canFederate: false,
  },
  maxWarnings: 3,
  requiredFulfillmentRate: 0.9,
  minCommitmentsForGraduation: 5,
  gracePeriodDays: 14,
};

// ============================================
// REPUTATION TYPES (Advisory Only)
// ============================================

/** Reputation signal for a member (advisory only, not enforced) */
export interface ReputationSignal {
  /** Member ID */
  memberId: IdentityId;
  /** Overall score (0-100) */
  score: number;
  /** Score components */
  components: ReputationComponents;
  /** Computed at */
  computedAt: Timestamp;
  /** Trend (positive = improving) */
  trend: number;
  /** Risk indicators */
  riskIndicators: RiskIndicator[];
}

/** Components of reputation score */
export interface ReputationComponents {
  /** Tenure component (time as member) */
  tenure: number;
  /** Fulfillment component (commitment completion rate) */
  fulfillment: number;
  /** Transaction history quality */
  transactions: number;
  /** Sponsor score (inherited from sponsor) */
  sponsor: number;
  /** Dispute component (negative for disputes) */
  disputes: number;
  /** Community endorsements */
  endorsements: number;
}

/** Risk indicator in reputation */
export interface RiskIndicator {
  /** Indicator type */
  type: 'HIGH_VELOCITY' | 'APPROACHING_FLOOR' | 'LOW_FULFILLMENT' | 'RECENT_DISPUTES' | 'SYBIL_PATTERN' | 'COLLUSION_PATTERN';
  /** Severity (0-1) */
  severity: number;
  /** Description */
  description: string;
  /** Evidence */
  evidence?: Record<string, unknown>;
}

/** Configuration for reputation scoring */
export interface ReputationConfig {
  /** Weight for each component (should sum to 1) */
  weights: {
    tenure: number;
    fulfillment: number;
    transactions: number;
    sponsor: number;
    disputes: number;
    endorsements: number;
  };
  /** Tenure score parameters */
  tenureParams: {
    /** Days for max tenure score */
    maxDays: number;
  };
  /** Decay rate for historical events */
  decayRate: number;
  /** Minimum score threshold for warnings */
  warningThreshold: number;
}

/** Default reputation configuration */
export const DEFAULT_REPUTATION_CONFIG: ReputationConfig = {
  weights: {
    tenure: 0.15,
    fulfillment: 0.30,
    transactions: 0.20,
    sponsor: 0.10,
    disputes: 0.15,
    endorsements: 0.10,
  },
  tenureParams: {
    maxDays: 365, // 1 year for max tenure score
  },
  decayRate: 0.95, // 5% decay per period
  warningThreshold: 30,
};

// ============================================
// SYBIL DETECTION TYPES
// ============================================

/** Sybil detection result */
export interface SybilDetectionResult {
  /** Member being evaluated */
  memberId: IdentityId;
  /** Is likely sybil? */
  isLikelySybil: boolean;
  /** Confidence (0-1) */
  confidence: number;
  /** Detected patterns */
  patterns: SybilPattern[];
  /** Related accounts (potential sybils) */
  relatedAccounts: IdentityId[];
  /** Recommended action */
  recommendedAction: 'NONE' | 'MONITOR' | 'RESTRICT' | 'INVESTIGATE';
}

/** Sybil attack pattern */
export interface SybilPattern {
  /** Pattern type */
  type: 'SIMILAR_BEHAVIOR' | 'COORDINATED_ACTIVITY' | 'SHARED_SPONSOR' | 'TIMING_PATTERN' | 'TRANSACTION_PATTERN';
  /** Pattern description */
  description: string;
  /** Confidence (0-1) */
  confidence: number;
  /** Evidence */
  evidence: Record<string, unknown>;
}

// ============================================
// ERROR TYPES
// ============================================

/** Errors for Sybil resistance operations */
export enum SybilErrorCode {
  /** Sponsor not eligible */
  SPONSOR_NOT_ELIGIBLE = 'SPONSOR_NOT_ELIGIBLE',
  /** Max sponsees reached */
  MAX_SPONSEES_REACHED = 'MAX_SPONSEES_REACHED',
  /** Bond not found */
  BOND_NOT_FOUND = 'BOND_NOT_FOUND',
  /** Invalid bond state */
  INVALID_BOND_STATE = 'INVALID_BOND_STATE',
  /** Probation violation */
  PROBATION_VIOLATION = 'PROBATION_VIOLATION',
  /** Member not on probation */
  NOT_ON_PROBATION = 'NOT_ON_PROBATION',
  /** Service verification failed */
  SERVICE_VERIFICATION_FAILED = 'SERVICE_VERIFICATION_FAILED',
  /** Storage error */
  STORAGE_ERROR = 'STORAGE_ERROR',
}

/** Sybil resistance error */
export interface SybilError {
  code: SybilErrorCode;
  message: string;
  details?: Record<string, unknown>;
}
