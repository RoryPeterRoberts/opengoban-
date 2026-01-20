/**
 * Cell Protocol - Emergency Engine Tests
 *
 * Tests for the Emergency Mode System (PRD-07).
 * Verifies risk states, stress indicators, and state transitions.
 */

import { createLedgerEngine, LedgerEngine } from '../engines/ledger-engine';
import { EmergencyEngine, EmergencyValidationError, createEmergencyEngine } from '../engines/emergency-engine';
import { createInMemoryStorage, InMemoryStorage } from '../storage/pouchdb-adapter';
import {
  RiskState,
  AdmissionMode,
  CommitmentMode,
  SchedulerPriority,
  TransitionReason,
  EmergencyErrorCode,
  DEFAULT_POLICIES,
  DEFAULT_THRESHOLDS,
} from '../types/emergency';
import { BalanceChangeReason, now } from '../types/common';

describe('EmergencyEngine', () => {
  let emergency: EmergencyEngine;
  let storage: InMemoryStorage;
  let ledger: LedgerEngine;

  beforeEach(async () => {
    storage = createInMemoryStorage();
    ledger = await createLedgerEngine('test-cell', { defaultLimit: 100 }, storage);
    emergency = createEmergencyEngine('test-cell', ledger, storage);
  });

  describe('Initialization', () => {
    test('Starts in NORMAL state', () => {
      expect(emergency.getCurrentRiskState()).toBe(RiskState.NORMAL);
    });

    test('Has default NORMAL policy', () => {
      const policy = emergency.getCurrentPolicy();
      expect(policy.limitFactor).toBe(1.0);
      expect(policy.federationBetaFactor).toBe(1.0);
      expect(policy.admissionMode).toBe(AdmissionMode.STANDARD);
      expect(policy.schedulerPriority).toBe(SchedulerPriority.BALANCED);
    });

    test('Has default thresholds', () => {
      const thresholds = emergency.getThresholds();
      expect(thresholds.stressedFloorMass).toBe(0.25);
      expect(thresholds.panicFloorMass).toBe(0.40);
      expect(thresholds.normalFloorMass).toBe(0.15);
    });

    test('Accepts custom thresholds', async () => {
      const custom = createEmergencyEngine('test-cell', ledger, storage, {
        stressedFloorMass: 0.30,
        panicFloorMass: 0.50,
      });

      const thresholds = custom.getThresholds();
      expect(thresholds.stressedFloorMass).toBe(0.30);
      expect(thresholds.panicFloorMass).toBe(0.50);
      // Default for unspecified
      expect(thresholds.normalFloorMass).toBe(DEFAULT_THRESHOLDS.normalFloorMass);
    });
  });

  describe('Stress Indicators', () => {
    test('Calculates zero indicators for empty ledger', async () => {
      const indicators = await emergency.updateIndicators();

      expect(indicators.floorMass).toBe(0);
      expect(indicators.balanceVariance).toBe(0);
      expect(indicators.disputeRate).toBe(0);
      expect(indicators.economicStress).toBe(0);
      expect(indicators.overallStress).toBe(0);
    });

    test('Calculates floor mass when members at floor', async () => {
      // Add members with limit of 100
      await ledger.addMember('member1', 100);
      await ledger.addMember('member2', 100);
      await ledger.addMember('member3', 100);
      await ledger.addMember('member4', 100);

      // Put member1 at floor (balance = -100, which means distance to floor = 0)
      // To achieve this with conservation, we need transactions
      await ledger.applyBalanceUpdates([
        { memberId: 'member1', delta: -100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member2', delta: 100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      const indicators = await emergency.updateIndicators();

      // member1 has limit 100 out of total 400, so floor mass = 100/400 = 0.25
      expect(indicators.floorMass).toBeCloseTo(0.25, 2);
    });

    test('Calculates balance variance correctly', async () => {
      await ledger.addMember('member1', 100);
      await ledger.addMember('member2', 100);

      // Create imbalanced positions
      await ledger.applyBalanceUpdates([
        { memberId: 'member1', delta: 50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
        { memberId: 'member2', delta: -50, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
      ]);

      const indicators = await emergency.updateIndicators();

      // Balances are 50 and -50, mean = 0
      // Variance coefficient = stddev / |mean| - but mean is 0, so result depends on implementation
      // Since mean is 0, our implementation returns 0
      expect(indicators.balanceVariance).toBe(0);
    });

    test('Updates lastIndicatorUpdate timestamp', async () => {
      const before = now();
      await new Promise(resolve => setTimeout(resolve, 10));
      await emergency.updateIndicators();

      const indicators = emergency.getStressIndicators();
      expect(indicators.calculatedAt).toBeGreaterThan(before);
    });
  });

  describe('State Transitions - EM-01 to EM-07', () => {
    test('EM-01: NORMAL with low indicators stays NORMAL', async () => {
      // Just two members with balanced positions
      await ledger.addMember('member1', 100);
      await ledger.addMember('member2', 100);

      await emergency.updateIndicators();
      const result = await emergency.checkStateTransition();

      expect(result.shouldTransition).toBe(false);
      expect(emergency.getCurrentRiskState()).toBe(RiskState.NORMAL);
    });

    test('EM-02: NORMAL → STRESSED on high floor mass (>25%)', async () => {
      // Set up scenario where 30% of capacity is at floor
      await ledger.addMember('member1', 100);
      await ledger.addMember('member2', 100);
      await ledger.addMember('member3', 100);

      // Put member1 at floor (balance = -100)
      await ledger.applyBalanceUpdates([
        { memberId: 'member1', delta: -100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member2', delta: 100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      await emergency.updateIndicators();
      const result = await emergency.checkStateTransition();

      expect(result.shouldTransition).toBe(true);
      expect(result.targetState).toBe(RiskState.STRESSED);
      expect(result.reason).toBe(TransitionReason.INDICATOR_TRIGGERED);
      expect(result.triggeringIndicators?.floorMass).toBeGreaterThanOrEqual(0.25);
    });

    test('EM-03: STRESSED → PANIC on very high floor mass (>40%)', async () => {
      // Start in STRESSED
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-approval-1'
      );

      // Set up scenario where 50% of capacity is at floor
      await ledger.addMember('member1', 100);
      await ledger.addMember('member2', 100);

      // Put member1 at floor
      await ledger.applyBalanceUpdates([
        { memberId: 'member1', delta: -100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYER },
        { memberId: 'member2', delta: 100, reason: BalanceChangeReason.SPOT_TRANSACTION_PAYEE },
      ]);

      await emergency.updateIndicators();
      const result = await emergency.checkStateTransition();

      expect(result.shouldTransition).toBe(true);
      expect(result.targetState).toBe(RiskState.PANIC);
    });

    test('EM-04: PANIC stays PANIC during stabilization period', async () => {
      // Enter PANIC
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      // Set indicators below de-escalation thresholds
      await ledger.addMember('member1', 100);
      await ledger.addMember('member2', 100);
      // Balanced positions, no one at floor

      await emergency.updateIndicators();
      const result = await emergency.checkStateTransition();

      // Should not de-escalate because stabilization period hasn't passed
      expect(result.shouldTransition).toBe(false);
      expect(emergency.getCurrentRiskState()).toBe(RiskState.PANIC);
    });

    test('EM-05: PANIC → STRESSED after stabilization with low indicators', async () => {
      // Create engine with very short stabilization period for testing
      const fastEmergency = createEmergencyEngine('test-cell', ledger, storage, {
        panicStabilizationPeriod: 10, // 10ms
      });

      // Enter PANIC
      await fastEmergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await fastEmergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      // Add balanced members
      await ledger.addMember('member1', 100);
      await ledger.addMember('member2', 100);

      // Wait for stabilization
      await new Promise(resolve => setTimeout(resolve, 20));

      await fastEmergency.updateIndicators();
      const result = await fastEmergency.checkStateTransition();

      expect(result.shouldTransition).toBe(true);
      expect(result.targetState).toBe(RiskState.STRESSED);
      expect(result.reason).toBe(TransitionReason.STABILIZATION_COMPLETE);
    });

    test('EM-06: Policy application reduces limits within bounds', () => {
      // PANIC policy has limitFactor = 0.8
      expect(DEFAULT_POLICIES[RiskState.PANIC].limitFactor).toBe(0.8);

      // STRESSED policy has limitFactor = 1.0 (no reduction for existing)
      expect(DEFAULT_POLICIES[RiskState.STRESSED].limitFactor).toBe(1.0);
      expect(DEFAULT_POLICIES[RiskState.STRESSED].newMemberLimitFactor).toBe(0.8);
    });

    test('EM-07: Federation beta = 0 in PANIC', async () => {
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      const policy = emergency.getCurrentPolicy();
      expect(policy.federationBetaFactor).toBe(0);
      expect(emergency.isFederationFrozen()).toBe(true);
    });
  });

  describe('Policy by State', () => {
    test('STRESSED policy has correct values', async () => {
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );

      const policy = emergency.getCurrentPolicy();
      expect(policy.limitFactor).toBe(1.0);
      expect(policy.newMemberLimitFactor).toBe(0.8);
      expect(policy.federationBetaFactor).toBe(0.7);
      expect(policy.admissionMode).toBe(AdmissionMode.BONDED);
      expect(policy.schedulerPriority).toBe(SchedulerPriority.ESSENTIALS_FIRST);
      expect(policy.debtorPriorityMatching).toBe(true);
    });

    test('PANIC policy has correct values', async () => {
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      const policy = emergency.getCurrentPolicy();
      expect(policy.limitFactor).toBe(0.8);
      expect(policy.newMemberLimitFactor).toBe(0.5);
      expect(policy.federationBetaFactor).toBe(0);
      expect(policy.admissionMode).toBe(AdmissionMode.SUPERMAJORITY_BONDED);
      expect(policy.commitmentMode).toBe(CommitmentMode.ESCROW_ALL);
      expect(policy.schedulerPriority).toBe(SchedulerPriority.SURVIVAL);
    });
  });

  describe('Forced De-escalation', () => {
    test('Cannot de-escalate from NORMAL', async () => {
      await expect(
        emergency.forceDeEscalation('Test', 'gov-1', 'admin')
      ).rejects.toThrow('Already in NORMAL state');
    });

    test('Can force de-escalate from STRESSED to NORMAL', async () => {
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );

      await emergency.forceDeEscalation('Crisis resolved', 'gov-2', 'admin');

      expect(emergency.getCurrentRiskState()).toBe(RiskState.NORMAL);
    });

    test('Can force de-escalate from PANIC to STRESSED (bypasses stabilization)', async () => {
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      // Force de-escalate immediately (no waiting for stabilization)
      await emergency.forceDeEscalation('Emergency override', 'gov-3', 'admin');

      expect(emergency.getCurrentRiskState()).toBe(RiskState.STRESSED);
    });
  });

  describe('Threshold Proximity Analysis', () => {
    test('Reports distance to escalation in NORMAL', async () => {
      await ledger.addMember('member1', 100);
      await emergency.updateIndicators();

      const report = emergency.analyzeThresholdProximity();

      expect(report.currentState).toBe(RiskState.NORMAL);
      expect(report.distanceToEscalation).toBeGreaterThan(0);
      expect(report.distanceToDeescalation).toBe(Infinity);
    });

    test('Reports stabilization time in PANIC', async () => {
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      const report = emergency.analyzeThresholdProximity();

      expect(report.currentState).toBe(RiskState.PANIC);
      expect(report.timeUntilStabilization).not.toBeNull();
      expect(report.timeUntilStabilization).toBeGreaterThan(0);
      expect(report.deescalationBlocked).toBe(true);
    });
  });

  describe('State History', () => {
    test('Records state transitions', async () => {
      const startTime = now();

      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1',
        'admin'
      );

      const history = await emergency.getStateHistory(startTime);

      expect(history.length).toBe(1);
      expect(history[0].fromState).toBe(RiskState.NORMAL);
      expect(history[0].toState).toBe(RiskState.STRESSED);
      expect(history[0].reason).toBe(TransitionReason.GOVERNANCE_OVERRIDE);
      expect(history[0].governanceApprovalId).toBe('gov-1');
      expect(history[0].initiatedBy).toBe('admin');
    });

    test('Records multiple transitions', async () => {
      const startTime = now();

      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      const history = await emergency.getStateHistory(startTime);

      expect(history.length).toBe(2);
      expect(history[0].toState).toBe(RiskState.STRESSED);
      expect(history[1].toState).toBe(RiskState.PANIC);
    });
  });

  describe('Effective Limit Factor', () => {
    test('Returns correct factor for existing members', () => {
      expect(emergency.getEffectiveLimitFactor(false)).toBe(1.0);
    });

    test('Returns correct factor for new members', () => {
      expect(emergency.getEffectiveLimitFactor(true)).toBe(1.0);
    });

    test('Returns reduced factor in STRESSED for new members', async () => {
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );

      expect(emergency.getEffectiveLimitFactor(false)).toBe(1.0);
      expect(emergency.getEffectiveLimitFactor(true)).toBe(0.8);
    });

    test('Returns reduced factor in PANIC for all members', async () => {
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );
      await emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-2'
      );

      expect(emergency.getEffectiveLimitFactor(false)).toBe(0.8);
      expect(emergency.getEffectiveLimitFactor(true)).toBe(0.5);
    });
  });

  describe('Invalid Transitions', () => {
    test('Cannot skip from NORMAL directly to PANIC', async () => {
      await expect(
        emergency.triggerStateChange(
          RiskState.PANIC,
          TransitionReason.INDICATOR_TRIGGERED
        )
      ).rejects.toThrow('Invalid transition');
    });

    test('Governance can override and jump states', async () => {
      // Governance override can go directly
      await emergency.triggerStateChange(
        RiskState.PANIC,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );

      expect(emergency.getCurrentRiskState()).toBe(RiskState.PANIC);
    });

    test('Cannot transition to same state', async () => {
      await expect(
        emergency.triggerStateChange(
          RiskState.NORMAL,
          TransitionReason.GOVERNANCE_OVERRIDE,
          'gov-1'
        )
      ).rejects.toThrow('Invalid transition');
    });
  });

  describe('Persistence', () => {
    test('State is saved to storage', async () => {
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );

      const result = await storage.getEmergencyState('test-cell');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value?.riskState).toBe(RiskState.STRESSED);
      }
    });

    test('State can be loaded from storage', async () => {
      await emergency.triggerStateChange(
        RiskState.STRESSED,
        TransitionReason.GOVERNANCE_OVERRIDE,
        'gov-1'
      );

      // Create new engine and load state
      const emergency2 = createEmergencyEngine('test-cell', ledger, storage);
      await emergency2.loadState();

      expect(emergency2.getCurrentRiskState()).toBe(RiskState.STRESSED);
    });
  });
});
