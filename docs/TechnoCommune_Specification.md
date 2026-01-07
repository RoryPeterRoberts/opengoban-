# TechnoCommune Application Specification

**Version:** 1.0
**Date:** 2026-01-07
**Status:** Implementation Ready

---

# Executive Summary

TechnoCommune is a **mutual credit system** for local community coordination and crisis resilience. It enables:

- **Day-to-day trading** of goods and services without fiat currency
- **Crisis provisioning** for members facing hardship (job loss, illness)
- **Dignity-first support** that protects providers and respects recipients
- **Offline-first operation** via PWA with P2P synchronization

**Core Principle:** No hidden issuance. All balances sum to zero. Compassion is explicit and bounded.

---

# PART 1: MATHEMATICAL MODEL

## 1.1 Entities

| Entity | Symbol | Description |
|--------|--------|-------------|
| Members | i in {1...N} | Circle participants |
| Community Pool | G | Pays crisis support, funded by contributions |
| Loss Sink | L | Records forgiven obligations (socialized loss) |

## 1.2 Ledger Types

### Balance Ledger (Mutual Credit)
```
b_i = Member balance (can be negative down to credit limit)
b_G = Community pool balance (can go negative down to L_G)
b_L = Loss sink balance (goes negative when obligations forgiven)
```

**Conservation Invariant:**
```
SUM(b_i) + b_G + b_L = 0
```

This is the **"not a scam" property** - no hidden issuance, no inflation except explicit community decisions.

### Obligation Ledger (Non-Transferable)
```
o_i >= 0 = Crisis support received, owed back to community
```

Obligations are separate from balances. They represent "I received help and will contribute back when able."

## 1.3 Credit Limits

Each member has:
- **Floor (L_i):** Maximum negative balance allowed (e.g., -50)
- **Ceiling (U_i):** Optional maximum positive balance (anti-hoarding)

Transaction validity:
```
b_sender - amount >= L_sender
b_recipient + amount <= U_recipient (optional)
```

---

# PART 2: TRANSACTION TYPES

## 2.1 Normal Transfer (Day-to-Day)

**Purpose:** Exchange of goods/services between members

**Ledger Effect:**
```
b_sender -= amount
b_recipient += amount
```

**Validation:**
1. Signatures valid (sender + recipient)
2. Sender not frozen/revoked
3. Post-tx balance respects limit: `b_sender - amount >= L_sender`
4. Idempotency: canonical hash not previously applied
5. Amount <= MAX_TRANSACTION (circuit breaker)

## 2.2 Crisis Payment (Pool-Underwritten)

**Purpose:** Essential support for members in crisis, paid by community pool

**Ledger Effect:**
```
b_G -= amount           (pool pays provider)
b_provider += amount    (provider credited)
o_recipient += amount   (recipient accrues obligation)
```

**Validation:**
1. Category in essentials allowlist
2. Provider signature present
3. Pool capacity: `b_G - amount >= L_G`
4. Recipient caps not exceeded (weekly/monthly)
5. Recipient in approved crisis status

## 2.3 Repayment (Obligation Reduction)

**Purpose:** Member pays back community support when able

**Ledger Effect:**
```
b_member -= amount
b_G += amount
o_member -= amount
```

**Validation:**
1. Member has sufficient balance
2. Amount <= current obligation
3. Member signature valid

## 2.4 Compassion Forgiveness (Write-Off)

**Purpose:** Cancel unrecoverable obligations (illness, disability, death)

**Ledger Effect:**
```
o_member -= amount
b_L -= amount   (loss sink absorbs cost)
```

**Validation:**
1. Elder signatures >= threshold (3)
2. Timelock satisfied (7 days)
3. Loss budget: `b_L - amount >= L_L`
4. Optional community veto not triggered

---

# PART 3: ACCOUNT STATES

## 3.1 Member Status Values

| Status | Can Send | Can Receive | Can Repay | Crisis Access |
|--------|----------|-------------|-----------|---------------|
| active | Yes | Yes | Yes | If approved |
| frozen | No | Yes | Yes | Steward discretion |
| revoked | No | No | No | No |
| anonymized | No | No | No | No |

