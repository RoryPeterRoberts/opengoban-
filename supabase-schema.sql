-- =====================================================
-- COMMUNITY CONNECT — SUPABASE DATABASE SCHEMA
-- =====================================================
-- Run this in Supabase SQL Editor to set up the database.
-- =====================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TABLES
-- =====================================================

-- Members: community participants
CREATE TABLE members (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id               uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email                 text UNIQUE NOT NULL,
  display_name          text NOT NULL,
  member_id             text UNIQUE NOT NULL,  -- CC-0001 format
  primary_category      text,
  secondary_categories  text[] DEFAULT '{}',
  skill_tags            text[] DEFAULT '{}',
  availability          text,
  area                  text DEFAULT 'village',
  bio                   text,
  invited_by            uuid REFERENCES members(id),
  status                text DEFAULT 'PENDING_PROFILE' CHECK (status IN ('PENDING_PROFILE', 'REVIEW', 'ACCEPTED', 'HOLD', 'SUSPENDED')),
  role                  text DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
  exchanges_completed   integer DEFAULT 0,
  disputes_count        integer DEFAULT 0,
  created_at            timestamptz DEFAULT now(),
  accepted_at           timestamptz,
  terms_accepted_at     timestamptz,
  terms_version         text
);

-- Sequence for member IDs
CREATE SEQUENCE member_id_seq START 1;

-- Function to generate member ID
CREATE OR REPLACE FUNCTION generate_member_id()
RETURNS text AS $$
BEGIN
  RETURN 'CC-' || LPAD(nextval('member_id_seq')::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- Listings: offers and needs
CREATE TABLE listings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       uuid REFERENCES members(id) NOT NULL,
  type            text NOT NULL CHECK (type IN ('offer', 'need')),
  category        text NOT NULL,
  title           text NOT NULL,
  description     text,
  tags            text[] DEFAULT '{}',
  area            text DEFAULT 'village',
  urgency         text DEFAULT 'This week',
  location        text,
  travel_needed   boolean DEFAULT false,
  status          text DEFAULT 'active' CHECK (status IN ('active', 'matched', 'completed', 'expired', 'cancelled')),
  visibility      text DEFAULT 'public' CHECK (visibility IN ('public', 'invitees_only')),
  created_at      timestamptz DEFAULT now(),
  expires_at      timestamptz DEFAULT (now() + interval '30 days')
);

-- Exchanges: the ledger of actual transactions
CREATE TABLE exchanges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id          uuid REFERENCES listings(id),
  provider_id         uuid REFERENCES members(id) NOT NULL,
  receiver_id         uuid REFERENCES members(id) NOT NULL,
  credits             integer NOT NULL DEFAULT 1 CHECK (credits > 0),
  description         text NOT NULL,
  category            text NOT NULL,
  status              text DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'completed', 'disputed', 'cancelled')),
  proposed_by         uuid REFERENCES members(id) NOT NULL,
  proposed_at         timestamptz DEFAULT now(),
  accepted_at         timestamptz,
  completed_at        timestamptz,
  witness_id          uuid REFERENCES members(id),
  witness_at          timestamptz,
  provider_confirmed  boolean DEFAULT false,
  receiver_confirmed  boolean DEFAULT false,
  notes               text,
  CONSTRAINT different_parties CHECK (provider_id != receiver_id)
);

-- Balances: cached credit totals per member
CREATE TABLE balances (
  member_id     uuid PRIMARY KEY REFERENCES members(id),
  credits       integer DEFAULT 5,
  total_earned  integer DEFAULT 0,
  total_spent   integer DEFAULT 0,
  updated_at    timestamptz DEFAULT now()
);

-- Balance history: audit trail of all credit movements
CREATE TABLE balance_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid REFERENCES members(id) NOT NULL,
  exchange_id   uuid REFERENCES exchanges(id),
  amount        integer NOT NULL,
  reason        text NOT NULL,
  type          text NOT NULL CHECK (type IN ('earned', 'spent', 'welcome_bonus', 'adjustment')),
  balance_after integer NOT NULL,
  created_at    timestamptz DEFAULT now()
);

-- Feedback: user feedback on the platform
CREATE TABLE feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     uuid REFERENCES members(id) NOT NULL,
  type          text NOT NULL CHECK (type IN ('bug', 'idea', 'question', 'other')),
  message       text NOT NULL,
  status        text DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'actioned', 'declined')),
  priority      text,
  admin_notes   text,
  created_at    timestamptz DEFAULT now()
);

-- Audit log: governance transparency
CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text NOT NULL,
  actor_id      uuid REFERENCES members(id),
  actor_name    text NOT NULL,
  description   text NOT NULL,
  details       text,
  created_at    timestamptz DEFAULT now()
);

