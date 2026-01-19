# PRD-09: Energy Resource Layer

## Document Information
- **Version**: 1.0
- **Status**: Draft
- **Dependencies**: PRD-08 (Survival Scheduler)
- **Dependents**: PRD-07 (Emergency Mode - energy triggers)

---

## 1. Overview

The Energy Resource Layer tracks physical resource constraints (energy, water, critical supplies) that determine survival feasibility. Unlike the credit ledger, energy cannot be "created" - it is tracked as physical inventory and flow.

### Design Principle
**Energy is tracked as physical inventory, not as a speculative token.** This prevents financialization while ensuring the scheduler respects physical reality.

---

## 2. Energy Model

### 2.1 Energy Carriers

```typescript
type EnergyCarrierId = string;

interface EnergyCarrier {
  id: EnergyCarrierId;
  name: string;
  unit: string;                    // e.g., "kg", "L", "kWh"
  category: EnergyCategory;
  conversionToBaseUnit?: number;   // For equivalence calculations
  storable: boolean;
  maxStorageCapacity?: number;     // Cell's storage limit
  perishable?: {
    halfLifeDays: number;
  };
}

type EnergyCategory =
  | 'SOLID_FUEL'      // Wood, coal, peat
  | 'LIQUID_FUEL'     // Diesel, petrol, kerosene
  | 'GAS'             // Propane, natural gas
  | 'ELECTRICITY'     // Stored (batteries) or flow (solar)
  | 'WATER'           // Potable water
  | 'OTHER';

const ENERGY_CARRIERS: EnergyCarrier[] = [
  {
    id: 'FIREWOOD',
    name: 'Firewood',
    unit: 'kg',
    category: 'SOLID_FUEL',
    storable: true,
    maxStorageCapacity: 10000
  },
  {
    id: 'DIESEL',
    name: 'Diesel Fuel',
    unit: 'L',
    category: 'LIQUID_FUEL',
    storable: true,
    maxStorageCapacity: 500
  },
  {
    id: 'ELECTRICITY_STORED',
    name: 'Battery Storage',
    unit: 'kWh',
    category: 'ELECTRICITY',
    storable: true,
    maxStorageCapacity: 100
  },
  {
    id: 'POTABLE_WATER',
    name: 'Potable Water',
    unit: 'L',
    category: 'WATER',
    storable: true,
    maxStorageCapacity: 5000,
    perishable: { halfLifeDays: 14 }
  }
];
```

### 2.2 Energy State

```typescript
interface EnergyState {
  cellId: CellId;
  stocks: Map<EnergyCarrierId, EnergyStock>;
  lastUpdated: Timestamp;
}

interface EnergyStock {
  carrierId: EnergyCarrierId;
  currentAmount: number;
  unit: string;
  lastRestocked: Timestamp;
  projectedDepletionDate?: Timestamp;
}

interface EnergyFlow {
  carrierId: EnergyCarrierId;
  period: { start: Timestamp; end: Timestamp };
  inflow: number;              // Amount added
  outflow: number;             // Amount consumed
  sources: EnergySource[];
  consumers: EnergyConsumer[];
}

interface EnergySource {
  type: 'PRODUCTION' | 'PROCUREMENT' | 'FEDERATION' | 'DONATION';
  amount: number;
  relatedTaskId?: string;
  notes?: string;
}

interface EnergyConsumer {
  taskCategory: EssentialTaskCategory;
  amount: number;
  efficiency?: number;
}
```

---

## 3. Energy Consumption Model

### 3.1 Task Energy Requirements

Each task category has energy requirements per labor-hour:

