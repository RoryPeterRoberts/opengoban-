# OpenGoban Decentralized Sync Proposal

## The Problem

The current Cloudant/CouchDB sync creates a central administrator - whoever controls the database controls the network. This contradicts our core principles:

- **No banks** - but we created a central ledger authority
- **No app stores** - but we created infrastructure dependency
- **Community-owned** - but one person holds the keys

We need sync that is as decentralized as the cryptography.

---

## Requirements

| Requirement | Priority | Notes |
|-------------|----------|-------|
| No central admin | Must | Core principle |
| Works offline | Must | Rural/resilient use cases |
| Works on iOS PWA | Must | No app store |
| Works on Android PWA | Must | No app store |
| Eventual consistency | Must | Transactions sync when possible |
| Cryptographic integrity | Must | Already have Ed25519 signing |
| Low/zero infrastructure cost | Should | Community-run |
| Simple to understand | Should | Auditability |
| Works across circles | Could | Federation |

---

## Options Analysis

### Option 1: Pure P2P (WebRTC)

**How it works:**
- Devices connect directly via WebRTC when both online
- Use PeerJS or simple-peer for connection management
- Sync PouchDB databases directly between peers
- No server required (STUN/TURN servers are stateless relays)

**Pros:**
- Truly serverless
- Simple conceptually
- Already works with PouchDB
- Zero infrastructure cost

**Cons:**
- Both devices must be online simultaneously
- Doesn't work well for async communities
- NAT traversal can fail (10-15% of connections)

**Best for:** In-person communities, market days, local trading

---

### Option 2: Gun.js

**How it works:**
- Decentralized graph database
- Data syncs across all connected peers
- Optional relay peers for reliability (anyone can run one)
- Built-in conflict resolution

**Pros:**
- No central authority
- Works async (data persists across peer network)
- Browser-native, works in PWA
- Active development, good community
- Can run your own relay (optional)

**Cons:**
- Different data model than PouchDB (graph vs document)
- Would require rewriting ledger layer
- Less mature than CouchDB ecosystem
- Relay peers see data (though we encrypt/sign everything)

**Best for:** Distributed communities, async trading, global scale

---

### Option 3: Federated CouchDB

**How it works:**
- Each circle runs their own CouchDB instance
- Members choose which server to sync with
- Circles can peer with each other
- No single admin for all circles

**Pros:**
- Keeps current PouchDB code
- Each circle is autonomous
- Can use free hosting (Fly.io, Railway free tiers)
- Familiar CouchDB replication

**Cons:**
- Still requires someone to run each server
- Circle admin has power over circle data
- Infrastructure cost per circle

**Best for:** Organized circles with technical members

---

### Option 4: IPFS/OrbitDB

**How it works:**
- Content-addressed storage on IPFS
- OrbitDB provides database layer
- Data is immutable, append-only
- Distributed across IPFS network

**Pros:**
- Truly censorship-resistant
- Content-addressed (tamper-proof)
- Large ecosystem

**Cons:**
- Heavy for mobile browsers
- IPFS gateways are centralized in practice
- Complex setup
- Slow for real-time sync

**Best for:** Archival, censorship-resistance priority

---

### Option 5: Hybrid Gossip Protocol

**How it works:**
- Combine QR offline transfers (already built)
- Add WebRTC P2P sync when online together
- Optional community relay servers (anyone can run)
- Gossip protocol spreads transactions

**Pros:**
- Graceful degradation (works offline, better online)
- No single point of failure
- Community can run relays
- Builds on existing QR system

**Cons:**
- More complex implementation
- Need to design gossip protocol
- Eventual consistency delays

**Best for:** Resilient communities, mixed connectivity

---

## Recommendation: Hybrid Approach

**Phase 1: WebRTC P2P (Immediate)**
- Add direct device-to-device sync
- Works when two people are together
- Complements existing QR flow
- Zero infrastructure

**Phase 2: Community Relays (Optional)**
- Simple WebSocket relay servers
- Anyone can run one (Docker one-liner)
- Devices connect to known relays
- Relays don't store data, just forward

**Phase 3: Gossip Protocol (Future)**
- Transactions propagate through network
- Relays gossip with each other
- True mesh network

---

## Implementation: Phase 1 (WebRTC P2P)

### Technical Design

