/**
 * OpenGoban Ledger
 *
 * Offline-first mutual credit ledger with real cryptographic signing.
 * Uses OGCrypto for Ed25519 signatures and OGQR for offline transfers.
 */

const OGLedger = (function() {
  'use strict';

  // Configuration
  const CONFIG = {
    DB_NAME: 'opengoban_ledger',
    CREDIT_LIMIT_MIN: -50,
    CREDIT_LIMIT_MAX: 100,
    MAX_TRANSACTION: 100
  };

  // Local database instance
  let db = null;
  let currentMember = null;
  let syncHandler = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize the ledger
   */
  async function init() {
    // Create local PouchDB
    db = new PouchDB(CONFIG.DB_NAME);
    console.log('[Ledger] Initialized database');

    // Load current member if identity exists
    if (await OGCrypto.hasIdentity()) {
      const publicKey = await OGCrypto.getPublicKey();
      currentMember = await getMemberByPublicKey(publicKey);
      if (currentMember) {
        console.log('[Ledger] Loaded member:', currentMember.handle);
      }
    }

    return { db, member: currentMember };
  }

  /**
   * Get the database instance
   */
  function getDB() {
    return db;
  }

  // ========================================
  // CIRCLE MANAGEMENT
  // ========================================

  /**
   * Create a new circle
   */
  async function createCircle(name, description = '') {
    if (!currentMember) {
      throw new Error('Must be a member to create a circle');
    }

    const circle = {
      _id: `circle_${OGCrypto.generateId()}`,
      type: 'circle',
      name: name,
      description: description,
      created_by: currentMember._id,
      created_at: new Date().toISOString(),
      settings: {
        credit_limit_min: CONFIG.CREDIT_LIMIT_MIN,
        credit_limit_max: CONFIG.CREDIT_LIMIT_MAX,
        max_transaction: CONFIG.MAX_TRANSACTION,
        require_vouch: true,
        min_vouchers: 1
      }
    };

    const result = await db.put(circle);
    circle._rev = result.rev;

    // Update current member to be part of this circle
    currentMember.circle_id = circle._id;
    currentMember.role = 'elder'; // Creator is elder
    currentMember.status = 'active';
    await db.put(currentMember);

    console.log('[Circle] Created:', name);
    return circle;
  }

  /**
   * Get circle by ID
   */
  async function getCircle(circleId) {
    try {
      return await db.get(circleId);
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Get all circles
   */
  async function getCircles() {
    const result = await db.allDocs({
      include_docs: true,
      startkey: 'circle_',
      endkey: 'circle_\uffff'
    });
    return result.rows.map(r => r.doc);
  }

  // ========================================
  // MEMBER MANAGEMENT
  // ========================================

  /**
   * Create identity and member record
   */
  async function createMember(handle) {
    // Generate cryptographic identity
    const publicKey = await OGCrypto.createIdentity();

    const member = {
      _id: `member_${publicKey.substring(0, 16)}`,
      type: 'member',
      handle: handle,
      public_key: publicKey,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      circle_id: null,
      vouchers: [],
      offers: [],
      wants: [],
      status: 'pending', // pending until vouched
      role: 'member'
    };

    const result = await db.put(member);
    member._rev = result.rev;

    currentMember = member;
    console.log('[Member] Created:', handle, 'ID:', member._id);

    return member;
  }

  /**
   * Get member by ID
   */
  async function getMember(memberId) {
    try {
      return await db.get(memberId);
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Get member by public key
   */
  async function getMemberByPublicKey(publicKey) {
    const result = await db.allDocs({
      include_docs: true,
      startkey: 'member_',
      endkey: 'member_\uffff'
    });

    for (const row of result.rows) {
      if (row.doc.public_key === publicKey) {
        return row.doc;
      }
    }
    return null;
  }

  /**
   * Get current member
   */
  function getCurrentMember() {
    return currentMember;
  }

  /**
   * Save a scanned member to local database (as contact)
   */
  async function saveScannedMember(memberId, handle, publicKey, circleId = null) {
    // Check if we already have this member
    const existing = await getMember(memberId);
    if (existing) {
      return existing;
    }

    const member = {
      _id: memberId,
      type: 'member',
      handle: handle,
      public_key: publicKey,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      circle_id: circleId,
      vouchers: [],
      offers: [],
      wants: [],
      status: 'active', // Scanned members are trusted
      role: 'member',
      source: 'scanned' // Mark as externally scanned
    };

    const result = await db.put(member);
    member._rev = result.rev;

    console.log('[Member] Saved scanned contact:', handle);
    return member;
  }

  /**
   * Get all members in a circle
   */
  async function getCircleMembers(circleId) {
    const result = await db.allDocs({
      include_docs: true,
      startkey: 'member_',
      endkey: 'member_\uffff'
    });

    return result.rows
      .map(r => r.doc)
      .filter(m => m.circle_id === circleId && m.status === 'active');
  }

  /**
   * Search members by handle or offers
   */
  async function searchMembers(query, circleId = null) {
    let members;
    if (circleId) {
      members = await getCircleMembers(circleId);
    } else {
      const result = await db.allDocs({
        include_docs: true,
        startkey: 'member_',
        endkey: 'member_\uffff'
      });
      members = result.rows.map(r => r.doc).filter(m => m.status === 'active');
    }

    const q = query.toLowerCase();
    return members.filter(m => {
      if (m.handle.toLowerCase().includes(q)) return true;
      if (m.offers && m.offers.some(o => o.toLowerCase().includes(q))) return true;
      if (m.wants && m.wants.some(w => w.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  // ========================================
  // VOUCHING SYSTEM
  // ========================================

  /**
   * Vouch for a new member
   */
  async function vouchForMember(newMemberId) {
    if (!currentMember) {
      throw new Error('Must be logged in to vouch');
    }

    if (currentMember.status !== 'active') {
      throw new Error('Only active members can vouch');
    }

    const newMember = await getMember(newMemberId);
    if (!newMember) {
      throw new Error('Member not found');
    }

    // Create vouch record
    const vouch = {
      _id: `vouch_${OGCrypto.generateId()}`,
      type: 'vouch',
      voucher_id: currentMember._id,
      vouched_id: newMemberId,
      created_at: new Date().toISOString(),
      signature: await OGCrypto.sign({
        action: 'vouch',
        voucher_id: currentMember._id,
        vouched_id: newMemberId,
        timestamp: new Date().toISOString()
      })
    };

    await db.put(vouch);

    // Add to member's vouchers list
    if (!newMember.vouchers.includes(currentMember._id)) {
      newMember.vouchers.push(currentMember._id);
      newMember.updated_at = new Date().toISOString();

      // Check if they have enough vouchers
      const circle = await getCircle(currentMember.circle_id);
      const minVouchers = circle?.settings?.min_vouchers || 1;

      if (newMember.vouchers.length >= minVouchers) {
        newMember.status = 'active';
        newMember.circle_id = currentMember.circle_id;
        console.log('[Vouch] Member activated:', newMember.handle);
      }

      await db.put(newMember);
    }

    console.log('[Vouch] Vouched for:', newMember.handle);
    return vouch;
  }

  // ========================================
  // TRANSACTIONS
  // ========================================

  /**
   * Create a transaction (as sender)
   * Returns the transaction with sender signature
   */
  async function createTransaction(recipientId, amount, description) {
    if (!currentMember) {
      throw new Error('Must be logged in');
    }

    if (amount <= 0 || amount > CONFIG.MAX_TRANSACTION) {
      throw new Error(`Amount must be between 1 and ${CONFIG.MAX_TRANSACTION}`);
    }

    // Check balance
    const balance = await getBalance(currentMember._id);
    if (balance - amount < CONFIG.CREDIT_LIMIT_MIN) {
      throw new Error(`Insufficient credit. Balance: ${balance}, Limit: ${CONFIG.CREDIT_LIMIT_MIN}`);
    }

    // Verify recipient exists
    const recipient = await getMember(recipientId);
    if (!recipient) {
      throw new Error('Recipient not found');
    }

    const tx = {
      _id: `tx_${Date.now()}_${OGCrypto.generateId()}`,
      type: 'transaction',
      sender_id: currentMember._id,
      recipient_id: recipientId,
      amount: amount,
      description: description,
      created_at: new Date().toISOString(),
      nonce: OGCrypto.generateNonce(),
      status: 'pending'
    };

    // Sign as sender
    tx.sender_signature = await OGCrypto.signTransactionAsSender(tx);

    const result = await db.put(tx);
    tx._rev = result.rev;

    console.log('[Transaction] Created:', tx._id, amount, 'to', recipient.handle);
    return tx;
  }

  /**
   * Confirm a transaction (as recipient)
   */
  async function confirmTransaction(txId) {
    if (!currentMember) {
      throw new Error('Must be logged in');
    }

    const tx = await db.get(txId);

    if (tx.status !== 'pending') {
      throw new Error('Transaction is not pending');
    }

    if (tx.recipient_id !== currentMember._id) {
      throw new Error('You are not the recipient');
    }

    // Verify sender signature
    const sender = await getMember(tx.sender_id);
    if (!OGCrypto.verifyTransactionSignature(tx, tx.sender_signature, sender.public_key)) {
      throw new Error('Invalid sender signature');
    }

    // Add recipient signature
    tx.recipient_signature = await OGCrypto.signTransactionAsRecipient(tx);
    tx.status = 'confirmed';
    tx.confirmed_at = new Date().toISOString();

    const result = await db.put(tx);
    tx._rev = result.rev;

    console.log('[Transaction] Confirmed:', tx._id);
    dispatchEvent('transaction-confirmed', tx);

    return tx;
  }

  /**
   * Get transactions for a member
   */
  async function getTransactions(memberId, options = {}) {
    const result = await db.allDocs({
      include_docs: true,
      startkey: 'tx_',
      endkey: 'tx_\uffff'
    });

    let transactions = result.rows
      .map(r => r.doc)
      .filter(tx => tx.sender_id === memberId || tx.recipient_id === memberId);

    if (options.status) {
      transactions = transactions.filter(tx => tx.status === options.status);
    }

    // Sort newest first
    transactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (options.limit) {
      transactions = transactions.slice(0, options.limit);
    }

    return transactions;
  }

  /**
   * Get pending incoming transactions
   */
  async function getPendingIncoming() {
    if (!currentMember) return [];

    const txs = await getTransactions(currentMember._id, { status: 'pending' });
    return txs.filter(tx => tx.recipient_id === currentMember._id);
  }

  // ========================================
  // QR OFFLINE TRANSFERS
  // ========================================

  /**
   * Create a QR code for an offline transfer
   */
  async function createTransferQR(recipientId, amount, description, containerId) {
    const tx = await createTransaction(recipientId, amount, description);

    // Create QR payload
    const payload = OGQR.createTransactionPayload(tx, tx.sender_signature);

    // Generate QR code
    if (containerId) {
      OGQR.generateQR(containerId, payload, { width: 300, height: 300 });
    }

    return { transaction: tx, payload };
  }

  /**
   * Receive and process a QR transfer
   */
  async function receiveTransferQR(qrData) {
    if (!currentMember) {
      throw new Error('Must be logged in');
    }

    // Parse the QR payload
    const parsed = OGQR.parseTransactionPayload(qrData);
    if (!parsed) {
      throw new Error('Invalid QR code');
    }

    const txData = parsed.transaction;

    // Verify we are the recipient
    if (txData.recipient_id !== currentMember._id) {
      throw new Error('This transfer is not for you');
    }

    // Get sender to verify signature
    const sender = await getMember(txData.sender_id);
    if (!sender) {
      throw new Error('Unknown sender');
    }

    // Verify sender signature
    if (!OGCrypto.verifyTransactionSignature(txData, parsed.senderSignature, sender.public_key)) {
      throw new Error('Invalid sender signature');
    }

    // Check if we already have this transaction
    try {
      const existing = await db.get(`tx_${txData.created_at}_${txData.nonce.substring(0, 16)}`);
      if (existing) {
        throw new Error('Transaction already received');
      }
    } catch (err) {
      if (err.status !== 404) throw err;
    }

    // Create the transaction record
    const tx = {
      _id: `tx_${Date.now()}_${OGCrypto.generateId()}`,
      type: 'transaction',
      sender_id: txData.sender_id,
      recipient_id: txData.recipient_id,
      amount: txData.amount,
      description: txData.description,
      created_at: txData.created_at,
      nonce: txData.nonce,
      sender_signature: parsed.senderSignature,
      received_via: 'qr',
      status: 'pending'
    };

    // Save as pending
    let result = await db.put(tx);
    tx._rev = result.rev;

    // Now confirm it
    tx.recipient_signature = await OGCrypto.signTransactionAsRecipient(tx);
    tx.status = 'confirmed';
    tx.confirmed_at = new Date().toISOString();

    result = await db.put(tx);
    tx._rev = result.rev;

    console.log('[QR] Received transfer:', tx.amount, 'from', sender.handle);
    dispatchEvent('transaction-received', tx);

    return tx;
  }

  // ========================================
  // BALANCE & AUDIT
  // ========================================

  /**
   * Calculate balance for a member
   */
  async function getBalance(memberId) {
    const result = await db.allDocs({
      include_docs: true,
      startkey: 'tx_',
      endkey: 'tx_\uffff'
    });

    let balance = 0;

    for (const row of result.rows) {
      const tx = row.doc;
      if (tx.status !== 'confirmed') continue;

      if (tx.recipient_id === memberId) {
        balance += tx.amount;
      }
      if (tx.sender_id === memberId) {
        balance -= tx.amount;
      }
    }

    // Include any minted credits
    const mintResult = await db.allDocs({
      include_docs: true,
      startkey: 'mint_',
      endkey: 'mint_\uffff'
    });

    for (const row of mintResult.rows) {
      const mint = row.doc;
      if (mint.status !== 'confirmed') continue;

      if (mint.beneficiaries) {
        for (const b of mint.beneficiaries) {
          if (b.member_id === memberId) {
            balance += b.amount;
          }
        }
      }
    }

    return balance;
  }

  /**
   * Get all balances for audit
   */
  async function getAllBalances(circleId) {
    const members = circleId ? await getCircleMembers(circleId) : await getAllMembers();
    const balances = {};

    for (const m of members) {
      balances[m._id] = {
        handle: m.handle,
        balance: await getBalance(m._id)
      };
    }

    return balances;
  }

  /**
   * Get all members
   */
  async function getAllMembers() {
    const result = await db.allDocs({
      include_docs: true,
      startkey: 'member_',
      endkey: 'member_\uffff'
    });
    return result.rows.map(r => r.doc);
  }

  /**
   * Audit the ledger integrity
   */
  async function audit(circleId) {
    const balances = await getAllBalances(circleId);

    let totalBalance = 0;
    for (const id in balances) {
      totalBalance += balances[id].balance;
    }

    // Get total minted
    const mintResult = await db.allDocs({
      include_docs: true,
      startkey: 'mint_',
      endkey: 'mint_\uffff'
    });

    let totalMinted = 0;
    for (const row of mintResult.rows) {
      if (row.doc.status === 'confirmed') {
        totalMinted += row.doc.total_minted || 0;
      }
    }

    // In mutual credit, total balance should equal total minted
    const valid = totalBalance === totalMinted;

    return {
      valid,
      totalBalance,
      totalMinted,
      discrepancy: totalBalance - totalMinted,
      memberCount: Object.keys(balances).length,
      balances
    };
  }

  // ========================================
  // SYNC
  // ========================================

  /**
   * Start syncing with a remote database
   */
  function startSync(remoteUrl) {
    if (syncHandler) {
      console.log('[Sync] Already active');
      return syncHandler;
    }

    const remoteDB = new PouchDB(remoteUrl);

    syncHandler = db.sync(remoteDB, {
      live: true,
      retry: true
    }).on('change', (info) => {
      console.log('[Sync] Change:', info.direction);
      dispatchEvent('sync-change', info);
    }).on('paused', (err) => {
      dispatchEvent('sync-status', { online: !err });
    }).on('active', () => {
      dispatchEvent('sync-status', { online: true });
    }).on('error', (err) => {
      console.error('[Sync] Error:', err);
      dispatchEvent('sync-error', err);
    });

    console.log('[Sync] Started with:', remoteUrl);
    return syncHandler;
  }

  /**
   * Stop syncing
   */
  function stopSync() {
    if (syncHandler) {
      syncHandler.cancel();
      syncHandler = null;
      console.log('[Sync] Stopped');
    }
  }

  // ========================================
  // UTILITIES
  // ========================================

  /**
   * Dispatch a custom event
   */
  function dispatchEvent(name, detail) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(`tc-${name}`, { detail }));
    }
  }

  /**
   * Export database for backup
   */
  async function exportData() {
    const result = await db.allDocs({ include_docs: true });
    return {
      exported_at: new Date().toISOString(),
      version: 1,
      docs: result.rows.map(r => {
        const doc = { ...r.doc };
        delete doc._rev;
        return doc;
      })
    };
  }

  /**
   * Import database from backup
   */
  async function importData(backup) {
    const docs = backup.docs.map(doc => {
      const d = { ...doc };
      delete d._rev;
      return d;
    });

    const result = await db.bulkDocs(docs);
    console.log('[Ledger] Imported', result.length, 'docs');
    return result;
  }

  // ========================================
  // PUBLIC API
  // ========================================

  return {
    // Init
    init,
    getDB,

    // Circles
    createCircle,
    getCircle,
    getCircles,

    // Members
    createMember,
    getMember,
    getMemberByPublicKey,
    getCurrentMember,
    saveScannedMember,
    getCircleMembers,
    searchMembers,
    getAllMembers,

    // Vouching
    vouchForMember,

    // Transactions
    createTransaction,
    confirmTransaction,
    getTransactions,
    getPendingIncoming,

    // QR Transfers
    createTransferQR,
    receiveTransferQR,

    // Balance
    getBalance,
    getAllBalances,
    audit,

    // Sync
    startSync,
    stopSync,

    // Utilities
    exportData,
    importData,

    // Config
    CONFIG
  };
})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OGLedger;
}
