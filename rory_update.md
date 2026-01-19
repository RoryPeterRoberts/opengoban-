# Rory's Update: What We've Built So Far

## The Short Version

We've built the blueprints for a **local trading system** that lets your community swap goods and services without needing banks, the internet, or government ID. Think of it like a high-tech version of "I'll give you eggs if you help me fix my fence" - but with a way to keep track of who owes what to whom.

---

## Why Are We Doing This?

### The Problem (What We Found in Those PDF Documents)

Those official documents from the EU and the Bank for International Settlements reveal a plan that's being built right now:

1. **Digital Money They Control**: They want to put all money on one big computer system they run. If they don't like you, they can freeze your money with a click.

2. **Nature Becomes Their Property**: They want to put a price tag on forests, bogs, and coastlines - not to protect them, but to turn them into financial products that banks can trade.

3. **Digital ID Required for Everything**: To use their new money system, you'll need a government digital wallet. No wallet = no buying or selling.

**Put simply**: They're building a system where you need their permission to participate in the economy.

### Our Solution

Build our own system that:
- Works without the internet
- Doesn't need their digital ID
- Keeps value circulating in our community
- Can't be switched off by someone in Brussels or Frankfurt

---

## What We've Actually Built

### 1. The Research Database (The Homework)

We researched everything we need to know:

**How other communities did this:**
- **Sardex in Italy**: 3,000 businesses trading without euros since 2009
- **WIR Bank in Switzerland**: Been running for 90 years with 60,000 members

**The technology options:**
- Different ways to build the trading system
- How to make it work without internet
- How to use radio networks when phones don't work

**The legal stuff:**
- How to set up a private club that regulators can't easily touch
- What words to use (and avoid) to stay out of trouble

---

### 2. The Legal Shield (The Armour)

We wrote a **constitution** - basically the rules of the club. Here's what it does:

**The Closed Loop Rule**
> "Our credits have no money value and can never be exchanged for euros."

*Why this matters*: If you can't turn it into euros, the government can't call it a "cryptocurrency" and regulate it. It's just neighbours helping neighbours.

**The Asset Lock**
> "Any land or equipment the group owns can never be sold to outsiders or used as loan collateral."

*Why this matters*: This stops banks from ever getting their hands on community property, even if someone tries to sell it.

**The Private Club Rule**
> "This is a private group, not a business. We don't need government ID to join."

*Why this matters*: Private clubs have different rules than businesses. We identify members by reputation (your neighbours know who you are), not by passport.

**The Emergency Plan**
> "If authorities try to shut us down, we distribute everything to members immediately."

*Why this matters*: You can't seize what's already been given away.

We also wrote a **one-page agreement** that founding members can sign to join.

---

### 3. The Technical System (The Engine)

This is the actual computer stuff that makes it work.

#### How It Works - Simple Version

Imagine everyone in your community has an app on their phone. The app keeps track of:
- How many "credits" you have
- Who you've traded with
- What people are offering (eggs, firewood, tractor repair)

**The clever bit**: The app works even without internet.

```
You want to buy eggs from Mary:
1. You open your app, type "Give Mary 5 credits for eggs"
2. Your phone shows a QR code (those square barcode things)
3. Mary scans it with her phone
4. Done. Mary now has 5 more credits, you have 5 less.
5. Later, when either of you gets near the community wifi, it syncs up.
```

#### The Community Hub (The Brain)

This is a small computer (Raspberry Pi - about the size of a deck of cards) that:
- Stores everyone's transactions
- Creates a local wifi network
- Runs on solar power if needed
- Costs about €115 to build

When your phone is near the hub, it automatically updates with everyone else's transactions. But if the hub is destroyed or seized, every phone still has a copy of all the data.

#### No Internet Needed

The system works in three ways:

1. **Phone-to-phone**: Scan QR codes directly
2. **Local wifi**: Connect to the community hub
3. **Radio mesh** (future): Little radio devices that can send messages kilometres away

---

### 4. The Crisis Plans (The Fire Drills)

We wrote out what happens when things go wrong:

**Scenario: Internet goes down for 3 days**
- Hub keeps working on local wifi
- People trade using QR codes
- Nothing breaks, nothing lost

**Scenario: Police take the hub**
- Data is on everyone's phones anyway
- Set up a new hub from any phone's backup
- Back running in 4 hours

**Scenario: Someone tries to cheat the system**
- Can't send credits to yourself (needs two signatures)
- Can't build up unlimited credits (maximum of 100)
- Can't join without real people vouching for you

