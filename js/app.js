/**
 * OpenGoban PWA Main Application
 *
 * Offline-first community mutual credit trading
 * No banks. No app stores. No government ID.
 */

const OGApp = (function() {
  'use strict';

  // App state
  let initialized = false;
  let currentScreen = 'home';

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize the application
   */
  async function init() {
    if (initialized) return;

    console.log('[App] Initializing OpenGoban...');

    // Register service worker
    await registerServiceWorker();

    // Initialize ledger
    await OGLedger.init();

    // Check if user has identity
    const hasIdentity = await OGCrypto.hasIdentity();

    if (hasIdentity) {
      const member = OGLedger.getCurrentMember();
      if (member) {
        showApp();
        updateBalance();
        loadTransactions();
        autoConnectSync();
      } else {
        // Has keys but no member record - recovery needed
        showScreen('setup');
      }
    } else {
      // New user - show onboarding
      showScreen('onboarding');
    }

    // Set up event listeners
    setupEventListeners();

    // Listen for ledger events
    window.addEventListener('tc-transaction-confirmed', (e) => {
      showToast('Transaction confirmed!', 'success');
      updateBalance();
      loadTransactions();
    });

    window.addEventListener('tc-transaction-received', (e) => {
      showToast(`Received ${e.detail.amount} credits!`, 'success');
      updateBalance();
      loadTransactions();
    });

    // Listen for sync events
    window.addEventListener('tc-sync-status', (e) => {
      const syncStatus = document.getElementById('sync-status');
      if (syncStatus) {
        syncStatus.textContent = e.detail.online ? 'Synced' : 'Offline';
      }
      const syncDot = document.querySelector('.sync-dot');
      if (syncDot) {
        syncDot.style.background = e.detail.online ? 'var(--color-success)' : 'var(--color-muted)';
      }
    });

    window.addEventListener('tc-sync-change', (e) => {
      // Refresh data when sync brings new changes
      updateBalance();
      loadTransactions();
    });

    initialized = true;
    console.log('[App] Ready');
  }

  /**
   * Register the service worker
   */
  async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        console.log('[App] Service worker registered');

        // Check for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('Update available! Refresh to update.', 'info');
            }
          });
        });
      } catch (err) {
        console.error('[App] Service worker registration failed:', err);
      }
    }
  }

  // ========================================
  // NAVIGATION
  // ========================================

  /**
   * Show the main app UI
   */
  function showApp() {
    document.getElementById('onboarding-screen')?.classList.remove('active');
    document.getElementById('setup-screen')?.classList.remove('active');
    document.querySelector('.app-header')?.classList.remove('hidden');
    document.querySelector('.app-nav')?.classList.remove('hidden');
    showScreen('home');
  }

  /**
   * Show a specific screen
   */
  function showScreen(screenId) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

    // Show the target screen
    const screen = document.getElementById(`${screenId}-screen`);
    if (screen) {
      screen.classList.add('active');
      currentScreen = screenId;

      // Update nav
      document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.screen === screenId);
      });

      // Load screen-specific data
      if (screenId === 'settings') {
        loadSettingsScreen();
      }
    }
  }

  /**
   * Load settings screen data
   */
  async function loadSettingsScreen() {
    const member = OGLedger.getCurrentMember();

    // Update handle display
    const handleEl = document.getElementById('my-handle');
    if (handleEl) {
      handleEl.textContent = member?.handle || 'No identity';
    }

    // Update public key display
    const pkEl = document.getElementById('my-public-key');
    if (pkEl && member) {
      pkEl.textContent = member.public_key || '';
    }

    // Update circle info
    const circleEl = document.getElementById('my-circle');
    if (circleEl) {
      if (member?.circle_id) {
        const circle = await OGLedger.getCircle(member.circle_id);
        circleEl.textContent = circle?.name || member.circle_id;
      } else {
        circleEl.textContent = 'Not in a circle yet';
      }
    }
  }

  // ========================================
  // USER SETUP
  // ========================================

  /**
   * Create new identity and member
   */
  async function createAccount(handle) {
    if (!handle || handle.length < 2) {
      showToast('Handle must be at least 2 characters', 'error');
      return;
    }

    try {
      showLoading(true);

      // Create member (generates crypto identity)
      await OGLedger.createMember(handle);

      showToast('Account created!', 'success');
      showApp();
      updateBalance();

    } catch (err) {
      console.error('[App] Account creation failed:', err);
      showToast('Failed to create account: ' + err.message, 'error');
    } finally {
      showLoading(false);
    }
  }

  /**
   * Join an existing circle
   */
  async function joinCircle(inviteCode) {
    // TODO: Implement circle joining via invite code
    showToast('Circle joining coming soon!', 'info');
  }

  // ========================================
  // BALANCE & TRANSACTIONS
  // ========================================

  /**
   * Update the balance display
   */
  async function updateBalance() {
    const member = OGLedger.getCurrentMember();
    if (!member) return;

    try {
      const balance = await OGLedger.getBalance(member._id);

      // Update header balance
      const headerBalance = document.getElementById('header-balance');
      if (headerBalance) {
        headerBalance.textContent = balance >= 0 ? `+${balance}` : balance;
        headerBalance.className = 'header-balance ' +
          (balance > 0 ? 'balance-positive' :
           balance < 0 ? 'balance-negative' : 'balance-zero');
      }

      // Update balance card
      const balanceAmount = document.getElementById('balance-amount');
      if (balanceAmount) {
        balanceAmount.textContent = balance;
        balanceAmount.className = 'balance-amount ' +
          (balance > 0 ? 'balance-positive' :
           balance < 0 ? 'balance-negative' : 'balance-zero');
      }

    } catch (err) {
      console.error('[App] Failed to update balance:', err);
    }
  }

  /**
   * Load transaction history
   */
  async function loadTransactions() {
    const member = OGLedger.getCurrentMember();
    if (!member) return;

    try {
      const transactions = await OGLedger.getTransactions(member._id, { limit: 50 });
      const list = document.getElementById('transaction-list');

      if (!list) return;

      if (transactions.length === 0) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <div class="empty-state-text">No transactions yet</div>
          </div>
        `;
        return;
      }

      list.innerHTML = transactions.map(tx => {
        const isIncoming = tx.recipient_id === member._id;
        const otherParty = isIncoming ? tx.sender_id : tx.recipient_id;

        return `
          <li class="transaction-item">
            <div class="tx-icon ${isIncoming ? 'incoming' : 'outgoing'}">
              ${isIncoming ? '↓' : '↑'}
            </div>
            <div class="tx-details">
              <div class="tx-handle">${otherParty.substring(7, 15)}...</div>
              <div class="tx-description">${tx.description || 'Transfer'}</div>
            </div>
            <div class="tx-amount ${isIncoming ? 'incoming' : 'outgoing'}">
              ${isIncoming ? '+' : '-'}${tx.amount}
            </div>
          </li>
        `;
      }).join('');

    } catch (err) {
      console.error('[App] Failed to load transactions:', err);
    }
  }

  // ========================================
  // TRANSFER FLOW
  // ========================================

  /**
   * Open send credits modal
   */
  function openSendModal() {
    showModal('send-modal');
  }

  /**
   * Create and show transfer QR
   */
  async function createTransfer(recipientId, amount, description) {
    try {
      showLoading(true);

      const result = await OGLedger.createTransferQR(
        recipientId,
        parseFloat(amount),
        description,
        'transfer-qr'
      );

      showModal('qr-modal');
      showToast('QR code ready! Show to recipient.', 'success');

    } catch (err) {
      console.error('[App] Transfer creation failed:', err);
      showToast('Failed: ' + err.message, 'error');
    } finally {
      showLoading(false);
    }
  }

  /**
   * Open QR scanner
   */
  function openScanner() {
    showModal('scanner-modal');

    // Start scanning immediately (no async before getUserMedia for iOS)
    OGQR.startScanner('scanner-video', async (data) => {
      OGQR.stopScanner();
      closeModal('scanner-modal');

      try {
        const parsed = OGQR.parseQR(data);

        if (parsed.type === 'transaction') {
          await receiveTransfer(data);
        } else if (parsed.type === 'member') {
          // Show member info, offer to send to them
          showToast('Member scanned: ' + parsed.member.handle, 'info');
        } else if (parsed.type === 'invite') {
          // Circle invite
          showToast('Circle invite: ' + parsed.invite.circleName, 'info');
        } else {
          showToast('Unknown QR code type', 'error');
        }
      } catch (err) {
        console.error('[App] QR processing failed:', err);
        showToast('Failed to process QR: ' + err.message, 'error');
      }
    }, (err) => {
      console.error('[App] Scanner error:', err);
      showToast('Camera error: ' + err.message, 'error');
      closeModal('scanner-modal');
    });
  }

  /**
   * Receive a transfer from QR
   */
  async function receiveTransfer(qrData) {
    try {
      showLoading(true);

      const tx = await OGLedger.receiveTransferQR(qrData);
      showToast(`Received ${tx.amount} credits!`, 'success');
      updateBalance();
      loadTransactions();

    } catch (err) {
      console.error('[App] Receive failed:', err);
      showToast('Failed: ' + err.message, 'error');
    } finally {
      showLoading(false);
    }
  }

  // ========================================
  // MY ID / SHARE
  // ========================================

  /**
   * Show my member QR code
   */
  async function showMyQR() {
    const member = OGLedger.getCurrentMember();
    if (!member) {
      showToast('No member data', 'error');
      return;
    }

    const payload = OGQR.createMemberPayload(
      member._id,
      member.handle,
      member.public_key,
      member.circle_id
    );

    OGQR.generateQR('my-qr', payload, { width: 256, height: 256 });
    showModal('my-qr-modal');
  }

  // ========================================
  // SEND FLOW
  // ========================================

  // Store selected recipient
  let selectedRecipient = null;

  /**
   * Open send modal (reset state)
   */
  function openSendModal() {
    clearRecipient();
    document.getElementById('send-amount').value = '';
    document.getElementById('send-description').value = '';
    showModal('send-modal');
  }

  /**
   * Scan recipient's QR code
   */
  function scanRecipient() {
    // Close send modal temporarily
    closeModal('send-modal');
    showModal('scanner-modal');

    // Start scanning immediately (no async before getUserMedia for iOS)
    OGQR.startScanner('scanner-video', async (data) => {
      OGQR.stopScanner();
      closeModal('scanner-modal');

      try {
        const parsed = OGQR.parseQR(data);

        if (parsed.type === 'member') {
          // Got a member QR - save to local DB and set as recipient
          await OGLedger.saveScannedMember(
            parsed.member.id,
            parsed.member.handle,
            parsed.member.publicKey,
            parsed.member.circleId
          );
          setRecipient(parsed.member.id, parsed.member.handle);
          showModal('send-modal');
        } else {
          showToast('Please scan a member ID QR code', 'error');
          showModal('send-modal');
        }
      } catch (err) {
        console.error('[App] Scan recipient error:', err);
        showToast('Failed to read QR: ' + err.message, 'error');
        showModal('send-modal');
      }
    }, (err) => {
      console.error('[App] Scanner error:', err);
      showToast('Camera error: ' + err.message, 'error');
      closeModal('scanner-modal');
      showModal('send-modal');
    });
  }

  /**
   * Set the selected recipient
   */
  function setRecipient(id, handle) {
    selectedRecipient = { id, handle };

    // Update hidden input
    document.getElementById('send-recipient').value = id;

    // Show recipient display
    document.getElementById('recipient-display').classList.remove('hidden');
    document.getElementById('scan-recipient-btn').classList.add('hidden');
    document.getElementById('paste-recipient-btn').classList.add('hidden');
    document.getElementById('recipient-handle').textContent = handle || 'Unknown';
    document.getElementById('recipient-id-display').textContent = id.substring(0, 20) + '...';
    document.getElementById('recipient-avatar').textContent = (handle || '?').charAt(0).toUpperCase();

    // Enable submit button
    const submitBtn = document.getElementById('send-submit-btn');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generate QR Code';

    showToast('Recipient: ' + handle, 'success');
  }

  /**
   * Clear the selected recipient
   */
  function clearRecipient() {
    selectedRecipient = null;

    // Clear hidden input
    document.getElementById('send-recipient').value = '';

    // Hide recipient display, show scan button
    document.getElementById('recipient-display').classList.add('hidden');
    document.getElementById('scan-recipient-btn').classList.remove('hidden');
    document.getElementById('paste-recipient-btn').classList.remove('hidden');

    // Disable submit button
    const submitBtn = document.getElementById('send-submit-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Scan recipient first';
  }

  /**
   * Copy my member ID to clipboard (for sharing when camera unavailable)
   */
  async function copyMyId() {
    const member = OGLedger.getCurrentMember();
    if (!member) {
      showToast('No member data', 'error');
      return;
    }

    // Create a shareable payload (same as QR but as text)
    const payload = OGQR.createMemberPayload(
      member._id,
      member.handle,
      member.public_key,
      member.circle_id
    );

    try {
      await navigator.clipboard.writeText(payload);
      showToast('ID copied! Share via message.', 'success');
    } catch (err) {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = payload;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('ID copied! Share via message.', 'success');
    }
  }

  /**
   * Paste recipient ID from clipboard
   */
  async function pasteRecipientId() {
    try {
      const text = await navigator.clipboard.readText();

      // Try to parse as member payload
      const parsed = OGQR.parseQR(text);

      if (parsed && parsed.type === 'member') {
        // Save to local DB
        await OGLedger.saveScannedMember(
          parsed.member.id,
          parsed.member.handle,
          parsed.member.publicKey,
          parsed.member.circleId
        );
        setRecipient(parsed.member.id, parsed.member.handle);
        showToast('Recipient set: ' + parsed.member.handle, 'success');
      } else {
        showToast('Invalid ID format. Copy from "My ID" screen.', 'error');
      }
    } catch (err) {
      // Clipboard read failed - show manual input prompt
      const text = prompt('Paste the member ID here:');
      if (text) {
        try {
          const parsed = OGQR.parseQR(text);
          if (parsed && parsed.type === 'member') {
            await OGLedger.saveScannedMember(
              parsed.member.id,
              parsed.member.handle,
              parsed.member.publicKey,
              parsed.member.circleId
            );
            setRecipient(parsed.member.id, parsed.member.handle);
            showToast('Recipient set: ' + parsed.member.handle, 'success');
          } else {
            showToast('Invalid ID format', 'error');
          }
        } catch (e) {
          showToast('Invalid ID format', 'error');
        }
      }
    }
  }

  // ========================================
  // BACKUP & RESTORE
  // ========================================

  /**
   * Open backup modal
   */
  function openBackupModal() {
    // Reset form
    document.getElementById('backup-password').value = '';
    document.getElementById('backup-password-confirm').value = '';
    document.getElementById('backup-code').value = '';
    document.getElementById('backup-result').classList.add('hidden');
    showModal('backup-modal');
  }

  /**
   * Generate encrypted backup
   */
  async function generateBackup() {
    const password = document.getElementById('backup-password').value;
    const confirmPassword = document.getElementById('backup-password-confirm').value;

    if (password.length < 4) {
      showToast('Password must be at least 4 characters', 'error');
      return;
    }

    if (password !== confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }

    try {
      showLoading(true);
      const backupCode = await OGCrypto.exportIdentity(password);

      document.getElementById('backup-code').value = backupCode;
      document.getElementById('backup-result').classList.remove('hidden');

      showToast('Backup generated!', 'success');
    } catch (err) {
      console.error('[App] Backup failed:', err);
      showToast('Backup failed: ' + err.message, 'error');
    } finally {
      showLoading(false);
    }
  }

  /**
   * Copy backup code to clipboard
   */
  async function copyBackupToClipboard() {
    const backupCode = document.getElementById('backup-code').value;

    try {
      await navigator.clipboard.writeText(backupCode);
      showToast('Copied to clipboard!', 'success');
    } catch (err) {
      // Fallback for Safari
      const textarea = document.getElementById('backup-code');
      textarea.select();
      document.execCommand('copy');
      showToast('Copied to clipboard!', 'success');
    }
  }

  /**
   * Open restore modal
   */
  function openRestoreModal() {
    // Reset form
    document.getElementById('restore-code').value = '';
    document.getElementById('restore-password').value = '';
    showModal('restore-modal');
  }

  /**
   * Restore identity from backup
   */
  async function restoreFromBackup() {
    const backupCode = document.getElementById('restore-code').value.trim();
    const password = document.getElementById('restore-password').value;

    if (!backupCode) {
      showToast('Please enter your backup code', 'error');
      return;
    }

    if (!backupCode.startsWith('OG1:')) {
      showToast('Invalid backup code format', 'error');
      return;
    }

    if (!password) {
      showToast('Please enter your password', 'error');
      return;
    }

    try {
      showLoading(true);

      // Import the identity
      const publicKey = await OGCrypto.importIdentity(backupCode, password);

      showToast('Identity restored!', 'success');
      closeModal('restore-modal');

      // Reload the app to use the restored identity
      setTimeout(() => {
        window.location.reload();
      }, 1000);

    } catch (err) {
      console.error('[App] Restore failed:', err);
      showToast('Restore failed: ' + err.message, 'error');
    } finally {
      showLoading(false);
    }
  }

  // ========================================
  // CLOUD SYNC
  // ========================================

  let syncActive = false;

  /**
   * Connect to remote sync
   */
  function connectSync() {
    const urlInput = document.getElementById('sync-url-input');
    const url = urlInput?.value?.trim();

    if (!url) {
      showToast('Please enter a sync URL', 'error');
      return;
    }

    try {
      OGLedger.startSync(url);
      syncActive = true;

      // Save URL for auto-reconnect
      localStorage.setItem('og_sync_url', url);

      // Update UI
      updateSyncUI(true);
      showToast('Sync connected!', 'success');

    } catch (err) {
      console.error('[App] Sync connect failed:', err);
      showToast('Sync failed: ' + err.message, 'error');
    }
  }

  /**
   * Disconnect from remote sync
   */
  function disconnectSync() {
    OGLedger.stopSync();
    syncActive = false;

    // Clear saved URL
    localStorage.removeItem('og_sync_url');

    // Update UI
    updateSyncUI(false);
    showToast('Sync disconnected', 'info');
  }

  /**
   * Update sync UI state
   */
  function updateSyncUI(connected) {
    const statusText = document.getElementById('sync-status-text');
    const connectBtn = document.getElementById('sync-connect-btn');
    const disconnectBtn = document.getElementById('sync-disconnect-btn');
    const urlInput = document.getElementById('sync-url-input');

    if (connected) {
      if (statusText) statusText.textContent = 'Connected';
      if (statusText) statusText.style.color = 'var(--color-success)';
      if (connectBtn) connectBtn.classList.add('hidden');
      if (disconnectBtn) disconnectBtn.classList.remove('hidden');
      if (urlInput) urlInput.disabled = true;
    } else {
      if (statusText) statusText.textContent = 'Not connected';
      if (statusText) statusText.style.color = '';
      if (connectBtn) connectBtn.classList.remove('hidden');
      if (disconnectBtn) disconnectBtn.classList.add('hidden');
      if (urlInput) urlInput.disabled = false;
    }
  }

  /**
   * Auto-connect to saved sync URL
   */
  function autoConnectSync() {
    const savedUrl = localStorage.getItem('og_sync_url');
    if (savedUrl) {
      const urlInput = document.getElementById('sync-url-input');
      if (urlInput) urlInput.value = savedUrl;

      try {
        OGLedger.startSync(savedUrl);
        syncActive = true;
        updateSyncUI(true);
        console.log('[App] Auto-connected to sync');
      } catch (err) {
        console.error('[App] Auto-connect failed:', err);
      }
    }
  }

  // ========================================
  // P2P SYNC (Device-to-Device)
  // ========================================

  // Store pending transaction for accept/reject
  let pendingP2PTransaction = null;

  /**
   * Open P2P sync modal and start hosting
   */
  async function openP2PSync() {
    showModal('p2p-modal');
    showP2PHostMode();

    // Set up P2P callbacks
    OGP2P.setOnStatusChange(handleP2PStatus);
    OGP2P.setOnSyncComplete(handleP2PSyncComplete);
    OGP2P.setOnTransactionRequest(handleP2PTransactionRequest);
    OGP2P.setOnTransactionConfirmed(handleP2PTransactionConfirmed);
    OGP2P.setOnTransactionRejected(handleP2PTransactionRejected);

    // Start hosting
    try {
      const code = await OGP2P.startHosting();
      document.getElementById('p2p-code-display').textContent = code;
    } catch (err) {
      console.error('[App] P2P hosting failed:', err);
      showToast('Failed to start P2P: ' + err.message, 'error');
    }
  }

  /**
   * Switch to host mode (show code)
   */
  async function showP2PHostMode() {
    document.getElementById('p2p-host-mode').classList.remove('hidden');
    document.getElementById('p2p-join-mode').classList.add('hidden');
    document.getElementById('p2p-connected-mode').classList.add('hidden');

    // Start hosting if not already
    if (!OGP2P.isConnected()) {
      try {
        const code = await OGP2P.startHosting();
        document.getElementById('p2p-code-display').textContent = code;
        document.getElementById('p2p-host-status').textContent = 'Waiting for connection...';
      } catch (err) {
        console.error('[App] P2P hosting failed:', err);
      }
    }
  }

  /**
   * Switch to join mode (enter code)
   */
  function showP2PJoinMode() {
    OGP2P.disconnect();
    document.getElementById('p2p-host-mode').classList.add('hidden');
    document.getElementById('p2p-join-mode').classList.remove('hidden');
    document.getElementById('p2p-connected-mode').classList.add('hidden');
    document.getElementById('p2p-code-input').value = '';
    document.getElementById('p2p-join-status').textContent = '';
  }

  /**
   * Show connected mode
   */
  function showP2PConnectedMode() {
    document.getElementById('p2p-host-mode').classList.add('hidden');
    document.getElementById('p2p-join-mode').classList.add('hidden');
    document.getElementById('p2p-connected-mode').classList.remove('hidden');
  }

  /**
   * Connect to peer using entered code
   */
  async function connectP2P() {
    const code = document.getElementById('p2p-code-input').value.trim();

    if (!code || code.length !== 6) {
      showToast('Please enter a 6-digit code', 'error');
      return;
    }

    document.getElementById('p2p-join-status').textContent = 'Connecting...';

    try {
      await OGP2P.connectToHost(code);
    } catch (err) {
      document.getElementById('p2p-join-status').textContent = 'Failed: ' + err.message;
      showToast('Connection failed', 'error');
    }
  }

  /**
   * Disconnect from P2P peer
   */
  function disconnectP2P() {
    OGP2P.disconnect();
    closeModal('p2p-modal');
    showToast('Disconnected', 'info');
  }

  /**
   * Handle P2P status changes
   */
  function handleP2PStatus(status, message) {
    console.log('[App] P2P status:', status, message);

    switch (status) {
      case 'waiting':
        document.getElementById('p2p-host-status').textContent = 'Waiting for connection...';
        break;

      case 'connecting':
        document.getElementById('p2p-join-status').textContent = 'Connecting...';
        break;

      case 'connected':
        showP2PConnectedMode();
        document.getElementById('p2p-sync-status').textContent = 'Connected! Exchanging keys...';
        break;

      case 'encrypted':
        document.getElementById('p2p-sync-status').innerHTML = '&#128274; Encrypted connection established';
        break;

      case 'syncing':
        document.getElementById('p2p-sync-status').innerHTML = '&#128274; Syncing data (encrypted)...';
        break;

      case 'complete':
        document.getElementById('p2p-sync-status').textContent = message || 'Sync complete!';
        document.getElementById('p2p-sync-progress').innerHTML = '<div style="font-size: 2rem;">&#9989;</div>';
        // Show peer info and send section
        const peerInfo = OGP2P.getPeerInfo();
        if (peerInfo) {
          document.getElementById('p2p-peer-handle').textContent = peerInfo.handle || 'peer';
          document.getElementById('p2p-send-to-handle').textContent = peerInfo.handle || 'peer';
          document.getElementById('p2p-send-section').classList.remove('hidden');
        }
        break;

      case 'error':
        showToast('P2P Error: ' + message, 'error');
        break;

      case 'disconnected':
        break;
    }
  }

  /**
   * Handle P2P sync complete
   */
  function handleP2PSyncComplete(result) {
    console.log('[App] P2P sync complete:', result);
    showToast(`Synced ${result.imported} items`, 'success');
    updateBalance();
    loadTransactions();
  }

  /**
   * Send credits via P2P connection
   */
  async function sendViaP2P() {
    const amount = parseInt(document.getElementById('p2p-send-amount').value, 10);
    const description = document.getElementById('p2p-send-description').value.trim();

    if (!amount || amount < 1) {
      showToast('Please enter a valid amount', 'error');
      return;
    }

    const statusEl = document.getElementById('p2p-send-status');
    statusEl.textContent = 'Sending...';

    try {
      await OGP2P.sendToPeer(amount, description || 'P2P transfer');
      statusEl.textContent = 'Waiting for confirmation...';
    } catch (err) {
      console.error('[App] P2P send failed:', err);
      statusEl.textContent = 'Failed: ' + err.message;
      showToast('Send failed: ' + err.message, 'error');
    }
  }

  /**
   * Handle incoming P2P transaction request
   */
  function handleP2PTransactionRequest(tx) {
    console.log('[App] Incoming transaction request:', tx);
    pendingP2PTransaction = tx;

    // Hide other modes, show transaction request
    document.getElementById('p2p-host-mode').classList.add('hidden');
    document.getElementById('p2p-join-mode').classList.add('hidden');
    document.getElementById('p2p-connected-mode').classList.add('hidden');
    document.getElementById('p2p-tx-request-mode').classList.remove('hidden');

    // Fill in details
    document.getElementById('p2p-tx-from').textContent = tx.sender_handle || '@sender';
    document.getElementById('p2p-tx-amount').textContent = tx.amount;
    document.getElementById('p2p-tx-description').textContent = tx.description || 'No description';

    // Play sound or vibrate if available
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
  }

  /**
   * Accept pending P2P transaction
   */
  async function acceptP2PTransaction() {
    if (!pendingP2PTransaction) return;

    try {
      await OGP2P.confirmTransaction(pendingP2PTransaction);
      showToast(`Received ${pendingP2PTransaction.amount} credits!`, 'success');
      pendingP2PTransaction = null;

      // Go back to connected mode
      document.getElementById('p2p-tx-request-mode').classList.add('hidden');
      document.getElementById('p2p-connected-mode').classList.remove('hidden');
    } catch (err) {
      console.error('[App] Accept transaction failed:', err);
      showToast('Failed to accept: ' + err.message, 'error');
    }
  }

  /**
   * Reject pending P2P transaction
   */
  async function rejectP2PTransaction() {
    if (!pendingP2PTransaction) return;

    try {
      await OGP2P.rejectTransaction(pendingP2PTransaction, 'User rejected');
      showToast('Transaction rejected', 'info');
      pendingP2PTransaction = null;

      // Go back to connected mode
      document.getElementById('p2p-tx-request-mode').classList.add('hidden');
      document.getElementById('p2p-connected-mode').classList.remove('hidden');
    } catch (err) {
      console.error('[App] Reject transaction failed:', err);
    }
  }

  /**
   * Handle transaction confirmed by peer
   */
  function handleP2PTransactionConfirmed(tx) {
    console.log('[App] Transaction confirmed:', tx);
    showToast(`Sent ${tx.amount} credits to ${tx.recipient_handle}!`, 'success');
    document.getElementById('p2p-send-status').textContent = 'Sent successfully!';
    document.getElementById('p2p-send-amount').value = '';
    document.getElementById('p2p-send-description').value = '';
    updateBalance();
    loadTransactions();
  }

  /**
   * Handle transaction rejected by peer
   */
  function handleP2PTransactionRejected(txId, reason) {
    console.log('[App] Transaction rejected:', txId, reason);
    showToast('Transaction rejected: ' + reason, 'error');
    document.getElementById('p2p-send-status').textContent = 'Rejected: ' + reason;
  }

  // ========================================
  // MODALS
  // ========================================

  /**
   * Show a modal
   */
  function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
    }
  }

  /**
   * Close a modal
   */
  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');

      // Stop scanner if it was the scanner modal
      if (modalId === 'scanner-modal') {
        OGQR.stopScanner();
      }
    }
  }

  // ========================================
  // UI HELPERS
  // ========================================

  /**
   * Show/hide loading overlay
   */
  function showLoading(show) {
    const loader = document.getElementById('loading-overlay');
    if (loader) {
      loader.classList.toggle('active', show);
    }
  }

  /**
   * Show a toast notification
   */
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ========================================
  // EVENT LISTENERS
  // ========================================

  function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const screen = item.dataset.screen;
        if (screen) showScreen(screen);
      });
    });

    // Onboarding - Create account
    const createBtn = document.getElementById('create-account-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        const handle = document.getElementById('handle-input')?.value?.trim();
        createAccount(handle);
      });
    }

    // Send button
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', openSendModal);
    }

    // Scan button
    const scanBtn = document.getElementById('scan-btn');
    if (scanBtn) {
      scanBtn.addEventListener('click', openScanner);
    }

    // My QR button
    const myQRBtn = document.getElementById('my-qr-btn');
    if (myQRBtn) {
      myQRBtn.addEventListener('click', showMyQR);
    }

    // Scan Recipient button (in Send modal)
    const scanRecipientBtn = document.getElementById('scan-recipient-btn');
    if (scanRecipientBtn) {
      scanRecipientBtn.addEventListener('click', scanRecipient);
    }

    // Clear Recipient button
    const clearRecipientBtn = document.getElementById('clear-recipient-btn');
    if (clearRecipientBtn) {
      clearRecipientBtn.addEventListener('click', clearRecipient);
    }

    // Paste Recipient button
    const pasteRecipientBtn = document.getElementById('paste-recipient-btn');
    if (pasteRecipientBtn) {
      pasteRecipientBtn.addEventListener('click', pasteRecipientId);
    }

    // Copy My ID button
    const copyMyIdBtn = document.getElementById('copy-my-id-btn');
    if (copyMyIdBtn) {
      copyMyIdBtn.addEventListener('click', copyMyId);
    }

    // Backup button
    const backupBtn = document.getElementById('backup-btn');
    if (backupBtn) {
      backupBtn.addEventListener('click', openBackupModal);
    }

    // Backup generate button
    const backupGenerateBtn = document.getElementById('backup-generate-btn');
    if (backupGenerateBtn) {
      backupGenerateBtn.addEventListener('click', generateBackup);
    }

    // Backup copy button
    const backupCopyBtn = document.getElementById('backup-copy-btn');
    if (backupCopyBtn) {
      backupCopyBtn.addEventListener('click', copyBackupToClipboard);
    }

    // Restore button
    const restoreBtn = document.getElementById('restore-btn');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', openRestoreModal);
    }

    // Restore submit button
    const restoreSubmitBtn = document.getElementById('restore-submit-btn');
    if (restoreSubmitBtn) {
      restoreSubmitBtn.addEventListener('click', restoreFromBackup);
    }

    // Sync buttons
    const syncConnectBtn = document.getElementById('sync-connect-btn');
    if (syncConnectBtn) {
      syncConnectBtn.addEventListener('click', connectSync);
    }

    const syncDisconnectBtn = document.getElementById('sync-disconnect-btn');
    if (syncDisconnectBtn) {
      syncDisconnectBtn.addEventListener('click', disconnectSync);
    }

    // P2P Sync button
    const p2pSyncBtn = document.getElementById('p2p-sync-btn');
    if (p2pSyncBtn) {
      p2pSyncBtn.addEventListener('click', openP2PSync);
    }

    // P2P mode switches
    const p2pSwitchToJoin = document.getElementById('p2p-switch-to-join');
    if (p2pSwitchToJoin) {
      p2pSwitchToJoin.addEventListener('click', showP2PJoinMode);
    }

    const p2pSwitchToHost = document.getElementById('p2p-switch-to-host');
    if (p2pSwitchToHost) {
      p2pSwitchToHost.addEventListener('click', showP2PHostMode);
    }

    // P2P connect button
    const p2pConnectBtn = document.getElementById('p2p-connect-btn');
    if (p2pConnectBtn) {
      p2pConnectBtn.addEventListener('click', connectP2P);
    }

    // P2P disconnect button
    const p2pDisconnectBtn = document.getElementById('p2p-disconnect-btn');
    if (p2pDisconnectBtn) {
      p2pDisconnectBtn.addEventListener('click', disconnectP2P);
    }

    // P2P send button
    const p2pSendBtn = document.getElementById('p2p-send-btn');
    if (p2pSendBtn) {
      p2pSendBtn.addEventListener('click', sendViaP2P);
    }

    // P2P transaction accept button
    const p2pTxAcceptBtn = document.getElementById('p2p-tx-accept-btn');
    if (p2pTxAcceptBtn) {
      p2pTxAcceptBtn.addEventListener('click', acceptP2PTransaction);
    }

    // P2P transaction reject button
    const p2pTxRejectBtn = document.getElementById('p2p-tx-reject-btn');
    if (p2pTxRejectBtn) {
      p2pTxRejectBtn.addEventListener('click', rejectP2PTransaction);
    }

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = btn.closest('.modal-overlay');
        if (modal) {
          modal.classList.remove('active');
          OGQR.stopScanner();
        }
      });
    });

    // Close modals on backdrop click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('active');
          OGQR.stopScanner();
        }
      });
    });

    // Send form submission
    const sendForm = document.getElementById('send-form');
    if (sendForm) {
      sendForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const recipientId = document.getElementById('send-recipient')?.value?.trim();
        const amount = document.getElementById('send-amount')?.value;
        const description = document.getElementById('send-description')?.value?.trim();

        if (!recipientId) {
          showToast('Please scan a recipient first', 'error');
          return;
        }
        if (!amount || amount <= 0) {
          showToast('Please enter an amount', 'error');
          return;
        }

        await createTransfer(recipientId, amount, description || 'Transfer');
        closeModal('send-modal');
      });
    }
  }

  // ========================================
  // PUBLIC API
  // ========================================

  return {
    init,
    showScreen,
    showToast,
    showModal,
    closeModal,
    updateBalance,
    loadTransactions,
    openScanner,
    showMyQR
  };
})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  OGApp.init();
});
