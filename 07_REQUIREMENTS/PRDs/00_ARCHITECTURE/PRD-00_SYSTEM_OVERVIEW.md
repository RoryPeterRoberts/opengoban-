# PRD-00: System Architecture Overview

## Document Information
- **Version**: 1.0
- **Status**: Draft
- **Dependencies**: None (Root Document)
- **Dependents**: All other PRDs

---

## 1. Executive Summary

The Cell is a **cellular mutual-credit protocol** designed for survival-level exchange under institutional failure. It enables communities to coordinate the exchange of goods and services without fiat currency, banks, or centralized issuers.

### Core Design Philosophy
- **Local-first**: Cells are the primary unit; no global ledger
- **Bounded loss**: Hard debt limits cap defection damage
- **Severability**: Failures are local; contagion is prevented
- **Low capture surface**: No issuer, no yield, no speculative token

---

## 2. System Architecture

```
+------------------------------------------------------------------+
|                        THE CELL SYSTEM                            |
+------------------------------------------------------------------+
|                                                                    |
|  +------------------------+    +---------------------------+       |
|  |   PRESENTATION LAYER   |    |    EXTERNAL INTERFACES    |       |
|  |  - Mobile App (PWA)    |    |  - Federation Protocol    |       |
|  |  - Web Interface       |    |  - Inter-Cell Messaging   |       |
|  +------------------------+    +---------------------------+       |
|              |                            |                        |
|  +-----------v----------------------------v-------------------+    |
|  |                 APPLICATION LAYER                          |    |
|  |  +-------------+  +--------------+  +------------------+   |    |
|  |  | Governance  |  |   Survival   |  |    Emergency     |   |    |
|  |  |   Engine    |  |  Scheduler   |  |      Mode        |   |    |
|  |  +-------------+  +--------------+  +------------------+   |    |
|  +------------------------------------------------------------+    |
|              |                                                     |
|  +-----------v------------------------------------------------+    |
|  |                   CORE PROTOCOL LAYER                      |    |
|  |  +--------------+  +---------------+  +----------------+   |    |
|  |  |    Ledger    |  | Transactions  |  |  Commitments   |   |    |
|  |  |    Engine    |  |    Engine     |  |    Engine      |   |    |
|  |  +--------------+  +---------------+  +----------------+   |    |
|  |                                                            |    |
|  |  +--------------+  +---------------+  +----------------+   |    |
|  |  |   Identity   |  |  Federation   |  |    Energy      |   |    |
|  |  |   Manager    |  |    Layer      |  |    Tracker     |   |    |
|  |  +--------------+  +---------------+  +----------------+   |    |
|  +------------------------------------------------------------+    |
|              |                                                     |
|  +-----------v------------------------------------------------+    |
|  |                    DATA LAYER                              |    |
|  |  +-------------+  +---------------+  +-----------------+   |    |
|  |  | Event Log   |  |  State Store  |  | Sync Protocol   |   |    |
|  |  | (Append)    |  |  (Current)    |  | (P2P/Local)     |   |    |
|  |  +-------------+  +---------------+  +-----------------+   |    |
|  +------------------------------------------------------------+    |
|                                                                    |
+------------------------------------------------------------------+
```

---

## 3. Module Dependency Graph

```
PRD-00: Architecture (this document)
    |
    +---> PRD-01: Core Ledger Engine
    |         |
    |         +---> PRD-02: Transaction System
    |         |         |
    |         |         +---> PRD-03: Commitment System
    |         |
    |         +---> PRD-04: Identity & Membership
    |                   |
    |                   +---> PRD-05: Governance System
    |
    +---> PRD-06: Federation Layer
    |         (requires: PRD-01, PRD-02)
    |
    +---> PRD-07: Emergency Mode
    |         (requires: PRD-01, PRD-05)
    |
    +---> PRD-08: Survival Scheduler
    |         (requires: PRD-03, PRD-04)
    |
    +---> PRD-09: Energy Resource Layer
    |         (requires: PRD-08)
    |
    +---> PRD-10: Security & Validation
              (requires: ALL above)
```

---

## 4. Implementation Phases

### Phase 1: Core Protocol (MVP)
- PRD-01: Core Ledger Engine
- PRD-02: Transaction System
- PRD-04: Identity & Membership (basic)

### Phase 2: Coordination Layer
- PRD-03: Commitment System
- PRD-05: Governance System
- PRD-08: Survival Scheduler (basic)

### Phase 3: Resilience Layer
- PRD-07: Emergency Mode
- PRD-06: Federation Layer

