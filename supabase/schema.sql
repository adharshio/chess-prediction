-- =============================================
-- FIDE Candidates Prediction Contest Schema
-- Run this in your Supabase SQL Editor
-- =============================================

-- Participants (the people predicting)
CREATE TABLE participants (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chess players in the Candidates tournament
CREATE TABLE chess_players (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT,
  flag TEXT,
  display_order INT DEFAULT 0
);

-- Daily rounds (14 rounds, 4 games each)
CREATE TABLE rounds (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  round_number INT NOT NULL UNIQUE,
  round_date DATE NOT NULL,
  prediction_deadline TIMESTAMPTZ NOT NULL,
  is_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Games within each round (4 per round)
CREATE TABLE games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  round_id UUID REFERENCES rounds(id) ON DELETE CASCADE,
  board_number INT NOT NULL CHECK (board_number BETWEEN 1 AND 4),
  white_player_id UUID REFERENCES chess_players(id),
  black_player_id UUID REFERENCES chess_players(id),
  result TEXT CHECK (result IN ('white', 'black', 'draw', NULL)),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(round_id, board_number)
);

-- Predictions made by participants
CREATE TABLE predictions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  prediction TEXT NOT NULL CHECK (prediction IN ('white', 'black', 'draw')),
  points_earned INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(participant_id, game_id)
);

-- =============================================
-- Seed the 8 Candidates players
-- =============================================
INSERT INTO chess_players (name, country, flag, display_order) VALUES
  ('D. Gukesh', 'India', '🇮🇳', 1),
  ('Fabiano Caruana', 'USA', '🇺🇸', 2),
  ('Hikaru Nakamura', 'USA', '🇺🇸', 3),
  ('R. Praggnanandhaa', 'India', '🇮🇳', 4),
  ('Alireza Firouzja', 'France', '🇫🇷', 5),
  ('Ian Nepomniachtchi', 'Russia', '🏳️', 6),
  ('Vidit Gujrathi', 'India', '🇮🇳', 7),
  ('Nodirbek Abdusattorov', 'Uzbekistan', '🇺🇿', 8);

-- =============================================
-- Row Level Security (RLS)
-- =============================================
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chess_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;

-- Public can read everything
CREATE POLICY "public read participants" ON participants FOR SELECT USING (true);
CREATE POLICY "public read chess_players" ON chess_players FOR SELECT USING (true);
CREATE POLICY "public read rounds" ON rounds FOR SELECT USING (true);
CREATE POLICY "public read games" ON games FOR SELECT USING (true);
CREATE POLICY "public read predictions" ON predictions FOR SELECT USING (true);

-- Anyone can register as a participant
CREATE POLICY "public insert participants" ON participants FOR INSERT WITH CHECK (true);

-- Anyone can submit predictions (deadline enforced in app logic)
CREATE POLICY "public insert predictions" ON predictions FOR INSERT WITH CHECK (true);
CREATE POLICY "public update predictions" ON predictions FOR UPDATE USING (true);

-- Admin operations done via service role key (bypasses RLS)

-- =============================================
-- Useful view: leaderboard
-- =============================================
CREATE OR REPLACE VIEW leaderboard AS
SELECT
  p.id,
  p.name,
  p.email,
  COUNT(pr.id) AS total_predictions,
  COUNT(CASE WHEN pr.points_earned > 0 THEN 1 END) AS correct_predictions,
  COALESCE(SUM(pr.points_earned), 0) AS total_points,
  ROUND(
    COUNT(CASE WHEN pr.points_earned > 0 THEN 1 END)::NUMERIC /
    NULLIF(COUNT(pr.id), 0) * 100, 1
  ) AS accuracy_pct
FROM participants p
LEFT JOIN predictions pr ON pr.participant_id = p.id
GROUP BY p.id, p.name, p.email
ORDER BY total_points DESC, correct_predictions DESC;

-- =============================================
-- Useful view: round summary with scores
-- =============================================
CREATE OR REPLACE VIEW round_leaderboard AS
SELECT
  r.round_number,
  p.name AS participant_name,
  COALESCE(SUM(pr.points_earned), 0) AS round_points
FROM rounds r
CROSS JOIN participants p
LEFT JOIN games g ON g.round_id = r.id
LEFT JOIN predictions pr ON pr.game_id = g.id AND pr.participant_id = p.id
GROUP BY r.round_number, p.id, p.name
ORDER BY r.round_number, round_points DESC;
