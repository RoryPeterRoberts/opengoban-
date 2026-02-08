// =====================================================
// COMMUNITY CONNECT - AUTHENTICATION & ACCESS CONTROL
// =====================================================
// Uses Supabase Auth with magic links (email-based, no passwords)
// Requires supabase.js to be loaded first.
// =====================================================

const ADMIN_SESSION_KEY = 'cc_admin_session';
const ADMIN_PASSWORD = 'pilot2026';  // Simple password for pilot admin pages

// Cache for current member (avoid repeated DB calls)
let _currentMember = null;
let _memberPromise = null;

// =====================================================
// SESSION MANAGEMENT (Supabase-based)
// =====================================================

/**
 * Check if user has a valid Supabase auth session
 */
async function hasValidSession() {
  try {
    const session = await getAuthSession();
    if (!session) return false;

    const member = await getCurrentMember();
    if (!member) return false;

    // Must be accepted (profile complete)
    return member.status === 'ACCEPTED' || member.status === 'REVIEW';
  } catch (e) {
    console.error('Session check failed:', e);
    return false;
  }
}

/**
 * Get the current logged-in member (with caching)
 */
async function getCachedMember() {
  if (_currentMember) return _currentMember;
  if (_memberPromise) return _memberPromise;

  _memberPromise = getCurrentMember().then(member => {
    _currentMember = member;
    _memberPromise = null;
    return member;
  }).catch(err => {
    _memberPromise = null;
    throw err;
  });

  return _memberPromise;
}

/**
 * Clear the member cache (call after profile updates)
 */
function clearMemberCache() {
  _currentMember = null;
  _memberPromise = null;
}

/**
 * Redirect to access page if no valid session.
 * Returns a Promise that resolves to the member if authenticated.
 * For use at top of protected pages:
 *   const member = await requireAuthAsync();
 *   if (!member) return; // already redirecting
 */
async function requireAuthAsync() {
  try {
    const session = await getAuthSession();
    if (!session) {
      window.location.href = 'access.html';
      return null;
    }

    const member = await getCurrentMember();
    if (!member) {
      window.location.href = 'access.html';
      return null;
    }

    if (member.status === 'PENDING_PROFILE') {
      window.location.href = 'join.html';
      return null;
    }

    _currentMember = member;
    return member;
  } catch (e) {
    console.error('Auth check failed:', e);
    window.location.href = 'access.html';
    return null;
  }
}

/**
 * Synchronous auth check for backwards compatibility.
 * Kicks off async check and redirects if needed.
 * Returns true optimistically if we have a cached member.
 */
function requireAuth() {
  if (_currentMember && (_currentMember.status === 'ACCEPTED' || _currentMember.status === 'REVIEW')) {
    return true;
  }
  // Kick off async check
  requireAuthAsync();
  // Return true to not block rendering — the async check will redirect if needed
  return true;
}

/**
 * Sign out and redirect to access page
 */
async function handleSignOut() {
  clearMemberCache();
  await signOut();
  window.location.href = 'access.html';
}

// =====================================================
// INVITE TOKEN HANDLING
// =====================================================

/**
 * Extract invite token from URL hash or query params
 */
function getInviteTokenFromURL() {
  let token = null;
  if (window.location.hash && (window.location.hash.includes('token=') || window.location.hash.includes('invite='))) {
    const params = new URLSearchParams(window.location.hash.slice(1));
    token = params.get('token') || params.get('invite');
  }
  if (!token && window.location.search) {
    const params = new URLSearchParams(window.location.search);
    token = params.get('token') || params.get('invite');
  }
  return token;
}

/**
 * Store invite token for use after auth
 */
function storeInviteToken(token) {
  if (token) {
    localStorage.setItem('cc_pending_invite_token', token);
  }
}

/**
 * Retrieve and clear stored invite token
 */
function retrieveInviteToken() {
  const token = localStorage.getItem('cc_pending_invite_token');
  return token;
}

function clearInviteToken() {
  localStorage.removeItem('cc_pending_invite_token');
}

// =====================================================
// ADMIN AUTHENTICATION (unchanged — simple password)
// =====================================================

function isAdminAuthenticated() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
}

function authenticateAdmin(password) {
  if (password === ADMIN_PASSWORD) {
    sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
    return true;
  }
  return false;
}

function clearAdminSession() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

/**
 * Check if current member is an admin/moderator
 */
async function isAdmin() {
  const member = await getCachedMember();
  return member && (member.role === 'admin' || member.role === 'moderator');
}

function showAdminLoginModal(onSuccess) {
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

  setTimeout(() => {
    const input = document.getElementById('admin-password-input');
    if (input) {
      input.focus();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAdminLogin();
      });
    }
  }, 100);

  window._adminLoginCallback = onSuccess;
  return modal;
}

function handleAdminLogin() {
  const input = document.getElementById('admin-password-input');
  const error = document.getElementById('admin-login-error');
  if (!input) return;

  if (authenticateAdmin(input.value)) {
    const modal = document.getElementById('admin-login-modal');
    if (modal) modal.remove();
    if (window._adminLoginCallback) {
      window._adminLoginCallback();
      delete window._adminLoginCallback;
    }
  } else {
    if (error) error.style.display = 'block';
    input.value = '';
    input.focus();
  }
}

async function requireAdmin(onSuccess) {
  // Check if member is admin/moderator first
  const memberIsAdmin = await isAdmin();
  if (memberIsAdmin) {
    if (onSuccess) onSuccess();
    return true;
  }

  // Fall back to password auth
  if (isAdminAuthenticated()) {
    if (onSuccess) onSuccess();
    return true;
  }
  showAdminLoginModal(onSuccess);
  return false;
}