## 3.2 Freeze Triggers

Account frozen when:
- Post-sync validation finds `b_i < L_i` (over credit limit)

Unfreeze when:
- Balance >= credit limit

## 3.3 Crisis Status

Separate from member status:
- **crisis_status:** none | active | expired
- **crisis_approved_by:** steward ID
- **crisis_expires:** date (default 8 weeks)
- **crisis_caps:** weekly/monthly limits

---

# PART 4: PARAMETERIZATION

## 4.1 Credit Unit Convention

**Soft norm:** 1 CR ≈ 10 minutes of ordinary local labour

| Activity | Suggested Credits |
|----------|------------------|
| Dog walk (30-40 min) | 3-4 CR |
| Grass cut (60-90 min) | 6-9 CR |
| Bag of vegetables | 2-5 CR |
| Beach clean (2 hours) | 12 CR |

## 4.2 Circuit Breaker

```javascript
MAX_TRANSACTION = 100  // Maximum single transaction
LARGE_TRANSFER_CONFIRM = 20  // Prompt for confirmation
```

## 4.3 Credit Limit Progression (Entry Limits)

| Tenure | Credit Limit | Integration Requirement |
|--------|-------------|------------------------|
| 0 months | 0 | - |
| 1 month | -10 | 3+ unique trade partners |
| 3 months | -25 | 6+ unique trade partners |
| 6 months | -50 | 10+ unique trade partners |
| 12 months | -100 | 15+ unique trade partners |

**Rationale:** Time alone is Sybil-friendly; unique partners make trust "real."

## 4.4 Pool Capacity

```
L_G = -20 * N credits (N = number of members)
```

| Circle Size | Max Pool Deficit |
|-------------|-----------------|
| N=50 | -1000 CR |
| N=100 | -2000 CR |

## 4.5 Compassion Budget

```
L_L = -5 * N credits
```

| Circle Size | Max Forgiveness |
|-------------|----------------|
| N=50 | -250 CR |
| N=100 | -500 CR |

## 4.6 Crisis Caps

```javascript
CRISIS_WEEKLY_CAP = 20    // CR per week per member
CRISIS_MONTHLY_CAP = 60   // CR per month per member
CRISIS_DURATION = 8       // weeks default
PROVIDER_WEEKLY_CAP = 100 // CR per week per provider
AUTO_REPAY_FRACTION = 0.20 // 20% of incoming credits
```

## 4.7 Governance Thresholds

```javascript
MIN_ELDERS_FOR_MIGRATION = 3
MIN_ELDERS_FOR_FORGIVENESS = 3
FORGIVENESS_TIMELOCK = 7  // days
VETO_THRESHOLD = max(5, 0.10 * N)  // members
```

---

# PART 5: DATA MODEL

## 5.1 Document Types

### member
```javascript
{
  _id: "member_<uuid>",
  type: "member",
  public_key: "<Ed25519>",
  handle: "display_name",
  status: "active" | "frozen" | "revoked" | "anonymized",
  roles: ["elder", "steward"],
  joined_at: "ISO8601",
  vouchers: ["member_id1", "member_id2"],
  credit_limit: -50,
  credit_limit_override: null,  // Elder-set override
  positive_cap: null,  // Optional hoarding prevention
  circle_id: "circle_<uuid>",
  crisis_status: "none" | "active" | "expired",
  crisis_expires: "ISO8601",
  crisis_approved_by: "member_id"
}
```

### tx (Normal Transfer)
```javascript
{
  _id: "tx_<uuid>",
  type: "transfer",
  circle_id: "circle_<uuid>",
  sender_id: "member_<uuid>",
  recipient_id: "member_<uuid>",
  amount: 10,  // Positive integer
  description: "Grass cutting",
  nonce: "<random>",
  canonical_hash: "<sha256>",
  created_at: "ISO8601",
  sender_signature: "<sig>",
  recipient_signature: "<sig>",
  status: "pending" | "confirmed" | "rejected" | "expired"
}
```

### obligation
```javascript
{
  _id: "obl_<member_id>",
  type: "obligation",
  member_id: "member_<uuid>",
  circle_id: "circle_<uuid>",
  amount_outstanding: 120,  // >= 0
  updated_at: "ISO8601",
  history: []  // Optional audit trail
}
```

