# TECHNICAL SPECIFICATION v1.0
## TechnoCommune Ledger: Local-First Mutual Credit System

**Classification:** Internal - Engineering Document
**Version:** 1.0
**Date:** 2024

---

## 1. ARCHITECTURE: THE "GHOST" NETWORK

### Objective
Create a database that lives everywhere and nowhere.

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        THE GHOST NETWORK                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   [PHONE A]          [COMMUNITY HUB]          [PHONE B]        │
│   PouchDB  ◄──WiFi──► CouchDB      ◄──WiFi──► PouchDB         │
│      │                    │                       │             │
│      │                    │                       │             │
│      └────────QR/NFC──────┼───────QR/NFC─────────┘             │
│           (Offline)       │        (Offline)                    │
│                           │                                     │
│                      [SOLAR POWER]                              │
│                      [LoRa ANTENNA]                             │
│                           │                                     │
│                    ◄──LoRa──► [FARM SENSORS]                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Descriptions

| Layer | Technology | Function | Failure Mode |
|-------|------------|----------|--------------|
| Client | PouchDB (Browser) | Local storage, offline ops | Phone dies → data on other phones |
| Hub | CouchDB (RPi) | Sync coordination | Hub dies → phones still work |
| Transport | WiFi / QR / NFC | Data exchange | Internet dies → QR codes work |
| Long Range | LoRa / Meshtastic | Announcements, pings | Power dies → solar backup |

### Resilience Principle
- If the Hub is destroyed, data exists on 10 phones
- If 9 phones are destroyed, data exists on 1 phone + Hub
- If internet dies permanently, QR code transfer works indefinitely

---

## 2. DATA SCHEMA

### Document Types

All data stored as JSON documents in PouchDB/CouchDB.

### 2.1 Member Document

```json
{
  "_id": "member_<uuid>",
  "type": "member",
  "handle": "AsparagusJoe",
  "public_key": "-----BEGIN PUBLIC KEY-----\nMIIBI...",
  "created_at": "2024-05-01T10:00:00Z",
  "updated_at": "2024-05-01T10:00:00Z",
  "vouchers": [
    "member_<uuid_alice>",
    "member_<uuid_bob>"
  ],
  "offers": ["asparagus", "garden labor", "seed saving"],
  "wants": ["eggs", "bread", "equipment repair"],
  "status": "active",
  "credit_limit": {
    "min": -50,
    "max": 100
  }
}
```

**Validation Rules:**
- `handle`: 3-32 characters, alphanumeric + underscore
- `vouchers`: Minimum 2 existing members for full membership
- `public_key`: Valid RSA or Ed25519 public key
- `status`: enum ["pending", "active", "suspended", "departed"]

### 2.2 Transaction Document

```json
{
  "_id": "tx_<timestamp>_<uuid>",
  "type": "transaction",
  "created_at": "2024-06-12T14:30:00Z",
  "sender_id": "member_<uuid_alice>",
  "recipient_id": "member_<uuid_joe>",
  "amount": 5,
  "description": "5kg asparagus for community dinner",
  "category": "food",
  "location": {
    "name": "Sunday Market",
    "coords": [53.5, -6.2]
  },
  "signatures": {
    "sender": "<base64_signature>",
    "recipient": "<base64_signature>",
    "witness": null
  },
  "status": "confirmed",
  "synced_to_hub": true
}
```

**Validation Rules:**
- `amount`: Positive integer, max 100 per transaction
- `sender_id`: Must exist, must have sufficient balance
- `signatures.sender`: Required, must verify against sender's public key
- `signatures.recipient`: Required for status="confirmed"
- `status`: enum ["pending", "confirmed", "disputed", "cancelled"]

### 2.3 Mint Document (Proof of Care)

```json
{
  "_id": "mint_<timestamp>_<uuid>",
  "type": "mint",
  "created_at": "2024-06-15T09:00:00Z",
  "beneficiaries": [
    {"member_id": "member_<uuid_1>", "amount": 10},
    {"member_id": "member_<uuid_2>", "amount": 10},
    {"member_id": "member_<uuid_3>", "amount": 10}
  ],
  "total_minted": 30,
  "work_type": "beach_cleanup",
  "description": "3 hours beach cleanup at Dollymount",
  "evidence": {
    "photos": [],
    "gps_track": null
  },
  "required_signatures": 3,
  "signatures": {
    "elder_1": "<signature>",
    "elder_2": "<signature>",
    "elder_3": "<signature>"
  },
  "status": "confirmed"
}
```

