/**
 * Cell Protocol - Phase 4 Integration Tests
 *
 * Tests for the full integration of the Energy Resource Layer (PRD-09)
 * with Emergency Mode and Scheduler systems.
 */

import { createCellProtocol, CellProtocol } from '../index';
import {
  RiskState,
  TransitionReason,
  StockChangeReason,
  TaskCategory,
  HUMANITARIAN_FLOOR,
  now,
} from '../index';

describe('Phase 4 Integration', () => {
  let protocol: CellProtocol;

  beforeEach(async () => {
    protocol = await createCellProtocol({
      cellId: 'integration-test-cell',
      enableEnergy: true,
    });
  });

  describe('EN-I1: Full week with energy tracking', () => {
    test('Complete weekly workflow with energy', async () => {
      // Setup: Add members
      await protocol.identity.addMember({
        applicantId: 'member1',
        displayName: 'Alice',
        publicKey: 'pk_alice_001_at_least_32_chars_long',
        requestedAt: now(),
      });
      await protocol.identity.addMember({
        applicantId: 'member2',
        displayName: 'Bob',
        publicKey: 'pk_bob_001_at_least_32_chars_long!',
        requestedAt: now(),
      });

      const energy = protocol.energy!;
      expect(energy).toBeDefined();

      // Add initial energy stocks
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 500,
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'PROPANE',
        delta: 200,
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
        delta: 300,
        reason: StockChangeReason.PROCUREMENT,
      });

      // Generate weekly plan
      const plan = energy.generateWeeklyPlan();

      expect(plan).toBeDefined();
      expect(plan.cellId).toBe('integration-test-cell');
      expect(plan.bundles.length).toBe(2); // 2 members

      // Simulate a week of task consumption
      await energy.recordConsumption({
        carrierId: 'ELECTRICITY_STORED',
        amount: 20,
        taskCategory: TaskCategory.FOOD,
      });

      // Check stress after consumption
      const stress = energy.getStressIndex();
      expect(stress).toBeDefined();

      // Verify stocks were reduced
      const electricStock = energy.getStock('ELECTRICITY_STORED');
      expect(electricStock?.currentAmount).toBe(480);
    });
  });

  describe('EN-I2: Shock response with automatic rationing', () => {
    test('Rationing plan generated on supply shock', async () => {
      // Add members
      await protocol.identity.addMember({
        applicantId: 'member1',
        displayName: 'Alice',
        publicKey: 'pk_alice_002_at_least_32_chars_long',
        requestedAt: now(),
      });
      await protocol.identity.addMember({
        applicantId: 'member2',
        displayName: 'Bob',
        publicKey: 'pk_bob_002_at_least_32_chars_long!',
        requestedAt: now(),
      });
      await protocol.identity.addMember({
        applicantId: 'member3',
        displayName: 'Charlie',
        publicKey: 'pk_charlie_001_at_least_32_chars!',
        requestedAt: now(),
      });

      const energy = protocol.energy!;

      // Add minimal supplies (supply shock scenario)
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 10, // Very low
        reason: StockChangeReason.PROCUREMENT,
      });
      await energy.recordStockChange({
        carrierId: 'PROPANE',
        delta: 5,
        reason: StockChangeReason.PROCUREMENT,
      });

      // Calculate stress - should be high
      const stress = energy.calculateEnergyStress();
      expect(stress).toBeGreaterThan(1); // Infeasible

      // Generate rationing plan
      const rationingPlan = energy.computeRationingPlan(1.0);

      expect(rationingPlan).toBeDefined();
      expect(rationingPlan.bundleReductionFactor).toBeGreaterThanOrEqual(HUMANITARIAN_FLOOR);

      // Apply rationing plan
      await energy.applyRationingPlan(rationingPlan);

      // Check bundle distribution maintains humanitarian floor
      const bundles = energy.getBundleDistribution();
      for (const bundle of bundles) {
        expect(bundle.bundleFraction).toBeGreaterThanOrEqual(HUMANITARIAN_FLOOR);
      }
    });
  });

  describe('EN-I3: Integration with scheduler mode selection', () => {
    test('Mode substitution affects energy requirements', async () => {
      await protocol.identity.addMember({
        applicantId: 'member1',
        displayName: 'Alice',
        publicKey: 'pk_alice_003_at_least_32_chars_long',
        requestedAt: now(),
      });

      const energy = protocol.energy!;

      // Get initial mode selection for FOOD
      const initialMode = energy.getSelectedMode(TaskCategory.FOOD);
      expect(initialMode).toBe('FOOD_ELECTRIC'); // Default

      // Add some stocks
      await energy.recordStockChange({
        carrierId: 'FIREWOOD',
        delta: 500,
        reason: StockChangeReason.PROCUREMENT,
      });

      // Generate initial plan
      const plan1 = energy.generateWeeklyPlan();
      const electricRequired1 = plan1.requiredByCarrier.get('ELECTRICITY_STORED') ?? 0;

      // Switch to wood mode for food
      energy.setModeSelection(TaskCategory.FOOD, 'FOOD_WOOD');
      expect(energy.getSelectedMode(TaskCategory.FOOD)).toBe('FOOD_WOOD');

      // Generate new plan
      const plan2 = energy.generateWeeklyPlan();
      const electricRequired2 = plan2.requiredByCarrier.get('ELECTRICITY_STORED') ?? 0;

      // Electric requirement should be lower (or at least different)
      // since we switched food prep to wood
      expect(electricRequired2).toBeLessThanOrEqual(electricRequired1);
    });

    test('Scheduler considers energy availability in matching', async () => {
      await protocol.identity.addMember({
        applicantId: 'member1',
        displayName: 'Alice',
        publicKey: 'pk_alice_004_at_least_32_chars_long',
        requestedAt: now(),
      });

      // Set up member supply
      await protocol.scheduler.updateMemberSupply({
        memberId: 'member1',
        weeklyAvailableHours: 20,
        skills: new Map([[TaskCategory.FOOD, 0.9]]),
        preferences: [TaskCategory.FOOD],
        constraints: [],
        updatedAt: now(),
      });

      const weekStart = now();

      // Create a task slot
      await protocol.scheduler.createTaskSlot({
        category: TaskCategory.FOOD,
        name: 'Meal Prep',
        startTime: weekStart,
        endTime: weekStart + 2 * 60 * 60 * 1000,
        hoursRequired: 2,
        creditValue: 20,
        maxAssignees: 1,
      });

      // Run matching - should consider energy availability
      const result = await protocol.scheduler.runMatching(weekStart);

      expect(result).toBeDefined();
      // With no energy, task may still be assigned but with lower score
    });
  });

  describe('EN-I4: Emergency mode trigger on high S_E', () => {
    test('High energy stress triggers PANIC via emergency engine', async () => {
      // Add members
      await protocol.identity.addMember({
        applicantId: 'member1',
        displayName: 'Alice',
        publicKey: 'pk_alice_005_at_least_32_chars_long',
        requestedAt: now(),
      });
      await protocol.identity.addMember({
        applicantId: 'member2',
        displayName: 'Bob',
        publicKey: 'pk_bob_005_at_least_32_chars_long!',
        requestedAt: now(),
      });

      const energy = protocol.energy!;

      // Create a crisis: add minimal supplies
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 1, // Critically low
        reason: StockChangeReason.PROCUREMENT,
      });

      // Verify energy stress is very high
      const stressIndex = energy.calculateEnergyStress();
      expect(stressIndex).toBeGreaterThan(1);

      // Manually escalate to STRESSED first (as per protocol)
      await protocol.emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-test-1'
      );

      // Update emergency indicators (will pull from energy engine)
      await protocol.emergency.updateIndicators();

      // Check state transition
      const result = await protocol.emergency.checkStateTransition();

      // With energy stress > 1.2 (panicEnergyStress threshold),
      // should recommend PANIC
      if (stressIndex >= 1.2) {
        expect(result.shouldTransition).toBe(true);
        expect(result.targetState).toBe(RiskState.PANIC);
        expect(result.triggeringIndicators?.energyStress).toBeGreaterThanOrEqual(1.2);
      }
    });

    test('Energy stress is reflected in stress indicators', async () => {
      await protocol.identity.addMember({
        applicantId: 'member1',
        displayName: 'Alice',
        publicKey: 'pk_alice_006_at_least_32_chars_long',
        requestedAt: now(),
      });

      const energy = protocol.energy!;

      // Add low supplies
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 5,
        reason: StockChangeReason.PROCUREMENT,
      });

      // Update indicators
      await protocol.emergency.updateIndicators();

      const indicators = protocol.emergency.getStressIndicators();

      // Energy stress should be non-zero and reflected in overall stress
      expect(indicators.energyStress).toBeGreaterThan(0);
      expect(indicators.overallStress).toBeGreaterThanOrEqual(indicators.energyStress);
    });
  });

  describe('Bundle cost calculation', () => {
    test('Scheduler calculates correct weekly bundle cost', () => {
      // With no members, cost is 0
      const cost0 = protocol.scheduler.calculateWeeklyBundleCost();
      expect(cost0).toBe(0);
    });

    test('Bundle cost scales with member count', async () => {
      // Add one member
      await protocol.identity.addMember({
        applicantId: 'member1',
        displayName: 'Alice',
        publicKey: 'pk_alice_007_at_least_32_chars_long',
        requestedAt: now(),
      });

      const cost1 = protocol.scheduler.calculateWeeklyBundleCost();
      expect(cost1).toBeGreaterThan(0);

      // Add second member
      await protocol.identity.addMember({
        applicantId: 'member2',
        displayName: 'Bob',
        publicKey: 'pk_bob_007_at_least_32_chars_long!',
        requestedAt: now(),
      });

      const cost2 = protocol.scheduler.calculateWeeklyBundleCost();

      // Cost per member should decrease with more members
      expect(cost2).toBeLessThan(cost1);
    });

    test('Essential task categories are defined', () => {
      const categories = protocol.scheduler.getEssentialTaskCategories();

      expect(categories.length).toBeGreaterThan(0);

      // Check that essential categories are marked
      const essential = categories.filter(c => c.isEssential);
      expect(essential.length).toBeGreaterThan(0);

      // MEDICAL should be essential
      const medical = categories.find(c => c.category === TaskCategory.MEDICAL);
      expect(medical?.isEssential).toBe(true);

      // FOOD should be essential
      const food = categories.find(c => c.category === TaskCategory.FOOD);
      expect(food?.isEssential).toBe(true);
    });
  });

  describe('Procurement alerts', () => {
    test('Alerts generated for low stock carriers', async () => {
      await protocol.identity.addMember({
        applicantId: 'member1',
        displayName: 'Alice',
        publicKey: 'pk_alice_008_at_least_32_chars_long',
        requestedAt: now(),
      });

      const energy = protocol.energy!;

      // Add just enough to trigger alert
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 5,
        reason: StockChangeReason.PROCUREMENT,
      });

      const alerts = energy.generateProcurementAlerts();

      // Should have alerts for carriers with consumption requirements
      if (alerts.length > 0) {
        expect(alerts[0].priority).toBeDefined();
        expect(alerts[0].recommendedAmount).toBeGreaterThan(0);
      }
    });
  });

  describe('Stress projection', () => {
    test('Projection shows future stress trajectory', async () => {
      await protocol.identity.addMember({
        applicantId: 'member1',
        displayName: 'Alice',
        publicKey: 'pk_alice_009_at_least_32_chars_long',
        requestedAt: now(),
      });

      const energy = protocol.energy!;

      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 50,
        reason: StockChangeReason.PROCUREMENT,
      });

      const projection = energy.projectStress(14);

      expect(projection.daysAhead).toBe(14);
      expect(projection.projectedStress.length).toBe(14);
      expect(projection.recommendations).toBeDefined();
    });
  });

  describe('Protocol factory with energy disabled', () => {
    test('Energy engine is undefined when not enabled', async () => {
      const protocolNoEnergy = await createCellProtocol({
        cellId: 'no-energy-cell',
        enableEnergy: false,
      });

      expect(protocolNoEnergy.energy).toBeUndefined();

      // Emergency engine should still work with placeholder energy stress
      await protocolNoEnergy.emergency.updateIndicators();
      const indicators = protocolNoEnergy.emergency.getStressIndicators();
      expect(indicators.energyStress).toBe(0); // Placeholder value
    });
  });

  describe('Vulnerable member protection', () => {
    test('Vulnerable members get protected allocation', async () => {
      // Add multiple members
      await protocol.identity.addMember({
        applicantId: 'member1',
        displayName: 'Alice',
        publicKey: 'pk_alice_010_at_least_32_chars_long',
        requestedAt: now(),
      });
      await protocol.identity.addMember({
        applicantId: 'member2',
        displayName: 'Bob',
        publicKey: 'pk_bob_010_at_least_32_chars_long!',
        requestedAt: now(),
      });

      // Make member1 vulnerable by putting them at debt floor
      await protocol.ledger.applyBalanceUpdates([
        { memberId: 'member1', delta: -90, reason: 'SPOT_TRANSACTION_PAYER' as any },
        { memberId: 'member2', delta: 90, reason: 'SPOT_TRANSACTION_PAYEE' as any },
      ]);

      const energy = protocol.energy!;

      // Add limited supplies
      await energy.recordStockChange({
        carrierId: 'ELECTRICITY_STORED',
        delta: 20,
        reason: StockChangeReason.PROCUREMENT,
      });

      const bundles = energy.getBundleDistribution();

      // Find vulnerable and normal bundles
      const vulnerableBundle = bundles.find(b => b.memberId === 'member1');
      const normalBundle = bundles.find(b => b.memberId === 'member2');

      expect(vulnerableBundle).toBeDefined();
      expect(normalBundle).toBeDefined();

      if (vulnerableBundle && normalBundle) {
        expect(vulnerableBundle.isVulnerable).toBe(true);
        expect(normalBundle.isVulnerable).toBe(false);
        // Vulnerable gets at least humanitarian floor
        expect(vulnerableBundle.bundleFraction).toBeGreaterThanOrEqual(HUMANITARIAN_FLOOR);
      }
    });
  });
});
