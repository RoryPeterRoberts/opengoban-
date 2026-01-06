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
  async function openScanner() {
    const hasCamera = await OGQR.hasCamera();
    if (!hasCamera) {
      showToast('No camera available', 'error');
      return;
    }

    showModal('scanner-modal');

    // Start scanning
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
      member.circle_id
    );

    OGQR.generateQR('my-qr', payload, { width: 256, height: 256 });
    showModal('my-qr-modal');
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
        TCQR.stopScanner();
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

        if (!recipientId || !amount) {
          showToast('Please fill in recipient and amount', 'error');
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
