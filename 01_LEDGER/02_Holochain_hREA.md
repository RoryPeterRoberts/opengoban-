# Holochain & hREA - Agent-Centric Economic Networks

## Overview

Holochain is a fundamentally different approach to distributed systems. Unlike blockchain (global consensus ledger), Holochain is **agent-centric** - each participant maintains their own chain, with validation happening peer-to-peer.

**Website:** https://www.holochain.org/
**hREA (Holochain REA):** https://hrea.io/
**License:** Open Source (Cryptographic Autonomy License)

---

## Why Agent-Centric Matters for TechnoCommune

### The Problem with Global Ledgers
The BIS "Unified Ledger" (Volume 1) requires:
- Central authority controlling consensus
- All transactions visible to validators
- Single point of failure/censorship

### Holochain's Alternative
- **No global state** - Each agent has their own perspective
- **No mining/staking** - Validation by peers, not competition
- **Offline-capable** - Local chain commits first, syncs later
- **Scalable** - More users = more capacity (not more load)

---

## How Holochain Works

### Local Hashchain
Each agent has a local hashchain (a type of DAG). Agents commit entries to their local chain which are then replicated and validated by peers via a Distributed Hash Table (DHT).

### Countersigning
For transactions between parties (like mutual credit transfers), both parties must cryptographically sign the entry. This validates entries between agents using public keys.

### Eventually Consistent
Holochain is eventually consistent, meaning viewing a ledger as global state is not quite the right approach. Each agent will have their own perspective on the balance of other agents.

---

## hREA - Resource-Event-Agent Framework

### What is REA?
REA (Resource-Event-Agent) is an accounting methodology developed by Professor William McCarthy at Michigan State University. It focuses on:
- **Resources** - Things of value (asparagus, labor hours, land)
- **Events** - Actions that affect resources (harvest, transfer, consume)
- **Agents** - Participants in economic activity (you, neighbors, community)

### Why REA over Double-Entry Bookkeeping?
Traditional accounting abstracts everything into money. REA tells "the whole economic story" - tracking actual resources and their flows between agents.

### hREA Implementation
hREA implements the [Valueflows](https://valueflo.ws/) specification on Holochain:
- Transparent account of resource flows
- Works across decentralized agents
- Enables ecosystem-level coordination

---

## Technical Architecture

### Key Components
- **Holochain Runtime** - The execution environment
- **DNA** - Application code defining validation rules
- **DHT** - Distributed Hash Table for peer discovery and data sharing
- **Conductor** - Multi-app runtime for end users

### Development Status
- Led by Leo Bensman through Lightningrod Labs
- Full rewrite for performance completed
- Integration with Moss (Holochain app launcher)
- Active development continues with Holochain Foundation

---

## Mutual Credit on Holochain

### Existing Implementation
Repository: https://github.com/vanarchist/holochain-mutual-credit-clearing

A minimal mutual credit clearing currency implementation demonstrating:
- Credit/debit balance tracking per agent
- Transaction validation rules
- Countersigned transfers

### HoloFuel
Holochain's own mutual credit currency (HOT token convertible to HoloFuel) demonstrates production viability: "Holochain's potential to facilitate billions of microtransactions daily through a mutual-credit accounting system."

---

## Relevance to TechnoCommune

### Perfect Fit
| TechnoCommune Need | Holochain Capability |
|-------------------|---------------------|
| Offline-first | Local chain commits first |
| No central authority | Agent-centric, peer validation |
| Resist censorship | No single point of failure |
| Track real resources | REA accounting model |
| Community sovereignty | Each community runs own DNA |

### Challenges
- **Learning curve** - Rust-based development
- **Early ecosystem** - Fewer ready-made apps than Ethereum
- **Hardware requirements** - More demanding than simple MCCS

---

## Sources

- [Holochain Official](https://www.holochain.org/)
- [hREA Framework](https://hrea.io/)
- [Holo-REA - P2P Foundation](https://wiki.p2pfoundation.net/Holo-REA)
- [Holochain Mutual Credit Repository](https://github.com/vanarchist/holochain-mutual-credit-clearing)
- [Holochain Blog - REA Accounting](https://blog.holochain.org/accounting-for-valueflows-and-regeneration-reimagined/)
- [Matslats - Holochain Mutual Credit](https://matslats.net/decentralised-social-networks-holochain-mutual-credit)

---

## Next Steps

1. [ ] Install Holochain development environment
2. [ ] Review mutual-credit-clearing repository
3. [ ] Prototype basic credit transfer DNA
4. [ ] Design offline sync mechanism
5. [ ] Evaluate hREA for full resource tracking
