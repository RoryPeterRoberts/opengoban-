/**
 * TechnoCommune Ledger Core
 *
 * Client-side PouchDB implementation for offline-first mutual credit.
 * This is the "engine" that runs on every member's phone.
 */

(function(global) {
  'use strict';

  // Configuration
  const CONFIG = {
    DB_NAME: 'technocommune_ledger',
    HUB_URL: 'http://192.168.4.1:5984/ledger',  // Default community hub
    CREDIT_LIMIT_MIN: -50,
    CREDIT_LIMIT_MAX: 100,
    MAX_TRANSACTION: 100,
    SYNC_RETRY_DELAY: 5000
  };

  // Local database instance
  let localDB = null;
  let syncHandler = null;
  let currentUser = null;

  /**
   * Initialize the ledger
   */
  async function init(options = {}) {
    const dbName = options.dbName || CONFIG.DB_NAME;

    // Create local PouchDB instance
    localDB = new PouchDB(dbName);

    console.log('[Ledger] Initialized local database:', dbName);

    // Load current user from local storage
    const storedUser = localStorage.getItem('technocommune_user');
    if (storedUser) {
      currentUser = JSON.parse(storedUser);
      console.log('[Ledger] Loaded user:', currentUser.handle);
    }

    return { db: localDB, user: currentUser };
  }

  /**
   * Start syncing with community hub
   */
  function startSync(hubUrl = CONFIG.HUB_URL) {
    if (syncHandler) {
      console.log('[Sync] Already syncing');
      return syncHandler;
    }

    const remoteDB = new PouchDB(hubUrl);

    syncHandler = localDB.sync(remoteDB, {
      live: true,
      retry: true
    }).on('change', (info) => {
      console.log('[Sync] Change:', info.direction, info.change.docs.length, 'docs');
      dispatchEvent('sync-change', info);
    }).on('paused', (err) => {
      if (err) {
        console.log('[Sync] Paused (offline)');
        dispatchEvent('sync-status', { online: false });
      } else {
        console.log('[Sync] Paused (idle)');
        dispatchEvent('sync-status', { online: true, idle: true });
      }
    }).on('active', () => {
      console.log('[Sync] Active');
      dispatchEvent('sync-status', { online: true, active: true });
    }).on('denied', (err) => {
      console.error('[Sync] Denied:', err);
      dispatchEvent('sync-error', err);
    }).on('error', (err) => {
      console.error('[Sync] Error:', err);
      dispatchEvent('sync-error', err);
    });

    console.log('[Sync] Started with hub:', hubUrl);
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

  /**
   * Get sync status
   */
  function getSyncStatus() {
    return {
      active: syncHandler !== null,
      handler: syncHandler
    };
  }

  // ========================================
  // MEMBER FUNCTIONS
  // ========================================

  /**
   * Create a new member identity
   */
  async function createMember(handle, publicKey) {
    const member = {
      _id: `member_${generateUUID()}`,
      type: 'member',
      handle: handle,
      public_key: publicKey,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      vouchers: [],
      offers: [],
      wants: [],
      status: 'pending',
      credit_limit: {
        min: CONFIG.CREDIT_LIMIT_MIN,
        max: CONFIG.CREDIT_LIMIT_MAX
      }
    };

    const result = await localDB.put(member);
    member._rev = result.rev;

    console.log('[Member] Created:', handle);
    return member;
  }

  /**
   * Get member by ID
   */
  async function getMember(memberId) {
    try {
      return await localDB.get(memberId);
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /**
   * Get all active members
   */
  async function getActiveMembers() {
    const result = await localDB.allDocs({
      include_docs: true,
      startkey: 'member_',
      endkey: 'member_\uffff'
    });

    return result.rows
      .map(row => row.doc)
      .filter(doc => doc.status === 'active');
  }

  /**
   * Search members by handle or offers
   */
  async function searchMembers(query) {
    const members = await getActiveMembers();
    const q = query.toLowerCase();

    return members.filter(m => {
      if (m.handle.toLowerCase().includes(q)) return true;
      if (m.offers && m.offers.some(o => o.toLowerCase().includes(q))) return true;
      if (m.wants && m.wants.some(w => w.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  // ========================================
  // TRANSACTION FUNCTIONS
  // ========================================

  /**
   * Create a new transaction (pending, needs recipient confirmation)
   */
  async function createTransaction(recipientId, amount, description, category = 'general') {
    if (!currentUser) {
      throw new Error('No current user set');
    }

    if (amount <= 0 || amount > CONFIG.MAX_TRANSACTION) {
      throw new Error(`Amount must be between 1 and ${CONFIG.MAX_TRANSACTION}`);
    }

    // Check sender balance
    const balance = await getBalance(currentUser.id);
    if (balance - amount < CONFIG.CREDIT_LIMIT_MIN) {
      throw new Error(`Insufficient credit. Balance: ${balance}, Limit: ${CONFIG.CREDIT_LIMIT_MIN}`);
    }

    const tx = {
      _id: `tx_${Date.now()}_${generateUUID()}`,
      type: 'transaction',
      created_at: new Date().toISOString(),
      sender_id: currentUser.id,
      recipient_id: recipientId,
      amount: amount,
      description: description,
      category: category,
      signatures: {
        sender: await signDocument(tx),  // You'd implement actual crypto signing
        recipient: null,
        witness: null
      },
      status: 'pending',
      synced_to_hub: false
    };

    const result = await localDB.put(tx);
    tx._rev = result.rev;

    console.log('[Transaction] Created:', tx._id, amount, 'to', recipientId);
    return tx;
  }

  /**
   * Confirm a received transaction (add recipient signature)
   */
  async function confirmTransaction(txId) {
    const tx = await localDB.get(txId);

    if (tx.status !== 'pending') {
      throw new Error('Transaction is not pending');
    }

    if (tx.recipient_id !== currentUser.id) {
      throw new Error('You are not the recipient of this transaction');
    }

    tx.signatures.recipient = await signDocument(tx);
    tx.status = 'confirmed';
    tx.confirmed_at = new Date().toISOString();

    const result = await localDB.put(tx);
    tx._rev = result.rev;

    console.log('[Transaction] Confirmed:', tx._id);
    return tx;
  }

  /**
   * Get transactions for a member
   */
  async function getTransactions(memberId, options = {}) {
    const result = await localDB.allDocs({
      include_docs: true,
      startkey: 'tx_',
      endkey: 'tx_\uffff'
    });

    let transactions = result.rows
      .map(row => row.doc)
      .filter(tx =>
        tx.sender_id === memberId || tx.recipient_id === memberId
      );

    // Filter by status
    if (options.status) {
      transactions = transactions.filter(tx => tx.status === options.status);
    }

    // Sort by date (newest first)
    transactions.sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    );

    // Limit
    if (options.limit) {
      transactions = transactions.slice(0, options.limit);
    }

    return transactions;
  }

  /**
   * Get pending transactions for current user to confirm
   */
  async function getPendingIncoming() {
    if (!currentUser) return [];

    const txs = await getTransactions(currentUser.id, { status: 'pending' });
    return txs.filter(tx => tx.recipient_id === currentUser.id);
  }

  // ========================================
  // BALANCE FUNCTIONS
  // ========================================

  /**
   * Calculate balance for a member
   */
  async function getBalance(memberId) {
    // Get all confirmed transactions
    const txResult = await localDB.allDocs({
      include_docs: true,
      startkey: 'tx_',
      endkey: 'tx_\uffff'
    });

    let balance = 0;

    for (const row of txResult.rows) {
      const tx = row.doc;
      if (tx.status !== 'confirmed') continue;

      if (tx.recipient_id === memberId) {
        balance += tx.amount;
      }
      if (tx.sender_id === memberId) {
        balance -= tx.amount;
      }
    }

    // Add minted credits (Proof of Care)
    const mintResult = await localDB.allDocs({
      include_docs: true,
      startkey: 'mint_',
      endkey: 'mint_\uffff'
    });

    for (const row of mintResult.rows) {
      const mint = row.doc;
      if (mint.status !== 'confirmed') continue;

      for (const beneficiary of mint.beneficiaries) {
        if (beneficiary.member_id === memberId) {
          balance += beneficiary.amount;
        }
      }
    }

    return balance;
  }

  /**
   * Get all balances (for audit)
   */
  async function getAllBalances() {
    const members = await getActiveMembers();
    const balances = {};

    for (const member of members) {
      balances[member._id] = await getBalance(member._id);
    }

    return balances;
  }

  /**
   * Audit system integrity
   */
  async function auditSystem() {
    const balances = await getAllBalances();

    // Sum of all balances
    let totalBalance = 0;
    for (const id in balances) {
      totalBalance += balances[id];
    }

    // Total minted
    const mintResult = await localDB.allDocs({
      include_docs: true,
      startkey: 'mint_',
      endkey: 'mint_\uffff'
    });

    let totalMinted = 0;
    for (const row of mintResult.rows) {
      const mint = row.doc;
      if (mint.status === 'confirmed') {
        totalMinted += mint.total_minted || 0;
      }
    }

    // Invariant: sum of balances should equal total minted
    const valid = totalBalance === totalMinted;

    return {
      valid: valid,
      totalBalance: totalBalance,
      totalMinted: totalMinted,
      discrepancy: totalBalance - totalMinted,
      memberCount: Object.keys(balances).length,
      balances: balances
    };
  }

  // ========================================
  // MINT FUNCTIONS (Proof of Care)
  // ========================================

  /**
   * Create a mint request (needs elder signatures)
   */
  async function createMintRequest(beneficiaries, workType, description) {
    const totalMinted = beneficiaries.reduce((sum, b) => sum + b.amount, 0);

    if (totalMinted > 100) {
      throw new Error('Total mint cannot exceed 100 credits per event');
    }

    const mint = {
      _id: `mint_${Date.now()}_${generateUUID()}`,
      type: 'mint',
      created_at: new Date().toISOString(),
      beneficiaries: beneficiaries,
      total_minted: totalMinted,
      work_type: workType,
      description: description,
      required_signatures: 3,
      signatures: {},
      status: 'pending'
    };

    const result = await localDB.put(mint);
    mint._rev = result.rev;

    console.log('[Mint] Created request:', mint._id, 'total:', totalMinted);
    return mint;
  }

  /**
   * Sign a mint request (elder only)
   */
  async function signMintRequest(mintId) {
    if (!currentUser) {
      throw new Error('No current user set');
    }

    const mint = await localDB.get(mintId);

    if (mint.status === 'confirmed') {
      throw new Error('Mint already confirmed');
    }

    // Add signature
    mint.signatures[currentUser.id] = await signDocument(mint);

    // Check if threshold reached
    const sigCount = Object.keys(mint.signatures).filter(k => mint.signatures[k]).length;

    if (sigCount >= mint.required_signatures) {
      mint.status = 'confirmed';
      mint.confirmed_at = new Date().toISOString();
      console.log('[Mint] Confirmed:', mint._id);
    }

    const result = await localDB.put(mint);
    mint._rev = result.rev;

    return mint;
  }

  // ========================================
  // QR CODE FUNCTIONS (Offline Transfer)
  // ========================================

  /**
   * Generate QR payload for offline transfer
   */
  async function generateTransferQR(recipientId, amount, description) {
    const tx = {
      _id: `tx_${Date.now()}_${generateUUID()}`,
      type: 'transaction',
      created_at: new Date().toISOString(),
      sender_id: currentUser.id,
      recipient_id: recipientId,
      amount: amount,
      description: description,
      category: 'qr_transfer',
      signatures: {
        sender: await signDocument({ sender_id: currentUser.id, recipient_id: recipientId, amount, description }),
        recipient: null
      },
      status: 'pending'
    };

    // Return compact JSON for QR
    return JSON.stringify(tx);
  }

  /**
   * Process received QR transfer
   */
  async function receiveTransferQR(qrPayload) {
    const tx = JSON.parse(qrPayload);

    // Verify it's a valid transaction
    if (tx.type !== 'transaction') {
      throw new Error('Invalid QR code - not a transaction');
    }

    // Verify sender signature (simplified - real implementation would use crypto)
    if (!tx.signatures || !tx.signatures.sender) {
      throw new Error('Transaction not signed by sender');
    }

    // Add recipient signature
    tx.signatures.recipient = await signDocument(tx);
    tx.status = 'confirmed';
    tx.confirmed_at = new Date().toISOString();
    tx.received_via = 'qr';

    // Save to local database
    const result = await localDB.put(tx);
    tx._rev = result.rev;

    console.log('[QR] Received transfer:', tx._id, tx.amount, 'from', tx.sender_id);
    return tx;
  }

  // ========================================
  // UTILITY FUNCTIONS
  // ========================================

  /**
   * Generate UUID
   */
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Sign a document (placeholder - implement with actual crypto library)
   */
  async function signDocument(doc) {
    // In production, use SubtleCrypto or a library like TweetNaCl
    // This is a placeholder that creates a simulated signature
    const payload = JSON.stringify(doc);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    return btoa(String.fromCharCode(...new Uint8Array(hash)));
  }

  /**
   * Dispatch custom event
   */
  function dispatchEvent(eventName, detail) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(`ledger-${eventName}`, { detail }));
    }
  }

  /**
   * Set current user
   */
  function setCurrentUser(user) {
    currentUser = user;
    localStorage.setItem('technocommune_user', JSON.stringify(user));
    console.log('[Ledger] Set current user:', user.handle);
  }

  /**
   * Get current user
   */
  function getCurrentUser() {
    return currentUser;
  }

  /**
   * Export database (for backup)
   */
  async function exportDatabase() {
    const result = await localDB.allDocs({ include_docs: true });
    return {
      exported_at: new Date().toISOString(),
      doc_count: result.rows.length,
      docs: result.rows.map(r => r.doc)
    };
  }

  /**
   * Import database (restore from backup)
   */
  async function importDatabase(backup) {
    const docs = backup.docs.map(doc => {
      delete doc._rev;  // Remove revision to avoid conflicts
      return doc;
    });

    const result = await localDB.bulkDocs(docs);
    console.log('[Ledger] Imported', result.length, 'documents');
    return result;
  }

  // ========================================
  // PUBLIC API
  // ========================================

  const TechnoCommune = {
    // Initialization
    init,
    startSync,
    stopSync,
    getSyncStatus,

    // User
    setCurrentUser,
    getCurrentUser,

    // Members
    createMember,
    getMember,
    getActiveMembers,
    searchMembers,

    // Transactions
    createTransaction,
    confirmTransaction,
    getTransactions,
    getPendingIncoming,

    // Balance
    getBalance,
    getAllBalances,
    auditSystem,

    // Minting
    createMintRequest,
    signMintRequest,

    // QR Transfer
    generateTransferQR,
    receiveTransferQR,

    // Utilities
    exportDatabase,
    importDatabase,

    // Config
    CONFIG
  };

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TechnoCommune;
  }
  if (typeof global !== 'undefined') {
    global.TechnoCommune = TechnoCommune;
  }

})(typeof window !== 'undefined' ? window : global);