**Validation Rules:**
- `required_signatures`: Minimum 3 for any mint operation
- `signatures`: All must be from members with `role: "elder"`
- `total_minted`: Max 100 per mint event

### 2.4 Announcement Document

```json
{
  "_id": "announce_<timestamp>_<uuid>",
  "type": "announcement",
  "created_at": "2024-06-12T08:00:00Z",
  "author_id": "member_<uuid>",
  "title": "Fresh asparagus at Sunday market",
  "body": "Harvested this morning, 3 credits per kg",
  "category": "marketplace",
  "expires_at": "2024-06-13T18:00:00Z",
  "signature": "<base64_signature>"
}
```

---

## 3. CORE FUNCTIONS

### 3.1 Balance Calculation

```javascript
function calculateBalance(memberId, allTransactions, allMints) {
  let balance = 0;

  // Credits received
  for (const tx of allTransactions) {
    if (tx.status !== 'confirmed') continue;
    if (tx.recipient_id === memberId) balance += tx.amount;
    if (tx.sender_id === memberId) balance -= tx.amount;
  }

  // Credits minted (Proof of Care)
  for (const mint of allMints) {
    if (mint.status !== 'confirmed') continue;
    for (const beneficiary of mint.beneficiaries) {
      if (beneficiary.member_id === memberId) {
        balance += beneficiary.amount;
      }
    }
  }

  return balance;
}
```

### 3.2 Offline Transfer (QR Handshake)

```javascript
// SENDER DEVICE
async function createOfflineTransfer(recipientId, amount, description) {
  const tx = {
    _id: `tx_${Date.now()}_${crypto.randomUUID()}`,
    type: 'transaction',
    created_at: new Date().toISOString(),
    sender_id: currentUser.id,
    recipient_id: recipientId,
    amount: amount,
    description: description,
    signatures: {
      sender: await signWithPrivateKey(tx),
      recipient: null,
      witness: null
    },
    status: 'pending',
    synced_to_hub: false
  };

  // Generate QR code containing the transaction
  const qrPayload = JSON.stringify(tx);
  return generateQRCode(qrPayload);
}

// RECIPIENT DEVICE
async function receiveOfflineTransfer(qrPayload) {
  const tx = JSON.parse(qrPayload);

  // Verify sender signature
  const senderPubKey = await getMemberPublicKey(tx.sender_id);
  if (!verifySignature(tx, tx.signatures.sender, senderPubKey)) {
    throw new Error('Invalid sender signature');
  }

  // Add recipient signature
  tx.signatures.recipient = await signWithPrivateKey(tx);
  tx.status = 'confirmed';

  // Save locally
  await localDB.put(tx);

  return tx;
}
```

### 3.3 Sync Protocol

```javascript
// Continuous sync when hub in range
function initializeSync() {
  const remoteDB = new PouchDB('http://community-hub.local:5984/ledger');

  localDB.sync(remoteDB, {
    live: true,
    retry: true
  }).on('change', (info) => {
    console.log('Sync change:', info);
    updateUI();
  }).on('error', (err) => {
    console.log('Sync offline, will retry');
  });
}
```

### 3.4 Multi-Signature Mint (Proof of Care)

```javascript
async function createMintRequest(beneficiaries, workType, description) {
  const mint = {
    _id: `mint_${Date.now()}_${crypto.randomUUID()}`,
    type: 'mint',
    created_at: new Date().toISOString(),
    beneficiaries: beneficiaries,
    total_minted: beneficiaries.reduce((sum, b) => sum + b.amount, 0),
    work_type: workType,
    description: description,
    required_signatures: 3,
    signatures: {},
    status: 'pending'
  };

  await localDB.put(mint);
  return mint;
}

async function signMintRequest(mintId) {
  const mint = await localDB.get(mintId);

  if (!currentUser.roles.includes('elder')) {
    throw new Error('Only elders can sign mint requests');
  }

  mint.signatures[currentUser.id] = await signWithPrivateKey(mint);

  // Check if threshold reached
  const sigCount = Object.keys(mint.signatures).length;
  if (sigCount >= mint.required_signatures) {
    mint.status = 'confirmed';
  }

  await localDB.put(mint);
  return mint;
}
```

