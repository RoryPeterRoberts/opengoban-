# PRD-08: Survival Scheduler

## Document Information
- **Version**: 1.0
- **Status**: Draft
- **Dependencies**: PRD-03 (Commitments), PRD-04 (Identity)
- **Dependents**: PRD-09 (Energy Layer)

---

## 1. Overview

The Survival Scheduler transforms the cell from a mere ledger into a coordination substrate for real survival. It ensures essential tasks are covered, matches labor supply to needs, and integrates with the credit system to incentivize participation.

### Core Insight
A purely market-clearing approach fails under collapse because:
- Essentials require minimum coverage regardless of "price"
- Fear and hoarding create liquidity freezes
- Transaction-level rationality doesn't guarantee system viability

The scheduler provides the "viability layer" on top of the ledger's "conservation layer."

---

## 2. Task Coverage Model

### 2.1 Essential Task Categories

```typescript
type EssentialTaskCategory =
  | 'FOOD'                    // Growing, harvesting, cooking, distribution
  | 'WATER_SANITATION'        // Water runs, filtration, waste, hygiene
  | 'ENERGY_HEAT'             // Firewood, charging, generator/solar
  | 'SHELTER_REPAIR'          // Repairs, winterization, tools
  | 'MEDICAL'                 // First aid, meds logistics, caregiving
  | 'CHILDCARE_DEPENDENT'     // Direct care, supervision
  | 'SECURITY_COORDINATION'   // Conflict mediation, watch, admin
  | 'PROCUREMENT_TRANSPORT';  // Trips, hauling, supply runs

interface TaskCategory {
  id: EssentialTaskCategory;
  name: string;
  isEssential: boolean;
  minimumWeeklyHours: Units;     // H_t^min
  priority: number;              // For rationing decisions
  energyCarriers?: string[];     // Which energy types it consumes
  skillRequirements?: string[];  // Required skills
}

const ESSENTIAL_CATEGORIES: TaskCategory[] = [
  {
    id: 'FOOD',
    name: 'Food Production & Distribution',
    isEssential: true,
    minimumWeeklyHours: 520,
    priority: 1,
    energyCarriers: ['WOOD', 'ELECTRICITY'],
    skillRequirements: ['cooking', 'gardening']
  },
  // ... other categories
];
```

### 2.2 Coverage Constraints

```typescript
interface CoverageConstraints {
  // For each essential category t:
  // SUM(a_i,t * x_i,t) >= H_t^min
  // Where:
  //   a_i,t = effectiveness of member i at task t
  //   x_i,t = hours allocated to member i for task t
  //   H_t^min = minimum required hours

  taskRequirements: Map<EssentialTaskCategory, Units>;
  memberSupply: Map<IdentityId, MemberSupply>;
}

interface MemberSupply {
  memberId: IdentityId;
  weeklyAvailableHours: Units;           // s_i
  skillEffectiveness: Map<EssentialTaskCategory, number>;  // a_i,t in [0,1]
  preferences?: Map<EssentialTaskCategory, number>;  // Preference weights
  constraints?: MemberConstraints;
}

interface MemberConstraints {
  maxHoursPerCategory?: Map<EssentialTaskCategory, Units>;
  unavailableDays?: number[];  // 0=Sunday, etc.
  physicalLimitations?: string[];
}
```

### 2.3 Feasibility Check

```typescript
interface FeasibilityResult {
  feasible: boolean;
  totalRequired: Units;
  totalAvailable: Units;
  categoryGaps: Map<EssentialTaskCategory, {
    required: Units;
    available: Units;
    gap: Units;
  }>;
  bottleneckCategories: EssentialTaskCategory[];
  recommendations: string[];
}

function checkCoverageFeasibility(): FeasibilityResult {
  const requirements = getTaskRequirements();
  const supply = getMemberSupply();

  let totalRequired = 0;
  let totalAvailable = 0;
  const categoryGaps = new Map();
  const bottlenecks: EssentialTaskCategory[] = [];

  for (const category of ESSENTIAL_CATEGORIES.filter(c => c.isEssential)) {
    const required = requirements.get(category.id) ?? category.minimumWeeklyHours;
    totalRequired += required;

    // Calculate effective supply for this category
    let effectiveSupply = 0;
    for (const [memberId, memberSupply] of supply) {
      const effectiveness = memberSupply.skillEffectiveness.get(category.id) ?? 0.5;
      const maxContribution = memberSupply.weeklyAvailableHours * effectiveness;
      effectiveSupply += maxContribution;
    }
    totalAvailable += effectiveSupply;

    const gap = Math.max(0, required - effectiveSupply);
    categoryGaps.set(category.id, { required, available: effectiveSupply, gap });

    if (gap > 0) {
      bottlenecks.push(category.id);
    }
  }

  return {
    feasible: bottlenecks.length === 0,
    totalRequired,
    totalAvailable,
    categoryGaps,
    bottleneckCategories: bottlenecks,
    recommendations: generateRecommendations(categoryGaps, bottlenecks)
  };
}
```

