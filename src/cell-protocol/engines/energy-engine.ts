/**
 * Cell Protocol - Energy Engine
 *
 * Implementation of the Energy Resource Layer (PRD-09).
 * Manages energy stocks, stress calculation, and rationing.
 */

import {
  CellId,
  IdentityId,
  Timestamp,
  now,
  generateId,
} from '../types/common';
import { TaskCategory } from '../types/commitment';
import {
  EnergyCarrierId,
  EnergyCategory,
  EnergyCarrier,
  EnergyStock,
  EnergyFlow,
  EnergySource,
  EnergyConsumer,
  EnergyMode,
  TaskEnergyProfile,
  RationingPlan,
  MemberBundle,
  StockChangeRecord,
  StockChangeReason,
  ConsumptionRecord,
  WeeklyEnergyPlan,
  StressProjection,
  ProcurementAlert,
  EnergyState,
  EnergyError,
  EnergyErrorCode,
  IEnergyEngine,
  DEFAULT_CARRIERS,
  DEFAULT_TASK_PROFILES,
  HUMANITARIAN_FLOOR,
  VULNERABILITY_BONUS,
} from '../types/energy';
import { LedgerEngine } from './ledger-engine';
import { SchedulerEngine } from './scheduler-engine';
import { IStorage } from '../storage/pouchdb-adapter';

// ============================================
// ENERGY ENGINE IMPLEMENTATION
// ============================================

export class EnergyEngine implements IEnergyEngine {
  private cellId: CellId;
  private ledger: LedgerEngine;
  private scheduler?: SchedulerEngine;
  private storage: IStorage;

  private carriers: EnergyCarrier[];
  private stocks: Map<EnergyCarrierId, EnergyStock>;
  private taskProfiles: TaskEnergyProfile[];
  private selectedModes: Map<TaskCategory, string>;
  private stressIndex: number = 0;

  // Caches for flow history
  private flowHistory: Map<EnergyCarrierId, EnergyFlow[]> = new Map();

  constructor(
    cellId: CellId,
    ledger: LedgerEngine,
    storage: IStorage,
    carriers?: EnergyCarrier[],
    taskProfiles?: TaskEnergyProfile[]
  ) {
    this.cellId = cellId;
    this.ledger = ledger;
    this.storage = storage;

    // Initialize with defaults or provided carriers
    this.carriers = carriers ?? [...DEFAULT_CARRIERS];
    this.taskProfiles = taskProfiles ?? this.cloneTaskProfiles(DEFAULT_TASK_PROFILES);

    // Initialize stocks to zero for all carriers
    this.stocks = new Map();
    for (const carrier of this.carriers) {
      this.stocks.set(carrier.id, {
        carrierId: carrier.id,
        currentAmount: 0,
        unit: carrier.unit,
        lastRestocked: now(),
      });
    }

    // Initialize mode selections to first mode for each profile
    this.selectedModes = new Map();
    for (const profile of this.taskProfiles) {
      if (profile.energyModes.length > 0) {
        this.selectedModes.set(profile.taskCategory, profile.energyModes[0].id);
      }
    }
  }

  /** Set the scheduler engine (for task hour calculations) */
  setSchedulerEngine(scheduler: SchedulerEngine): void {
    this.scheduler = scheduler;
  }

  // ============================================
  // STOCK MANAGEMENT
  // ============================================

  getStocks(): Map<EnergyCarrierId, EnergyStock> {
    return new Map(this.stocks);
  }

  getStock(carrierId: EnergyCarrierId): EnergyStock | null {
    const stock = this.stocks.get(carrierId);
    return stock ? { ...stock } : null;
  }

