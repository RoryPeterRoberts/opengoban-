# PRD-01: Core Ledger Engine

## Document Information
- **Version**: 1.0
- **Status**: Draft
- **Dependencies**: PRD-00 (Architecture)
- **Dependents**: PRD-02, PRD-03, PRD-04, PRD-06, PRD-07

---

## 1. Overview

The Core Ledger Engine is the foundational component that maintains the mutual-credit state for a cell. It enforces the zero-sum conservation law and hard debt limits that form the economic security backbone of the protocol.

### Purpose
- Maintain participant balances
- Enforce invariants I1 (conservation) and I2 (debt floor)
- Provide atomic state transitions
- Support deterministic, auditable operations

---

## 2. Functional Requirements

### 2.1 State Management

#### FR-1.1: Balance Tracking
- The system MUST track a real-valued balance `b_i(t)` for each member `i` at time `t`
- Balances can be positive (net creditor) or negative (net debtor)
- Precision: at least 2 decimal places (0.01 units)

#### FR-1.2: Limit Tracking
- The system MUST track a debt limit `L_i(t)` for each member
- Limits MUST be within global bounds: `L_min <= L_i <= L_max`
- Default configuration: `L_min = 5`, `L_max = 50`, `L_default = 20`

#### FR-1.3: Reserve Tracking (Optional - for Commitments)
- The system SHOULD track reserved capacity `r_i(t) >= 0` for each member
- Reserves represent capacity locked for future commitments

#### FR-1.4: Aggregate Calculations
- The system MUST compute aggregate cell capacity: `Lambda = SUM(L_i)`
- The system MUST compute balance statistics: mean (always 0), variance, floor mass

### 2.2 Invariant Enforcement

#### FR-2.1: Conservation Law (I1)
```
SUM(b_i) = 0 at all times
```
- Every state transition MUST preserve this invariant
- The system MUST reject any operation that would violate conservation

#### FR-2.2: Debt Floor (I2)
```
b_i >= -L_i for all members i
```
- No balance may fall below the negative of its limit
- The system MUST reject transactions that would breach this floor

#### FR-2.3: Escrow Safety (I3) - If commitments enabled
```
b_i - r_i >= -L_i for all members i
```
- Available balance (after reserves) must not breach floor
- Ensures committed obligations can be fulfilled

#### FR-2.4: Non-Negative Reserves (I4)
```
r_i >= 0 for all members i
```

### 2.3 State Queries

#### FR-3.1: Balance Query
- Get current balance for a member
- Get available balance: `available_i = b_i - r_i + L_i`

#### FR-3.2: Spending Capacity
```
canSpend(i, v) = (b_i - r_i - v >= -L_i)
```
- Determine if member `i` can spend amount `v`

#### FR-3.3: Cell Statistics
- Total membership count `N`
- Aggregate capacity `Lambda`
- Balance variance `sigma^2 = (1/N) * SUM(b_i^2)`
- Floor mass `F = (1/N) * COUNT(b_i <= -rho*L_i)` for threshold `rho`

---

## 3. Data Models

### 3.1 Core Types

```typescript
type IdentityId = string;  // Cryptographic public key or hash
type CellId = string;
type Timestamp = number;   // Unix milliseconds
type Units = number;       // Labor-hour units (2 decimal precision)

interface MemberState {
  id: IdentityId;
  balance: Units;
  limit: Units;
  reserve: Units;         // Optional: 0 if commitments disabled
  reputation: number;     // Optional: [0, 1]
  status: 'ACTIVE' | 'FROZEN' | 'EXCLUDED';
  joinedAt: Timestamp;
  lastActivityAt: Timestamp;
}

interface CellLedgerState {
  cellId: CellId;
  members: Map<IdentityId, MemberState>;
  parameters: LedgerParameters;
  version: number;        // Monotonic state version
  lastUpdatedAt: Timestamp;
}

interface LedgerParameters {
  L_min: Units;
  L_max: Units;
  L_default: Units;
  commitmentMode: 'DISABLED' | 'SOFT' | 'ESCROWED';
  floorThreshold: number;  // rho for floor mass calculation
}
```

### 3.2 State Transition Types

