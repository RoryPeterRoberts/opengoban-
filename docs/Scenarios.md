# OpenGoban Stress Test Scenarios

**Purpose:** Document edge cases, attack vectors, and expected system behavior for the TechnoCommune mutual credit system.

**Principle:** Trust-based system on trustless infrastructure. Friction points occur where human nature collides with cryptographic logic.

---

## Category 1: Malicious Actors

### Scenario A: The "Double Dip" (Offline Double Spend)

**The Situation:**
"Slippery Sam" has a balance of **10 Credits** and a credit limit of **-50**. He goes offline (Airplane Mode).

**The Attack:**
1. Sam meets Alice, buys eggs → Sends 10 CR (Balance: 0)
2. Sam walks to Bob, buys wood → Sends 10 CR again (same credits!)
3. Both Alice and Bob accept the transactions (they're cryptographically valid)
4. Sam reconnects and syncs

**Expected Behavior:**

| Step | What Happens | Technical Mechanism |
|------|-------------|---------------------|
| Offline Transactions | Both accepted locally | Valid signatures, no network to check |
| Sync Occurs | All transactions merge | PouchDB replication interleaves |
| Post-Sync Validation | System detects breach | `OGValidation.detectLimitBreaches()` |
| Account Freeze | Sam's account frozen | `status: 'frozen'` set on member doc |
| Notification | UI shows freeze alert | `tc-validation-actions` event fired |
| Resolution | Sam must earn +10 to unfreeze | `unfreezeAccount()` checks balance >= limit |

**Code Path:**
```javascript
// After sync completes:
const actions = await OGLedger.runPostSyncValidation();
// Returns: [{ type: 'account_frozen', member_id: 'member_sam', breach_amount: 10 }]
```

**Key Insight:** System accepts the "bad check" but freezes the account. Bob has valid credits - the system inflates slightly rather than invalidate Bob's transaction. Social shame (frozen status visible) prevents repeat offenses.

---

### Scenario B: The "Exit Scam" (Max-Out and Disappear)

**The Situation:**
"Drifter Dave" joins the community. Through the entry limit system, he earns a credit limit of **-50 CR** over 6 months.

**The Attack:**
1. Dave rapidly buys from 5 different people until hitting -50 CR
2. Dave deletes the app, destroys his phone, leaves town
3. Community is left with 50 credits of unrecoverable debt

**Expected Behavior:**

| Step | What Happens | Technical Mechanism |
|------|-------------|---------------------|
| Spending | Limited by credit_limit | Entry limits restrict new users |
| Account Abandoned | Debt sits on ledger | Balance: -50, Status: active |
| Community Notices | Dave hasn't been seen | Manual social observation |
| Elder Action | Create forgiveness request | `OGValidation.createForgivenessRequest()` |
| Multi-Sig Approval | 3+ elders sign | `signForgiveness()` collects signatures |
| Jubilee Execution | Debt cancelled, key burned | `executeForgiveness()` mints +50, revokes Dave |

**Code Path:**
```javascript
// Elders initiate Jubilee:
const request = await OGValidation.createForgivenessRequest(db, 'member_dave', 'member_elder1', 'Left town with debt');
await OGValidation.signForgiveness(db, request._id, 'member_elder1', sig1);
await OGValidation.signForgiveness(db, request._id, 'member_elder2', sig2);
await OGValidation.signForgiveness(db, request._id, 'member_elder3', sig3);
await OGValidation.executeForgiveness(db, request._id);
// Creates mint_*_jubilee transaction, sets member status: 'revoked'
```

**Mitigation - Entry Limits:**
```javascript
// New member progression (validation.js):
CREDIT_LIMIT_PROGRESSION: [
  { months: 0, limit: 0 },      // Day 1: Can't go negative at all
  { months: 1, limit: -10 },    // 1 month: Small trust
  { months: 3, limit: -25 },    // 3 months: Growing trust
  { months: 6, limit: -50 },    // 6 months: Full trust
]
```

**Key Insight:** Exit scams are capped by entry limits. New members can't extract value until they've demonstrated commitment. Jubilee protocol allows community to write off bad debt without it permanently deflating the currency.

---

### Scenario C: The "Sybil" Attack (Fake Friends)

**The Situation:**
A bad actor creates 10 fake accounts to game the system.

**The Attack:**
1. Create multiple keypairs (10 fake identities)
2. Have fake accounts "vouch" for each other
3. Trade credits in circles to fake economic activity
4. Build fake reputation to extract real value

**Expected Behavior:**

| Step | What Happens | Technical Mechanism |
|------|-------------|---------------------|
| Account Creation | Requires vouch from existing member | `min_vouchers: 1` in circle settings |
| Fake Vouch Chain | Creates isolated cluster | Only fake accounts vouch for each other |
| Trade Pattern | Circular, insular | Only trade within the 10 accounts |
| Detection | Trust graph analysis | `OGValidation.analyzeTrustGraph()` |
| Warning Display | UI shows "isolated cluster" | Warning shown when scanning unknown member |

**Code Path:**
```javascript
// When viewing a member's profile:
const analysis = await OGLedger.analyzeTrustGraph('member_suspicious');
// Returns:
{
  member_id: 'member_suspicious',
  unique_trade_partners: 3,
  is_isolated_cluster: true,
  cluster_size: 4,
  warning: 'SYBIL WARNING: Member trades only within isolated cluster'
}
```

**Key Insight:** The "Web of Trust" visualization exposes Sybil clusters. Legitimate members trade with diverse partners; fake clusters only trade with themselves. UI should show: *"⚠️ Verified by unknown cluster"* when encountering potential Sybils.

---

## Category 2: Trade Disputes

### Scenario D: The "Rotten Asparagus" (Product Failure)

**The Situation:**
Alice pays Bob 15 CR for a basket of vegetables. Two days later, she discovers they are rotten.

**The Conflict:**
- Bob refuses refund: "Caveat Emptor" (Buyer Beware)
- There is no "Central Bank" to reverse the charge
- The transaction is cryptographically immutable

**Expected Behavior:**

| Step | What Happens | Technical Mechanism |
|------|-------------|---------------------|
| Transaction Complete | 15 CR transferred | Standard confirmed transaction |
| Problem Discovered | Alice finds rotten vegetables | Real-world event |
| Dispute Created | Alice flags the transaction | `OGLedger.createDispute(txId, reason)` |
| Reputation Impact | Bob's profile shows dispute | `getDisputeCount()` returns {open: 1} |
| Social Pressure | Others see warning on Bob | "⚠️ 1 Unresolved Dispute" badge |
| Resolution Options | Bob refunds OR dispute stays | `resolveDispute()` with 'refunded'/'dismissed' |

**Code Path:**
```javascript
// Alice creates dispute:
await OGLedger.createDispute('tx_12345_abc', 'Vegetables were rotten on delivery');

// When anyone views Bob's profile:
const disputes = await OGLedger.getDisputeCount('member_bob');
// Returns: { open: 1, total: 1 }

// If Bob refunds (creates new transaction back to Alice):
await OGValidation.resolveDispute(db, 'dispute_xxx', 'refunded', ['member_bob']);
```

**Key Insight:** The ledger is immutable, but reputation is not. Disputes create *social* pressure rather than *technical* reversals. Bob is incentivized to resolve fairly to maintain his standing.

---

### Scenario E: The "Fat Finger" (User Error)

**The Situation:**
Gran wants to send **5** credits for milk. She accidentally types **500** and hits send.

**The Conflict:**
- The recipient (honest or not) might accept it
- Gran's account would be devastated
- No central authority to "fix" the mistake

**Expected Behavior:**

| Step | What Happens | Technical Mechanism |
|------|-------------|---------------------|
| User Types 500 | Amount entered in form | Client-side input |
| Validation Triggered | Circuit breaker blocks | `validateTransactionAmount()` |
| Error Displayed | "CIRCUIT BREAKER" message | Transaction never created |
| No Ledger Entry | Nothing to reverse | Protected at source |

**Code Path:**
```javascript
// In OGLedger.createTransaction():
const validation = OGValidation.validateTransactionAmount(500, balance, creditLimit);
// Returns:
{
  valid: false,
  error: 'CIRCUIT BREAKER: Transaction exceeds 100 credit limit. Split into smaller transactions.'
}
// Transaction BLOCKED - never reaches the ledger
```

**Configuration:**
```javascript
// validation.js
LIMITS: {
  MAX_TRANSACTION: 100,  // Circuit breaker threshold
}
```

**Key Insight:** The circuit breaker blocks catastrophic mistakes at the client level. For legitimate large purchases, users must split into multiple transactions (which also creates natural pause points for verification).

---

## Category 3: Technical Edge Cases

### Scenario F: The "Forked Village" (Network Partition)

**The Situation:**
A storm knocks out the bridge and internet. The village is split into **East Side** and **West Side** for 3 days.

**The Chaos:**
- East trades with East (100 transactions)
- West trades with West (80 transactions)
- Some users exist on both sides (crossed before storm)
- Transaction IDs may collide

**Expected Behavior:**

| Step | What Happens | Technical Mechanism |
|------|-------------|---------------------|
| During Partition | Both sides trade normally | Offline-first architecture |
| Bridge Reopens | P2P sync initiated | PeerJS WebRTC connection |
| Databases Merge | All transactions interleave | PouchDB replication protocol |
| ID Collision | UUIDs prevent collision | `tx_${Date.now()}_${randomId}` format |
| Balance Calculation | All transactions counted | `getBalance()` sums all confirmed tx |
| Breach Detection | Post-sync validation runs | `runPostSyncValidation()` |

**Code Path:**
```javascript
// When devices reconnect via P2P:
// PouchDB sync event fires
// Our handler calls:
await OGLedger.runPostSyncValidation();
// This detects any users who over-spent during the partition
```

**Key Insight:** CouchDB/PouchDB's replication protocol is designed for exactly this scenario. It uses Merkle trees to efficiently merge divergent histories. Transaction IDs include timestamps AND random components to prevent collision.

---

### Scenario G: The "Zombie" Transaction (Interrupted Commit)

**The Situation:**
Alice sends a P2P transaction to Bob.

**The Glitch:**
- Bob's phone receives the transaction
- Bob hits "Accept"
- Battery dies EXACTLY before the write completes
- Alice's phone shows: "Sent successfully!"
- Bob's phone (when charged): Shows nothing

**The Problem:**
- Alice: -10 CR (she signed the send)
- Bob: +0 CR (never confirmed)
- 10 credits have "vanished" from the economy

**Expected Behavior:**

| Step | What Happens | Technical Mechanism |
|------|-------------|---------------------|
| Alice Sends | Creates pending transaction | `status: 'pending'` with sender_signature |
| Bob Accepts | Should add recipient_signature | `confirmTransaction()` |
| Crash Occurs | Write never completes | IndexedDB transaction fails |
| Bob Reboots | Transaction not in his DB | Pending tx lost |
| Alice's View | Still shows "pending" | No confirmation received |
| Resolution | Alice can re-send or cancel | Pending tx times out |

**Current Gap:**
The current implementation doesn't have explicit timeout for pending transactions.

**Recommended Enhancement:**
```javascript
// Add to validation.js:
async function cleanupStalePendingTransactions(db, maxAgeHours = 24) {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  // Find pending tx older than cutoff
  // Mark as 'expired' - credits returned to sender
}
```

**Key Insight:** True atomic commits require both parties to write, which is impossible to guarantee across devices. Solution: Treat unconfirmed transactions as "pending" with timeout. Credits aren't "gone" - they're locked in sender's pending outbox.

---

### Scenario H: The "Lost Key" (Hardware Failure)

**The Situation:**
Farmer Joe drops his phone in the cow trough. It is destroyed. He never backed up his recovery phrase.

**The Crisis:**
- Joe has +80 CR balance (80 hours of labor stored)
- His private key is cryptographically locked on a dead device
- No one can access or spend those credits

**Expected Behavior:**

| Step | What Happens | Technical Mechanism |
|------|-------------|---------------------|
| Phone Destroyed | Private key lost | Ed25519 keypair gone |
| Joe Gets New Phone | Creates new keypair | `OGCrypto.createIdentity()` |
| Joe Reports Loss | Contacts community elders | Social process |
| Migration Request | Elder creates request | `createMigrationRequest()` |
| Physical Verification | 3+ elders meet Joe in person | Anti-impersonation |
| Elders Sign | Multi-sig approval | `signMigration()` x 3 |
| Migration Executes | Balance transferred | `executeMigration()` |
| Old Key Revoked | Cannot be used again | `status: 'revoked'` |

**Code Path:**
```javascript
// Joe contacts elders, gets new phone, generates new key
const newPublicKey = await OGCrypto.getPublicKey();

// Elder 1 creates migration request:
const migration = await OGValidation.createMigrationRequest(
  db,
  'member_joe_old_id',
  newPublicKey,
  'member_elder1'
);

// Elders meet Joe physically, verify identity, sign:
await OGValidation.signMigration(db, migration._id, 'member_elder1', sig1);
await OGValidation.signMigration(db, migration._id, 'member_elder2', sig2);
await OGValidation.signMigration(db, migration._id, 'member_elder3', sig3);
// migration.status is now 'approved'

// Execute the migration:
const result = await OGValidation.executeMigration(db, migration._id);
// Creates new member doc, transfers balance, revokes old key
```

**Security Notes:**
- Requires MIN_ELDERS_FOR_RECOVERY (3) physical verifications
- Old key is marked revoked (can never be used again)
- Tenure (credit limit progression) transfers to new account
- All historical transactions remain attributed to old ID

**Key Insight:** Social recovery replaces "trustless" with "trust-in-community". The multi-sig requirement prevents a single compromised elder from stealing accounts. Physical verification prevents remote impersonation.

---

## Implementation Status

| Scenario | Status | Implementation |
|----------|--------|----------------|
| A: Double Dip | ✅ Implemented | `detectLimitBreaches()`, `freezeAccount()` |
| B: Exit Scam | ✅ Implemented | Entry limits + Jubilee protocol |
| C: Sybil Attack | ✅ Implemented | `analyzeTrustGraph()` |
| D: Disputes | ✅ Implemented | `createDispute()`, `getDisputeCount()` |
| E: Fat Finger | ✅ Implemented | Circuit breaker (MAX_TRANSACTION: 100) |
| F: Network Partition | ✅ Built-in | PouchDB replication handles this |
| G: Zombie Transaction | ⚠️ Partial | Needs pending tx timeout |
| H: Lost Key | ✅ Implemented | Phoenix account migration |

---

## Testing Checklist

### Day 1 Critical Tests

- [ ] **Circuit Breaker:** Try to send 150 credits → Should be blocked
- [ ] **Entry Limit:** New account tries to spend → Should be blocked (limit: 0)
- [ ] **Frozen Account:** Freeze an account manually → Verify can't send

### Week 1 Tests

- [ ] **Double Spend Simulation:** Create conflicting offline transactions, sync, verify freeze
- [ ] **Dispute Flow:** Create dispute, verify it shows on member profile
- [ ] **Trust Graph:** Create isolated trading cluster, verify warning

### Month 1 Tests

- [ ] **Social Recovery:** Simulate lost phone, run full migration flow
- [ ] **Jubilee Protocol:** Simulate abandoned debt, run full forgiveness flow
- [ ] **Network Partition:** Two groups trade offline, merge, verify all transactions present

---

## Configuration Reference

```javascript
// validation.js - Key parameters
const LIMITS = {
  MAX_TRANSACTION: 100,                    // Circuit breaker
  NEW_MEMBER_CREDIT_LIMIT: 0,              // Entry limit (earn before spend)
  MIN_ELDERS_FOR_RECOVERY: 3,              // Phoenix account requirement
  MIN_ELDERS_FOR_FORGIVENESS: 3,           // Jubilee requirement
  FREEZE_THRESHOLD: 0,                      // Any breach triggers freeze

  // Credit limit progression
  CREDIT_LIMIT_PROGRESSION: [
    { months: 0, limit: 0 },
    { months: 1, limit: -10 },
    { months: 3, limit: -25 },
    { months: 6, limit: -50 },
    { months: 12, limit: -100 }
  ]
};
```

---

*Document Version: 1.0*
*Last Updated: 2026-01-06*
*Prepared by: Sentinel Analysis Module*
