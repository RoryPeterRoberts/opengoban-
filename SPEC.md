# Community Connect — Full Application Spec

## 1. Project Assessment

### What Exists
A static HTML/JS/CSS app deployed to Vercel (opengoban.com) with:
- **Token-gated access** via invite links (access.html → join.html → index.html)
- **Profile creation** with categories, skills, availability
- **Offer/Need posting** flow with category selection, area, urgency, safety warnings
- **Balance display** (5 starting credits, +1/-1 per exchange)
- **Trust signals** (reliability band: Low/Medium/High based on exchanges/disputes)
- **Invite system** with shareable links and Web Share API
- **Feedback pipeline** (feedback → AI triage → proposals → implementation packs)
- **Admin pages** (triage, review proposals, implementation packs) behind simple password
- **Governance display** (moderators, audit log, pilot info)
- **Supporting pages** (charter, safety, terms, privacy, audit, profile, review)
- **Auth** (session-based via sessionStorage, admin password: pilot2025)
- **Design system** (theme.css with full token-based design)

### The Fundamental Problem
**All data is in localStorage.** This means:
1. Each user only sees their own data — there is no community
2. Posts go nowhere — no one can see other members' offers/needs
3. Exchanges can't happen — there's no counterparty
4. Balance adjustments are self-reported fiction
5. The "ecosystem health" data is hardcoded mock numbers
6. Governance/audit data is hardcoded
7. Data is lost on browser clear
8. There is no member directory

**In short: this is a single-user demo pretending to be a multi-user platform.**

### What the OpenGoban Research Envisions
The research docs describe a sophisticated system with:
- Zero-sum mutual credit (conservation law: all balances sum to zero)
- PouchDB/CouchDB offline-first sync
- Ed25519 cryptographic signing
- Web of Trust identity (no central authority)
- Proof of Care (multi-sig witness verification)
- QR offline transactions
- LoRa mesh networking
- Legal shielding (UA + CBS structure)
- Federation between communities

### The Spec Documents (archive/)
The community-connect-spec.md describes a "Cell" model — peer groups formed around ideas through a 14-stage lifecycle with AI assistance. Only 4 of 14 stages are defined.

---

## 2. Strategic Decision: What To Build

### Principle
Build something that **actually works for 5-15 real people** in a pilot community. Not a demo, not a prototype — a working exchange platform. But pragmatic: no Raspberry Pi, no mesh networking, no cryptographic signing yet. Those are Phase 2.

### Architecture Decision: Supabase Backend

