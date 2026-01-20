/**
 * Cell Protocol - Energy Types
 *
 * Type definitions for the Energy Resource Layer (PRD-09).
 * Defines energy carriers, stocks, flows, modes, and rationing.
 */

import {
  IdentityId,
  CellId,
  Timestamp,
  Units,
} from './common';
import { TaskCategory } from './commitment';

// ============================================
// TYPE ALIASES
// ============================================

/** Unique identifier for an energy carrier */
export type EnergyCarrierId = string;

// ============================================
// ENUMS
// ============================================

/** Category of energy carrier */
export enum EnergyCategory {
  /** Solid fuels: wood, coal, peat */
  SOLID_FUEL = 'SOLID_FUEL',
  /** Liquid fuels: diesel, petrol, kerosene */
  LIQUID_FUEL = 'LIQUID_FUEL',
  /** Gas: propane, natural gas */
  GAS = 'GAS',
  /** Electricity: stored or flow */
  ELECTRICITY = 'ELECTRICITY',
  /** Water: potable water */
  WATER = 'WATER',
  /** Other resources */
  OTHER = 'OTHER',
}

// ============================================
// CORE INTERFACES
// ============================================

/** An energy carrier definition */
export interface EnergyCarrier {
  /** Unique identifier */
  id: EnergyCarrierId;

  /** Human-readable name */
  name: string;

  /** Unit of measurement (kg, L, kWh) */
  unit: string;

  /** Category of carrier */
  category: EnergyCategory;

  /** Whether this carrier can be stored */
  storable: boolean;

  /** Maximum storage capacity (optional) */
  maxStorageCapacity?: number;

  /** Perishability info (optional) */
  perishable?: {
    /** Half-life in days */
    halfLifeDays: number;
  };
}

/** Current stock level of an energy carrier */
export interface EnergyStock {
  /** Which carrier */
  carrierId: EnergyCarrierId;

  /** Current amount in stock */
  currentAmount: number;

  /** Unit of measurement */
  unit: string;

  /** When last restocked */
  lastRestocked: Timestamp;

  /** Projected depletion date (if calculable) */
  projectedDepletionDate?: Timestamp;
}

/** Source of energy inflow */
export interface EnergySource {
  /** Source name/identifier */
  name: string;

  /** Amount contributed */
  amount: number;

  /** When received */
  timestamp: Timestamp;
}

/** Consumer of energy */
export interface EnergyConsumer {
  /** Consumer name/task category */
  name: string;

  /** Amount consumed */
  amount: number;

  /** When consumed */
  timestamp: Timestamp;
}

/** Energy flow for a period */
export interface EnergyFlow {
  /** Which carrier */
  carrierId: EnergyCarrierId;

  /** Time period */
  period: {
    start: Timestamp;
    end: Timestamp;
  };

  /** Total inflow */
  inflow: number;

  /** Total outflow */
  outflow: number;

  /** Sources of inflow */
  sources: EnergySource[];

  /** Consumers of outflow */
  consumers: EnergyConsumer[];
}

/** A mode of performing a task with energy profile */
export interface EnergyMode {
  /** Mode identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Effectiveness/efficiency factor (0-1) */
  efficiency: number;

  /** Energy consumption per hour by carrier (ε_t,j) */
  energyPerHour: Map<EnergyCarrierId, number>;
}

/** Energy profile for a task category */
export interface TaskEnergyProfile {
  /** Task category */
  taskCategory: TaskCategory;

  /** Available modes for this task */
  energyModes: EnergyMode[];
}

// ============================================
// RATIONING TYPES
// ============================================

/** A rationing plan to achieve target stress */
export interface RationingPlan {
  /** Target stress level to achieve */
  targetStress: number;

  /** Bundle reduction factor (y: fraction of full bundle) */
  bundleReductionFactor: number;

  /** Task category reductions (hours reduction by category) */
  taskReductions: Map<TaskCategory, number>;

  /** Mode substitutions (category -> selected mode ID) */
  modeSubstitutions: Map<TaskCategory, string>;

  /** Additional procurement needed by carrier */
  additionalProcurement: Map<EnergyCarrierId, number>;

  /** Whether plan is feasible */
  feasible: boolean;

  /** Explanation of plan */
  explanation: string;
}

/** Member's energy bundle allocation */
export interface MemberBundle {
  /** Member ID */
  memberId: IdentityId;

  /** Bundle fraction (y_m: 0 to 1) */
  bundleFraction: number;

  /** Energy allocation by carrier */
  energyAllocation: Map<EnergyCarrierId, number>;

