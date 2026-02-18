// =====================================================
// CONNECT AGAIN — SUPABASE CLIENT MODULE
// =====================================================
// All data access goes through this module.
// Replace SUPABASE_URL and SUPABASE_ANON_KEY with your project values.
// =====================================================

const SUPABASE_URL = 'https://xqvzpjesgxojsdivupfl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SzI_ugQK1PO5HnsC7fpx3g_8iGDOp-F';

// Load Supabase client from CDN
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> must be in HTML

let _supabase = null;

function getSupabase() {
  if (!_supabase) {
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.error('Supabase JS library not loaded. Add the CDN script to your HTML.');
      return null;
    }
    _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabase;
}

// =====================================================
// AUTH
// =====================================================

async function signInWithEmail(email) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + '/access.html'
    }
  });
  if (error) throw error;
  return data;
}

async function getAuthUser() {
  const sb = getSupabase();
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

async function getAuthSession() {
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

async function signOut() {
  const sb = getSupabase();
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

function onAuthStateChange(callback) {
  const sb = getSupabase();
  return sb.auth.onAuthStateChange(callback);
}

// =====================================================
// MEMBERS
// =====================================================

async function getMemberByAuthId(authId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('members')
    .select('*')
    .eq('auth_id', authId)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data;
}

async function getMemberByEmail(email) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('members')
    .select('*')
    .eq('email', email)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function getMemberById(id) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('members')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function getCurrentMember() {
  const user = await getAuthUser();
  if (!user) return null;
  return getMemberByAuthId(user.id);
}

async function createMember(memberData) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('members')
    .insert(memberData)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateMember(id, updates) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('members')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getAcceptedMembers() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('members')
    .select('*')
    .eq('status', 'ACCEPTED')
    .neq('member_id', 'OG-0000')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getAllMembers() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('members')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getMembersForReview() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('members')
    .select('*')
    .in('status', ['REVIEW', 'HOLD', 'PENDING_PROFILE'])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function generateNextMemberId() {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('generate_member_id');
  if (error) throw error;
  return data;
}

// =====================================================
// LISTINGS
// =====================================================

async function getActiveListings(filters = {}) {
  const sb = getSupabase();
  let query = sb
    .from('listings')
    .select(`
      *,
      author:members!listings_author_id_fkey (
        id, display_name, member_id, primary_category,
        area, exchanges_completed, disputes_count, created_at, invited_by
      )
    `)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (filters.type) query = query.eq('type', filters.type);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.area) query = query.eq('area', filters.area);
  if (filters.limit) query = query.limit(filters.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function getListingById(id) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('listings')
    .select(`
      *,
      author:members!listings_author_id_fkey (
        id, display_name, member_id, primary_category, skill_tags,
        area, exchanges_completed, disputes_count, created_at,
        email, phone, chat_platform, chat_handle
      )
    `)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function getMyListings(memberId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('listings')
    .select('*')
    .eq('author_id', memberId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createListing(listingData) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('listings')
    .insert(listingData)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateListing(id, updates) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('listings')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Subscribe to new listings in realtime
function subscribeToListings(callback) {
  const sb = getSupabase();
  return sb
    .channel('listings-feed')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'listings'
    }, callback)
    .subscribe();
}

// =====================================================
// EXCHANGES
// =====================================================

async function proposeExchange(exchangeData) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('exchanges')
    .insert(exchangeData)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getExchangeById(id) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('exchanges')
    .select(`
      *,
      provider:members!exchanges_provider_id_fkey (id, display_name, member_id, email, phone),
      receiver:members!exchanges_receiver_id_fkey (id, display_name, member_id, email, phone),
      witness:members!exchanges_witness_id_fkey (id, display_name, member_id),
      listing:listings!exchanges_listing_id_fkey (id, title, type, category)
    `)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

async function getMyExchanges(memberId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('exchanges')
    .select(`
      *,
      provider:members!exchanges_provider_id_fkey (id, display_name, member_id, email, phone),
      receiver:members!exchanges_receiver_id_fkey (id, display_name, member_id, email, phone),
      listing:listings!exchanges_listing_id_fkey (id, title, type, category)
    `)
    .or(`provider_id.eq.${memberId},receiver_id.eq.${memberId}`)
    .order('proposed_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getActiveExchanges(memberId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('exchanges')
    .select(`
      *,
      provider:members!exchanges_provider_id_fkey (id, display_name, member_id, email, phone),
      receiver:members!exchanges_receiver_id_fkey (id, display_name, member_id, email, phone),
      listing:listings!exchanges_listing_id_fkey (id, title, type, category)
    `)
    .or(`provider_id.eq.${memberId},receiver_id.eq.${memberId}`)
    .in('status', ['proposed', 'accepted'])
    .order('proposed_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function acceptExchange(exchangeId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('exchanges')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', exchangeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function confirmExchange(exchangeId, role) {
  const sb = getSupabase();
  const field = role === 'provider' ? 'provider_confirmed' : 'receiver_confirmed';
  const { data, error } = await sb
    .from('exchanges')
    .update({ [field]: true })
    .eq('id', exchangeId)
    .select()
    .single();
  if (error) throw error;

  // If both confirmed, complete the exchange
  if (data.provider_confirmed && data.receiver_confirmed) {
    const { error: rpcError } = await sb.rpc('complete_exchange', {
      exchange_uuid: exchangeId
    });
    if (rpcError) throw rpcError;

    // Mark the listing as completed now that the exchange is done
    if (data.listing_id) {
      await sb.from('listings').update({ status: 'completed' }).eq('id', data.listing_id).eq('status', 'active');
    }

    // Re-fetch to get updated status
    return getExchangeById(exchangeId);
  }
  return data;
}

async function cancelExchange(exchangeId, cancelReason) {
  const sb = getSupabase();
  const update = { status: 'cancelled' };
  if (cancelReason) update.cancel_reason = cancelReason;
  const { data, error } = await sb
    .from('exchanges')
    .update(update)
    .eq('id', exchangeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getExchangesForListing(listingId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('exchanges')
    .select(`
      *,
      provider:members!exchanges_provider_id_fkey (id, display_name, member_id, email, phone),
      receiver:members!exchanges_receiver_id_fkey (id, display_name, member_id, email, phone)
    `)
    .eq('listing_id', listingId)
    .order('proposed_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Subscribe to exchange updates
function subscribeToExchanges(memberId, callback) {
  const sb = getSupabase();
  return sb
    .channel('my-exchanges')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'exchanges',
      filter: `provider_id=eq.${memberId}`
    }, callback)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'exchanges',
      filter: `receiver_id=eq.${memberId}`
    }, callback)
    .subscribe();
}

// =====================================================
// BALANCES
// =====================================================

async function getBalance(memberId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('balances')
    .select('*')
    .eq('member_id', memberId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || { credits: 5, total_earned: 0, total_spent: 0 };
}

async function getBalanceHistory(memberId, limit = 20) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('balance_history')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function getAllBalances() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('balances')
    .select(`
      *,
      member:members!balances_member_id_fkey (id, display_name, member_id)
    `)
    .order('credits', { ascending: false });
  if (error) throw error;
  return data || [];
}

// =====================================================
// INVITES
// =====================================================

async function createInviteRecord(inviteData) {
  const sb = getSupabase();
  const token = 'INV_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const { data, error } = await sb
    .from('invites')
    .insert({ ...inviteData, token })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getInviteByToken(token) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('invites')
    .select('*')
    .eq('token', token)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

async function redeemInvite(token, memberId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('invites')
    .update({
      status: 'redeemed',
      redeemed_by: memberId,
      redeemed_at: new Date().toISOString()
    })
    .eq('token', token)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getMyInvites(memberId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('invites')
    .select('*')
    .eq('created_by', memberId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// =====================================================
// FEEDBACK
// =====================================================

async function createFeedbackRecord(feedbackData) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('feedback')
    .insert(feedbackData)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getMyFeedback(memberId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('feedback')
    .select('*')
    .eq('author_id', memberId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getAllFeedbackRecords() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('feedback')
    .select(`
      *,
      author:members!feedback_author_id_fkey (id, display_name, member_id)
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function updateFeedbackRecord(id, updates) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('feedback')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// =====================================================
// AUDIT LOG
// =====================================================

async function addAuditEntry(action, actorId, actorName, description, details = null) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('audit_log')
    .insert({ action, actor_id: actorId, actor_name: actorName, description, details })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getAuditLog(limit = 50) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// =====================================================
// REACH OUTS
// =====================================================

async function createReachOut({ from_id, to_id, reason }) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('reach_outs')
    .insert({ from_id, to_id, reason })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getMyReachOuts(memberId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('reach_outs')
    .select(`
      *,
      from_member:members!reach_outs_from_id_fkey (id, display_name, member_id, chat_platform, chat_handle),
      to_member:members!reach_outs_to_id_fkey (id, display_name, member_id, chat_platform, chat_handle)
    `)
    .or(`from_id.eq.${memberId},to_id.eq.${memberId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getPendingReachOutBetween(fromId, toId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('reach_outs')
    .select('*')
    .eq('from_id', fromId)
    .eq('to_id', toId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateReachOut(id, updates) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('reach_outs')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

function buildChatLink(platform, handle) {
  if (!platform || !handle) return null;
  const cleaned = handle.replace(/\s/g, '');
  switch (platform) {
    case 'whatsapp':
      // Strip leading + if present for wa.me format
      return 'https://wa.me/' + cleaned.replace(/^\+/, '');
    case 'telegram':
      // Handle with or without @
      return 'https://t.me/' + cleaned.replace(/^@/, '');
    case 'signal':
      return 'https://signal.me/#p/' + cleaned;
    default:
      return null;
  }
}

// =====================================================
// LISTING COMMENTS
// =====================================================

async function createListingComment(commentData) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('listing_comments')
    .insert(commentData)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getListingComments(listingId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('listing_comments')
    .select(`
      *,
      author:members!listing_comments_author_id_fkey (id, display_name, member_id)
    `)
    .eq('listing_id', listingId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// =====================================================
// NOTIFICATIONS
// =====================================================

async function createNotification({ member_id, type, title, body, link }) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('notifications')
    .insert({ member_id, type, title, body, link })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getMyNotifications(limit = 20) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function getUnreadNotificationCount() {
  const sb = getSupabase();
  const { count, error } = await sb
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .is('read_at', null);
  if (error) throw error;
  return count || 0;
}

async function markNotificationRead(notificationId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function markAllNotificationsRead() {
  const sb = getSupabase();
  const { error } = await sb
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw error;
}

function subscribeToNotifications(memberId, callback) {
  const sb = getSupabase();
  return sb
    .channel('my-notifications')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `member_id=eq.${memberId}`
    }, callback)
    .subscribe();
}

// =====================================================
// ENGAGEMENT SCORE
// =====================================================

async function getEngagementData() {
  const sb = getSupabase();

  // Fetch all data in parallel
  const [members, listings, exchanges, invites, feedback] = await Promise.all([
    getAcceptedMembers(),
    sb.from('listings').select('id, author_id').then(r => r.data || []),
    sb.from('exchanges').select('id, provider_id, receiver_id, proposed_by, status').then(r => r.data || []),
    sb.from('invites').select('id, created_by, status').then(r => r.data || []),
    sb.from('feedback').select('author_id, commit_hash').eq('status', 'actioned').not('commit_hash', 'is', null).then(r => r.data || [])
  ]);

  // Build per-member counts
  const listingCounts = {};
  listings.forEach(l => {
    listingCounts[l.author_id] = (listingCounts[l.author_id] || 0) + 1;
  });

  const exchangeCounts = {};
  exchanges.forEach(e => {
    [e.provider_id, e.receiver_id].forEach(id => {
      if (id) exchangeCounts[id] = (exchangeCounts[id] || 0) + 1;
    });
  });

  const inviteCounts = {};
  invites.forEach(i => {
    if (i.status === 'redeemed' && i.created_by) {
      inviteCounts[i.created_by] = (inviteCounts[i.created_by] || 0) + 1;
    }
  });

  const feedbackCounts = {};
  feedback.forEach(f => {
    if (f.author_id) feedbackCounts[f.author_id] = (feedbackCounts[f.author_id] || 0) + 1;
  });

  return { members, listingCounts, exchangeCounts, inviteCounts, feedbackCounts };
}

function calculateEngagementScore(member, listingCount, exchangeCount, inviteCount, feedbackCount) {
  // Grace period: members accepted < 30 days ago get neutral score
  const daysSinceAccepted = member.accepted_at
    ? Math.floor((Date.now() - new Date(member.accepted_at).getTime()) / 86400000)
    : 999;
  if (daysSinceAccepted < 30) {
    return { score: 50, tier: 'New', graceperiod: true };
  }

  let score = 0;

  // Exchanges completed (max 25 pts)
  const exchanges = member.exchanges_completed || 0;
  score += Math.min(exchanges * 8, 25);

  // Listings posted (max 20 pts)
  score += Math.min(listingCount * 5, 20);

  // Proposals / exchange participation (max 15 pts)
  score += Math.min(exchangeCount * 3, 15);

  // Login recency (max 20 pts)
  if (member.last_seen_at) {
    const daysSinceSeen = Math.floor((Date.now() - new Date(member.last_seen_at).getTime()) / 86400000);
    if (daysSinceSeen <= 7) score += 20;
    else if (daysSinceSeen <= 14) score += 15;
    else if (daysSinceSeen <= 30) score += 10;
    else if (daysSinceSeen <= 60) score += 5;
  }

  // Profile completeness (max 10 pts)
  let profilePts = 0;
  if (member.bio && member.bio.trim().length > 0) profilePts += 4;
  if (member.skill_tags && member.skill_tags.length > 0) profilePts += 3;
  if (member.area) profilePts += 3;
  score += profilePts;

  // Invites that led to active members (max 5 pts)
  score += Math.min(inviteCount * 2, 5);

  // Feedback implemented — suggestions that led to code changes (max 5 pts)
  score += Math.min((feedbackCount || 0), 5);

  score = Math.min(score, 100);

  const tier = score >= 40 ? 'Active' : score >= 20 ? 'Quiet' : score >= 1 ? 'Dormant' : 'Inactive';
  return { score, tier, graceperiod: false };
}

// =====================================================
// ECOSYSTEM HEALTH (computed from real data)
// =====================================================

async function getEcosystemHealthData() {
  const listings = await getActiveListings();
  const members = await getAcceptedMembers();

  const supplyCounts = {};
  const demandCounts = {};

  // Count active offers (supply) and needs (demand) per category
  listings.forEach(listing => {
    if (listing.type === 'offer') {
      supplyCounts[listing.category] = (supplyCounts[listing.category] || 0) + 1;
    } else {
      demandCounts[listing.category] = (demandCounts[listing.category] || 0) + 1;
    }
  });

  // Also count member primary categories as potential supply
  members.forEach(member => {
    if (member.primary_category) {
      supplyCounts[member.primary_category] = (supplyCounts[member.primary_category] || 0) + 1;
    }
  });

  return { supplyCounts, demandCounts, totalListings: listings.length, totalMembers: members.length };
}

function getShortageCategories(health) {
  const shortages = [];
  const allCategories = Object.keys({ ...health.supplyCounts, ...health.demandCounts });
  allCategories.forEach(cat => {
    const supply = health.supplyCounts[cat] || 0;
    const demand = health.demandCounts[cat] || 0;
    if (demand - supply >= 2) {
      shortages.push(cat);
    }
  });
  return shortages;
}

// =====================================================
// HELPERS
// =====================================================

// Categories (same as before)
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

const HIGH_RISK_CATEGORIES = ['care_support', 'home_property', 'tools_things'];

const AREA_OPTIONS = [
  { id: 'neighbourhood', label: 'My neighbourhood', description: 'Walking distance' },
  { id: 'village', label: 'My village', description: 'Local area' },
  { id: 'nearby', label: 'Nearby (within 10km)', description: 'Short drive' }
];

function getCategoryById(id) {
  return CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
}

function isHighRiskCategory(categoryId) {
  return HIGH_RISK_CATEGORIES.includes(categoryId);
}

function calculateReliabilityBand(exchangesCompleted, disputesCount) {
  if (exchangesCompleted >= 10 && disputesCount === 0) return 'High';
  if (exchangesCompleted >= 3 && disputesCount <= 1) return 'Medium';
  return 'Low';
}

function getReliabilityTooltip(band) {
  const tips = {
    Low: 'New or fewer than 3 exchanges completed',
    Medium: '3+ exchanges completed',
    High: '10+ exchanges completed with no disputes'
  };
  return tips[band] || '';
}

function formatDate(isoDate) {
  if (!isoDate) return '—';
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatRelativeTime(isoDate) {
  if (!isoDate) return '';
  const now = new Date();
  const date = new Date(isoDate);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return diffMins + 'm ago';
  if (diffHours < 24) return diffHours + 'h ago';
  if (diffDays < 7) return diffDays + 'd ago';
  return formatDate(isoDate);
}

function showToast(message, duration = 3000) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #333; color: white; padding: 14px 24px; border-radius: 8px;
      font-size: 15px; z-index: 10000; opacity: 0; transition: opacity 0.3s;
      max-width: 90%; text-align: center;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

function generateInviteLink(token) {
  return window.location.origin + '/access.html#token=' + token;
}

// =====================================================
// INVITE CHAIN / DEGREES OF SEPARATION
// =====================================================

/**
 * Walk invited_by chains to find shortest path between two members.
 * Returns integer (0 = self, 1 = direct invite, 2 = two steps, etc.) or -1 if not connected.
 * Uses BFS on the undirected invite graph.
 */
function getDegreesFromUser(allMembers, fromId, toId) {
  if (fromId === toId) return 0;

  // Build adjacency list (undirected: inviter <-> invitee)
  const adj = {};
  allMembers.forEach(m => {
    if (!adj[m.id]) adj[m.id] = [];
    if (m.invited_by) {
      if (!adj[m.invited_by]) adj[m.invited_by] = [];
      adj[m.id].push(m.invited_by);
      adj[m.invited_by].push(m.id);
    }
  });

  // BFS from fromId
  const visited = new Set([fromId]);
  const queue = [[fromId, 0]];
  while (queue.length > 0) {
    const [current, depth] = queue.shift();
    for (const neighbour of (adj[current] || [])) {
      if (neighbour === toId) return depth + 1;
      if (!visited.has(neighbour)) {
        visited.add(neighbour);
        queue.push([neighbour, depth + 1]);
      }
    }
  }
  return -1; // not connected
}

// =====================================================
// COMMUNITY EVENTS
// =====================================================

async function getUpcomingEvents() {
  const sb = getSupabase();
  const now = new Date().toISOString();
  // Fetch upcoming one-off events AND all recurring events (expansion happens client-side)
  const { data, error } = await sb
    .from('events')
    .select(`
      *,
      organiser:members!events_organiser_id_fkey (id, display_name, member_id),
      attendees:event_attendees (member_id)
    `)
    .or(`starts_at.gte.${now},recurrence.neq.none`)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function createEvent(eventData) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('events')
    .insert(eventData)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function rsvpEvent(eventId, memberId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('event_attendees')
    .insert({ event_id: eventId, member_id: memberId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function cancelRsvp(eventId, memberId) {
  const sb = getSupabase();
  const { error } = await sb
    .from('event_attendees')
    .delete()
    .eq('event_id', eventId)
    .eq('member_id', memberId);
  if (error) throw error;
}

// =====================================================
// TRUSTED TRADES
// =====================================================

async function getTrades() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('trusted_trades')
    .select(`
      *,
      added_by_member:members (id, display_name, member_id),
      endorsements:trade_endorsements (
        id, member_id, note, not_recommended, created_at,
        member:members (id, display_name, member_id)
      )
    `)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createTrade(tradeData) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('trusted_trades')
    .insert(tradeData)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function endorseTrade(endorsementData) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('trade_endorsements')
    .upsert(endorsementData, { onConflict: 'trade_id,member_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function removeEndorsement(tradeId, memberId) {
  const sb = getSupabase();
  const { error } = await sb
    .from('trade_endorsements')
    .delete()
    .eq('trade_id', tradeId)
    .eq('member_id', memberId);
  if (error) throw error;
}

async function removeTrade(tradeId) {
  const sb = getSupabase();
  const { error } = await sb
    .from('trusted_trades')
    .delete()
    .eq('id', tradeId);
  if (error) throw error;
}

// =====================================================
// COMMUNITY GOVERNANCE
// =====================================================

const COMMUNITY_SETTINGS = {
  MEMBER_CAP: 80,
  BASE_INVITE_LIMIT: 2,
  INVITE_PER_EXCHANGE: 1,
  EXCHANGE_THRESHOLD: 3,
  MAX_INVITE_LIMIT: 5
};

function getInviteAllowance(member, inviteCount) {
  const base = COMMUNITY_SETTINGS.BASE_INVITE_LIMIT;
  const bonus = Math.floor((member.exchanges_completed || 0) / COMMUNITY_SETTINGS.EXCHANGE_THRESHOLD) * COMMUNITY_SETTINGS.INVITE_PER_EXCHANGE;
  const limit = Math.min(base + bonus, COMMUNITY_SETTINGS.MAX_INVITE_LIMIT);
  return { limit, used: inviteCount, remaining: Math.max(0, limit - inviteCount) };
}

function getSkillCoverageData(members) {
  const coverage = {};
  CATEGORIES.forEach(c => { coverage[c.id] = { count: 0, members: [] }; });
  members.forEach(m => {
    if (m.primary_category && coverage[m.primary_category]) {
      coverage[m.primary_category].count++;
      coverage[m.primary_category].members.push(m.display_name);
    }
  });
  const total = members.length || 1;
  const gaps = [];
  const concentrations = [];
  Object.entries(coverage).forEach(([catId, data]) => {
    if (data.count <= 1) gaps.push(catId);
    if (data.count / total > 0.3) concentrations.push(catId);
  });
  return { coverage, gaps, concentrations, total };
}

/**
 * Build invite tree from flat members array.
 * Returns array of root nodes, each with { member, children[] }.
 */
function buildInviteTree(allMembers) {
  const memberMap = {};
  allMembers.forEach(m => { memberMap[m.id] = { member: m, children: [] }; });

  const roots = [];
  allMembers.forEach(m => {
    if (m.invited_by && memberMap[m.invited_by]) {
      memberMap[m.invited_by].children.push(memberMap[m.id]);
    } else {
      roots.push(memberMap[m.id]);
    }
  });

  return roots;
}