---

## 4. SECURITY MODEL

### 4.1 Key Management

```
┌─────────────────────────────────────────────┐
│              KEY GENERATION                 │
├─────────────────────────────────────────────┤
│ 1. User creates account                     │
│ 2. Ed25519 keypair generated IN BROWSER     │
│ 3. Private key → encrypted with passphrase  │
│ 4. Private key → stored in IndexedDB ONLY   │
│ 5. Public key → shared with community       │
│                                             │
│ PRIVATE KEY NEVER LEAVES THE DEVICE         │
└─────────────────────────────────────────────┘
```

### 4.2 Recovery Protocol

If device is lost:
1. Member attends gathering in person
2. 3+ existing members vouch for identity
3. New keypair generated on new device
4. Old public key marked as "revoked"
5. New public key linked to member record
6. Balance and history transfer to new identity

### 4.3 Threat Mitigations

| Threat | Mitigation |
|--------|------------|
| Device seizure | Passphrase-encrypted keys |
| Hub seizure | Data distributed on all phones |
| Network surveillance | All sync over local WiFi, no internet |
| Fake transactions | Cryptographic signatures required |
| Balance fraud | All phones verify all transactions |
| Sybil attack | Voucher requirement, physical presence |

---

## 5. INTERFACE SPECIFICATION

### 5.1 Mobile Web View

```
┌─────────────────────────────────────┐
│ [|||]        STATUS: SYNCED    [?] │
├─────────────────────────────────────┤
│                                     │
│         BALANCE                     │
│        +45.0 CR                     │
│     (~45 hours value)               │
│                                     │
├─────────────────────────────────────┤
│  [  GIVE CREDIT  ] [  REQUEST  ]   │
├─────────────────────────────────────┤
│  RECENT ACTIVITY                    │
│  ─────────────────                  │
│  ↓ 5.0 from JOE                     │
│    "Firewood bundle"                │
│    Today 14:30                      │
│                                     │
│  ↑ 2.0 to MARIA                     │
│    "Fence mending help"             │
│    Yesterday 10:15                  │
│                                     │
├─────────────────────────────────────┤
│  NEARBY OFFERS                      │
│  ─────────────────                  │
│  [Apples] 3 CR - 1km away           │
│  [Tractor repair] 10 CR - 5km       │
│                                     │
├─────────────────────────────────────┤
│  [ SCAN QR ]        [ MY QR ID ]   │
└─────────────────────────────────────┘
```

### 5.2 Design Principles

- **High contrast** - Readable in bright sunlight
- **Large touch targets** - Usable with dirty/wet hands
- **Minimal data** - Works on 2G connection speeds
- **Offline indicator** - Always visible sync status
- **No animations** - Battery preservation

---

## 6. DEPLOYMENT TOPOLOGY

### Phase 1: Single Hub (10 members)

```
        [COMMUNITY HUB]
              │
    ┌────┬────┼────┬────┐
    │    │    │    │    │
  [P1] [P2] [P3] [P4] [P5]  ... [P10]
```

### Phase 2: Multi-Hub (50 members)

```
[HUB A] ◄──LoRa──► [HUB B] ◄──LoRa──► [HUB C]
   │                  │                  │
 10 phones          10 phones          10 phones
```

### Phase 3: Federation (Multiple Communities)

```
[COMMUNITY 1]          [COMMUNITY 2]
     │                      │
     └───── Internet ───────┘
           (optional)

Inter-community trade via "embassy" accounts
```

---

## 7. APPENDIX: API ENDPOINTS (CouchDB)

### Hub exposes these endpoints on local network:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/ledger/_all_docs` | GET | List all documents |
| `/ledger/_changes` | GET | Sync feed |
| `/ledger/_bulk_docs` | POST | Batch sync |
| `/ledger/<doc_id>` | GET/PUT | Single document |
| `/_session` | POST | Authentication |

**Authentication:** Cookie-based session, optional for read, required for write.

---

*Document Version: 1.0*
*Next Review: After pilot completion*
