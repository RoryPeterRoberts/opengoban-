# PRD-06: Federation Layer

## Document Information
- **Version**: 1.0
- **Status**: Draft
- **Dependencies**: PRD-01 (Core Ledger), PRD-02 (Transactions)
- **Dependents**: PRD-07 (Emergency Mode)

---

## 1. Overview

The Federation Layer enables limited inter-cell exchange while preventing systemic leverage and contagion. It implements capped exposure and severability to ensure no cell becomes dangerously dependent on the federation.

### Design Principle
**Federation is safe if and only if:**
1. Local ledgers remain primary
2. Cross-cell trades route through clearing accounts
3. Exposure caps are enforced: `|B_k| <= beta * Lambda_k`
4. Isolation is automatic and non-destructive
5. Federation degree is bounded

---

## 2. Federation Model

### 2.1 Two-Ledger Decomposition

Each cell maintains:
- **Internal ledger**: Primary, zero-sum within cell
- **Federation position** `B_k`: Net claim on (positive) or obligation to (negative) other cells

```typescript
interface FederationState {
  cellId: CellId;
  federationPosition: Units;           // B_k
  clearingAccountBalance: Units;       // X_k (internal member)
  exposureCap: Units;                  // beta * Lambda_k
  connectedCells: FederationLink[];
  lastSyncAt: Timestamp;
  status: 'ACTIVE' | 'SUSPENDED' | 'QUARANTINED';
}

interface FederationLink {
  remoteCellId: CellId;
  status: 'ACTIVE' | 'SUSPENDED';
  bilateralPosition: Units;            // Net with this specific cell
  lastTradeAt: Timestamp;
  trustScore?: number;
}
```

### 2.2 Clearing Account

Each cell has an internal "External Clearing Account" (`X_k`) that:
- Is a special member of the cell's ledger
- Receives credits when members import (buy from other cells)
- Pays out when members export (sell to other cells)
- Balance always equals the negative of federation position: `b_X = -B_k`

This preserves internal conservation while tracking external exposure.

---

## 3. Inter-Cell Transaction Flow

### 3.1 Transaction Structure

```typescript
interface FederationTransaction {
  id: FederationTxId;
  type: 'INTERCELL_TRANSFER';
  sourceCell: CellId;
  targetCell: CellId;
  payer: IdentityId;           // Member of sourceCell (buyer)
  payee: IdentityId;           // Member of targetCell (seller)
  amount: Units;
  description: string;
  timestamp: Timestamp;
  signatures: {
    payer: Signature;
    payee: Signature;
    sourceCellAttestation?: Signature;
    targetCellAttestation?: Signature;
  };
  status: FederationTxStatus;
}

type FederationTxStatus =
  | 'PENDING'
  | 'SOURCE_CONFIRMED'
  | 'TARGET_CONFIRMED'
  | 'COMPLETED'
  | 'FAILED'
  | 'ROLLED_BACK';
```

### 3.2 Execution Flow

```
Cell A (Source/Importer)          Federation           Cell B (Target/Exporter)
        │                             │                         │
        │ 1. Payer initiates          │                         │
        │    inter-cell tx            │                         │
        ├─────────────────────────────┼────────────────────────>│
        │                             │                         │
        │                             │    2. Payee confirms    │
        │                             │<────────────────────────│
        │                             │                         │
        │ 3. Validate:                │                         │
        │    - Payer capacity         │                         │
        │    - Source cap feasible    │                         │
        │    (|B_a - v| <= cap)       │                         │
        │                             │                         │
        │                             │    4. Validate:         │
        │                             │       - Target cap      │
        │                             │       (|B_b + v| <= cap)│
        │                             │                         │
        │ 5. Execute local leg:       │                         │
        │    b_payer -= v             │                         │
        │    b_X_a += v               │                         │
        │    B_a -= v                 │                         │
        │                             │                         │
        │                             │    6. Execute local leg:│
        │                             │       b_X_b -= v        │
        │                             │       b_payee += v      │
        │                             │       B_b += v          │
        │                             │                         │
        │ 7. Confirm completion       │    7. Confirm completion│
        │<────────────────────────────┼────────────────────────>│
        │                             │                         │
```