### crisis_payment
```javascript
{
  _id: "cp_<uuid>",
  type: "crisis_payment",
  circle_id: "circle_<uuid>",
  recipient_id: "member_<uuid>",  // Crisis member
  provider_id: "member_<uuid>",   // Service provider
  amount: 15,
  category: "food" | "heat" | "transport" | "care" | "repair" | "hygiene",
  created_at: "ISO8601",
  steward_approvals: ["member_id"],
  provider_signature: "<sig>",
  recipient_ack_signature: "<sig>",  // Optional
  canonical_hash: "<sha256>",
  status: "confirmed" | "rejected"
}
```

### repayment
```javascript
{
  _id: "rp_<uuid>",
  type: "repayment",
  circle_id: "circle_<uuid>",
  member_id: "member_<uuid>",
  amount: 6,
  created_at: "ISO8601",
  signature: "<sig>",
  canonical_hash: "<sha256>",
  status: "confirmed" | "rejected"
}
```

### compassion_forgiveness
```javascript
{
  _id: "cf_<uuid>",
  type: "compassion_forgiveness",
  circle_id: "circle_<uuid>",
  member_id: "member_<uuid>",
  amount: 60,
  reason_code: "illness" | "disability" | "death" | "long_term_incapacity",
  evidence_hashes: [],  // Privacy-aware
  created_at: "ISO8601",
  elder_signatures: [
    { elder_id: "member_<uuid>", signature: "<sig>", signed_at: "ISO8601" }
  ],
  timelock_until: "ISO8601",
  status: "proposed" | "approved" | "executed" | "vetoed"
}
```

### circle_policy
```javascript
{
  _id: "policy_<circle_id>",
  type: "circle_policy",
  circle_id: "circle_<uuid>",
  protocol_version: "1.0.0",
  max_transaction: 100,
  crisis_weekly_cap: 20,
  crisis_monthly_cap: 60,
  auto_repay_fraction: 0.20,
  pool_limit: -1000,  // L_G
  loss_limit: -250,   // L_L
  min_vouchers: 1,
  min_elders_forgiveness: 3,
  forgiveness_timelock_days: 7,
  essentials_categories: ["food", "heat", "transport", "care", "repair", "hygiene"]
}
```

### need (Coordination, Non-Ledger)
```javascript
{
  _id: "need_<uuid>",
  type: "need",
  circle_id: "circle_<uuid>",
  posted_by: "member_<uuid>",
  category: "garden",
  template: "grass_cutting",
  description: "Front yard only",
  location_radius_km: 2,
  time_window: { start: "ISO8601", end: "ISO8601" },
  settlement_mode: "credits" | "swap" | "crisis_supported",
  status: "open" | "scheduled" | "completed" | "cancelled",
  created_at: "ISO8601"
}
```

### commitment (Coordination, Non-Ledger)
```javascript
{
  _id: "commitment_<uuid>",
  type: "commitment",
  need_id: "need_<uuid>",
  helper_id: "member_<uuid>",
  proposed_time: "ISO8601",
  status: "proposed" | "scheduled" | "arrived" | "completed" | "no_show" | "cancelled",
  created_at: "ISO8601",
  completed_at: "ISO8601"
}
```

---

# PART 6: VALIDATION ENGINE

## 6.1 Schema Gate (Anti-Corruption)

Reject any document that:
- Has unknown type
- Exceeds 32KB
- Missing required fields
- Fails signature verification

## 6.2 Balance Computation

Compute from confirmed documents only:

