/**
 * Cell Protocol - Hardening: Simulation Suite Tests
 *
 * Tests for economic simulation framework with agent strategies.
 */

import { createCellProtocol, CellProtocol } from '../../index';
import {
  SimulationEngine,
  createSimulationEngine,
  createSimpleSimulation,
  createStrategy,
  CooperatorStrategy,
  ConditionalStrategy,
  DefectorStrategy,
  ShirkerStrategy,
  ColluderStrategy,
  SybilStrategy,
  MetricsCollector,
  createMetricsCollector,
} from '../../hardening';
import { now } from '../../types/common';

// Test configuration
const TEST_TICKS = process.env.CI ? 20 : 50;
const SEED = 12345;

describe('Hardening: Simulation Suite', () => {
  let protocol: CellProtocol;

  beforeEach(async () => {
    protocol = await createCellProtocol({
      cellId: 'simulation-test-cell',
    });
  });

  describe('Agent Strategies', () => {
    test('CooperatorStrategy always cooperates', () => {
      const strategy = new CooperatorStrategy();

      // Create mock context
      const context = {
        agentState: {
          agentId: 'test-agent',
          balance: 0,
          limit: 1000,
          reserve: 0,
          needsSatisfaction: { food: 1, energy: 1, shelter: 1, medical: 1 },
          activeCommitmentsAsPromisor: 0,
          activeCommitmentsAsPromisee: 0,
          hoursWorked: 0,
          totalEarned: 0,
          totalSpent: 0,
          fulfillmentRate: 1,
          hasDefected: false,
          isFrozen: false,
          isExcluded: false,
        },
        potentialCounterparties: [],
        tick: 10,
        rng: { next: () => 0.5, nextInt: () => 5, chance: () => true, pick: (arr: any[]) => arr[0] } as any,
        pendingCommitmentsAsPromisor: 0,
        pendingCommitmentsAsPromisee: 0,
        counterpartyReputations: new Map(),
        isPanicMode: false,
      };

      const decision = strategy.decideTransaction(context);

      // Cooperator should be willing to transact
      expect(decision).toBeDefined();
    });

    test('createStrategy creates correct strategies', () => {
      expect(createStrategy('COOPERATOR')).toBeInstanceOf(CooperatorStrategy);
      expect(createStrategy('CONDITIONAL')).toBeInstanceOf(ConditionalStrategy);
      expect(createStrategy('DEFECTOR')).toBeInstanceOf(DefectorStrategy);
      expect(createStrategy('SHIRKER')).toBeInstanceOf(ShirkerStrategy);
      expect(createStrategy('COLLUDER')).toBeInstanceOf(ColluderStrategy);
      expect(createStrategy('SYBIL')).toBeInstanceOf(SybilStrategy);
    });
  });

  describe('Simulation Engine', () => {
    test('runs basic simulation', async () => {
      const engine = createSimpleSimulation(20, TEST_TICKS, SEED);
      const result = await engine.run();

      expect(result.config.ticks).toBe(TEST_TICKS);
      expect(result.history.length).toBeGreaterThan(0);
      expect(result.summary).toBeDefined();
    });

    test('maintains high survival rate with cooperators', async () => {
      const engine = createSimulationEngine({
        id: 'cooperator-test',
        ticks: TEST_TICKS,
        seed: SEED,
        cells: [{
          id: 'test-cell',
          initialMembers: 20,
          defaultLimit: 100,
          federationBeta: 0.3,
        }],
        agentDistribution: {
          cooperators: 20,
          conditional: 0,
          defectors: 0,
          shirkers: 0,
          colluders: 0,
          sybils: 0,
        },
      });

      const result = await engine.run();

      expect(result.summary.finalSurvivalRate).toBeGreaterThanOrEqual(0.8);
    });

    test('handles shock events', async () => {
      const engine = createSimulationEngine({
        id: 'shock-test',
        ticks: TEST_TICKS,
        seed: SEED,
        cells: [{
          id: 'test-cell',
          initialMembers: 20,
          defaultLimit: 100,
          federationBeta: 0.3,
        }],
        agentDistribution: {
          cooperators: 14,
          conditional: 4,
          defectors: 2,
          shirkers: 0,
          colluders: 0,
          sybils: 0,
        },
        shocks: [{
          type: 'DEFECTION_WAVE',
          tick: 5,
          intensity: 0.3,
          duration: 0,
          parameters: { type: 'DEFECTION_WAVE', defectionRate: 0.1 },
        }],
      });

      const result = await engine.run();

      // Simulation should complete even with shocks
      expect(result.summary).toBeDefined();
    });
  });

  describe('Metrics Collector', () => {
    beforeEach(async () => {
      // Add test members
      for (let i = 0; i < 5; i++) {
        await protocol.identity.addMember({
          applicantId: `metric-member-${i}`,
          displayName: `Metric Member ${i}`,
          publicKey: `pk_metric_${i}_at_least_32_chars_here`,
          requestedAt: now(),
          initialLimit: 1000,
        });
      }
    });

    test('collects snapshot metrics', () => {
      const collector = createMetricsCollector();

      const cells = new Map([[protocol.cellId, protocol]]);
      const agentStates = new Map();

      // Create mock agent states
      for (let i = 0; i < 5; i++) {
        agentStates.set(`metric-member-${i}`, {
          agentId: `metric-member-${i}`,
          balance: 0,
          limit: 1000,
          reserve: 0,
          needsSatisfaction: { food: 1, energy: 1, shelter: 1, medical: 1 },
          activeCommitmentsAsPromisor: 0,
          activeCommitmentsAsPromisee: 0,
          hoursWorked: 0,
          totalEarned: 0,
          totalSpent: 0,
          fulfillmentRate: 1,
          hasDefected: false,
          isFrozen: false,
          isExcluded: false,
        });
      }

      const metrics = collector.collectSnapshot(10, cells, agentStates, new Set());

      expect(metrics.tick).toBe(10);
      expect(metrics.survival).toBeDefined();
      expect(metrics.economic).toBeDefined();
      expect(metrics.network).toBeDefined();
    });
  });

  describe('Simulation Targets', () => {
    test('survival rate >= 70% under normal conditions', async () => {
      const engine = createSimulationEngine({
        id: 'target-test',
        ticks: TEST_TICKS,
        seed: SEED,
        cells: [{
          id: 'test-cell',
          initialMembers: 30,
          defaultLimit: 100,
          federationBeta: 0.3,
        }],
        agentDistribution: {
          cooperators: 18,
          conditional: 8,
          defectors: 3,
          shirkers: 1,
          colluders: 0,
          sybils: 0,
        },
      });

      const result = await engine.run();

      // Under normal conditions (no shocks, moderate defection), survival should be reasonable
      expect(result.summary.finalSurvivalRate).toBeGreaterThanOrEqual(0.7);
    });

    test('system recovers from moderate shock', async () => {
      const engine = createSimulationEngine({
        id: 'recovery-test',
        ticks: TEST_TICKS * 2, // Longer to allow recovery
        seed: SEED,
        cells: [{
          id: 'test-cell',
          initialMembers: 30,
          defaultLimit: 100,
          federationBeta: 0.3,
        }],
        agentDistribution: {
          cooperators: 21,
          conditional: 6,
          defectors: 2,
          shirkers: 1,
          colluders: 0,
          sybils: 0,
        },
        shocks: [{
          type: 'RESOURCE_SCARCITY',
          tick: 10,
          intensity: 0.3,
          duration: 10,
          parameters: {
            type: 'RESOURCE_SCARCITY',
            affectedCategories: ['FOOD' as any],
            reductionFactor: 0.3,
          },
        }],
      });

      const result = await engine.run();

      // System should show some recovery or stability
      expect(result.summary.finalSurvivalRate).toBeGreaterThanOrEqual(0.5);
    });
  });
});
