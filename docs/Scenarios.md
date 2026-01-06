# OpenGoban Stress Test Scenarios
## Complete Use Case Documentation

**Purpose:** Document all edge cases, attack vectors, and expected system behavior for the TechnoCommune mutual credit system.

**Principle:** Trust-based system on trustless infrastructure. Friction points occur where human nature collides with cryptographic logic.

---

# PART 1: IMPLEMENTED DEFENSES

## Category 1: Malicious Actors

### Scenario A: The "Double Dip" (Offline Double Spend)

**The Situation:**
"Slippery Sam" has a balance of **10 Credits** and a credit limit of **-50**. He goes offline (Airplane Mode).

**The Attack:**
1. Sam meets Alice, buys eggs -> Sends 10 CR (Balance: 0)
2. Sam walks to Bob, buys wood -> Sends 10 CR again (same credits!)
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

**Implementation Status:** IMPLEMENTED

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

**Mitigation - Entry Limits:**
```javascript
CREDIT_LIMIT_PROGRESSION: [
  { months: 0, limit: 0 },      // Day 1: Can't go negative at all
  { months: 1, limit: -10 },    // 1 month: Small trust
  { months: 3, limit: -25 },    // 3 months: Growing trust
  { months: 6, limit: -50 },    // 6 months: Full trust
]
```

**Implementation Status:** IMPLEMENTED

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

**Implementation Status:** IMPLEMENTED

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
| Social Pressure | Others see warning on Bob | "1 Unresolved Dispute" badge |
| Resolution Options | Bob refunds OR dispute stays | `resolveDispute()` with 'refunded'/'dismissed' |

**Implementation Status:** IMPLEMENTED

---

### Scenario E: The "Fat Finger" (User Error)

**The Situation:**
Gran wants to send **5** credits for milk. She accidentally types **500** and hits send.

**Expected Behavior:**

| Step | What Happens | Technical Mechanism |
|------|-------------|---------------------|
| User Types 500 | Amount entered in form | Client-side input |
| Validation Triggered | Circuit breaker blocks | `validateTransactionAmount()` |
| Error Displayed | "CIRCUIT BREAKER" message | Transaction never created |
| No Ledger Entry | Nothing to reverse | Protected at source |

**Configuration:**
```javascript
LIMITS: {
  MAX_TRANSACTION: 100,  // Circuit breaker threshold
}
```

**Implementation Status:** IMPLEMENTED

---

## Category 3: Technical Edge Cases

### Scenario F: The "Forked Village" (Network Partition)

**The Situation:**
A storm knocks out the bridge and internet. The village is split into **East Side** and **West Side** for 3 days.

**Expected Behavior:**

| Step | What Happens | Technical Mechanism |
|------|-------------|---------------------|
| During Partition | Both sides trade normally | Offline-first architecture |
| Bridge Reopens | P2P sync initiated | PeerJS WebRTC connection |
| Databases Merge | All transactions interleave | PouchDB replication protocol |
| ID Collision | UUIDs prevent collision | `tx_${Date.now()}_${randomId}` format |
| Balance Calculation | All transactions counted | `getBalance()` sums all confirmed tx |

**Implementation Status:** IMPLEMENTED (built into PouchDB)

---

### Scenario G: The "Zombie" Transaction (Interrupted Commit)

**The Situation:**
Alice sends a P2P transaction to Bob. Bob's battery dies EXACTLY as he hits "Accept" but before his phone writes to disk.

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
| Resolution | Alice re-sends or waits for timeout | Pending tx expires |

**Implementation Status:** PARTIAL - Needs pending transaction timeout

---

### Scenario H: The "Lost Key" (Hardware Failure)

**The Situation:**
Farmer Joe drops his phone in the cow trough. It is destroyed. He never backed up his recovery phrase. He has +80 CR balance.

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

**Implementation Status:** IMPLEMENTED

---

# PART 2: ADDITIONAL SCENARIOS (NOT YET IMPLEMENTED)

## Category 4: Advanced Technical Attacks

### Scenario I: The "Time Traveler" (Clock Manipulation)

**The Situation:**
Malicious user sets their device clock back to an earlier date/time.

**The Attack:**
1. User sets clock to yesterday
2. Creates transaction with old timestamp
3. Attempts to reorder transaction history
4. Could potentially manipulate balance calculations

