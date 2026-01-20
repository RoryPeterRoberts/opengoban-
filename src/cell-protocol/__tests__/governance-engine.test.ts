/**
 * Cell Protocol - Governance Engine Tests
 *
 * Tests for the Governance System (PRD-05).
 * Verifies council, proposals, voting, and disputes.
 */

import { createLedgerEngine } from '../engines/ledger-engine';
import { createTransactionEngine } from '../engines/transaction-engine';
import { createIdentityEngine } from '../engines/identity-engine';
import { createCommitmentEngine } from '../engines/commitment-engine';
import { GovernanceEngine, GovernanceValidationError, createGovernanceEngine } from '../engines/governance-engine';
import { createInMemoryStorage } from '../storage/pouchdb-adapter';
import { cryptoAdapter } from '../crypto/crypto-adapter';
import {
  ProposalType,
  ProposalStatus,
  ActionCategory,
  DisputeType,
  DisputeStatus,
  GovernanceErrorCode,
} from '../types/governance';
import { TaskCategory, CommitmentType } from '../types/commitment';
import { MembershipStatus, now } from '../types/common';

describe('GovernanceEngine', () => {
  let governance: GovernanceEngine;
  let storage: ReturnType<typeof createInMemoryStorage>;
  let ledger: Awaited<ReturnType<typeof createLedgerEngine>>;
  let identity: ReturnType<typeof createIdentityEngine>;
  let commitments: ReturnType<typeof createCommitmentEngine>;

  beforeEach(async () => {
    storage = createInMemoryStorage();
    ledger = await createLedgerEngine('test-cell', { defaultLimit: 100 }, storage);

    if (!cryptoAdapter.isInitialized()) {
      await cryptoAdapter.initialize();
    }

    identity = createIdentityEngine(ledger, storage, cryptoAdapter);
    const publicKeyResolver = async (memberId: string) => {
      const id = await identity.getIdentity(memberId);
      return id?.publicKey;
    };
    const transactions = createTransactionEngine(ledger, storage, cryptoAdapter, publicKeyResolver);
    commitments = createCommitmentEngine(ledger, transactions, storage);
    governance = createGovernanceEngine('test-cell', ledger, identity, commitments, storage);

    // Add test members
    await ledger.addMember('council1');
    await ledger.addMember('council2');
    await ledger.addMember('council3');
    await ledger.addMember('member1');
    await ledger.addMember('member2');

    // Initialize council
    await governance.initializeCouncil([
      {
        memberId: 'council1',
        role: 'CHAIR',
        termStart: now(),
        termEnd: now() + (90 * 24 * 60 * 60 * 1000),
      },
      {
        memberId: 'council2',
        role: 'MEMBER',
        termStart: now(),
        termEnd: now() + (90 * 24 * 60 * 60 * 1000),
      },
      {
        memberId: 'council3',
        role: 'MEMBER',
        termStart: now(),
        termEnd: now() + (90 * 24 * 60 * 60 * 1000),
      },
    ]);
  });

  describe('Council Management', () => {
    test('Council is initialized correctly', async () => {
      const council = await governance.getCouncil();
      expect(council).toBeDefined();
      expect(council?.members.length).toBe(3);
      expect(council?.cellId).toBe('test-cell');
    });

    test('isCouncilMember correctly identifies members', async () => {
      expect(await governance.isCouncilMember('council1')).toBe(true);
      expect(await governance.isCouncilMember('council2')).toBe(true);
      expect(await governance.isCouncilMember('member1')).toBe(false);
    });
  });

  describe('Proposals', () => {
    test('GV-01: Create proposal succeeds', async () => {
      const proposal = await governance.createProposal({
        type: ProposalType.LIMIT_ADJUSTMENT,
        proposer: 'council1',
        payload: {
          type: ProposalType.LIMIT_ADJUSTMENT,
          memberId: 'member1',
          newLimit: 150,
          reason: 'Good standing',
        },
        description: 'Increase limit for member1',
      });

      expect(proposal.id).toBeDefined();
      expect(proposal.type).toBe(ProposalType.LIMIT_ADJUSTMENT);
      expect(proposal.status).toBe(ProposalStatus.OPEN);
      expect(proposal.proposer).toBe('council1');
      expect(proposal.votes).toHaveLength(0);
    });

    test('Non-council member cannot create proposal', async () => {
      await expect(governance.createProposal({
        type: ProposalType.LIMIT_ADJUSTMENT,
        proposer: 'member1', // Not council member
        payload: {
          type: ProposalType.LIMIT_ADJUSTMENT,
          memberId: 'member2',
          newLimit: 150,
          reason: 'Test',
        },
      })).rejects.toThrow('not a council member');
    });

    test('GV-02: Cast vote updates proposal', async () => {
      const proposal = await governance.createProposal({
        type: ProposalType.LIMIT_ADJUSTMENT,
        proposer: 'council1',
        payload: {
          type: ProposalType.LIMIT_ADJUSTMENT,
          memberId: 'member1',
          newLimit: 150,
          reason: 'Good standing',
        },
      });

      const updated = await governance.castVote(proposal.id, {
        voterId: 'council2',
        decision: 'APPROVE',
        signature: 'test-sig',
        timestamp: now(),
      });

      expect(updated.votes.length).toBe(1);
      expect(updated.votes[0].voterId).toBe('council2');
      expect(updated.votes[0].decision).toBe('APPROVE');
    });

    test('Cannot vote twice', async () => {
      const proposal = await governance.createProposal({
        type: ProposalType.LIMIT_ADJUSTMENT,
        proposer: 'council1',
        payload: {
          type: ProposalType.LIMIT_ADJUSTMENT,
          memberId: 'member1',
          newLimit: 150,
          reason: 'Test',
        },
      });

      await governance.castVote(proposal.id, {
        voterId: 'council2',
        decision: 'APPROVE',
        signature: 'sig',
        timestamp: now(),
      });

      await expect(governance.castVote(proposal.id, {
        voterId: 'council2',
        decision: 'REJECT',
        signature: 'sig',
        timestamp: now(),
      })).rejects.toThrow('already voted');
    });

    test('GV-03: Quorum calculation correct', async () => {
      const proposal = await governance.createProposal({
        type: ProposalType.LIMIT_ADJUSTMENT,
        proposer: 'council1',
        payload: {
          type: ProposalType.LIMIT_ADJUSTMENT,
          memberId: 'member1',
          newLimit: 150,
          reason: 'Test',
        },
      });

      // Only 1 vote out of 3 = 33%, below 50% quorum
      await governance.castVote(proposal.id, {
        voterId: 'council1',
        decision: 'APPROVE',
        signature: 'sig',
        timestamp: now(),
      });

      const closed = await governance.closeVoting(proposal.id);
      expect(closed.status).toBe(ProposalStatus.REJECTED); // No quorum
    });

    test('GV-04: Supermajority threshold enforced for critical actions', async () => {
      // MEMBER_EXCLUSION requires supermajority (67%)
      const proposal = await governance.createProposal({
        type: ProposalType.MEMBER_EXCLUSION,
        proposer: 'council1',
        payload: {
          type: ProposalType.MEMBER_EXCLUSION,
          memberId: 'member1',
          reason: 'Violation',
        },
      });

      // 2 approve, 1 reject = 66%, below 67%
      await governance.castVote(proposal.id, {
        voterId: 'council1',
        decision: 'APPROVE',
        signature: 'sig',
        timestamp: now(),
      });

      await governance.castVote(proposal.id, {
        voterId: 'council2',
        decision: 'APPROVE',
        signature: 'sig',
        timestamp: now(),
      });

      await governance.castVote(proposal.id, {
        voterId: 'council3',
        decision: 'REJECT',
        signature: 'sig',
        timestamp: now(),
      });

      const closed = await governance.closeVoting(proposal.id);
      expect(closed.status).toBe(ProposalStatus.REJECTED); // Below supermajority
    });

    test('Proposal passes with supermajority', async () => {
      // Non-critical action with majority
      const proposal = await governance.createProposal({
        type: ProposalType.LIMIT_ADJUSTMENT,
        proposer: 'council1',
        payload: {
          type: ProposalType.LIMIT_ADJUSTMENT,
          memberId: 'member1',
          newLimit: 150,
          reason: 'Test',
        },
      });

      await governance.castVote(proposal.id, {
        voterId: 'council1',
        decision: 'APPROVE',
        signature: 'sig',
        timestamp: now(),
      });

      await governance.castVote(proposal.id, {
        voterId: 'council2',
        decision: 'APPROVE',
        signature: 'sig',
        timestamp: now(),
      });

      const closed = await governance.closeVoting(proposal.id);
      expect(closed.status).toBe(ProposalStatus.PASSED);
    });

    test('GV-06: Execute LIMIT_ADJUSTMENT works', async () => {
      const proposal = await governance.createProposal({
        type: ProposalType.LIMIT_ADJUSTMENT,
        proposer: 'council1',
        payload: {
          type: ProposalType.LIMIT_ADJUSTMENT,
          memberId: 'member1',
          newLimit: 200,
          reason: 'Increase',
        },
      });

      // Get all votes for majority
      await governance.castVote(proposal.id, {
        voterId: 'council1',
        decision: 'APPROVE',
        signature: 'sig',
        timestamp: now(),
      });
      await governance.castVote(proposal.id, {
        voterId: 'council2',
        decision: 'APPROVE',
        signature: 'sig',
        timestamp: now(),
      });

      await governance.closeVoting(proposal.id);
      await governance.executeProposal(proposal.id);

      // Verify limit was updated
      const memberState = ledger.getMemberState('member1');
      expect(memberState?.limit).toBe(200);

      // Verify proposal is executed
      const executed = await governance.getProposal(proposal.id);
      expect(executed?.status).toBe(ProposalStatus.EXECUTED);
    });
  });

  describe('Direct Actions', () => {
    test('GV-09: Non-council member cannot execute direct action', async () => {
      await expect(governance.adjustLimit('member1', 200, 'member2'))
        .rejects.toThrow('not a council member');
    });

    test('Council member can adjust limit directly', async () => {
      await governance.adjustLimit('member1', 150, 'council1');

      const memberState = ledger.getMemberState('member1');
      expect(memberState?.limit).toBe(150);
    });

    test('Cannot exclude member with non-zero balance', async () => {
      // Give member1 a balance
      await ledger.applyBalanceUpdates([
        { memberId: 'member1', delta: 50, reason: 'SPOT_TRANSACTION_PAYEE' as any },
        { memberId: 'member2', delta: -50, reason: 'SPOT_TRANSACTION_PAYER' as any },
      ]);

      await expect(governance.excludeMember('member1', 'Test', 'council1'))
        .rejects.toThrow('non-zero balance');
    });
  });

  describe('Disputes', () => {
    test('GV-07: File dispute succeeds', async () => {
      const dispute = await governance.fileDispute({
        type: DisputeType.NON_DELIVERY,
        complainant: 'member1',
        respondent: 'member2',
        description: 'Did not deliver promised service',
      });

      expect(dispute.id).toBeDefined();
      expect(dispute.type).toBe(DisputeType.NON_DELIVERY);
      expect(dispute.status).toBe(DisputeStatus.FILED);
      expect(dispute.complainant).toBe('member1');
      expect(dispute.respondent).toBe('member2');
    });

    test('Can assign reviewer to dispute', async () => {
      const dispute = await governance.fileDispute({
        type: DisputeType.QUALITY,
        complainant: 'member1',
        respondent: 'member2',
        description: 'Poor quality work',
      });

      const updated = await governance.assignDisputeReviewer(dispute.id, 'council1');

      expect(updated.reviewer).toBe('council1');
      expect(updated.status).toBe(DisputeStatus.UNDER_REVIEW);
    });

    test('Reviewer cannot be party to dispute', async () => {
      const dispute = await governance.fileDispute({
        type: DisputeType.FRAUD,
        complainant: 'council1',
        respondent: 'member2',
        description: 'Suspected fraud',
      });

      await expect(governance.assignDisputeReviewer(dispute.id, 'council1'))
        .rejects.toThrow('cannot be a party');
    });

    test('GV-08: Resolve dispute works', async () => {
      const dispute = await governance.fileDispute({
        type: DisputeType.NON_DELIVERY,
        complainant: 'member1',
        respondent: 'member2',
        description: 'Non-delivery',
      });

      await governance.assignDisputeReviewer(dispute.id, 'council1');

      const resolved = await governance.resolveDispute(dispute.id, {
        outcome: 'COMPLAINANT_WINS',
        explanation: 'Evidence supports non-delivery claim',
        decidedBy: 'council1',
        decidedAt: now(),
      });

      expect(resolved.status).toBe(DisputeStatus.RESOLVED);
      expect(resolved.resolution?.outcome).toBe('COMPLAINANT_WINS');
    });

    test('Can add evidence to open dispute', async () => {
      const dispute = await governance.fileDispute({
        type: DisputeType.QUALITY,
        complainant: 'member1',
        respondent: 'member2',
        description: 'Quality issue',
      });

      const updated = await governance.addEvidence(dispute.id, {
        submittedBy: 'member1',
        type: 'TEXT',
        content: 'Additional details about the issue',
      });

      expect(updated.evidence.length).toBe(1);
      expect(updated.evidence[0].type).toBe('TEXT');
    });
  });

  describe('Action Categories', () => {
    test('Action categories are correctly identified', () => {
      expect(governance.getActionCategory(ProposalType.MEMBER_ADMISSION))
        .toBe(ActionCategory.SIGNIFICANT);
      expect(governance.getActionCategory(ProposalType.MEMBER_EXCLUSION))
        .toBe(ActionCategory.CRITICAL);
      expect(governance.getActionCategory(ProposalType.LIMIT_ADJUSTMENT))
        .toBe(ActionCategory.SIGNIFICANT);
      expect(governance.getActionCategory(ProposalType.COUNCIL_ELECTION))
        .toBe(ActionCategory.CONSTITUTIONAL);
    });
  });

  describe('Query Methods', () => {
    test('getActiveProposals returns open proposals', async () => {
      await governance.createProposal({
        type: ProposalType.LIMIT_ADJUSTMENT,
        proposer: 'council1',
        payload: {
          type: ProposalType.LIMIT_ADJUSTMENT,
          memberId: 'member1',
          newLimit: 150,
          reason: 'Test',
        },
      });

      await governance.createProposal({
        type: ProposalType.LIMIT_ADJUSTMENT,
        proposer: 'council2',
        payload: {
          type: ProposalType.LIMIT_ADJUSTMENT,
          memberId: 'member2',
          newLimit: 150,
          reason: 'Test 2',
        },
      });

      const active = await governance.getActiveProposals();
      expect(active.length).toBe(2);
    });

    test('getActiveDisputes returns open disputes', async () => {
      await governance.fileDispute({
        type: DisputeType.NON_DELIVERY,
        complainant: 'member1',
        respondent: 'member2',
        description: 'Issue 1',
      });

      const dispute2 = await governance.fileDispute({
        type: DisputeType.QUALITY,
        complainant: 'member2',
        respondent: 'member1',
        description: 'Issue 2',
      });

      // Resolve one
      await governance.assignDisputeReviewer(dispute2.id, 'council1');
      await governance.resolveDispute(dispute2.id, {
        outcome: 'DISMISSED',
        explanation: 'No merit',
        decidedBy: 'council1',
        decidedAt: now(),
      });

      const active = await governance.getActiveDisputes();
      expect(active.length).toBe(1);
    });
  });
});
