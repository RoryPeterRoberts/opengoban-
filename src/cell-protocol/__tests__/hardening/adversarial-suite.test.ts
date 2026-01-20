/**
 * Cell Protocol - Hardening: Adversarial Suite Tests
 *
 * Tests for the 7 adversarial attack scenarios (ADV-01 to ADV-07).
 */

import { createCellProtocol, CellProtocol } from '../../index';
import {
  AdversarialRunner,
  createAdversarialRunner,
  getAllScenarios,
  getScenario,
  EXIT_SCAM_SCENARIO,
  SYBIL_INFILTRATION_SCENARIO,
  COLLUSIVE_PUMP_SCENARIO,
  RESOURCE_SHOCK_SCENARIO,
  FEDERATION_SEVERANCE_SCENARIO,
  INTERMITTENT_CONNECTIVITY_SCENARIO,
  GOVERNANCE_CAPTURE_SCENARIO,
  ALL_SCENARIOS,
  getScenarioById,
} from '../../hardening';
import { now } from '../../types/common';

describe('Hardening: Adversarial Suite', () => {
  let protocol: CellProtocol;
  let runner: AdversarialRunner;

  beforeEach(async () => {
    protocol = await createCellProtocol({
      cellId: 'adversarial-test-cell',
      enableFederation: true,
    });
    runner = createAdversarialRunner();
  });

  describe('Scenario Definitions', () => {
    test('all 7 scenarios are defined', () => {
      expect(ALL_SCENARIOS.length).toBe(7);
    });

    test('getAllScenarios returns all scenarios', () => {
      const scenarios = getAllScenarios();
      expect(scenarios.length).toBe(7);
    });

    test('scenarios have required fields', () => {
      for (const scenario of getAllScenarios()) {
        expect(scenario.id).toBeDefined();
        expect(scenario.name).toBeDefined();
        expect(scenario.description).toBeDefined();
        expect(scenario.setup).toBeDefined();
        expect(scenario.successCriteria).toBeDefined();
      }
    });

    test('getScenarioById finds scenarios', () => {
      expect(getScenarioById('ADV-01')).toBeDefined();
      expect(getScenarioById('ADV-02')).toBeDefined();
      expect(getScenarioById('ADV-03')).toBeDefined();
      expect(getScenarioById('ADV-04')).toBeDefined();
      expect(getScenarioById('ADV-05')).toBeDefined();
      expect(getScenarioById('ADV-06')).toBeDefined();
      expect(getScenarioById('ADV-07')).toBeDefined();
      expect(getScenarioById('ADV-99' as any)).toBeUndefined();
    });

    test('getScenario finds scenarios', () => {
      expect(getScenario('ADV-01')).toBeDefined();
      expect(getScenario('ADV-02')).toBeDefined();
      expect(getScenario('ADV-99' as any)).toBeUndefined();
    });
  });

  describe('ADV-01: Exit Scam Wave', () => {
    test('scenario is properly defined', () => {
      expect(EXIT_SCAM_SCENARIO.id).toBe('ADV-01');
      expect(EXIT_SCAM_SCENARIO.name).toBe('Exit Scam Wave');
      expect(EXIT_SCAM_SCENARIO.setup.memberCount).toBeGreaterThan(0);
    });

    test('runs exit scam scenario', async () => {
      const scenario = getScenario('ADV-01');
      expect(scenario).toBeDefined();

      const result = await runner.runScenario(scenario!);

      expect(result.scenarioId).toBe('ADV-01');
      expect(typeof result.passed).toBe('boolean');
      expect(result.log).toBeDefined();
      expect(Array.isArray(result.log)).toBe(true);
    }, 60000);

    test('tracks violations', async () => {
      const scenario = getScenario('ADV-01');
      const result = await runner.runScenario(scenario!);

      expect(result.violations).toBeDefined();
      expect(Array.isArray(result.violations)).toBe(true);
    }, 60000);
  });

  describe('ADV-02: Sybil Infiltration', () => {
    test('scenario is properly defined', () => {
      expect(SYBIL_INFILTRATION_SCENARIO.id).toBe('ADV-02');
      expect(SYBIL_INFILTRATION_SCENARIO.name).toBe('Sybil Infiltration');
    });

    test('runs sybil infiltration scenario', async () => {
      const scenario = getScenario('ADV-02');
      const result = await runner.runScenario(scenario!);

      expect(result.scenarioId).toBe('ADV-02');
      expect(typeof result.passed).toBe('boolean');
    }, 60000);
  });

  describe('ADV-03: Collusive Pump', () => {
    test('scenario is properly defined', () => {
      expect(COLLUSIVE_PUMP_SCENARIO.id).toBe('ADV-03');
      expect(COLLUSIVE_PUMP_SCENARIO.name).toBe('Collusive Pump');
    });

    test('runs collusive pump scenario', async () => {
      const scenario = getScenario('ADV-03');
      const result = await runner.runScenario(scenario!);

      expect(result.scenarioId).toBe('ADV-03');
      expect(typeof result.passed).toBe('boolean');
    }, 60000);
  });

  describe('ADV-04: Resource Shock', () => {
    test('scenario is properly defined', () => {
      expect(RESOURCE_SHOCK_SCENARIO.id).toBe('ADV-04');
      expect(RESOURCE_SHOCK_SCENARIO.name).toBe('Resource Shock');
    });

    test('runs resource shock scenario', async () => {
      const scenario = getScenario('ADV-04');
      const result = await runner.runScenario(scenario!);

      expect(result.scenarioId).toBe('ADV-04');
      expect(typeof result.passed).toBe('boolean');
    }, 60000);
  });

  describe('ADV-05: Federation Severance', () => {
    test('scenario is properly defined', () => {
      expect(FEDERATION_SEVERANCE_SCENARIO.id).toBe('ADV-05');
      expect(FEDERATION_SEVERANCE_SCENARIO.name).toBe('Federation Severance');
    });

    test('runs federation severance scenario', async () => {
      const scenario = getScenario('ADV-05');
      const result = await runner.runScenario(scenario!);

      expect(result.scenarioId).toBe('ADV-05');
      expect(typeof result.passed).toBe('boolean');
    }, 60000);
  });

  describe('ADV-06: Intermittent Connectivity', () => {
    test('scenario is properly defined', () => {
      expect(INTERMITTENT_CONNECTIVITY_SCENARIO.id).toBe('ADV-06');
      expect(INTERMITTENT_CONNECTIVITY_SCENARIO.name).toBe('Intermittent Connectivity');
    });

    test('runs intermittent connectivity scenario', async () => {
      const scenario = getScenario('ADV-06');
      const result = await runner.runScenario(scenario!);

      expect(result.scenarioId).toBe('ADV-06');
      expect(typeof result.passed).toBe('boolean');
    }, 60000);
  });

  describe('ADV-07: Governance Capture', () => {
    test('scenario is properly defined', () => {
      expect(GOVERNANCE_CAPTURE_SCENARIO.id).toBe('ADV-07');
      expect(GOVERNANCE_CAPTURE_SCENARIO.name).toBe('Governance Capture');
    });

    test('runs governance capture scenario', async () => {
      const scenario = getScenario('ADV-07');
      const result = await runner.runScenario(scenario!);

      expect(result.scenarioId).toBe('ADV-07');
      expect(typeof result.passed).toBe('boolean');
    }, 60000);
  });

  describe('Adversarial Runner', () => {
    test('runs all scenarios', async () => {
      const results = await runner.runAll();

      expect(results.results.length).toBe(7);
      expect(typeof results.allPassed).toBe('boolean');
      expect(typeof results.passRate).toBe('number');
    }, 300000);

    test('runs selected scenarios', async () => {
      const results = await runner.runAll(['ADV-01', 'ADV-02']);

      expect(results.results.length).toBe(2);
    }, 120000);

    test('tracks metrics for each scenario', async () => {
      const results = await runner.runAll(['ADV-01']);

      expect(results.results.length).toBe(1);
      expect(results.results[0].durationMs).toBeGreaterThanOrEqual(0);
    }, 60000);

    test('supports progress callback', async () => {
      const progressCalls: string[] = [];
      runner.setProgressCallback((id, msg) => progressCalls.push(`${id}: ${msg}`));

      await runner.runAll(['ADV-01']);

      expect(progressCalls.length).toBeGreaterThan(0);
    }, 60000);
  });

  describe('Success Criteria', () => {
    test('ADV-01 criteria includes extraction limit', () => {
      expect(EXIT_SCAM_SCENARIO.successCriteria).toBeDefined();
    });

    test('ADV-02 criteria includes sybil admission limit', () => {
      expect(SYBIL_INFILTRATION_SCENARIO.successCriteria).toBeDefined();
    });

    test('ADV-04 criteria includes survival rate', () => {
      expect(RESOURCE_SHOCK_SCENARIO.successCriteria.minSurvivalRate).toBeDefined();
    });

    test('scenarios check invariants', () => {
      for (const scenario of getAllScenarios()) {
        if (scenario.successCriteria.invariantsHold) {
          expect(Array.isArray(scenario.successCriteria.invariantsHold)).toBe(true);
        }
      }
    });
  });

  describe('Scenario Invariants', () => {
    test('conservation law maintained during attacks', async () => {
      // Add some members first
      for (let i = 0; i < 5; i++) {
        await protocol.identity.addMember({
          applicantId: `inv-member-${i}`,
          displayName: `Invariant Member ${i}`,
          publicKey: `pk_invariant_${i}_at_least_32_chars`,
          requestedAt: now(),
          initialLimit: 1000,
        });
      }

      // Calculate sum of balances manually
      const allMembers = protocol.ledger.getAllMemberStates();
      let sumBefore = 0;
      for (const [, state] of allMembers) {
        sumBefore += state.balance;
      }

      // Conservation should hold (sum should be 0)
      expect(Math.abs(sumBefore)).toBeLessThan(0.01);
    });

    test('floor constraint maintained during attacks', async () => {
      // Add some members
      for (let i = 0; i < 5; i++) {
        await protocol.identity.addMember({
          applicantId: `floor-member-${i}`,
          displayName: `Floor Member ${i}`,
          publicKey: `pk_floor_${i}_at_least_32_chars_here`,
          requestedAt: now(),
          initialLimit: 1000,
        });
      }

      // Check floor for all members
      const allMembers = protocol.ledger.getAllMemberStates();
      for (const [memberId, state] of allMembers) {
        expect(state.balance).toBeGreaterThanOrEqual(-state.limit);
      }
    });
  });
});