```typescript
interface TaskEnergyProfile {
  taskCategory: EssentialTaskCategory;
  energyModes: EnergyMode[];      // Alternative ways to do the task
}

interface EnergyMode {
  id: string;
  name: string;
  efficiency: number;             // Task effectiveness multiplier
  energyPerHour: Map<EnergyCarrierId, number>;  // ε_t,j
}

// Example: Cooking can use wood, gas, or electricity
const FOOD_ENERGY_PROFILE: TaskEnergyProfile = {
  taskCategory: 'FOOD',
  energyModes: [
    {
      id: 'WOOD_COOKING',
      name: 'Wood Fire Cooking',
      efficiency: 0.8,
      energyPerHour: new Map([['FIREWOOD', 2.5]])  // 2.5 kg/hour
    },
    {
      id: 'GAS_COOKING',
      name: 'Gas Cooking',
      efficiency: 1.0,
      energyPerHour: new Map([['PROPANE', 0.5]])   // 0.5 kg/hour
    },
    {
      id: 'ELECTRIC_COOKING',
      name: 'Electric Cooking',
      efficiency: 1.0,
      energyPerHour: new Map([['ELECTRICITY_STORED', 1.5]])  // 1.5 kWh/hour
    }
  ]
};
```

### 3.2 Consumption Calculation

```typescript
interface WeeklyEnergyPlan {
  taskAllocations: Map<EssentialTaskCategory, {
    hours: Units;
    mode: EnergyMode;
  }>;
  totalConsumption: Map<EnergyCarrierId, number>;
}

function calculateWeeklyConsumption(
  taskPlan: Map<EssentialTaskCategory, Units>,
  modeSelection: Map<EssentialTaskCategory, string>
): Map<EnergyCarrierId, number> {
  const consumption = new Map<EnergyCarrierId, number>();

  for (const [category, hours] of taskPlan) {
    const profile = getEnergyProfile(category);
    const modeId = modeSelection.get(category);
    const mode = profile.energyModes.find(m => m.id === modeId);

    if (mode) {
      for (const [carrierId, perHour] of mode.energyPerHour) {
        const current = consumption.get(carrierId) ?? 0;
        consumption.set(carrierId, current + (perHour * hours));
      }
    }
  }

  return consumption;
}
```

---

## 4. Energy Stress Index

### 4.1 Calculation

```typescript
function calculateEnergyStress(): number {
  const stocks = energy.getStocks();
  const weeklyConsumption = calculateWeeklyConsumption(
    getCurrentTaskPlan(),
    getCurrentModeSelection()
  );

  let maxStress = 0;

  for (const [carrierId, required] of weeklyConsumption) {
    const stock = stocks.get(carrierId);
    const available = stock ? stock.currentAmount + getExpectedInflow(carrierId) : 0;

    const stress = required / Math.max(available, 0.001);  // Avoid division by zero
    maxStress = Math.max(maxStress, stress);
  }

  return maxStress;
  // S_E <= 1.0: feasible
  // S_E > 1.0: infeasible without rationing/substitution
}
```

### 4.2 Integration with Emergency Mode

```typescript
// From PRD-07: Emergency Mode uses energy stress
function getStressIndicators(): StressIndicators {
  return {
    // ... economic indicators ...
    energyStress: energy.calculateEnergyStress(),
    // ...
  };
}

// PANIC triggers when S_E > threshold (e.g., 1.2)
```

---

## 5. Rationing and Substitution

### 5.1 When Energy Is Scarce

When `S_E > 1.0`, the cell must:
1. **Ration**: Reduce consumption per member
2. **Substitute**: Switch to alternative energy modes
3. **Shift production**: Reallocate labor to energy procurement

### 5.2 Rationing Model

```typescript
interface RationingPlan {
  targetStress: number;           // Target S_E (e.g., 0.95)
  bundleReductionFactor: number;  // y: fraction of full bundle
  taskReductions: Map<EssentialTaskCategory, number>;  // Hours reduced
  modeSubstitutions: Map<EssentialTaskCategory, string>;  // New modes
  additionalProcurement: Map<EnergyCarrierId, Units>;  // Labor hours for procurement
}

function computeRationingPlan(
  currentStress: number,
  targetStress: number
): RationingPlan {
  // Start with current plan
  const plan: RationingPlan = {
    targetStress,
    bundleReductionFactor: 1.0,
    taskReductions: new Map(),
    modeSubstitutions: new Map(),
    additionalProcurement: new Map()
  };

  // Strategy 1: Mode substitution (switch to lower-energy modes)
  // Strategy 2: Additional procurement (allocate labor to energy gathering)
  // Strategy 3: Bundle reduction (everyone gets less)

  // Iteratively adjust until target stress achieved
  let iterations = 0;
  while (calculatePlanStress(plan) > targetStress && iterations < 100) {
    // Try substitutions first
    if (trySubstitution(plan)) continue;

    // Try additional procurement
    if (tryProcurement(plan)) continue;

    // Fall back to bundle reduction
    plan.bundleReductionFactor *= 0.95;
    iterations++;
  }

  return plan;
}
```