**Impact:**
- Transaction ordering could be confused
- Might bypass time-based validations
- Could claim transactions happened before debts

**Proposed Defense:**
```javascript
// In createTransaction():
const serverTime = await getNetworkTime(); // Use NTP or peer consensus
const localTime = new Date();
const drift = Math.abs(serverTime - localTime);

if (drift > MAX_CLOCK_DRIFT) {
  throw new Error('Clock drift detected. Please sync your device time.');
}
```

**Implementation Status:** NOT IMPLEMENTED

---

### Scenario J: The "Replay Attack" (Transaction Duplication)

**The Situation:**
Attacker captures a valid signed transaction and attempts to submit it again.

**The Attack:**
1. Intercept a valid transaction (e.g., Alice -> Bob, 10 CR)
2. Wait for original to be processed
3. Submit the exact same transaction again
4. Bob receives 20 CR instead of 10 CR

**Current Protection:**
- Transactions have unique IDs with timestamp + nonce
- `receiveTransferQR()` checks for existing transaction

**Proposed Enhancement:**
```javascript
// Add explicit nonce tracking per sender
const usedNonces = await db.get('nonces_' + senderId);
if (usedNonces.includes(tx.nonce)) {
  throw new Error('Transaction already processed (replay detected)');
}
usedNonces.push(tx.nonce);
await db.put({ _id: 'nonces_' + senderId, nonces: usedNonces });
```

**Implementation Status:** PARTIAL - Basic check exists, could be stronger

---

### Scenario K: The "Man-in-the-Middle" (P2P Interception)

**The Situation:**
Attacker intercepts P2P WebRTC connection between two users.

**The Attack:**
1. Attacker positions between Alice and Bob's P2P connection
2. Intercepts key exchange
3. Decrypts, modifies, re-encrypts messages
4. Could change transaction amounts or recipients

**Current Protection:**
- E2EE using NaCl box (X25519 + XSalsa20-Poly1305)
- Key exchange happens at connection time

**Proposed Enhancement:**
```javascript
// Add key verification step (show fingerprint to verify verbally)
const fingerprint = await OGCrypto.getKeyFingerprint(peerPublicKey);
// UI shows: "Verify with peer: XXXX-XXXX-XXXX"
```

**Implementation Status:** PARTIAL - E2EE exists, fingerprint verification not implemented

---

### Scenario L: The "Storage Bomb" (Database Corruption)

**The Situation:**
Attacker or bug causes database to grow uncontrollably or become corrupted.

**The Attack:**
1. Sync with malicious peer that has millions of fake transactions
2. IndexedDB fills up browser storage quota
3. App crashes or becomes unusable
4. User loses all their data

**Proposed Defense:**
```javascript
// Validate incoming sync data
function validateSyncDocument(doc) {
  if (doc.type === 'transaction' && doc.amount > LIMITS.MAX_TRANSACTION) {
    return false; // Reject obviously invalid
  }
  if (doc._id.length > 100) {
    return false; // Reject suspicious IDs
  }
  return true;
}

// In sync handler:
db.sync(remote, {
  filter: function(doc) {
    return validateSyncDocument(doc);
  }
});
```

**Implementation Status:** NOT IMPLEMENTED

---

### Scenario M: The "Version Mismatch" (Protocol Incompatibility)

**The Situation:**
Users running different versions of the app try to sync.

**The Problem:**
- New version has different transaction format
- Old version can't validate new signatures
- Sync fails or produces corrupt data

**Proposed Defense:**
```javascript
// Add version negotiation to P2P handshake
const PROTOCOL_VERSION = '1.0.0';

// During connection:
if (peerVersion !== PROTOCOL_VERSION) {
  if (!isCompatible(peerVersion, PROTOCOL_VERSION)) {
    throw new Error(`Incompatible app version. You: ${PROTOCOL_VERSION}, Peer: ${peerVersion}`);
  }
}
```

**Implementation Status:** NOT IMPLEMENTED

---

## Category 5: Social/Economic Gaming

### Scenario N: The "Credit Hoarder" (Deflationary Spiral)

**The Situation:**
Wealthy member accumulates +500 CR and refuses to spend, causing credit scarcity.

