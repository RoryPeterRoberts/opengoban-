// =====================================================
// COMMUNITY CONNECT - AUTHENTICATION & ACCESS CONTROL
// =====================================================

const AUTH_STORAGE_KEY = 'cc_session';
const ADMIN_SESSION_KEY = 'cc_admin_session';
const ADMIN_PASSWORD = 'pilot2025';  // Simple password for pilot

// =====================================================
// SESSION MANAGEMENT
// =====================================================

/**
 * Check if user has valid session (has completed invite flow)
 * @returns {boolean}
 */
function hasValidSession() {
  const session = sessionStorage.getItem(AUTH_STORAGE_KEY);
  if (!session) return false;

  try {
    const data = JSON.parse(session);
    // Verify token exists and is valid
    if (!data.token) return false;

    // Check if invite exists and has been accepted
    const invite = getInviteByToken(data.token);
    if (!invite) return false;

    // Allow access if profile has been submitted (any status except PENDING_PROFILE)
    return invite.status !== 'PENDING_PROFILE';
  } catch (e) {
    return false;
  }
}

/**
 * Create session after successful invite redemption
 * @param {string} token - The invite token
 */
function createSession(token) {
  sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
    token: token,
    createdAt: new Date().toISOString()
  }));
}

/**
 * Get current session token
 * @returns {string|null}
 */
function getSessionToken() {
  const session = sessionStorage.getItem(AUTH_STORAGE_KEY);
  if (!session) return null;

  try {
    return JSON.parse(session).token;
  } catch (e) {
    return null;
  }
}

/**
 * Get current session data
 * @returns {object|null}
 */
function getSession() {
  const session = sessionStorage.getItem(AUTH_STORAGE_KEY);
  if (!session) return null;

  try {
    return JSON.parse(session);
  } catch (e) {
    return null;
  }
}

/**
 * Clear the current session
 */
function clearSession() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
}

/**
 * Redirect to access page if no valid session
 * @returns {boolean} - true if session is valid, false if redirecting
 */
function requireAuth() {
  if (!hasValidSession()) {
    window.location.href = 'access.html';
    return false;
  }
  return true;
}

// =====================================================
// ADMIN AUTHENTICATION
// =====================================================

/**
 * Check if admin is authenticated
 * @returns {boolean}
 */
function isAdminAuthenticated() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
}

/**
 * Authenticate admin with password
 * @param {string} password
 * @returns {boolean} - true if password is correct
 */
function authenticateAdmin(password) {
  if (password === ADMIN_PASSWORD) {
    sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
    return true;
  }
  return false;
}

/**
 * Clear admin session
 */
function clearAdminSession() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

/**
 * Show admin password prompt modal
 * @param {function} onSuccess - Callback when authentication succeeds
 * @returns {HTMLElement} - The modal element
 */
function showAdminLoginModal(onSuccess) {
  // Remove existing modal if present
  const existing = document.getElementById('admin-login-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'admin-login-modal';
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal" style="max-width: 400px;">
      <div class="modal-header">
        <h2 class="modal-title">Admin Access</h2>
        <p class="modal-subtitle">Enter the admin password to continue.</p>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" class="input" id="admin-password-input" placeholder="Enter password" autocomplete="off">
          <p class="form-hint" id="admin-login-error" style="color: var(--color-status-hold); display: none;">Incorrect password</p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="window.location.href='index.html'">Cancel</button>
        <button class="btn btn-primary" onclick="handleAdminLogin()">Login</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Focus password input
  setTimeout(() => {
    const input = document.getElementById('admin-password-input');
    if (input) {
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          handleAdminLogin();
        }
      });
    }
  }, 100);

  // Store callback
  window._adminLoginCallback = onSuccess;

  return modal;
}

/**
 * Handle admin login form submission
 */
function handleAdminLogin() {
  const input = document.getElementById('admin-password-input');
  const error = document.getElementById('admin-login-error');

  if (!input) return;

  const password = input.value;

  if (authenticateAdmin(password)) {
    // Remove modal
    const modal = document.getElementById('admin-login-modal');
    if (modal) modal.remove();

    // Call success callback
    if (window._adminLoginCallback) {
      window._adminLoginCallback();
      delete window._adminLoginCallback;
    }
  } else {
    // Show error
    if (error) {
      error.style.display = 'block';
    }
    input.value = '';
    input.focus();
  }
}

/**
 * Check admin auth or show login modal
 * @param {function} onSuccess - Callback when authenticated
 * @returns {boolean} - true if already authenticated
 */
function requireAdmin(onSuccess) {
  if (isAdminAuthenticated()) {
    if (onSuccess) onSuccess();
    return true;
  }
  showAdminLoginModal(onSuccess);
  return false;
}

// =====================================================
// SESSION USER HELPERS
// =====================================================

/**
 * Get the current user based on session
 * Returns the invite data for the current session
 * @returns {object|null}
 */
function getSessionUser() {
  const token = getSessionToken();
  if (!token) return null;

  return getInviteByToken(token);
}

/**
 * Update the current session user's data
 * @param {object} updates
 * @returns {object|null}
 */
function updateSessionUser(updates) {
  const token = getSessionToken();
  if (!token) return null;

  return updateInvite(token, updates);
}
