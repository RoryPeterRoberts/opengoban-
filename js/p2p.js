/**
 * OpenGoban P2P Sync Module
 *
 * Peer-to-peer sync using WebRTC (via PeerJS)
 * No central server - direct device-to-device data transfer
 */

const OGP2P = (function() {
  'use strict';

  // PeerJS instance
  let peer = null;
  let connection = null;
  let syncInProgress = false;

  // Callbacks
  let onStatusChange = null;
  let onSyncComplete = null;

  // ========================================
  // PEER MANAGEMENT
  // ========================================

  /**
   * Generate a random 6-digit code for pairing
   */
  function generatePairingCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Create a peer and start hosting (waiting for connection)
   * @returns {Promise<string>} The pairing code
   */
  async function startHosting() {
    const code = generatePairingCode();
    const peerId = `opengoban-${code}`;

    return new Promise((resolve, reject) => {
      // Create peer with the code as ID
      peer = new Peer(peerId, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });

      peer.on('open', (id) => {
        console.log('[P2P] Hosting as:', id);
        updateStatus('waiting');
        resolve(code);
      });

      peer.on('connection', (conn) => {
        console.log('[P2P] Incoming connection from:', conn.peer);
        connection = conn;
        setupConnection(conn);
      });

      peer.on('error', (err) => {
        console.error('[P2P] Peer error:', err);
        if (err.type === 'unavailable-id') {
          // Code already in use, generate new one
          stopHosting();
          startHosting().then(resolve).catch(reject);
        } else {
          updateStatus('error', err.message);
          reject(err);
        }
      });

      peer.on('disconnected', () => {
        console.log('[P2P] Disconnected from signaling server');
        updateStatus('disconnected');
      });
    });
  }

  /**
   * Connect to a host using their pairing code
   * @param {string} code - The 6-digit pairing code
   */
  async function connectToHost(code) {
    const peerId = `opengoban-${code}`;

    return new Promise((resolve, reject) => {
      // Create our own peer first
      peer = new Peer({
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        }
      });

      peer.on('open', () => {
        console.log('[P2P] Connecting to:', peerId);
        updateStatus('connecting');

        // Connect to the host
        connection = peer.connect(peerId, {
          reliable: true,
          serialization: 'json'
        });

        setupConnection(connection);

        connection.on('open', () => {
          resolve();
        });

        connection.on('error', (err) => {
          console.error('[P2P] Connection error:', err);
          updateStatus('error', 'Connection failed');
          reject(err);
        });
      });

      peer.on('error', (err) => {
        console.error('[P2P] Peer error:', err);
        if (err.type === 'peer-unavailable') {
          updateStatus('error', 'Invalid code or peer offline');
          reject(new Error('Peer not found'));
        } else {
          updateStatus('error', err.message);
          reject(err);
        }
      });
    });
  }

  /**
   * Set up connection event handlers
   */
  function setupConnection(conn) {
    conn.on('open', () => {
      console.log('[P2P] Connection opened');
      updateStatus('connected');

      // Start sync automatically
      initiateSync();
    });

    conn.on('data', (data) => {
      handleMessage(data);
    });

    conn.on('close', () => {
      console.log('[P2P] Connection closed');
      connection = null;
      updateStatus('disconnected');
    });

    conn.on('error', (err) => {
      console.error('[P2P] Connection error:', err);
      updateStatus('error', err.message);
    });
  }

  /**
   * Stop hosting / disconnect
   */
  function disconnect() {
    if (connection) {
      connection.close();
      connection = null;
    }
    if (peer) {
      peer.destroy();
      peer = null;
    }
    syncInProgress = false;
    updateStatus('idle');
    console.log('[P2P] Disconnected');
  }

  // ========================================
  // SYNC PROTOCOL
  // ========================================

  /**
   * Initiate the sync process
   */
  async function initiateSync() {
    if (syncInProgress) return;
    syncInProgress = true;

    console.log('[P2P] Starting sync...');
    updateStatus('syncing');

    try {
      // Get our documents
      const db = OGLedger.getDB();
      const allDocs = await db.allDocs({ include_docs: true });

      // Send sync request with our doc count and revisions
      const docInfo = allDocs.rows.map(row => ({
        id: row.id,
        rev: row.doc._rev
      }));

      sendMessage({
        type: 'sync-request',
        docCount: docInfo.length,
        docs: docInfo
      });

    } catch (err) {
      console.error('[P2P] Sync error:', err);
      updateStatus('error', 'Sync failed');
      syncInProgress = false;
    }
  }

  /**
   * Handle incoming messages
   */
  async function handleMessage(data) {
    console.log('[P2P] Received:', data.type);

    switch (data.type) {
      case 'sync-request':
        await handleSyncRequest(data);
        break;

      case 'sync-response':
        await handleSyncResponse(data);
        break;

      case 'docs':
        await handleDocs(data);
        break;

      case 'sync-complete':
        await handleSyncComplete(data);
        break;

      default:
        console.warn('[P2P] Unknown message type:', data.type);
    }
  }

  /**
   * Handle sync request from peer
   */
  async function handleSyncRequest(data) {
    const db = OGLedger.getDB();
    const allDocs = await db.allDocs({ include_docs: true });

    // Find docs the peer doesn't have or has older versions of
    const peerDocMap = new Map(data.docs.map(d => [d.id, d.rev]));
    const docsToSend = [];

    for (const row of allDocs.rows) {
      const peerRev = peerDocMap.get(row.id);
      if (!peerRev || peerRev !== row.doc._rev) {
        // Peer doesn't have this doc or has older version
        docsToSend.push(row.doc);
      }
    }

    // Find docs we need from peer
    const ourDocMap = new Map(allDocs.rows.map(r => [r.id, r.doc._rev]));
    const docsWeNeed = data.docs.filter(d => {
      const ourRev = ourDocMap.get(d.id);
      return !ourRev || ourRev !== d.rev;
    }).map(d => d.id);

    // Send response
    sendMessage({
      type: 'sync-response',
      docsToSend: docsToSend.length,
      docsNeeded: docsWeNeed
    });

    // Send our docs
    if (docsToSend.length > 0) {
      sendMessage({
        type: 'docs',
        docs: docsToSend
      });
    }
  }

  /**
   * Handle sync response from peer
   */
  async function handleSyncResponse(data) {
    const db = OGLedger.getDB();

    // Send docs the peer needs
    if (data.docsNeeded && data.docsNeeded.length > 0) {
      const docsToSend = [];
      for (const docId of data.docsNeeded) {
        try {
          const doc = await db.get(docId);
          docsToSend.push(doc);
        } catch (err) {
          // Doc might have been deleted
        }
      }

      if (docsToSend.length > 0) {
        sendMessage({
          type: 'docs',
          docs: docsToSend
        });
      }
    }
  }

  /**
   * Handle incoming documents
   */
  async function handleDocs(data) {
    const db = OGLedger.getDB();
    let imported = 0;
    let conflicts = 0;

    for (const doc of data.docs) {
      try {
        // Try to get existing doc
        let existingDoc = null;
        try {
          existingDoc = await db.get(doc._id);
        } catch (err) {
          // Doc doesn't exist locally
        }

        if (existingDoc) {
          // Update existing doc with new data
          // Use the revision from the peer if it's newer
          const newDoc = { ...doc, _rev: existingDoc._rev };
          await db.put(newDoc);
        } else {
          // New doc - remove _rev and insert
          const newDoc = { ...doc };
          delete newDoc._rev;
          await db.put(newDoc);
        }
        imported++;
      } catch (err) {
        console.error('[P2P] Failed to import doc:', doc._id, err);
        conflicts++;
      }
    }

    console.log(`[P2P] Imported ${imported} docs, ${conflicts} conflicts`);

    // Send sync complete
    sendMessage({
      type: 'sync-complete',
      imported: imported,
      conflicts: conflicts
    });

    // Also mark ourselves as complete
    finishSync(imported, conflicts);
  }

  /**
   * Handle sync complete from peer
   */
  async function handleSyncComplete(data) {
    console.log('[P2P] Peer sync complete:', data);
    finishSync(data.imported || 0, data.conflicts || 0);
  }

  /**
   * Finish the sync process
   */
  function finishSync(imported, conflicts) {
    syncInProgress = false;
    updateStatus('complete', `Synced ${imported} items`);

    if (onSyncComplete) {
      onSyncComplete({ imported, conflicts });
    }

    // Refresh UI
    if (typeof OGApp !== 'undefined') {
      OGApp.updateBalance();
      OGApp.loadTransactions();
    }
  }

  /**
   * Send a message to the peer
   */
  function sendMessage(data) {
    if (connection && connection.open) {
      connection.send(data);
    } else {
      console.warn('[P2P] Cannot send - no connection');
    }
  }

  // ========================================
  // STATUS & CALLBACKS
  // ========================================

  /**
   * Update status and notify listeners
   */
  function updateStatus(status, message = '') {
    console.log('[P2P] Status:', status, message);
    if (onStatusChange) {
      onStatusChange(status, message);
    }
  }

  /**
   * Set status change callback
   */
  function setOnStatusChange(callback) {
    onStatusChange = callback;
  }

  /**
   * Set sync complete callback
   */
  function setOnSyncComplete(callback) {
    onSyncComplete = callback;
  }

  /**
   * Check if connected
   */
  function isConnected() {
    return connection && connection.open;
  }

  /**
   * Check if syncing
   */
  function isSyncing() {
    return syncInProgress;
  }

  // ========================================
  // PUBLIC API
  // ========================================

  return {
    // Connection
    startHosting,
    connectToHost,
    disconnect,
    isConnected,
    isSyncing,

    // Callbacks
    setOnStatusChange,
    setOnSyncComplete,

    // Utils
    generatePairingCode
  };
})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OGP2P;
}