**The Problem:**
- Other members can't earn because no one is spending
- Economy stagnates
- New members can't participate

**Proposed Defenses:**
1. **Demurrage (negative interest):** Credits decay 1% per month
2. **Maximum balance cap:** Can't accumulate more than +200 CR
3. **Velocity incentives:** Discounts for frequent traders

```javascript
// Demurrage implementation
async function applyDemurrage() {
  const members = await getAllMembers();
  for (const member of members) {
    const balance = await getBalance(member._id);
    if (balance > 0) {
      const decay = Math.floor(balance * 0.01); // 1% decay
      if (decay > 0) {
        // Create demurrage transaction
        await createDemurrageTransaction(member._id, decay);
      }
    }
  }
}
```

**Implementation Status:** NOT IMPLEMENTED

---

### Scenario O: The "Elder Corruption" (Governance Attack)

**The Situation:**
3 elders collude to abuse their multi-sig powers.

**The Attack:**
1. Three elders secretly agree to steal from a member
2. Create fake "migration request" claiming member lost their phone
3. Migrate balance to a controlled account
4. Split the stolen credits

**Proposed Defenses:**
1. **Time lock:** Migration requires 7-day waiting period
2. **Victim notification:** Original key holder gets push notification
3. **Community veto:** Any 5 members can veto a migration
4. **Elder rotation:** Elders must be re-elected annually

```javascript
// Time lock on migrations
const MIGRATION_TIME_LOCK = 7 * 24 * 60 * 60 * 1000; // 7 days

async function executeMigration(migrationId) {
  const migration = await db.get(migrationId);
  const elapsed = Date.now() - new Date(migration.approved_at);

  if (elapsed < MIGRATION_TIME_LOCK) {
    throw new Error(`Migration locked. ${Math.ceil((MIGRATION_TIME_LOCK - elapsed) / 86400000)} days remaining.`);
  }
  // ... proceed with execution
}
```

**Implementation Status:** NOT IMPLEMENTED

---

### Scenario P: The "Circular Wash" (Fake Activity)

**The Situation:**
Group creates circular transactions to inflate their apparent activity.

**The Attack:**
1. Alice sends 100 to Bob
2. Bob sends 100 to Carol
3. Carol sends 100 to Alice
4. Repeat daily
5. All three appear to be "active traders" with zero net economic activity

**Detection Method:**
```javascript
async function detectCircularTrading(memberId, windowDays = 30) {
  const txs = await getTransactions(memberId, { days: windowDays });

  // Build flow graph
  const inflow = {};
  const outflow = {};

  for (const tx of txs) {
    if (tx.sender_id === memberId) {
      outflow[tx.recipient_id] = (outflow[tx.recipient_id] || 0) + tx.amount;
    } else {
      inflow[tx.sender_id] = (inflow[tx.sender_id] || 0) + tx.amount;
    }
  }

  // Check for balanced pairs (sign of wash trading)
  const suspiciousPairs = [];
  for (const partner in outflow) {
    if (inflow[partner]) {
      const ratio = Math.min(outflow[partner], inflow[partner]) /
                    Math.max(outflow[partner], inflow[partner]);
      if (ratio > 0.9) { // 90%+ balanced = suspicious
        suspiciousPairs.push({ partner, ratio });
      }
    }
  }

  return { suspicious: suspiciousPairs.length > 0, pairs: suspiciousPairs };
}
```

**Implementation Status:** NOT IMPLEMENTED

---

### Scenario Q: The "Shell Game" (Identity Fragmentation)

**The Situation:**
User maintains multiple legitimate-looking identities to game entry limits.

**The Attack:**
1. Create Account A (limit: 0)
2. Wait 1 month, Account A limit becomes -10
3. Create Account B (limit: 0)
4. Transfer 10 CR from A to B
5. Now A is at -10, B has +10
6. Repeat with more accounts

**Proposed Defense:**
Device fingerprinting or social graph analysis

```javascript
// Track device fingerprints
async function checkForDuplicateDevices(newMemberId) {
  const fingerprint = await getDeviceFingerprint();
  const existing = await db.query('members/by_fingerprint', { key: fingerprint });

  if (existing.rows.length > 0) {
    return {
      warning: 'Device already has registered account',
      existing_member: existing.rows[0].id
    };
  }
}
```

