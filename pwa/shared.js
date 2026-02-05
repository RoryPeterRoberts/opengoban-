// =====================================================
// COMMUNITY CONNECT - SHARED DATA & UTILITIES
// =====================================================

// =====================================================
// MEMBER ID MANAGEMENT
// =====================================================

const MEMBER_COUNTER_KEY = 'cc_next_member_number';

/**
 * Get the next member number and increment the counter
 * Returns a zero-padded 4-digit number string
 */
function getNextMemberNumber() {
  let nextNumber = parseInt(localStorage.getItem(MEMBER_COUNTER_KEY) || '1', 10);
  localStorage.setItem(MEMBER_COUNTER_KEY, String(nextNumber + 1));
  return String(nextNumber).padStart(4, '0');
}

/**
 * Generate a new Member ID in format CC-####
 */
function generateMemberId() {
  return 'CC-' + getNextMemberNumber();
}

/**
 * Get current member counter (for display/debug)
 */
function getCurrentMemberCounter() {
  return parseInt(localStorage.getItem(MEMBER_COUNTER_KEY) || '1', 10);
}

// =====================================================
// TRUST SIGNALS MANAGEMENT
// =====================================================

/**
 * Calculate reliability band based on exchanges and disputes
 * @returns 'Low' | 'Medium' | 'High'
 */
function calculateReliabilityBand(exchangesCompleted, disputesCount) {
  if (exchangesCompleted >= 10 && disputesCount === 0) {
    return 'High';
  }
  if (exchangesCompleted >= 3 && disputesCount <= 1) {
    return 'Medium';
  }
  return 'Low';
}

/**
 * Get trust signals for a user
 * @param {object} user - User object with trust signal fields
 * @returns Trust signals object
 */
function getUserTrustSignals(user) {
  const exchangesCompleted = user.exchangesCompleted || 0;
  const disputesCount = user.disputesCount || 0;
  const memberSince = user.memberSince || user.joinedAt || new Date().toISOString();

  return {
    exchangesCompleted,
    disputesCount,
    memberSince,
    reliabilityBand: calculateReliabilityBand(exchangesCompleted, disputesCount)
  };
}

/**
 * Format member since date for display
 */