  async recordStockChange(
    change: Omit<StockChangeRecord, 'id' | 'cellId' | 'timestamp'>
  ): Promise<void> {
    const carrier = this.carriers.find(c => c.id === change.carrierId);
    if (!carrier) {
      throw new EnergyValidationError({
        code: EnergyErrorCode.CARRIER_NOT_FOUND,
        message: `Carrier ${change.carrierId} not found`,
      });
    }

    const stock = this.stocks.get(change.carrierId);
    if (!stock) {
      throw new EnergyValidationError({
        code: EnergyErrorCode.STOCK_NOT_FOUND,
        message: `Stock for carrier ${change.carrierId} not found`,
      });
    }

    // Validate we have enough for negative changes
    if (change.delta < 0 && stock.currentAmount + change.delta < 0) {
      throw new EnergyValidationError({
        code: EnergyErrorCode.INSUFFICIENT_STOCK,
        message: `Insufficient stock for carrier ${change.carrierId}: have ${stock.currentAmount}, need ${Math.abs(change.delta)}`,
      });
    }

    // Apply change
    stock.currentAmount += change.delta;
    if (change.delta > 0) {
      stock.lastRestocked = now();
    }

    // Update projected depletion
    stock.projectedDepletionDate = this.projectDepletion(change.carrierId) ?? undefined;

    // Save record
    const record: StockChangeRecord = {
      id: generateId(),
      cellId: this.cellId,
      timestamp: now(),
      ...change,
    };
    await this.storage.saveStockChange(record);

    // Update flow history
    this.updateFlowHistory(change.carrierId, change.delta, change.source);

    // Recalculate stress
    this.stressIndex = this.calculateEnergyStress();

    await this.saveState();

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'ENERGY_STOCK_CHANGE',
      timestamp: now(),
      data: {
        carrierId: change.carrierId,
        delta: change.delta,
        reason: change.reason,
        newAmount: stock.currentAmount,
      },
    });
  }

  async recordConsumption(
    record: Omit<ConsumptionRecord, 'id' | 'cellId' | 'timestamp'>
  ): Promise<void> {
    // Validate carrier exists
    if (!this.carriers.find(c => c.id === record.carrierId)) {
      throw new EnergyValidationError({
        code: EnergyErrorCode.CARRIER_NOT_FOUND,
        message: `Carrier ${record.carrierId} not found`,
      });
    }

    // Record as negative stock change
    await this.recordStockChange({
      carrierId: record.carrierId,
      delta: -record.amount,
      reason: StockChangeReason.TASK_CONSUMPTION,
      source: `task:${record.taskCategory}`,
    });

    // Save consumption record
    const fullRecord: ConsumptionRecord = {
      id: generateId(),
      cellId: this.cellId,
      timestamp: now(),
      ...record,
    };
    await this.storage.saveConsumptionRecord(fullRecord);
  }

  private updateFlowHistory(
    carrierId: EnergyCarrierId,
    delta: number,
    source?: string
  ): void {
    if (!this.flowHistory.has(carrierId)) {
      this.flowHistory.set(carrierId, []);
    }

    const flows = this.flowHistory.get(carrierId)!;
    const currentTime = now();
    const weekStart = this.getWeekStart(currentTime);
    const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;

    // Find or create flow for current week
    let currentFlow = flows.find(
      f => f.period.start === weekStart && f.period.end === weekEnd
    );

    if (!currentFlow) {
      currentFlow = {
        carrierId,
        period: { start: weekStart, end: weekEnd },
        inflow: 0,
        outflow: 0,
        sources: [],
        consumers: [],
      };
      flows.push(currentFlow);
    }

    if (delta > 0) {
      currentFlow.inflow += delta;
      currentFlow.sources.push({
        name: source ?? 'unknown',
        amount: delta,
        timestamp: currentTime,
      });
    } else {
      currentFlow.outflow += Math.abs(delta);
      currentFlow.consumers.push({
        name: source ?? 'unknown',
        amount: Math.abs(delta),
        timestamp: currentTime,
      });
    }
  }

  // ============================================
  // CARRIERS & PROFILES
  // ============================================

  getCarriers(): EnergyCarrier[] {
    return [...this.carriers];
  }

  getEnergyProfile(category: TaskCategory): TaskEnergyProfile | null {
    const profile = this.taskProfiles.find(p => p.taskCategory === category);
    if (!profile) return null;
    return {
      ...profile,
      energyModes: profile.energyModes.map(m => ({
        ...m,
        energyPerHour: new Map(m.energyPerHour),
      })),
    };
  }

  // ============================================
  // MODE SELECTION & PLANNING
  // ============================================

  setModeSelection(category: TaskCategory, modeId: string): void {
    const profile = this.taskProfiles.find(p => p.taskCategory === category);
    if (!profile) {
      throw new EnergyValidationError({
        code: EnergyErrorCode.PROFILE_NOT_FOUND,
        message: `Energy profile for ${category} not found`,
      });
    }

    const mode = profile.energyModes.find(m => m.id === modeId);
    if (!mode) {
      throw new EnergyValidationError({
        code: EnergyErrorCode.MODE_NOT_FOUND,
        message: `Mode ${modeId} not found for category ${category}`,
      });
    }

    this.selectedModes.set(category, modeId);
  }

  getSelectedMode(category: TaskCategory): string | null {
    return this.selectedModes.get(category) ?? null;
  }

  generateWeeklyPlan(): WeeklyEnergyPlan {
    const weekStart = this.getWeekStart(now());
    const memberCount = this.ledger.getStatistics().memberCount;

    // Calculate required consumption by carrier based on selected modes
    const requiredByCarrier = new Map<EnergyCarrierId, number>();
    const projectedConsumption = new Map<EnergyCarrierId, number>();

    for (const profile of this.taskProfiles) {
      const selectedModeId = this.selectedModes.get(profile.taskCategory);
      const mode = profile.energyModes.find(m => m.id === selectedModeId);
      if (!mode) continue;

      // Estimate weekly hours for this task category (default: 20h/week * members)
      const weeklyHours = this.getEstimatedWeeklyHours(profile.taskCategory, memberCount);

      // Add energy requirements
      for (const [carrierId, perHour] of mode.energyPerHour) {
        const required = perHour * weeklyHours;
        const current = requiredByCarrier.get(carrierId) ?? 0;
        requiredByCarrier.set(carrierId, current + required);
        projectedConsumption.set(carrierId, current + required);
      }
    }

    // Get available by carrier
    const availableByCarrier = new Map<EnergyCarrierId, number>();
    for (const [carrierId, stock] of this.stocks) {
      availableByCarrier.set(carrierId, stock.currentAmount);
    }

    // Calculate stress
    const stressIndex = this.calculateStressFromMaps(requiredByCarrier, availableByCarrier);

    // Generate bundles
    const bundles = this.generateBundles(availableByCarrier, requiredByCarrier);

    const plan: WeeklyEnergyPlan = {
      cellId: this.cellId,
      weekStart,
      projectedConsumption,
      requiredByCarrier,
      availableByCarrier,
      selectedModes: new Map(this.selectedModes),
      stressIndex,
      feasible: stressIndex <= 1.0,
      bundles,
      createdAt: now(),
    };

    return plan;
  }

  private getEstimatedWeeklyHours(category: TaskCategory, memberCount: number): number {
    // Base estimates per member per week
    const baseHours: Record<TaskCategory, number> = {
      [TaskCategory.FOOD]: 3,
      [TaskCategory.WATER_SANITATION]: 1,
      [TaskCategory.ENERGY_HEAT]: 2,
      [TaskCategory.SHELTER_REPAIR]: 0.5,
      [TaskCategory.MEDICAL]: 0.5,
      [TaskCategory.CHILDCARE_DEPENDENT]: 2,
      [TaskCategory.SECURITY_COORDINATION]: 1,
      [TaskCategory.PROCUREMENT_TRANSPORT]: 1,
      [TaskCategory.GENERAL]: 1,
    };

    return (baseHours[category] ?? 1) * Math.max(1, memberCount);
  }

  // ============================================
  // STRESS CALCULATION
  // ============================================

  calculateEnergyStress(): number {
    const plan = this.generateWeeklyPlan();
    return plan.stressIndex;
  }

  private calculateStressFromMaps(
    required: Map<EnergyCarrierId, number>,
    available: Map<EnergyCarrierId, number>
  ): number {
    // S_E = max_j(required_j / available_j)
    let maxStress = 0;

    for (const [carrierId, requiredAmount] of required) {
      if (requiredAmount <= 0) continue;

      const availableAmount = available.get(carrierId) ?? 0;
      if (availableAmount <= 0) {
        // If we need something and have none, stress is infinite
        return Infinity;
      }

      const stress = requiredAmount / availableAmount;
      maxStress = Math.max(maxStress, stress);
    }

    return maxStress;
  }

  getStressIndex(): number {
    return this.stressIndex;
  }

  projectStress(daysAhead: number): StressProjection {
    const projectedStress: number[] = [];
    const recommendations: string[] = [];
    let daysUntilCrisis: number | undefined;

    const plan = this.generateWeeklyPlan();
    const dailyConsumption = new Map<EnergyCarrierId, number>();

    // Calculate daily consumption rate
    for (const [carrierId, weeklyAmount] of plan.projectedConsumption) {
      dailyConsumption.set(carrierId, weeklyAmount / 7);
    }

    // Project stress for each day
    const currentStocks = new Map(this.stocks);
    for (let day = 0; day < daysAhead; day++) {
      // Reduce stocks by daily consumption
      for (const [carrierId, dailyRate] of dailyConsumption) {
        const stock = currentStocks.get(carrierId);
        if (stock) {
          stock.currentAmount = Math.max(0, stock.currentAmount - dailyRate);
        }
      }

      // Calculate stress for this day
      const available = new Map<EnergyCarrierId, number>();
      for (const [carrierId, stock] of currentStocks) {
        available.set(carrierId, stock.currentAmount);
      }

      const stress = this.calculateStressFromMaps(plan.requiredByCarrier, available);
      projectedStress.push(stress);

      if (stress > 1.0 && daysUntilCrisis === undefined) {
        daysUntilCrisis = day + 1;
      }
    }

    // Generate recommendations
    if (daysUntilCrisis !== undefined) {
      recommendations.push(`Energy crisis projected in ${daysUntilCrisis} days`);
      recommendations.push('Consider mode substitution or procurement');
    }

    for (const [carrierId, stock] of this.stocks) {
      const dailyRate = dailyConsumption.get(carrierId) ?? 0;
      if (dailyRate > 0 && stock.currentAmount / dailyRate < 7) {
        recommendations.push(`Low stock: ${carrierId} will deplete in ${Math.round(stock.currentAmount / dailyRate)} days`);
      }
    }

    return {
      daysAhead,
      projectedStress,
      daysUntilCrisis,
      recommendations,
    };
  }

  // ============================================
  // RATIONING
  // ============================================

  computeRationingPlan(targetStress: number): RationingPlan {
    const plan = this.generateWeeklyPlan();
    const currentStress = plan.stressIndex;

    if (currentStress <= targetStress) {
      return {
        targetStress,
        bundleReductionFactor: 1.0,
        taskReductions: new Map(),
        modeSubstitutions: new Map(),
        additionalProcurement: new Map(),
        feasible: true,
        explanation: 'No rationing needed - already below target stress',
      };
    }

    // Strategy 1: Mode substitution
    const modeSubstitutions = new Map<TaskCategory, string>();
    let newRequired = new Map(plan.requiredByCarrier);

    for (const profile of this.taskProfiles) {
      const currentModeId = this.selectedModes.get(profile.taskCategory);
      const currentMode = profile.energyModes.find(m => m.id === currentModeId);
      if (!currentMode) continue;

      // Try more efficient modes (lower energy, possibly lower effectiveness)
      for (const mode of profile.energyModes) {
        if (mode.id === currentModeId) continue;

        // Calculate if this mode uses less of scarce resources
        let saves = false;
        for (const [carrierId, currentPerHour] of currentMode.energyPerHour) {
          const newPerHour = mode.energyPerHour.get(carrierId) ?? 0;
          if (newPerHour < currentPerHour) {
            saves = true;
            break;
          }
        }

        if (saves) {
          modeSubstitutions.set(profile.taskCategory, mode.id);
          // Update required amounts
          const weeklyHours = this.getEstimatedWeeklyHours(
            profile.taskCategory,
            this.ledger.getStatistics().memberCount
          );

          // Remove old requirements
          for (const [carrierId, perHour] of currentMode.energyPerHour) {
            const current = newRequired.get(carrierId) ?? 0;
            newRequired.set(carrierId, current - perHour * weeklyHours);
          }

          // Add new requirements
          for (const [carrierId, perHour] of mode.energyPerHour) {
            const current = newRequired.get(carrierId) ?? 0;
            newRequired.set(carrierId, current + perHour * weeklyHours);
          }
          break;
        }
      }
    }

    // Recalculate stress after substitutions
    let newStress = this.calculateStressFromMaps(newRequired, plan.availableByCarrier);

    if (newStress <= targetStress) {
      return {
        targetStress,
        bundleReductionFactor: 1.0,
        taskReductions: new Map(),
        modeSubstitutions,
        additionalProcurement: new Map(),
        feasible: true,
        explanation: 'Mode substitution achieves target stress',
      };
    }

    // Strategy 2: Calculate procurement needs
    const additionalProcurement = new Map<EnergyCarrierId, number>();
    for (const [carrierId, required] of newRequired) {
      const available = plan.availableByCarrier.get(carrierId) ?? 0;
      if (required > available * targetStress) {
        const needed = required / targetStress - available;
        additionalProcurement.set(carrierId, Math.ceil(needed));
      }
    }

    // Strategy 3: Bundle reduction
    // y = min(1, available / required) for worst carrier
    let bundleReductionFactor = 1.0;
    for (const [carrierId, required] of newRequired) {
      if (required <= 0) continue;
      const available = plan.availableByCarrier.get(carrierId) ?? 0;
      const factor = available / required;
      bundleReductionFactor = Math.min(bundleReductionFactor, factor);
    }

    // Don't go below humanitarian floor
    bundleReductionFactor = Math.max(HUMANITARIAN_FLOOR, bundleReductionFactor);

    // Recalculate with procurement
    const availableWithProcurement = new Map(plan.availableByCarrier);
    for (const [carrierId, amount] of additionalProcurement) {
      const current = availableWithProcurement.get(carrierId) ?? 0;
      availableWithProcurement.set(carrierId, current + amount);
    }

    newStress = this.calculateStressFromMaps(newRequired, availableWithProcurement);

    return {
      targetStress,
      bundleReductionFactor,
      taskReductions: new Map(), // Could be expanded to reduce specific tasks
      modeSubstitutions,
      additionalProcurement,
      feasible: newStress <= targetStress,
      explanation: newStress <= targetStress
        ? 'Rationing plan achieves target stress'
        : `Best achievable stress is ${newStress.toFixed(2)} with current measures`,
    };
  }

  async applyRationingPlan(plan: RationingPlan): Promise<void> {
    // Apply mode substitutions
    for (const [category, modeId] of plan.modeSubstitutions) {
      this.setModeSelection(category, modeId);
    }

    // Note: Procurement and bundle reduction would be handled externally
    // This engine just tracks the plan

    await this.saveState();

    await this.storage.appendEvent({
      cellId: this.cellId,
      type: 'RATIONING_PLAN_APPLIED',
      timestamp: now(),
      data: {
        targetStress: plan.targetStress,
        bundleReductionFactor: plan.bundleReductionFactor,
        modeSubstitutions: Object.fromEntries(plan.modeSubstitutions),
        feasible: plan.feasible,
      },
    });
  }

  getBundleDistribution(): MemberBundle[] {
    const plan = this.generateWeeklyPlan();
    return plan.bundles;
  }

  private generateBundles(
    available: Map<EnergyCarrierId, number>,
    required: Map<EnergyCarrierId, number>
  ): MemberBundle[] {
    const members = this.ledger.getAllMemberStates();
    const memberCount = members.size;
    if (memberCount === 0) return [];

    // Calculate base bundle fraction
    let baseFraction = 1.0;
    for (const [carrierId, requiredAmount] of required) {
      if (requiredAmount <= 0) continue;
      const availableAmount = available.get(carrierId) ?? 0;
      const factor = availableAmount / requiredAmount;
      baseFraction = Math.min(baseFraction, factor);
    }

    // Apply humanitarian floor
    baseFraction = Math.max(HUMANITARIAN_FLOOR, Math.min(1.0, baseFraction));

    const bundles: MemberBundle[] = [];

    for (const [memberId, memberState] of members) {
      // Determine vulnerability (simplified: members at debt floor are vulnerable)
      const isVulnerable = memberState.balance <= -memberState.limit * 0.8;

      // Apply vulnerability bonus
      const bundleFraction = Math.min(
        1.0,
        baseFraction * (1 + (isVulnerable ? VULNERABILITY_BONUS : 0))
      );

      // Calculate allocation
      const energyAllocation = new Map<EnergyCarrierId, number>();
      for (const [carrierId, availableAmount] of available) {
        const perMember = availableAmount / memberCount;
        energyAllocation.set(carrierId, perMember * bundleFraction);
      }

      bundles.push({
        memberId,
        bundleFraction,
        energyAllocation,
        isVulnerable,
      });
    }

    return bundles;
  }

  // ============================================
  // HISTORY & PROJECTIONS
  // ============================================

  getFlowHistory(carrierId: EnergyCarrierId, since: Timestamp): EnergyFlow[] {
    const flows = this.flowHistory.get(carrierId) ?? [];
    return flows
      .filter(f => f.period.end >= since)
      .map(f => ({ ...f }));
  }

  projectDepletion(carrierId: EnergyCarrierId): Timestamp | null {
    const stock = this.stocks.get(carrierId);
    if (!stock || stock.currentAmount <= 0) return null;

    // Get recent consumption rate
    const weekAgo = now() - 7 * 24 * 60 * 60 * 1000;
    const flows = this.flowHistory.get(carrierId) ?? [];
    const recentFlow = flows.find(f => f.period.end >= weekAgo);

    if (!recentFlow || recentFlow.outflow <= 0) {
      return null; // Can't project without consumption data
    }

    const dailyRate = recentFlow.outflow / 7;
    if (dailyRate <= 0) return null;

    const daysUntilDepletion = stock.currentAmount / dailyRate;
    return now() + daysUntilDepletion * 24 * 60 * 60 * 1000;
  }

  generateProcurementAlerts(): ProcurementAlert[] {
    const alerts: ProcurementAlert[] = [];
    const plan = this.generateWeeklyPlan();

    for (const [carrierId, stock] of this.stocks) {
      const required = plan.requiredByCarrier.get(carrierId) ?? 0;
      if (required <= 0) continue;

      const dailyRate = required / 7;
      if (dailyRate <= 0) continue;

      const daysUntilDepletion = stock.currentAmount / dailyRate;

      let priority: 1 | 2 | 3;
      let message: string;

      if (daysUntilDepletion < 3) {
        priority = 1;
        message = `URGENT: ${carrierId} will deplete in ${Math.round(daysUntilDepletion)} days`;
      } else if (daysUntilDepletion < 7) {
        priority = 2;
        message = `${carrierId} running low - ${Math.round(daysUntilDepletion)} days remaining`;
      } else if (daysUntilDepletion < 14) {
        priority = 3;
        message = `Monitor ${carrierId} - ${Math.round(daysUntilDepletion)} days remaining`;
      } else {
        continue; // No alert needed
      }

      // Recommend at least 2 weeks supply
      const recommendedAmount = dailyRate * 14 - stock.currentAmount;

      if (recommendedAmount > 0) {
        alerts.push({
          carrierId,
          currentStock: stock.currentAmount,
          daysUntilDepletion,
          recommendedAmount: Math.ceil(recommendedAmount),
          priority,
          message,
        });
      }
    }

    return alerts.sort((a, b) => a.priority - b.priority);
  }

  // ============================================
  // TASK SUPPORT
  // ============================================

  canCompleteTask(category: TaskCategory, hours: number): boolean {
    const profile = this.taskProfiles.find(p => p.taskCategory === category);
    if (!profile) return true; // No profile means no energy requirement

    const selectedModeId = this.selectedModes.get(category);
    const mode = profile.energyModes.find(m => m.id === selectedModeId);
    if (!mode) return true;

    // Check if we have enough of each required carrier
    for (const [carrierId, perHour] of mode.energyPerHour) {
      const required = perHour * hours;
      const stock = this.stocks.get(carrierId);
      if (!stock || stock.currentAmount < required) {
        return false;
      }
    }

    return true;
  }

  // ============================================
  // PERSISTENCE
  // ============================================

  private async saveState(): Promise<void> {
    const state: EnergyState = {
      cellId: this.cellId,
      carriers: this.carriers,
      stocks: new Map(this.stocks),
      selectedModes: new Map(this.selectedModes),
      taskProfiles: this.cloneTaskProfiles(this.taskProfiles),
      stressIndex: this.stressIndex,
      lastCalculated: now(),
      createdAt: now(),
      updatedAt: now(),
    };

    const result = await this.storage.saveEnergyState(state);
    if (!result.ok) {
      throw new EnergyValidationError({
        code: EnergyErrorCode.STORAGE_ERROR,
        message: result.error.message,
      });
    }
  }

  async loadState(): Promise<void> {
    const result = await this.storage.getEnergyState(this.cellId);
    if (result.ok && result.value) {
      const state = result.value;
      this.carriers = state.carriers;
      this.stocks = new Map(state.stocks);
      this.selectedModes = new Map(state.selectedModes);
      this.taskProfiles = this.cloneTaskProfiles(state.taskProfiles);
      this.stressIndex = state.stressIndex;
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  private getWeekStart(timestamp: Timestamp): Timestamp {
    const date = new Date(timestamp);
    const day = date.getDay();
    const diff = date.getDate() - day;
    date.setDate(diff);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  private cloneTaskProfiles(profiles: TaskEnergyProfile[]): TaskEnergyProfile[] {
    return profiles.map(p => ({
      ...p,
      energyModes: p.energyModes.map(m => ({
        ...m,
        energyPerHour: new Map(m.energyPerHour),
      })),
    }));
  }

  getCellId(): CellId {
    return this.cellId;
  }
}

// ============================================
// CUSTOM ERROR CLASS
// ============================================

export class EnergyValidationError extends Error {
  public readonly code: EnergyErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(error: EnergyError) {
    super(error.message);
    this.name = 'EnergyValidationError';
    this.code = error.code;
    this.details = error.details;
  }

  toJSON(): EnergyError {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

// ============================================
// FACTORY
// ============================================

/**
 * Create a new energy engine
 */
export function createEnergyEngine(
  cellId: CellId,
  ledger: LedgerEngine,
  storage: IStorage,
  carriers?: EnergyCarrier[],
  taskProfiles?: TaskEnergyProfile[]
): EnergyEngine {
  return new EnergyEngine(cellId, ledger, storage, carriers, taskProfiles);
}

/**
 * Create energy engine and wire with scheduler
 */
export async function createEnergyEngineWithScheduler(
  cellId: CellId,
  ledger: LedgerEngine,
  scheduler: SchedulerEngine,
  storage: IStorage,
  carriers?: EnergyCarrier[],
  taskProfiles?: TaskEnergyProfile[]
): Promise<EnergyEngine> {
  const engine = new EnergyEngine(cellId, ledger, storage, carriers, taskProfiles);
  engine.setSchedulerEngine(scheduler);
  await engine.loadState();
  return engine;
}