**Implementation Status:** NOT IMPLEMENTED

---

## Category 6: Usability Edge Cases

### Scenario R: The "Orphan Circle" (No Elders Available)

**The Situation:**
Small circle of 5 members. All 3 elders move away or become unavailable. New member needs a migration but can't get elder signatures.

**Proposed Defense:**
```javascript
// Elder succession protocol
async function nominateSuccessorElder(currentElderId, nomineeId) {
  // Any elder can nominate their successor
  // Requires community vote (majority of active members)
}

// Emergency elder election
async function emergencyElderElection(circleId) {
  const members = await getCircleMembers(circleId);
  const activeElders = members.filter(m => m.role === 'elder' && m.status === 'active');

  if (activeElders.length < 3) {
    // Trigger emergency election
    // Most active traders become interim elders
  }
}
```

**Implementation Status:** NOT IMPLEMENTED

---

### Scenario S: The "Cold Start" (Bootstrap Problem)

**The Situation:**
New community wants to start a circle. But to join, you need a vouch. But there are no members yet.

**Current Solution:**
- First member (creator) becomes Elder automatically
- Creator can vouch for initial members

**Proposed Enhancement:**
```javascript
// Bootstrap mode for new circles
const circle = await createCircle('Village Circle');
// Creator automatically becomes active elder
// First 5 members need only creator vouch
// After 5 members, normal vouch requirements apply
```

**Implementation Status:** PARTIAL - Creator becomes elder, but no explicit bootstrap mode

---

### Scenario T: The "Inheritance" (Member Death)

**The Situation:**
Member with +200 CR balance passes away. Family wants to claim the credits.

**Proposed Protocol:**
1. Family member contacts elders
2. Provides proof of death (death certificate)
3. Designates beneficiary
4. Elders create special "inheritance migration"
5. Balance transfers to beneficiary

```javascript
// Inheritance transfer type
const inheritance = {
  _id: `inherit_${Date.now()}`,
  type: 'inheritance',
  deceased_member_id: 'member_deceased',
  beneficiary_member_id: 'member_heir',
  death_certificate_hash: hashOf(certificate),
  elder_signatures: [],
  required_signatures: 3
};
```

**Implementation Status:** NOT IMPLEMENTED

---

### Scenario U: The "Split Circle" (Community Schism)

**The Situation:**
Political dispute causes half the circle to want to leave and form their own circle.

**The Problem:**
- How do balances transfer?
- What happens to debts owed across the split?
- Who keeps the circle identity?

**Proposed Protocol:**
1. Fork creates new circle with subset of members
2. Cross-circle debts become "foreign" obligations
3. Members can settle debts before fork
4. Unsettled debts are recorded as "external claims"

**Implementation Status:** NOT IMPLEMENTED

---

## Category 7: Regulatory/External

### Scenario V: The "Taxman Cometh" (Legal Compliance)

**The Situation:**
Tax authority demands records of all transactions for audit.

**The Problem:**
- Community credits may be taxable as barter income
- Need export capability for compliance

**Proposed Feature:**
```javascript
async function exportForTax(memberId, year) {
  const txs = await getTransactions(memberId);
  const yearTxs = txs.filter(tx =>
    new Date(tx.created_at).getFullYear() === year
  );

  return {
    member_handle: member.handle,
    tax_year: year,
    total_income: yearTxs.filter(tx => tx.recipient_id === memberId).reduce((sum, tx) => sum + tx.amount, 0),
    total_expenses: yearTxs.filter(tx => tx.sender_id === memberId).reduce((sum, tx) => sum + tx.amount, 0),
    transactions: yearTxs.map(tx => ({
      date: tx.created_at,
      counterparty: tx.sender_id === memberId ? tx.recipient_id : tx.sender_id,
      amount: tx.amount,
      description: tx.description,
      type: tx.sender_id === memberId ? 'expense' : 'income'
    }))
  };
}
```

**Implementation Status:** NOT IMPLEMENTED

---

### Scenario W: The "Data Request" (GDPR/Privacy)

**The Situation:**
Member invokes right to be forgotten (GDPR Article 17).

**The Problem:**
- Ledger is designed to be immutable
- But user has legal right to data deletion

**Proposed Approach:**
- Personal data (handle, profile) can be anonymized
- Transaction history preserved but de-identified
- "Deleted Member #12345" replaces actual identity

