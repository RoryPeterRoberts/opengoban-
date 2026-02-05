# Community Connect — Workflow Specifications

This document defines the user-facing screens, actions, and flows that implement the Cell Genesis process.

---

## Workflow Step 1 — Capture the Founding Idea

**Corresponds to:** Cell Genesis Stage 1

---

### Screen

Blank page (no nav, no feeds, no clutter)

### Goal

Turn a private insight into a clear, shareable social object.

### User Action (required)

Press and hold a **mic button** (primary) or type (fallback)

**Prompt text:**
> **"What's the idea you want to bring people together around?"**
> *(Say it in your own words. Rough is fine.)*

### AI Output (required, shown immediately)

1. **One-sentence Idea**
2. **One-paragraph Clarification** ("what / why / who it's for")
3. **3–5 Draft Principles** (bullets)
4. **Suggested next step** (one concrete action)

### Founder Choices (only two buttons)

| Button | Action |
|--------|--------|
| **Edit** | Inline edit of the AI draft |
| **Lock Draft** | Confirms: "Yes, this captures it." |

### Resulting Artifacts (stored)

- `FoundingIdea_v0`
- `Principles_v0`
- `ShareSummary_v0`

### Exit Condition

Founder clicks **Lock Draft** → Stage 1 complete.

### Next Step

Stage 2 — Generate a share page + link (idea can be read publicly, but no joining yet).

---

## Workflow Step 2 — Share the Idea for First Contact

**Corresponds to:** Cell Genesis Stage 2

---

### Screen

Idea Share Page (read-only)

### Goal

Expose the idea to real people without creating a group yet.

### System Action (automatic)

- Generate a **public, read-only share page** from:
  - `FoundingIdea_v0`
  - `Principles_v0`
- Create a **shareable link** (no login required to view)

### What the Page Shows (only)

- Idea title (1 sentence)
- Short explanation (1 paragraph)
- 3–5 core principles
- Founder's name (or chosen identifier)
- Clear disclaimer at top:

> **"This is an idea, not a group yet.**
> **Reading does not mean joining."**

### Viewer Actions (strictly limited)

| Action | Requirement |
|--------|-------------|
| **Request to Join** | Short message: "Why does this idea matter to you?" |
| **Send Private Feedback** | Non-binding, private note to founder |

**Not allowed:** Comments, likes, discussion, voting.

### Founder View (dashboard-style)

**Lists:**
- Join requests (with messages)
- Feedback messages

**AI Summary (optional, non-authoritative):**
- Common themes
- Questions or confusions detected

### Exit Condition

At least **one join request** received from a real person → Stage 2 complete.

### Next Step

Stage 3 — Founder reviews a request and invites one person to *endorse* the idea (second person enters).

---

## Workflow Step 3 — First Endorsement

**Corresponds to:** Cell Genesis Stage 3

---

### Screen

Join Request Review

### Goal

Turn interest into the **first social proof** without forming a group yet.

### Founder Action (required)

- Review incoming **join requests**
- Select **one** requester to proceed
- Click **Invite to Endorse**

> This is *not* a membership invite.

### System Action

- Issue a **one-time endorsement invite**
- Invite explains clearly:

> "You're being asked to endorse this idea —
> not to join a group yet."

### Invitee Flow

1. Reads the idea + principles again
2. Sees prompt:

> **"Do you broadly agree with this idea and its principles, and are you willing to help shape it?"**

3. Three options:

| Option | Result |
|--------|--------|
| **Endorse as-is** | Proceeds immediately |
| **Suggest edits, then endorse** | Opens edit mode |
| **Decline** | Exits flow |

### AI Role (bounded)

- If edits suggested:
  - AI proposes a merged version
  - Founder must explicitly accept changes
- No stage advancement without founder confirmation

### Artifacts Produced

- `FoundingIdea_v1` (if edited)
- `Principles_v1`
- **Endorsement Record** (identity + timestamp)

### Exit Condition

Exactly **two people** (founder + endorser) have endorsed the idea → Stage 3 complete.

**At this moment:**
- The idea becomes a **socially validated seed**
- Still **no cell**, no ledger, no governance

### Next Step

Stage 4 — Co-definition and boundary setting (the two endorsers clarify scope and limits).

---

## Workflow Step 4 — Co-Define Scope and Boundaries

**Corresponds to:** Cell Genesis Stage 4

---

### Screen

Co-Definition Workspace (2 people only)

### Goal

Turn a validated idea into a **selective, bounded identity**.

### Who Participates

- Founder
- First endorser

(No one else yet.)

---

### What Happens

**System prompts (sequential, short):**

**1. Scope**
> "Who is this for?"

**2. Exclusion**
> "Who is this *not* for?"

**3. Trust basis (explicit)**
> "What primarily holds this group together?"

- Geographic proximity
- Shared organisation
- Shared project
- Pre-existing trust

**4. Initial size intent**
> "What's the intended core size before review?"
> (default suggestion: 5–12)

---

### Interaction Rules

- Both participants must **agree** on each answer
- If they disagree:
  - AI highlights the conflict
  - They must resolve it before continuing
- AI may *suggest wording*, but cannot decide

---

### Artifacts Produced

- **Scope Statement v1**
- **Exclusion Statement v1**
- **Declared Trust Basis**
- **Target Core Size**

These are short, explicit, human-readable statements (no essays).

---

### Exit Condition

Both participants click **"We agree on these boundaries."** → Stage 4 complete.

**At this moment:**
- The idea becomes **intentionally selective**
- Misaligned people self-filter out
- The foundation for norms and rules is set

**Still no cell exists yet.**
This is the last step before commitment and action.

### Next Step

Stage 5 — Founders perform a **Minimum Viable Action** to prove intent and signal seriousness.

---

## Workflow Step 5 — First Action (MVA)

**Corresponds to:** Cell Genesis Stage 5

*[To be defined]*

---

## Workflow Step 6 — Coalition Formation

**Corresponds to:** Cell Genesis Stage 6

*[To be defined]*

---

## Workflow Step 7 — Norm-Setting

**Corresponds to:** Cell Genesis Stage 7

*[To be defined]*

---

## Workflow Step 8 — Ledger Launch

**Corresponds to:** Cell Genesis Stage 8

*[To be defined]*

---

## Workflow Step 9 — Dispute Handling

**Corresponds to:** Cell Genesis Stage 9

*[To be defined]*

---

## Workflow Step 10 — Recruitment

**Corresponds to:** Cell Genesis Stage 10

*[To be defined]*

---

## Workflow Step 11 — Governance Formalization

**Corresponds to:** Cell Genesis Stage 11

*[To be defined]*

---

## Workflow Step 12 — Institutional Memory

**Corresponds to:** Cell Genesis Stage 12

*[To be defined]*

---

## Workflow Step 13 — Scaling

**Corresponds to:** Cell Genesis Stage 13

*[To be defined]*

---

## Workflow Step 14 — Evolution

**Corresponds to:** Cell Genesis Stage 14

*[To be defined]*
