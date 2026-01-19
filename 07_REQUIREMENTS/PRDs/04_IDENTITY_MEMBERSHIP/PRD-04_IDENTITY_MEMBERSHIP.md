# PRD-04: Identity & Membership System

## Document Information
- **Version**: 1.0
- **Status**: Draft
- **Dependencies**: PRD-01 (Core Ledger)
- **Dependents**: PRD-05 (Governance)

---

## 1. Overview

The Identity & Membership System manages cell-scoped identities, admission controls, and Sybil resistance mechanisms. Unlike global identity systems, this is designed for local trust without central identity providers.

### Design Philosophy
- **Local-first**: Identities are cell-scoped, not global
- **Bounded damage**: Identity compromise limited by credit limits
- **Social verification**: Admission through local knowledge, not central KYC
- **Sybil resistance**: Friction mechanisms, not perfect prevention

---

## 2. Identity Model

### 2.1 Cell-Scoped Identity

```typescript
interface CellIdentity {
  id: IdentityId;                    // Cryptographic public key
  cellId: CellId;                    // Cell this identity belongs to
  displayName: string;               // Human-readable name
  publicKey: PublicKey;              // Ed25519 public key
  metadata: IdentityMetadata;
  membershipStatus: MembershipStatus;
  admissionInfo: AdmissionInfo;
  bondInfo?: BondInfo;               // If bonded admission
  createdAt: Timestamp;
  lastActiveAt: Timestamp;
}

interface IdentityMetadata {
  skills?: string[];                 // Self-declared skills
  location?: string;                 // Approximate location
  contactInfo?: string;              // Optional contact method
  bio?: string;                      // Brief description
  avatar?: string;                   // Optional avatar URL/hash
}

type MembershipStatus =
  | 'PENDING'      // Awaiting admission approval
  | 'PROBATION'    // Admitted with restricted limits
  | 'ACTIVE'       // Full member
  | 'FROZEN'       // Temporarily suspended
  | 'EXCLUDED';    // Permanently removed

interface AdmissionInfo {
  admittedAt: Timestamp;
  admittedBy: IdentityId[];          // Sponsors/council members
  admissionMethod: AdmissionMethod;
  probationEndsAt?: Timestamp;
}

type AdmissionMethod =
  | 'FOUNDING_MEMBER'
  | 'GOVERNANCE_VOTE'
  | 'SPONSOR_BOND'
  | 'SERVICE_BOND'
  | 'PHYSICAL_BOND';
```

### 2.2 Key Management

```typescript
interface KeyPair {
  publicKey: PublicKey;
  privateKey: PrivateKey;  // Never leaves device
}

// Key derivation for deterministic recovery
interface KeyDerivation {
  method: 'BIP39' | 'PBKDF2';
  params: KeyDerivationParams;
}
```

---

## 3. Sybil Resistance Mechanisms

### 3.1 Overview

Sybil attacks multiply extraction potential: `G_attack = S * L`. The goal is to keep effective `S` small through admission friction.

### 3.2 Admission Bond Types

#### 3.2.1 Sponsor Bond
An existing member vouches for the newcomer and shares risk.

```typescript
interface SponsorBond {
  type: 'SPONSOR';
  sponsorId: IdentityId;
  newMemberId: IdentityId;
  riskShare: number;         // 0.1-0.5: fraction of loss sponsor absorbs
  limitReduction: number;    // Sponsor's L reduced during probation
  probationPeriod: number;   // Days until bond released
}
```

**Mechanism**:
- Sponsor's limit reduced by `limitReduction` during probation
- If newcomer defects, sponsor's balance debited `riskShare * defaultAmount`
- After probation, bond released

#### 3.2.2 Service Bond
Newcomer must contribute before receiving full limits.

```typescript
interface ServiceBond {
  type: 'SERVICE';
  newMemberId: IdentityId;
  requiredHours: Units;      // Hours to complete
  completedHours: Units;
  limitDuringBond: Units;    // Reduced limit during service
  fullLimit: Units;          // Limit after bond complete
  deadline: Timestamp;
}
```

**Mechanism**:
- Newcomer starts with reduced limit
- Must complete `requiredHours` of verified tasks
- Upon completion, limit raised to full amount
- Failure to complete by deadline triggers governance review

#### 3.2.3 Physical Bond
Locally held goods/tool deposit (tight communities only).

```typescript
interface PhysicalBond {
  type: 'PHYSICAL';
  newMemberId: IdentityId;
  description: string;       // What was deposited
  estimatedValue: Units;
  custodianId: IdentityId;   // Who holds the item
  releaseConditions: string;
}
```

---

## 4. Admission Process

### 4.1 Admission Flow

