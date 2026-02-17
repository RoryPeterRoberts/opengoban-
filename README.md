# Open Gobán - Private Pilot

A local community exchange platform. Neighbours helping neighbours.

## Quick Start

### Run Locally

1. Make sure you have Node.js installed
2. Run the development server:
   ```bash
   npx serve -l 3000
   ```
3. Open: http://localhost:3000/access.html

### Create Test Invites

Open browser console on any page and run:
```javascript
createInvite('test@example.com', 'Test user')
```
This returns a token you can use to access the app.

## Deployment

### Option A: Vercel (Recommended)

1. Push code to a private GitHub repository
2. Connect to [Vercel](https://vercel.com)
3. Deploy (auto-detects static site)
4. Share URL + invite tokens with pilot users

### Option B: Netlify

1. Go to [Netlify](https://netlify.com)
2. Drag-drop the project folder
3. Optionally enable password protection
4. Share URL + invite tokens with pilot users

### Option C: Local Network

Run on your local network for nearby users:
```bash
npx serve -l 3000 --listen 0.0.0.0
```
Share your local IP address + port with users on the same network.

## Access Control

### User Access

- Users need an invite token to access the platform
- Tokens are created via `createInvite(email, note)` in browser console
- Users enter their token at `/access.html`
- After completing their profile, they get full access

### Admin Access

Admin pages require a password:
- **Password:** `pilot2025`
- **Admin Pages:**
  - `/triage.html` - Review and triage feedback
  - `/review-proposals.html` - Review community proposals
  - `/implementation-pack.html` - View implementation packs

## Project Structure

```
/
├── access.html              # Token gate / login page
├── index.html               # Main app (protected)
├── join.html                # Profile completion for new users
├── join-status.html         # Application status page
├── my-feedback.html         # User's own feedback view
├── profile.html             # User profile page
├── triage.html              # Admin: Feedback triage
├── review-proposals.html    # Admin: Proposal review
├── implementation-pack.html # Admin: Implementation packs
├── charter.html             # Community charter (public)
├── safety.html              # Safety info (public)
├── terms.html               # Terms & conditions (public)
├── privacy.html             # Privacy notice (public)
├── audit.html               # Audit log (public)
├── review.html              # Community review panel
├── js/
│   └── auth.js              # Authentication module
├── shared.js                # Shared utilities and data
├── theme.css                # Design system
├── robots.txt               # Block search engines
└── package.json             # Dev scripts
```

## Data Storage

All data is stored in browser localStorage:
- `cc_invites` - Invite tokens and user profiles
- `cc_session` - Session data (sessionStorage)
- `cc_admin_session` - Admin session (sessionStorage)
- `cc_feedback` - User feedback
- `cc_proposals` - Community proposals
- `cc_implementation_packs` - Implementation packs
- `cc_user_balance` - User credit balance
- `cc_ecosystem_health` - Supply/demand tracking
- `cc_governance` - Governance data

## Pilot Programme

This is a private pilot for 3 invited users. Features:
- Token-gated access
- Simple admin password for triage
- Feedback collection and AI triage
- Proposal promotion workflow
- Implementation pack tracking
- All pages blocked from search engines