### 5.3 Bundle Reduction

```typescript
// Each member receives a fraction of the full essential bundle
interface MemberBundle {
  memberId: IdentityId;
  bundleFraction: number;        // y_m: 0 to 1
  energyAllocation: Map<EnergyCarrierId, number>;
}

function distributeBundles(
  totalAvailable: Map<EnergyCarrierId, number>,
  members: IdentityId[],
  priorityRules: BundlePriorityRules
): MemberBundle[] {
  // Minimum humanitarian floor
  const y_min = 0.6;  // Everyone gets at least 60%

  // Vulnerable members may get higher allocation
  const bundles: MemberBundle[] = [];

  for (const memberId of members) {
    const vulnerability = getVulnerabilityScore(memberId);
    const baseFraction = calculateBaseFraction(totalAvailable, members.length);
    const adjustedFraction = Math.max(
      y_min,
      baseFraction * (1 + vulnerability * 0.2)
    );

    bundles.push({
      memberId,
      bundleFraction: Math.min(1.0, adjustedFraction),
      energyAllocation: calculateMemberAllocation(adjustedFraction, totalAvailable)
    });
  }

  return bundles;
}
```

---

## 6. Functional Requirements

### 6.1 Stock Management

#### FR-1.1: Stock Tracking
- Track current stock levels for all carriers
- Record stock changes (additions, consumption)
- Project depletion dates

#### FR-1.2: Inflow Recording
- Record energy procurement (task-related)
- Record federation imports
- Record donations/external sources

#### FR-1.3: Consumption Recording
- Record consumption by task category
- Track mode used for consumption
- Calculate efficiency metrics

### 6.2 Planning

#### FR-2.1: Weekly Energy Plan
- Generate plan based on task schedule
- Calculate total consumption by carrier
- Identify shortfalls

#### FR-2.2: Mode Selection
- Select energy modes for each task category
- Optimize for availability and efficiency
- Support manual overrides

### 6.3 Stress Monitoring

#### FR-3.1: Real-time Stress Index
- Calculate S_E continuously
- Integrate with Emergency Mode triggers

#### FR-3.2: Projections
- Project stress index forward
- Identify approaching shortfalls
- Generate early warnings

### 6.4 Rationing

#### FR-4.1: Rationing Plan Generation
- Compute optimal rationing plan when S_E > 1
- Balance substitution, procurement, and reduction

#### FR-4.2: Bundle Distribution
- Distribute reduced bundles fairly
- Protect vulnerable members
- Track compliance

---

## 7. API Specification