---

## 4. Exposure Cap System

### 4.1 Cap Calculation

```typescript
// Cell aggregate capacity
function getAggregateCapacity(cellId: CellId): Units {
  const members = ledger.getActiveMembers(cellId);
  return members.reduce((sum, m) => sum + m.limit, 0);
}

// Exposure cap
function getExposureCap(cellId: CellId): Units {
  const Lambda = getAggregateCapacity(cellId);
  const beta = parameters.federationCapFactor;  // e.g., 0.10
  return beta * Lambda;
}

// Check if transaction is within cap
function checkCapFeasibility(
  cellId: CellId,
  positionDelta: Units
): boolean {
  const currentPosition = federation.getPosition(cellId);
  const newPosition = currentPosition + positionDelta;
  const cap = getExposureCap(cellId);
  return Math.abs(newPosition) <= cap;
}
```

### 4.2 Cap Parameters

| Parameter | Symbol | Typical Range | Meaning |
|-----------|--------|---------------|---------|
| Federation Cap Factor | β | 0.05 - 0.15 | Max exposure as fraction of cell capacity |
| Federation Degree | d | 3 - 7 | Max number of connected cells |

**Example**: Cell with 80 members, L=20 each:
- `Lambda = 80 * 20 = 1600`
- With `beta = 0.10`: cap = 160 labor-hours
- This limits external dependency to ~10% of cell capacity

---

## 5. Severability & Contagion Prevention

### 5.1 Severability Definition

A federation is **severable** if isolating any cell leaves all other cells internally consistent and operational.

### 5.2 Isolation Protocol

```typescript
interface IsolationResult {
  cellId: CellId;
  frozenPosition: Units;
  frozenLinks: FederationLink[];
  remainingCellsAffected: CellId[];
  maxLossPerCell: Map<CellId, Units>;
}

function isolateCell(cellId: CellId): IsolationResult {
  const cell = federation.getState(cellId);

  // 1. Suspend all federation links
  cell.status = 'QUARANTINED';
  for (const link of cell.connectedCells) {
    link.status = 'SUSPENDED';
    // Notify remote cell
    notifyRemoteCell(link.remoteCellId, {
      type: 'LINK_SUSPENDED',
      reason: 'CELL_ISOLATED',
      cellId: cellId
    });
  }

  // 2. Freeze federation position
  const frozenPosition = cell.federationPosition;

  // 3. Calculate impact on other cells
  const affected = new Map<CellId, Units>();
  for (const link of cell.connectedCells) {
    // Other cell's exposure to this cell is bounded by beta * their Lambda
    const remoteCell = federation.getState(link.remoteCellId);
    const maxLoss = Math.min(
      Math.abs(link.bilateralPosition),
      remoteCell.exposureCap
    );
    affected.set(link.remoteCellId, maxLoss);
  }

  return {
    cellId,
    frozenPosition,
    frozenLinks: cell.connectedCells,
    remainingCellsAffected: [...affected.keys()],
    maxLossPerCell: affected
  };
}
```

### 5.3 Automatic Quarantine Triggers

```typescript
function checkQuarantineTriggers(cellId: CellId): boolean {
  const cell = federation.getState(cellId);
  const cap = getExposureCap(cellId);

  // Trigger 1: Cap violation
  if (Math.abs(cell.federationPosition) > cap) {
    triggerQuarantine(cellId, 'CAP_VIOLATION');
    return true;
  }

  // Trigger 2: Cell in PANIC mode
  if (cell.riskState === 'PANIC') {
    triggerQuarantine(cellId, 'PANIC_MODE');
    return true;
  }

  // Trigger 3: Prolonged unresponsiveness
  const lastSync = cell.lastSyncAt;
  if (Date.now() - lastSync > MAX_SYNC_DELAY) {
    triggerQuarantine(cellId, 'UNRESPONSIVE');
    return true;
  }

  return false;
}
```

