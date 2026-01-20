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
  };

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
    } else {
      showOnboarding();
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
  // ONBOARDING
  // ============================================

  function showOnboarding() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div id="onboarding-screen" class="screen active onboarding-screen">
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

        <div class="onboarding-features">
          <div class="feature-item">
            <div class="feature-icon">🤝</div>
            <span>Track favors given and received</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">📱</div>
            <span>Works offline - no internet needed</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">🔒</div>
            <span>Private - stays on your phone</span>
          </div>
        </div>

        <div class="name-section">
          <label class="input-label">What should neighbors call you?</label>
          <input
            type="text"
            id="name-input"
            class="name-input"
            placeholder="Your name"
            maxlength="30"
            autocomplete="name"
          >
          <p class="input-hint">This is how you'll appear to others</p>
        </div>

        <button id="join-btn" class="btn btn-primary btn-lg btn-block">
          🌻 Join My Community
        </button>

        <p class="text-muted mt-lg" style="font-size: 0.85rem;">
          No sign-up. No account. Everything stays on your phone.
        </p>
      </div>
    `;

    setupOnboardingListeners();
  }

  function setupOnboardingListeners() {
    const joinBtn = document.getElementById('join-btn');
    const nameInput = document.getElementById('name-input');

    if (joinBtn && nameInput) {
      joinBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();

        if (name.length < 2) {
          showToast('Please enter your name (at least 2 letters)', 'error');
          nameInput.focus();
          return;
        }

        joinBtn.disabled = true;
        joinBtn.innerHTML = '<span class="spinner"></span> Setting up...';

        try {
          await createIdentity(name);
          showApp();
          navigateTo('home');
          showToast(`Welcome, ${name}! 🎉`, 'success');
        } catch (e) {
          console.error('Setup error:', e);
          showToast('Something went wrong. Please try again.', 'error');
          joinBtn.disabled = false;
          joinBtn.innerHTML = '🌻 Join My Community';
        }
      });

      nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinBtn.click();
      });
    }
  }

  // ============================================
  // MAIN APP
  // ============================================

  function showApp() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <header class="app-header">
        <div>
          <div class="header-greeting">Hello,</div>
          <div class="header-name" id="header-name">Neighbor</div>
        </div>
        <div id="header-balance" class="header-balance zero">
          <span>🤝</span>
          <span id="header-balance-num">0</span>
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

    if (nameEl) nameEl.textContent = state.currentMember.name;
    if (idEl) idEl.textContent = state.currentMember.memberId;
    if (avatarEl) avatarEl.textContent = getInitials(state.currentMember.name);

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
      };
      codeEl.value = 'HH2:' + btoa(JSON.stringify(backup));
    }
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