```javascript
function computeBalance(memberId) {
  let balance = 0;

  // Normal transfers
  for (tx of confirmedTransfers) {
    if (tx.sender_id === memberId) balance -= tx.amount;
    if (tx.recipient_id === memberId) balance += tx.amount;
  }

  // Crisis payments (providers get credits)
  for (cp of confirmedCrisisPayments) {
    if (cp.provider_id === memberId) balance += cp.amount;
  }

  // Repayments (members pay back)
  for (rp of confirmedRepayments) {
    if (rp.member_id === memberId) balance -= rp.amount;
  }

  return balance;
}

function computePoolBalance() {
  let balance = 0;

  // Crisis payments drain pool
  for (cp of confirmedCrisisPayments) balance -= cp.amount;

  // Repayments refill pool
  for (rp of confirmedRepayments) balance += rp.amount;

  // Voluntary contributions
  for (contrib of confirmedContributions) balance += contrib.amount;

  return balance;
}

function computeLossSink() {
  let balance = 0;

  // Forgiveness creates loss
  for (cf of executedForgiveness) balance -= cf.amount;

  return balance;
}
```

**Check Conservation:**
```javascript
SUM(memberBalances) + poolBalance + lossBalance === 0
```

## 6.3 Obligation Computation

```javascript
function computeObligation(memberId) {
  let obligation = 0;

  // Crisis payments received
  for (cp of confirmedCrisisPayments) {
    if (cp.recipient_id === memberId) obligation += cp.amount;
  }

  // Repayments made
  for (rp of confirmedRepayments) {
    if (rp.member_id === memberId) obligation -= rp.amount;
  }

  // Forgiveness granted
  for (cf of executedForgiveness) {
    if (cf.member_id === memberId) obligation -= cf.amount;
  }

  return Math.max(0, obligation);  // Never negative
}
```

---

# PART 7: USER WORKFLOWS

## 7.1 Post a Need (Elder-Friendly)

1. Open "Request Help"
2. Choose category tile (Food/Heat/Transport/Garden/Pets/Other)
3. Set time window + location radius
4. Add optional note
5. Choose settlement: Credits / Swap / Community-Supported
6. Tap "Post" (single large button)

**Creates:** `need_<uuid>` document

## 7.2 Accept Help

1. Open "Nearby Needs"
2. Filter by category/urgency
3. Tap "I can help"
4. Propose time slot
5. Wait for requester acceptance

**Creates:** `commitment_<uuid>` with status "proposed"

## 7.3 Complete and Settle

1. Helper marks "Done"
2. Requester confirms "Done"
3. Settlement screen shows amount
4. If normal: "Pay X CR" -> creates `tx`
5. If crisis-supported: "Paid by Community Pool" -> creates `crisis_payment`

## 7.4 Enter Crisis Mode

1. Member toggles "I'm in crisis" (private)
2. Select reason (job loss/illness/other)
3. Request goes to stewards only
4. Steward approves with expiry date
5. Member can now request community-supported essentials

**Updates:** member.crisis_status, crisis_expires, crisis_approved_by

## 7.5 Auto-Repayment

When crisis member earns credits via normal trades:
- System routes `rho` fraction (20%) to pool automatically
- Display: "Repayment: 2 CR to Community (20%)"
- Member can request temporary pause via steward

## 7.6 Compassion Forgiveness

1. Steward proposes forgiveness (member_id, amount, reason)
2. Evidence hashes attached (optional)
3. Timelock set (7 days)
4. Elders sign (3 required)
5. Visible in Governance Log (redacted details)
6. After timelock: execute if not vetoed
7. Loss sink absorbs cost

---

# PART 8: UI ARCHITECTURE

## 8.1 Design Principles

1. **No public feed** - home screen shows tasks, not opinions
2. **Task-shaped content** - Needs, Offers, Projects, Commitments
3. **Private by default** - transactions visible only to counterparties
4. **Summarized reputation** - reliability signals, not popularity metrics
5. **Two-tap actions** - accessible for older users

## 8.2 Navigation (3 Tabs + Profile)

### Tab A: Needs
- Nearby needs filtered by: Essentials / Skills / Elder support
- Sort by: urgency -> proximity -> social distance -> recency
- No public comments, only "Message about this task"

### Tab B: Offers
- Goods & Swaps (vegetables, tools)
- Services (dog walking, repairs)
- Request / Propose swap / Schedule buttons

### Tab C: Projects
- Community events (beach clean, repair cafe)
- Join button, steward-managed check-in
- Optional small credit reward from pool (capped)

### Profile (Capability Card)
- Vouches, skills, availability
- **Not shown:** balances, leaderboards, total credits