```typescript
interface IEnergyEngine {
  // Stock Management
  getStocks(): Map<EnergyCarrierId, EnergyStock>;
  getStock(carrierId: EnergyCarrierId): EnergyStock | null;
  recordStockChange(change: StockChange): Result<void, EnergyError>;
  recordConsumption(consumption: ConsumptionRecord): Result<void, EnergyError>;

  // Carriers
  getCarriers(): EnergyCarrier[];
  getEnergyProfile(category: EssentialTaskCategory): TaskEnergyProfile;

  // Planning
  generateWeeklyPlan(): Result<WeeklyEnergyPlan, EnergyError>;
  setModeSelection(category: EssentialTaskCategory, modeId: string): Result<void, EnergyError>;
  getSelectedMode(category: EssentialTaskCategory): string;

  // Stress
  calculateEnergyStress(): number;
  getStressIndex(): number;  // Cached value
  projectStress(daysAhead: number): StressProjection;

  // Rationing
  computeRationingPlan(targetStress: number): RationingPlan;
  applyRationingPlan(plan: RationingPlan): Result<void, EnergyError>;
  getBundleDistribution(): MemberBundle[];

  // History
  getFlowHistory(carrierId: EnergyCarrierId, timeRange: TimeRange): EnergyFlow[];
  getConsumptionHistory(timeRange: TimeRange): ConsumptionHistory;

  // Projections
  projectDepletion(carrierId: EnergyCarrierId): Timestamp | null;
  generateProcurementAlert(): ProcurementAlert[];
}

interface StockChange {
  carrierId: EnergyCarrierId;
  delta: number;                  // Positive for addition, negative for consumption
  type: 'PROCUREMENT' | 'PRODUCTION' | 'CONSUMPTION' | 'LOSS' | 'FEDERATION';
  relatedTaskId?: string;
  notes?: string;
}

interface ConsumptionRecord {
  carrierId: EnergyCarrierId;
  amount: number;
  taskCategory: EssentialTaskCategory;
  modeUsed: string;
  timestamp: Timestamp;
}

interface StressProjection {
  daysAhead: number;
  projectedStress: number[];      // Daily projections
  criticalDate?: Timestamp;       // When S_E > 1
  recommendations: string[];
}

interface ProcurementAlert {
  carrierId: EnergyCarrierId;
  currentStock: number;
  projectedDaysRemaining: number;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recommendedProcurement: number;
  laborHoursRequired: number;
}

type EnergyError =
  | { type: 'CARRIER_NOT_FOUND'; carrierId: string }
  | { type: 'INSUFFICIENT_STOCK'; carrierId: string; available: number; requested: number }
  | { type: 'MODE_NOT_AVAILABLE'; category: string; modeId: string }
  | { type: 'PLAN_INFEASIBLE'; reason: string };
```

---

## 8. Worked Example: Energy Shock

### Baseline

Cell with 80 members, baseline weekly wood consumption: 950 kg
Available: E + I = 1000 kg
Stress: S_E = 950/1000 = 0.95 (Normal)

### Shock: 30% supply disruption

Available drops to: 700 kg
Stress: S_E = 950/700 = 1.36 (PANIC)

### Response

1. **Mode Substitution**: Switch some cooking from wood to propane
   - Saves 100 kg wood, uses 20 kg propane
   - New wood need: 850 kg

2. **Additional Procurement**: Allocate 50 extra labor hours to wood gathering
   - At 2 kg/hour yield: +100 kg
   - New wood available: 800 kg

3. **Bundle Reduction**: Still short
   - Need: 850 kg, Have: 800 kg
   - Reduce bundle: y = 800/850 = 0.94 (94% of full heat/cooking)

Final stress: S_E = 800/800 = 1.0 (barely feasible)

---

## 9. Test Cases

### 9.1 Unit Tests

| ID | Test | Expected |
|----|------|----------|
| EN-01 | Record stock addition | Stock increases |
| EN-02 | Record consumption | Stock decreases |
| EN-03 | Calculate stress with adequate supply | S_E < 1 |
| EN-04 | Calculate stress with shortage | S_E > 1 |
| EN-05 | Mode substitution reduces consumption | Lower carrier usage |
| EN-06 | Generate rationing plan | Achieves target stress |
| EN-07 | Bundle distribution protects vulnerable | Higher allocation |

### 9.2 Integration Tests

| ID | Test |
|----|------|
| EN-I1 | Full week with energy tracking |
| EN-I2 | Shock response with automatic rationing |
| EN-I3 | Integration with scheduler mode selection |
| EN-I4 | Emergency mode trigger on high S_E |

---

## 10. Acceptance Criteria

- [ ] All energy carriers trackable
- [ ] Stock changes recorded accurately
- [ ] Consumption linked to tasks
- [ ] Stress index calculation correct
- [ ] Mode substitution functional
- [ ] Rationing plan generation working
- [ ] Bundle distribution fair
- [ ] Emergency mode integration complete