  /** Whether member is vulnerable (gets protected allocation) */
  isVulnerable: boolean;
}

// ============================================
// STOCK CHANGE & CONSUMPTION RECORDS
// ============================================

/** Record of a stock change (addition or removal) */
export interface StockChangeRecord {
  /** Unique ID */
  id: string;

  /** Cell ID */
  cellId: CellId;

  /** Which carrier */
  carrierId: EnergyCarrierId;

  /** Change amount (positive = addition, negative = removal) */
  delta: number;

  /** Reason for change */
  reason: StockChangeReason;

  /** Source/destination (e.g., "procurement", "task:FOOD") */
  source?: string;

  /** Timestamp */
  timestamp: Timestamp;
}

/** Reasons for stock changes */
export enum StockChangeReason {
  /** Procurement/purchase */
  PROCUREMENT = 'PROCUREMENT',
  /** Donation/gift */
  DONATION = 'DONATION',
  /** Task consumption */
  TASK_CONSUMPTION = 'TASK_CONSUMPTION',
  /** Spoilage/loss */
  SPOILAGE = 'SPOILAGE',
  /** Transfer to another cell */
  TRANSFER_OUT = 'TRANSFER_OUT',
  /** Transfer from another cell */
  TRANSFER_IN = 'TRANSFER_IN',
  /** Manual adjustment */
  ADJUSTMENT = 'ADJUSTMENT',
}

/** Record of energy consumption */
export interface ConsumptionRecord {
  /** Unique ID */
  id: string;

  /** Cell ID */
  cellId: CellId;

  /** Which carrier */
  carrierId: EnergyCarrierId;

  /** Amount consumed */
  amount: number;

  /** Task category that consumed it */
  taskCategory: TaskCategory;

  /** Mode used */
  modeId?: string;

  /** Member who performed task (optional) */
  memberId?: IdentityId;

  /** Timestamp */
  timestamp: Timestamp;
}

// ============================================
// PLANNING TYPES
// ============================================

/** Weekly energy plan */
export interface WeeklyEnergyPlan {
  /** Cell ID */
  cellId: CellId;

  /** Week start timestamp */
  weekStart: Timestamp;

  /** Projected consumption by carrier */
  projectedConsumption: Map<EnergyCarrierId, number>;

  /** Required by carrier */
  requiredByCarrier: Map<EnergyCarrierId, number>;

  /** Available by carrier */
  availableByCarrier: Map<EnergyCarrierId, number>;

  /** Selected modes by task category */
  selectedModes: Map<TaskCategory, string>;

  /** Energy stress index for this plan */
  stressIndex: number;

  /** Whether plan is feasible */
  feasible: boolean;

  /** Member bundles */
  bundles: MemberBundle[];

  /** Created at */
  createdAt: Timestamp;
}

/** Stress projection for future days */
export interface StressProjection {
  /** Days ahead */
  daysAhead: number;

  /** Projected stress values */
  projectedStress: number[];

  /** Days until crisis (stress > 1) */
  daysUntilCrisis?: number;

  /** Recommendations */
  recommendations: string[];
}

/** Procurement alert */
export interface ProcurementAlert {
  /** Carrier ID */
  carrierId: EnergyCarrierId;

  /** Current stock */
  currentStock: number;

  /** Days until depletion */
  daysUntilDepletion: number;

  /** Recommended procurement amount */
  recommendedAmount: number;

  /** Priority (1=urgent, 2=soon, 3=monitor) */
  priority: 1 | 2 | 3;

  /** Alert message */
  message: string;
}

// ============================================
// STATE TYPES
// ============================================

/** Complete energy state for a cell */
export interface EnergyState {
  /** Cell ID */
  cellId: CellId;

  /** Available carriers */
  carriers: EnergyCarrier[];

  /** Current stocks */
  stocks: Map<EnergyCarrierId, EnergyStock>;

  /** Selected modes by task category */
  selectedModes: Map<TaskCategory, string>;

  /** Task energy profiles */
  taskProfiles: TaskEnergyProfile[];

  /** Current stress index */
  stressIndex: number;

  /** Last calculation timestamp */
  lastCalculated: Timestamp;

  /** Created timestamp */
  createdAt: Timestamp;

  /** Updated timestamp */
  updatedAt: Timestamp;
}

// ============================================
// ERROR TYPES
// ============================================

/** Errors that can occur during energy operations */
export enum EnergyErrorCode {
  /** Carrier not found */
  CARRIER_NOT_FOUND = 'CARRIER_NOT_FOUND',

  /** Stock not found */
  STOCK_NOT_FOUND = 'STOCK_NOT_FOUND',