## 8.3 Reputation Display (Anti-Toxic)

**Visible to others:**
- Vouched by: 3 people
- Commitments completed (60 days): 12
- No-shows (60 days): 0
- Open disputes: 0

**Never shown:**
- Total credits
- Transaction history
- Rankings / "top contributors"

## 8.4 Crisis Mode UI

**Recipient sees (private):**
- Weekly cap remaining: 12/20 CR
- Monthly cap remaining: 45/60 CR
- Outstanding obligation: 120 CR
- Auto-repay rate: 20%

**Provider sees:**
- "Paid by Community Pool"
- No stigma wording visible

**Stewards see:**
- Full crisis status and history

## 8.5 Governance Log

- Shows proposals: migrations, forgiveness, policy changes
- Redacted personal details
- Timelock countdown
- Signature counts
- No comment threads (only Support/Veto if enabled)

## 8.6 Notifications (No Dopamine Loops)

Only send for:
- Someone accepted your help offer
- Commitment reminders (day-of)
- Completion confirmation
- Disputes requiring action
- Governance items to sign

**Never:** "Someone posted something you might like"

## 8.7 Steward Mode

For assisted access (elders, disabled members):
- Post needs on their behalf
- Accept commitments for them
- Confirm completion (with audit trail)
- Cannot transfer credits without second confirmation

---

# PART 9: PRIVACY DEFAULTS

| Data | Default Visibility |
|------|-------------------|
| Transaction details | Counterparties only |
| Balances | Private |
| Location | Approximate until commitment accepted |
| Crisis status | Stewards only |
| Obligations | Member + stewards |
| Dispute details | Parties + mediators |
| Reputation stats | Public (minimal) |

---

# PART 10: OPERATIONAL CADENCE

## Weekly
- Stewards review crisis renewals and cap exceptions

## Monthly
- Review pool health (b_G), repayments, outstanding obligations

## Quarterly
- Audit governance actions (migrations, forgiveness)

## Annually
- Elder rotation/reconfirmation (optional)

---

# PART 11: NON-FIAT COVENANT

**Credits are:**
- Non-redeemable for fiat currency
- Non-convertible (no exchange rate)
- Valid only inside the circle
- Not "money" - they are claims/obligations within community capacity

**The system never:**
- Displays prices in euros/dollars
- Provides cash-out functionality
- Establishes official exchange rates
- Integrates with fiat payment systems

---

# PART 12: CULTURE STATEMENT

*Include in onboarding:*

1. We are here to meet needs and build resilience.
2. Commitments matter more than posts.
3. Privacy is respected; gossip is discouraged.
4. Crisis help is given with dignity and bounded by shared capacity.
5. Compassion is explicit, accountable, and renewable.

---

# PART 13: THREAT MODEL (MINIMAL SET)

## Must Engineer (Day 1)

| ID | Threat | Defense |
|----|--------|---------|
| E | Fat Finger | Circuit breaker (MAX_TRANSACTION) |
| G | Zombie Transaction | Pending-safe ledger with timeout |
| H | Lost Key | Multi-sig migration with timelock |
| M | Version Mismatch | Protocol negotiation, reject incompatible |
| L | Storage Bomb | Schema validation, size limits, rate limiting |
| A | Double Spend | Post-sync freeze + remediation |
| J | Replay Attack | Canonical hash + nonce idempotency |

## Engineer Lightly

| ID | Threat | Defense |
|----|--------|---------|
| C | Sybil | Trust graph warnings, vouch requirements |
| I | Clock Manipulation | Time is display-only, no hard enforcement |
| K | MITM | E2EE (implemented), add key fingerprint later |

## Handle Socially (Implement Later)

| ID | Threat | Approach |
|----|--------|----------|
| D | Disputes | Dispute system (implemented) |
| N | Credit Hoarding | Cultural; add demurrage if stagnation |
| O | Elder Corruption | Timelock + public log + veto |
| P | Circular Trading | Detection later if needed |
| T | Inheritance | Special migration case |

---

# PART 14: IMPLEMENTATION CHECKLIST

## Phase 1: Core System (Week 1-2)

