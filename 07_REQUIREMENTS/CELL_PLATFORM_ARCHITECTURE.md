# Cell Platform — Self-Building Community Architecture

**Author:** R. Roberts
**Date:** February 2026
**Status:** Design specification — not yet built
**Relates to:** The Cell Protocol (formal paper), Open Gobán (reference implementation)

---

## 1. Vision

A community platform that builds itself. A non-technical person clicks "Create a Cell", follows a guided setup, and gets a fully working community app with an AI agent embedded inside it. The admin talks to the AI in plain language — "add a tool lending library", "the fonts are too small", "members want event scheduling" — and the AI builds it.

No code. No developers. No dependency on any external development team or tool.

Each Cell is independent. Fully owned by its community. They can build whatever they want.

---

## 2. Design Philosophy

1. **Code is an implementation detail.** The admin never sees it. The AI writes it, the AI deploys it. The admin describes what they want and approves the result.

2. **Small is beautiful.** Each Cell is capped (default 80 members). This is not a platform trying to scale to millions. It is a village.

3. **Independence over consistency.** Cells diverge. One becomes a tool library, another a babysitting co-op, another a neighbourhood exchange. That is the point.

4. **AI gets better, the platform gets better.** Every Cell benefits from improvements in the underlying AI models without changing anything. The architecture is deliberately simple (plain HTML/JS, no framework) so the AI can reliably modify it.

5. **No central dependency.** If the Cell Platform launcher website disappears tomorrow, every deployed Cell keeps running. Nothing is shared. Nothing is centralised.

---

## 3. User Journey: Creating a Cell

### Step 1: Landing Page

The user visits the Cell Platform website. They see a simple explanation and a "Create your Cell" button.

### Step 2: Guided Setup Wizard

**Screen 1 — AI Key**

The user creates an Anthropic API key at console.anthropic.com and pastes it into the wizard. The wizard validates it works.

**Screen 2 — Database**

The user creates a Supabase project (free tier) and provides the project URL and service role key. The wizard connects to Supabase and runs the migration script automatically — creates all tables, RLS policies, triggers, and seed data. The user sees a progress bar, not SQL.

**Screen 3 — Hosting**

The user deploys to Vercel via a one-click "Deploy to Vercel" button. The wizard pre-fills environment variables (Supabase URL, anon key, AI API key).

**Screen 4 — Live**

The Cell is running. The user is the founding admin. They log in and start building through conversation.

### Step 3: The Admin Builds

The admin opens the admin panel, which contains a chat interface. They describe what they want. The AI builds it.

---

## 4. Architecture

```
┌──────────────────────────────────────┐
│          CELL (one per community)     │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Member-Facing App             │  │
│  │  (static HTML/JS on Vercel)    │  │
│  │  - Community pages             │  │
│  │  - Feedback form               │  │
│  │  - Whatever the AI has built   │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Admin Panel                   │  │
│  │  - Chat interface to AI agent  │  │
│  │  - Feedback queue              │  │
│  │  - Member management           │  │
│  │  - Changelog ("what's changed")│  │
│  └────────────┬───────────────────┘  │
│               │                      │
│  ┌────────────▼───────────────────┐  │
│  │  AI Agent (Edge Function)      │  │
│  │  - Anthropic API               │  │
│  │  - Tools:                      │  │
│  │    · Read files (GitHub API)   │  │
│  │    · Write files (GitHub API)  │  │
│  │    · Run SQL (Supabase Mgmt)   │  │
│  │    · Deploy (Vercel API)       │  │
│  │    · Read feedback             │  │
│  │  - System prompt built from:   │  │
│  │    · Base instructions         │  │
│  │    · AGENT.md (living memory)  │  │
│  │    · Current state snapshot    │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Supabase (data layer)         │  │
│  │  - Auth (magic links)          │  │
│  │  - Members, listings, etc.     │  │
│  │  - Feedback table              │  │
│  │  - Agent memory / changelog    │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  GitHub Repo (code)            │  │
│  │  - All HTML/JS/CSS files       │  │
│  │  - AGENT.md (AI's memory)     │  │
│  │  - changelog.md                │  │
│  └────────────────────────────────┘  │
│                                      │
│  ┌────────────────────────────────┐  │
│  │  Vercel (hosting)              │  │
│  │  - Serves static files         │  │
│  │  - Edge functions for AI agent │  │
│  │  - Auto-deploys on git push    │  │
│  └────────────────────────────────┘  │
│                                      │
└──────────────────────────────────────┘
```

### Key principle: each Cell owns all four layers