---

## 3. Task Slot System

### 3.1 Task Slots

```typescript
interface TaskSlot {
  id: string;
  category: EssentialTaskCategory;
  name: string;
  description: string;
  period: {
    startDate: Date;
    endDate: Date;
    dayOfWeek?: number;         // For recurring
    timeOfDay?: string;         // e.g., "morning", "afternoon"
  };
  hoursRequired: Units;
  skillsRequired?: string[];
  physicalRequirements?: string[];
  maxAssignees: number;
  currentAssignees: TaskAssignment[];
  status: TaskSlotStatus;
  relatedCommitmentIds: CommitmentId[];
  creditValue: Units;            // How much credit earned
}

type TaskSlotStatus =
  | 'OPEN'                       // Needs assignment
  | 'PARTIALLY_FILLED'           // Some assignees, needs more
  | 'FILLED'                     // Fully assigned
  | 'IN_PROGRESS'                // Currently being executed
  | 'COMPLETED'                  // Successfully done
  | 'INCOMPLETE'                 // Not completed by deadline
  | 'CANCELLED';

interface TaskAssignment {
  slotId: string;
  memberId: IdentityId;
  hoursAssigned: Units;
  commitmentId?: CommitmentId;   // If escrowed
  status: 'ASSIGNED' | 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW';
  completedHours?: Units;
  rating?: 1 | 2 | 3 | 4 | 5;
  notes?: string;
}
```

### 3.2 Recurring Task Templates

```typescript
interface TaskTemplate {
  id: string;
  category: EssentialTaskCategory;
  name: string;
  description: string;
  recurrence: RecurrencePattern;
  hoursRequired: Units;
  skillsRequired?: string[];
  creditValue: Units;
  autoCreateSlots: boolean;
}

interface RecurrencePattern {
  frequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  daysOfWeek?: number[];         // For weekly
  timeSlots?: string[];          // e.g., ["06:00-10:00", "16:00-20:00"]
}
```

---

## 4. Matching Algorithm

### 4.1 Objectives

The matching algorithm optimizes for:
1. **Coverage**: All essential categories meet minimum hours
2. **Efficiency**: High-skill members assigned to matching tasks
3. **Fairness**: Load distributed reasonably
4. **Debtor priority**: Members near floor get earning opportunities

### 4.2 Algorithm

```typescript
interface MatchingResult {
  assignments: TaskAssignment[];
  unfilledSlots: TaskSlot[];
  unassignedMembers: IdentityId[];
  coverageAchieved: Map<EssentialTaskCategory, number>;
  objectiveScore: number;
}

function computeTaskMatching(
  slots: TaskSlot[],
  members: MemberSupply[],
  options: MatchingOptions
): MatchingResult {
  // Priority weighting
  const debtorPriority = options.debtorPriorityEnabled;

  // Sort slots by priority (essential first)
  const sortedSlots = [...slots].sort((a, b) =>
    getCategoryPriority(a.category) - getCategoryPriority(b.category)
  );

  // Calculate member scores for each slot
  const assignments: TaskAssignment[] = [];
  const memberRemainingHours = new Map(
    members.map(m => [m.memberId, m.weeklyAvailableHours])
  );

  for (const slot of sortedSlots) {
    const candidates = rankCandidates(slot, members, memberRemainingHours, {
      debtorPriority
    });

    // Assign top candidates up to slot capacity
    let remainingHours = slot.hoursRequired;
    for (const candidate of candidates) {
      if (remainingHours <= 0) break;
      if ((memberRemainingHours.get(candidate.memberId) ?? 0) <= 0) continue;

      const assignHours = Math.min(
        remainingHours,
        memberRemainingHours.get(candidate.memberId)!,
        slot.hoursRequired / slot.maxAssignees  // Fair share
      );

      assignments.push({
        slotId: slot.id,
        memberId: candidate.memberId,
        hoursAssigned: assignHours,
        status: 'ASSIGNED'
      });

      remainingHours -= assignHours;
      memberRemainingHours.set(
        candidate.memberId,
        memberRemainingHours.get(candidate.memberId)! - assignHours
      );
    }
  }

  return compileMatchingResult(assignments, slots, members);
}

function rankCandidates(
  slot: TaskSlot,
  members: MemberSupply[],
  remainingHours: Map<IdentityId, Units>,
  options: { debtorPriority: boolean }
): RankedCandidate[] {
  return members
    .filter(m => (remainingHours.get(m.memberId) ?? 0) > 0)
    .map(m => {
      const effectiveness = m.skillEffectiveness.get(slot.category) ?? 0.5;
      const preference = m.preferences?.get(slot.category) ?? 0.5;
      const balance = ledger.getBalance(m.memberId);
      const limit = ledger.getMemberState(m.memberId)?.limit ?? 20;

      // Debtor priority: members near floor get priority
      let debtorScore = 0;
      if (options.debtorPriority) {
        const floorProximity = -balance / limit;  // 0 to 1
        debtorScore = floorProximity * 2;  // Weight heavily
      }

      const score = effectiveness * 0.4 + preference * 0.2 + debtorScore * 0.4;

      return { memberId: m.memberId, score };
    })
    .sort((a, b) => b.score - a.score);
}
```