---

### 5. The Actual Code (The Software)

We wrote working code:

**validate_design.js** - Rules that check every transaction is valid
**ledger-core.js** - The main app logic (850+ lines of JavaScript)
**index.html** - A simple mobile-friendly interface

You can actually open the index.html file in a web browser right now and see the app. It's basic but it works.

---

## How Credits Work (The Money Bit)

This is NOT cryptocurrency. It's much simpler.

**Starting Point**: Everyone starts at zero.

**Earning Credits**:
- Sell eggs → you go positive
- Clean the beach → community gives you credits
- Fix someone's tractor → they give you credits

**Spending Credits**:
- Buy bread → you go negative (down to -50 max)
- Get a haircut → you go negative
- Pay for childminding → you go negative

**The Rule**: The total of everyone's balance always equals zero (plus whatever was "minted" for community work). This prevents inflation and cheating.

**Example**:
```
Mary sells you eggs for 5 credits:
  - Mary: +5
  - You: -5
  - Total: 0 ✓

Community rewards beach cleaners with 30 credits:
  - Beach crew: +30 total
  - Nobody goes negative
  - Total: +30 (because new credits were created for real work)
```

---

## The Words We Use (Important!)

To stay out of legal trouble, we NEVER say:

| DON'T Say | DO Say |
|-----------|--------|
| Money, currency | Credits, units |
| Buy, sell | Give, receive, share |
| Payment, price | Gift, contribution |
| Customer | Member, neighbour |
| Business | Association, circle |
| Transaction | Exchange |

This isn't just being cute with words - it's legal protection. "Payments" are regulated. "Gifts between club members" are not.

---

## What's Left To Do

### Immediate (This Month)
1. Find 10 people willing to be founding members
2. Buy a Raspberry Pi and set up the hub
3. Test the app with real trades at a market day
4. Everyone signs the constitution

### Soon (Next Few Months)
1. Get legal advice to make sure the structure is solid
2. Add the radio mesh network for long-range communication
3. Expand to 50 members if the pilot works

### Later (Next Year)
1. Connect with other communities doing the same thing
2. Add better security and encryption
3. Maybe build a proper mobile app

---

## The Big Picture

What we're building is an **escape hatch**.

Right now, if you want to buy food, pay rent, or save for the future, you HAVE to use their system - banks, government money, digital IDs. They're about to make that system much more controlled.

We're building an alternative where:
- Your neighbours know who you are (not a government database)
- Value comes from real work and real goods (not bank loans)
- The system runs on hardware we own (not their cloud servers)
- It works even when the internet doesn't

It's not about replacing the euro or living completely off-grid. It's about having options. If their system becomes too controlling, you have somewhere else to trade, something that keeps working when their system fails or locks you out.

---

## Files We've Created

```
TechnoCommune/
│
├── Research (the homework)
│   ├── How other systems work
│   ├── Technology options
│   ├── Legal structures
│   └── Case studies from Italy & Switzerland
│
├── Legal Shield (the armour)
│   ├── Full constitution (9 articles)
│   └── One-page signing agreement
│
├── Technical Docs (the blueprints)
│   ├── How the whole system works
│   ├── How to build the hub (with shopping list)
│   └── What to do in emergencies
│
└── Code (the actual software)
    ├── Database rules
    ├── App logic
    └── Mobile interface
```

---

## Questions You Might Have

**Is this legal?**
We believe so. Private clubs trading favours isn't illegal. But we should get a solicitor to review it before going public.

**Can the government shut it down?**
They can try, but:
- The data is on everyone's phones
- The constitution has emergency distribution rules
- The software is just files - anyone can run it

**What if someone cheats?**
The system has built-in limits. You can't go more than 50 credits negative. Every transaction needs two people to sign it. The community can vote to remove bad actors.

**Do I need to be technical to use it?**
No. The app is designed to be simple. Scan a code, see your balance, done.

**What's it actually good for?**
Trading real things: food, repairs, childcare, lessons, firewood, eggs, vegetables, skilled labour. Anything your neighbours can provide.

---

## The Bottom Line

We've built the complete blueprint for a community trading system that:

1. **Works offline** (no internet needed)
2. **Has legal protection** (private club structure)
3. **Can't be easily shut down** (distributed across all members)
4. **Is based on real value** (work and goods, not speculation)
5. **Doesn't need government ID** (your neighbours know who you are)

The foundation is solid. Now we need real people to test it.

---

*"They are turning the land into a currency only they can print. We are turning labour and goods into credits only we can earn."*
