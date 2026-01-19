# PRD-05: Governance System

## Document Information
- **Version**: 1.0
- **Status**: Draft
- **Dependencies**: PRD-01 (Core Ledger), PRD-04 (Identity)
- **Dependents**: PRD-07 (Emergency Mode)

---

## 1. Overview

The Governance System provides bounded local authority for cell management. It enforces constraint-respecting powers while preventing capture through rotation, quorum requirements, and invariant preservation.

### Core Principle
**Governance may tune parameters and manage membership but may NEVER violate system invariants.**

### What Governance Can Do
- Admit/expel members
- Freeze accounts pending disputes
- Adjust limits within `[L_min, L_max]`
- Authorize commitment cancellations
- Define local policies

### What Governance Cannot Do
- Create net credit (violate conservation)
- Override the hard debt floor
- Seize balances for arbitrary redistribution
- Promise convertibility or yield

---

## 2. Governance Structure

### 2.1 Council Model

```typescript
interface GovernanceCouncil {
  cellId: CellId;
  members: CouncilMember[];
  quorumRules: QuorumRules;
  termPolicy: TermPolicy;
  createdAt: Timestamp;
  currentTerm: number;
}

interface CouncilMember {
  memberId: IdentityId;
  role: 'CHAIR' | 'MEMBER';
  joinedAt: Timestamp;
  termStartAt: Timestamp;
  termEndsAt: Timestamp;
  votesCast: number;
  proposalsMade: number;
}

interface QuorumRules {
  minCouncilSize: number;      // e.g., 5
  maxCouncilSize: number;      // e.g., 9
  standardQuorum: number;      // e.g., 0.5 (majority)
  superQuorum: number;         // e.g., 0.67 (supermajority)
  tieBreakerRule: 'CHAIR_DECIDES' | 'STATUS_QUO';
}

interface TermPolicy {
  termLengthDays: number;      // e.g., 90
  maxConsecutiveTerms: number; // e.g., 2
  electionPeriodDays: number;  // e.g., 7
  staggeredTerms: boolean;     // Partial rotation
}
```

### 2.2 Action Categories

| Category | Quorum Required | Examples |
|----------|-----------------|----------|
| ROUTINE | Standard (50%) | Minor limit adjustments, soft commitment cancellations |
| SIGNIFICANT | Standard (50%) | Member admission, dispute resolution |
| CRITICAL | Super (67%) | Member exclusion, emergency mode trigger, limit increase >50% |
| CONSTITUTIONAL | Super (67%) + member vote | Parameter bound changes, quorum rule changes |

---

## 3. Proposal System

### 3.1 Proposal Types

```typescript
type ProposalType =
  | 'MEMBER_ADMISSION'
  | 'MEMBER_EXCLUSION'
  | 'MEMBER_FREEZE'
  | 'MEMBER_UNFREEZE'
  | 'LIMIT_ADJUSTMENT'
  | 'COMMITMENT_CANCELLATION'
  | 'DISPUTE_RESOLUTION'
  | 'POLICY_CHANGE'
  | 'EMERGENCY_STATE_CHANGE'
  | 'COUNCIL_ELECTION';

interface Proposal {
  id: ProposalId;
  type: ProposalType;
  category: ActionCategory;
  proposer: IdentityId;
  title: string;
  description: string;
  payload: ProposalPayload;
  status: ProposalStatus;
  createdAt: Timestamp;
  votingEndsAt: Timestamp;
  votes: Vote[];
  outcome?: ProposalOutcome;
}

type ProposalStatus =
  | 'DRAFT'
  | 'OPEN'
  | 'CLOSED'
  | 'PASSED'
  | 'REJECTED'
  | 'EXECUTED'
  | 'EXPIRED';

interface Vote {
  voterId: IdentityId;
  decision: 'APPROVE' | 'REJECT' | 'ABSTAIN';
  reason?: string;
  timestamp: Timestamp;
  signature: Signature;
}

interface ProposalOutcome {
  decision: 'PASSED' | 'REJECTED';
  votesFor: number;
  votesAgainst: number;
  abstentions: number;
  quorumMet: boolean;
  executedAt?: Timestamp;
  executionResult?: string;
}
```

### 3.2 Proposal Payloads

```typescript
type ProposalPayload =
  | MemberAdmissionPayload
  | MemberExclusionPayload
  | LimitAdjustmentPayload
  | DisputeResolutionPayload
  | CommitmentCancellationPayload
  | PolicyChangePayload
  | EmergencyStatePayload;

interface MemberAdmissionPayload {
  applicantId: IdentityId;
  initialLimit: Units;
  bondType?: AdmissionMethod;
  sponsorId?: IdentityId;
  probationDays?: number;
}

interface MemberExclusionPayload {
  memberId: IdentityId;
  reason: string;
  evidence: string[];
  balanceHandling: 'WRITE_OFF' | 'RESTITUTION_PLAN';
  restitutionDetails?: string;
}

interface LimitAdjustmentPayload {
  memberId: IdentityId;
  currentLimit: Units;
  newLimit: Units;
  reason: string;
  // Must satisfy: L_min <= newLimit <= L_max
  // Must satisfy: |newLimit - currentLimit| <= eta (rate limit)
}

interface DisputeResolutionPayload {
  disputeId: string;
  parties: IdentityId[];
  resolution: DisputeResolution;
}

interface DisputeResolution {
  decision: string;
  compensatingTransaction?: {
    payer: IdentityId;
    payee: IdentityId;
    amount: Units;
  };
  freezeParties?: IdentityId[];
  limitAdjustments?: Array<{ memberId: IdentityId; newLimit: Units }>;
  reputationAdjustments?: Array<{ memberId: IdentityId; delta: number }>;
  exclusions?: IdentityId[];
}
```

