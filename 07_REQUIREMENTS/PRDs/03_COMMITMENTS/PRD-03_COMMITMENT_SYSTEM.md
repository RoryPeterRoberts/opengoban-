# PRD-03: Commitment System

## Document Information
- **Version**: 1.0
- **Status**: Draft
- **Dependencies**: PRD-01 (Core Ledger), PRD-02 (Transactions)
- **Dependents**: PRD-08 (Survival Scheduler)

---

## 1. Overview

The Commitment System enables future-dated obligations essential for survival economies. Unlike spot transactions, commitments allow scheduling of essential services (food rotations, childcare shifts, repair duties) with optional capacity escrow to prevent over-commitment.

### Purpose
- Support scheduled obligations for survival coordination
- Prevent "over-consume then disappear" attacks via escrow
- Enable reliable essential task coverage
- Provide enforcement primitives for the Survival Scheduler

---

## 2. Commitment Types

### 2.1 C0: Soft Commitment (Record Only)
A soft commitment records intent but does not constrain spending capacity.

```typescript
interface SoftCommitment {
  id: CommitmentId;
  type: 'SOFT';
  promisor: IdentityId;   // Who will provide service/goods
  promisee: IdentityId;   // Who will receive service/goods
  value: Units;           // Credit value of the commitment
  dueDate: Timestamp;     // When service should be delivered
  description: string;
  category: TaskCategory;
  status: CommitmentStatus;
  createdAt: Timestamp;
  signatures: {
    promisor: Signature;
    promisee: Signature;
  };
}
```

**Pros**: Simple, low friction, flexible
**Cons**: Higher default risk - promisor can over-extend

### 2.2 C1: Escrowed Commitment (Capacity Reserve)
An escrowed commitment reserves the promisor's spending capacity.

```typescript
interface EscrowedCommitment extends SoftCommitment {
  type: 'ESCROWED';
  reservedAmount: Units;  // Capacity held in reserve
}
```

**Mechanism**:
- On creation: `r_promisor += value`
- Must satisfy: `b_promisor - r_promisor - value >= -L_promisor`
- On fulfillment: `r_promisor -= value`, then normal transaction executes
- On cancellation: `r_promisor -= value` (with governance approval)

**Pros**: Prevents over-commitment, reduces exit scam capacity
**Cons**: Less flexible, can feel restrictive

---

## 3. Commitment Lifecycle

```
                    ┌──────────────┐
                    │   PROPOSED   │
                    │ (promisor    │
                    │  signed)     │
                    └──────┬───────┘
                           │
                     promisee signs
                           │
                           v
                    ┌──────────────┐
           ┌────────│   ACTIVE     │────────┐
           │        │ (both signed)│        │
           │        └──────┬───────┘        │
           │               │                │
     mutual consent    delivery        dispute/
     or governance     confirmed       governance
           │               │                │
           v               v                v
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │  CANCELLED   │ │  FULFILLED   │ │   DISPUTED   │
    │              │ │              │ │              │
    └──────────────┘ └──────────────┘ └──────────────┘
                           │                │
                           │           resolution
                           │                │
                           v                v
                    ┌──────────────────────────┐
                    │      (Terminal State)    │
                    └──────────────────────────┘
```

---

## 4. Functional Requirements

### 4.1 Commitment Creation

#### FR-1.1: Validation at Creation
- Both parties MUST be active members
- Value MUST be > 0
- Due date MUST be in the future

#### FR-1.2: Escrow Feasibility (Escrowed Mode)
```
b_promisor - r_promisor - value >= -L_promisor
```
- Promisor must have capacity to reserve

#### FR-1.3: Reserve Update (Escrowed Mode)
- On successful creation: `r_promisor += value`

#### FR-1.4: Signature Requirements
- Both parties must sign for commitment to become ACTIVE
- PROPOSED state allows promisor-only signature

### 4.2 Commitment Fulfillment

#### FR-2.1: Fulfillment Trigger
- Triggered when service/goods delivered and confirmed
- Requires confirmation from promisee (or governance override)

#### FR-2.2: Reserve Release (Escrowed Mode)
- Release reserve: `r_promisor -= value`