| Layer | Service | Ownership |
|-------|---------|-----------|
| Code | GitHub repo (forked from template) | Community's own repo |
| Data | Supabase project | Community's own database |
| Hosting | Vercel deployment | Community's own domain |
| AI | Anthropic API key | Community's own key and cost |

Nothing is shared. Nothing is centralised.

---

## 5. The AI Agent

### 5.1 Where It Runs

A Supabase Edge Function (Deno) or Vercel Serverless Function. Receives messages from the admin chat UI, calls the Anthropic API with tools, returns responses.

### 5.2 System Prompt

The agent's system prompt is assembled from three sources:

1. **Base instructions** — How to work with the codebase: file structure, conventions, how to create pages, how to modify Supabase schemas.
2. **AGENT.md** — A living memory file in the repo that the agent updates itself. Records what has been built, architectural decisions, known issues. Equivalent to CLAUDE.md in Claude Code.
3. **Current state** — Dynamically generated: list of files in the repo, list of tables in the database, recent feedback items.

### 5.3 Tools

| Tool | Purpose | Implementation |
|------|---------|---------------|
| `read_file` | Read a file from the repo | GitHub Contents API |
| `write_file` | Create or update a file | GitHub Contents API (creates commit) |
| `delete_file` | Remove a file | GitHub Contents API |
| `list_files` | List all files in the repo | GitHub Trees API |
| `run_sql` | Execute SQL against the database | Supabase Management API |
| `query_data` | Read data from a table | Supabase REST API |
| `deploy` | Trigger a production deployment | Vercel Deploy Hook |
| `get_feedback` | Read open feedback items | Supabase REST API (feedback table) |
| `update_feedback` | Mark feedback as actioned/declined | Supabase REST API |
| `update_memory` | Update AGENT.md | GitHub Contents API |

### 5.4 Conversation Flow Example

```
Admin: "I want members to be able to lend tools to each other"

Agent: I'll build a tool lending feature. Here's what I'll do:
       - Create a 'tool_library' table for registered tools
       - Add a "Tool Library" page where members can list and browse tools
       - Add a "Borrow" button that creates a lending request
       - Add notifications when someone wants to borrow your tool
       Shall I go ahead?

Admin: "Yes"

Agent: [creates table via run_sql]
       [writes tool-library.html via write_file]
       [updates index.html to add a link via write_file]
       [updates AGENT.md to record what was built]
       [triggers deploy]

       Done. The Tool Library is live at your-cell.vercel.app/tool-library.html.
       Members can now list tools and request to borrow them.

Admin: "The borrow button is hard to see on mobile"

Agent: [reads tool-library.html]
       [modifies the button styling]
       [deploys]

       Fixed — the borrow button is now larger with more contrast.
```

### 5.5 Safety Rails

| Rail | Description |
|------|-------------|
| **Confirmation** | No destructive database operations without explicit admin approval |
| **Changelog** | Every change logged to a `changelog` table: what changed, why, which files, timestamp |
| **Rollback** | Git history enables reverting any change. Agent can do this on request. |
| **Preview** | For significant changes, the agent describes what it will do before doing it |
| **Cost awareness** | Agent tracks API usage and warns the admin when approaching limits |

---

## 6. The Admin Experience

The admin panel is a single page with five views:

1. **Chat** — The main interface. Talk to the AI. Ask it to build things, fix things, check feedback.
2. **Feedback Queue** — Shows member feedback. Admin can ask the AI to handle specific items or batch-triage them.
3. **Changelog** — A timeline of every change the AI has made. Each entry shows what changed, why, and a "revert" button.
4. **Settings** — API key management, community settings (name, member cap, categories), domain configuration.
5. **Members** — Approve/review new members, see engagement, manage invites.

The admin never leaves this panel. Everything happens through conversation or the supporting views.

---

## 7. The Member Experience

Members do not know or care that AI built the app. They see a community platform that works. They use the feedback form to request features or report bugs. Their feedback enters the loop:

```
Member submits feedback
        ↓
Admin sees it in the queue
        ↓
Admin says "handle this feedback"
        ↓
AI triages, proposes a fix
        ↓
Admin approves
        ↓
AI implements and deploys
        ↓
Member sees the improvement
```

---

## 8. The Starter Template

### Included out of the box:
- Auth (magic link login)
- Member profiles
- Admin panel with AI chat
- Feedback form
- Basic member directory
- Invite system (admin-controlled)
- Community settings

### NOT included — the AI builds these on request:
- Listings / exchanges / marketplace
- Events / scheduling
- Tool lending
- Skill sharing
- Noticeboard
- Credit system
- Whatever the community needs

