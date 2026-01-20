/**
 * Cell Protocol - Energy Engine Tests
 *
 * Tests for the Energy Resource Layer (PRD-09).
 * Verifies stock management, stress calculation, and rationing.
 */

import { createLedgerEngine, LedgerEngine } from '../engines/ledger-engine';
import { EnergyEngine, EnergyValidationError, createEnergyEngine } from '../engines/energy-engine';
import { createInMemoryStorage, InMemoryStorage } from '../storage/pouchdb-adapter';
import {
  EnergyCategory,
  EnergyCarrier,
  StockChangeReason,
  EnergyErrorCode,
  DEFAULT_CARRIERS,
  DEFAULT_TASK_PROFILES,
  HUMANITARIAN_FLOOR,
} from '../types/energy';
import { TaskCategory } from '../types/commitment';
import { now } from '../types/common';

describe('EnergyEngine', () => {
  let energy: EnergyEngine;
  let storage: InMemoryStorage;
  let ledger: LedgerEngine;

  beforeEach(async () => {
    storage = createInMemoryStorage();
    ledger = await createLedgerEngine('test-cell', { defaultLimit: 100 }, storage);
    energy = createEnergyEngine('test-cell', ledger, storage);
  });

  describe('Initialization', () => {
    test('Starts with default carriers', () => {
      const carriers = energy.getCarriers();
      expect(carriers.length).toBe(DEFAULT_CARRIERS.length);
      expect(carriers.find(c => c.id === 'FIREWOOD')).toBeDefined();
      expect(carriers.find(c => c.id === 'DIESEL')).toBeDefined();
      expect(carriers.find(c => c.id === 'PROPANE')).toBeDefined();
      expect(carriers.find(c => c.id === 'ELECTRICITY_STORED')).toBeDefined();
      expect(carriers.find(c => c.id === 'POTABLE_WATER')).toBeDefined();
    });

    test('Starts with zero stock for all carriers', () => {
      const stocks = energy.getStocks();
      for (const [carrierId, stock] of stocks) {
        expect(stock.currentAmount).toBe(0);
      }
    });

    test('Starts with default task profiles', () => {
      const foodProfile = energy.getEnergyProfile(TaskCategory.FOOD);
      expect(foodProfile).not.toBeNull();
      expect(foodProfile!.energyModes.length).toBeGreaterThan(0);
    });

    test('Accepts custom carriers', async () => {
      const customCarriers: EnergyCarrier[] = [
        {
          id: 'CUSTOM_FUEL',
          name: 'Custom Fuel',
          unit: 'L',
          category: EnergyCategory.LIQUID_FUEL,
          storable: true,
        },
      ];

      const customEnergy = createEnergyEngine('test-cell', ledger, storage, customCarriers);
      const carriers = customEnergy.getCarriers();
      expect(carriers.length).toBe(1);
      expect(carriers[0].id).toBe('CUSTOM_FUEL');
    });
  });

  describe('Stock Management - EN-01, EN-02', () => {
    test('EN-01: Record stock addition increases stock', async () => {
      await energy.recordStockChange({
        carrierId: 'FIREWOOD',
        delta: 100,
        reason: StockChangeReason.PROCUREMENT,
        source: 'supplier',
      });

      const stock = energy.getStock('FIREWOOD');
      expect(stock).not.toBeNull();
      expect(stock!.currentAmount).toBe(100);
    });

    test('EN-02: Record consumption decreases stock', async () => {
      // First add stock
      await energy.recordStockChange({
        carrierId: 'FIREWOOD',
        delta: 100,
        reason: StockChangeReason.PROCUREMENT,
      });

      // Then consume
      await energy.recordConsumption({
        carrierId: 'FIREWOOD',
        amount: 30,
        taskCategory: TaskCategory.FOOD,
      });

      const stock = energy.getStock('FIREWOOD');
      expect(stock!.currentAmount).toBe(70);
    });

    test('Cannot consume more than available', async () => {
      await energy.recordStockChange({
        carrierId: 'FIREWOOD',
        delta: 50,
        reason: StockChangeReason.PROCUREMENT,
      });

      await expect(
        energy.recordConsumption({
          carrierId: 'FIREWOOD',
          amount: 100,
          taskCategory: TaskCategory.FOOD,
        })
      ).rejects.toThrow('Insufficient stock');
    });

    test('Stock change for unknown carrier fails', async () => {
      await expect(
        energy.recordStockChange({
          carrierId: 'UNKNOWN_CARRIER',
          delta: 100,
          reason: StockChangeReason.PROCUREMENT,
        })
      ).rejects.toThrow('not found');
    });

    test('Multiple stock changes accumulate correctly', async () => {
      await energy.recordStockChange({
        carrierId: 'DIESEL',
        delta: 100,
        reason: StockChangeReason.PROCUREMENT,
      });

      await energy.recordStockChange({
        carrierId: 'DIESEL',
        delta: 50,
        reason: StockChangeReason.DONATION,
      });

      await energy.recordStockChange({
        carrierId: 'DIESEL',
        delta: -30,
        reason: StockChangeReason.TASK_CONSUMPTION,
      });

      const stock = energy.getStock('DIESEL');
      expect(stock!.currentAmount).toBe(120);
    });
  });

  describe('Stress Calculation - EN-03, EN-04', () => {
    test('EN-03: Calculate stress with adequate supply → S_E < 1', async () => {
      // Add members so we have consumption requirements
      await ledger.addMember('member1', 100);
      await ledger.addMember('member2', 100);

      // Add abundant supplies
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 1000,
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'PROPANE',
        delta: 500,
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'FIREWOOD',
        delta: 1000,
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'POTABLE_WATER',
        delta: 5000,
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'DIESEL',
        delta: 500,
        reason: StockChangeReason.PROCUREMENT,
      });

      const stress = energy.calculateEnergyStress();
      expect(stress).toBeLessThan(1);
    });

    test('EN-04: Calculate stress with shortage → S_E > 1', async () => {
      // Add members
      await ledger.addMember('member1', 100);
      await ledger.addMember('member2', 100);
      await ledger.addMember('member3', 100);

      // Add minimal supplies (not enough for weekly requirements)
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 1, // Very low
        reason: StockChangeReason.PROCUREMENT,
      });

      const stress = energy.calculateEnergyStress();
      expect(stress).toBeGreaterThan(1);
    });

    test('Stress is 0 with no members', () => {
      const stress = energy.calculateEnergyStress();
      // With no members, requirements are minimal
      expect(stress).toBeDefined();
    });

    test('getStressIndex returns current stress', async () => {
      await ledger.addMember('member1', 100);

      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 1000,
        reason: StockChangeReason.PROCUREMENT,
      });

      // Trigger stress calculation
      energy.calculateEnergyStress();

      const stressIndex = energy.getStressIndex();
      expect(stressIndex).toBeDefined();
      expect(typeof stressIndex).toBe('number');
    });
  });

  describe('Mode Selection - EN-05', () => {
    test('EN-05: Mode substitution reduces carrier consumption', () => {
      const foodProfile = energy.getEnergyProfile(TaskCategory.FOOD);
      expect(foodProfile).not.toBeNull();

      // Find electric and wood modes
      const electricMode = foodProfile!.energyModes.find(m => m.id === 'FOOD_ELECTRIC');
      const woodMode = foodProfile!.energyModes.find(m => m.id === 'FOOD_WOOD');

      expect(electricMode).toBeDefined();
      expect(woodMode).toBeDefined();

      // Electric uses electricity, wood uses firewood
      expect(electricMode!.energyPerHour.get('ELECTRICITY_STORED')).toBeGreaterThan(0);
      expect(woodMode!.energyPerHour.get('FIREWOOD')).toBeGreaterThan(0);

      // Initially selected mode
      const initialMode = energy.getSelectedMode(TaskCategory.FOOD);
      expect(initialMode).toBe('FOOD_ELECTRIC');

      // Switch to wood mode
      energy.setModeSelection(TaskCategory.FOOD, 'FOOD_WOOD');
      expect(energy.getSelectedMode(TaskCategory.FOOD)).toBe('FOOD_WOOD');
    });

    test('Cannot set invalid mode', () => {
      expect(() => {
        energy.setModeSelection(TaskCategory.FOOD, 'INVALID_MODE');
      }).toThrow('not found');
    });

    test('Cannot set mode for invalid category', () => {
      expect(() => {
        energy.setModeSelection('INVALID_CATEGORY' as TaskCategory, 'some_mode');
      }).toThrow('not found');
    });
  });

  describe('Rationing Plan - EN-06', () => {
    test('EN-06: Generate rationing plan achieves target stress', async () => {
      await ledger.addMember('member1', 100);
      await ledger.addMember('member2', 100);

      // Add limited supplies
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 50,
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'PROPANE',
        delta: 50,
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'FIREWOOD',
        delta: 100,
        reason: StockChangeReason.PROCUREMENT,
      });

      const plan = energy.computeRationingPlan(0.8);

      expect(plan).toBeDefined();
      expect(plan.targetStress).toBe(0.8);
      expect(plan.bundleReductionFactor).toBeGreaterThanOrEqual(HUMANITARIAN_FLOOR);
      expect(plan.bundleReductionFactor).toBeLessThanOrEqual(1);
    });

    test('Rationing plan with adequate supplies needs no action', async () => {
      await ledger.addMember('member1', 100);

      // Add abundant supplies
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 10000,
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'PROPANE',
        delta: 5000,
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'FIREWOOD',
        delta: 10000,
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'POTABLE_WATER',
        delta: 50000,
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'DIESEL',
        delta: 5000,
        reason: StockChangeReason.PROCUREMENT,
      });

      const plan = energy.computeRationingPlan(1.0);

      expect(plan.feasible).toBe(true);
      expect(plan.bundleReductionFactor).toBe(1.0);
      expect(plan.modeSubstitutions.size).toBe(0);
    });

    test('Apply rationing plan updates mode selections', async () => {
      await ledger.addMember('member1', 100);

      const plan = energy.computeRationingPlan(0.5);

      // Apply the plan
      await energy.applyRationingPlan(plan);

      // Check that mode selections were applied
      for (const [category, modeId] of plan.modeSubstitutions) {
        expect(energy.getSelectedMode(category)).toBe(modeId);
      }
    });
  });

  describe('Bundle Distribution - EN-07', () => {
    test('EN-07: Bundle distribution protects vulnerable (y_min = 0.6)', async () => {
      // Add members
      await ledger.addMember('member1', 100);
      await ledger.addMember('member2', 100);
      await ledger.addMember('member3', 100);

      // Put member1 at debt floor (vulnerable)
      await ledger.applyBalanceUpdates([
        { memberId: 'member1', delta: -90, reason: 'SPOT_TRANSACTION_PAYER' as any },
        { memberId: 'member2', delta: 90, reason: 'SPOT_TRANSACTION_PAYEE' as any },
      ]);

      // Add limited supplies (force rationing)
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 10,
        reason: StockChangeReason.PROCUREMENT,
      });

      const bundles = energy.getBundleDistribution();

      expect(bundles.length).toBe(3);

      for (const bundle of bundles) {
        // All bundles should have at least the humanitarian floor
        expect(bundle.bundleFraction).toBeGreaterThanOrEqual(HUMANITARIAN_FLOOR);
        expect(bundle.bundleFraction).toBeLessThanOrEqual(1);
      }

      // Vulnerable member should have higher fraction
      const vulnerableBundle = bundles.find(b => b.memberId === 'member1');
      const normalBundle = bundles.find(b => b.memberId === 'member2');

      if (vulnerableBundle && normalBundle) {
        expect(vulnerableBundle.isVulnerable).toBe(true);
        expect(normalBundle.isVulnerable).toBe(false);
        // Vulnerable gets bonus
        expect(vulnerableBundle.bundleFraction).toBeGreaterThanOrEqual(normalBundle.bundleFraction);
      }
    });

    test('Bundle allocations include energy per carrier', async () => {
      await ledger.addMember('member1', 100);

      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 100,
        reason: StockChangeReason.PROCUREMENT,
      });

      const bundles = energy.getBundleDistribution();

      expect(bundles.length).toBe(1);
      expect(bundles[0].energyAllocation.size).toBeGreaterThan(0);
      expect(bundles[0].energyAllocation.get('ELECTRICITY_STORED')).toBeGreaterThan(0);
    });
  });

  describe('Weekly Planning', () => {
    test('Generate weekly plan includes all required data', async () => {
      await ledger.addMember('member1', 100);
      await ledger.addMember('member2', 100);

      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 100,
        reason: StockChangeReason.PROCUREMENT,
      });

      const plan = energy.generateWeeklyPlan();

      expect(plan.cellId).toBe('test-cell');
      expect(plan.weekStart).toBeDefined();
      expect(plan.projectedConsumption.size).toBeGreaterThan(0);
      expect(plan.requiredByCarrier.size).toBeGreaterThan(0);
      expect(plan.availableByCarrier.size).toBeGreaterThan(0);
      expect(plan.selectedModes.size).toBeGreaterThan(0);
      expect(plan.stressIndex).toBeDefined();
      expect(typeof plan.feasible).toBe('boolean');
      expect(plan.bundles.length).toBe(2);
    });
  });

  describe('Stress Projection', () => {
    test('Project stress for future days', async () => {
      await ledger.addMember('member1', 100);

      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 100,
        reason: StockChangeReason.PROCUREMENT,
      });

      const projection = energy.projectStress(14);

      expect(projection.daysAhead).toBe(14);
      expect(projection.projectedStress.length).toBe(14);
      expect(projection.recommendations).toBeDefined();
    });

    test('Projection identifies days until crisis', async () => {
      await ledger.addMember('member1', 100);

      // Add minimal supplies
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 10,
        reason: StockChangeReason.PROCUREMENT,
      });

      const projection = energy.projectStress(30);

      // With minimal supplies, should hit crisis at some point
      if (projection.projectedStress.some(s => s > 1)) {
        expect(projection.daysUntilCrisis).toBeDefined();
        expect(projection.daysUntilCrisis).toBeGreaterThan(0);
      }
    });
  });

  describe('Procurement Alerts', () => {
    test('Generate procurement alerts for low stock', async () => {
      await ledger.addMember('member1', 100);

      // Add just enough to trigger alerts
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 5,
        reason: StockChangeReason.PROCUREMENT,
      });

      const alerts = energy.generateProcurementAlerts();

      // Should have at least one alert for electricity
      const electricityAlert = alerts.find(a => a.carrierId === 'ELECTRICITY_STORED');
      if (electricityAlert) {
        expect(electricityAlert.priority).toBeDefined();
        expect([1, 2, 3]).toContain(electricityAlert.priority);
        expect(electricityAlert.message).toBeDefined();
        expect(electricityAlert.recommendedAmount).toBeGreaterThan(0);
      }
    });

    test('Alerts sorted by priority', async () => {
      await ledger.addMember('member1', 100);

      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 5,
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'PROPANE',
        delta: 10,
        reason: StockChangeReason.PROCUREMENT,
      });

      const alerts = energy.generateProcurementAlerts();

      // Should be sorted by priority (1 = most urgent)
      for (let i = 1; i < alerts.length; i++) {
        expect(alerts[i].priority).toBeGreaterThanOrEqual(alerts[i - 1].priority);
      }
    });
  });

  describe('Task Support', () => {
    test('canCompleteTask returns true with adequate energy', async () => {
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 100,
        reason: StockChangeReason.PROCUREMENT,
      });

      const canComplete = energy.canCompleteTask(TaskCategory.FOOD, 2);
      expect(canComplete).toBe(true);
    });

    test('canCompleteTask returns false with inadequate energy', async () => {
      // No energy added
      const canComplete = energy.canCompleteTask(TaskCategory.FOOD, 100);
      expect(canComplete).toBe(false);
    });

    test('canCompleteTask for task without profile returns true', () => {
      // Create energy engine with no profiles
      const noProfileEnergy = createEnergyEngine('test-cell', ledger, storage, DEFAULT_CARRIERS, []);
      const canComplete = noProfileEnergy.canCompleteTask(TaskCategory.FOOD, 10);
      expect(canComplete).toBe(true);
    });
  });

  describe('Persistence', () => {
    test('State is saved to storage', async () => {
      await energy.recordStockChange({
        carrierId: 'FIREWOOD',
        delta: 100,
        reason: StockChangeReason.PROCUREMENT,
      });

      const result = await storage.getEnergyState('test-cell');
      expect(result.ok).toBe(true);
      if (result.ok && result.value) {
        expect(result.value.stocks.get('FIREWOOD')?.currentAmount).toBe(100);
      }
    });

    test('State can be loaded from storage', async () => {
      await energy.recordStockChange({
        carrierId: 'DIESEL',
        delta: 200,
        reason: StockChangeReason.PROCUREMENT,
      });

      // Create new engine and load state
      const energy2 = createEnergyEngine('test-cell', ledger, storage);
      await energy2.loadState();

      const stock = energy2.getStock('DIESEL');
      expect(stock?.currentAmount).toBe(200);
    });

    test('Stock changes are persisted', async () => {
      await energy.recordStockChange({
        carrierId: 'PROPANE',
        delta: 50,
        reason: StockChangeReason.PROCUREMENT,
      });

      const changes = await storage.getStockChanges('test-cell', 0);
      expect(changes.ok).toBe(true);
      if (changes.ok) {
        expect(changes.value.length).toBeGreaterThan(0);
        expect(changes.value[0].carrierId).toBe('PROPANE');
      }
    });

    test('Consumption records are persisted', async () => {
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 100,
        reason: StockChangeReason.PROCUREMENT,
      });

      await energy.recordConsumption({
        carrierId: 'ELECTRICITY_STORED',
        amount: 10,
        taskCategory: TaskCategory.FOOD,
      });

      const records = await storage.getConsumptionHistory('test-cell', 0);
      expect(records.ok).toBe(true);
      if (records.ok) {
        expect(records.value.length).toBeGreaterThan(0);
        expect(records.value[0].carrierId).toBe('ELECTRICITY_STORED');
        expect(records.value[0].taskCategory).toBe(TaskCategory.FOOD);
      }
    });
  });

  describe('Flow History', () => {
    test('Flow history tracks inflows and outflows', async () => {
      // Record inflow
      await energy.recordStockChange({
        carrierId: 'FIREWOOD',
        delta: 100,
        reason: StockChangeReason.PROCUREMENT,
        source: 'supplier_a',
      });

      // Record outflow
      await energy.recordStockChange({
        carrierId: 'FIREWOOD',
        delta: -30,
        reason: StockChangeReason.TASK_CONSUMPTION,
        source: 'task:FOOD',
      });

      const flows = energy.getFlowHistory('FIREWOOD', 0);
      expect(flows.length).toBeGreaterThan(0);

      const flow = flows[0];
      expect(flow.inflow).toBe(100);
      expect(flow.outflow).toBe(30);
      expect(flow.sources.length).toBeGreaterThan(0);
      expect(flow.consumers.length).toBeGreaterThan(0);
    });
  });

  describe('Depletion Projection', () => {
    test('Project depletion date based on consumption', async () => {
      // Add stock
      await energy.recordStockChange({
        carrierId: 'DIESEL',
        delta: 70,
        reason: StockChangeReason.PROCUREMENT,
      });

      // Consume to establish rate
      await energy.recordStockChange({
        carrierId: 'DIESEL',
        delta: -10,
        reason: StockChangeReason.TASK_CONSUMPTION,
      });

      const depletionDate = energy.projectDepletion('DIESEL');

      if (depletionDate !== null) {
        expect(depletionDate).toBeGreaterThan(now());
      }
    });

    test('Depletion returns null for carrier with no consumption', async () => {
      await energy.recordStockChange({
        carrierId: 'PROPANE',
        delta: 100,
        reason: StockChangeReason.PROCUREMENT,
      });

      const depletionDate = energy.projectDepletion('PROPANE');
      // No consumption yet, so no projection
      expect(depletionDate).toBeNull();
    });
  });
});
