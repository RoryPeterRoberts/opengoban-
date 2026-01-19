# Offline-First Architecture: CouchDB & PouchDB

## The Core Principle

> "CouchDB is bad at everything, except syncing. And it turns out that's the most important feature you could ever ask for."
> — Jason Smith

In an increasingly surveilled world, **offline-first** isn't just convenience - it's sovereignty.

---

## Why Offline-First for TechnoCommune

### The Threat Model (from Volume 3)
The EUDI Wallet requires constant connectivity to:
- Verify credentials
- Check revocation status
- Log transactions

**If they can switch off your connection, they switch off your access.**

### The Defense
Offline-first architecture means:
- Data lives on YOUR device first
- Syncs when connection available
- Works entirely without internet
- No central server required for basic function

---

## PouchDB - The Browser Database

**Website:** https://pouchdb.com/
**Current Version:** 9.0.0 (May 2024)
**License:** Apache 2.0

### What It Does
PouchDB enables applications to store data locally while offline, then synchronize with CouchDB-compatible servers when the application is back online.

### Key Features
- **JavaScript database** in the browser
- **IndexedDB/WebSQL** storage backends
- **Automatic sync** with CouchDB
- **Cross-platform** - works in Node.js too
- **Conflict resolution** built-in

### Core API
```javascript
// Create local database
const db = new PouchDB('my_database');

// Add document
db.put({ _id: 'trade_001', from: 'alice', to: 'bob', amount: 10 });

// Sync with remote when online
db.sync('http://community-server:5984/trades', { live: true });
```

---

## CouchDB - The Sync Server

### Replication Protocol
CouchDB's replication protocol synchronizes JSON documents between 2 peers over HTTP/1.1 using the public CouchDB REST API.

### Multi-Master Capability
Unlike traditional databases with primary/replica, CouchDB supports **multi-master replication**:
- Any node can accept writes
- Changes propagate to all nodes
- Conflicts detected and manageable

### Offline-First Design
```
[Your Phone] <--sync--> [Community Server] <--sync--> [Neighbor's Phone]
                              |
                        [Backup Node]
```

---

## Conflict Resolution

### How Conflicts Happen
1. Alice and Bob both offline
2. Both modify same document
3. Both come online and sync

### PouchDB's Approach
- Uses deterministic algorithm based on revision history
- Automatically chooses "winning" revision
- Stores losing revisions as conflicts
- Allows manual resolution

### For TechnoCommune
Mutual credit conflicts are rare because:
- Transactions require both parties' signatures
- Countersigning prevents double-spending
- Community can arbitrate edge cases

---

## Implementation Options

### Option 1: Pure PouchDB (Peer-to-Peer)
```
[Phone A] <--direct sync--> [Phone B]
```
- No server required
- Works via WiFi Direct, Bluetooth
- Maximum sovereignty
- Harder to implement

### Option 2: Community Hub
```
[Phone A] --> [Raspberry Pi Hub] <-- [Phone B]
```
- Low-cost local server
- Syncs when in range
- No internet required
- Hub can be solar-powered

### Option 3: Mesh Network Sync
```
[Phone A] --LoRa--> [Repeater] --LoRa--> [Hub] <--WiFi-- [Phone B]
```
- Long-range capability
- Works across valleys/hills
- Lower bandwidth (text only)
- Most resilient

---

## Local-First Principles

From the Local-First Software manifesto:

1. **No spinners** - Data is local, always fast
2. **Works offline** - Full functionality without network
3. **Network optional** - Sync is enhancement, not requirement
4. **Longevity** - Data outlives the app/company
5. **Privacy** - Data stays on device by default
6. **User control** - You decide what syncs where

---

## Technical Requirements

### PouchDB
- Modern browser with IndexedDB
- ~45KB gzipped
- No native dependencies

### CouchDB Server
- Raspberry Pi capable
- 256MB RAM minimum
- PostgreSQL alternative: use CouchDB directly

### Sync Frequency
- **Continuous** - Real-time when connected
- **Periodic** - Check every N minutes
- **Manual** - User-triggered sync
- **Event-based** - Sync on specific actions

---

## Sources

- [PouchDB Official](https://pouchdb.com/)
- [PouchDB Replication Guide](https://pouchdb.com/guides/replication.html)
- [Building Offline-First with CouchDB](https://reintech.io/blog/building-offline-first-applications-couchdb)
- [CouchDB Multi-Master Docker Setup](https://dev.to/animusna/couchdb-offline-first-with-multi-master-synchronization-using-docker-and-docker-compose-293e)
- [Couchbase PouchDB Introduction](https://www.couchbase.com/blog/introduction-offline-data-storage-sync-pouchdb-couchbase/)

---

## Next Steps

1. [ ] Prototype PouchDB mutual credit ledger
2. [ ] Test sync over WiFi Direct
3. [ ] Evaluate LoRa transport for sync
4. [ ] Design conflict resolution rules for trades
5. [ ] Build Raspberry Pi community hub image
