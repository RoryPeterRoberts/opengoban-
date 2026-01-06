/**
 * OpenGoban Validation & Defense Module
 *
 * Implements defensive measures against malicious actors and edge cases:
 * - Circuit Breaker (max transaction limits)
 * - Entry Limits (new users start with 0 credit limit)
 * - Double-Spend Detection (freeze accounts that breach limits)
 * - Dispute System (flag problematic transactions)
 * - Social Recovery (Phoenix Account migration)
 * - Debt Forgiveness (Jubilee Protocol)
 */

const OGValidation = (function() {
  'use strict';

  // ========================================
  // CONFIGURATION
  // ========================================

  const LIMITS = {
    // Circuit breaker - max single transaction
    MAX_TRANSACTION: 100,

    // Default credit limit for new members (0 = must earn before spend)
    NEW_MEMBER_CREDIT_LIMIT: 0,

    // Credit limit progression (months active -> limit)
    CREDIT_LIMIT_PROGRESSION: [
      { months: 0, limit: 0 },      // Day 1: Can't go negative
      { months: 1, limit: -10 },    // 1 month: Small trust
      { months: 3, limit: -25 },    // 3 months: Growing trust
      { months: 6, limit: -50 },    // 6 months: Full trust
      { months: 12, limit: -100 }   // 1 year: Extended trust
    ],

    // Elder requirements for multi-sig operations
    MIN_ELDERS_FOR_RECOVERY: 3,
    MIN_ELDERS_FOR_FORGIVENESS: 3,

    // Freeze threshold (how far over limit triggers freeze)
    FREEZE_THRESHOLD: 0  // Any breach triggers freeze
  };

  // ========================================
  // CIRCUIT BREAKER
  // ========================================

  /**
   * Validate transaction amount before sending
   * Returns { valid: boolean, error?: string }
   */
  function validateTransactionAmount(amount, senderBalance, senderCreditLimit) {
    // Check positive amount
    if (amount <= 0) {
      return { valid: false, error: 'Amount must be positive' };
    }

    // Circuit breaker - max transaction size
    if (amount > LIMITS.MAX_TRANSACTION) {
      return {
        valid: false,
        error: `CIRCUIT BREAKER: Transaction exceeds ${LIMITS.MAX_TRANSACTION} credit limit. Split into smaller transactions.`
      };
    }

    // Check credit limit
    const newBalance = senderBalance - amount;
    if (newBalance < senderCreditLimit) {
      return {
        valid: false,
        error: `Insufficient credit. Balance: ${senderBalance}, Limit: ${senderCreditLimit}, Need: ${senderCreditLimit - newBalance} more credits.`
      };
    }

    return { valid: true };
  }

  // ========================================
  // ENTRY LIMITS (Credit Limit Progression)
  // ========================================

  /**
   * Calculate credit limit for a member based on tenure
   */
  function calculateCreditLimit(memberCreatedAt, manualOverride = null) {
    // If elder has set a manual limit, use that
    if (manualOverride !== null) {
      return manualOverride;
    }

    const created = new Date(memberCreatedAt);
    const now = new Date();
    const monthsActive = (now - created) / (1000 * 60 * 60 * 24 * 30);

    // Find the appropriate limit tier
    let limit = LIMITS.NEW_MEMBER_CREDIT_LIMIT;
    for (const tier of LIMITS.CREDIT_LIMIT_PROGRESSION) {
      if (monthsActive >= tier.months) {
        limit = tier.limit;
      }
    }

    return limit;
  }

  /**
   * Get member's effective credit limit
   */
  async function getMemberCreditLimit(member) {
    // Check for manual override from elders
    if (member.credit_limit_override !== undefined) {
      return member.credit_limit_override;
    }

    return calculateCreditLimit(member.created_at);
  }

  // ========================================
  // DOUBLE-SPEND DETECTION
  // ========================================

  /**
   * Detect double-spend after sync
   * Returns list of members who have breached their limits
   */
  async function detectLimitBreaches(db) {
    const breaches = [];

    // Get all members
    const memberResult = await db.allDocs({
      include_docs: true,
      startkey: 'member_',
      endkey: 'member_\uffff'
    });

    for (const row of memberResult.rows) {
      const member = row.doc;
      if (member.status === 'frozen') continue; // Already frozen

      const balance = await calculateBalance(db, member._id);
      const creditLimit = await getMemberCreditLimit(member);

      if (balance < creditLimit - LIMITS.FREEZE_THRESHOLD) {
        breaches.push({
          member_id: member._id,
          handle: member.handle,
          balance: balance,
          credit_limit: creditLimit,
          breach_amount: creditLimit - balance
        });
      }
    }

    return breaches;
  }

  /**
   * Calculate balance for a member (internal helper)
   */
  async function calculateBalance(db, memberId) {
    const result = await db.allDocs({
      include_docs: true,
      startkey: 'tx_',
      endkey: 'tx_\uffff'
    });

    let balance = 0;
    for (const row of result.rows) {
      const tx = row.doc;
      if (tx.status !== 'confirmed') continue;

      if (tx.recipient_id === memberId) balance += tx.amount;
      if (tx.sender_id === memberId) balance -= tx.amount;
    }

    return balance;
  }

  /**
   * Freeze an account due to limit breach
   */
  async function freezeAccount(db, memberId, reason) {
    const member = await db.get(memberId);

    if (member.status === 'frozen') {
      return { already_frozen: true };
    }

    member.status = 'frozen';
    member.frozen_at = new Date().toISOString();
    member.frozen_reason = reason;
    member.updated_at = new Date().toISOString();

    await db.put(member);

    // Create freeze record for audit trail
    const freezeRecord = {
      _id: `freeze_${Date.now()}_${memberId.substring(7, 15)}`,
      type: 'account_freeze',
      member_id: memberId,
      reason: reason,
      created_at: new Date().toISOString()
    };
    await db.put(freezeRecord);

    console.log('[Validation] Account frozen:', member.handle, reason);
    return { frozen: true, member };
  }

  /**
   * Unfreeze account (requires balance to be above limit)
   */
  async function unfreezeAccount(db, memberId) {
    const member = await db.get(memberId);

    if (member.status !== 'frozen') {
      return { error: 'Account is not frozen' };
    }

    const balance = await calculateBalance(db, memberId);
    const creditLimit = await getMemberCreditLimit(member);

    if (balance < creditLimit) {
      return {
        error: `Cannot unfreeze: balance ${balance} still below limit ${creditLimit}. Needs ${creditLimit - balance} more credits.`
      };
    }

    member.status = 'active';
    delete member.frozen_at;
    delete member.frozen_reason;
    member.updated_at = new Date().toISOString();

    await db.put(member);

    console.log('[Validation] Account unfrozen:', member.handle);
    return { unfrozen: true, member };
  }

  // ========================================
  // DISPUTE SYSTEM
  // ========================================

  /**
   * Create a dispute for a transaction
   */
  async function createDispute(db, transactionId, disputerId, reason) {
    const tx = await db.get(transactionId);

    if (!tx || tx.type !== 'transaction') {
      throw new Error('Transaction not found');
    }

    // Only sender or recipient can dispute
    if (tx.sender_id !== disputerId && tx.recipient_id !== disputerId) {
      throw new Error('Only transaction parties can create disputes');
    }

    const dispute = {
      _id: `dispute_${Date.now()}_${transactionId.substring(3, 11)}`,
      type: 'dispute',
      transaction_id: transactionId,
      disputer_id: disputerId,
      disputed_party_id: tx.sender_id === disputerId ? tx.recipient_id : tx.sender_id,
      reason: reason,
      amount: tx.amount,
      status: 'open',
      created_at: new Date().toISOString()
    };

    await db.put(dispute);

    console.log('[Dispute] Created:', dispute._id);
    return dispute;
  }

  /**
   * Resolve a dispute
   */
  async function resolveDispute(db, disputeId, resolution, resolverIds) {
    const dispute = await db.get(disputeId);

    if (dispute.status !== 'open') {
      throw new Error('Dispute is not open');
    }

    dispute.status = 'resolved';
    dispute.resolution = resolution; // 'refunded', 'dismissed', 'partial'
    dispute.resolved_by = resolverIds;
    dispute.resolved_at = new Date().toISOString();

    await db.put(dispute);

    console.log('[Dispute] Resolved:', disputeId, resolution);
    return dispute;
  }

  /**
   * Get open disputes for a member
   */
  async function getDisputesForMember(db, memberId) {
    const result = await db.allDocs({
      include_docs: true,
      startkey: 'dispute_',
      endkey: 'dispute_\uffff'
    });

    return result.rows
      .map(r => r.doc)
      .filter(d => d.disputed_party_id === memberId && d.status === 'open');
  }

  /**
   * Get dispute count for reputation display
   */
  async function getDisputeCount(db, memberId) {
    const disputes = await getDisputesForMember(db, memberId);
    return {
      open: disputes.length,
      total: disputes.length // Could include resolved in future
    };
  }

  // ========================================
  // SOCIAL RECOVERY (Phoenix Account)
  // ========================================

  /**
   * Create account migration request (requires elder signatures)
   */
  async function createMigrationRequest(db, oldMemberId, newPublicKey, requesterId) {
    const oldMember = await db.get(oldMemberId);

    if (!oldMember) {
      throw new Error('Old member not found');
    }

    const migration = {
      _id: `migration_${Date.now()}_${oldMemberId.substring(7, 15)}`,
      type: 'account_migration',
      old_member_id: oldMemberId,
      old_public_key: oldMember.public_key,
      new_public_key: newPublicKey,
      requested_by: requesterId,
      status: 'pending',
      elder_signatures: [],
      required_signatures: LIMITS.MIN_ELDERS_FOR_RECOVERY,
      created_at: new Date().toISOString()
    };

    await db.put(migration);

    console.log('[Recovery] Migration request created:', migration._id);
    return migration;
  }

  /**
   * Elder signs a migration request
   */
  async function signMigration(db, migrationId, elderId, signature) {
    const migration = await db.get(migrationId);

    if (migration.status !== 'pending') {
      throw new Error('Migration is not pending');
    }

    // Check elder hasn't already signed
    if (migration.elder_signatures.find(s => s.elder_id === elderId)) {
      throw new Error('Elder has already signed');
    }

    migration.elder_signatures.push({
      elder_id: elderId,
      signature: signature,
      signed_at: new Date().toISOString()
    });

    // Check if we have enough signatures
    if (migration.elder_signatures.length >= migration.required_signatures) {
      migration.status = 'approved';
      migration.approved_at = new Date().toISOString();
    }

    await db.put(migration);

    console.log('[Recovery] Elder signed:', elderId, `(${migration.elder_signatures.length}/${migration.required_signatures})`);
    return migration;
  }

  /**
   * Execute approved migration
   */
  async function executeMigration(db, migrationId) {
    const migration = await db.get(migrationId);

    if (migration.status !== 'approved') {
      throw new Error('Migration is not approved');
    }

    const oldMember = await db.get(migration.old_member_id);
    const balance = await calculateBalance(db, oldMember._id);

    // Create new member with same handle and balance transfer
    const newMember = {
      _id: `member_${migration.new_public_key.substring(0, 16)}`,
      type: 'member',
      handle: oldMember.handle,
      public_key: migration.new_public_key,
      created_at: oldMember.created_at, // Preserve tenure
      updated_at: new Date().toISOString(),
      circle_id: oldMember.circle_id,
      vouchers: oldMember.vouchers,
      offers: oldMember.offers,
      wants: oldMember.wants,
      status: 'active',
      role: oldMember.role,
      migrated_from: oldMember._id,
      migration_id: migrationId
    };

    await db.put(newMember);

    // Create balance transfer transaction
    if (balance !== 0) {
      const transferTx = {
        _id: `tx_${Date.now()}_migration`,
        type: 'transaction',
        sender_id: balance > 0 ? oldMember._id : newMember._id,
        recipient_id: balance > 0 ? newMember._id : oldMember._id,
        amount: Math.abs(balance),
        description: 'Account migration balance transfer',
        created_at: new Date().toISOString(),
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        migration_id: migrationId
      };
      await db.put(transferTx);
    }

    // Revoke old member
    oldMember.status = 'revoked';
    oldMember.revoked_at = new Date().toISOString();
    oldMember.revoked_reason = 'Account migration';
    oldMember.migrated_to = newMember._id;
    await db.put(oldMember);

    // Mark migration complete
    migration.status = 'executed';
    migration.executed_at = new Date().toISOString();
    migration.new_member_id = newMember._id;
    await db.put(migration);

    console.log('[Recovery] Migration executed:', oldMember.handle, '->', newMember._id);
    return { newMember, migration };
  }

  // ========================================
  // DEBT FORGIVENESS (Jubilee Protocol)
  // ========================================

  /**
   * Create debt forgiveness request for abandoned account
   */
  async function createForgivenessRequest(db, debtorId, requesterId, reason) {
    const debtor = await db.get(debtorId);
    const balance = await calculateBalance(db, debtorId);

    if (balance >= 0) {
      throw new Error('Member has no debt to forgive');
    }

    const forgiveness = {
      _id: `forgive_${Date.now()}_${debtorId.substring(7, 15)}`,
      type: 'debt_forgiveness',
      debtor_id: debtorId,
      debt_amount: Math.abs(balance),
      reason: reason,
      requested_by: requesterId,
      status: 'pending',
      elder_signatures: [],
      required_signatures: LIMITS.MIN_ELDERS_FOR_FORGIVENESS,
      created_at: new Date().toISOString()
    };

    await db.put(forgiveness);

    console.log('[Jubilee] Forgiveness request created:', forgiveness._id, 'Amount:', Math.abs(balance));
    return forgiveness;
  }

  /**
   * Elder signs forgiveness request
   */
  async function signForgiveness(db, forgivenessId, elderId, signature) {
    const forgiveness = await db.get(forgivenessId);

    if (forgiveness.status !== 'pending') {
      throw new Error('Forgiveness is not pending');
    }

    if (forgiveness.elder_signatures.find(s => s.elder_id === elderId)) {
      throw new Error('Elder has already signed');
    }

    forgiveness.elder_signatures.push({
      elder_id: elderId,
      signature: signature,
      signed_at: new Date().toISOString()
    });

    if (forgiveness.elder_signatures.length >= forgiveness.required_signatures) {
      forgiveness.status = 'approved';
      forgiveness.approved_at = new Date().toISOString();
    }

    await db.put(forgiveness);

    console.log('[Jubilee] Elder signed:', elderId, `(${forgiveness.elder_signatures.length}/${forgiveness.required_signatures})`);
    return forgiveness;
  }

  /**
   * Execute approved debt forgiveness
   */
  async function executeForgiveness(db, forgivenessId) {
    const forgiveness = await db.get(forgivenessId);

    if (forgiveness.status !== 'approved') {
      throw new Error('Forgiveness is not approved');
    }

    const debtor = await db.get(forgiveness.debtor_id);

    // Create a "mint" transaction to balance the debt
    // This is inflationary but necessary for bad debt
    const mintTx = {
      _id: `mint_${Date.now()}_jubilee`,
      type: 'mint',
      reason: 'debt_forgiveness',
      forgiveness_id: forgivenessId,
      beneficiaries: [{
        member_id: forgiveness.debtor_id,
        amount: forgiveness.debt_amount
      }],
      total_minted: forgiveness.debt_amount,
      created_at: new Date().toISOString(),
      status: 'confirmed',
      confirmed_at: new Date().toISOString()
    };
    await db.put(mintTx);

    // Revoke debtor's key permanently
    debtor.status = 'revoked';
    debtor.revoked_at = new Date().toISOString();
    debtor.revoked_reason = 'Debt forgiveness - key burned';
    await db.put(debtor);

    // Mark forgiveness complete
    forgiveness.status = 'executed';
    forgiveness.executed_at = new Date().toISOString();
    await db.put(forgiveness);

    console.log('[Jubilee] Debt forgiven:', debtor.handle, 'Amount:', forgiveness.debt_amount);
    return { forgiveness, mintTx };
  }

  // ========================================
  // SYBIL DETECTION (Trust Graph Analysis)
  // ========================================

  /**
   * Analyze trust graph for isolated clusters (potential Sybil)
   */
  async function analyzeTrustGraph(db, memberId) {
    // Get all vouches
    const vouchResult = await db.allDocs({
      include_docs: true,
      startkey: 'vouch_',
      endkey: 'vouch_\uffff'
    });

    // Get all transactions
    const txResult = await db.allDocs({
      include_docs: true,
      startkey: 'tx_',
      endkey: 'tx_\uffff'
    });

    // Build adjacency map
    const connections = new Map();

    // Add vouch connections
    for (const row of vouchResult.rows) {
      const vouch = row.doc;
      if (!connections.has(vouch.voucher_id)) connections.set(vouch.voucher_id, new Set());
      if (!connections.has(vouch.vouched_id)) connections.set(vouch.vouched_id, new Set());
      connections.get(vouch.voucher_id).add(vouch.vouched_id);
      connections.get(vouch.vouched_id).add(vouch.voucher_id);
    }

    // Add transaction connections
    for (const row of txResult.rows) {
      const tx = row.doc;
      if (tx.status !== 'confirmed') continue;
      if (!connections.has(tx.sender_id)) connections.set(tx.sender_id, new Set());
      if (!connections.has(tx.recipient_id)) connections.set(tx.recipient_id, new Set());
      connections.get(tx.sender_id).add(tx.recipient_id);
      connections.get(tx.recipient_id).add(tx.sender_id);
    }

    // Analyze the target member
    const memberConnections = connections.get(memberId) || new Set();
    const uniquePartners = memberConnections.size;

    // Check if connections are isolated (only trade with each other)
    let isolatedCluster = true;
    const clusterMembers = new Set([memberId, ...memberConnections]);

    for (const partnerId of memberConnections) {
      const partnerConnections = connections.get(partnerId) || new Set();
      for (const thirdParty of partnerConnections) {
        if (!clusterMembers.has(thirdParty)) {
          isolatedCluster = false;
          break;
        }
      }
      if (!isolatedCluster) break;
    }

    return {
      member_id: memberId,
      unique_trade_partners: uniquePartners,
      is_isolated_cluster: isolatedCluster && uniquePartners > 0 && uniquePartners < 5,
      cluster_size: clusterMembers.size,
      warning: isolatedCluster && uniquePartners > 0 && uniquePartners < 5
        ? 'SYBIL WARNING: Member trades only within isolated cluster'
        : null
    };
  }

  // ========================================
  // POST-SYNC VALIDATION
  // ========================================

  /**
   * Run all validations after a sync
   * Returns list of actions taken
   */
  async function runPostSyncValidation(db) {
    const actions = [];

    // 1. Detect limit breaches
    const breaches = await detectLimitBreaches(db);
    for (const breach of breaches) {
      const result = await freezeAccount(
        db,
        breach.member_id,
        `Balance ${breach.balance} below limit ${breach.credit_limit}`
      );
      actions.push({
        type: 'account_frozen',
        member_id: breach.member_id,
        handle: breach.handle,
        breach_amount: breach.breach_amount
      });
    }

    console.log('[Validation] Post-sync validation complete:', actions.length, 'actions');
    return actions;
  }

  // ========================================
  // PUBLIC API
  // ========================================

  return {
    // Configuration
    LIMITS,

    // Circuit Breaker
    validateTransactionAmount,

    // Entry Limits
    calculateCreditLimit,
    getMemberCreditLimit,

    // Double-Spend Detection
    detectLimitBreaches,
    freezeAccount,
    unfreezeAccount,

    // Disputes
    createDispute,
    resolveDispute,
    getDisputesForMember,
    getDisputeCount,

    // Social Recovery
    createMigrationRequest,
    signMigration,
    executeMigration,

    // Debt Forgiveness
    createForgivenessRequest,
    signForgiveness,
    executeForgiveness,

    // Sybil Detection
    analyzeTrustGraph,

    // Post-Sync
    runPostSyncValidation
  };
})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OGValidation;
}