-- Invites: tracking who invited whom
CREATE TABLE invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token         text UNIQUE NOT NULL,
  created_by    uuid REFERENCES members(id) NOT NULL,
  invitee_name  text,
  invitee_email text,
  note          text,
  status        text DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'expired')),
  redeemed_by   uuid REFERENCES members(id),
  created_at    timestamptz DEFAULT now(),
  redeemed_at   timestamptz
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_members_auth_id ON members(auth_id);
CREATE INDEX idx_members_email ON members(email);
CREATE INDEX idx_members_status ON members(status);
CREATE INDEX idx_listings_author ON listings(author_id);
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_type ON listings(type);
CREATE INDEX idx_listings_category ON listings(category);
CREATE INDEX idx_listings_created ON listings(created_at DESC);
CREATE INDEX idx_exchanges_provider ON exchanges(provider_id);
CREATE INDEX idx_exchanges_receiver ON exchanges(receiver_id);
CREATE INDEX idx_exchanges_status ON exchanges(status);
CREATE INDEX idx_exchanges_listing ON exchanges(listing_id);
CREATE INDEX idx_balance_history_member ON balance_history(member_id);
CREATE INDEX idx_feedback_status ON feedback(status);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX idx_invites_token ON invites(token);
CREATE INDEX idx_invites_created_by ON invites(created_by);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Complete an exchange: transfer credits between members
CREATE OR REPLACE FUNCTION complete_exchange(exchange_uuid uuid)
RETURNS void AS $$
DECLARE
  ex exchanges%ROWTYPE;
  provider_balance integer;
  receiver_balance integer;
BEGIN
  -- Get exchange
  SELECT * INTO ex FROM exchanges WHERE id = exchange_uuid;

  IF ex IS NULL THEN
    RAISE EXCEPTION 'Exchange not found';
  END IF;

  IF ex.status != 'accepted' THEN
    RAISE EXCEPTION 'Exchange must be in accepted status to complete';
  END IF;

  IF NOT ex.provider_confirmed OR NOT ex.receiver_confirmed THEN
    RAISE EXCEPTION 'Both parties must confirm before completing';
  END IF;

  -- Check receiver has enough credits (debt floor: -10)
  SELECT credits INTO receiver_balance FROM balances WHERE member_id = ex.receiver_id;
  IF receiver_balance IS NULL THEN
    receiver_balance := 5; -- default
  END IF;

  IF receiver_balance - ex.credits < -10 THEN
    RAISE EXCEPTION 'Receiver would exceed debt floor (-10 credits)';
  END IF;

  -- Check provider won't exceed max (+50)
  SELECT credits INTO provider_balance FROM balances WHERE member_id = ex.provider_id;
  IF provider_balance IS NULL THEN
    provider_balance := 5;
  END IF;

  IF provider_balance + ex.credits > 50 THEN
    RAISE EXCEPTION 'Provider would exceed maximum balance (50 credits)';
  END IF;

  -- Update exchange status
  UPDATE exchanges
  SET status = 'completed', completed_at = now()
  WHERE id = exchange_uuid;

  -- Credit the provider
  INSERT INTO balances (member_id, credits, total_earned, updated_at)
  VALUES (ex.provider_id, 5 + ex.credits, ex.credits, now())
  ON CONFLICT (member_id) DO UPDATE
  SET credits = balances.credits + ex.credits,
      total_earned = balances.total_earned + ex.credits,
      updated_at = now();

  -- Debit the receiver
  INSERT INTO balances (member_id, credits, total_spent, updated_at)
  VALUES (ex.receiver_id, 5 - ex.credits, ex.credits, now())
  ON CONFLICT (member_id) DO UPDATE
  SET credits = balances.credits - ex.credits,
      total_spent = balances.total_spent + ex.credits,
      updated_at = now();

  -- Get updated balances for history
  SELECT credits INTO provider_balance FROM balances WHERE member_id = ex.provider_id;
  SELECT credits INTO receiver_balance FROM balances WHERE member_id = ex.receiver_id;

  -- Record balance history
  INSERT INTO balance_history (member_id, exchange_id, amount, reason, type, balance_after)
  VALUES (ex.provider_id, exchange_uuid, ex.credits, ex.description, 'earned', provider_balance);

  INSERT INTO balance_history (member_id, exchange_id, amount, reason, type, balance_after)
  VALUES (ex.receiver_id, exchange_uuid, -ex.credits, ex.description, 'spent', receiver_balance);

  -- Update member exchange counts
  UPDATE members SET exchanges_completed = exchanges_completed + 1 WHERE id = ex.provider_id;
  UPDATE members SET exchanges_completed = exchanges_completed + 1 WHERE id = ex.receiver_id;

  -- Audit log
  INSERT INTO audit_log (action, actor_id, actor_name, description, details)
  VALUES (
    'exchange_completed',
    ex.provider_id,
    (SELECT display_name FROM members WHERE id = ex.provider_id),
    'Exchange completed: ' || ex.description,
    'Credits: ' || ex.credits || ' from ' ||
    (SELECT member_id FROM members WHERE id = ex.receiver_id) || ' to ' ||
    (SELECT member_id FROM members WHERE id = ex.provider_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Initialize balance for new member (welcome bonus)
CREATE OR REPLACE FUNCTION init_member_balance()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'ACCEPTED' AND (OLD IS NULL OR OLD.status != 'ACCEPTED') THEN
    INSERT INTO balances (member_id, credits, total_earned, total_spent)
    VALUES (NEW.id, 5, 0, 0)
    ON CONFLICT (member_id) DO NOTHING;

    INSERT INTO balance_history (member_id, amount, reason, type, balance_after)
    VALUES (NEW.id, 5, 'Welcome bonus for joining Community Connect', 'welcome_bonus', 5);

    INSERT INTO audit_log (action, actor_id, actor_name, description)
    VALUES ('member_accepted', NEW.id, NEW.display_name, 'New member accepted: ' || NEW.display_name || ' (' || NEW.member_id || ')');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_member_accepted
  AFTER INSERT OR UPDATE ON members
  FOR EACH ROW
  EXECUTE FUNCTION init_member_balance();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

-- Members: all accepted members can see each other
CREATE POLICY "Members are viewable by authenticated users"
  ON members FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Members can update own profile"
  ON members FOR UPDATE
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

CREATE POLICY "New members can be inserted via invite"
  ON members FOR INSERT
  WITH CHECK (true);  -- Controlled by application logic

-- Listings: visible to all authenticated users
CREATE POLICY "Listings are viewable by authenticated users"
  ON listings FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Members can create listings"
  ON listings FOR INSERT
  WITH CHECK (
    author_id IN (SELECT id FROM members WHERE auth_id = auth.uid())
  );

CREATE POLICY "Authors can update own listings"
  ON listings FOR UPDATE
  USING (
    author_id IN (SELECT id FROM members WHERE auth_id = auth.uid())
  );

-- Exchanges: visible to participants
CREATE POLICY "Exchange participants can view"
  ON exchanges FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      provider_id IN (SELECT id FROM members WHERE auth_id = auth.uid()) OR
      receiver_id IN (SELECT id FROM members WHERE auth_id = auth.uid()) OR
      witness_id IN (SELECT id FROM members WHERE auth_id = auth.uid()) OR
      EXISTS (SELECT 1 FROM members WHERE auth_id = auth.uid() AND role IN ('moderator', 'admin'))
    )
  );