```typescript
interface BalanceUpdate {
  memberId: IdentityId;
  delta: Units;           // Positive or negative change
  reason: UpdateReason;
  relatedEventId?: string;
}

type UpdateReason =
  | 'SPOT_TRANSACTION_PAYER'
  | 'SPOT_TRANSACTION_PAYEE'
  | 'COMMITMENT_FULFILL_PAYER'
  | 'COMMITMENT_FULFILL_PAYEE'
  | 'FEDERATION_IMPORT'
  | 'FEDERATION_EXPORT'
  | 'GOVERNANCE_ADJUSTMENT';

interface ReserveUpdate {
  memberId: IdentityId;
  delta: Units;           // Positive to increase, negative to release
  reason: 'COMMITMENT_CREATE' | 'COMMITMENT_FULFILL' | 'COMMITMENT_CANCEL';
  commitmentId: string;
}
```

---

## 4. API Specification

### 4.1 Ledger Interface

```typescript
interface ILedgerEngine {
  // State Queries
  getMemberState(memberId: IdentityId): MemberState | null;
  getBalance(memberId: IdentityId): Units;
  getAvailableBalance(memberId: IdentityId): Units;
  canSpend(memberId: IdentityId, amount: Units): boolean;

  // Statistics
  getMemberCount(): number;
  getAggregateCapacity(): Units;  // Lambda
  getBalanceVariance(): number;
  getFloorMass(threshold?: number): number;

  // State Mutations (internal - called by other engines)
  applyBalanceUpdates(updates: BalanceUpdate[]): Result<void, LedgerError>;
  applyReserveUpdate(update: ReserveUpdate): Result<void, LedgerError>;

  // Limit Management (via Governance)
  setMemberLimit(memberId: IdentityId, newLimit: Units): Result<void, LedgerError>;

  // Member Management (via Governance)
  addMember(memberId: IdentityId, initialLimit: Units): Result<void, LedgerError>;
  removeMember(memberId: IdentityId): Result<Units, LedgerError>; // Returns final balance
  freezeMember(memberId: IdentityId): Result<void, LedgerError>;
  unfreezeMember(memberId: IdentityId): Result<void, LedgerError>;

  // Invariant Verification
  verifyConservation(): boolean;
  verifyAllFloors(): boolean;
  verifyAllEscrowSafety(): boolean;
  runFullInvariantCheck(): InvariantCheckResult;
}

interface InvariantCheckResult {
  conservationHolds: boolean;
  balanceSum: Units;
  floorsHold: boolean;
  floorViolations: IdentityId[];
  escrowSafetyHolds: boolean;
  escrowViolations: IdentityId[];
}

type LedgerError =
  | { type: 'CONSERVATION_VIOLATION'; expected: Units; actual: Units }
  | { type: 'FLOOR_VIOLATION'; memberId: IdentityId; balance: Units; limit: Units }
  | { type: 'ESCROW_VIOLATION'; memberId: IdentityId; available: Units; limit: Units }
  | { type: 'MEMBER_NOT_FOUND'; memberId: IdentityId }
  | { type: 'MEMBER_FROZEN'; memberId: IdentityId }
  | { type: 'LIMIT_OUT_OF_BOUNDS'; limit: Units; min: Units; max: Units }
  | { type: 'NEGATIVE_RESERVE'; memberId: IdentityId; reserve: Units };
```

### 4.2 Internal Implementation

```typescript
// Core balance update - atomic and conservation-preserving
function applyBalanceUpdates(updates: BalanceUpdate[]): Result<void, LedgerError> {
  // 1. Calculate total delta - must be zero
  const totalDelta = updates.reduce((sum, u) => sum + u.delta, 0);
  if (Math.abs(totalDelta) > 0.001) {
    return err({ type: 'CONSERVATION_VIOLATION', expected: 0, actual: totalDelta });
  }

  // 2. Check all floor constraints post-update
  for (const update of updates) {
    const member = getMemberState(update.memberId);
    if (!member) {
      return err({ type: 'MEMBER_NOT_FOUND', memberId: update.memberId });
    }
    if (member.status === 'FROZEN' && update.delta < 0) {
      return err({ type: 'MEMBER_FROZEN', memberId: update.memberId });
    }

    const newBalance = member.balance + update.delta;
    const floor = -member.limit;

    // Check appropriate floor based on commitment mode
    if (parameters.commitmentMode === 'ESCROWED') {
      if (newBalance - member.reserve < floor) {
        return err({
          type: 'ESCROW_VIOLATION',
          memberId: update.memberId,
          available: newBalance - member.reserve,
          limit: member.limit
        });
      }
    } else {
      if (newBalance < floor) {
        return err({
          type: 'FLOOR_VIOLATION',
          memberId: update.memberId,
          balance: newBalance,
          limit: member.limit
        });
      }
    }
  }

  // 3. Apply all updates atomically
  for (const update of updates) {
    state.members.get(update.memberId)!.balance += update.delta;
    state.members.get(update.memberId)!.lastActivityAt = Date.now();
  }

  state.version++;
  state.lastUpdatedAt = Date.now();

  return ok(void 0);
}
```