function formatMemberSince(isoDate) {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-IE', {
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Update current user's trust signals
 */
function updateUserTrustSignals(updates) {
  const user = getCurrentUser();
  const updatedUser = { ...user, ...updates };
  localStorage.setItem('cc_current_user', JSON.stringify(updatedUser));
  return updatedUser;
}

/**
 * Increment exchanges completed for current user
 */
function incrementExchangesCompleted() {
  const user = getCurrentUser();
  const newCount = (user.exchangesCompleted || 0) + 1;
  return updateUserTrustSignals({ exchangesCompleted: newCount });
}

/**
 * Increment disputes count for current user
 */
function incrementDisputesCount() {
  const user = getCurrentUser();
  const newCount = (user.disputesCount || 0) + 1;
  return updateUserTrustSignals({ disputesCount: newCount });
}

/**
 * Debug helper: Reset trust signals to defaults
 */
function debugResetTrustSignals() {
  const user = getCurrentUser();
  const resetUser = {
    ...user,
    exchangesCompleted: 0,
    disputesCount: 0
  };
  localStorage.setItem('cc_current_user', JSON.stringify(resetUser));
  console.log('Trust signals reset to defaults');
  return resetUser;
}

/**
 * Debug helper: Set specific trust signal values
 */
function debugSetTrustSignals(exchanges, disputes) {
  return updateUserTrustSignals({
    exchangesCompleted: exchanges,
    disputesCount: disputes
  });
}

// =====================================================
// BALANCE MANAGEMENT
// =====================================================

const BALANCE_STORAGE_KEY = 'cc_user_balance';
const ADJUSTMENTS_STORAGE_KEY = 'cc_balance_adjustments';

/**
 * Get the current user (mock - in real app would be auth-based)
 * Returns user object or null if not "signed in"
 */
function getCurrentUser() {
  const stored = localStorage.getItem('cc_current_user');
  if (stored) {
    const user = JSON.parse(stored);
    // Ensure user has all required fields (migration for existing data)
    let needsUpdate = false;
    if (!user.memberId) {
      user.memberId = generateMemberId();
      needsUpdate = true;
    }
    if (!user.memberSince) {
      user.memberSince = user.joinedAt || new Date().toISOString();
      needsUpdate = true;
    }
    if (user.exchangesCompleted === undefined) {
      user.exchangesCompleted = 0;
      needsUpdate = true;
    }
    if (user.disputesCount === undefined) {
      user.disputesCount = 0;
      needsUpdate = true;
    }
    if (needsUpdate) {
      localStorage.setItem('cc_current_user', JSON.stringify(user));
    }
    return user;
  }
  // Default user placeholder
  const defaultUser = {
    id: 'user_001',
    name: 'You',
    email: '',
    memberId: generateMemberId(),
    joinedAt: new Date().toISOString(),
    memberSince: new Date().toISOString(),
    exchangesCompleted: 0,
    disputesCount: 0
  };
  localStorage.setItem('cc_current_user', JSON.stringify(defaultUser));
  return defaultUser;
}

/**
 * Update current user's profile
 */
function updateCurrentUser(updates) {
  const user = getCurrentUser();
  const updatedUser = { ...user, ...updates };
  // Prevent memberId from being changed
  updatedUser.memberId = user.memberId;
  localStorage.setItem('cc_current_user', JSON.stringify(updatedUser));
  return updatedUser;
}

/**
 * Get current user's balance
 * Returns balance object { credits, lastUpdated }
 */
function getUserBalance() {
  const stored = localStorage.getItem(BALANCE_STORAGE_KEY);
  if (stored) {
    return JSON.parse(stored);
  }
  // Default starting balance
  const defaultBalance = {
    credits: 5,
    lastUpdated: new Date().toISOString()
  };
  localStorage.setItem(BALANCE_STORAGE_KEY, JSON.stringify(defaultBalance));
  return defaultBalance;
}

/**
 * Set user balance directly (for debug/admin)
 */
function setUserBalance(credits) {
  const balance = {
    credits: credits,
    lastUpdated: new Date().toISOString()
  };
  localStorage.setItem(BALANCE_STORAGE_KEY, JSON.stringify(balance));
  return balance;
}

/**
 * Add a balance adjustment (credit or debit)
 * @param {number} amount - positive for credit, negative for debit
 * @param {string} reason - description of the adjustment
 * @param {string} type - 'give' | 'receive' | 'bonus' | 'adjustment'
 * @param {object} metadata - optional additional data (e.g., related listing)
 */
function addBalanceAdjustment(amount, reason, type = 'adjustment', metadata = {}) {
  const adjustments = getBalanceAdjustments();
  const balance = getUserBalance();

  const adjustment = {
    id: 'ADJ_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    amount: amount,
    reason: reason,
    type: type,
    timestamp: new Date().toISOString(),
    balanceAfter: balance.credits + amount,
    metadata: metadata
  };

  adjustments.unshift(adjustment); // Add to beginning (most recent first)

  // Keep only last 50 adjustments
  if (adjustments.length > 50) {
    adjustments.length = 50;
  }

  localStorage.setItem(ADJUSTMENTS_STORAGE_KEY, JSON.stringify(adjustments));

  // Update balance
  setUserBalance(balance.credits + amount);

  return adjustment;
}

/**
 * Get all balance adjustments (most recent first)
 */
function getBalanceAdjustments() {
  const stored = localStorage.getItem(ADJUSTMENTS_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

/**
 * Get recent adjustments (last n)
 */
function getRecentAdjustments(count = 5) {
  return getBalanceAdjustments().slice(0, count);
}

/**
 * Debug helper: Reset balance to default
 */
function debugResetBalance() {
  localStorage.removeItem(BALANCE_STORAGE_KEY);
  localStorage.removeItem(ADJUSTMENTS_STORAGE_KEY);
  console.log('Balance reset to default');
  return getUserBalance();
}

/**
 * Debug helper: Add sample adjustments for testing
 */
function debugAddSampleAdjustments() {
  // Clear existing
  localStorage.removeItem(ADJUSTMENTS_STORAGE_KEY);
  setUserBalance(5);

  // Add sample history
  addBalanceAdjustment(1, 'Helped Mary with groceries', 'receive', { category: 'transport_errands' });
  addBalanceAdjustment(-1, 'Got help fixing fence', 'give', { category: 'home_property' });
  addBalanceAdjustment(2, 'Taught guitar lessons to Tom', 'receive', { category: 'learning_knowledge' });
  addBalanceAdjustment(1, 'Welcome bonus for joining', 'bonus');
  addBalanceAdjustment(-1, 'Borrowed power tools from Pat', 'give', { category: 'tools_things' });

  console.log('Sample adjustments added. Current balance:', getUserBalance());
  return getBalanceAdjustments();
}

// User-facing categories (displayed in UI)
const CATEGORIES = [
  { id: 'food_produce',       label: 'Food & Produce',               emoji: '🥕' },
  { id: 'home_property',      label: 'Home & Property',              emoji: '🏠' },
  { id: 'skills_labour',      label: 'Skills & Labour',              emoji: '🔧' },
  { id: 'transport_errands',  label: 'Transport & Errands',          emoji: '🚗' },
  { id: 'care_support',       label: 'Care & Support',               emoji: '💚' },
  { id: 'learning_knowledge', label: 'Learning & Sharing Knowledge', emoji: '📚' },
  { id: 'tools_things',       label: 'Tools & Things',               emoji: '🧰' },
  { id: 'events_community',   label: 'Community Notices',            emoji: '🎉', hint: 'Member-hosted meetups' },
  { id: 'local_trade_craft',  label: 'Local Trade & Craft',          emoji: '🎨' },
  { id: 'requests_help',      label: 'Requests for Help',            emoji: '🙋' }
];

// Invite statuses
const INVITE_STATUS = {
  PENDING_PROFILE: 'PENDING_PROFILE',
  AUTO_ACCEPT: 'AUTO_ACCEPT',
  REVIEW: 'REVIEW',
  HOLD: 'HOLD',
  ACCEPTED: 'ACCEPTED'
};

// Status display labels
const STATUS_LABELS = {
  PENDING_PROFILE: 'Pending profile',
  AUTO_ACCEPT: 'Accepted',
  REVIEW: 'Awaiting review',
  HOLD: 'On hold',
  ACCEPTED: 'Accepted'
};

// =====================================================
// ECOSYSTEM HEALTH MODEL (Mock)
// =====================================================

function getDefaultEcosystemHealth() {
  return {
    // Supply: how many people are offering in each category
    supplyCounts: {
      food_produce: 5,
      home_property: 8,
      skills_labour: 12,       // Overcrowded
      transport_errands: 4,
      care_support: 3,         // Short
      learning_knowledge: 6,
      tools_things: 7,
      events_community: 9,
      local_trade_craft: 11,   // Overcrowded
      requests_help: 2         // Short
    },
    // Demand: how many requests exist in each category
    demandCounts: {
      food_produce: 6,
      home_property: 5,
      skills_labour: 4,        // Oversupply (12 supply vs 4 demand)
      transport_errands: 7,
      care_support: 9,         // High demand (3 supply vs 9 demand)
      learning_knowledge: 5,
      tools_things: 6,
      events_community: 8,
      local_trade_craft: 5,    // Oversupply
      requests_help: 8         // High demand
    }
  };
}

function getEcosystemHealth() {
  const stored = localStorage.getItem('cc_ecosystem_health');
  if (stored) {
    return JSON.parse(stored);
  }
  const defaults = getDefaultEcosystemHealth();
  localStorage.setItem('cc_ecosystem_health', JSON.stringify(defaults));
  return defaults;
}

function saveEcosystemHealth(health) {
  localStorage.setItem('cc_ecosystem_health', JSON.stringify(health));
}

function incrementSupply(categoryId) {
  const health = getEcosystemHealth();
  health.supplyCounts[categoryId] = (health.supplyCounts[categoryId] || 0) + 1;
  saveEcosystemHealth(health);
}

// =====================================================
// FIT EVALUATION
// =====================================================

function evaluateFit(primaryCategoryId) {
  const health = getEcosystemHealth();
  const supply = health.supplyCounts[primaryCategoryId] || 0;
  const demand = health.demandCounts[primaryCategoryId] || 0;
  const gap = demand - supply;

  // High demand (shortage) => AUTO_ACCEPT
  if (gap >= 3) {
    return INVITE_STATUS.AUTO_ACCEPT;
  }
  // Balanced => REVIEW
  if (gap >= -2 && gap < 3) {
    return INVITE_STATUS.REVIEW;
  }
  // Oversupply => HOLD
  return INVITE_STATUS.HOLD;
}

function getShortageCategories() {
  const health = getEcosystemHealth();
  const shortages = [];

  CATEGORIES.forEach(cat => {
    const supply = health.supplyCounts[cat.id] || 0;
    const demand = health.demandCounts[cat.id] || 0;
    if (demand - supply >= 2) {
      shortages.push(cat);
    }
  });

  return shortages;
}

function getOvercrowdedCategories() {
  const health = getEcosystemHealth();
  const overcrowded = [];

  CATEGORIES.forEach(cat => {
    const supply = health.supplyCounts[cat.id] || 0;
    const demand = health.demandCounts[cat.id] || 0;
    if (supply - demand >= 2) {
      overcrowded.push(cat);
    }
  });

  return overcrowded;
}

// =====================================================
// INVITE MANAGEMENT
// =====================================================

function getInvites() {
  const stored = localStorage.getItem('cc_invites');
  return stored ? JSON.parse(stored) : [];
}

function saveInvites(invites) {
  localStorage.setItem('cc_invites', JSON.stringify(invites));
}

function createInvite(email, note = '') {
  const invites = getInvites();
  const token = 'INV_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

  const invite = {
    token,
    email,
    note,
    status: INVITE_STATUS.PENDING_PROFILE,
    createdAt: new Date().toISOString(),
    profile: null,
    reviewMessage: null,
    holdReason: null,
    suggestedCategories: null
  };

  invites.push(invite);
  saveInvites(invites);
  return invite;
}

function getInviteByToken(token) {
  const invites = getInvites();
  return invites.find(inv => inv.token === token) || null;
}

function updateInvite(token, updates) {
  const invites = getInvites();
  const index = invites.findIndex(inv => inv.token === token);
  if (index !== -1) {
    invites[index] = { ...invites[index], ...updates };
    saveInvites(invites);
    return invites[index];
  }
  return null;
}

function getInvitesForReview() {
  return getInvites().filter(inv =>
    inv.status === INVITE_STATUS.REVIEW || inv.status === INVITE_STATUS.HOLD
  );
}

// =====================================================
// HELPERS
// =====================================================

function getCategoryById(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

function generateToken() {
  return 'INV_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Toast notification
function showToast(message, duration = 3000) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #333;
      color: white;
      padding: 14px 24px;
      border-radius: 8px;
      font-size: 15px;
      z-index: 10000;
      opacity: 0;
      transition: opacity 0.3s;
    `;
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.opacity = '1';

  setTimeout(() => {
    toast.style.opacity = '0';
  }, duration);
}

// Copy to clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  }
}

// =====================================================
// TERMS & CONDITIONS ACCEPTANCE
// =====================================================

const CURRENT_TERMS_VERSION = 'v1';
const CURRENT_PRIVACY_VERSION = 'v1';
const TERMS_LAST_UPDATED = 'January 2025';

/**
 * Get terms acceptance status for an invite/user
 * Returns { termsAccepted, termsVersion, termsAcceptedAt, privacyAccepted, privacyAcceptedAt }
 */
function getTermsAcceptance(token) {
  const invite = getInviteByToken(token);
  if (!invite) return null;

  return {
    termsAccepted: invite.termsAccepted || false,
    termsVersion: invite.termsVersion || null,
    termsAcceptedAt: invite.termsAcceptedAt || null,
    privacyAccepted: invite.privacyAccepted || false,
    privacyVersion: invite.privacyVersion || null,
    privacyAcceptedAt: invite.privacyAcceptedAt || null
  };
}

/**
 * Check if user needs to (re-)accept terms
 * Returns true if acceptance is required
 */
function requiresTermsAcceptance(token) {
  const acceptance = getTermsAcceptance(token);
  if (!acceptance) return true;

  // Check if terms were accepted and version matches current
  if (!acceptance.termsAccepted || acceptance.termsVersion !== CURRENT_TERMS_VERSION) {
    return true;
  }

  // Check if privacy was accepted and version matches current
  if (!acceptance.privacyAccepted || acceptance.privacyVersion !== CURRENT_PRIVACY_VERSION) {
    return true;
  }

  return false;
}

/**
 * Record terms acceptance for an invite/user
 */
function acceptTerms(token) {
  const now = new Date().toISOString();

  updateInvite(token, {
    termsAccepted: true,
    termsVersion: CURRENT_TERMS_VERSION,
    termsAcceptedAt: now,
    privacyAccepted: true,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    privacyAcceptedAt: now
  });

  return true;
}

/**
 * Get human-readable acceptance info
 */
function getTermsAcceptanceDisplay(token) {
  const acceptance = getTermsAcceptance(token);
  if (!acceptance || !acceptance.termsAccepted) {
    return { accepted: false, message: 'Not yet accepted' };
  }

  const date = new Date(acceptance.termsAcceptedAt);
  const formattedDate = date.toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  const isCurrentVersion = acceptance.termsVersion === CURRENT_TERMS_VERSION;

  return {
    accepted: true,
    isCurrentVersion,
    version: acceptance.termsVersion,
    date: formattedDate,
    message: isCurrentVersion
      ? `Accepted ${acceptance.termsVersion} on ${formattedDate}`
      : `Accepted ${acceptance.termsVersion} (update required)`
  };
}

// =====================================================
// GOVERNANCE & TRANSPARENCY
// =====================================================

const GOVERNANCE_STORAGE_KEY = 'cc_governance';

/**
 * Get default governance data for initial setup
 */
function getDefaultGovernance() {
  return {
    moderators: [
      { id: 'mod_001', name: 'Mary O\'Sullivan', role: 'Lead Moderator', since: '2024-09-01' },
      { id: 'mod_002', name: 'Patrick Byrne', role: 'Moderator', since: '2024-10-15' }
    ],
    pilotEndDate: '2025-06-30',
    pilotStartDate: '2025-01-15',
    lastPolicyChange: {
      date: '2025-01-20',
      description: 'Initial community charter adopted',
      proposedBy: 'Founding members'
    },
    auditLog: [
      {
        id: 'audit_001',
        timestamp: '2025-01-20T10:00:00Z',
        action: 'policy_approved',
        actor: 'Community vote',
        description: 'Community Charter v1.0 adopted',
        details: 'Approved by founding members'
      },
      {
        id: 'audit_002',
        timestamp: '2025-01-22T14:30:00Z',
        action: 'moderator_appointed',
        actor: 'Community vote',
        description: 'Mary O\'Sullivan appointed as Lead Moderator',
        details: 'Elected by community consensus'
      },
      {
        id: 'audit_003',
        timestamp: '2025-01-25T09:15:00Z',
        action: 'member_approved',
        actor: 'Mary O\'Sullivan',
        description: 'New member application approved',
        details: 'Standard review process completed'
      }
    ]
  };
}

/**
 * Get governance data from localStorage
 */
function getGovernance() {
  const stored = localStorage.getItem(GOVERNANCE_STORAGE_KEY);
  if (stored) {
    return JSON.parse(stored);
  }
  const defaults = getDefaultGovernance();
  localStorage.setItem(GOVERNANCE_STORAGE_KEY, JSON.stringify(defaults));
  return defaults;
}

/**
 * Save governance data
 */
function saveGovernance(governance) {
  localStorage.setItem(GOVERNANCE_STORAGE_KEY, JSON.stringify(governance));
}

/**
 * Add an entry to the audit log
 */
function addAuditEntry(action, actor, description, details = '') {
  const governance = getGovernance();
  const entry = {
    id: 'audit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    timestamp: new Date().toISOString(),
    action,
    actor,
    description,
    details
  };
  governance.auditLog.unshift(entry);
  // Keep last 100 entries
  if (governance.auditLog.length > 100) {
    governance.auditLog.length = 100;
  }
  saveGovernance(governance);
  return entry;
}

/**
 * Get recent audit entries
 */
function getRecentAuditEntries(count = 10) {
  const governance = getGovernance();
  return governance.auditLog.slice(0, count);
}

/**
 * Get moderators list
 */
function getModerators() {
  const governance = getGovernance();
  return governance.moderators;
}

/**
 * Get pilot info
 */
function getPilotInfo() {
  const governance = getGovernance();
  return {
    startDate: governance.pilotStartDate,
    endDate: governance.pilotEndDate,
    lastPolicyChange: governance.lastPolicyChange
  };
}

/**
 * Format date for display
 */
function formatGovernanceDate(isoDate) {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

// =====================================================
// HIGH-RISK CATEGORIES
// =====================================================

const HIGH_RISK_CATEGORIES = ['care_support', 'home_property', 'tools_things'];

/**
 * Check if a category is considered high-risk
 */
function isHighRiskCategory(categoryId) {
  return HIGH_RISK_CATEGORIES.includes(categoryId);
}

/**
 * Get the safety warning message for high-risk categories
 */
function getHighRiskWarning() {
  return {
    title: 'Safety notice',
    message: 'Some help can carry risk. Agree details directly with your neighbour. Community Connect is a noticeboard — we don\'t provide insurance or supervision.',
    checkboxLabel: 'I understand Community Connect is a noticeboard and I\'m responsible for assessing safety.'
  };
}

// =====================================================
// AREA/PROXIMITY OPTIONS
// =====================================================

const AREA_OPTIONS = [
  { id: 'neighbourhood', label: 'My neighbourhood', description: 'Walking distance' },
  { id: 'village', label: 'My village', description: 'Local area' },
  { id: 'nearby', label: 'Nearby (within 10km)', description: 'Short drive' }
];

/**
 * Get area options for listings
 */
function getAreaOptions() {
  return AREA_OPTIONS;
}

/**
 * Get current user's area (mock - would be set in profile)
 */
function getUserArea() {
  const user = getCurrentUser();
  return user.area || 'village'; // Default to village
}

/**
 * Check if listing area matches user area (simplified mock logic)
 */
function isNearUser(listingArea) {
  const userArea = getUserArea();
  // Simple mock: neighbourhood always matches, village matches village/neighbourhood
  if (listingArea === 'neighbourhood') return true;
  if (listingArea === 'village' && (userArea === 'village' || userArea === 'neighbourhood')) return true;
  if (listingArea === 'nearby') return true; // Always show nearby
  return listingArea === userArea;
}

// =====================================================
// FEEDBACK SYSTEM
// =====================================================

const FEEDBACK_STORAGE_KEY = 'cc_feedback';
const PROPOSALS_STORAGE_KEY = 'cc_proposals';
const IMPL_PACKS_STORAGE_KEY = 'cc_implementation_packs';

// Feedback types
const FEEDBACK_TYPES = [
  { id: 'bug', label: 'Bug', emoji: '🐛', description: 'Something is broken' },
  { id: 'idea', label: 'Idea', emoji: '💡', description: 'Feature suggestion' },
  { id: 'question', label: 'Question', emoji: '❓', description: 'Need clarification' },
  { id: 'other', label: 'Other', emoji: '💬', description: 'General feedback' }
];

// Feedback status
const FEEDBACK_STATUS = {
  NEW: 'new',
  TRIAGED: 'triaged',
  ACTIONED: 'actioned',
  DECLINED: 'declined'
};

// Proposal status
const PROPOSAL_STATUS = {
  DRAFT: 'draft',
  REVIEWING: 'reviewing',
  APPROVED: 'approved',
  IMPLEMENTED: 'implemented',
  DECLINED: 'declined'
};

// Implementation pack status
const PACK_STATUS = {
  DRAFT: 'draft',
  READY: 'ready',
  APPLIED: 'applied'
};

/**
 * Get all feedback items
 */
function getAllFeedback() {
  const stored = localStorage.getItem(FEEDBACK_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

/**
 * Save all feedback items
 */
function saveFeedback(feedbackList) {
  localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(feedbackList));
}

/**
 * Get feedback by ID
 */
function getFeedbackById(id) {
  const feedback = getAllFeedback();
  return feedback.find(f => f.id === id) || null;
}

/**
 * Get feedback by token (user's own feedback)
 */
function getFeedbackByToken(token) {
  const feedback = getAllFeedback();
  return feedback.filter(f => f.submittedBy === token);
}

/**
 * Create new feedback item
 */
function createFeedback(type, message, token) {
  const feedback = getAllFeedback();

  const newFeedback = {
    id: 'fb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    submittedBy: token,
    submittedAt: new Date().toISOString(),
    type: type,
    message: message,
    status: FEEDBACK_STATUS.NEW,
    aiTriage: null,
    adminNotes: null,
    proposalId: null
  };

  // Run mock AI triage
  newFeedback.aiTriage = mockAiTriage(newFeedback);

  feedback.unshift(newFeedback);
  saveFeedback(feedback);

  return newFeedback;
}

/**
 * Update feedback item
 */
function updateFeedback(id, updates) {
  const feedback = getAllFeedback();
  const index = feedback.findIndex(f => f.id === id);

  if (index !== -1) {
    feedback[index] = { ...feedback[index], ...updates };
    saveFeedback(feedback);
    return feedback[index];
  }
  return null;
}

/**
 * Mock AI triage function
 * Analyzes feedback and suggests priority, category, and action
 */
function mockAiTriage(feedback) {
  const message = feedback.message.toLowerCase();

  let priority = 'medium';
  let category = 'general';
  let suggestedAction = 'Review and categorize';

  // Priority detection
  if (message.includes('urgent') || message.includes('critical') || message.includes('crash') || message.includes('broken')) {
    priority = 'high';
  } else if (message.includes('minor') || message.includes('small') || message.includes('nice to have')) {
    priority = 'low';
  }

  // Category detection
  if (message.includes('bug') || message.includes('error') || message.includes('broken') || message.includes('not working')) {
    category = 'bug';
    suggestedAction = 'Investigate and fix';
  } else if (message.includes('idea') || message.includes('suggest') || message.includes('could') || message.includes('would be nice')) {
    category = 'feature';
    suggestedAction = 'Consider for roadmap';
  } else if (message.includes('?') || message.includes('how') || message.includes('why') || message.includes('what')) {
    category = 'question';
    suggestedAction = 'Respond to user';
  } else if (message.includes('confused') || message.includes('unclear') || message.includes("don't understand")) {
    category = 'ux';
    suggestedAction = 'Review UX clarity';
  }

  // Adjust based on feedback type
  if (feedback.type === 'bug') {
    category = 'bug';
    if (priority !== 'high') priority = 'medium';
  } else if (feedback.type === 'idea') {
    category = 'feature';
    suggestedAction = 'Consider for roadmap';
  } else if (feedback.type === 'question') {
    category = 'question';
    suggestedAction = 'Respond to user';
  }

  return {
    priority,
    category,
    suggestedAction,
    triagedAt: new Date().toISOString()
  };
}

/**
 * Get feedback grouped by status
 */
function getFeedbackByStatus() {
  const feedback = getAllFeedback();
  return {
    new: feedback.filter(f => f.status === FEEDBACK_STATUS.NEW),
    triaged: feedback.filter(f => f.status === FEEDBACK_STATUS.TRIAGED),
    actioned: feedback.filter(f => f.status === FEEDBACK_STATUS.ACTIONED),
    declined: feedback.filter(f => f.status === FEEDBACK_STATUS.DECLINED)
  };
}

/**
 * Get feedback counts
 */
function getFeedbackCounts() {
  const byStatus = getFeedbackByStatus();
  return {
    total: getAllFeedback().length,
    new: byStatus.new.length,
    triaged: byStatus.triaged.length,
    actioned: byStatus.actioned.length,
    declined: byStatus.declined.length
  };
}

// =====================================================
// PROPOSALS
// =====================================================

/**
 * Get all proposals
 */
function getAllProposals() {
  const stored = localStorage.getItem(PROPOSALS_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

/**
 * Save all proposals
 */
function saveProposals(proposals) {
  localStorage.setItem(PROPOSALS_STORAGE_KEY, JSON.stringify(proposals));
}

/**
 * Get proposal by ID
 */
function getProposalById(id) {
  const proposals = getAllProposals();
  return proposals.find(p => p.id === id) || null;
}

/**
 * Create proposal from feedback
 */
function createProposalFromFeedback(feedbackId, title, description) {
  const feedback = getFeedbackById(feedbackId);
  if (!feedback) return null;

  const proposals = getAllProposals();

  const newProposal = {
    id: 'prop_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    title: title,
    description: description,
    createdFrom: feedbackId,
    createdAt: new Date().toISOString(),
    status: PROPOSAL_STATUS.DRAFT,
    votes: { for: [], against: [] },
    implementationPack: null
  };

  proposals.unshift(newProposal);
  saveProposals(proposals);

  // Update feedback with proposal link
  updateFeedback(feedbackId, {
    proposalId: newProposal.id,
    status: FEEDBACK_STATUS.ACTIONED
  });

  return newProposal;
}

/**
 * Update proposal
 */
function updateProposal(id, updates) {
  const proposals = getAllProposals();
  const index = proposals.findIndex(p => p.id === id);

  if (index !== -1) {
    proposals[index] = { ...proposals[index], ...updates };
    saveProposals(proposals);
    return proposals[index];
  }
  return null;
}

/**
 * Vote on proposal
 */
function voteOnProposal(proposalId, token, voteFor) {
  const proposal = getProposalById(proposalId);
  if (!proposal) return null;

  // Remove existing vote
  proposal.votes.for = proposal.votes.for.filter(t => t !== token);
  proposal.votes.against = proposal.votes.against.filter(t => t !== token);

  // Add new vote
  if (voteFor) {
    proposal.votes.for.push(token);
  } else {
    proposal.votes.against.push(token);
  }

  return updateProposal(proposalId, { votes: proposal.votes });
}

/**
 * Get proposals grouped by status
 */
function getProposalsByStatus() {
  const proposals = getAllProposals();
  return {
    draft: proposals.filter(p => p.status === PROPOSAL_STATUS.DRAFT),
    reviewing: proposals.filter(p => p.status === PROPOSAL_STATUS.REVIEWING),
    approved: proposals.filter(p => p.status === PROPOSAL_STATUS.APPROVED),
    implemented: proposals.filter(p => p.status === PROPOSAL_STATUS.IMPLEMENTED),
    declined: proposals.filter(p => p.status === PROPOSAL_STATUS.DECLINED)
  };
}

// =====================================================
// IMPLEMENTATION PACKS
// =====================================================

/**
 * Get all implementation packs
 */
function getAllImplementationPacks() {
  const stored = localStorage.getItem(IMPL_PACKS_STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

/**
 * Save all implementation packs
 */
function saveImplementationPacks(packs) {
  localStorage.setItem(IMPL_PACKS_STORAGE_KEY, JSON.stringify(packs));
}

/**
 * Get implementation pack by ID
 */
function getImplementationPackById(id) {
  const packs = getAllImplementationPacks();
  return packs.find(p => p.id === id) || null;
}

/**
 * Create implementation pack for proposal
 */
function createImplementationPack(proposalId, title, description, files) {
  const proposal = getProposalById(proposalId);
  if (!proposal) return null;

  const packs = getAllImplementationPacks();

  const newPack = {
    id: 'pack_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    proposalId: proposalId,
    title: title,
    description: description,
    files: files || [], // Array of { path, changeType, summary }
    createdAt: new Date().toISOString(),
    status: PACK_STATUS.DRAFT
  };

  packs.unshift(newPack);
  saveImplementationPacks(packs);

  // Update proposal with pack link
  updateProposal(proposalId, { implementationPack: newPack.id });

  return newPack;
}

/**
 * Update implementation pack
 */
function updateImplementationPack(id, updates) {
  const packs = getAllImplementationPacks();
  const index = packs.findIndex(p => p.id === id);

  if (index !== -1) {
    packs[index] = { ...packs[index], ...updates };
    saveImplementationPacks(packs);
    return packs[index];
  }
  return null;
}

/**
 * Mark implementation pack as applied
 */
function markPackAsApplied(id) {
  const pack = getImplementationPackById(id);
  if (!pack) return null;

  updateImplementationPack(id, { status: PACK_STATUS.APPLIED });

  // Update proposal status
  if (pack.proposalId) {
    updateProposal(pack.proposalId, { status: PROPOSAL_STATUS.IMPLEMENTED });
  }

  return getImplementationPackById(id);
}