---

## 5. Ledger Integration

### 5.1 Credit Flow

```
Task Slot Created
      │
      v
Member Accepts Assignment
      │
      v
Escrowed Commitment Created (if essential)
      │
      v
Task Executed
      │
      v
Completion Confirmed
      │
      v
Commitment Fulfilled -> Transaction Executes
      │
      v
Member Balance: b_i += creditValue
Cell Balance: Remains zero-sum (promisee = cell/community account)
```

### 5.2 Community Account Model

For essential tasks, the "promisee" is effectively the community:

```typescript
// Option A: Distributed model - other members pay fractionally
interface EssentialTaskPayment {
  provider: IdentityId;
  amount: Units;
  payers: Array<{
    memberId: IdentityId;
    share: Units;  // Proportional to consumption
  }>;
}

// Option B: Bundle model - everyone pays flat weekly bundle
interface WeeklyBundleDebit {
  memberId: IdentityId;
  bundleCost: Units;  // = total essential hours / N
}

// The bundle cost formula
function calculateWeeklyBundleCost(): Units {
  const totalEssentialHours = ESSENTIAL_CATEGORIES
    .filter(c => c.isEssential)
    .reduce((sum, c) => sum + c.minimumWeeklyHours, 0);
  const N = ledger.getMemberCount();
  return totalEssentialHours / N;
}
```

---

## 6. Functional Requirements

### 6.1 Task Management

#### FR-1.1: Template Creation
- Define recurring task templates
- Auto-generate slots based on recurrence
- Allow manual slot creation

#### FR-1.2: Slot Assignment
- Run matching algorithm to suggest assignments
- Allow manual assignment overrides
- Create commitments for assignments

#### FR-1.3: Completion Tracking
- Record task completion
- Handle partial completion
- Process no-shows

### 6.2 Coverage Monitoring

#### FR-2.1: Real-time Coverage Dashboard
- Show current coverage by category
- Highlight gaps and bottlenecks
- Predict future coverage issues

#### FR-2.2: Alerts
- Alert when category falls below threshold
- Alert when key members unavailable
- Suggest remediation actions

### 6.3 Debtor Priority

#### FR-3.1: Priority Matching
- When enabled, route debtors to available slots
- Balance debtor priority with skill matching
- Track debtor recovery progress

---

## 7. API Specification

