// =====================================================
// CONNECT AGAIN - SHARED UTILITIES
// =====================================================
// Pure utility functions and constants shared across pages.
// All data operations use supabase.js — no localStorage here.
// =====================================================

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

// High-risk categories that trigger safety notices
const HIGH_RISK_CATEGORIES = ['care_support', 'home_property', 'tools_things'];

function isHighRiskCategory(categoryId) {
  return HIGH_RISK_CATEGORIES.includes(categoryId);
}

function getCategoryById(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
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
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  }
}

// Area/proximity options
const AREA_OPTIONS = [
  { id: 'neighbourhood', label: 'My neighbourhood', description: 'Walking distance' },
  { id: 'village', label: 'My village', description: 'Local area' },
  { id: 'nearby', label: 'Nearby (within 10km)', description: 'Short drive' }
];

function getAreaOptions() {
  return AREA_OPTIONS;
}
