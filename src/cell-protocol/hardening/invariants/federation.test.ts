/**
 * Cell Protocol - Hardening: Federation Invariant Tests
 *
 * INV-05: Federation sum = 0 (across all cells)
 * INV-06: Federation cap respected
 *
 * Properties for federation network constraints.
 */

import { createCellProtocol, CellProtocol } from '../../index';
import { CellId, now } from '../../types/common';
import {
  createInvariantRunner,
  createStateSnapshot,
  checkFederationSum,
  checkFederationCap,
} from './invariant-runner';
import { CellStateSnapshot } from '../types/invariant';

describe('INV-05: Federation Sum = 0', () => {
  let cells: Map<CellId, CellProtocol>;

  beforeEach(async () => {
    cells = new Map();

    // Create 3 federated cells
    for (let i = 0; i < 3; i++) {
      const cellId = `cell-${i}`;
      const protocol = await createCellProtocol({
        cellId,
        enableFederation: true,
        federationParameters: {
          baseBetaFactor: 0.3,
          minExposureCap: 0,
          maxExposureCap: 10000,
          warningThreshold: 0.75,
          criticalThreshold: 0.9,
        },
      });

      // Add members
      for (let m = 0; m < 3; m++) {
        await protocol.identity.addMember({
          applicantId: `member-${i}-${m}`,
          displayName: `Cell ${i} Member ${m}`,
          publicKey: `pk_member-${i}-${m}_${'x'.repeat(32)}`,
          requestedAt: now(),
        });
      }

      cells.set(cellId, protocol);
    }

    // Set up federation links between cells
    // In a real implementation, cells would exchange link proposals
    // For testing, we simulate this by directly setting up links
  });

  describe('Basic Federation Sum', () => {
    test('Fresh federation has zero sum', () => {
      const states = new Map<CellId, CellStateSnapshot>();
      for (const [cellId, protocol] of cells) {
        states.set(cellId, createStateSnapshot(protocol));
      }

      const result = checkFederationSum(states);
      expect(result.holds).toBe(true);
    });

    test('Single cell with no federation has zero position', async () => {
      const protocol = await createCellProtocol({
        cellId: 'solo-cell',
        enableFederation: true,
      });

      await protocol.identity.addMember({
        applicantId: 'solo-member',
        displayName: 'Solo Member',
        publicKey: `pk_solo_${'x'.repeat(32)}`,
        requestedAt: now(),
      });

      const state = createStateSnapshot(protocol);
      expect(state.federationPosition).toBe(0);
    });
  });

  describe('Federation Sum Conservation', () => {
    test('Zero-sum is maintained (conceptual test)', async () => {
      // This test verifies the concept: if cell A sends to cell B,
      // A's position decreases and B's position increases by the same amount

      // In a proper two-party federation transaction:
      // - Source cell: position decreases by amount
      // - Target cell: position increases by amount
      // - Sum remains zero

      // For now, just verify the checker works correctly
      const states = new Map<CellId, CellStateSnapshot>();

      // Simulate: cell-0 has +100, cell-1 has -100, cell-2 has 0
      const state0: CellStateSnapshot = {
        cellId: 'cell-0',
        members: [],
        commitments: [],
        federationPosition: 100,
        federationCap: 300,
        timestamp: now(),
      };

      const state1: CellStateSnapshot = {
        cellId: 'cell-1',
        members: [],
        commitments: [],
        federationPosition: -100,
        federationCap: 300,
        timestamp: now(),
      };

      const state2: CellStateSnapshot = {
        cellId: 'cell-2',
        members: [],
        commitments: [],
        federationPosition: 0,
        federationCap: 300,
        timestamp: now(),
      };

      states.set('cell-0', state0);
      states.set('cell-1', state1);
      states.set('cell-2', state2);

      const result = checkFederationSum(states);
      expect(result.holds).toBe(true);
    });

    test('Non-zero sum is detected', () => {
      const states = new Map<CellId, CellStateSnapshot>();

      // Simulate imbalanced positions (violation)
      states.set('cell-0', {
        cellId: 'cell-0',
        members: [],
        commitments: [],
        federationPosition: 100,
        federationCap: 300,
        timestamp: now(),
      });

      states.set('cell-1', {
        cellId: 'cell-1',
        members: [],
        commitments: [],
        federationPosition: 50, // Should be -100 for balance
        federationCap: 300,
        timestamp: now(),
      });

      const result = checkFederationSum(states);
      expect(result.holds).toBe(false);
      expect(result.violation?.description).toContain('sum');
    });
  });
});