**Why Supabase:**
- Free tier: 500MB database, 50K monthly active users, 5GB bandwidth
- Hosted Postgres with Row Level Security
- Realtime subscriptions (members see updates instantly)
- Built-in auth (magic links via email — no passwords to remember)
- Simple JS client (`@supabase/supabase-js` ~45KB)
- Can be accessed from static HTML/JS (no build step needed)
- Data sovereignty: can self-host later (it's open source)
- Aligns with the "progressive decentralization" path

**Why not PouchDB/CouchDB yet:**
- Requires hosting infrastructure (RPi or VPS)
- More complex setup for non-technical pilot
- Can migrate later — Supabase is a stepping stone

**Why not Firebase:**
- Google lock-in conflicts with the sovereignty ethos
- Supabase is open source, Firebase is not

### What Changes
- localStorage → Supabase Postgres (shared, persistent, real-time)
- sessionStorage auth → Supabase Auth (magic link email, no passwords)
- Hardcoded mock data → Real community data
- Single-user → Multi-user with real-time updates
- Posts vanish → Posts persist and are visible to all members

---

## 3. Data Model

### Tables

```sql
-- Members (replaces cc_invites + cc_current_user)
members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  display_name  text NOT NULL,
  member_id     text UNIQUE NOT NULL,  -- CC-0001 format
  primary_category text,
  secondary_categories text[],
  skill_tags    text[],
  availability  text,
  area          text DEFAULT 'village',
  bio           text,
  invited_by    uuid REFERENCES members(id),
  invite_token  text UNIQUE,
  status        text DEFAULT 'PENDING_PROFILE',  -- PENDING_PROFILE, REVIEW, ACCEPTED, HOLD
  role          text DEFAULT 'member',  -- member, moderator, admin
  created_at    timestamptz DEFAULT now(),
  accepted_at   timestamptz,
  terms_accepted_at timestamptz,
  terms_version text
)

-- Listings (offers and needs — the core of the exchange)
listings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     uuid REFERENCES members(id) NOT NULL,
  type          text NOT NULL,  -- 'offer' or 'need'
  category      text NOT NULL,
  title         text NOT NULL,
  description   text,
  tags          text[],
  area          text DEFAULT 'village',
  urgency       text DEFAULT 'This week',
  location      text,
  travel_needed boolean DEFAULT false,
  status        text DEFAULT 'active',  -- active, matched, completed, expired, cancelled
  visibility    text DEFAULT 'public',  -- public, invitees_only
  created_at    timestamptz DEFAULT now(),
  expires_at    timestamptz,
  matched_with  uuid REFERENCES listings(id)
)

-- Exchanges (the actual transactions — the ledger)
exchanges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid REFERENCES listings(id),
  provider_id   uuid REFERENCES members(id) NOT NULL,  -- person giving help
  receiver_id   uuid REFERENCES members(id) NOT NULL,  -- person receiving help
  credits       integer NOT NULL DEFAULT 1,
  description   text NOT NULL,
  category      text NOT NULL,
  status        text DEFAULT 'proposed',  -- proposed, accepted, completed, disputed, cancelled
  proposed_by   uuid REFERENCES members(id) NOT NULL,
  proposed_at   timestamptz DEFAULT now(),
  accepted_at   timestamptz,
  completed_at  timestamptz,
  witness_id    uuid REFERENCES members(id),
  witness_at    timestamptz,
  provider_confirmed boolean DEFAULT false,
  receiver_confirmed boolean DEFAULT false,
  notes         text
)

-- Balances (derived from exchanges, but cached for performance)
balances (
  member_id     uuid PRIMARY KEY REFERENCES members(id),
  credits       integer DEFAULT 5,  -- starting balance
  total_earned  integer DEFAULT 0,
  total_spent   integer DEFAULT 0,
  updated_at    timestamptz DEFAULT now()
)

-- Balance history (audit trail)
balance_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid REFERENCES members(id) NOT NULL,
  exchange_id   uuid REFERENCES exchanges(id),
  amount        integer NOT NULL,
  reason        text NOT NULL,
  type          text NOT NULL,  -- 'earned', 'spent', 'welcome_bonus', 'adjustment'
  balance_after integer NOT NULL,
  created_at    timestamptz DEFAULT now()
)

-- Feedback (unchanged concept, now shared)
feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     uuid REFERENCES members(id) NOT NULL,
  type          text NOT NULL,  -- bug, idea, question, other
  message       text NOT NULL,
  status        text DEFAULT 'new',  -- new, triaged, actioned, declined
  priority      text,
  admin_notes   text,
  created_at    timestamptz DEFAULT now()
)

-- Audit log (governance transparency)
audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text NOT NULL,
  actor_id      uuid REFERENCES members(id),
  actor_name    text NOT NULL,
  description   text NOT NULL,
  details       text,
  created_at    timestamptz DEFAULT now()
)

-- Invites (tracking who invited whom)
invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token         text UNIQUE NOT NULL,
  created_by    uuid REFERENCES members(id) NOT NULL,
  invitee_name  text,
  invitee_email text,
  note          text,
  status        text DEFAULT 'pending',  -- pending, redeemed, expired
  redeemed_by   uuid REFERENCES members(id),
  created_at    timestamptz DEFAULT now(),
  redeemed_at   timestamptz
)
```

### Row Level Security Policies
```sql
-- Members can read all accepted members (directory)
-- Members can only update their own profile
-- Listings visible to all accepted members
-- Exchanges visible to participants + witnesses
-- Balances visible to all (transparency)
-- Balance history visible to the member themselves
-- Feedback visible to author + admins
-- Audit log readable by all
-- Invites: creator can see their own, redeemer can redeem
```

---

## 4. Application Screens & Flows

### 4.1 Auth Flow (NEW — replaces token gate)
```
access.html
  ├── Has invite token? → Enter email → Magic link sent
  ├── Magic link clicked → Check if member exists
  │   ├── New member (invite token) → join.html (profile setup)
  │   └── Existing member → index.html (home)
  └── No invite? → "Ask a neighbour for an invite link"
```

**Key change:** Email-based magic links instead of session tokens. No passwords. Invite tokens are still the gate — you need one to create an account.

### 4.2 Home Screen (index.html — MAJOR REWORK)
The home screen becomes a **live community feed**:

```
┌─────────────────────────┐
│  Community Connect      │
│  Neighbours helping     │
│  neighbours             │
│  [You · CC-0001] [5 ⏱] │
├─────────────────────────┤
│  [I need help]          │
│  [I can offer help]     │
├─────────────────────────┤
│  ── Active Listings ──  │
│                         │
│  🔧 Fence repair needed │
│     by Mary · Village   │
│     Posted 2h ago       │
│     [I can help]        │
│                         │
│  🥕 Surplus carrots     │
│     by Pat · Near you   │
│     Posted 1d ago       │
│     [I'm interested]    │
│                         │
│  🚗 Lift to Cork Sat    │
│     by Tom · Nearby     │
│     Posted 3d ago       │
│     [I can help]        │
│                         │
├─────────────────────────┤
│  ── My Active ──        │
│  Guitar lessons (offer) │
│  Status: 1 response     │
├─────────────────────────┤
│  [Invite a neighbour]   │
│  [Member directory]     │
├─────────────────────────┤
│  Governance · Audit log │
│  Charter · Terms        │
└─────────────────────────┘
```

**Key features:**
- **Live community feed** — see real offers/needs from real members
- **Response buttons** — "I can help" / "I'm interested" initiates an exchange
- **My active listings** — see responses to your own posts
- **Member directory link** — see who's in the community
- **Realtime** — new posts appear without refresh (Supabase realtime)

### 4.3 Listing Detail / Exchange Flow (NEW)
When someone clicks "I can help" or "I'm interested":

```
┌─────────────────────────┐
│  ← Fence repair needed  │
├─────────────────────────┤
│  🏠 Home & Property     │
│  Posted by Mary · CC-04 │
│  Village · This week    │
│                         │
│  "Back garden fence     │
│   blown down in storm.  │
│   Need someone to help  │
│   stand it back up."    │
│                         │
│  Reliability: Medium    │
│  Exchanges: 5           │
│  Member since: Jan 2025 │
├─────────────────────────┤
│  Exchange Terms         │
│                         │
│  This exchange:         │
│  Mary receives help     │
│  You earn: +1 credit    │
│                         │
│  Add a message:         │
│  [________________]     │
│                         │
│  [Propose Exchange]     │
└─────────────────────────┘
```

### 4.4 Exchange Lifecycle (NEW — the core transaction flow)
```
1. PROPOSED  — One party proposes (clicks "I can help")
2. ACCEPTED  — Other party accepts the proposal
3. COMPLETED — Both parties confirm the exchange happened
   - Provider clicks "I provided this help"
   - Receiver clicks "I received this help"
   - Credits transfer: provider +1, receiver -1
4. WITNESSED (optional) — A third member confirms they saw it
```

**Balance rules:**
- Credits only move when BOTH parties confirm completion
- Starting balance: 5 credits (welcome bonus)
- Minimum balance: -10 (debt floor)
- Maximum balance: +50 (prevents hoarding)
- 1 credit = ~1 hour of help (guideline, not enforced)

### 4.5 Member Directory (NEW)
```
┌─────────────────────────┐
│  ← Community Members    │
├─────────────────────────┤
│  [Search members...]    │
│  [Filter by category ▼] │
├─────────────────────────┤
│  Mary O'Sullivan CC-0002│
│  🏠 Home & Property     │
│  Skills: painting,      │
│  fencing, tiling        │
│  Reliability: Medium    │
│  Village                │
│                         │
│  Pat Byrne CC-0003      │
│  🥕 Food & Produce      │
│  Skills: growing veg,   │
│  preserving, baking     │
│  Reliability: High      │
│  Neighbourhood          │
│                         │
│  Tom Walsh CC-0004      │
│  🚗 Transport & Errands │
│  Skills: driving,       │
│  delivery               │
│  Reliability: Low       │
│  Nearby                 │
├─────────────────────────┤
│  3 members · 0 pending  │
└─────────────────────────┘
```

### 4.6 My Exchanges (NEW)
```
┌─────────────────────────┐
│  ← My Exchanges         │
├─────────────────────────┤
│  Active                 │
│  ┌───────────────────┐  │
│  │ Fence repair      │  │
│  │ with Mary         │  │
│  │ Status: Accepted  │  │
│  │ [Mark Complete]   │  │
│  └───────────────────┘  │
│                         │
│  History                │
│  ┌───────────────────┐  │
│  │ Guitar lesson     │  │
│  │ for Tom · +1 ✓    │  │
│  │ Completed 3 Jan   │  │
│  └───────────────────┘  │
│  ┌───────────────────┐  │
│  │ Lift to Cork      │  │
│  │ from Pat · -1     │  │
│  │ Completed 28 Dec  │  │
│  └───────────────────┘  │
└─────────────────────────┘
```

### 4.7 Profile Page (REWORK)
Show real data: balance, exchange history, trust signals, skills, listing history.

### 4.8 Admin Dashboard (REWORK)
- Real member management (approve/hold/remove)
- Real exchange oversight
- Real balance adjustments (for disputes)
- Real audit log (all actions tracked automatically)

---

## 5. Implementation Plan

### Phase 1: Foundation (Backend + Auth)
1. Create Supabase project
2. Create database schema (all tables above)
3. Set up Row Level Security policies
4. Create `supabase.js` client module (replaces localStorage calls)
5. Implement auth flow (magic link login, invite token redemption)
6. Update access.html, join.html, join-status.html for Supabase auth
7. Migrate shared.js functions to use Supabase

### Phase 2: Core Exchange (The Real App)
8. Rebuild index.html home screen with live community feed
9. Build listing creation flow (offer/need → category → describe → post)
10. Build listing detail view with "I can help" / "I'm interested"
11. Build exchange proposal and acceptance flow
12. Build exchange completion (dual confirmation)
13. Implement credit transfer on completion
14. Build balance display with real history

### Phase 3: Community Features
15. Build member directory page
16. Build "My Exchanges" page
17. Rework profile page with real data
18. Build notification system (new responses, exchange updates)
19. Implement witness verification (optional third-party confirmation)

### Phase 4: Admin & Governance
20. Rework admin dashboard with real member management
21. Implement automatic audit logging
22. Build dispute resolution flow
23. Clean up governance display with real data

### Phase 5: Polish & Deploy
24. Remove all mock data and debug functions
25. Add proper error handling and loading states
26. Mobile optimization pass
27. Deploy to Vercel with environment variables
28. Create first admin account and test invites

---

## 6. Files to Create/Modify

### New Files
- `supabase.js` — Supabase client + all data access functions
- `directory.html` — Member directory page
- `exchanges.html` — My exchanges page
- `listing.html` — Listing detail + exchange proposal
- `supabase-schema.sql` — Database setup script

### Major Rewrites
- `index.html` — Complete rebuild as live community feed
- `shared.js` — Strip localStorage, delegate to supabase.js
- `js/auth.js` — Replace session-based auth with Supabase Auth
- `access.html` — Magic link auth flow
- `join.html` — Profile creation writing to Supabase
- `profile.html` — Real profile data from Supabase

### Minor Updates
- `join-status.html` — Read from Supabase
- `triage.html` — Read feedback from Supabase
- `review-proposals.html` — Read proposals from Supabase
- `review.html` — Real member review
- `audit.html` — Real audit log from Supabase

### Unchanged
- `theme.css` — Design system stays as-is
- `charter.html` — Static content
- `safety.html` — Static content
- `terms.html` — Static content
- `privacy.html` — Static content (update data processing section)
- `robots.txt` — Keep as-is

---

## 7. Key Design Principles

1. **Real data, real people** — No mock data anywhere. If there's nothing to show, show "No listings yet — be the first to offer help!"
2. **Dual confirmation** — Credits only move when both parties confirm an exchange happened. Prevents gaming.
3. **Transparency** — All balances visible to all members. All governance actions logged.
4. **Progressive trust** — New members start at Low reliability. Builds through completed exchanges.
5. **Hyper-local** — Area tags (neighbourhood/village/nearby) help members find relevant listings.
6. **Mobile-first** — All screens designed for phone use. No desktop-first patterns.
7. **Invite-only** — The community grows through personal invitation, not open registration.
8. **Credits are not money** — Clear messaging everywhere. Can't be exchanged for cash.
9. **Conservation law** — Total credits in the system only change through welcome bonuses. All exchanges are zero-sum transfers.
10. **Offline tolerance** — Graceful degradation when offline (show cached data, queue actions).