CREATE POLICY "Members can create exchanges"
  ON exchanges FOR INSERT
  WITH CHECK (
    proposed_by IN (SELECT id FROM members WHERE auth_id = auth.uid())
  );

CREATE POLICY "Participants can update exchanges"
  ON exchanges FOR UPDATE
  USING (
    provider_id IN (SELECT id FROM members WHERE auth_id = auth.uid()) OR
    receiver_id IN (SELECT id FROM members WHERE auth_id = auth.uid())
  );

-- Balances: visible to all (transparency)
CREATE POLICY "Balances are viewable by authenticated users"
  ON balances FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Balance history: visible to the member themselves + admins
CREATE POLICY "Members can view own balance history"
  ON balance_history FOR SELECT
  USING (
    member_id IN (SELECT id FROM members WHERE auth_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM members WHERE auth_id = auth.uid() AND role IN ('moderator', 'admin'))
  );

-- Feedback: author can see own, admins can see all
CREATE POLICY "Feedback viewable by author and admins"
  ON feedback FOR SELECT
  USING (
    author_id IN (SELECT id FROM members WHERE auth_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM members WHERE auth_id = auth.uid() AND role IN ('moderator', 'admin'))
  );

CREATE POLICY "Members can create feedback"
  ON feedback FOR INSERT
  WITH CHECK (
    author_id IN (SELECT id FROM members WHERE auth_id = auth.uid())
  );

CREATE POLICY "Admins can update feedback"
  ON feedback FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM members WHERE auth_id = auth.uid() AND role IN ('moderator', 'admin'))
  );

-- Audit log: readable by all
CREATE POLICY "Audit log is viewable by authenticated users"
  ON audit_log FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Invites: creator can see their own
CREATE POLICY "Invite creators can view own invites"
  ON invites FOR SELECT
  USING (
    created_by IN (SELECT id FROM members WHERE auth_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM members WHERE auth_id = auth.uid() AND role IN ('moderator', 'admin'))
  );

CREATE POLICY "Members can create invites"
  ON invites FOR INSERT
  WITH CHECK (
    created_by IN (SELECT id FROM members WHERE auth_id = auth.uid())
  );

CREATE POLICY "Invites can be redeemed"
  ON invites FOR UPDATE
  WITH CHECK (true);  -- Controlled by application logic

-- Allow anonymous access to invites for redemption (by token)
CREATE POLICY "Anyone can look up invite by token"
  ON invites FOR SELECT
  USING (true);

-- Allow anonymous read of members for invite lookup
CREATE POLICY "Anonymous can check member existence"
  ON members FOR SELECT
  USING (true);