#### FR-2.3: Transaction Execution
- Execute spot transaction: promisor pays promisee
- Same validation as T1 (but reserve already accounted for)

### 4.3 Commitment Cancellation

#### FR-3.1: Cancellation Conditions
Cancellation allowed only when:
- Mutual consent (both parties sign cancellation), OR
- Governance decision (dispute resolution)

#### FR-3.2: Reserve Release on Cancellation
- Escrowed mode: `r_promisor -= value`
- No balance changes (no transaction executed)

### 4.4 Commitment Queries

#### FR-4.1: Query by Member
- List commitments where member is promisor or promisee
- Filter by status, category, date range

#### FR-4.2: Query by Status
- ACTIVE: pending fulfillment
- OVERDUE: past due date, not fulfilled

#### FR-4.3: Coverage Reports
- Total committed hours by task category
- Fulfillment rate by member

---

## 5. Data Models

```typescript
type CommitmentId = string;
type CommitmentStatus = 'PROPOSED' | 'ACTIVE' | 'FULFILLED' | 'CANCELLED' | 'DISPUTED';

interface Commitment {
  id: CommitmentId;
  type: 'SOFT' | 'ESCROWED';
  promisor: IdentityId;
  promisee: IdentityId;
  value: Units;
  dueDate: Timestamp;
  description: string;
  category: TaskCategory;
  status: CommitmentStatus;
  createdAt: Timestamp;
  fulfilledAt?: Timestamp;
  cancelledAt?: Timestamp;
  cancelReason?: string;
  relatedDisputeId?: string;
  relatedTransactionId?: string;
  signatures: {
    promisor?: Signature;
    promisee?: Signature;
    cancellation?: {
      promisor?: Signature;
      promisee?: Signature;
    };
  };
}

type TaskCategory =
  | 'FOOD'
  | 'WATER_SANITATION'
  | 'ENERGY_HEAT'
  | 'SHELTER_REPAIR'
  | 'MEDICAL'
  | 'CHILDCARE'
  | 'SECURITY_COORDINATION'
  | 'PROCUREMENT_TRANSPORT'
  | 'OTHER';
```

---

## 6. API Specification

```typescript
interface ICommitmentEngine {
  // Creation
  createCommitment(params: CreateCommitmentParams): Result<Commitment, CommitmentError>;
  proposeCommitment(params: ProposeCommitmentParams): Result<Commitment, CommitmentError>;
  acceptCommitment(id: CommitmentId, promiseeSignature: Signature): Result<Commitment, CommitmentError>;

  // Lifecycle
  fulfillCommitment(id: CommitmentId, confirmation: FulfillmentConfirmation): Result<CommitmentFulfillmentResult, CommitmentError>;
  cancelCommitment(id: CommitmentId, cancellation: CancellationRequest): Result<Commitment, CommitmentError>;
  disputeCommitment(id: CommitmentId, claim: string, evidence: string[]): Result<Dispute, CommitmentError>;

  // Queries
  getCommitment(id: CommitmentId): Commitment | null;
  getCommitmentsByMember(memberId: IdentityId, options?: QueryOptions): Commitment[];
  getActiveCommitments(): Commitment[];
  getOverdueCommitments(): Commitment[];
  getCommitmentsByCategory(category: TaskCategory): Commitment[];

  // Analytics
  getMemberReservedCapacity(memberId: IdentityId): Units;
  getMemberCommitmentStats(memberId: IdentityId): CommitmentStats;
  getCategoryFulfillmentRate(category: TaskCategory): number;
}

interface CreateCommitmentParams {
  type: 'SOFT' | 'ESCROWED';
  promisor: IdentityId;
  promisee: IdentityId;
  value: Units;
  dueDate: Timestamp;
  description: string;
  category: TaskCategory;
  promisorSignature: Signature;
  promiseeSignature: Signature;
}

interface FulfillmentConfirmation {
  promiseeSignature: Signature;
  notes?: string;
  actualDeliveryDate?: Timestamp;
  qualityRating?: 1 | 2 | 3 | 4 | 5;  // Optional feedback
}

interface CancellationRequest {
  reason: string;
  initiator: IdentityId;
  initiatorSignature: Signature;
  counterpartySignature?: Signature;  // Required unless governance override
  governanceApprovalId?: string;       // If via governance
}

interface CommitmentStats {
  totalPromised: Units;
  totalReceived: Units;
  fulfillmentRate: number;
  averageDelayDays: number;
  disputeRate: number;
}

type CommitmentError =
  | { type: 'MEMBER_NOT_FOUND'; memberId: IdentityId }
  | { type: 'MEMBER_NOT_ACTIVE'; memberId: IdentityId }
  | { type: 'INSUFFICIENT_RESERVE_CAPACITY'; available: Units; required: Units }
  | { type: 'INVALID_DUE_DATE'; dueDate: Timestamp }
  | { type: 'COMMITMENT_NOT_FOUND'; commitmentId: CommitmentId }
  | { type: 'INVALID_STATUS_TRANSITION'; from: CommitmentStatus; to: CommitmentStatus }
  | { type: 'INVALID_SIGNATURE'; party: string }
  | { type: 'CANCELLATION_NOT_AUTHORIZED' }
  | { type: 'ALREADY_FULFILLED' }
  | { type: 'LEDGER_ERROR'; error: LedgerError };
```