```
┌─────────────────┐
│   APPLICATION   │
│  (Identity +    │
│   Metadata)     │
└────────┬────────┘
         │
         v
┌─────────────────┐     ┌─────────────────┐
│  BOND SELECTION │────>│  SPONSOR FOUND  │
│  (if required)  │     │  (if sponsor    │
└────────┬────────┘     │   bond)         │
         │              └────────┬────────┘
         v                       │
┌─────────────────┐              │
│   GOVERNANCE    │<─────────────┘
│     VOTE        │
└────────┬────────┘
         │
    vote passes
         │
         v
┌─────────────────┐
│   PROBATION     │
│  (reduced L,    │
│   bond active)  │
└────────┬────────┘
         │
    bond satisfied
         │
         v
┌─────────────────┐
│     ACTIVE      │
│  (full member)  │
└─────────────────┘
```

### 4.2 Admission Requirements

```typescript
interface AdmissionRequirements {
  // Governance requirements
  minQuorum: number;           // Minimum votes needed
  approvalThreshold: number;   // Fraction that must approve
  discussionPeriodDays: number;

  // Bond requirements (policy-dependent)
  bondRequired: boolean;
  allowedBondTypes: AdmissionMethod[];
  defaultBondType: AdmissionMethod;

  // Probation
  probationPeriodDays: number;
  probationLimitFactor: number;  // L_probation = factor * L_default

  // Emergency mode adjustments
  emergencyApprovalThreshold: number;  // Higher in stressed/panic
  emergencyBondRequired: boolean;
}
```

---

## 5. Functional Requirements

### 5.1 Identity Creation

#### FR-1.1: Key Generation
- Generate Ed25519 keypair on device
- Optional: derive from mnemonic for recovery

#### FR-1.2: Identity Registration
- Register public key with cell
- Provide required metadata
- Identity in PENDING status until admitted

### 5.2 Admission

#### FR-2.1: Application Submission
- Submit identity and metadata to cell
- Select bond type if required
- Identify sponsor if sponsor bond

#### FR-2.2: Governance Vote
- Governance council reviews application
- Vote conducted per governance rules
- Quorum and threshold must be met

#### FR-2.3: Bond Activation
- If approved, bond activated
- Initial limit set based on bond type and probation rules

#### FR-2.4: Probation Management
- Track probation period
- Monitor bond completion (service bond)
- Transition to ACTIVE when requirements met

### 5.3 Exclusion

#### FR-3.1: Automatic Exclusion Trigger
- Member at hard floor (`b_i = -L_i`) is automatically restricted
- Cannot initiate payments until balance improves

#### FR-3.2: Governance Exclusion
- Governance can freeze or exclude members
- Requires documented reason and vote
- Balance handling on exclusion (debt remains, subject to restitution plan)

#### FR-3.3: Sponsor Penalty
- If bonded member defects, sponsor penalized
- Penalty proportional to riskShare

### 5.4 Identity Queries

#### FR-4.1: Member Lookup
- Get member by ID
- Search by display name (fuzzy)
- Filter by status, skills

#### FR-4.2: Reputation Signals
- Fulfillment rate from commitments
- Transaction history summary
- Dispute involvement

---

## 6. API Specification

```typescript
interface IIdentityEngine {
  // Key Management
  generateKeyPair(): KeyPair;
  deriveKeyPair(mnemonic: string): KeyPair;

  // Identity Creation
  createIdentity(params: CreateIdentityParams): Result<CellIdentity, IdentityError>;
  updateIdentityMetadata(id: IdentityId, metadata: Partial<IdentityMetadata>): Result<void, IdentityError>;

  // Admission
  submitApplication(identity: CellIdentity, bondType?: AdmissionMethod): Result<string, IdentityError>;
  getApplicationStatus(applicationId: string): ApplicationStatus;
  cancelApplication(applicationId: string): Result<void, IdentityError>;

  // Sponsor Bond
  offerSponsorship(newMemberId: IdentityId, params: SponsorBondParams): Result<void, IdentityError>;
  acceptSponsorship(sponsorshipId: string, signature: Signature): Result<void, IdentityError>;

  // Service Bond
  recordServiceCompletion(memberId: IdentityId, hours: Units, taskId: string): Result<void, IdentityError>;
  getServiceBondProgress(memberId: IdentityId): ServiceBondProgress;

  // Status Management
  freezeMember(memberId: IdentityId, reason: string): Result<void, IdentityError>;
  unfreezeMember(memberId: IdentityId): Result<void, IdentityError>;
  excludeMember(memberId: IdentityId, reason: string): Result<void, IdentityError>;

  // Queries
  getMember(id: IdentityId): CellIdentity | null;
  getMembers(filter?: MemberFilter): CellIdentity[];
  searchMembers(query: string): CellIdentity[];
  getMemberReputation(id: IdentityId): ReputationSignals;

  // Probation
  checkProbationStatus(memberId: IdentityId): ProbationStatus;
  completeProbation(memberId: IdentityId): Result<void, IdentityError>;
}

interface CreateIdentityParams {
  publicKey: PublicKey;
  displayName: string;
  metadata?: IdentityMetadata;
}

interface SponsorBondParams {
  riskShare: number;
  limitReduction: Units;
  probationDays: number;
}

interface ReputationSignals {
  commitmentFulfillmentRate: number;
  averageTransactionRating?: number;
  disputeCount: number;
  memberSince: Timestamp;
  totalContributed: Units;
  totalReceived: Units;
}

interface ProbationStatus {
  inProbation: boolean;
  startedAt?: Timestamp;
  endsAt?: Timestamp;
  bondType?: AdmissionMethod;
  bondProgress?: {
    serviceBondHoursCompleted?: Units;
    serviceBondHoursRequired?: Units;
  };
}

type IdentityError =
  | { type: 'IDENTITY_EXISTS'; id: IdentityId }
  | { type: 'IDENTITY_NOT_FOUND'; id: IdentityId }
  | { type: 'INVALID_PUBLIC_KEY' }
  | { type: 'APPLICATION_NOT_FOUND'; applicationId: string }
  | { type: 'SPONSOR_NOT_FOUND'; sponsorId: IdentityId }
  | { type: 'SPONSOR_INSUFFICIENT_CAPACITY' }
  | { type: 'NOT_IN_PROBATION' }
  | { type: 'PROBATION_INCOMPLETE' }
  | { type: 'ALREADY_EXCLUDED' };
```

