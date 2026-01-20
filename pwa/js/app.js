/**
 * OpenGoban PWA - Main Application
 *
 * Connects the UI to the Cell Protocol backend.
 */

(function() {
  'use strict';

  // ============================================
  // STATE
  // ============================================

  const state = {
    protocol: null,        // CellProtocol instance
    currentMember: null,   // Current logged-in member
    currentScreen: null,   // Active screen name
    db: null,              // PouchDB for local storage
  };

  // ============================================
  // INITIALIZATION
  // ============================================

  async function init() {
    console.log('OpenGoban initializing...');

    // Initialize local database
    state.db = new PouchDB('opengoban');

    // Check if user has an identity
    const identity = await loadIdentity();

    if (identity) {
      // Load existing protocol
      await initProtocol(identity.cellId);
      state.currentMember = identity;
      showApp();
      navigateTo('home');
      // Initialize P2P after a short delay
      setTimeout(() => {
        initP2P();
        addSyncUI();
      }, 500);
    } else {
      // Show onboarding
      showScreen('onboarding');
    }

    // Set up event listeners
    setupEventListeners();

    console.log('OpenGoban ready');
  }

  async function initProtocol(cellId) {
    const { createCellProtocol, createInMemoryStorage } = CellProtocol;

    // Create protocol instance
    // Note: Using in-memory storage for now, will integrate with PouchDB later
    state.protocol = await createCellProtocol({
      cellId: cellId || 'default-cell',
    });

    console.log('Cell Protocol initialized');
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
    } catch (e) {
      // New document
    }
    identity._id = 'identity';
    await state.db.put(identity);
  }

  async function createIdentity(handle) {
    // Generate Ed25519 keypair
    const keyPair = nacl.sign.keyPair();
    const publicKey = nacl.util.encodeBase64(keyPair.publicKey);
    const secretKey = nacl.util.encodeBase64(keyPair.secretKey);

    const cellId = 'cell-' + generateShortId();
    const memberId = 'member-' + generateShortId();

    // Initialize protocol
    await initProtocol(cellId);

    // Add member to protocol
    const { now } = CellProtocol;
    await state.protocol.identity.addMember({
      applicantId: memberId,
      displayName: handle,
      publicKey: publicKey,
      requestedAt: now(),
      initialLimit: 100, // Starting credit limit
    });

    // Save identity locally
    const identity = {
      memberId,
      handle,
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
  // NAVIGATION
  // ============================================

  function showApp() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <header class="app-header">
        <h1 class="app-title">OG</h1>
        <span id="header-balance" class="header-balance balance-zero">0</span>
      </header>

      <main class="app-main">
        ${renderOnboardingScreen()}
        ${renderHomeScreen()}
        ${renderHistoryScreen()}
        ${renderMembersScreen()}
        ${renderSettingsScreen()}
      </main>

      <nav class="app-nav">
        <a href="#" class="nav-item active" data-screen="home">
          <span class="nav-icon">&#127968;</span>
          <span>Home</span>
        </a>
        <a href="#" class="nav-item" data-screen="history">
          <span class="nav-icon">&#128203;</span>
          <span>History</span>
        </a>
        <a href="#" class="nav-item" data-screen="members">
          <span class="nav-icon">&#128101;</span>
          <span>Members</span>
        </a>
        <a href="#" class="nav-item" data-screen="settings">
          <span class="nav-icon">&#9881;</span>
          <span>Settings</span>
        </a>
      </nav>

      ${renderModals()}
    `;
  }

  function showScreen(screenName) {
    const app = document.getElementById('app');

    if (screenName === 'onboarding') {
      app.innerHTML = renderOnboardingScreen();
      setupOnboardingListeners();
      return;
    }
  }

  function navigateTo(screenName) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

    // Show target screen
    const screen = document.getElementById(`${screenName}-screen`);
    if (screen) {
      screen.classList.add('active');
    }

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.screen === screenName);
    });

    state.currentScreen = screenName;

    // Refresh screen data
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
      case 'members':
        await refreshMembersScreen();
        break;
      case 'settings':
        await refreshSettingsScreen();
        break;
    }
  }

  // ============================================
  // SCREEN RENDERERS
  // ============================================

  function renderOnboardingScreen() {
    return `
      <div id="onboarding-screen" class="screen active">
        <div class="onboarding">
          <div class="onboarding-logo">&#9898;</div>
          <h2 class="onboarding-title">OpenGoban</h2>
          <p class="onboarding-subtitle">
            Community credit coordination.<br>
            Offline first. No banks. No tracking.
          </p>

          <div class="form-group" style="width: 100%; max-width: 280px;">
            <input
              type="text"
              id="handle-input"
              class="form-input"
              placeholder="Choose a handle (e.g., @name)"
              maxlength="32"
              autocomplete="off"
              autocapitalize="off"
            >
          </div>

          <button id="create-account-btn" class="btn btn-primary btn-lg btn-block mt-md" style="max-width: 280px;">
            Create Identity
          </button>

          <p class="text-muted mt-lg" style="font-size: 0.875rem;">
            Your identity is generated on this device.<br>
            No email, no password, no tracking.
          </p>
        </div>
      </div>
    `;
  }

  function renderHomeScreen() {
    return `
      <div id="home-screen" class="screen">
        <div class="card balance-card">
          <h3 class="card-title">Your Balance</h3>
          <p id="balance-amount" class="balance-amount balance-zero">0</p>
          <p class="balance-label">community credits</p>
        </div>

        <div class="action-grid">
          <button id="send-btn" class="action-btn">
            <span class="icon">&#8593;</span>
            <span class="label">Send</span>
          </button>
          <button id="receive-btn" class="action-btn">
            <span class="icon">&#8595;</span>
            <span class="label">Receive</span>
          </button>
          <button id="scan-btn" class="action-btn">
            <span class="icon">&#128247;</span>
            <span class="label">Scan</span>
          </button>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Recent Activity</h3>
          </div>
          <ul id="transaction-list" class="transaction-list">
            <div class="empty-state">
              <div class="empty-state-icon">&#128178;</div>
              <div class="empty-state-text">No transactions yet</div>
            </div>
          </ul>
        </div>
      </div>
    `;
  }

  function renderHistoryScreen() {
    return `
      <div id="history-screen" class="screen">
        <h2 style="margin-bottom: var(--spacing-md);">Transaction History</h2>
        <ul id="full-transaction-list" class="transaction-list">
          <div class="empty-state">
            <div class="empty-state-icon">&#128203;</div>
            <div class="empty-state-text">No transactions yet</div>
          </div>
        </ul>
      </div>
    `;
  }

  function renderMembersScreen() {
    return `
      <div id="members-screen" class="screen">
        <div class="form-group">
          <input
            type="text"
            id="member-search"
            class="form-input"
            placeholder="Search members..."
          >
        </div>
        <ul id="member-list" class="member-list">
          <div class="empty-state">
            <div class="empty-state-icon">&#128101;</div>
            <div class="empty-state-text">No other members yet</div>
          </div>
        </ul>
      </div>
    `;
  }

  function renderSettingsScreen() {
    return `
      <div id="settings-screen" class="screen">
        <div class="card">
          <h3 class="card-title">Your Identity</h3>
          <p id="my-handle" class="text-mono" style="font-size: 1.25rem; margin-bottom: var(--spacing-sm);">Loading...</p>
          <p id="my-public-key" class="text-muted text-mono" style="font-size: 0.7rem; word-break: break-all;"></p>
        </div>

        <div class="card">
          <h3 class="card-title">Credit Status</h3>
          <p>Balance: <span id="settings-balance" class="text-mono">0</span></p>
          <p>Credit Limit: <span id="settings-limit" class="text-mono">100</span></p>
          <p>Available: <span id="settings-available" class="text-mono">100</span></p>
        </div>

        <div class="card">
          <h3 class="card-title">Backup</h3>
          <p class="text-muted" style="font-size: 0.875rem; margin-bottom: var(--spacing-md);">
            Save your identity to restore on another device.
          </p>
          <button id="backup-btn" class="btn btn-secondary btn-block">Backup Identity</button>
        </div>

        <div class="card">
          <h3 class="card-title">About</h3>
          <p class="text-muted">OpenGoban v2.0.0</p>
          <p class="text-muted" style="font-size: 0.875rem;">
            Powered by Cell Protocol.<br>
            Mutual credit for communities.
          </p>
        </div>

        <button id="logout-btn" class="btn btn-danger btn-block mt-lg">Reset Identity</button>
      </div>
    `;
  }

  function renderModals() {
    return `
      <!-- Send Modal -->
      <div id="send-modal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Send Credits</h3>
            <button class="modal-close" data-close-modal>&times;</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Recipient ID</label>
              <input type="text" id="send-recipient" class="form-input" placeholder="member-xxxxxxxx">
            </div>
            <div class="form-group">
              <label class="form-label">Amount</label>
              <input type="number" id="send-amount" class="form-input form-input-lg" placeholder="0" min="1" max="100">
            </div>
            <div class="form-group">
              <label class="form-label">Description (optional)</label>
              <input type="text" id="send-description" class="form-input" placeholder="What's this for?">
            </div>
            <button id="send-submit-btn" class="btn btn-primary btn-block btn-lg">Send</button>
          </div>
        </div>
      </div>

      <!-- Receive Modal -->
      <div id="receive-modal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Your ID</h3>
            <button class="modal-close" data-close-modal>&times;</button>
          </div>
          <div class="modal-body text-center">
            <p class="text-muted">Share this to receive credits</p>
            <div id="my-qr" class="qr-container"></div>
            <p id="my-id-display" class="text-mono mt-md" style="font-size: 0.875rem; word-break: break-all;"></p>
            <button id="copy-id-btn" class="btn btn-secondary btn-block mt-md">Copy ID</button>
          </div>
        </div>
      </div>

      <!-- Scanner Modal -->
      <div id="scanner-modal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Scan QR Code</h3>
            <button class="modal-close" data-close-modal>&times;</button>
          </div>
          <div class="modal-body">
            <div class="scanner-container">
              <video id="scanner-video" class="scanner-video" playsinline></video>
              <div class="scanner-overlay">
                <div class="scanner-frame"></div>
              </div>
            </div>
            <p class="text-center text-muted mt-md">Point camera at a QR code</p>
          </div>
        </div>
      </div>

      <!-- Backup Modal -->
      <div id="backup-modal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Backup Identity</h3>
            <button class="modal-close" data-close-modal>&times;</button>
          </div>
          <div class="modal-body">
            <p class="text-muted mb-md">Copy this backup code and store it safely:</p>
            <textarea id="backup-code" class="form-input" rows="4" readonly style="font-family: var(--font-mono); font-size: 0.75rem;"></textarea>
            <button id="copy-backup-btn" class="btn btn-primary btn-block mt-md">Copy Backup Code</button>
            <p class="text-muted mt-md" style="font-size: 0.75rem;">
              Warning: Anyone with this code can access your identity.
            </p>
          </div>
        </div>
      </div>
    `;
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
        const balanceEl = document.getElementById('balance-amount');
        const headerBalanceEl = document.getElementById('header-balance');

        if (balanceEl) {
          balanceEl.textContent = balance;
          balanceEl.className = 'balance-amount ' + getBalanceClass(balance);
        }

        if (headerBalanceEl) {
          headerBalanceEl.textContent = balance >= 0 ? '+' + balance : balance;
          headerBalanceEl.className = 'header-balance ' + getBalanceClass(balance);
        }
      }

      // Load recent transactions
      await refreshTransactionList('transaction-list', 5);
    } catch (e) {
      console.error('Error refreshing home:', e);
    }
  }

  async function refreshHistoryScreen() {
    await refreshTransactionList('full-transaction-list', 50);
  }

  async function refreshTransactionList(elementId, limit) {
    const listEl = document.getElementById(elementId);
    if (!listEl || !state.protocol) return;

    try {
      const transactions = await state.protocol.transactions.getMemberTransactions(
        state.currentMember.memberId,
        limit
      );

      if (transactions.length === 0) {
        listEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">&#128178;</div>
            <div class="empty-state-text">No transactions yet</div>
          </div>
        `;
        return;
      }

      listEl.innerHTML = transactions.map(tx => {
        const isIncoming = tx.payeeId === state.currentMember.memberId;
        const otherParty = isIncoming ? tx.payerId : tx.payeeId;
        const amount = tx.amount;

        return `
          <li class="transaction-item">
            <div class="transaction-avatar">${otherParty.charAt(0).toUpperCase()}</div>
            <div class="transaction-details">
              <div class="transaction-name">${otherParty}</div>
              <div class="transaction-desc">${tx.description || 'Transfer'}</div>
            </div>
            <div class="transaction-amount ${isIncoming ? 'incoming' : 'outgoing'}">
              ${isIncoming ? '+' : '-'}${amount}
            </div>
          </li>
        `;
      }).join('');
    } catch (e) {
      console.error('Error loading transactions:', e);
    }
  }

  async function refreshMembersScreen() {
    const listEl = document.getElementById('member-list');
    if (!listEl || !state.protocol) return;

    try {
      const members = state.protocol.ledger.getAllMemberStates();
      const memberArray = Array.from(members.entries())
        .filter(([id]) => id !== state.currentMember.memberId);

      if (memberArray.length === 0) {
        listEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">&#128101;</div>
            <div class="empty-state-text">No other members yet</div>
          </div>
        `;
        return;
      }

      listEl.innerHTML = memberArray.map(([id, member]) => `
        <li class="member-item" data-member-id="${id}">
          <div class="member-avatar">${id.charAt(0).toUpperCase()}</div>
          <div class="member-info">
            <div class="member-name">${id}</div>
            <div class="member-status">
              <span class="status-badge status-${member.status.toLowerCase()}">${member.status}</span>
            </div>
          </div>
        </li>
      `).join('');
    } catch (e) {
      console.error('Error loading members:', e);
    }
  }

  async function refreshSettingsScreen() {
    if (!state.currentMember) return;

    const handleEl = document.getElementById('my-handle');
    const keyEl = document.getElementById('my-public-key');
    const balanceEl = document.getElementById('settings-balance');
    const limitEl = document.getElementById('settings-limit');
    const availableEl = document.getElementById('settings-available');

    if (handleEl) handleEl.textContent = '@' + state.currentMember.handle;
    if (keyEl) keyEl.textContent = state.currentMember.publicKey;

    if (state.protocol) {
      const memberState = state.protocol.ledger.getMemberState(state.currentMember.memberId);
      if (memberState) {
        if (balanceEl) balanceEl.textContent = memberState.balance;
        if (limitEl) limitEl.textContent = memberState.limit;
        if (availableEl) availableEl.textContent = memberState.limit + memberState.balance - memberState.reserve;
      }
    }

    // Ensure sync UI is added
    addSyncUI();

    // Update sync status
    const statusEl = document.getElementById('sync-status');
    if (statusEl) {
      const connCount = syncConnections.size;
      statusEl.textContent = connCount > 0
        ? `Connected to ${connCount} peer${connCount > 1 ? 's' : ''}`
        : 'Not connected';
    }
  }

  function getBalanceClass(balance) {
    if (balance > 0) return 'balance-positive';
    if (balance < 0) return 'balance-negative';
    return 'balance-zero';
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================

  function setupEventListeners() {
    // Navigation
    document.addEventListener('click', (e) => {
      const navItem = e.target.closest('.nav-item');
      if (navItem) {
        e.preventDefault();
        navigateTo(navItem.dataset.screen);
      }

      // Modal close buttons
      if (e.target.matches('[data-close-modal]') || e.target.matches('.modal-overlay')) {
        closeAllModals();
      }

      // Action buttons
      if (e.target.closest('#send-btn')) openModal('send-modal');
      if (e.target.closest('#receive-btn')) openReceiveModal();
      if (e.target.closest('#scan-btn')) openScanner();
      if (e.target.closest('#backup-btn')) openBackupModal();
      if (e.target.closest('#logout-btn')) confirmLogout();

      // Submit buttons
      if (e.target.matches('#send-submit-btn')) handleSend();
      if (e.target.matches('#copy-id-btn')) copyToClipboard(state.currentMember.memberId);
      if (e.target.matches('#copy-backup-btn')) copyBackupCode();
    });
  }

  function setupOnboardingListeners() {
    const createBtn = document.getElementById('create-account-btn');
    const handleInput = document.getElementById('handle-input');

    if (createBtn) {
      createBtn.addEventListener('click', async () => {
        const handle = handleInput?.value.trim().replace('@', '') || 'user';

        if (handle.length < 2) {
          showToast('Handle must be at least 2 characters', 'error');
          return;
        }

        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';

        try {
          await createIdentity(handle);
          showApp();
          navigateTo('home');
          showToast('Identity created!', 'success');
          // Initialize P2P
          setTimeout(() => {
            initP2P();
            addSyncUI();
          }, 500);
        } catch (e) {
          console.error('Error creating identity:', e);
          showToast('Failed to create identity', 'error');
          createBtn.disabled = false;
          createBtn.textContent = 'Create Identity';
        }
      });
    }
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
  }

  function openReceiveModal() {
    openModal('receive-modal');

    const qrContainer = document.getElementById('my-qr');
    const idDisplay = document.getElementById('my-id-display');

    if (qrContainer && state.currentMember) {
      qrContainer.innerHTML = '';
      new QRCode(qrContainer, {
        text: state.currentMember.memberId,
        width: 200,
        height: 200,
        colorDark: '#000000',
        colorLight: '#ffffff',
      });
    }

    if (idDisplay && state.currentMember) {
      idDisplay.textContent = state.currentMember.memberId;
    }
  }

  function openBackupModal() {
    openModal('backup-modal');

    const codeEl = document.getElementById('backup-code');
    if (codeEl && state.currentMember) {
      const backup = {
        v: 1,
        id: state.currentMember.memberId,
        handle: state.currentMember.handle,
        pk: state.currentMember.publicKey,
        sk: state.currentMember.secretKey,
        cell: state.currentMember.cellId,
      };
      codeEl.value = 'OG2:' + btoa(JSON.stringify(backup));
    }
  }

  function copyBackupCode() {
    const codeEl = document.getElementById('backup-code');
    if (codeEl) {
      copyToClipboard(codeEl.value);
    }
  }

  // ============================================
  // SCANNER
  // ============================================

  let scannerStream = null;

  async function openScanner() {
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

    if (data.startsWith('member-')) {
      // It's a member ID - open send modal with recipient filled in
      openModal('send-modal');
      const recipientInput = document.getElementById('send-recipient');
      if (recipientInput) recipientInput.value = data;
      showToast('Member scanned!', 'success');
    } else {
      showToast('Unknown QR code format', 'error');
    }
  }

  // ============================================
  // TRANSACTIONS
  // ============================================

  async function handleSend() {
    const recipientInput = document.getElementById('send-recipient');
    const amountInput = document.getElementById('send-amount');
    const descInput = document.getElementById('send-description');

    const recipient = recipientInput?.value.trim();
    const amount = parseInt(amountInput?.value || '0', 10);
    const description = descInput?.value.trim() || 'Transfer';

    if (!recipient) {
      showToast('Enter recipient ID', 'error');
      return;
    }

    if (amount <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }

    try {
      const { now } = CellProtocol;

      // Check if recipient exists, if not add them
      let recipientState = state.protocol.ledger.getMemberState(recipient);
      if (!recipientState) {
        // Add as new member (simplified for demo)
        await state.protocol.identity.addMember({
          applicantId: recipient,
          displayName: recipient,
          publicKey: 'demo-key-' + recipient,
          requestedAt: now(),
          initialLimit: 100,
        });
      }

      // Execute transaction
      const result = await state.protocol.transactions.executeTransaction({
        payerId: state.currentMember.memberId,
        payeeId: recipient,
        amount,
        description,
        timestamp: now(),
      });

      if (result.success) {
        showToast(`Sent ${amount} credits!`, 'success');
        closeAllModals();
        refreshHomeScreen();

        // Broadcast to peers
        broadcastTransaction({
          payerId: state.currentMember.memberId,
          payeeId: recipient,
          amount,
          description,
          timestamp: now(),
        });

        // Clear form
        if (recipientInput) recipientInput.value = '';
        if (amountInput) amountInput.value = '';
        if (descInput) descInput.value = '';
      } else {
        showToast(result.error || 'Transaction failed', 'error');
      }
    } catch (e) {
      console.error('Transaction error:', e);
      showToast(e.message || 'Transaction failed', 'error');
    }
  }

  // ============================================
  // UTILITIES
  // ============================================

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied!', 'success');
    }).catch(() => {
      showToast('Copy failed', 'error');
    });
  }

  async function confirmLogout() {
    if (confirm('This will delete your identity from this device. Make sure you have a backup!')) {
      await state.db.destroy();
      location.reload();
    }
  }

  // ============================================
  // P2P SYNC
  // ============================================

  let peer = null;
  let syncConnections = new Map();

  function initP2P() {
    if (!state.currentMember) return;

    // Create peer with member ID as peer ID (sanitized)
    const peerId = state.currentMember.memberId.replace(/[^a-zA-Z0-9]/g, '');

    peer = new Peer(peerId, {
      debug: 1,
    });

    peer.on('open', (id) => {
      console.log('P2P ready, peer ID:', id);
    });

    peer.on('connection', (conn) => {
      handleIncomingConnection(conn);
    });

    peer.on('error', (err) => {
      console.error('P2P error:', err);
    });
  }

  function handleIncomingConnection(conn) {
    console.log('Incoming connection from:', conn.peer);
    syncConnections.set(conn.peer, conn);

    conn.on('data', (data) => {
      handleSyncMessage(conn.peer, data);
    });

    conn.on('close', () => {
      syncConnections.delete(conn.peer);
    });

    // Send our current state
    conn.on('open', () => {
      sendSyncState(conn);
    });
  }

  function connectToPeer(peerId) {
    if (!peer || syncConnections.has(peerId)) return;

    const conn = peer.connect(peerId.replace(/[^a-zA-Z0-9]/g, ''));

    conn.on('open', () => {
      console.log('Connected to peer:', peerId);
      syncConnections.set(peerId, conn);
      sendSyncState(conn);
    });

    conn.on('data', (data) => {
      handleSyncMessage(peerId, data);
    });

    conn.on('close', () => {
      syncConnections.delete(peerId);
    });

    conn.on('error', (err) => {
      console.error('Connection error:', err);
    });
  }

  function sendSyncState(conn) {
    if (!state.protocol) return;

    // Get current ledger state to sync
    const members = Array.from(state.protocol.ledger.getAllMemberStates().entries());

    conn.send({
      type: 'SYNC_STATE',
      cellId: state.currentMember.cellId,
      members: members,
      timestamp: Date.now(),
    });
  }

  function handleSyncMessage(peerId, data) {
    console.log('Sync message from', peerId, ':', data.type);

    switch (data.type) {
      case 'SYNC_STATE':
        // Merge incoming state with local state
        mergeSyncState(data);
        break;

      case 'TRANSACTION':
        // Apply incoming transaction
        applyRemoteTransaction(data);
        break;

      default:
        console.log('Unknown sync message type:', data.type);
    }
  }

  function mergeSyncState(remoteState) {
    if (remoteState.cellId !== state.currentMember.cellId) {
      console.log('Ignoring state from different cell');
      return;
    }

    // For now, just log. Full CRDT merge would go here.
    console.log('Received sync state with', remoteState.members.length, 'members');

    // Refresh UI to show any changes
    refreshScreen(state.currentScreen);
  }

  async function applyRemoteTransaction(txData) {
    // Validate and apply transaction from peer
    try {
      const { now } = CellProtocol;

      // Ensure both parties exist
      let payerState = state.protocol.ledger.getMemberState(txData.payerId);
      let payeeState = state.protocol.ledger.getMemberState(txData.payeeId);

      if (!payerState || !payeeState) {
        console.log('Cannot apply remote tx: unknown party');
        return;
      }

      // Re-execute locally (idempotent if same tx ID)
      await state.protocol.transactions.executeTransaction({
        payerId: txData.payerId,
        payeeId: txData.payeeId,
        amount: txData.amount,
        description: txData.description,
        timestamp: txData.timestamp || now(),
      });

      refreshScreen(state.currentScreen);
    } catch (e) {
      console.error('Failed to apply remote transaction:', e);
    }
  }

  function broadcastTransaction(tx) {
    const message = {
      type: 'TRANSACTION',
      ...tx,
    };

    syncConnections.forEach((conn) => {
      try {
        conn.send(message);
      } catch (e) {
        console.error('Failed to broadcast to peer:', e);
      }
    });
  }

  // Add sync button to settings
  function addSyncUI() {
    const settingsScreen = document.getElementById('settings-screen');
    if (!settingsScreen) return;

    // Check if already added
    if (document.getElementById('sync-card')) return;

    const syncCard = document.createElement('div');
    syncCard.id = 'sync-card';
    syncCard.className = 'card';
    syncCard.innerHTML = `
      <h3 class="card-title">P2P Sync</h3>
      <p class="text-muted" style="font-size: 0.875rem; margin-bottom: var(--spacing-md);">
        Connect to another device to sync data.
      </p>
      <div class="form-group">
        <input type="text" id="peer-id-input" class="form-input" placeholder="Enter peer's member ID">
      </div>
      <button id="connect-peer-btn" class="btn btn-secondary btn-block">Connect</button>
      <div id="sync-status" class="text-muted mt-sm" style="font-size: 0.75rem;"></div>
    `;

    // Insert before About card
    const aboutCard = settingsScreen.querySelector('.card:last-of-type');
    if (aboutCard) {
      settingsScreen.insertBefore(syncCard, aboutCard);
    } else {
      settingsScreen.appendChild(syncCard);
    }

    // Add event listener
    const connectBtn = document.getElementById('connect-peer-btn');
    const peerInput = document.getElementById('peer-id-input');
    const statusEl = document.getElementById('sync-status');

    if (connectBtn && peerInput) {
      connectBtn.addEventListener('click', () => {
        const peerId = peerInput.value.trim();
        if (peerId) {
          connectToPeer(peerId);
          if (statusEl) {
            statusEl.textContent = 'Connecting to ' + peerId + '...';
          }
          peerInput.value = '';
        }
      });
    }
  }

  // ============================================
  // STARTUP
  // ============================================

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