---

## 5. Algorithms

### 5.1 Conservation Check

```typescript
function verifyConservation(): boolean {
  let sum = 0;
  for (const member of state.members.values()) {
    sum += member.balance;
  }
  // Allow tiny floating point tolerance
  return Math.abs(sum) < 0.001;
}
```

### 5.2 Floor Mass Calculation

```typescript
function getFloorMass(threshold: number = 0.8): number {
  let count = 0;
  const N = state.members.size;

  for (const member of state.members.values()) {
    if (member.status === 'EXCLUDED') continue;
    const floorProximity = -member.balance / member.limit;
    if (floorProximity >= threshold) {
      count++;
    }
  }

  return count / N;
}
```

### 5.3 Balance Variance

```typescript
function getBalanceVariance(): number {
  // Mean is 0 by conservation
  let sumSquares = 0;
  let N = 0;

  for (const member of state.members.values()) {
    if (member.status === 'EXCLUDED') continue;
    sumSquares += member.balance * member.balance;
    N++;
  }

  return sumSquares / N;
}
```

---

## 6. Non-Functional Requirements

### 6.1 Performance
- Balance queries: O(1)
- Balance updates: O(n) where n = number of updates (typically 2)
- Statistics: O(N) where N = member count (can be cached)
- Invariant check: O(N)

### 6.2 Storage
- State must be persistable to local storage
- Event log must be append-only and exportable
- Target: < 1KB per member for active state

### 6.3 Reliability
- All mutations must be atomic
- State must be recoverable from event log
- Invariant violations must never be persisted

---

## 7. Test Cases

### 7.1 Unit Tests

| ID | Test | Expected |
|----|------|----------|
| L-01 | Apply balanced update (+10, -10) | Success, conservation holds |
| L-02 | Apply unbalanced update (+10) | Fail: CONSERVATION_VIOLATION |
| L-03 | Spend to exactly -L | Success |
| L-04 | Spend beyond -L | Fail: FLOOR_VIOLATION |
| L-05 | Spend with reserve blocking | Fail: ESCROW_VIOLATION |
| L-06 | Query balance non-member | Null |
| L-07 | Update frozen member (debit) | Fail: MEMBER_FROZEN |
| L-08 | Update frozen member (credit) | Success |

### 7.2 Property Tests

| ID | Property |
|----|----------|
| L-P1 | For any sequence of valid operations, SUM(balances) = 0 |
| L-P2 | For any member, balance >= -limit |
| L-P3 | Member count change only via add/remove |
| L-P4 | Version monotonically increases |

---

## 8. Integration Points

| Consumer | Method | Purpose |
|----------|--------|---------|
| Transaction Engine | `canSpend()`, `applyBalanceUpdates()` | Execute spot transactions |
| Commitment Engine | `applyReserveUpdate()`, `applyBalanceUpdates()` | Manage escrow |
| Federation Layer | `applyBalanceUpdates()` | Inter-cell transfers |
| Governance | `setMemberLimit()`, `addMember()`, `removeMember()` | Membership management |
| Emergency Mode | `getFloorMass()`, `getBalanceVariance()` | Risk indicators |

---

## 9. Migration & Versioning

### 9.1 Schema Version
- Current: 1.0
- State includes schema version for future migrations

### 9.2 Backwards Compatibility
- State v1.0 must be loadable by all future versions
- Breaking changes require migration scripts

---

## 10. Acceptance Criteria

- [ ] Conservation invariant holds after 10,000 random operations
- [ ] No balance ever breaches floor in any test
- [ ] State is recoverable from event log replay
- [ ] All API methods have >90% test coverage
- [ ] Performance: 1000 transactions/second on mobile device