---

## 7. Algorithms

### 7.1 Create Escrowed Commitment

```typescript
function createEscrowedCommitment(params: CreateCommitmentParams): Result<Commitment, CommitmentError> {
  // 1. Validate members
  const promisor = ledger.getMemberState(params.promisor);
  const promisee = ledger.getMemberState(params.promisee);

  if (!promisor || promisor.status !== 'ACTIVE') {
    return err({ type: 'MEMBER_NOT_ACTIVE', memberId: params.promisor });
  }
  if (!promisee || promisee.status !== 'ACTIVE') {
    return err({ type: 'MEMBER_NOT_ACTIVE', memberId: params.promisee });
  }

  // 2. Validate due date
  if (params.dueDate <= Date.now()) {
    return err({ type: 'INVALID_DUE_DATE', dueDate: params.dueDate });
  }

  // 3. Check escrow capacity
  const available = ledger.getAvailableBalance(params.promisor);
  if (available < params.value) {
    return err({
      type: 'INSUFFICIENT_RESERVE_CAPACITY',
      available,
      required: params.value
    });
  }

  // 4. Verify signatures
  // ... signature verification ...

  // 5. Apply reserve
  const reserveResult = ledger.applyReserveUpdate({
    memberId: params.promisor,
    delta: params.value,
    reason: 'COMMITMENT_CREATE',
    commitmentId: newCommitmentId
  });

  if (reserveResult.isErr()) {
    return err({ type: 'LEDGER_ERROR', error: reserveResult.error });
  }

  // 6. Store commitment
  const commitment: Commitment = {
    id: newCommitmentId,
    type: 'ESCROWED',
    status: 'ACTIVE',
    ...params,
    createdAt: Date.now()
  };

  commitmentStore.save(commitment);

  return ok(commitment);
}
```

### 7.2 Fulfill Commitment

```typescript
function fulfillCommitment(
  id: CommitmentId,
  confirmation: FulfillmentConfirmation
): Result<CommitmentFulfillmentResult, CommitmentError> {
  // 1. Get commitment
  const commitment = commitmentStore.get(id);
  if (!commitment) {
    return err({ type: 'COMMITMENT_NOT_FOUND', commitmentId: id });
  }

  // 2. Validate status
  if (commitment.status !== 'ACTIVE') {
    return err({
      type: 'INVALID_STATUS_TRANSITION',
      from: commitment.status,
      to: 'FULFILLED'
    });
  }

  // 3. Verify confirmation signature
  // ... signature verification ...

  // 4. Release reserve (if escrowed)
  if (commitment.type === 'ESCROWED') {
    const releaseResult = ledger.applyReserveUpdate({
      memberId: commitment.promisor,
      delta: -commitment.value,
      reason: 'COMMITMENT_FULFILL',
      commitmentId: id
    });

    if (releaseResult.isErr()) {
      return err({ type: 'LEDGER_ERROR', error: releaseResult.error });
    }
  }

  // 5. Execute transaction (promisee pays promisor for service rendered)
  // Note: In mutual credit, the promisor RECEIVES credit for providing service
  const txResult = transactionEngine.executeTransaction({
    id: generateTxId(),
    type: 'SPOT',
    payer: commitment.promisee,    // Receiver of service pays
    payee: commitment.promisor,    // Provider of service receives
    amount: commitment.value,
    description: `Fulfillment: ${commitment.description}`,
    category: commitment.category,
    timestamp: Date.now(),
    metadata: { relatedCommitmentId: id }
  });

  if (txResult.isErr()) {
    // Rollback reserve release
    if (commitment.type === 'ESCROWED') {
      ledger.applyReserveUpdate({
        memberId: commitment.promisor,
        delta: commitment.value,
        reason: 'COMMITMENT_FULFILL_ROLLBACK',
        commitmentId: id
      });
    }
    return err({ type: 'LEDGER_ERROR', error: txResult.error });
  }

  // 6. Update commitment status
  commitment.status = 'FULFILLED';
  commitment.fulfilledAt = Date.now();
  commitment.relatedTransactionId = txResult.value.transactionId;
  commitmentStore.save(commitment);

  return ok({
    commitment,
    transaction: txResult.value
  });
}
```

