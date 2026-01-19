# TechnoCommune MVP Specification

## Minimum Viable Product: The 10-Person Pilot

Before building complex systems, prove the concept works with real people trading real goods.

---

## Phase 0: The Founding Circle (Week 1-2)

### Requirements
- **10 founding members**
- 5 Producers (asparagus, eggs, vegetables, bread, honey)
- 5 Service Providers (cleaning, repair, tutoring, massage, IT help)

### Selection Criteria
| Criterion | Why |
|-----------|-----|
| Geographic proximity | Can meet in person |
| Existing trust | Know each other already |
| Real capacity | Actually have goods/services to offer |
| Technical willingness | Will use the app |
| Ideological alignment | Understand the "why" |

### Founding Agreement
Members commit to:
1. Not exchanging credits for Euro
2. Accepting credits for their offerings
3. Spending credits within the circle
4. Participating in witness verification
5. Attending monthly market days

---

## Phase 1: Paper Pilot (Week 3-4)

### Why Start Paper?
Before any technology:
- Test if the economic model works
- Identify friction points
- Build trading habits
- Establish trust norms

### The Mechanism
```
[Ledger Book]
| Date | From | To | Credits | What | Witness |
|------|------|-----|---------|------|---------|
| Jan 15 | Alice | Bob | 10 | Asparagus (1kg) | Carol |
```

### Rules
- 1 Credit = 1 Hour of labor OR equivalent goods value
- Maximum negative balance: -50 credits
- Maximum positive balance: +100 credits
- Each transaction requires 1 witness signature

### Weekly Market
- Fixed time/place (Sunday morning)
- Members bring goods
- Trades recorded in ledger book
- Balances recalculated

---

## Phase 2: Digital Prototype (Week 5-8)

### Technology Stack (Simple Version)
```
[PouchDB] --> Local storage on phone
     |
     v
[Simple Web App] --> View balance, record trades
     |
     v
[CouchDB Server] --> Sync when online (Raspberry Pi)
```

### Core Features Only
1. **View my balance**
2. **Record a trade** (I gave X to Y for Z credits)
3. **Confirm a trade** (I received X from Y)
4. **View member directory** (who offers what)
5. **Sync with community** (when in WiFi range)

### NOT in MVP
- Fancy UI
- Automatic matching
- Complex verification
- Mesh networking
- Multiple currencies

### Tech Choices
| Component | Choice | Why |
|-----------|--------|-----|
| Frontend | Simple HTML/JS | Works on any phone |
| Local DB | PouchDB | Offline-first built-in |
| Server | CouchDB on RPi | ~50 EUR, runs on solar |
| Hosting | Local only | No cloud dependency |

---

## Phase 3: Verification System (Week 9-12)

### Add Witness Requirement
```
1. Alice creates trade: "10 credits to Bob for eggs"
2. Bob confirms: "Yes, I gave eggs"
3. Carol witnesses: "I saw this happen"
4. Trade recorded as verified
```

### Digital Witness Flow
- Nearby members can "witness" trades
- Requires physical proximity (same market day)
- Simple button press to confirm
- Builds verification habit

---

## Data Structures

### Member Record
```javascript
{
  _id: "member_alice",
  name: "Alice",
  offers: ["asparagus", "carrots", "garden labor"],
  wants: ["eggs", "bread", "IT help"],
  public_key: "...",
  trust_level: 3,
  balance: 25
}
```

### Trade Record
```javascript
{
  _id: "trade_20240115_001",
  from: "member_alice",
  to: "member_bob",
  credits: 10,
  description: "1kg asparagus",
  timestamp: "2024-01-15T10:30:00Z",
  witness: "member_carol",
  status: "verified"
}
```

### Balance Calculation
```javascript
function getBalance(memberId, allTrades) {
  let balance = 0;
  for (const trade of allTrades) {
    if (trade.to === memberId) balance += trade.credits;
    if (trade.from === memberId) balance -= trade.credits;
  }
  return balance;
}
```

---

## Success Metrics

### Week 4 (End of Paper Pilot)
| Metric | Target |
|--------|--------|
| Active members | 10/10 |
| Total trades | 20+ |
| Members with positive balance | At least 5 |
| Members with negative balance | At least 3 |
| Disputes | 0 |

### Week 8 (End of Digital Prototype)
| Metric | Target |
|--------|--------|
| App adoption | 10/10 using app |
| Sync success rate | 95%+ |
| Trades via app | 30+ |
| System crashes | <3 |

### Week 12 (End of Verification Phase)
| Metric | Target |
|--------|--------|
| Witnessed trades | 80%+ of all trades |
| False witness attempts | 0 |
| Trust levels established | All members rated |
| Ready for expansion | Yes/No decision |

---

## Risk Mitigation

### Risk: Nobody Has Goods to Trade
**Mitigation:** Pre-screen members for actual productive capacity

### Risk: Balance Hoarding
**Mitigation:** Maximum balance limits, "demurrage" if needed

### Risk: Free Riders
**Mitigation:** Minimum activity requirements, peer pressure

### Risk: Technology Failure
**Mitigation:** Paper backup always available, simple tech

### Risk: Regulatory Concern
**Mitigation:** No Euro exchange, private association structure

---

## Hardware Shopping List

### Community Hub
| Item | Cost (EUR) |
|------|------------|
| Raspberry Pi 4 (4GB) | 55 |
| SD Card (64GB) | 10 |
| Case + Power Supply | 20 |
| USB SSD (128GB) | 25 |
| **Total** | **~110** |

### Optional: Mesh Networking (Phase 4+)
| Item | Cost (EUR) |
|------|------------|
| Meshtastic T-Echo x3 | 90 |
| Solar panel + battery | 50 |
| Outdoor enclosure | 30 |
| **Total** | **~170** |

---

## Timeline Summary

```
Week 1-2:   Recruit founding 10, sign agreement
Week 3-4:   Paper ledger trading, weekly markets
Week 5-6:   Build simple PouchDB app
Week 7-8:   Deploy app, test sync with RPi hub
Week 9-10:  Add witness verification
Week 11-12: Evaluate, decide on expansion
Week 13+:   If success, recruit next 10 members
```

---

## Go/No-Go Decision Criteria

### EXPAND if:
- All 10 members actively trading
- Net promoter: members want to invite others
- No unresolved disputes
- Technology stable
- Economic velocity increasing

### PAUSE if:
- <7 members active
- Multiple disputes
- Technology unreliable
- Imbalances growing (hoarding/debt spiral)
- Members dropping out

### STOP if:
- <5 members interested
- Regulatory threat materialized
- Core premise not working
- Better alternative discovered

---

## Next Steps

1. [ ] Identify 10 founding members
2. [ ] Draft founding agreement document
3. [ ] Choose first market day location/time
4. [ ] Create paper ledger template
5. [ ] Set up Raspberry Pi with CouchDB
6. [ ] Build minimal PouchDB web app
