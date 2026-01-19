# Social Verification: Web of Trust & Multi-Signature

## The Problem with Centralized Identity

Volume 3 (EUDI Wallet) creates identity that is:
- **State-issued** - Government decides who you are
- **Revocable** - Can be suspended remotely
- **Surveillance-enabled** - Every verification logged
- **Biometric-bound** - Your body is the key

**The alternative:** Identity through relationship, not permission.

---

## Web of Trust Model

### Origin: PGP/GPG
The Web of Trust was pioneered for email encryption:
- You verify someone's key by meeting them
- You sign their key to vouch for them
- Others trust your vouches based on their trust in you
- Trust propagates through the network

### For TechnoCommune
```
[You] --"I know Alice"--> [Alice] --"I know Bob"--> [Bob]
  |                          |                        |
  +------"We both know Carol"------------------------+
```

You don't need a central authority if:
- Your neighbors know you
- Their neighbors know them
- The network connects through trust links

---

## Trust Levels

| Level | Meaning | Verification |
|-------|---------|--------------|
| 0 - Unknown | Never met | No interaction |
| 1 - Acquaintance | Met once | Single introduction |
| 2 - Known | Regular interaction | Multiple witnesses |
| 3 - Trusted | Long history | Community standing |
| 4 - Vouched | Will stake reputation | Personal guarantee |

### Trust Decay
Trust should have a time component:
- Recent interactions > old interactions
- Active members > dormant members
- Regular verification refreshes trust

---

## Multi-Signature Verification

### The Mechanism
For high-value actions, require multiple signatures:

```
[Worker claims "I cleaned the beach"]
        |
        v
[Witness 1 signs] + [Witness 2 signs] = [Claim verified]
        |
        v
[System mints tokens to Worker]
```

### Configurations

| Scheme | Use Case |
|--------|----------|
| 1-of-1 | Low value, personal claim |
| 2-of-3 | Standard verification |
| 3-of-5 | High value, community decision |
| N-of-M | Configurable threshold |

### Random Witness Selection
To prevent collusion:
1. Worker submits claim
2. System randomly selects N potential witnesses from pool
3. First M to respond verify the claim
4. Claim requires threshold signatures

---

## "Proof of Care" for TechnoCommune

### What It Proves
Not just that work happened, but that the community witnessed it:
- Beach cleaning
- Farm labor
- Community kitchen work
- Elder care
- Teaching/mentoring

### The Process
```
1. [Member] --> "I did X hours of Y work at Z location"
         |
         v
2. [System] --> Selects 3 potential witnesses
         |
         v
3. [Witnesses] --> 2 of 3 confirm: "Yes, we saw this"
         |
         v
4. [Ledger] --> Credits issued to Member
```

### Anti-Gaming Measures
- **Witness rotation** - Can't always use same friends
- **Claim limits** - Maximum claims per day/week
- **Reputation stake** - False verification hurts your score
- **Physical proximity** - Witnesses must be nearby (GPS/manual check)

---

## Implementing in TechnoCommune Stack

### PouchDB Schema
```javascript
{
  _id: "claim_001",
  type: "care_claim",
  claimant: "member_alice",
  work_type: "beach_cleaning",
  hours: 2,
  location: { lat: 53.5, lon: -6.2 },
  timestamp: "2024-01-15T10:00:00Z",
  witnesses_required: 2,
  witnesses: [
    { member: "member_bob", signed: true, timestamp: "..." },
    { member: "member_carol", signed: true, timestamp: "..." }
  ],
  status: "verified",
  tokens_issued: 20
}
```

### Meshtastic Integration
```
Claim broadcast --> Witness devices beep --> Witnesses confirm via button
```

Low-bandwidth verification possible over LoRa.

---

## Identity Without Central Authority

### What We Store Locally
- Public key (cryptographic identity)
- Trust links (who vouches for whom)
- Reputation score (history of good behavior)
- Claim history (what they've done)

### What We DON'T Store Centrally
- Biometrics
- Government ID numbers
- Home address (unless voluntarily shared)
- Surveillance logs

### Identity Recovery
If you lose your device:
1. Meet with 3+ trusted community members
2. They vouch for your new key
3. New key inherits your reputation
4. Old key marked as revoked

**The community is the backup, not the cloud.**

---

## Comparison: EUDI vs Web of Trust

| Aspect | EUDI (Vol 3) | Web of Trust |
|--------|--------------|--------------|
| Issuer | Government | Community |
| Revocation | State decision | Collective decision |
| Privacy | Logged centrally | Local knowledge only |
| Recovery | Government process | Community ceremony |
| Biometrics | Required | Optional |
| Surveillance | Built-in | Impossible by design |

---

## Sources

- PGP Web of Trust - Original concept
- Keybase - Modern implementation
- Holochain - Agent-centric identity
- Secure Scuttlebutt - Social verification

---

## Next Steps

1. [ ] Design trust graph data structure
2. [ ] Implement multi-sig in PouchDB schema
3. [ ] Prototype witness selection algorithm
4. [ ] Create identity recovery ceremony protocol
5. [ ] Test with pilot group of 10 members