The template is deliberately minimal and generic. The AI tailors it to the community's actual needs through conversation.

---

## 9. How Cells Evolve Independently

**Cell A** (suburban neighbourhood):
> "We're mostly parents. Can we have a babysitting exchange where people earn credits by watching each other's kids?"

**Cell B** (allotment community):
> "We share tools and seeds. I want a tool library and a seed swap board."

**Cell C** (apartment building):
> "We need a noticeboard for building announcements and a way to book the shared BBQ area."

Same starting template. Three completely different apps within a week. Each built through conversation.

---

## 10. Relationship to the Cell Protocol

The Cell Protocol paper (Version 1.0, February 2026) formalises the mutual credit system that Open Gobán runs on. The Cell Platform is the delivery mechanism:

| Layer | Document | Purpose |
|-------|----------|---------|
| **Protocol** | Cell Protocol paper | Formal rules: conservation, bounded extraction, admission friction, emergency mode |
| **Reference implementation** | Open Gobán | Working example of a single Cell, built manually |
| **Platform** | This document | How to replicate Cells without manual development |

The Cell Protocol's safety properties (conservation invariant, debt floor, invite chain) are embedded in the starter template's database schema and RPC functions. The AI agent can build features on top of these but cannot violate the protocol constraints — they are enforced at the database level, not in application code.

---

## 11. Technical Requirements

### For the Cell Platform launcher:
- A static website explaining the concept
- The guided setup wizard
- The GitHub template repository
- Migration scripts for Supabase

### For each deployed Cell:

| Service | Tier | Purpose |
|---------|------|---------|
| Supabase | Free | Auth, database, edge functions |
| Vercel | Free | Hosting, serverless functions, auto-deploy |
| GitHub | Free | Code storage, version history |
| Anthropic API | ~$5-20/month | AI agent conversations |

**Total cost per Cell: $0-20/month.** The only real cost is AI API calls. Everything else is within free tiers for a small community (< 80 members).

---

## 12. Build Plan

### Phase 1: Extract and Template
- Extract all hardcoded config from Open Gobán into environment variables
- Write a single SQL migration script (all tables, RLS, triggers, seed data)
- Create the GitHub template repository
- Add a "Deploy to Vercel" button
- Write a plain-language setup guide
- **Outcome:** Anyone technical can clone and deploy a Cell

### Phase 2: AI Agent Core
- Build the agent edge function (Anthropic API + tools)
- Implement tools: read_file, write_file, list_files, run_sql, deploy
- Write the base system prompt and AGENT.md template
- Build the admin chat UI (single page, message history, streaming responses)
- Add the changelog table and logging
- **Outcome:** Admin can talk to the AI and it can modify the Cell

### Phase 3: Guided Setup Wizard
- Build the setup wizard as a standalone web app
- Walk users through: API key, Supabase, Vercel, first login
- Auto-run migrations, validate connections, pre-fill environment variables
- **Outcome:** Non-technical people can create a Cell

### Phase 4: Polish and Safety
- Add rollback capability ("undo last change")
- Add cost tracking and warnings
- Add preview mode ("show me what you'll change before doing it")
- Feedback-to-AI pipeline (auto-triage option)
- Community template gallery (share what your Cell built)
- **Outcome:** Production-ready platform

---

## 13. Open Questions

1. **AI model flexibility.** Should Cells be locked to Claude, or support other providers (GPT, Gemini, open-source)? The tool interface is model-agnostic, so multi-provider support is feasible.

2. **Agent memory limits.** As a Cell evolves, AGENT.md grows. A strategy is needed for compressing and summarising the memory so the agent stays effective over time.

3. **Multi-admin collaboration.** Can multiple admins chat with the AI? Does it need conversation history per admin, or a shared thread?

4. **Feature sharing between Cells.** Could Cells share features? "Cell A built event scheduling — import it?" Powerful but complex. May conflict with the independence principle.

5. **Mobile admin.** The admin chat should work on mobile — many community admins will be on their phones.

6. **Offline resilience.** If the AI API is down, the Cell still works (it is static files). Only building and evolving is paused. This is a feature, not a bug.

---

## 14. What Open Gobán Proves

Open Gobán is the proof of concept. It demonstrates:

- The architecture works: static HTML/JS + Supabase + Vercel handles a real community
- The Cell Protocol's safety properties hold in practice
- AI-assisted development (via Claude Code) can build and evolve the app through conversation
- The feedback loop (member feedback → admin triage → AI implementation → deploy) works

The Cell Platform extracts this pattern into something any community can deploy without a developer. The AI moves from being an external development tool (Claude Code) to an embedded agent inside the Cell itself.