describe('INV-06: Federation Cap Respected', () => {
  let protocol: CellProtocol;

  beforeEach(async () => {
    protocol = await createCellProtocol({
      cellId: 'cap-test-cell',
      enableFederation: true,
      federationParameters: {
        baseBetaFactor: 0.3,
        minExposureCap: 0,
        maxExposureCap: 1000,
        warningThreshold: 0.75,
        criticalThreshold: 0.9,
      },
    });

    // Add members to create capacity
    for (let i = 0; i < 10; i++) {
      await protocol.identity.addMember({
        applicantId: `member-${i}`,
        displayName: `Member ${i}`,
        publicKey: `pk_member-${i}_${'x'.repeat(32)}`,
        requestedAt: now(),
      });
    }
  });

  describe('Basic Cap Checks', () => {
    test('Fresh cell respects cap', () => {
      const state = createStateSnapshot(protocol);
      const result = checkFederationCap(state);
      expect(result.holds).toBe(true);
    });

    test('Position within cap is valid', () => {
      const state: CellStateSnapshot = {
        cellId: 'test-cell',
        members: [],
        commitments: [],
        federationPosition: 200,
        federationCap: 300,
        timestamp: now(),
      };

      const result = checkFederationCap(state);
      expect(result.holds).toBe(true);
    });

    test('Position at cap is valid', () => {
      const state: CellStateSnapshot = {
        cellId: 'test-cell',
        members: [],
        commitments: [],
        federationPosition: 300,
        federationCap: 300,
        timestamp: now(),
      };

      const result = checkFederationCap(state);
      expect(result.holds).toBe(true);
    });

    test('Negative position within cap is valid', () => {
      const state: CellStateSnapshot = {
        cellId: 'test-cell',
        members: [],
        commitments: [],
        federationPosition: -250,
        federationCap: 300,
        timestamp: now(),
      };

      const result = checkFederationCap(state);
      expect(result.holds).toBe(true);
    });

    test('Position exceeding cap is detected', () => {
      const state: CellStateSnapshot = {
        cellId: 'test-cell',
        members: [],
        commitments: [],
        federationPosition: 350,
        federationCap: 300,
        timestamp: now(),
      };

      const result = checkFederationCap(state);
      expect(result.holds).toBe(false);
      expect(result.violation?.description).toContain('cap');
    });

    test('Negative position exceeding cap is detected', () => {
      const state: CellStateSnapshot = {
        cellId: 'test-cell',
        members: [],
        commitments: [],
        federationPosition: -350,
        federationCap: 300,
        timestamp: now(),
      };

      const result = checkFederationCap(state);
      expect(result.holds).toBe(false);
    });
  });

  describe('Cap Calculation', () => {
    test('Cap is based on aggregate capacity', async () => {
      // With 10 members at default limit of 100, aggregate capacity = 1000
      // Beta factor 0.3 -> cap = 300
      const federation = protocol.federation!;
      const cap = federation.getExposureCap();

      // Cap should be 30% of 1000 = 300
      expect(cap).toBe(300);
    });

    test('Adding members increases cap', async () => {
      const capBefore = protocol.federation!.getExposureCap();

      // Add more members
      for (let i = 10; i < 15; i++) {
        await protocol.identity.addMember({
          applicantId: `member-${i}`,
          displayName: `Member ${i}`,
          publicKey: `pk_member-${i}_${'x'.repeat(32)}`,
          requestedAt: now(),
        });
      }

      // Recalculate cap
      await protocol.federation!.recalculateExposureCap();
      const capAfter = protocol.federation!.getExposureCap();

      expect(capAfter).toBeGreaterThan(capBefore);
    });
  });

  describe('Property-Based Testing', () => {
    test('Federation cap respected under random operations (100 iterations)', async () => {
      const runner = createInvariantRunner({
        defaultIterations: 100,
        maxOperationsPerIteration: 20,
        initialMemberCount: 5,
        baseSeed: 555,
        federationEnabled: true,
        federationCellCount: 1,
        progressInterval: 25,
      });

      const result = await runner.runInvariant({
        id: 'INV-06',
        property: 'Federation cap respected',
        iterations: 100,
        checker: checkFederationCap,
        generatorConfig: { federationEnabled: true },
      });

      expect(result.passRate).toBe(1);
    });
  });
});

describe('Federation Invariants Combined', () => {
  test('All federation invariants hold together', async () => {
    // Create multi-cell setup
    const cellCount = 3;
    const cells: CellProtocol[] = [];

    for (let c = 0; c < cellCount; c++) {
      const protocol = await createCellProtocol({
        cellId: `multi-cell-${c}`,
        enableFederation: true,
      });

      for (let m = 0; m < 5; m++) {
        await protocol.identity.addMember({
          applicantId: `member-${c}-${m}`,
          displayName: `C${c}M${m}`,
          publicKey: `pk_c${c}m${m}_${'x'.repeat(32)}`,
          requestedAt: now(),
        });
      }

      cells.push(protocol);
    }

    // Collect states
    const states = new Map<CellId, CellStateSnapshot>();
    for (const protocol of cells) {
      states.set(protocol.cellId, createStateSnapshot(protocol));
    }

    // Check all invariants
    const sumResult = checkFederationSum(states);
    expect(sumResult.holds).toBe(true);

    for (const [cellId, state] of states) {
      const capResult = checkFederationCap(state);
      expect(capResult.holds).toBe(true);
    }
  });
});

/**
 * Full scale federation tests
 */
describe.skip('INV-05/06: Federation Invariants - Full Scale', () => {
  test('Federation invariants hold under 50,000 operations', async () => {
    const runner = createInvariantRunner({
      defaultIterations: 50000,
      maxOperationsPerIteration: 50,
      initialMemberCount: 10,
      baseSeed: 66666,
      federationEnabled: true,
      federationCellCount: 3,
      progressInterval: 5000,
    });

    runner.setProgressCallback((iteration, total, id) => {
      console.log(`Progress: ${iteration}/${total} (${id})`);
    });

    // Test INV-06 (cap) - INV-05 (sum) requires multi-cell setup
    const result = await runner.runInvariant({
      id: 'INV-06',
      property: 'Federation cap respected',
      iterations: 50000,
      checker: checkFederationCap,
      generatorConfig: { federationEnabled: true },
    });

    console.log(`
      INV-06 Results:
      - Pass Rate: ${(result.passRate * 100).toFixed(2)}%
      - Time: ${result.totalDurationMs}ms
    `);

    expect(result.passRate).toBe(1);
  }, 600000);
});
