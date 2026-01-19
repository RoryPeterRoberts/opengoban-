# Irish Legal Structures for TechnoCommune

## The Legal Challenge

The system described in Volume 3 (EUDI Wallet) will regulate:
- **Virtual Asset Service Providers (VASPs)** - Anyone exchanging crypto/fiat
- **Payment Service Providers** - Anyone processing transactions
- **Identity Verifiers** - Anyone checking credentials

**Goal:** Structure the community exchange so it falls OUTSIDE these regulatory categories.

---

## Option 1: Unincorporated Association

### What It Is
An unincorporated association is a group of people bound by agreement (constitution) for a common purpose. **It has no separate legal personality** from its members.

### Irish Law Status
> "In Ireland, unincorporated associations are not legal entities."
> — Law Reform Commission

### Key Characteristics
| Feature | Implication |
|---------|-------------|
| No legal personality | Cannot be regulated as a "company" |
| No separate existence | Members ARE the association |
| Contract-based | Governed by internal constitution |
| No registration required | Invisible to corporate registries |

### The Defense Against VASP Classification
Because an unincorporated association:
- Cannot hold assets in its own name (trustees hold for members)
- Cannot enter contracts (members contract individually)
- Is not a "service provider" (members serve each other)

**Trading credits internally is arguably sharing private property, not commercial exchange.**

### Risks
- **Personal liability** - Members can be held personally liable for debts
- **Tortious liability** - *Hickey v McGowan* (2017): Members can have personal liability for acts of other members
- **No asset protection** - No statutory asset lock available

### Mitigation
- Clear constitution limiting activities
- Liability waivers in membership agreement
- Insurance pool among members
- Small transaction limits

---

## Option 2: Community Benefit Society (CBS)

### What It Is
A registered body conducting business for community benefit, not private profit.

### Important Note: Jurisdiction
**CBS registration in Ireland differs from UK:**
- UK: Register with Financial Conduct Authority (FCA)
- Northern Ireland: Register with FCA + Charity Commission NI
- Republic of Ireland: Register under **Industrial and Provident Societies Acts 1893-2014**

### The Statutory Asset Lock

> "A restriction on use (asset lock) may be included in the rules... Once included, the wording cannot be removed."
> — Co-operatives UK

**This is the direct counter to Volume 2's "Nature Collateral" seizure.**

The asset lock means:
- Assets cannot be sold for private profit
- Must be used for community benefit
- Survives changes in membership/management
- Legally enforceable

### Benefits for TechnoCommune
| Feature | Benefit |
|---------|---------|
| Limited liability | Members not personally liable |
| Asset lock | Land/resources protected from seizure |
| Democratic governance | One member, one vote |
| Social Investment Tax Relief | Tax benefits for investors (UK) |

### Registration Process (Republic of Ireland)
1. Draft constitution/rules
2. Submit to Registrar of Friendly Societies
3. Include asset lock provisions
4. Minimum membership requirements vary

### Risks
- **Regulatory visibility** - Registered entity is known
- **Compliance burden** - Annual returns, audits
- **Not anonymous** - Member registry may be public

---

## Option 3: Hybrid Structure

### The Architecture
```
[CBS - Asset Holding]
        |
        | (owns physical assets - land, equipment)
        |
[Unincorporated Association - Trading Circle]
        |
        | (members trade credits)
        |
[Individual Members]
```

### How It Works
1. **CBS holds land and physical assets** with statutory asset lock
2. **UA manages internal credit trading** - invisible to regulators
3. **Credits cannot be exchanged for Euro** - not a VASP
4. **Credits only usable within member circle** - closed loop

### The "Closed Loop" Defense

Research precedent for **closed loop systems** where:
- Credits cannot be exchanged for fiat currency
- Credits only work within defined membership
- System functions as voucher/coupon, not currency

**Legal argument:** If it can't buy Euros, it's not a "Virtual Asset."

---

## Key Legal Precedents to Research

### Ireland
- **Hickey v McGowan [2017]** - UA member liability
- **Industrial and Provident Societies Acts 1893-2014** - CBS framework
- **Law Reform Commission CP 68 (2022)** - UA liability consultation

### UK (Informative)
- **Community Benefit Societies (Restriction on Use of Assets) Regulations 2006**
- **FCA Handbook RFCCBS** - CBS regulation

---

## Regulatory Avoidance Checklist

| Requirement | Our Approach |
|-------------|--------------|
| VASP Registration | No fiat exchange = not a VASP |
| AML/KYC | Private member association, not public service |
| Payment Service | Internal credits, not payments |
| Identity Verification | Web of trust, not biometrics |
| Transaction Reporting | Private ledger, community-only visibility |

---

## Sources

- [Law Reform Commission - UA Liability (PDF)](https://www.lawreform.ie/_fileupload/Plain English Reports/LRC - CP 68 2022 Plain English Version.pdf)
- [Addleshaw Goddard - UA Legal Liability Ireland](https://www.addleshawgoddard.com/en/insights/insights-briefings/2023/dispute-resolution/unincorporated-associations-legal-liability-ireland/)
- [Matheson - Liability in UAs](https://www.matheson.com/insights/detail/liability-in-unincorporated-associations)
- [The Wheel - Forming Your Organisation](https://www.wheel.ie/advice-guidance/forming-your-organisation)
- [Co-operatives UK - Asset Lock Provisions](https://www.uk.coop/resources/community-shares-handbook/2-society-legislation/24-asset-lock-provisions-cs)
- [NI Business Info - CBS](https://www.nibusinessinfo.co.uk/content/community-benefit-societies)

---

## Next Steps

1. [ ] Consult Irish solicitor on UA vs CBS for specific use case
2. [ ] Draft model UA constitution for trading circle
3. [ ] Research closed loop voucher precedents in EU law
4. [ ] Investigate Social Enterprise structures in Ireland
5. [ ] Review Hickey v McGowan judgment in full