```typescript
interface ISchedulerEngine {
  // Task Management
  createTaskTemplate(template: TaskTemplate): Result<TaskTemplate, SchedulerError>;
  generateSlots(templateId: string, dateRange: DateRange): Result<TaskSlot[], SchedulerError>;
  createTaskSlot(slot: Omit<TaskSlot, 'id' | 'status'>): Result<TaskSlot, SchedulerError>;
  updateTaskSlot(slotId: string, updates: Partial<TaskSlot>): Result<TaskSlot, SchedulerError>;

  // Assignment
  runMatching(options?: MatchingOptions): Result<MatchingResult, SchedulerError>;
  assignMember(slotId: string, memberId: IdentityId, hours: Units): Result<TaskAssignment, SchedulerError>;
  unassignMember(slotId: string, memberId: IdentityId): Result<void, SchedulerError>;
  confirmAssignment(slotId: string, memberId: IdentityId): Result<void, SchedulerError>;

  // Completion
  recordCompletion(slotId: string, memberId: IdentityId, params: CompletionParams): Result<void, SchedulerError>;
  recordNoShow(slotId: string, memberId: IdentityId, reason?: string): Result<void, SchedulerError>;

  // Coverage
  checkCoverageFeasibility(): FeasibilityResult;
  getCoverageReport(dateRange: DateRange): CoverageReport;
  getCategoryStatus(category: EssentialTaskCategory): CategoryStatus;

  // Member
  getMemberSchedule(memberId: IdentityId, dateRange: DateRange): TaskAssignment[];
  getMemberSupply(memberId: IdentityId): MemberSupply;
  updateMemberSupply(memberId: IdentityId, supply: Partial<MemberSupply>): Result<void, SchedulerError>;

  // Priority
  setPriority(priority: SchedulerPriority): void;
  enableDebtorPriorityMatching(): void;
  disableDebtorPriorityMatching(): void;

  // Queries
  getOpenSlots(filter?: SlotFilter): TaskSlot[];
  getSlotHistory(slotId: string): TaskSlotHistory;
}

interface CompletionParams {
  hoursCompleted: Units;
  rating?: 1 | 2 | 3 | 4 | 5;
  notes?: string;
  confirmedBy?: IdentityId;  // e.g., supervisor
}

interface CoverageReport {
  period: DateRange;
  categoryReports: Map<EssentialTaskCategory, {
    required: Units;
    scheduled: Units;
    completed: Units;
    completionRate: number;
  }>;
  overallCompletionRate: number;
  topContributors: Array<{ memberId: IdentityId; hours: Units }>;
  noShows: Array<{ memberId: IdentityId; count: number }>;
}

type SchedulerError =
  | { type: 'TEMPLATE_NOT_FOUND'; templateId: string }
  | { type: 'SLOT_NOT_FOUND'; slotId: string }
  | { type: 'MEMBER_NOT_AVAILABLE'; memberId: IdentityId }
  | { type: 'SLOT_FULL' }
  | { type: 'COVERAGE_INFEASIBLE'; gaps: EssentialTaskCategory[] }
  | { type: 'COMMITMENT_FAILED'; reason: string };
```

---

## 8. Worked Example

### Cell: N=80, One Week

**Labor Supply:**
- 55 full contributors × 25h = 1,375h
- 15 limited contributors × 8h = 120h
- **Total: 1,495h**

**Essential Requirements:**
| Category | Min Hours |
|----------|-----------|
| Food | 520 |
| Water/Sanitation | 120 |
| Energy/Heat | 140 |
| Shelter/Repair | 180 |
| Medical | 100 |
| Childcare | 220 |
| Security/Coordination | 90 |
| Procurement/Transport | 120 |
| **Total** | **1,490** |

**Slack: 5 hours** - Very tight, but feasible.

**Bundle Cost per Member:**
```
c_E = 1490 / 80 = 18.625 credits/week
```

A member contributing 25h earns +25 credits, pays 18.625 bundle cost, nets +6.375.
A member contributing 8h earns +8 credits, pays 18.625 bundle cost, nets -10.625.

---

## 9. Test Cases

### 9.1 Unit Tests

| ID | Test | Expected |
|----|------|----------|
| SC-01 | Feasibility check with adequate supply | Feasible |
| SC-02 | Feasibility check with shortage | Reports gaps |
| SC-03 | Matching with skill alignment | High-skill assigned to matching |
| SC-04 | Matching with debtor priority | Debtors get opportunities |
| SC-05 | Record completion | Commitment fulfilled, credit transferred |
| SC-06 | Record no-show | Recorded, reputation impacted |

### 9.2 Integration Tests

| ID | Test |
|----|------|
| SC-I1 | Full week scheduling and execution |
| SC-I2 | Shortage handling with PANIC mode |
| SC-I3 | Debtor recovery through priority matching |

---

## 10. Acceptance Criteria

- [ ] Essential task categories defined
- [ ] Feasibility check functional
- [ ] Matching algorithm produces valid assignments
- [ ] Commitment integration working
- [ ] Coverage monitoring dashboard
- [ ] Debtor priority matching effective
- [ ] Bundle cost calculation correct