---

## 6. Functional Requirements

### 6.1 Inter-Cell Transactions

#### FR-1.1: Validation
- Both parties must be active members of their respective cells
- Payer must have spending capacity
- Source cell cap must not be exceeded
- Target cell cap must not be exceeded
- Both cells must be in ACTIVE federation status

#### FR-1.2: Atomic Execution
- Both local legs must succeed or neither applies
- Federation positions update atomically
- Rollback on any failure

#### FR-1.3: Offline Tolerance
- Transactions can be staged locally
- Sync protocol handles eventual consistency
- Conflict resolution via timestamp ordering

### 6.2 Exposure Management

#### FR-2.1: Cap Enforcement
- Every transaction checked against caps
- Transactions that would exceed cap are rejected
- No manual override possible

#### FR-2.2: Position Tracking
- Real-time federation position tracking
- Bilateral position tracking per linked cell
- Historical position data for analysis

### 6.3 Connectivity

#### FR-3.1: Link Management
- Establish links between cells (requires mutual consent)
- Maximum `d` links per cell
- Link status tracking (ACTIVE, SUSPENDED)

#### FR-3.2: Discovery (Optional)
- Mechanism for cells to discover potential partners
- Trust signals from existing links

---

## 7. API Specification

```typescript
interface IFederationEngine {
  // State
  getFederationState(): FederationState;
  getPosition(): Units;
  getExposureCap(): Units;
  getAvailableCapacity(): Units;  // cap - |position|
  getBilateralPosition(remoteCellId: CellId): Units;

  // Links
  getConnectedCells(): FederationLink[];
  proposeLink(remoteCellId: CellId): Result<void, FederationError>;
  acceptLink(proposalId: string): Result<void, FederationError>;
  suspendLink(remoteCellId: CellId, reason: string): Result<void, FederationError>;
  reactivateLink(remoteCellId: CellId): Result<void, FederationError>;

  // Transactions
  validateInterCellTx(tx: FederationTransaction): Result<void, FederationError>;
  executeInterCellTx(tx: FederationTransaction): Result<FederationTxResult, FederationError>;
  getInterCellTxStatus(txId: FederationTxId): FederationTxStatus;

  // Quarantine
  checkQuarantineStatus(): QuarantineStatus;
  requestReactivation(): Result<void, FederationError>;

  // Sync
  syncWithCell(remoteCellId: CellId): Result<SyncResult, FederationError>;
  reconcilePositions(): Result<ReconciliationResult, FederationError>;

  // Queries
  getTransactionHistory(filter?: FederationTxFilter): FederationTransaction[];
  getPositionHistory(timeRange: TimeRange): PositionHistory[];
}

interface FederationTxResult {
  transactionId: FederationTxId;
  newSourcePosition: Units;
  newTargetPosition: Units;
  payerNewBalance: Units;
  payeeNewBalance: Units;
  timestamp: Timestamp;
}

interface QuarantineStatus {
  isQuarantined: boolean;
  reason?: string;
  since?: Timestamp;
  frozenPosition?: Units;
  requiredActionsForReactivation?: string[];
}

type FederationError =
  | { type: 'NOT_CONNECTED'; remoteCellId: CellId }
  | { type: 'LINK_SUSPENDED'; remoteCellId: CellId }
  | { type: 'CAP_EXCEEDED'; currentPosition: Units; cap: Units; delta: Units }
  | { type: 'REMOTE_CAP_EXCEEDED'; remoteCellId: CellId }
  | { type: 'MAX_LINKS_REACHED'; maxLinks: number }
  | { type: 'CELL_QUARANTINED'; cellId: CellId }
  | { type: 'SYNC_FAILED'; reason: string }
  | { type: 'TRANSACTION_FAILED'; phase: string; reason: string };
```

---

## 8. Inter-Cell Transaction Algorithm