```
┌─────────────┐         WebRTC          ┌─────────────┐
│   Phone A   │◄──────────────────────►│   Phone B   │
│  (PouchDB)  │     Direct Connection   │  (PouchDB)  │
└─────────────┘                         └─────────────┘
       │                                       │
       │  PouchDB.sync()                       │
       └───────────────────────────────────────┘
```

### User Flow

1. Alice taps "Sync with nearby device"
2. Alice's phone shows a 6-digit code
3. Bob enters the code on his phone
4. WebRTC connection established
5. PouchDB syncs automatically
6. Both devices now have all transactions

### Libraries

- **PeerJS** - Simplifies WebRTC (10KB)
- Built on PouchDB sync (already using)

### Code Changes

1. Add PeerJS library
2. Add "Sync Nearby" button to home screen
3. Create pairing UI (show/enter code)
4. Connect PouchDB sync to PeerJS data channel

### Estimated Effort

- 2-3 hours implementation
- Uses existing PouchDB sync code
- Minimal new dependencies

---

## Implementation: Phase 2 (Community Relays)

### Technical Design

```
┌─────────────┐                         ┌─────────────┐
│   Phone A   │                         │   Phone B   │
└──────┬──────┘                         └──────┬──────┘
       │                                       │
       │  WebSocket                   WebSocket│
       ▼                                       ▼
┌──────────────────────────────────────────────────────┐
│                   Relay Server                        │
│            (stateless, just forwards)                 │
└──────────────────────────────────────────────────────┘
```

### Relay Server

```javascript
// Entire relay server - ~30 lines
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

const rooms = new Map();

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'join') {
      if (!rooms.has(msg.room)) rooms.set(msg.room, new Set());
      rooms.get(msg.room).add(ws);
    } else if (msg.type === 'signal') {
      rooms.get(msg.room)?.forEach(peer => {
        if (peer !== ws) peer.send(data);
      });
    }
  });
});
```

### Deployment Options

- Fly.io free tier (3 VMs free)
- Railway free tier
- Render free tier
- Self-hosted Raspberry Pi
- Any member can run one

### Trust Model

- Relays only forward encrypted/signed data
- Can't forge transactions (Ed25519 signatures)
- Can't read content (could add encryption layer)
- Multiple relays = redundancy

---

## Security Considerations

### What's Already Secure

- Ed25519 signatures on all transactions
- Both parties must sign
- Can't forge transactions without private key

### What Relays Could Do (Attack Surface)

| Attack | Mitigated By |
|--------|--------------|
| Forge transactions | Ed25519 signatures |
| Modify transactions | Signature verification |
| Block transactions | Multiple relays / P2P fallback |
| See transaction amounts | Could add encryption (Phase 3) |
| Track who trades with whom | Could add onion routing (Phase 3) |

### Recommended: End-to-End Encryption

Add NaCl box encryption for transaction payloads:
- Only sender and recipient can read
- Relay sees: encrypted blob + public routing info
- Easy to add with existing TweetNaCl library

---

## Migration Path

| Current State | Phase 1 | Phase 2 | Phase 3 |
|---------------|---------|---------|---------|
| QR only | + P2P sync | + Relays | + Gossip |
| Manual transfer | + Auto sync | + Async sync | + Full mesh |
| Cloudant option | Keep as opt-in | Deprecate | Remove |

---

## Recommendation Summary

**Start with Phase 1 (WebRTC P2P):**
- Immediate value
- Zero infrastructure
- Complements existing QR
- 2-3 hours to implement

**Add Phase 2 when needed:**
- Community grows beyond in-person
- Members want async sync
- Anyone can run a relay

**Keep Cloudant as option:**
- For testing/development
- For circles that want convenience
- Clearly labeled "centralized"

---

## Decision Needed

1. **Proceed with Phase 1 (WebRTC P2P)?**
   - I can implement this now
   - Ready to test in ~2 hours

2. **Design Phase 2 relay protocol?**
   - Spec out message format
   - Define room/circle discovery

3. **Add encryption layer?**
   - Transaction payloads encrypted
   - Relays can't read amounts

---

## Appendix: Why Not Blockchain?

Blockchains solve a different problem (global consensus with untrusted parties). Mutual credit circles have:

- Known, trusted members (vouching system)
- No need for global consensus
- No mining/staking overhead
- Instant finality (both parties sign)

The cryptographic signatures provide integrity. The social layer (vouching, reputation) provides trust. We don't need the overhead of blockchain consensus.

---

*Prepared for OpenGoban community discussion*
