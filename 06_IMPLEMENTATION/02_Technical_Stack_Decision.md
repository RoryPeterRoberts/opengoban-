# Technical Stack Decision Matrix

## The Three Paths

Based on research, three viable technical architectures emerge. Each has trade-offs.

---

## Option A: Pragmatic Stack (Recommended for MVP)

### Architecture
```
[Phone Browser]
      |
      | (Web App - HTML/JS)
      |
[PouchDB Local]
      |
      | (Sync when online)
      |
[CouchDB on Raspberry Pi]
```

### Components
| Layer | Technology | Maturity |
|-------|------------|----------|
| Frontend | HTML/CSS/JS | Production |
| Local DB | PouchDB | Production |
| Sync | CouchDB Protocol | Production |
| Server | CouchDB | Production |
| Hardware | Raspberry Pi | Production |

### Pros
- **All production-ready** - No experimental tech
- **Simple** - Small team can build and maintain
- **Offline-first** - Built into PouchDB
- **Low cost** - ~110 EUR for hub
- **Proven** - Thousands of apps use this stack

### Cons
- **Not fully decentralized** - Hub is single point
- **No mesh** - Requires WiFi for sync
- **Manual verification** - No smart contracts

### Development Time
- MVP: 4-6 weeks
- Production: 3-6 months

---

## Option B: Sovereignty Stack (Holochain)

### Architecture
```
[Holochain Conductor]
      |
      | (DNA - Rust)
      |
[Agent Source Chain] <--DHT--> [Other Agents]
```

### Components
| Layer | Technology | Maturity |
|-------|------------|----------|
| Runtime | Holochain Conductor | Beta |
| App Logic | Rust + DNA | Beta |
| UI | JS + Holochain Client | Beta |
| Sync | DHT (Gossip) | Beta |
| Identity | Agent-centric | Built-in |

### Pros
- **Fully decentralized** - No central server
- **Agent-centric** - True data sovereignty
- **Built-in identity** - Cryptographic keys
- **Offline-capable** - Local chain first
- **hREA available** - Economic accounting framework

### Cons
- **Steep learning curve** - Rust required
- **Beta software** - May have breaking changes
- **Mobile challenges** - Native apps needed
- **Smaller community** - Fewer resources

### Development Time
- MVP: 3-6 months
- Production: 1-2 years

---

## Option C: Hybrid Stack (Best of Both)

### Architecture
```
[Phone Browser]
      |
[PouchDB + Holochain Lite]
      |
      +--[WiFi]--> [CouchDB Hub] (local area sync)
      |
      +--[Meshtastic]--> [LoRa Mesh] (long range, low bandwidth)
      |
      +--[Internet]--> [Holochain DHT] (when available)
```

### Components
| Layer | Technology | Purpose |
|-------|------------|---------|
| Primary | PouchDB | Local-first storage |
| Local Sync | CouchDB | Community hub |
| Long Range | Meshtastic | Off-grid messaging |
| P2P (future) | Holochain | Full decentralization |

### Pros
- **Progressive decentralization** - Start simple, add later
- **Multiple sync paths** - WiFi, LoRa, Internet
- **Resilience** - If one path fails, others work
- **Realistic timeline** - MVP fast, sovereignty over time

### Cons
- **Complexity** - Multiple systems to maintain
- **Integration work** - Custom bridges needed
- **Scope creep risk** - Feature temptation

### Development Time
- MVP (PouchDB only): 4-6 weeks
- + Mesh: +4-8 weeks
- + Holochain: +6-12 months

---

## Recommendation: Start A, Build Toward C

### Phase 1: Pragmatic MVP (Months 1-3)
```
[PouchDB] <--sync--> [CouchDB on RPi]
```
- Get people trading
- Prove economic model
- Learn user needs

### Phase 2: Add Resilience (Months 4-6)
```
+ [Meshtastic LoRa] for announcements and lightweight verification
```
- Test mesh in local geography
- Add "market day announcements"
- Prototype verification messages

### Phase 3: Add Sovereignty (Months 6-12)
```
+ [Holochain integration] for identity and advanced features
```
- Port identity to agent-centric model
- Add smart contract verification
- Enable inter-community federation

---

## Decision Factors

| If Priority Is... | Choose... |
|-------------------|-----------|
| Speed to market | Option A |
| Maximum sovereignty | Option B |
| Long-term flexibility | Option C |
| Minimum technical risk | Option A |
| Censorship resistance | Option B or C |
| Hardware constraints | Option A |

---

## Technical Skill Requirements

### Option A (Pragmatic)
- JavaScript (intermediate)
- HTML/CSS (basic)
- Linux basics (Raspberry Pi)
- CouchDB administration (basic)

### Option B (Holochain)
- Rust (intermediate-advanced)
- Holochain concepts (new learning)
- Cryptography basics
- JavaScript for UI

### Option C (Hybrid)
- All of Option A
- LoRa/Meshtastic configuration
- Eventually Rust for Holochain

---

## Next Steps

**Immediate (This Week):**
1. [ ] Decide: Start with Option A or B?
2. [ ] Set up development environment
3. [ ] Create GitHub repository

**If Option A:**
1. [ ] Install CouchDB on laptop for dev
2. [ ] Create PouchDB "hello world"
3. [ ] Design data schema
4. [ ] Build balance display

**If Option B:**
1. [ ] Install Holochain dev environment
2. [ ] Complete Holochain tutorial
3. [ ] Clone mutual-credit-clearing repo
4. [ ] Understand DNA structure