---

## 4. Dispute Resolution

### 4.1 Dispute Types

```typescript
interface Dispute {
  id: string;
  type: DisputeType;
  claimant: IdentityId;
  respondent: IdentityId;
  claim: string;
  evidence: Evidence[];
  status: DisputeStatus;
  relatedCommitmentId?: CommitmentId;
  relatedTransactionId?: TransactionId;
  createdAt: Timestamp;
  assignedCouncilMembers?: IdentityId[];
  hearingDate?: Timestamp;
  resolution?: DisputeResolution;
}

type DisputeType =
  | 'NON_DELIVERY'           // Commitment not fulfilled
  | 'QUALITY'                // Service/goods quality dispute
  | 'FRAUD'                  // Intentional deception
  | 'IDENTITY'               // Identity-related issues
  | 'OTHER';

type DisputeStatus =
  | 'FILED'
  | 'UNDER_REVIEW'
  | 'HEARING_SCHEDULED'
  | 'RESOLVED'
  | 'ESCALATED'
  | 'CLOSED';

interface Evidence {
  type: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'WITNESS';
  content: string;
  submittedBy: IdentityId;
  timestamp: Timestamp;
}
```

### 4.2 Dispute Process

```
┌────────────┐
│   FILED    │ Claimant submits dispute
└─────┬──────┘
      │
      v
┌────────────┐
│  REVIEW    │ Council member assigned
└─────┬──────┘
      │
      ├─── Frivolous ──> CLOSED (no action)
      │
      v
┌────────────┐
│  HEARING   │ Both parties present evidence
└─────┬──────┘
      │
      v
┌────────────┐
│ RESOLUTION │ Council votes on resolution
└─────┬──────┘
      │
      v
┌────────────┐
│  EXECUTED  │ Resolution applied
└────────────┘
```

### 4.3 Resolution Options

| Action | When Used | Constraints |
|--------|-----------|-------------|
| Compensating transaction | Clear financial harm | Zero-sum, within limits |
| Freeze party | Pending investigation | Temporary, requires review |
| Limit reduction | Pattern of bad behavior | Within bounds, rate-limited |
| Reputation adjustment | Record of behavior | Advisory only |
| Exclusion | Severe/repeated violations | Requires super quorum |

---

## 5. Functional Requirements

### 5.1 Proposal Management

#### FR-1.1: Create Proposal
- Any council member may create proposals
- Proposal must specify type, payload, and justification
- Auto-assigns category based on type

#### FR-1.2: Voting Period
- Proposals enter OPEN status with voting deadline
- Duration based on category (routine: 24h, significant: 48h, critical: 72h)

#### FR-1.3: Vote Recording
- Council members cast votes with signatures
- Votes are final once cast (no changes)
- Abstentions count toward quorum but not decision

#### FR-1.4: Outcome Determination
- When voting ends, calculate outcome
- Check quorum met
- Apply decision based on threshold

### 5.2 Execution

#### FR-2.1: Automatic Execution
- Passed proposals execute automatically
- Execution must preserve all invariants
- Failure rolls back and marks proposal as FAILED

#### FR-2.2: Invariant Checking
Before any governance action:
```typescript
function canExecute(action: GovernanceAction): Result<void, InvariantViolation> {
  // Simulate action
  const simulatedState = applyAction(currentState, action);

  // Check invariants
  if (!verifyConservation(simulatedState)) {
    return err({ invariant: 'I1', message: 'Conservation violated' });
  }
  if (!verifyAllFloors(simulatedState)) {
    return err({ invariant: 'I2', message: 'Floor violated' });
  }
  // ... more checks

  return ok(void 0);
}
```

### 5.3 Council Management

#### FR-3.1: Elections
- Held per term policy
- All active members eligible to vote
- Candidates from active members with good standing

#### FR-3.2: Term Limits
- Track consecutive terms
- Enforce maximum via automatic ineligibility

#### FR-3.3: Emergency Replacement
- If council falls below minimum, emergency election triggered
- Temporary powers to remaining members

---

## 6. API Specification