### Phase 4: Resource Management
- PRD-09: Energy Resource Layer
- PRD-08: Survival Scheduler (full)

### Phase 5: Hardening
- PRD-10: Security & Validation
- Adversarial testing suite

---

## 5. Cross-Cutting Concerns

### 5.1 Invariants (Must Always Hold)

| ID | Invariant | Enforcement |
|----|-----------|-------------|
| I1 | Conservation: `SUM(balances) = 0` | Ledger Engine |
| I2 | Debt Floor: `b_i >= -L_i` | Transaction Validation |
| I3 | Escrow Safety: `b_i - r_i >= -L_i` | Commitment Validation |
| I4 | Non-negative reserves: `r_i >= 0` | Commitment Validation |
| I5 | Federation Cap: `|B_k| <= beta * Lambda_k` | Federation Layer |

### 5.2 Unit of Account
- **Default**: 1 unit = 1 hour of median local labor ("labor-hour")
- Locally interpretable, difficult to financialize

### 5.3 Parameter Bounds (System-Wide)

| Parameter | Symbol | Range | Default |
|-----------|--------|-------|---------|
| Cell Size | N | 50-150 | 60-100 |
| Credit Limit | L | L_min to L_max | ~1 week essentials |
| Federation Cap | beta | 0.05-0.15 | 0.10 |
| Federation Degree | d | 3-7 | 3-5 |

---

## 6. Data Models (High-Level)

### 6.1 Cell State
```typescript
interface CellState {
  cellId: CellId;
  membership: Set<IdentityId>;
  balances: Map<IdentityId, number>;
  limits: Map<IdentityId, number>;
  reserves: Map<IdentityId, number>;  // Optional: escrowed
  reputation: Map<IdentityId, number>; // Optional: advisory
  federationPosition: number;  // B_k
  riskState: 'NORMAL' | 'STRESSED' | 'PANIC';
  parameters: CellParameters;
  eventLog: Event[];
}
```

### 6.2 Event Types
```typescript
type Event =
  | SpotTransaction
  | CommitmentCreate
  | CommitmentFulfill
  | CommitmentCancel
  | MemberAdmit
  | MemberExpel
  | GovernanceAction
  | FederationTransfer
  | EmergencyStateChange;
```

---

## 7. Technology Recommendations

### 7.1 Local-First Requirements
- Offline-capable operation
- Eventual consistency within cell
- Cryptographic signing of events
- No external payment rails required

### 7.2 Suggested Stack
- **Frontend**: React Native / PWA (offline-first)
- **Local Storage**: SQLite / IndexedDB
- **Sync**: CRDTs or custom merge protocol
- **Crypto**: Ed25519 signatures
- **Optional Backend**: Lightweight relay for sync

---

## 8. Integration Points

| Component A | Component B | Interface |
|-------------|-------------|-----------|
| Ledger | Transactions | `validateTransaction()`, `applyTransaction()` |
| Ledger | Commitments | `reserveCapacity()`, `releaseCapacity()` |
| Ledger | Federation | `updateFederationPosition()` |
| Governance | Membership | `admit()`, `expel()`, `freeze()` |
| Governance | Limits | `adjustLimit()` (bounded) |
| Emergency | All | `getRiskState()`, `applyEmergencyPolicy()` |
| Scheduler | Commitments | `createEssentialCommitment()` |
| Scheduler | Energy | `checkEnergyFeasibility()` |

---

## 9. Success Criteria

### 9.1 Functional
- [ ] A cell of 60-100 members can operate offline
- [ ] Transactions enforce all invariants
- [ ] Commitments support essential task scheduling
- [ ] Federation enables limited inter-cell trade
- [ ] Emergency mode triggers on stress indicators

### 9.2 Security
- [ ] Bounded extraction per identity: G_i <= L_i
- [ ] Bounded multi-identity attack: G_total <= S*L
- [ ] Federation severance is non-fatal
- [ ] No single point of capture

### 9.3 Survival
- [ ] Essential tasks can be scheduled and covered
- [ ] Energy constraints are enforceable
- [ ] System recovers from PANIC state

---

## 10. Glossary

| Term | Definition |
|------|------------|
| **Cell** | A local group of 50-150 participants with a zero-sum ledger |
| **Balance** | Net position: positive = net provider, negative = net receiver |
| **Limit (L)** | Maximum debt a participant can accumulate |
| **Conservation** | Cell balances always sum to zero |
| **Federation** | Limited inter-cell trading with exposure caps |
| **Severability** | Cells can be isolated without breaking others |
| **Commitment** | Future-dated obligation (soft or escrowed) |
| **Emergency Mode** | State-dependent parameter tightening |