```javascript
async function anonymizeMember(memberId) {
  const member = await getMember(memberId);
  const anonId = `anon_${Date.now()}`;

  member.handle = 'Deleted Member';
  member.public_key = 'REDACTED';
  member.status = 'anonymized';
  member.anonymized_at = new Date().toISOString();

  await db.put(member);
  // Transactions remain with member_id intact but profile is gone
}
```

**Implementation Status:** NOT IMPLEMENTED

---

### Scenario X: The "Fiat Bridge" (Currency Exchange)

**The Situation:**
Member wants to convert credits to/from government currency.

**The Risk:**
- Exchange rate manipulation
- Money laundering concerns
- Regulatory licensing requirements

**Proposed Approach:**
- No official exchange rate
- P2P marketplace for exchange (like LocalBitcoins)
- Disclaimer: "Exchange at your own risk"
- No platform-facilitated fiat conversion

**Implementation Status:** OUT OF SCOPE (intentionally)

---

# PART 3: IMPLEMENTATION PRIORITY MATRIX

## Critical (Day 1)

| Scenario | Risk Level | Implemented |
|----------|------------|-------------|
| E: Fat Finger | HIGH | YES |
| B: Exit Scam (Entry Limits) | HIGH | YES |
| A: Double Dip (Freeze) | HIGH | YES |

## Important (Week 1)

| Scenario | Risk Level | Implemented |
|----------|------------|-------------|
| D: Disputes | MEDIUM | YES |
| C: Sybil Attack | MEDIUM | YES |
| H: Lost Key (Recovery) | MEDIUM | YES |
| G: Zombie Transaction | MEDIUM | PARTIAL |

## Enhancement (Month 1)

| Scenario | Risk Level | Implemented |
|----------|------------|-------------|
| I: Time Traveler | LOW | NO |
| J: Replay Attack | LOW | PARTIAL |
| K: Man-in-the-Middle | LOW | PARTIAL |
| M: Version Mismatch | LOW | NO |

## Future Consideration

| Scenario | Risk Level | Implemented |
|----------|------------|-------------|
| N: Credit Hoarder | LOW | NO |
| O: Elder Corruption | MEDIUM | NO |
| P: Circular Wash | LOW | NO |
| Q: Shell Game | LOW | NO |
| R: Orphan Circle | LOW | NO |
| S: Cold Start | LOW | PARTIAL |
| T: Inheritance | LOW | NO |
| U: Split Circle | LOW | NO |
| V: Tax Export | LOW | NO |
| W: GDPR/Privacy | MEDIUM | NO |
| X: Fiat Bridge | N/A | OUT OF SCOPE |

---

# PART 4: CONFIGURATION REFERENCE

```javascript
// validation.js - Key parameters
const LIMITS = {
  // Circuit breaker - max single transaction
  MAX_TRANSACTION: 100,

  // Entry limits
  NEW_MEMBER_CREDIT_LIMIT: 0,

  // Multi-sig requirements
  MIN_ELDERS_FOR_RECOVERY: 3,
  MIN_ELDERS_FOR_FORGIVENESS: 3,

  // Breach detection
  FREEZE_THRESHOLD: 0,

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

# PART 5: TESTING CHECKLIST

## Pre-Launch Critical

- [ ] Circuit Breaker: Send 150 CR -> BLOCKED
- [ ] Entry Limit: New user sends 1 CR -> BLOCKED
- [ ] Frozen Account: Freeze account, try to send -> BLOCKED
- [ ] Double Spend: Create conflicting offline tx, sync, verify freeze

## Week 1 Tests

- [ ] Dispute Flow: Create, view on profile, resolve
- [ ] Trust Graph: Create isolated cluster, verify warning
- [ ] Social Recovery: Full migration flow with 3 elders
- [ ] Jubilee: Full debt forgiveness flow

## Ongoing Monitoring

- [ ] Watch for isolated trading clusters (Sybil)
- [ ] Monitor account freeze events
- [ ] Track dispute resolution rates
- [ ] Audit elder actions quarterly

---

**Document Version:** 2.0
**Last Updated:** 2026-01-06
**Prepared by:** Sentinel Analysis Module
**Total Scenarios:** 24