```typescript
interface IGovernanceEngine {
  // Council Management
  getCouncil(): GovernanceCouncil;
  getCouncilMember(memberId: IdentityId): CouncilMember | null;
  nominateForCouncil(memberId: IdentityId): Result<void, GovernanceError>;
  conductElection(): Result<ElectionResult, GovernanceError>;

  // Proposals
  createProposal(params: CreateProposalParams): Result<Proposal, GovernanceError>;
  getProposal(id: ProposalId): Proposal | null;
  listProposals(filter?: ProposalFilter): Proposal[];
  castVote(proposalId: ProposalId, vote: VoteInput): Result<void, GovernanceError>;
  closeVoting(proposalId: ProposalId): Result<ProposalOutcome, GovernanceError>;
  executeProposal(proposalId: ProposalId): Result<void, GovernanceError>;

  // Disputes
  fileDispute(params: FileDisputeParams): Result<Dispute, GovernanceError>;
  getDispute(id: string): Dispute | null;
  listDisputes(filter?: DisputeFilter): Dispute[];
  assignDisputeReviewer(disputeId: string, reviewerId: IdentityId): Result<void, GovernanceError>;
  submitDisputeEvidence(disputeId: string, evidence: Evidence): Result<void, GovernanceError>;
  scheduleHearing(disputeId: string, date: Timestamp): Result<void, GovernanceError>;
  resolveDispute(disputeId: string, resolution: DisputeResolution): Result<void, GovernanceError>;

  // Direct Actions (with governance check)
  admitMember(payload: MemberAdmissionPayload, approvalId: ProposalId): Result<void, GovernanceError>;
  excludeMember(payload: MemberExclusionPayload, approvalId: ProposalId): Result<void, GovernanceError>;
  adjustLimit(payload: LimitAdjustmentPayload, approvalId: ProposalId): Result<void, GovernanceError>;
  setEmergencyState(state: RiskState, approvalId: ProposalId): Result<void, GovernanceError>;

  // Queries
  checkActionPermission(action: GovernanceAction): ActionPermissionResult;
  getVotingHistory(memberId: IdentityId): Vote[];
  getGovernanceStats(): GovernanceStats;
}

interface CreateProposalParams {
  type: ProposalType;
  title: string;
  description: string;
  payload: ProposalPayload;
  votingDurationHours?: number;
}

interface VoteInput {
  decision: 'APPROVE' | 'REJECT' | 'ABSTAIN';
  reason?: string;
  signature: Signature;
}

interface GovernanceStats {
  proposalsTotal: number;
  proposalsPassed: number;
  proposalsRejected: number;
  disputesTotal: number;
  disputesResolved: number;
  averageVoterTurnout: number;
  averageResolutionTimeDays: number;
}

type GovernanceError =
  | { type: 'NOT_COUNCIL_MEMBER'; memberId: IdentityId }
  | { type: 'PROPOSAL_NOT_FOUND'; proposalId: ProposalId }
  | { type: 'VOTING_CLOSED' }
  | { type: 'ALREADY_VOTED' }
  | { type: 'QUORUM_NOT_MET' }
  | { type: 'INVARIANT_VIOLATION'; details: InvariantViolation }
  | { type: 'LIMIT_OUT_OF_BOUNDS'; limit: Units }
  | { type: 'RATE_LIMIT_EXCEEDED'; maxDelta: Units }
  | { type: 'UNAUTHORIZED_ACTION' }
  | { type: 'DISPUTE_NOT_FOUND'; disputeId: string };
```

---

## 7. Capture Resistance

### 7.1 No Printing Guarantee
Conservation (`SUM(b_i) = 0`) prevents hidden issuance:
- Governance cannot create net credit
- Any "grant" must come from explicit reallocation
- Makes rent extraction visible and politically costly

### 7.2 Rotation
- Term limits prevent entrenchment
- Staggered terms maintain institutional memory
- Regular elections provide accountability

### 7.3 Bounded Authority
- All actions constrained by invariants
- Rate limits on parameter changes
- Super quorum for critical actions

### 7.4 Transparency
- All proposals and votes logged
- Dispute records accessible
- Execution results auditable

---

## 8. Test Cases

### 8.1 Unit Tests

| ID | Test | Expected |
|----|------|----------|
| GV-01 | Create valid proposal | Success |
| GV-02 | Non-council member creates proposal | Fail: NOT_COUNCIL_MEMBER |
| GV-03 | Cast valid vote | Success |
| GV-04 | Double vote | Fail: ALREADY_VOTED |
| GV-05 | Execute passed proposal | Success |
| GV-06 | Execute failed proposal | Fail |
| GV-07 | Limit adjustment within bounds | Success |
| GV-08 | Limit adjustment out of bounds | Fail: LIMIT_OUT_OF_BOUNDS |
| GV-09 | Limit adjustment exceeds rate limit | Fail: RATE_LIMIT_EXCEEDED |

### 8.2 Invariant Tests

| ID | Test | Expected |
|----|------|----------|
| GV-I1 | Any governance action preserves conservation | True |
| GV-I2 | No action can breach debt floor | True |
| GV-I3 | No action can exceed limit bounds | True |

---

## 9. Acceptance Criteria

- [ ] Proposal creation and voting functional
- [ ] Quorum and threshold calculations correct
- [ ] All invariants preserved during execution
- [ ] Dispute filing and resolution working
- [ ] Council elections functional
- [ ] Term limits enforced
- [ ] Audit trail complete and queryable
