# PRD-02: Transaction System

## Document Information
- **Version**: 1.0
- **Status**: Draft
- **Dependencies**: PRD-01 (Core Ledger)
- **Dependents**: PRD-03, PRD-06

---

## 1. Overview

The Transaction System handles the validation and execution of spot exchanges between cell members. It is the primary mechanism for transferring value within the mutual credit system.

### Purpose
- Validate spot transactions against ledger constraints
- Execute atomic balance transfers
- Maintain transaction history
- Support offline transaction queuing

---

## 2. Transaction Types

### 2.1 T1: Spot Transaction (Core)
A direct exchange of value between two members.

```typescript
interface SpotTransaction {
  id: TransactionId;
  type: 'SPOT';
  payer: IdentityId;      // Buyer - receives goods/services, pays credits
  payee: IdentityId;      // Seller - provides goods/services, receives credits
  amount: Units;          // Must be > 0
  description: string;    // Human-readable (e.g., "2 hours garden work")
  category?: TaskCategory; // Optional classification
  timestamp: Timestamp;
  signatures: {
    payer: Signature;
    payee: Signature;
  };
  metadata?: TransactionMetadata;
}

interface TransactionMetadata {
  location?: string;
  relatedCommitmentId?: string;
  tags?: string[];
}
```

### 2.2 Future Transaction Types
- **T2: Multi-party** (deferred to v2)
- **T3: Federation** (see PRD-06)

---

## 3. Functional Requirements

### 3.1 Transaction Validation

#### FR-1.1: Membership Check
- Both payer and payee MUST be active members of the cell
- Neither party may be in FROZEN or EXCLUDED status

#### FR-1.2: Positive Value
- Transaction amount MUST be > 0
- No zero-value or negative transactions allowed

#### FR-1.3: Payer Feasibility
```
Non-escrow mode: b_payer - amount >= -L_payer
Escrow mode:     b_payer - r_payer - amount >= -L_payer
```
- The payer must have sufficient spending capacity

#### FR-1.4: Signature Verification
- Transaction MUST be signed by both parties
- Signatures must be cryptographically valid
- Replay protection via unique transaction ID

#### FR-1.5: Idempotency
- Transaction IDs must be unique within the cell
- Duplicate submission must be rejected (not re-executed)

### 3.2 Transaction Execution

#### FR-2.1: Atomic Update
- Balance changes must be atomic
- On any failure, no balance changes occur

#### FR-2.2: State Update
```
b_payer = b_payer - amount
b_payee = b_payee + amount
```

#### FR-2.3: Event Logging
- Transaction must be appended to the event log
- Log must include full transaction details and result

### 3.3 Transaction Queries

#### FR-3.1: History
- Query transactions by member (as payer or payee)
- Query transactions by time range
- Query transactions by category

#### FR-3.2: Statistics
- Total transaction volume (sum of amounts)
- Transaction count per member
- Average transaction size

---

## 4. Validation Algorithm

```typescript
function validateSpotTransaction(tx: SpotTransaction): Result<void, TransactionError> {
  // 1. Membership checks
  const payer = ledger.getMemberState(tx.payer);
  const payee = ledger.getMemberState(tx.payee);

  if (!payer) {
    return err({ type: 'MEMBER_NOT_FOUND', memberId: tx.payer });
  }
  if (!payee) {
    return err({ type: 'MEMBER_NOT_FOUND', memberId: tx.payee });
  }
  if (payer.status !== 'ACTIVE') {
    return err({ type: 'MEMBER_NOT_ACTIVE', memberId: tx.payer, status: payer.status });
  }
  if (payee.status !== 'ACTIVE') {
    return err({ type: 'MEMBER_NOT_ACTIVE', memberId: tx.payee, status: payee.status });
  }

  // 2. Self-transaction check
  if (tx.payer === tx.payee) {
    return err({ type: 'SELF_TRANSACTION' });
  }

  // 3. Positive value check
  if (tx.amount <= 0) {
    return err({ type: 'INVALID_AMOUNT', amount: tx.amount });
  }

  // 4. Spending feasibility
  if (!ledger.canSpend(tx.payer, tx.amount)) {
    return err({
      type: 'INSUFFICIENT_CAPACITY',
      memberId: tx.payer,
      available: ledger.getAvailableBalance(tx.payer),
      required: tx.amount
    });
  }

  // 5. Idempotency check
  if (transactionLog.exists(tx.id)) {
    return err({ type: 'DUPLICATE_TRANSACTION', transactionId: tx.id });
  }

  // 6. Signature verification
  if (!verifySignature(tx.payer, tx.signatures.payer, serializeTxForSigning(tx))) {
    return err({ type: 'INVALID_SIGNATURE', party: 'payer' });
  }
  if (!verifySignature(tx.payee, tx.signatures.payee, serializeTxForSigning(tx))) {
    return err({ type: 'INVALID_SIGNATURE', party: 'payee' });
  }

  return ok(void 0);
}
```