- [ ] Conservation invariant enforced
- [ ] Normal transfer with dual signatures
- [ ] Credit limit validation with entry progression
- [ ] Circuit breaker (100 CR max)
- [ ] Account freeze/unfreeze logic
- [ ] Idempotency via canonical hash

## Phase 2: Crisis Provisioning (Week 3-4)

- [ ] Community Pool account
- [ ] Crisis payment transaction type
- [ ] Obligation tracking
- [ ] Repayment with auto-route
- [ ] Weekly/monthly caps enforcement
- [ ] Provider protection caps

## Phase 3: Governance (Week 5-6)

- [ ] Compassion forgiveness with multi-sig
- [ ] Loss sink account
- [ ] Timelock enforcement
- [ ] Migration (Phoenix account)
- [ ] Governance log visibility

## Phase 4: UI/UX (Week 7-8)

- [ ] Needs/Offers/Projects tabs
- [ ] Commitment workflow
- [ ] Crisis mode privacy UI
- [ ] Steward mode
- [ ] Reputation display (minimal)
- [ ] No-feed home screen

## Phase 5: Hardening (Week 9-10)

- [ ] Version negotiation
- [ ] Sync size/rate limits
- [ ] Pending transaction timeout
- [ ] Trust graph analysis
- [ ] Sybil warnings

---

# APPENDIX A: WORKED EXAMPLE

**Scenario:** Job loss crisis, 8 weeks, 50-member circle

**Setup:**
- N = 50, L_G = -1000, L_L = -250
- Weekly cap = 20 CR, Monthly cap = 60 CR
- Auto-repay = 20%

**Crisis Period:**
- Member draws ~15 CR/week in essentials
- Total support: 8 x 15 = 120 CR
- Pool: b_G -= 120
- Obligation: o_member = 120

**Recovery:**
- Member earns 30 CR/month via normal work
- Auto-repay: 0.20 x 30 = 6 CR/month
- Time to repay: 120 / 6 = 20 months (humane pace)

**Forgiveness (if needed):**
- If permanently unable to repay, elders forgive 60 CR
- o_member -= 60, b_L -= 60
- Loss absorbed by community, no individual debited

---

# APPENDIX B: CONFIGURATION DEFAULTS

```javascript
const CIRCLE_DEFAULTS = {
  // Transaction limits
  MAX_TRANSACTION: 100,
  LARGE_TRANSFER_CONFIRM: 20,

  // Entry limits
  CREDIT_LIMIT_PROGRESSION: [
    { months: 0, limit: 0, partners: 0 },
    { months: 1, limit: -10, partners: 3 },
    { months: 3, limit: -25, partners: 6 },
    { months: 6, limit: -50, partners: 10 },
    { months: 12, limit: -100, partners: 15 }
  ],

  // Pool and loss
  POOL_LIMIT_PER_MEMBER: 20,    // L_G = -20 * N
  LOSS_LIMIT_PER_MEMBER: 5,     // L_L = -5 * N

  // Crisis
  CRISIS_WEEKLY_CAP: 20,
  CRISIS_MONTHLY_CAP: 60,
  CRISIS_DURATION_WEEKS: 8,
  PROVIDER_WEEKLY_CAP: 100,
  AUTO_REPAY_FRACTION: 0.20,

  // Governance
  MIN_ELDERS_FORGIVENESS: 3,
  MIN_ELDERS_MIGRATION: 3,
  FORGIVENESS_TIMELOCK_DAYS: 7,
  MIGRATION_TIMELOCK_DAYS: 7,

  // Membership
  MIN_VOUCHERS: 1,
  MIN_VOUCHERS_LARGE_CIRCLE: 2,  // When N > 50

  // Essentials
  ESSENTIALS_CATEGORIES: [
    "food", "heat", "transport", "care", "repair", "hygiene"
  ],

  // Protocol
  PROTOCOL_VERSION: "1.0.0",
  MAX_DOC_SIZE: 32768,
  PENDING_TIMEOUT_HOURS: 24
};
```

---

**Document Version:** 1.0
**Source:** TechnoCommune Mathematical Model v0.1-0.7
**Implementation Status:** Ready for Development