```typescript
async function executeInterCellTransaction(
  tx: FederationTransaction
): Promise<Result<FederationTxResult, FederationError>> {
  const sourceCell = tx.sourceCell;
  const targetCell = tx.targetCell;
  const amount = tx.amount;

  // 1. Validate source cell constraints
  if (!ledger.canSpend(tx.payer, amount)) {
    return err({
      type: 'TRANSACTION_FAILED',
      phase: 'SOURCE_VALIDATION',
      reason: 'Insufficient payer capacity'
    });
  }

  if (!checkCapFeasibility(sourceCell, -amount)) {
    return err({
      type: 'CAP_EXCEEDED',
      currentPosition: federation.getPosition(),
      cap: getExposureCap(sourceCell),
      delta: -amount
    });
  }

  // 2. Communicate with target cell and validate
  const targetValidation = await remoteValidation(targetCell, tx);
  if (targetValidation.isErr()) {
    return err({
      type: 'REMOTE_CAP_EXCEEDED',
      remoteCellId: targetCell
    });
  }

  // 3. Execute source leg
  const sourceLegResult = ledger.applyBalanceUpdates([
    { memberId: tx.payer, delta: -amount, reason: 'FEDERATION_EXPORT' },
    { memberId: CLEARING_ACCOUNT_ID, delta: amount, reason: 'FEDERATION_EXPORT' }
  ]);

  if (sourceLegResult.isErr()) {
    return err({
      type: 'TRANSACTION_FAILED',
      phase: 'SOURCE_EXECUTION',
      reason: sourceLegResult.error.toString()
    });
  }

  // 4. Update source federation position
  const newSourcePosition = federation.updatePosition(-amount);

  // 5. Request target cell execution
  const targetExecResult = await requestTargetExecution(targetCell, tx);
  if (targetExecResult.isErr()) {
    // Rollback source leg
    ledger.applyBalanceUpdates([
      { memberId: tx.payer, delta: amount, reason: 'FEDERATION_ROLLBACK' },
      { memberId: CLEARING_ACCOUNT_ID, delta: -amount, reason: 'FEDERATION_ROLLBACK' }
    ]);
    federation.updatePosition(amount);  // Restore position
    return err({
      type: 'TRANSACTION_FAILED',
      phase: 'TARGET_EXECUTION',
      reason: targetExecResult.error.toString()
    });
  }

  // 6. Mark complete
  tx.status = 'COMPLETED';
  transactionLog.append(tx);

  return ok({
    transactionId: tx.id,
    newSourcePosition,
    newTargetPosition: targetExecResult.value.newPosition,
    payerNewBalance: ledger.getBalance(tx.payer),
    payeeNewBalance: targetExecResult.value.payeeNewBalance,
    timestamp: Date.now()
  });
}
```

---

## 9. Test Cases

### 9.1 Unit Tests

| ID | Test | Expected |
|----|------|----------|
| FD-01 | Valid inter-cell transaction | Success |
| FD-02 | Transaction exceeds source cap | Fail: CAP_EXCEEDED |
| FD-03 | Transaction exceeds target cap | Fail: REMOTE_CAP_EXCEEDED |
| FD-04 | Transaction to suspended link | Fail: LINK_SUSPENDED |
| FD-05 | Position calculation after transaction | Correct |
| FD-06 | Quarantine on cap violation | Cell quarantined |
| FD-07 | Isolation preserves internal ledger | Conservation holds |

### 9.2 Integration Tests

| ID | Test |
|----|------|
| FD-I1 | Full inter-cell transaction flow |
| FD-I2 | Transaction rollback on target failure |
| FD-I3 | Multi-cell network with bounded contagion |
| FD-I4 | Recovery from quarantine |

---

## 10. Acceptance Criteria

- [ ] Inter-cell transactions execute correctly
- [ ] Exposure caps enforced on all transactions
- [ ] Automatic quarantine on violations
- [ ] Severability: isolated cell doesn't break others
- [ ] Federation position tracking accurate
- [ ] Bilateral positions reconcile correctly
- [ ] Maximum contagion bounded by `d * beta * Lambda`