---

## 5. Execution Algorithm

```typescript
function executeSpotTransaction(tx: SpotTransaction): Result<TransactionResult, TransactionError> {
  // 1. Validate
  const validationResult = validateSpotTransaction(tx);
  if (validationResult.isErr()) {
    return validationResult;
  }

  // 2. Prepare balance updates
  const updates: BalanceUpdate[] = [
    {
      memberId: tx.payer,
      delta: -tx.amount,
      reason: 'SPOT_TRANSACTION_PAYER',
      relatedEventId: tx.id
    },
    {
      memberId: tx.payee,
      delta: tx.amount,
      reason: 'SPOT_TRANSACTION_PAYEE',
      relatedEventId: tx.id
    }
  ];

  // 3. Apply to ledger (atomic)
  const ledgerResult = ledger.applyBalanceUpdates(updates);
  if (ledgerResult.isErr()) {
    return err({ type: 'LEDGER_ERROR', error: ledgerResult.error });
  }

  // 4. Log transaction
  transactionLog.append({
    ...tx,
    status: 'COMPLETED',
    completedAt: Date.now()
  });

  // 5. Return result
  return ok({
    transactionId: tx.id,
    payerNewBalance: ledger.getBalance(tx.payer),
    payeeNewBalance: ledger.getBalance(tx.payee),
    timestamp: Date.now()
  });
}
```

---

## 6. API Specification

```typescript
interface ITransactionEngine {
  // Core Operations
  validateTransaction(tx: SpotTransaction): Result<void, TransactionError>;
  executeTransaction(tx: SpotTransaction): Result<TransactionResult, TransactionError>;

  // Offline Support
  queueOfflineTransaction(tx: SpotTransaction): Result<void, TransactionError>;
  syncOfflineQueue(): Result<SyncResult, TransactionError>;
  getQueuedTransactions(): SpotTransaction[];

  // History & Queries
  getTransaction(id: TransactionId): SpotTransaction | null;
  getTransactionsByMember(memberId: IdentityId, options?: QueryOptions): SpotTransaction[];
  getTransactionsByTimeRange(start: Timestamp, end: Timestamp): SpotTransaction[];

  // Statistics
  getTotalVolume(timeRange?: TimeRange): Units;
  getTransactionCount(timeRange?: TimeRange): number;
  getMemberTransactionStats(memberId: IdentityId): MemberTxStats;
}

interface TransactionResult {
  transactionId: TransactionId;
  payerNewBalance: Units;
  payeeNewBalance: Units;
  timestamp: Timestamp;
}

interface QueryOptions {
  role?: 'PAYER' | 'PAYEE' | 'EITHER';
  category?: TaskCategory;
  limit?: number;
  offset?: number;
  sortOrder?: 'ASC' | 'DESC';
}

interface MemberTxStats {
  totalPaid: Units;
  totalReceived: Units;
  transactionCount: number;
  averageTransactionSize: Units;
  uniqueCounterparties: number;
}

type TransactionError =
  | { type: 'MEMBER_NOT_FOUND'; memberId: IdentityId }
  | { type: 'MEMBER_NOT_ACTIVE'; memberId: IdentityId; status: string }
  | { type: 'SELF_TRANSACTION' }
  | { type: 'INVALID_AMOUNT'; amount: Units }
  | { type: 'INSUFFICIENT_CAPACITY'; memberId: IdentityId; available: Units; required: Units }
  | { type: 'DUPLICATE_TRANSACTION'; transactionId: TransactionId }
  | { type: 'INVALID_SIGNATURE'; party: 'payer' | 'payee' }
  | { type: 'LEDGER_ERROR'; error: LedgerError };
```