  /** Insufficient stock */
  INSUFFICIENT_STOCK = 'INSUFFICIENT_STOCK',

  /** Invalid amount */
  INVALID_AMOUNT = 'INVALID_AMOUNT',

  /** Mode not found */
  MODE_NOT_FOUND = 'MODE_NOT_FOUND',

  /** Task profile not found */
  PROFILE_NOT_FOUND = 'PROFILE_NOT_FOUND',

  /** Rationing not feasible */
  RATIONING_INFEASIBLE = 'RATIONING_INFEASIBLE',

  /** Storage operation failed */
  STORAGE_ERROR = 'STORAGE_ERROR',
}

/** Detailed energy error */
export interface EnergyError {
  code: EnergyErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================
// INTERFACE
// ============================================

/** Interface for the Energy Engine */
export interface IEnergyEngine {
  // Stock Management
  /** Get all current stocks */
  getStocks(): Map<EnergyCarrierId, EnergyStock>;

  /** Get stock for a specific carrier */
  getStock(carrierId: EnergyCarrierId): EnergyStock | null;

  /** Record a stock change (addition or removal) */
  recordStockChange(change: Omit<StockChangeRecord, 'id' | 'cellId' | 'timestamp'>): Promise<void>;

  /** Record energy consumption */
  recordConsumption(record: Omit<ConsumptionRecord, 'id' | 'cellId' | 'timestamp'>): Promise<void>;

  // Carriers
  /** Get all available carriers */
  getCarriers(): EnergyCarrier[];

  /** Get energy profile for a task category */
  getEnergyProfile(category: TaskCategory): TaskEnergyProfile | null;

  // Planning
  /** Generate weekly energy plan */
  generateWeeklyPlan(): WeeklyEnergyPlan;

  /** Set mode selection for a task category */
  setModeSelection(category: TaskCategory, modeId: string): void;

  /** Get selected mode for a task category */
  getSelectedMode(category: TaskCategory): string | null;

  // Stress
  /** Calculate current energy stress index */
  calculateEnergyStress(): number;

  /** Get current stress index */
  getStressIndex(): number;

  /** Project stress for future days */
  projectStress(daysAhead: number): StressProjection;

  // Rationing
  /** Compute a rationing plan to achieve target stress */
  computeRationingPlan(targetStress: number): RationingPlan;

  /** Apply a rationing plan */
  applyRationingPlan(plan: RationingPlan): Promise<void>;

  /** Get current bundle distribution */
  getBundleDistribution(): MemberBundle[];

  // History & Projections
  /** Get flow history for a carrier */
  getFlowHistory(carrierId: EnergyCarrierId, since: Timestamp): EnergyFlow[];

  /** Project depletion date for a carrier */
  projectDepletion(carrierId: EnergyCarrierId): Timestamp | null;

  /** Generate procurement alerts */
  generateProcurementAlerts(): ProcurementAlert[];