---

## 8. Overdue Handling

### 8.1 Overdue Detection
```typescript
function getOverdueCommitments(): Commitment[] {
  return commitmentStore.query({
    status: 'ACTIVE',
    dueDate: { $lt: Date.now() }
  });
}
```

### 8.2 Overdue Escalation Policy
1. **Grace Period** (24-48 hours): Reminder notifications
2. **Warning** (48-72 hours): Reputation flag, governance notified
3. **Escalation** (72+ hours): Governance intervention required

### 8.3 Governance Actions on Overdue
- Extend due date (mutual agreement)
- Partial fulfillment credit
- Cancellation with penalty (reputation/limit adjustment)
- Freeze promisor pending resolution

---

## 9. Integration with Survival Scheduler

The Commitment System provides primitives for the Survival Scheduler (PRD-08):

```typescript
// Scheduler creates commitments for essential tasks
interface ScheduledTaskCommitment extends Commitment {
  taskSlotId: string;
  isEssential: boolean;
  substituteAllowed: boolean;
}

// Scheduler queries upcoming essential commitments
function getEssentialCommitmentsByPeriod(
  start: Timestamp,
  end: Timestamp
): ScheduledTaskCommitment[];

// Scheduler checks coverage
function getTaskCategoryCoverage(
  category: TaskCategory,
  period: { start: Timestamp; end: Timestamp }
): {
  required: Units;
  committed: Units;
  fulfilled: Units;
  gap: Units;
};
```

---

## 10. Test Cases

### 10.1 Unit Tests

| ID | Test | Expected |
|----|------|----------|
| CM-01 | Create soft commitment | Success, no reserve change |
| CM-02 | Create escrowed commitment | Success, reserve increased |
| CM-03 | Create with insufficient capacity | Fail: INSUFFICIENT_RESERVE_CAPACITY |
| CM-04 | Create with past due date | Fail: INVALID_DUE_DATE |
| CM-05 | Fulfill active commitment | Success, transaction executed |
| CM-06 | Fulfill already fulfilled | Fail: INVALID_STATUS_TRANSITION |
| CM-07 | Cancel with mutual consent | Success, reserve released |
| CM-08 | Cancel without consent | Fail: CANCELLATION_NOT_AUTHORIZED |
| CM-09 | Query overdue commitments | Returns correct set |

### 10.2 Integration Tests

| ID | Test |
|----|------|
| CM-I1 | Full lifecycle: create -> fulfill |
| CM-I2 | Full lifecycle: create -> cancel |
| CM-I3 | Escrow reserve blocks spending |
| CM-I4 | Multiple commitments respect total reserve |

---

## 11. Acceptance Criteria

- [ ] Soft commitments track obligations without capacity lock
- [ ] Escrowed commitments correctly reserve capacity
- [ ] Fulfillment executes transaction and releases reserve
- [ ] Cancellation requires proper authorization
- [ ] Overdue detection and escalation working
- [ ] Integration with ledger reserve tracking verified
- [ ] Category-based queries support scheduler integration
