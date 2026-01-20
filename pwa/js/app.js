/**
 * OpenGoban PWA - "Helping Hands" Edition
 *
 * A friendly community tool for tracking favors and help between neighbors.
 * Built on Cell Protocol but with human-friendly language.
 */

(function() {
  'use strict';

  // ============================================
  // STATE
  // ============================================

  const state = {
    protocol: null,
    currentMember: null,
    currentScreen: null,
    db: null,
    pendingSend: null, // For confirmation flow
    pendingJoin: null, // For join community flow
    peerManager: null, // P2P sync
    syncStatus: 'offline', // 'connected', 'syncing', 'offline', 'conflict'
  };

  // ============================================
  // INVITE CODE UTILITIES
  // ============================================

  const INVITE_PREFIX = 'HH-INVITE:';
  const INVITE_VERSION = 1;

  function encodeInviteCode(data) {
    const payload = {
      v: INVITE_VERSION,
      cellId: data.cellId,
      name: data.communityName,
      peerId: data.peerId,
      pk: data.publicKey,
      created: Date.now(),
    };
    return INVITE_PREFIX + btoa(JSON.stringify(payload));
  }

  function decodeInviteCode(code) {
    try {
      if (!code.startsWith(INVITE_PREFIX)) {
        return null;
      }
      const base64 = code.substring(INVITE_PREFIX.length);
      const payload = JSON.parse(atob(base64));

      if (payload.v !== INVITE_VERSION) {
        console.warn('Unsupported invite version:', payload.v);
        return null;
      }

      return {
        cellId: payload.cellId,
        communityName: payload.name,
        founderPeerId: payload.peerId,
        founderPublicKey: payload.pk,
        createdAt: payload.created,
      };
    } catch (e) {
      console.error('Failed to decode invite:', e);
      return null;
    }
  }

  function isInviteCode(code) {
    return code && code.startsWith(INVITE_PREFIX);
  }

  // ============================================
  // PEER MANAGER (P2P Sync via PeerJS)
  // ============================================

  const PeerManager = {
    peer: null,
    connections: new Map(), // peerId -> DataConnection
    messageHandlers: new Map(),
    reconnectTimers: new Map(),

    async initialize(peerId) {
      if (this.peer) {
        console.log('PeerManager already initialized');
        return;
      }

      return new Promise((resolve, reject) => {
        // Use public PeerJS server (can self-host later)
        this.peer = new Peer(peerId, {
          debug: 1,
        });

        this.peer.on('open', (id) => {
          console.log('PeerJS connected with ID:', id);
          updateSyncStatus('offline'); // Connected to server but no peers yet
          resolve(id);
        });

        this.peer.on('connection', (conn) => {
          console.log('Incoming connection from:', conn.peer);
          this.setupConnection(conn);
        });

        this.peer.on('error', (err) => {
          console.error('PeerJS error:', err);
          if (err.type === 'unavailable-id') {
            // ID taken, generate new one
            reject(new Error('Peer ID unavailable'));
          } else if (err.type === 'peer-unavailable') {
            // Target peer not online - that's okay
            console.log('Peer unavailable, will retry later');
          } else {
            updateSyncStatus('offline');
          }
        });

        this.peer.on('disconnected', () => {
          console.log('PeerJS disconnected');
          updateSyncStatus('offline');
        });

        setTimeout(() => reject(new Error('PeerJS connection timeout')), 10000);
      });
    },

    setupConnection(conn) {
      const peerId = conn.peer;

      conn.on('open', () => {
        console.log('Connection open with:', peerId);
        this.connections.set(peerId, conn);
        updateSyncStatus('connected');

        // Send hello message
        this.sendTo(peerId, {
          type: 'HELLO',
          memberId: state.currentMember?.memberId,
          cellId: state.currentMember?.cellId,
          name: state.currentMember?.name,
        });
      });

      conn.on('data', (data) => {
        this.handleMessage(peerId, data);
      });

      conn.on('close', () => {
        console.log('Connection closed with:', peerId);
        this.connections.delete(peerId);
        if (this.connections.size === 0) {
          updateSyncStatus('offline');
        }
        // Schedule reconnection
        this.scheduleReconnect(peerId);
      });

      conn.on('error', (err) => {
        console.error('Connection error with', peerId, ':', err);
      });
    },

    async connectToPeer(peerId) {
      if (!this.peer || this.connections.has(peerId)) {
        return;
      }

      try {
        console.log('Connecting to peer:', peerId);
        const conn = this.peer.connect(peerId, { reliable: true });
        this.setupConnection(conn);
      } catch (e) {
        console.error('Failed to connect to peer:', e);
      }
    },

    scheduleReconnect(peerId) {
      // Clear existing timer
      if (this.reconnectTimers.has(peerId)) {
        clearTimeout(this.reconnectTimers.get(peerId));
      }

      // Reconnect after 30 seconds
      const timer = setTimeout(() => {
        this.reconnectTimers.delete(peerId);
        if (state.currentMember?.knownPeers?.includes(peerId)) {
          this.connectToPeer(peerId);
        }
      }, 30000);

      this.reconnectTimers.set(peerId, timer);
    },

    sendTo(peerId, message) {
      const conn = this.connections.get(peerId);
      if (conn && conn.open) {
        conn.send(message);
      }
    },

    broadcast(message) {
      for (const [peerId, conn] of this.connections) {
        if (conn.open) {
          conn.send(message);
        }
      }
    },

    handleMessage(fromPeerId, data) {
      console.log('Received from', fromPeerId, ':', data.type);

      switch (data.type) {
        case 'HELLO':
          this.handleHello(fromPeerId, data);
          break;
        case 'LEDGER_STATE':
          this.handleLedgerState(fromPeerId, data);
          break;
        case 'TRANSACTION':
          this.handleTransaction(fromPeerId, data);
          break;
        case 'MEMBER_LIST':
          this.handleMemberList(fromPeerId, data);
          break;
        case 'REQUEST_SYNC':
          this.handleRequestSync(fromPeerId, data);
          break;
        default:
          console.warn('Unknown message type:', data.type);
      }
    },

    handleHello(fromPeerId, data) {
      // Verify same cell
      if (data.cellId !== state.currentMember?.cellId) {
        console.warn('Peer from different cell:', data.cellId);
        return;
      }

      // Add to known peers
      addKnownPeer(fromPeerId);

      // If this is a new member, add them to our ledger
      if (data.memberId && state.protocol) {
        const existing = state.protocol.ledger.getMemberState(data.memberId);
        if (!existing) {
          // Request full sync from them
          this.sendTo(fromPeerId, { type: 'REQUEST_SYNC' });
        }
      }

      showToast(`${data.name || 'A neighbor'} is online!`, 'success');
    },

    async handleLedgerState(fromPeerId, data) {
      if (!state.protocol) return;

      updateSyncStatus('syncing');

      try {
        // Merge member states
        for (const [memberId, memberData] of Object.entries(data.members || {})) {
          const existing = state.protocol.ledger.getMemberState(memberId);
          if (!existing) {
            // Add new member
            const { now } = CellProtocol;
            await state.protocol.identity.addMember({
              applicantId: memberId,
              displayName: memberData.displayName || formatName(memberId),
              publicKey: memberData.publicKey || 'synced-' + memberId,
              requestedAt: now(),
              initialLimit: memberData.limit || 100,
            });
          }
        }

        // Process transactions we don't have
        for (const tx of data.transactions || []) {
          await processRemoteTransaction(tx);
        }

        refreshScreen(state.currentScreen);
        updateSyncStatus('connected');
      } catch (e) {
        console.error('Sync error:', e);
        updateSyncStatus('conflict');
      }
    },

    async handleTransaction(fromPeerId, data) {
      await processRemoteTransaction(data.transaction);
      refreshScreen(state.currentScreen);
    },

    handleMemberList(fromPeerId, data) {
      // Update known peers
      for (const peer of data.peers || []) {
        if (peer !== state.currentMember?.peerId) {
          addKnownPeer(peer);
          // Try to connect to peers we don't know
          if (!this.connections.has(peer)) {
            this.connectToPeer(peer);
          }
        }
      }
    },

    async handleRequestSync(fromPeerId, data) {
      if (!state.protocol) return;

      // Send our full state
      const members = {};
      for (const [id, memberState] of state.protocol.ledger.getAllMemberStates()) {
        members[id] = {
          balance: memberState.balance,
          limit: memberState.limit,
          displayName: formatName(id),
        };
      }

      const transactions = await state.protocol.transactions.getMemberTransactions(
        state.currentMember.memberId,
        100
      );

      this.sendTo(fromPeerId, {
        type: 'LEDGER_STATE',
        members,
        transactions,
      });

      // Also send member list for peer discovery
      this.sendTo(fromPeerId, {
        type: 'MEMBER_LIST',
        peers: state.currentMember?.knownPeers || [],
      });
    },

    destroy() {
      if (this.peer) {
        this.peer.destroy();
        this.peer = null;
      }
      this.connections.clear();
      for (const timer of this.reconnectTimers.values()) {
        clearTimeout(timer);
      }
      this.reconnectTimers.clear();
    },
  };

  async function processRemoteTransaction(tx) {
    if (!state.protocol || !tx) return;

    try {
      // Check if we already have this transaction
      const existing = await state.protocol.transactions.getTransaction(tx.id);
      if (existing) {
        return; // Already have it
      }

      // Ensure both parties exist in our ledger
      const { now } = CellProtocol;
      for (const memberId of [tx.payerId, tx.payeeId]) {
        if (!state.protocol.ledger.getMemberState(memberId)) {
          await state.protocol.identity.addMember({
            applicantId: memberId,
            displayName: formatName(memberId),
            publicKey: 'synced-' + memberId,
            requestedAt: now(),
            initialLimit: 100,
          });
        }
      }

      // Execute the transaction locally
      await state.protocol.transactions.executeTransaction({
        payerId: tx.payerId,
        payeeId: tx.payeeId,
        amount: tx.amount,
        description: tx.description,
        timestamp: tx.timestamp || now(),
      });
    } catch (e) {
      console.error('Failed to process remote transaction:', e);
    }
  }

  function updateSyncStatus(status) {
    state.syncStatus = status;
    const indicator = document.getElementById('sync-status');
    if (indicator) {
      indicator.className = 'sync-indicator ' + status;
      indicator.title = {
        connected: 'Connected to neighbors',
        syncing: 'Syncing...',
        offline: 'Offline',
        conflict: 'Sync conflict',
      }[status] || 'Unknown';
    }
  }

  async function addKnownPeer(peerId) {
    if (!state.currentMember) return;
    if (!state.currentMember.knownPeers) {
      state.currentMember.knownPeers = [];
    }
    if (!state.currentMember.knownPeers.includes(peerId)) {
      state.currentMember.knownPeers.push(peerId);
      await saveIdentity(state.currentMember);
    }
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  async function init() {
    console.log('Helping Hands loading...');

    state.db = new PouchDB('opengoban');

    const identity = await loadIdentity();

    if (identity) {
      await initProtocol(identity.cellId);
      state.currentMember = identity;
      showApp();
      navigateTo('home');

      // Initialize P2P sync if we have a peerId
      if (identity.peerId) {
        try {
          await PeerManager.initialize(identity.peerId);
          // Connect to known peers
          for (const peerId of identity.knownPeers || []) {
            PeerManager.connectToPeer(peerId);
          }
        } catch (e) {
          console.error('Failed to initialize P2P:', e);
        }
      }
    } else {
      showCommunityChoice();
    }

    setupEventListeners();
    console.log('Helping Hands ready!');
  }

  async function initProtocol(cellId) {
    const { createCellProtocol } = CellProtocol;

    state.protocol = await createCellProtocol({
      cellId: cellId || 'community-' + generateShortId(),
    });

    console.log('Community initialized');
  }

  // ============================================
  // IDENTITY MANAGEMENT
  // ============================================

  async function loadIdentity() {
    try {
      const doc = await state.db.get('identity');
      return doc;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async function saveIdentity(identity) {
    try {
      const existing = await state.db.get('identity');
      identity._rev = existing._rev;
    } catch (e) {}
    identity._id = 'identity';
    await state.db.put(identity);
  }

  async function createIdentity(name) {
    const keyPair = nacl.sign.keyPair();
    const publicKey = nacl.util.encodeBase64(keyPair.publicKey);
    const secretKey = nacl.util.encodeBase64(keyPair.secretKey);

    const cellId = 'community-' + generateShortId();
    const memberId = 'neighbor-' + generateShortId();

    await initProtocol(cellId);

    const { now } = CellProtocol;
    await state.protocol.identity.addMember({
      applicantId: memberId,
      displayName: name,
      publicKey: publicKey,
      requestedAt: now(),
      initialLimit: 100,
    });

    const identity = {
      memberId,
      name,
      publicKey,
      secretKey,
      cellId,
      createdAt: Date.now(),
    };

    await saveIdentity(identity);
    state.currentMember = identity;

    return identity;
  }

  function generateShortId() {
    return Math.random().toString(36).substring(2, 10);
  }

  // ============================================
  // ONBOARDING - COMMUNITY CHOICE
  // ============================================

  function showCommunityChoice() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div id="community-choice-screen" class="screen active onboarding-screen">
        <!-- Friendly illustration -->
        <div class="onboarding-illustration">
          <svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Community hands illustration -->
            <circle cx="100" cy="100" r="90" fill="#F5EDE4"/>
            <circle cx="100" cy="100" r="70" fill="#4A7C59" opacity="0.1"/>
            <!-- Hands reaching in circle -->
            <g transform="translate(100,100)">
              <g transform="rotate(0)">
                <path d="M0,-60 Q15,-45 10,-30 Q5,-20 0,-25 Q-5,-20 -10,-30 Q-15,-45 0,-60" fill="#E07B54"/>
              </g>
              <g transform="rotate(72)">
                <path d="M0,-60 Q15,-45 10,-30 Q5,-20 0,-25 Q-5,-20 -10,-30 Q-15,-45 0,-60" fill="#5B8FB9"/>
              </g>
              <g transform="rotate(144)">
                <path d="M0,-60 Q15,-45 10,-30 Q5,-20 0,-25 Q-5,-20 -10,-30 Q-15,-45 0,-60" fill="#4A7C59"/>
              </g>
              <g transform="rotate(216)">
                <path d="M0,-60 Q15,-45 10,-30 Q5,-20 0,-25 Q-5,-20 -10,-30 Q-15,-45 0,-60" fill="#F4A574"/>
              </g>
              <g transform="rotate(288)">
                <path d="M0,-60 Q15,-45 10,-30 Q5,-20 0,-25 Q-5,-20 -10,-30 Q-15,-45 0,-60" fill="#8B7355"/>
              </g>
            </g>
            <!-- Heart in center -->
            <path d="M100,85 C100,75 90,70 85,70 C75,70 70,80 70,85 C70,100 100,115 100,115 C100,115 130,100 130,85 C130,80 125,70 115,70 C110,70 100,75 100,85" fill="#C45B5B"/>
          </svg>
        </div>

        <h1 class="onboarding-title">Helping Hands</h1>
        <p class="onboarding-subtitle">
          Keep track of favors with your neighbors. Help someone today, get help tomorrow.
        </p>

        <div class="community-choice-buttons">
          <button id="start-community-btn" class="choice-btn">
            <span class="choice-icon">🏠</span>
            <div class="choice-content">
              <span class="choice-label">Start a Community</span>
              <span class="choice-hint">Create a new neighborhood group</span>
            </div>
          </button>

          <button id="join-community-btn" class="choice-btn">
            <span class="choice-icon">👥</span>
            <div class="choice-content">
              <span class="choice-label">Join a Community</span>
              <span class="choice-hint">Someone invited you? Tap here</span>
            </div>
          </button>
        </div>

        <p class="text-muted mt-lg" style="font-size: 0.85rem;">
          No sign-up. No account. Everything stays on your phone.
        </p>
      </div>
    `;

    setupCommunityChoiceListeners();
  }

  function setupCommunityChoiceListeners() {
    const startBtn = document.getElementById('start-community-btn');
    const joinBtn = document.getElementById('join-community-btn');

    if (startBtn) {
      startBtn.addEventListener('click', () => showCreateCommunity());
    }

    if (joinBtn) {
      joinBtn.addEventListener('click', () => showJoinCommunity());
    }
  }

  // ============================================
  // ONBOARDING - CREATE COMMUNITY
  // ============================================

  function showCreateCommunity() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div id="create-community-screen" class="screen active onboarding-screen">
        <button id="back-to-choice" class="back-btn">← Back</button>

        <h1 class="onboarding-title" style="font-size: 1.75rem;">Start Your Community</h1>
        <p class="onboarding-subtitle">
          Give your neighborhood a name and invite your neighbors to join.
        </p>

        <div class="name-section">
          <label class="input-label">Community Name</label>
          <input
            type="text"
            id="community-name-input"
            class="name-input"
            placeholder="Oak Street Neighbors"
            maxlength="40"
          >
          <p class="input-hint">This is what your community will be called</p>
        </div>

        <div class="name-section">
          <label class="input-label">Your Name</label>
          <input
            type="text"
            id="founder-name-input"
            class="name-input"
            placeholder="Your name"
            maxlength="30"
            autocomplete="name"
          >
          <p class="input-hint">How neighbors will see you</p>
        </div>

        <button id="create-community-btn" class="btn btn-primary btn-lg btn-block">
          🏠 Create My Community
        </button>
      </div>
    `;

    setupCreateCommunityListeners();
  }

  function setupCreateCommunityListeners() {
    const backBtn = document.getElementById('back-to-choice');
    const createBtn = document.getElementById('create-community-btn');
    const communityInput = document.getElementById('community-name-input');
    const nameInput = document.getElementById('founder-name-input');

    if (backBtn) {
      backBtn.addEventListener('click', () => showCommunityChoice());
    }

    if (createBtn && communityInput && nameInput) {
      createBtn.addEventListener('click', async () => {
        const communityName = communityInput.value.trim();
        const founderName = nameInput.value.trim();

        if (communityName.length < 3) {
          showToast('Please enter a community name (at least 3 letters)', 'error');
          communityInput.focus();
          return;
        }

        if (founderName.length < 2) {
          showToast('Please enter your name (at least 2 letters)', 'error');
          nameInput.focus();
          return;
        }

        createBtn.disabled = true;
        createBtn.innerHTML = '<span class="spinner"></span> Creating...';

        try {
          await createCommunity(communityName, founderName);
          showApp();
          navigateTo('home');
          showToast(`Welcome to ${communityName}! 🎉`, 'success');

          // Show share prompt after a moment
          setTimeout(() => {
            showToast('Invite neighbors from Settings → Share Invite', 'info');
          }, 2000);
        } catch (e) {
          console.error('Create community error:', e);
          showToast('Something went wrong. Please try again.', 'error');
          createBtn.disabled = false;
          createBtn.innerHTML = '🏠 Create My Community';
        }
      });

      nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') createBtn.click();
      });
    }
  }

  // ============================================
  // ONBOARDING - JOIN COMMUNITY
  // ============================================

  function showJoinCommunity() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div id="join-community-screen" class="screen active onboarding-screen">
        <button id="back-to-choice" class="back-btn">← Back</button>

        <h1 class="onboarding-title" style="font-size: 1.75rem;">Join a Community</h1>
        <p class="onboarding-subtitle">
          Scan the invite QR code or enter the invite code shared by a neighbor.
        </p>

        <button id="scan-invite-btn" class="btn btn-warm btn-lg btn-block mb-md">
          📷 Scan Invite QR Code
        </button>

        <div class="divider-or">
          <span>or enter code manually</span>
        </div>

        <div class="name-section">
          <label class="input-label">Invite Code</label>
          <input
            type="text"
            id="invite-code-input"
            class="name-input"
            placeholder="HH-INVITE:..."
            style="font-size: 0.9rem; font-family: monospace;"
          >
          <p class="input-hint">Paste the invite code you received</p>
        </div>

        <button id="next-join-btn" class="btn btn-primary btn-lg btn-block">
          Next →
        </button>
      </div>
    `;

    setupJoinCommunityListeners();
  }

  function setupJoinCommunityListeners() {
    const backBtn = document.getElementById('back-to-choice');
    const scanBtn = document.getElementById('scan-invite-btn');
    const nextBtn = document.getElementById('next-join-btn');
    const codeInput = document.getElementById('invite-code-input');

    if (backBtn) {
      backBtn.addEventListener('click', () => showCommunityChoice());
    }

    if (scanBtn) {
      scanBtn.addEventListener('click', () => openInviteScanner());
    }

    if (nextBtn && codeInput) {
      nextBtn.addEventListener('click', () => {
        const code = codeInput.value.trim();

        if (!code) {
          showToast('Please enter an invite code', 'error');
          codeInput.focus();
          return;
        }

        const inviteData = decodeInviteCode(code);
        if (!inviteData) {
          showToast('Invalid invite code. Please check and try again.', 'error');
          return;
        }

        state.pendingJoin = inviteData;
        showJoinConfirmation(inviteData);
      });

      codeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') nextBtn.click();
      });
    }
  }

  // ============================================
  // ONBOARDING - JOIN CONFIRMATION
  // ============================================

  function showJoinConfirmation(inviteData) {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div id="join-confirm-screen" class="screen active onboarding-screen">
        <button id="back-to-join" class="back-btn">← Back</button>

        <div class="community-preview">
          <div class="community-preview-icon">🏘️</div>
          <h2 class="community-preview-name">${escapeHtml(inviteData.communityName)}</h2>
          <p class="community-preview-hint">You're about to join this community</p>
        </div>

        <div class="name-section">
          <label class="input-label">Your Name</label>
          <input
            type="text"
            id="joiner-name-input"
            class="name-input"
            placeholder="Your name"
            maxlength="30"
            autocomplete="name"
          >
          <p class="input-hint">How neighbors will see you</p>
        </div>

        <button id="confirm-join-btn" class="btn btn-primary btn-lg btn-block">
          👥 Join ${escapeHtml(inviteData.communityName)}
        </button>
      </div>
    `;

    setupJoinConfirmationListeners(inviteData);
  }

  function setupJoinConfirmationListeners(inviteData) {
    const backBtn = document.getElementById('back-to-join');
    const confirmBtn = document.getElementById('confirm-join-btn');
    const nameInput = document.getElementById('joiner-name-input');

    if (backBtn) {
      backBtn.addEventListener('click', () => showJoinCommunity());
    }

    if (confirmBtn && nameInput) {
      confirmBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();

        if (name.length < 2) {
          showToast('Please enter your name (at least 2 letters)', 'error');
          nameInput.focus();
          return;
        }

        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span class="spinner"></span> Joining...';

        try {
          await joinCommunity(inviteData, name);
          showApp();
          navigateTo('home');
          showToast(`Welcome to ${inviteData.communityName}! 🎉`, 'success');
        } catch (e) {
          console.error('Join community error:', e);
          showToast('Something went wrong. Please try again.', 'error');
          confirmBtn.disabled = false;
          confirmBtn.innerHTML = `👥 Join ${escapeHtml(inviteData.communityName)}`;
        }
      });

      nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') confirmBtn.click();
      });
    }
  }

  // ============================================
  // COMMUNITY CREATION & JOINING
  // ============================================

  async function createCommunity(communityName, founderName) {
    const keyPair = nacl.sign.keyPair();
    const publicKey = nacl.util.encodeBase64(keyPair.publicKey);
    const secretKey = nacl.util.encodeBase64(keyPair.secretKey);

    const cellId = 'community-' + generateShortId();
    const memberId = 'neighbor-' + generateShortId();
    const peerId = 'hh-' + generateShortId();

    await initProtocol(cellId);

    const { now } = CellProtocol;
    await state.protocol.identity.addMember({
      applicantId: memberId,
      displayName: founderName,
      publicKey: publicKey,
      requestedAt: now(),
      initialLimit: 100,
    });

    const identity = {
      memberId,
      name: founderName,
      publicKey,
      secretKey,
      cellId,
      createdAt: Date.now(),
      // Community fields
      communityName,
      isFounder: true,
      joinedAt: Date.now(),
      peerId,
      knownPeers: [],
    };

    await saveIdentity(identity);
    state.currentMember = identity;

    // Initialize P2P
    try {
      await PeerManager.initialize(peerId);
    } catch (e) {
      console.warn('P2P initialization failed:', e);
    }

    return identity;
  }

  async function joinCommunity(inviteData, memberName) {
    const keyPair = nacl.sign.keyPair();
    const publicKey = nacl.util.encodeBase64(keyPair.publicKey);
    const secretKey = nacl.util.encodeBase64(keyPair.secretKey);

    const memberId = 'neighbor-' + generateShortId();
    const peerId = 'hh-' + generateShortId();

    // Use the cell ID from the invite
    await initProtocol(inviteData.cellId);

    const { now } = CellProtocol;
    await state.protocol.identity.addMember({
      applicantId: memberId,
      displayName: memberName,
      publicKey: publicKey,
      requestedAt: now(),
      initialLimit: 100,
    });

    const identity = {
      memberId,
      name: memberName,
      publicKey,
      secretKey,
      cellId: inviteData.cellId,
      createdAt: Date.now(),
      // Community fields
      communityName: inviteData.communityName,
      isFounder: false,
      joinedAt: Date.now(),
      peerId,
      knownPeers: [inviteData.founderPeerId], // Start with founder as known peer
    };

    await saveIdentity(identity);
    state.currentMember = identity;

    // Initialize P2P and connect to founder
    try {
      await PeerManager.initialize(peerId);
      // Connect to founder to sync
      if (inviteData.founderPeerId) {
        PeerManager.connectToPeer(inviteData.founderPeerId);
      }
    } catch (e) {
      console.warn('P2P initialization failed:', e);
    }

    return identity;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Legacy function for backwards compatibility
  function showOnboarding() {
    showCommunityChoice();
  }

  function setupOnboardingListeners() {
    // Handled by individual screen listeners
  }

  // ============================================
  // MAIN APP
  // ============================================

  function showApp() {
    const app = document.getElementById('app');
    const communityName = state.currentMember?.communityName || 'Community';

    app.innerHTML = `
      <header class="app-header">
        <div>
          <div class="header-community" id="header-community">${escapeHtml(communityName)}</div>
          <div class="header-name" id="header-name">Neighbor</div>
        </div>
        <div class="header-right">
          <div id="sync-status" class="sync-indicator offline" title="Offline"></div>
          <div id="header-balance" class="header-balance zero">
            <span>🤝</span>
            <span id="header-balance-num">0</span>
          </div>
        </div>
      </header>

      <main class="app-main">
        ${renderHomeScreen()}
        ${renderHistoryScreen()}
        ${renderNeighborsScreen()}
        ${renderSettingsScreen()}
      </main>

      <nav class="app-nav">
        <a href="#" class="nav-item active" data-screen="home">
          <span class="nav-icon">🏠</span>
          <span>Home</span>
        </a>
        <a href="#" class="nav-item" data-screen="history">
          <span class="nav-icon">📋</span>
          <span>History</span>
        </a>
        <a href="#" class="nav-item" data-screen="neighbors">
          <span class="nav-icon">👥</span>
          <span>Neighbors</span>
        </a>
        <a href="#" class="nav-item" data-screen="settings">
          <span class="nav-icon">⚙️</span>
          <span>Settings</span>
        </a>
      </nav>

      ${renderModals()}
    `;

    // Update header name
    const headerName = document.getElementById('header-name');
    if (headerName && state.currentMember) {
      headerName.textContent = state.currentMember.name;
    }
  }

  // ============================================
  // SCREEN RENDERERS
  // ============================================

  function renderHomeScreen() {
    return `
      <div id="home-screen" class="screen">
        <div class="balance-card">
          <div class="balance-label">Your Helping Hands Balance</div>
          <div class="balance-amount">
            <span>🤝</span>
            <span id="balance-num">0</span>
          </div>
          <div class="balance-unit">helping hands</div>
          <p class="balance-explainer" id="balance-explainer">
            When you help someone, they give you a hand. When someone helps you, you give them one.
          </p>
        </div>

        <div class="action-buttons">
          <button id="give-thanks-btn" class="action-btn">
            <span class="action-icon">🙏</span>
            <span class="action-label">Give Thanks</span>
            <span class="action-hint">Someone helped you</span>
          </button>
          <button id="share-code-btn" class="action-btn">
            <span class="action-icon">📲</span>
            <span class="action-label">Share My Code</span>
            <span class="action-hint">Let others find you</span>
          </button>
        </div>

        <div class="how-it-works">
          <div class="section-title">💡 How It Works</div>
          <div class="how-step">
            <div class="step-number">1</div>
            <div class="step-text">Your neighbor helps you with something (watching kids, lending tools, etc.)</div>
          </div>
          <div class="how-step">
            <div class="step-number">2</div>
            <div class="step-text">You tap "Give Thanks" and send them some helping hands</div>
          </div>
          <div class="how-step">
            <div class="step-number">3</div>
            <div class="step-text">Later, you help someone else and they send hands to you</div>
          </div>
        </div>

        <div class="activity-section">
          <div class="section-title">📜 Recent Activity</div>
          <div id="recent-activity">
            <div class="empty-state">
              <div class="empty-icon">🌱</div>
              <div class="empty-title">No activity yet</div>
              <div class="empty-text">Start by helping a neighbor or asking for help!</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderHistoryScreen() {
    return `
      <div id="history-screen" class="screen">
        <h2 style="margin-bottom: var(--spacing-lg); font-weight: 700;">All Activity</h2>
        <div id="full-history">
          <div class="empty-state">
            <div class="empty-icon">📋</div>
            <div class="empty-title">No history yet</div>
            <div class="empty-text">Your exchanges with neighbors will appear here</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderNeighborsScreen() {
    return `
      <div id="neighbors-screen" class="screen">
        <h2 style="margin-bottom: var(--spacing-lg); font-weight: 700;">Your Neighbors</h2>
        <div class="form-group">
          <input
            type="text"
            id="neighbor-search"
            class="form-input"
            placeholder="🔍 Search neighbors..."
          >
        </div>
        <div id="neighbor-list">
          <div class="empty-state">
            <div class="empty-icon">👥</div>
            <div class="empty-title">No neighbors yet</div>
            <div class="empty-text">When you exchange helping hands with someone, they'll appear here</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderSettingsScreen() {
    return `
      <div id="settings-screen" class="screen">
        <div class="settings-card">
          <div class="settings-title">Your Community</div>
          <div class="community-display">
            <div class="community-icon">🏘️</div>
            <div>
              <div class="community-name-display" id="settings-community-name">Loading...</div>
              <div class="community-role" id="settings-community-role">Member</div>
            </div>
          </div>
          <button id="share-invite-btn" class="btn btn-warm btn-block mt-md">
            📨 Invite Neighbors
          </button>
          <p class="form-hint mt-sm text-center">
            Share your invite to grow your community
          </p>
        </div>

        <div class="settings-card">
          <div class="settings-title">Your Profile</div>
          <div class="profile-display">
            <div class="profile-avatar" id="settings-avatar">👤</div>
            <div>
              <div class="profile-name" id="settings-name">Loading...</div>
              <div class="profile-id" id="settings-id"></div>
            </div>
          </div>
        </div>

        <div class="settings-card">
          <div class="settings-title">Your Standing</div>
          <div class="settings-row">
            <span class="settings-label">Current balance</span>
            <span class="settings-value" id="settings-balance">0 🤝</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">Trust limit</span>
            <span class="settings-value" id="settings-limit">100 🤝</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">Available to give</span>
            <span class="settings-value" id="settings-available">100 🤝</span>
          </div>
          <p class="form-hint mt-sm">
            💡 Your trust limit is how many helping hands you can give before receiving some back.
          </p>
        </div>

        <div class="settings-card">
          <div class="settings-title">Sync Status</div>
          <div class="settings-row">
            <span class="settings-label">Connection</span>
            <span class="settings-value" id="settings-sync-status">Offline</span>
          </div>
          <div class="settings-row">
            <span class="settings-label">Known neighbors</span>
            <span class="settings-value" id="settings-peer-count">0</span>
          </div>
          <p class="form-hint mt-sm">
            💡 When online, your transactions sync automatically with connected neighbors.
          </p>
        </div>

        <div class="settings-card">
          <div class="settings-title">Backup</div>
          <p class="form-hint mb-md">
            Save your identity so you can restore it on a new phone.
          </p>
          <button id="backup-btn" class="btn btn-secondary btn-block">
            💾 Create Backup
          </button>
        </div>

        <div class="settings-card">
          <div class="settings-title">About</div>
          <p class="text-muted">Helping Hands v2.0</p>
          <p class="form-hint">
            A community tool for tracking mutual aid. Built with love for neighbors everywhere.
          </p>
        </div>

        <button id="reset-btn" class="btn btn-danger btn-block mt-lg">
          🗑️ Reset Everything
        </button>
        <p class="form-hint text-center mt-sm">This will delete all your data. Make a backup first!</p>
      </div>
    `;
  }

  function renderModals() {
    return `
      <!-- Give Thanks Modal -->
      <div id="give-thanks-modal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">🙏 Give Thanks</h3>
            <button class="modal-close" data-close-modal>✕</button>
          </div>
          <div class="modal-body">
            <p class="form-hint mb-md">
              Someone helped you? Send them some helping hands to say thanks!
            </p>
            <div class="form-group">
              <label class="form-label">Who helped you?</label>
              <input type="text" id="recipient-input" class="form-input" placeholder="Their code (neighbor-xxxxx)">
              <p class="form-hint">Ask them to share their code, or scan their QR</p>
            </div>
            <div class="form-group">
              <label class="form-label">How many helping hands?</label>
              <input type="number" id="amount-input" class="form-input form-input-lg" placeholder="5" min="1" max="50" value="5">
              <p class="form-hint">A small favor = 1-5 | A big help = 10-20</p>
            </div>
            <div class="form-group">
              <label class="form-label">What did they help with? (optional)</label>
              <input type="text" id="note-input" class="form-input" placeholder="Helped me move furniture">
            </div>
            <button id="scan-code-btn" class="btn btn-secondary btn-block mb-md">
              📷 Scan Their QR Code
            </button>
            <button id="preview-send-btn" class="btn btn-primary btn-block btn-lg">
              Continue →
            </button>
          </div>
        </div>
      </div>

      <!-- Confirm Send Modal -->
      <div id="confirm-modal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Confirm</h3>
            <button class="modal-close" data-close-modal>✕</button>
          </div>
          <div class="modal-body">
            <div class="confirm-dialog">
              <div class="confirm-icon">🤝</div>
              <h3 class="confirm-title">Send Helping Hands?</h3>
              <p class="confirm-message">You're about to thank someone for their help</p>
              <div class="confirm-details">
                <div class="confirm-amount" id="confirm-amount">5 🤝</div>
                <div class="confirm-recipient">to <span id="confirm-recipient">neighbor</span></div>
                <div class="form-hint mt-sm" id="confirm-note"></div>
              </div>
              <div class="confirm-buttons">
                <button class="btn btn-secondary" data-close-modal>Cancel</button>
                <button id="confirm-send-btn" class="btn btn-primary">Yes, Send! 🙏</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Share Code Modal -->
      <div id="share-code-modal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">📲 Your Code</h3>
            <button class="modal-close" data-close-modal>✕</button>
          </div>
          <div class="modal-body">
            <div class="qr-section">
              <p class="qr-instructions">Show this to a neighbor so they can send you helping hands</p>
              <div id="qr-code" class="qr-container"></div>
              <div class="qr-id" id="my-code"></div>
            </div>
            <button id="copy-code-btn" class="btn btn-secondary btn-block mt-md">
              📋 Copy Code
            </button>
          </div>
        </div>
      </div>

      <!-- Scanner Modal -->
      <div id="scanner-modal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">📷 Scan Code</h3>
            <button class="modal-close" data-close-modal>✕</button>
          </div>
          <div class="modal-body">
            <div class="scanner-container">
              <video id="scanner-video" class="scanner-video" playsinline></video>
              <div class="scanner-overlay">
                <div class="scanner-frame"></div>
              </div>
              <div class="scanner-hint">Point at their QR code</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Backup Modal -->
      <div id="backup-modal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">💾 Your Backup</h3>
            <button class="modal-close" data-close-modal>✕</button>
          </div>
          <div class="modal-body">
            <p class="form-hint mb-md">
              Copy this code and keep it safe. You'll need it to restore your identity on a new phone.
            </p>
            <textarea id="backup-code" class="form-input" rows="4" readonly style="font-family: monospace; font-size: 0.8rem;"></textarea>
            <button id="copy-backup-btn" class="btn btn-primary btn-block mt-md">
              📋 Copy Backup Code
            </button>
            <p class="form-hint mt-md text-center" style="color: var(--berry-red);">
              ⚠️ Anyone with this code can access your account. Keep it secret!
            </p>
          </div>
        </div>
      </div>

      <!-- Share Invite Modal -->
      <div id="share-invite-modal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">📨 Invite Neighbors</h3>
            <button class="modal-close" data-close-modal>✕</button>
          </div>
          <div class="modal-body">
            <div class="invite-section">
              <p class="invite-instructions">Share this with neighbors to invite them to your community</p>
              <div class="invite-community-name" id="invite-community-name"></div>
              <div id="invite-qr-code" class="qr-container"></div>
            </div>
            <div class="invite-code-display" id="invite-code-display"></div>
            <div class="invite-buttons">
              <button id="copy-invite-btn" class="btn btn-secondary">
                📋 Copy Code
              </button>
              <button id="share-invite-native-btn" class="btn btn-primary">
                📤 Share
              </button>
            </div>
            <p class="form-hint mt-md text-center">
              Anyone with this code can join your community
            </p>
          </div>
        </div>
      </div>

      <!-- Invite Scanner Modal (for joining) -->
      <div id="invite-scanner-modal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">📷 Scan Invite</h3>
            <button class="modal-close" data-close-modal>✕</button>
          </div>
          <div class="modal-body">
            <div class="scanner-container">
              <video id="invite-scanner-video" class="scanner-video" playsinline></video>
              <div class="scanner-overlay">
                <div class="scanner-frame"></div>
              </div>
              <div class="scanner-hint">Point at the invite QR code</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================
  // NAVIGATION
  // ============================================

  function navigateTo(screenName) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

    const screen = document.getElementById(`${screenName}-screen`);
    if (screen) {
      screen.classList.add('active');
    }

    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.screen === screenName);
    });

    state.currentScreen = screenName;
    refreshScreen(screenName);
  }

  async function refreshScreen(screenName) {
    switch (screenName) {
      case 'home':
        await refreshHomeScreen();
        break;
      case 'history':
        await refreshHistoryScreen();
        break;
      case 'neighbors':
        await refreshNeighborsScreen();
        break;
      case 'settings':
        await refreshSettingsScreen();
        break;
    }
  }

  // ============================================
  // SCREEN REFRESHERS
  // ============================================

  async function refreshHomeScreen() {
    if (!state.protocol || !state.currentMember) return;

    try {
      const memberState = state.protocol.ledger.getMemberState(state.currentMember.memberId);

      if (memberState) {
        const balance = memberState.balance;

        // Update balance displays
        const balanceNum = document.getElementById('balance-num');
        const headerBalanceNum = document.getElementById('header-balance-num');
        const headerBalance = document.getElementById('header-balance');
        const explainer = document.getElementById('balance-explainer');

        if (balanceNum) balanceNum.textContent = balance;
        if (headerBalanceNum) headerBalanceNum.textContent = balance;

        if (headerBalance) {
          headerBalance.classList.remove('positive', 'negative', 'zero');
          if (balance > 0) {
            headerBalance.classList.add('positive');
          } else if (balance < 0) {
            headerBalance.classList.add('negative');
          } else {
            headerBalance.classList.add('zero');
          }
        }

        if (explainer) {
          if (balance > 0) {
            explainer.textContent = `You've helped more than you've asked! People owe you ${balance} helping hands.`;
          } else if (balance < 0) {
            explainer.textContent = `You've received ${Math.abs(balance)} more hands than you've given. Help a neighbor to balance out!`;
          } else {
            explainer.textContent = `When you help someone, they give you a hand. When someone helps you, you give them one.`;
          }
        }
      }

      await refreshActivityList('recent-activity', 3);
    } catch (e) {
      console.error('Error refreshing home:', e);
    }
  }

  async function refreshHistoryScreen() {
    await refreshActivityList('full-history', 50);
  }

  async function refreshActivityList(elementId, limit) {
    const container = document.getElementById(elementId);
    if (!container || !state.protocol) return;

    try {
      const transactions = await state.protocol.transactions.getMemberTransactions(
        state.currentMember.memberId,
        limit
      );

      if (!transactions || transactions.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🌱</div>
            <div class="empty-title">No activity yet</div>
            <div class="empty-text">Start by helping a neighbor!</div>
          </div>
        `;
        return;
      }

      container.innerHTML = `<ul class="activity-list">
        ${transactions.map(tx => {
          const isReceived = tx.payerId !== state.currentMember.memberId;
          const otherParty = isReceived ? tx.payerId : tx.payeeId;
          const amount = tx.amount;

          return `
            <li class="activity-item">
              <div class="activity-avatar">${isReceived ? '🙏' : '💚'}</div>
              <div class="activity-details">
                <div class="activity-name">${isReceived ? 'Received from' : 'Gave to'} ${formatName(otherParty)}</div>
                <div class="activity-desc">${tx.description || (isReceived ? 'Thanks received' : 'Thanks given')}</div>
              </div>
              <div class="activity-amount ${isReceived ? 'received' : 'given'}">${amount}</div>
            </li>
          `;
        }).join('')}
      </ul>`;
    } catch (e) {
      console.error('Error loading activity:', e);
    }
  }

  async function refreshNeighborsScreen() {
    const container = document.getElementById('neighbor-list');
    if (!container || !state.protocol) return;

    try {
      const members = state.protocol.ledger.getAllMemberStates();
      const memberArray = Array.from(members.entries())
        .filter(([id]) => id !== state.currentMember.memberId);

      if (memberArray.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">👥</div>
            <div class="empty-title">No neighbors yet</div>
            <div class="empty-text">When you exchange helping hands, neighbors appear here</div>
          </div>
        `;
        return;
      }

      container.innerHTML = memberArray.map(([id, member]) => `
        <div class="member-item" data-member-id="${id}">
          <div class="member-avatar">${getInitials(id)}</div>
          <div>
            <div class="member-name">${formatName(id)}</div>
            <div class="member-status">Neighbor</div>
          </div>
        </div>
      `).join('');
    } catch (e) {
      console.error('Error loading neighbors:', e);
    }
  }

  async function refreshSettingsScreen() {
    if (!state.currentMember) return;

    const nameEl = document.getElementById('settings-name');
    const idEl = document.getElementById('settings-id');
    const avatarEl = document.getElementById('settings-avatar');
    const balanceEl = document.getElementById('settings-balance');
    const limitEl = document.getElementById('settings-limit');
    const availableEl = document.getElementById('settings-available');

    // Community fields
    const communityNameEl = document.getElementById('settings-community-name');
    const communityRoleEl = document.getElementById('settings-community-role');
    const syncStatusEl = document.getElementById('settings-sync-status');
    const peerCountEl = document.getElementById('settings-peer-count');

    if (nameEl) nameEl.textContent = state.currentMember.name;
    if (idEl) idEl.textContent = state.currentMember.memberId;
    if (avatarEl) avatarEl.textContent = getInitials(state.currentMember.name);

    // Community info
    if (communityNameEl) communityNameEl.textContent = state.currentMember.communityName || 'My Community';
    if (communityRoleEl) communityRoleEl.textContent = state.currentMember.isFounder ? 'Founder' : 'Member';

    // Sync status
    if (syncStatusEl) {
      const statusText = {
        connected: 'Connected',
        syncing: 'Syncing...',
        offline: 'Offline',
        conflict: 'Conflict',
      }[state.syncStatus] || 'Unknown';
      syncStatusEl.textContent = statusText;
      syncStatusEl.className = 'settings-value ' + (state.syncStatus === 'connected' ? 'positive' : '');
    }
    if (peerCountEl) {
      peerCountEl.textContent = (state.currentMember.knownPeers || []).length.toString();
    }

    if (state.protocol) {
      const memberState = state.protocol.ledger.getMemberState(state.currentMember.memberId);
      if (memberState) {
        const balance = memberState.balance;
        const balanceClass = balance > 0 ? 'positive' : (balance < 0 ? 'negative' : '');

        if (balanceEl) {
          balanceEl.textContent = `${balance} 🤝`;
          balanceEl.className = 'settings-value ' + balanceClass;
        }
        if (limitEl) limitEl.textContent = `${memberState.limit} 🤝`;
        if (availableEl) availableEl.textContent = `${memberState.limit + memberState.balance - memberState.reserve} 🤝`;
      }
    }
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================

  function setupEventListeners() {
    document.addEventListener('click', (e) => {
      // Navigation
      const navItem = e.target.closest('.nav-item');
      if (navItem) {
        e.preventDefault();
        navigateTo(navItem.dataset.screen);
      }

      // Modal close
      if (e.target.matches('[data-close-modal]') || e.target.matches('.modal-overlay')) {
        closeAllModals();
      }

      // Action buttons
      if (e.target.closest('#give-thanks-btn')) openModal('give-thanks-modal');
      if (e.target.closest('#share-code-btn')) openShareCodeModal();
      if (e.target.closest('#scan-code-btn')) openScanner();
      if (e.target.closest('#backup-btn')) openBackupModal();
      if (e.target.closest('#reset-btn')) confirmReset();
      if (e.target.closest('#share-invite-btn')) openShareInviteModal();
      if (e.target.closest('#copy-invite-btn')) copyInviteCode();
      if (e.target.closest('#share-invite-native-btn')) shareInviteNative();

      // Send flow
      if (e.target.matches('#preview-send-btn')) previewSend();
      if (e.target.matches('#confirm-send-btn')) executeSend();
      if (e.target.matches('#copy-code-btn')) copyMyCode();
      if (e.target.matches('#copy-backup-btn')) copyBackupCode();

      // Neighbor selection
      const memberItem = e.target.closest('.member-item');
      if (memberItem) {
        const memberId = memberItem.dataset.memberId;
        if (memberId) {
          document.getElementById('recipient-input').value = memberId;
          openModal('give-thanks-modal');
        }
      }
    });
  }

  // ============================================
  // MODAL HANDLERS
  // ============================================

  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    stopScanner();
    stopInviteScanner();
  }

  function openShareCodeModal() {
    openModal('share-code-modal');

    const qrContainer = document.getElementById('qr-code');
    const codeDisplay = document.getElementById('my-code');

    if (qrContainer && state.currentMember) {
      qrContainer.innerHTML = '';
      new QRCode(qrContainer, {
        text: state.currentMember.memberId,
        width: 180,
        height: 180,
        colorDark: '#3D3425',
        colorLight: '#ffffff',
      });
    }

    if (codeDisplay && state.currentMember) {
      codeDisplay.textContent = state.currentMember.memberId;
    }
  }

  function openBackupModal() {
    openModal('backup-modal');

    const codeEl = document.getElementById('backup-code');
    if (codeEl && state.currentMember) {
      const backup = {
        v: 2,
        id: state.currentMember.memberId,
        name: state.currentMember.name,
        pk: state.currentMember.publicKey,
        sk: state.currentMember.secretKey,
        cell: state.currentMember.cellId,
        community: state.currentMember.communityName,
        peerId: state.currentMember.peerId,
      };
      codeEl.value = 'HH2:' + btoa(JSON.stringify(backup));
    }
  }

  function openShareInviteModal() {
    openModal('share-invite-modal');

    const qrContainer = document.getElementById('invite-qr-code');
    const codeDisplay = document.getElementById('invite-code-display');
    const communityNameDisplay = document.getElementById('invite-community-name');

    if (state.currentMember) {
      const inviteCode = encodeInviteCode({
        cellId: state.currentMember.cellId,
        communityName: state.currentMember.communityName,
        peerId: state.currentMember.peerId,
        publicKey: state.currentMember.publicKey,
      });

      if (qrContainer) {
        qrContainer.innerHTML = '';
        new QRCode(qrContainer, {
          text: inviteCode,
          width: 200,
          height: 200,
          colorDark: '#3D3425',
          colorLight: '#ffffff',
        });
      }

      if (codeDisplay) {
        codeDisplay.textContent = inviteCode;
      }

      if (communityNameDisplay) {
        communityNameDisplay.textContent = state.currentMember.communityName || 'My Community';
      }
    }
  }

  function copyInviteCode() {
    if (!state.currentMember) return;

    const inviteCode = encodeInviteCode({
      cellId: state.currentMember.cellId,
      communityName: state.currentMember.communityName,
      peerId: state.currentMember.peerId,
      publicKey: state.currentMember.publicKey,
    });

    copyToClipboard(inviteCode);
  }

  async function shareInviteNative() {
    if (!state.currentMember) return;

    const inviteCode = encodeInviteCode({
      cellId: state.currentMember.cellId,
      communityName: state.currentMember.communityName,
      peerId: state.currentMember.peerId,
      publicKey: state.currentMember.publicKey,
    });

    const shareData = {
      title: `Join ${state.currentMember.communityName}`,
      text: `Join our Helping Hands community! Use this invite code:\n\n${inviteCode}`,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('Share failed:', e);
          copyToClipboard(inviteCode);
        }
      }
    } else {
      copyToClipboard(inviteCode);
    }
  }

  // Invite scanner (for onboarding join flow)
  let inviteScannerStream = null;

  async function openInviteScanner() {
    openModal('invite-scanner-modal');

    const video = document.getElementById('invite-scanner-video');
    if (!video) return;

    try {
      inviteScannerStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      video.srcObject = inviteScannerStream;
      video.play();

      requestAnimationFrame(scanInviteFrame);
    } catch (e) {
      console.error('Camera error:', e);
      showToast('Could not access camera', 'error');
      closeAllModals();
    }
  }

  function scanInviteFrame() {
    if (!inviteScannerStream) return;

    const video = document.getElementById('invite-scanner-video');
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      requestAnimationFrame(scanInviteFrame);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (code) {
      handleScannedInviteCode(code.data);
      return;
    }

    requestAnimationFrame(scanInviteFrame);
  }

  function stopInviteScanner() {
    if (inviteScannerStream) {
      inviteScannerStream.getTracks().forEach(t => t.stop());
      inviteScannerStream = null;
    }
  }

  function handleScannedInviteCode(data) {
    console.log('Scanned invite:', data);

    if (isInviteCode(data)) {
      const inviteData = decodeInviteCode(data);
      if (inviteData) {
        stopInviteScanner();
        closeAllModals();
        state.pendingJoin = inviteData;
        showJoinConfirmation(inviteData);
        showToast('Invite scanned!', 'success');
        return;
      }
    }

    showToast('Not a valid invite code', 'error');
    requestAnimationFrame(scanInviteFrame);
  }

  // ============================================
  // SEND FLOW
  // ============================================

  function previewSend() {
    const recipientInput = document.getElementById('recipient-input');
    const amountInput = document.getElementById('amount-input');
    const noteInput = document.getElementById('note-input');

    const recipient = recipientInput?.value.trim();
    const amount = parseInt(amountInput?.value || '5', 10);
    const note = noteInput?.value.trim();

    if (!recipient) {
      showToast('Please enter who you want to thank', 'error');
      recipientInput?.focus();
      return;
    }

    if (amount <= 0 || amount > 50) {
      showToast('Please enter an amount between 1 and 50', 'error');
      amountInput?.focus();
      return;
    }

    // Store pending send
    state.pendingSend = { recipient, amount, note };

    // Update confirmation dialog
    document.getElementById('confirm-amount').textContent = `${amount} 🤝`;
    document.getElementById('confirm-recipient').textContent = formatName(recipient);
    document.getElementById('confirm-note').textContent = note ? `"${note}"` : '';

    closeAllModals();
    openModal('confirm-modal');
  }

  async function executeSend() {
    if (!state.pendingSend) return;

    const { recipient, amount, note } = state.pendingSend;
    const sendBtn = document.getElementById('confirm-send-btn');

    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="spinner"></span>';

    try {
      const { now } = CellProtocol;

      // Check if recipient exists, if not add them
      let recipientState = state.protocol.ledger.getMemberState(recipient);
      if (!recipientState) {
        await state.protocol.identity.addMember({
          applicantId: recipient,
          displayName: formatName(recipient),
          publicKey: 'pending-' + recipient,
          requestedAt: now(),
          initialLimit: 100,
        });
      }

      // Execute transaction (give thanks = we are the payer, giving hands to them)
      const result = await state.protocol.transactions.executeTransaction({
        payerId: state.currentMember.memberId,
        payeeId: recipient,
        amount,
        description: note || 'Thanks!',
        timestamp: now(),
      });

      if (result.success) {
        closeAllModals();
        showToast(`Sent ${amount} helping hands! 🙏`, 'success');
        state.pendingSend = null;
        refreshHomeScreen();

        // Broadcast transaction to peers
        if (PeerManager.connections.size > 0) {
          PeerManager.broadcast({
            type: 'TRANSACTION',
            transaction: {
              id: result.transactionId,
              payerId: state.currentMember.memberId,
              payeeId: recipient,
              amount,
              description: note || 'Thanks!',
              timestamp: Date.now(),
            },
          });
        }

        // Clear form
        document.getElementById('recipient-input').value = '';
        document.getElementById('amount-input').value = '5';
        document.getElementById('note-input').value = '';
      } else {
        showToast(result.error || 'Could not send. Please try again.', 'error');
      }
    } catch (e) {
      console.error('Send error:', e);
      showToast(e.message || 'Something went wrong', 'error');
    } finally {
      sendBtn.disabled = false;
      sendBtn.innerHTML = 'Yes, Send! 🙏';
    }
  }

  // ============================================
  // QR SCANNER
  // ============================================

  let scannerStream = null;

  async function openScanner() {
    closeAllModals();
    openModal('scanner-modal');

    const video = document.getElementById('scanner-video');
    if (!video) return;

    try {
      scannerStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      video.srcObject = scannerStream;
      video.play();

      requestAnimationFrame(scanFrame);
    } catch (e) {
      console.error('Camera error:', e);
      showToast('Could not access camera', 'error');
      closeAllModals();
    }
  }

  function scanFrame() {
    if (!scannerStream) return;

    const video = document.getElementById('scanner-video');
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      requestAnimationFrame(scanFrame);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);

    if (code) {
      handleScannedCode(code.data);
      closeAllModals();
      return;
    }

    requestAnimationFrame(scanFrame);
  }

  function stopScanner() {
    if (scannerStream) {
      scannerStream.getTracks().forEach(t => t.stop());
      scannerStream = null;
    }
  }

  function handleScannedCode(data) {
    console.log('Scanned:', data);

    // Check if it's an invite code
    if (isInviteCode(data)) {
      showToast('This is an invite code. Use it from the join community screen.', 'info');
      return;
    }

    if (data.startsWith('neighbor-') || data.startsWith('member-')) {
      document.getElementById('recipient-input').value = data;
      openModal('give-thanks-modal');
      showToast('Code scanned! ✓', 'success');
    } else {
      showToast('Not a valid neighbor code', 'error');
    }
  }

  // ============================================
  // UTILITIES
  // ============================================

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container') || createToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
      <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => toast.remove(), 4000);
  }

  function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
    return container;
  }

  function copyMyCode() {
    if (state.currentMember) {
      copyToClipboard(state.currentMember.memberId);
    }
  }

  function copyBackupCode() {
    const codeEl = document.getElementById('backup-code');
    if (codeEl) {
      copyToClipboard(codeEl.value);
    }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied! 📋', 'success');
    }).catch(() => {
      showToast('Could not copy', 'error');
    });
  }

  function confirmReset() {
    if (confirm('This will delete all your data!\n\nAre you sure you want to start over?')) {
      if (confirm('Really delete everything? This cannot be undone.')) {
        state.db.destroy().then(() => {
          location.reload();
        });
      }
    }
  }

  function formatName(id) {
    if (!id) return 'Unknown';
    // If it's a neighbor-xxx or member-xxx format, just show a friendlier version
    if (id.startsWith('neighbor-') || id.startsWith('member-')) {
      return 'Neighbor ' + id.split('-')[1].substring(0, 4).toUpperCase();
    }
    return id;
  }

  function getInitials(name) {
    if (!name) return '👤';
    const parts = name.split(/[\s-]+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }

  // ============================================
  // STARTUP
  // ============================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
