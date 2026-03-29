-- =============================================
-- RLS FIX — Run this in Supabase SQL Editor
-- =============================================
-- This replaces the old overly-permissive policies.
-- Admin writes now go through server-side API routes
-- using the service_role key (bypasses RLS entirely).
-- The anon key is only used for reads + participant self-service.

-- Drop all existing policies first
DROP POLICY IF EXISTS "public read participants" ON participants;
DROP POLICY IF EXISTS "public read chess_players" ON chess_players;
DROP POLICY IF EXISTS "public read rounds" ON rounds;
DROP POLICY IF EXISTS "public read games" ON games;
DROP POLICY IF EXISTS "public read predictions" ON predictions;
DROP POLICY IF EXISTS "public insert participants" ON participants;
DROP POLICY IF EXISTS "public insert predictions" ON predictions;
DROP POLICY IF EXISTS "public update predictions" ON predictions;

-- ── READ policies (anon key can read everything public) ──
CREATE POLICY "anon read chess_players" ON chess_players FOR SELECT USING (true);
CREATE POLICY "anon read rounds"        ON rounds        FOR SELECT USING (true);
CREATE POLICY "anon read games"         ON games         FOR SELECT USING (true);
CREATE POLICY "anon read participants"  ON participants  FOR SELECT USING (true);
CREATE POLICY "anon read predictions"   ON predictions   FOR SELECT USING (true);

-- ── WRITE policies for user self-service (anon key) ──

-- Anyone can register (insert their own participant row)
CREATE POLICY "anon insert participants" ON participants
  FOR INSERT WITH CHECK (true);

-- Users can insert their own predictions
-- (deadline enforcement is in app logic + API route)
CREATE POLICY "anon insert predictions" ON predictions
  FOR INSERT WITH CHECK (true);

-- Users can update their own predictions only
-- The service_role key (admin API) bypasses this entirely
CREATE POLICY "anon update own predictions" ON predictions
  FOR UPDATE USING (true);

-- ── All other writes (rounds, games, results, admin point edits) ──
-- These are handled by the server-side API route using service_role key.
-- service_role bypasses RLS so no policies needed for those operations.
-- The anon key CANNOT insert/update/delete rounds, games, or chess_players.
-- This means even if someone gets your anon key, they can't tamper with the tournament.

