/**
 * Cell Protocol - Hardening: Sybil Resistance Tests
 *
 * Unit tests for sponsor bonds, service bonds, probation, and reputation.
 */

import { createCellProtocol, CellProtocol } from '../../index';
import {
  SponsorBondEngine,
  createSponsorBondEngine,
  ServiceBondEngine,
  createServiceBondEngine,
  ProbationTracker,
  createProbationTracker,
  ReputationSignals,
  createReputationSignals,
  DEFAULT_SPONSOR_BOND_CONFIG,
  DEFAULT_SERVICE_BOND_CONFIG,
  DEFAULT_PROBATION_CONFIG,
  DEFAULT_REPUTATION_CONFIG,
} from '../../hardening';
import { MembershipStatus, now } from '../../types/common';

describe('Hardening: Sybil Resistance', () => {
  let protocol: CellProtocol;

  beforeEach(async () => {
    protocol = await createCellProtocol({
      cellId: 'sybil-test-cell',
    });
  });

  describe('Sponsor Bond Engine', () => {
    let sponsorBonds: SponsorBondEngine;

    beforeEach(async () => {
      // Use a config with no tenure requirement for testing
      sponsorBonds = createSponsorBondEngine(
        protocol.ledger,
        protocol.storage,
        { minSponsorTenureDays: 0 } // No tenure requirement for tests
      );

      // Add a sponsor member
      await protocol.identity.addMember({
        applicantId: 'sponsor-1',
        displayName: 'Sponsor 1',
        publicKey: 'pk_sponsor1_at_least_32_chars_long',
        requestedAt: now(),
        initialLimit: 5000,
      });
    });

    test('creates sponsor bond', async () => {
      // Add sponsee
      await protocol.ledger.addMember('sponsee-1', 1000);

      const bond = await sponsorBonds.createBond({
        sponsorId: 'sponsor-1',
        sponseeId: 'sponsee-1',
      });

      expect(bond.id).toBeDefined();
      expect(bond.sponsorId).toBe('sponsor-1');
      expect(bond.sponseeId).toBe('sponsee-1');
      expect(bond.status).toBe('ACTIVE');
      expect(bond.bondAmount).toBeGreaterThan(0);
    });

    test('checks sponsor eligibility', async () => {
      const eligibility = await sponsorBonds.canSponsor('sponsor-1');
      expect(eligibility.eligible).toBe(true);
    });

    test('rejects ineligible sponsor', async () => {
      // Non-existent sponsor
      const eligibility = await sponsorBonds.canSponsor('non-existent');
      expect(eligibility.eligible).toBe(false);
    });

    test('releases bond on graduation', async () => {
      await protocol.ledger.addMember('sponsee-2', 1000);

      const bond = await sponsorBonds.createBond({
        sponsorId: 'sponsor-1',
        sponseeId: 'sponsee-2',
      });

      const released = await sponsorBonds.releaseBond(bond.id, 'Graduated');

      expect(released.status).toBe('RELEASED');
      expect(released.resolvedAt).toBeDefined();
    });

    test('forfeits bond on default', async () => {
      await protocol.ledger.addMember('sponsee-3', 1000);

      const bond = await sponsorBonds.createBond({
        sponsorId: 'sponsor-1',
        sponseeId: 'sponsee-3',
      });

      const forfeited = await sponsorBonds.forfeitBond(bond.id, 500, 'Sponsee defaulted');

      expect(forfeited.status).toBe('FORFEITED');
      expect(forfeited.amountForfeited).toBeDefined();
      expect(forfeited.amountForfeited).toBeLessThanOrEqual(bond.bondAmount);
    });

    test('tracks sponsor statistics', async () => {
      await protocol.ledger.addMember('sponsee-4', 1000);
      await sponsorBonds.createBond({
        sponsorId: 'sponsor-1',
        sponseeId: 'sponsee-4',
      });

      const stats = sponsorBonds.getSponsorStats('sponsor-1');

      expect(stats.totalSponsored).toBe(1);
      expect(stats.activeSponsees).toBe(1);
      expect(stats.activeBondAmount).toBeGreaterThan(0);
    });

    test('limits sponsor capacity', async () => {
      // Add maximum sponsees
      for (let i = 0; i < DEFAULT_SPONSOR_BOND_CONFIG.maxActiveSponsees; i++) {
        await protocol.ledger.addMember(`max-sponsee-${i}`, 1000);
        await sponsorBonds.createBond({
          sponsorId: 'sponsor-1',
          sponseeId: `max-sponsee-${i}`,
        });
      }

      // Should not be able to sponsor more
      const eligibility = await sponsorBonds.canSponsor('sponsor-1');
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.reason).toContain('maximum');
    });
  });

  describe('Service Bond Engine', () => {
    let serviceBonds: ServiceBondEngine;

    beforeEach(async () => {
      // Use a config with high daily limit for testing graduation
      serviceBonds = createServiceBondEngine(
        protocol.ledger,
        protocol.storage,
        { maxHoursPerDay: 100 } // High limit for tests
      );

      // Add a new member
      await protocol.identity.addMember({
        applicantId: 'new-member-1',
        displayName: 'New Member 1',
        publicKey: 'pk_newmember1_at_least_32_chars_',
        requestedAt: now(),
        initialLimit: 1000,
      });
    });

    test('creates service bond for new member', async () => {
      const bond = await serviceBonds.createBond('new-member-1');

      expect(bond.id).toBeDefined();
      expect(bond.memberId).toBe('new-member-1');
      expect(bond.status).toBe('ACTIVE');
      expect(bond.requiredHours).toBe(DEFAULT_SERVICE_BOND_CONFIG.requiredHours);
      expect(bond.completedHours).toBe(0);
      expect(bond.limitDuringBond).toBeLessThan(bond.fullLimit);
    });

    test('records service completion', async () => {
      const bond = await serviceBonds.createBond('new-member-1');

      const updated = await serviceBonds.recordService({
        memberId: 'new-member-1',
        commitmentId: 'commitment-1',
        hours: 2,
        rating: 4.5,
        verifiedBy: 'verifier-1',
      });

      expect(updated.completedHours).toBe(2);
    });

    test('graduates member after completing hours', async () => {
      const bond = await serviceBonds.createBond('new-member-1');

      // Complete required hours
      for (let i = 0; i < bond.requiredHours; i += 2) {
        await serviceBonds.recordService({
          memberId: 'new-member-1',
          commitmentId: `commitment-${i}`,
          hours: 2,
          rating: 4.0,
          verifiedBy: 'verifier-1',
        });
      }

      const finalBond = serviceBonds.getBondByMember('new-member-1');
      expect(finalBond?.status).toBe('GRADUATED');
    });

    test('tracks progress', async () => {
      await serviceBonds.createBond('new-member-1');

      await serviceBonds.recordService({
        memberId: 'new-member-1',
        commitmentId: 'commitment-1',
        hours: 5,
        rating: 4.0,
        verifiedBy: 'verifier-1',
      });

      const progress = serviceBonds.getProgress('new-member-1');

      expect(progress).toBeDefined();
      expect(progress!.hoursCompleted).toBe(5);
      expect(progress!.progressPercent).toBeGreaterThan(0);
    });

    test('limits daily hours', async () => {
      // Create a fresh engine with default config (8 hours per day limit)
      const defaultServiceBonds = createServiceBondEngine(
        protocol.ledger,
        protocol.storage,
        {} // Use defaults
      );
      await defaultServiceBonds.createBond('new-member-1');

      // First entry should succeed (using exact default limit)
      await defaultServiceBonds.recordService({
        memberId: 'new-member-1',
        commitmentId: 'commitment-1',
        hours: DEFAULT_SERVICE_BOND_CONFIG.maxHoursPerDay,
        rating: 4.0,
        verifiedBy: 'verifier-1',
      });

      // Second entry should fail (daily limit reached)
      await expect(defaultServiceBonds.recordService({
        memberId: 'new-member-1',
        commitmentId: 'commitment-2',
        hours: 1,
        rating: 4.0,
        verifiedBy: 'verifier-1',
      })).rejects.toThrow();
    });
  });

  describe('Probation Tracker', () => {
    let probation: ProbationTracker;

    beforeEach(async () => {
      probation = createProbationTracker(
        protocol.ledger,
        protocol.storage
      );

      // Add a member
      await protocol.identity.addMember({
        applicantId: 'probation-member-1',
        displayName: 'Probation Member 1',
        publicKey: 'pk_probation1_at_least_32_chars_',
        requestedAt: now(),
        initialLimit: 1000,
      });
    });

    test('starts probation for member', async () => {
      const state = await probation.startProbation('probation-member-1', 90);

      expect(state.memberId).toBe('probation-member-1');
      expect(state.status).toBe('PROBATION');
      expect(state.scheduledEndAt).toBeGreaterThan(state.startedAt);
    });

    test('applies restrictions during probation', async () => {
      await probation.startProbation('probation-member-1', 90);

      const restrictions = probation.getRestrictions('probation-member-1');

      expect(restrictions).toBeDefined();
      expect(restrictions!.limitMultiplier).toBeLessThanOrEqual(1);
    });

    test('checks action permissions', async () => {
      await probation.startProbation('probation-member-1', 90);

      // Transactions should be allowed
      expect(probation.canPerformAction('probation-member-1', 'transaction')).toBe(true);

      // Governance voting may be restricted
      const canVote = probation.canPerformAction('probation-member-1', 'governance');
      expect(typeof canVote).toBe('boolean');
    });

    test('issues warnings', async () => {
      await probation.startProbation('probation-member-1', 90);

      const state = await probation.issueWarning(
        'probation-member-1',
        'LIMIT_VIOLATION',
        'Test warning',
        'admin-1'
      );

      expect(state.warnings.length).toBe(1);
      expect(state.warnings[0].type).toBe('LIMIT_VIOLATION');
    });

    test('graduates member successfully', async () => {
      await probation.startProbation('probation-member-1', 0);

      // Update progress to meet requirements - this should trigger auto-graduation
      // since probation duration is 0 days and checkGraduation is called
      const state = await probation.updateProgress('probation-member-1', {
        commitmentsFulfilled: DEFAULT_PROBATION_CONFIG.minCommitmentsForGraduation,
      });

      // Member should be graduated automatically by checkGraduation
      expect(state.status).toBe('GRADUATED');
      expect(state.graduatedAt).toBeDefined();
    });

    test('fails probation on excessive warnings', async () => {
      await probation.startProbation('probation-member-1', 90);

      // Issue maximum warnings
      for (let i = 0; i < DEFAULT_PROBATION_CONFIG.maxWarnings; i++) {
        try {
          await probation.issueWarning(
            'probation-member-1',
            'LIMIT_VIOLATION',
            `Warning ${i + 1}`,
            'admin-1'
          );
        } catch {
          // May throw if probation already failed
        }
      }

      const state = probation.getProbationState('probation-member-1');
      expect(state?.status).toBe('FAILED');
    });

    test('gets all members on probation', async () => {
      // Add another member
      await protocol.identity.addMember({
        applicantId: 'probation-member-2',
        displayName: 'Probation Member 2',
        publicKey: 'pk_probation2_at_least_32_chars_',
        requestedAt: now(),
        initialLimit: 1000,
      });

      await probation.startProbation('probation-member-1', 90);
      await probation.startProbation('probation-member-2', 90);

      const allOnProbation = probation.getAllOnProbation();

      expect(allOnProbation.length).toBe(2);
    });
  });

  describe('Reputation Signals', () => {
    let reputation: ReputationSignals;

    beforeEach(async () => {
      reputation = createReputationSignals(
        protocol.ledger,
        protocol.commitments,
        protocol.storage
      );

      // Add members
      await protocol.identity.addMember({
        applicantId: 'rep-member-1',
        displayName: 'Reputation Member 1',
        publicKey: 'pk_rep1_at_least_32_chars_long_here',
        requestedAt: now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
        initialLimit: 1000,
      });
    });

    test('computes reputation signal', async () => {
      const signal = await reputation.computeReputation('rep-member-1');

      expect(signal.memberId).toBe('rep-member-1');
      expect(signal.score).toBeGreaterThanOrEqual(0);
      expect(signal.score).toBeLessThanOrEqual(100);
      expect(signal.components).toBeDefined();
    });

    test('reputation components are calculated', async () => {
      const signal = await reputation.computeReputation('rep-member-1');

      expect(signal.components.tenure).toBeDefined();
      expect(signal.components.fulfillment).toBeDefined();
      expect(signal.components.transactions).toBeDefined();
    });

    test('caches computed reputation', async () => {
      await reputation.computeReputation('rep-member-1');

      const cached = reputation.getReputation('rep-member-1');

      expect(cached).toBeDefined();
      expect(cached!.memberId).toBe('rep-member-1');
    });

    test('gets reputation score', async () => {
      await reputation.computeReputation('rep-member-1');

      const score = reputation.getScore('rep-member-1');

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    test('detects low reputation', async () => {
      await reputation.computeReputation('rep-member-1');

      const isLow = reputation.isLowReputation('rep-member-1');

      expect(typeof isLow).toBe('boolean');
    });

    test('gets leaderboard', async () => {
      // Add more members
      await protocol.identity.addMember({
        applicantId: 'rep-member-2',
        displayName: 'Reputation Member 2',
        publicKey: 'pk_rep2_at_least_32_chars_long_here',
        requestedAt: now() - 60 * 24 * 60 * 60 * 1000,
        initialLimit: 1000,
      });

      await reputation.computeReputation('rep-member-1');
      await reputation.computeReputation('rep-member-2');

      const leaderboard = reputation.getLeaderboard(10);

      expect(leaderboard.length).toBe(2);
      // Should be sorted by score descending
      if (leaderboard.length >= 2) {
        expect(leaderboard[0].score).toBeGreaterThanOrEqual(leaderboard[1].score);
      }
    });

    test('detects Sybil patterns', async () => {
      const detection = await reputation.detectSybilPatterns('rep-member-1');

      expect(detection.memberId).toBe('rep-member-1');
      expect(typeof detection.isLikelySybil).toBe('boolean');
      expect(detection.confidence).toBeGreaterThanOrEqual(0);
      expect(detection.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(detection.patterns)).toBe(true);
    });

    test('compares reputations', async () => {
      await protocol.identity.addMember({
        applicantId: 'rep-member-3',
        displayName: 'Reputation Member 3',
        publicKey: 'pk_rep3_at_least_32_chars_long_here',
        requestedAt: now() - 10 * 24 * 60 * 60 * 1000,
        initialLimit: 1000,
      });

      await reputation.computeReputation('rep-member-1');
      await reputation.computeReputation('rep-member-3');

      const comparison = reputation.compareReputations('rep-member-1', 'rep-member-3');

      expect(comparison.score1).toBeDefined();
      expect(comparison.score2).toBeDefined();
      expect(comparison.difference).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Integration: Identity Engine with Sybil', () => {
    test('creates member with sybil resistance', async () => {
      // Use no tenure requirement for testing
      const sponsorBonds = createSponsorBondEngine(protocol.ledger, protocol.storage, { minSponsorTenureDays: 0 });
      const serviceBonds = createServiceBondEngine(protocol.ledger, protocol.storage);
      const probation = createProbationTracker(protocol.ledger, protocol.storage);
      const reputation = createReputationSignals(protocol.ledger, protocol.commitments, protocol.storage);

      // Configure identity engine with Sybil resistance
      protocol.identity.configureSybilResistance({
        sponsorBonds,
        serviceBonds,
        probation,
        reputation,
      });

      // Add a sponsor first
      await protocol.identity.addMember({
        applicantId: 'integration-sponsor',
        displayName: 'Integration Sponsor',
        publicKey: 'pk_int_sponsor_at_least_32_chars_',
        requestedAt: now(),
        initialLimit: 5000,
      });

      // Add member with full Sybil resistance
      const result = await protocol.identity.addMemberWithSybilResistance({
        applicantId: 'integration-member',
        displayName: 'Integration Member',
        publicKey: 'pk_int_member_at_least_32_chars__',
        sponsorId: 'integration-sponsor',
        requireSponsorBond: true,
        requireServiceBond: true,
        startWithProbation: true,
        probationDays: 30,
        requestedAt: now(),
        initialLimit: 1000,
      });

      expect(result.approved).toBe(true);
      expect(result.sponsorBondId).toBeDefined();
      expect(result.serviceBondId).toBeDefined();
      expect(result.onProbation).toBe(true);
    });
  });
});