  // Task Support
  /** Check if a task can be completed with available energy */
  canCompleteTask(category: TaskCategory, hours: number): boolean;
}

// ============================================
// DEFAULT CARRIERS
// ============================================

/** Default energy carriers for a cell */
export const DEFAULT_CARRIERS: EnergyCarrier[] = [
  {
    id: 'FIREWOOD',
    name: 'Firewood',
    unit: 'kg',
    category: EnergyCategory.SOLID_FUEL,
    storable: true,
  },
  {
    id: 'DIESEL',
    name: 'Diesel Fuel',
    unit: 'L',
    category: EnergyCategory.LIQUID_FUEL,
    storable: true,
  },
  {
    id: 'PROPANE',
    name: 'Propane Gas',
    unit: 'kg',
    category: EnergyCategory.GAS,
    storable: true,
  },
  {
    id: 'ELECTRICITY_STORED',
    name: 'Battery Storage',
    unit: 'kWh',
    category: EnergyCategory.ELECTRICITY,
    storable: true,
  },
  {
    id: 'POTABLE_WATER',
    name: 'Potable Water',
    unit: 'L',
    category: EnergyCategory.WATER,
    storable: true,
  },
];

// ============================================
// DEFAULT TASK PROFILES
// ============================================

/** Default task energy profiles */
export const DEFAULT_TASK_PROFILES: TaskEnergyProfile[] = [
  {
    taskCategory: TaskCategory.FOOD,
    energyModes: [
      {
        id: 'FOOD_ELECTRIC',
        name: 'Electric Cooking',
        efficiency: 1.0,
        energyPerHour: new Map([['ELECTRICITY_STORED', 2.0]]),
      },
      {
        id: 'FOOD_GAS',
        name: 'Gas Cooking',
        efficiency: 0.95,
        energyPerHour: new Map([['PROPANE', 0.5]]),
      },
      {
        id: 'FOOD_WOOD',
        name: 'Wood Fire Cooking',
        efficiency: 0.7,
        energyPerHour: new Map([['FIREWOOD', 3.0]]),
      },
    ],
  },
  {
    taskCategory: TaskCategory.WATER_SANITATION,
    energyModes: [
      {
        id: 'WATER_ELECTRIC',
        name: 'Electric Pump',
        efficiency: 1.0,
        energyPerHour: new Map([['ELECTRICITY_STORED', 1.0], ['POTABLE_WATER', 50]]),
      },
      {
        id: 'WATER_MANUAL',
        name: 'Manual Draw',
        efficiency: 0.6,
        energyPerHour: new Map([['POTABLE_WATER', 30]]),
      },
    ],
  },
  {
    taskCategory: TaskCategory.ENERGY_HEAT,
    energyModes: [
      {
        id: 'HEAT_ELECTRIC',
        name: 'Electric Heating',
        efficiency: 1.0,
        energyPerHour: new Map([['ELECTRICITY_STORED', 3.0]]),
      },
      {
        id: 'HEAT_GAS',
        name: 'Gas Heating',
        efficiency: 0.9,
        energyPerHour: new Map([['PROPANE', 1.0]]),
      },
      {
        id: 'HEAT_WOOD',
        name: 'Wood Stove',
        efficiency: 0.7,
        energyPerHour: new Map([['FIREWOOD', 5.0]]),
      },
    ],
  },
  {
    taskCategory: TaskCategory.MEDICAL,
    energyModes: [
      {
        id: 'MEDICAL_FULL',
        name: 'Full Medical Equipment',
        efficiency: 1.0,
        energyPerHour: new Map([['ELECTRICITY_STORED', 1.5], ['POTABLE_WATER', 10]]),
      },
      {
        id: 'MEDICAL_BASIC',
        name: 'Basic Care',
        efficiency: 0.7,
        energyPerHour: new Map([['POTABLE_WATER', 5]]),
      },
    ],
  },
  {
    taskCategory: TaskCategory.SHELTER_REPAIR,
    energyModes: [
      {
        id: 'SHELTER_POWER_TOOLS',
        name: 'Power Tools',
        efficiency: 1.0,
        energyPerHour: new Map([['ELECTRICITY_STORED', 0.5]]),
      },
      {
        id: 'SHELTER_MANUAL',
        name: 'Manual Tools',
        efficiency: 0.6,
        energyPerHour: new Map(),
      },
    ],
  },
  {
    taskCategory: TaskCategory.CHILDCARE_DEPENDENT,
    energyModes: [
      {
        id: 'CHILDCARE_STANDARD',
        name: 'Standard Care',
        efficiency: 1.0,
        energyPerHour: new Map([['ELECTRICITY_STORED', 0.3], ['POTABLE_WATER', 5]]),
      },
    ],
  },
  {
    taskCategory: TaskCategory.SECURITY_COORDINATION,
    energyModes: [
      {
        id: 'SECURITY_STANDARD',
        name: 'Standard Security',
        efficiency: 1.0,
        energyPerHour: new Map([['ELECTRICITY_STORED', 0.2]]),
      },
    ],
  },
  {
    taskCategory: TaskCategory.PROCUREMENT_TRANSPORT,
    energyModes: [
      {
        id: 'TRANSPORT_VEHICLE',
        name: 'Vehicle Transport',
        efficiency: 1.0,
        energyPerHour: new Map([['DIESEL', 5.0]]),
      },
      {
        id: 'TRANSPORT_MANUAL',
        name: 'Manual Transport',
        efficiency: 0.4,
        energyPerHour: new Map(),
      },
    ],
  },
  {
    taskCategory: TaskCategory.GENERAL,
    energyModes: [
      {
        id: 'GENERAL_STANDARD',
        name: 'Standard',
        efficiency: 1.0,
        energyPerHour: new Map([['ELECTRICITY_STORED', 0.1]]),
      },
      {
        id: 'GENERAL_MINIMAL',
        name: 'Minimal',
        efficiency: 0.8,
        energyPerHour: new Map(),
      },
    ],
  },
];

// ============================================
// CONSTANTS
// ============================================

/** Minimum bundle fraction (humanitarian floor) */
export const HUMANITARIAN_FLOOR = 0.6;

/** Vulnerability bonus factor */
export const VULNERABILITY_BONUS = 0.2;