---

## 7. Offline Transaction Support

### 7.1 Queue Management
- Transactions can be created and signed offline
- Queued transactions are validated locally (member status may be stale)
- On sync, transactions are re-validated and executed

### 7.2 Conflict Resolution
- Transactions are processed in timestamp order
- If a transaction fails due to insufficient capacity, it remains queued
- User is notified of failed transactions

### 7.3 Data Structure

```typescript
interface OfflineQueue {
  transactions: SpotTransaction[];
  lastSyncAt: Timestamp;
  syncStatus: 'PENDING' | 'SYNCING' | 'SYNCED';
}

interface SyncResult {
  executed: TransactionId[];
  failed: Array<{
    transactionId: TransactionId;
    error: TransactionError;
  }>;
  pending: TransactionId[];
}
```

---

## 8. Transaction Creation Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Payer     │     │    App      │     │   Payee     │
│  (Buyer)    │     │             │     │  (Seller)   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │  1. Initiate      │                   │
       │  (amount, desc)   │                   │
       │──────────────────>│                   │
       │                   │                   │
       │                   │ 2. Validate local │
       │                   │ (capacity check)  │
       │                   │                   │
       │                   │ 3. Generate TX    │
       │                   │ (unsigned)        │
       │                   │                   │
       │  4. Sign TX       │                   │
       │<──────────────────│                   │
       │                   │                   │
       │  5. Signed TX     │                   │
       │──────────────────>│                   │
       │                   │                   │
       │                   │ 6. Request Payee  │
       │                   │    signature      │
       │                   │──────────────────>│
       │                   │                   │
       │                   │ 7. Payee confirms │
       │                   │    and signs      │
       │                   │<──────────────────│
       │                   │                   │
       │                   │ 8. Execute TX     │
       │                   │ (if online)       │
       │                   │ or Queue TX       │
       │                   │ (if offline)      │
       │                   │                   │
       │  9. Confirmation  │  9. Confirmation  │
       │<──────────────────│──────────────────>│
       │                   │                   │
```

---

## 9. Test Cases

### 9.1 Unit Tests

| ID | Test | Expected |
|----|------|----------|
| TX-01 | Valid transaction execution | Success, balances updated |
| TX-02 | Payer at floor attempts payment | Fail: INSUFFICIENT_CAPACITY |
| TX-03 | Non-member payer | Fail: MEMBER_NOT_FOUND |
| TX-04 | Frozen payer | Fail: MEMBER_NOT_ACTIVE |
| TX-05 | Zero amount | Fail: INVALID_AMOUNT |
| TX-06 | Negative amount | Fail: INVALID_AMOUNT |
| TX-07 | Self-payment | Fail: SELF_TRANSACTION |
| TX-08 | Invalid payer signature | Fail: INVALID_SIGNATURE |
| TX-09 | Duplicate transaction ID | Fail: DUPLICATE_TRANSACTION |
| TX-10 | Transaction with escrow reserves | Respects reserve constraint |

### 9.2 Integration Tests

| ID | Test |
|----|------|
| TX-I1 | Complete flow: create, sign, execute |
| TX-I2 | Offline queue and sync |
| TX-I3 | Concurrent transactions from same payer |
| TX-I4 | Transaction at exactly capacity limit |

---

## 10. Performance Requirements

- Validation: < 10ms
- Execution: < 50ms
- Offline queue: Support 100+ pending transactions
- History query: < 100ms for last 1000 transactions

---

## 11. Security Considerations

### 11.1 Signature Scheme
- Ed25519 recommended
- Transaction data canonicalized before signing
- Timestamp included to prevent replay across time

### 11.2 Replay Protection
- Unique transaction IDs (UUID v4)
- Transaction log prevents re-execution
- Optional: time window validation (reject very old transactions)

### 11.3 Privacy
- Transaction details visible only to cell members
- No external transaction broadcasting
- Optional: zero-knowledge proofs for privacy (future)

---

## 12. Acceptance Criteria

- [ ] All validation rules enforced correctly
- [ ] Atomic execution (no partial updates)
- [ ] Offline mode functional
- [ ] Transaction history queryable
- [ ] Signature verification working
- [ ] Conservation maintained after all transactions