---

## 7. Security Model

### 7.1 Threat: Sybil Attack

**Attack**: Create multiple identities to multiply extraction

**Mitigation**:
- Admission friction (bonds, governance vote)
- Bounded extraction per identity: `G_i <= L_i`
- Even successful Sybil limited to `S * L`
- Sponsor bonds create accountability chains

### 7.2 Threat: Identity Theft

**Attack**: Compromise private key, impersonate member

**Mitigation**:
- Device-local key storage
- Optional key rotation with governance approval
- Transaction limits provide bounded damage
- Unusual activity detection (future)

### 7.3 Threat: Collusive Sponsorship

**Attack**: Colluders sponsor each other to bypass friction

**Mitigation**:
- Sponsor risk share creates real cost
- Sponsor limit reduction during probation
- Reputation tracking of sponsor success rate
- Rate limiting on sponsorships per member

---

## 8. Reputation System (Advisory Only)

### 8.1 Principles
- Reputation is **advisory**, not deterministic
- Influences limit adjustments (bounded by `L_min`, `L_max`)
- Rate-limited changes: `|L_i(t+1) - L_i(t)| <= eta`
- Never auto-expels, only advises governance

### 8.2 Reputation Signals

```typescript
interface ReputationScore {
  overall: number;           // 0-1 composite
  components: {
    reliability: number;     // Commitment fulfillment rate
    activity: number;        // Transaction frequency
    standing: number;        // Time in good standing
    contribution: number;    // Net value provided
    disputes: number;        // Dispute involvement (negative)
  };
  lastUpdated: Timestamp;
}

// Reputation influences limit adjustment suggestions
function suggestLimitAdjustment(memberId: IdentityId): {
  currentLimit: Units;
  suggestedLimit: Units;
  reason: string;
  boundedByRate: boolean;
} {
  const rep = getReputationScore(memberId);
  const current = ledger.getMemberState(memberId).limit;

  // Simple linear mapping
  const target = L_min + rep.overall * (L_max - L_min);

  // Rate limit
  const maxDelta = eta;
  const suggestedLimit = Math.min(
    Math.max(target, current - maxDelta),
    current + maxDelta
  );

  return {
    currentLimit: current,
    suggestedLimit: Math.round(suggestedLimit * 100) / 100,
    reason: generateReason(rep),
    boundedByRate: Math.abs(target - suggestedLimit) > 0.01
  };
}
```

---

## 9. Test Cases

### 9.1 Unit Tests

| ID | Test | Expected |
|----|------|----------|
| ID-01 | Generate valid keypair | Success |
| ID-02 | Create identity with valid key | Success |
| ID-03 | Create duplicate identity | Fail: IDENTITY_EXISTS |
| ID-04 | Submit application without bond | Success (if allowed) |
| ID-05 | Sponsor with insufficient capacity | Fail: SPONSOR_INSUFFICIENT_CAPACITY |
| ID-06 | Complete service bond hours | Transition to ACTIVE |
| ID-07 | Freeze active member | Status changes to FROZEN |
| ID-08 | Exclude member | Status changes to EXCLUDED |

### 9.2 Integration Tests

| ID | Test |
|----|------|
| ID-I1 | Full sponsor bond admission flow |
| ID-I2 | Full service bond admission flow |
| ID-I3 | Sponsor penalty on new member defection |
| ID-I4 | Probation completion and limit upgrade |

---

## 10. Acceptance Criteria

- [ ] Key generation and storage working
- [ ] Application submission and tracking functional
- [ ] Sponsor bond mechanics implemented
- [ ] Service bond progress tracking working
- [ ] Status transitions enforced correctly
- [ ] Reputation signals computed accurately
- [ ] Sybil friction demonstrably effective in tests
