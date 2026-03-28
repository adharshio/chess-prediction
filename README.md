# ♟ FIDE Candidates 2026 — Prediction Contest

A web app for running a chess prediction contest across 14 rounds.
Participants predict results of 4 boards per day. Draws = 1pt, correct wins = 3pts.

---

## What's included

| Page | URL | Who uses it |
|------|-----|-------------|
| Predict | `/` | All participants — submit daily predictions |
| Leaderboard | `/leaderboard` | Everyone — live standings |
| Rounds | `/rounds` | Everyone — schedule & results |
| Admin | `/admin` | You only — create rounds, enter results |

---

## Deployment (takes ~20 minutes)

### Step 1 — Set up Supabase (free database)

1. Go to [supabase.com](https://supabase.com) → **Start your project** → Sign in with GitHub
2. Click **New Project** → name it `chess-predictions` → set a DB password → choose nearest region
3. Wait ~2 minutes for project to be ready
4. Go to **SQL Editor** (left sidebar) → **New query**
5. Copy and paste the entire contents of `supabase/schema.sql`
6. Click **Run** — this creates all tables and seeds the 8 candidates

7. Go to **Settings → API** and copy:
   - **Project URL** (looks like `https://abcxyz.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)
   - **service_role** key (another long string — keep this secret!)

---

### Step 2 — Deploy to Vercel (free hosting)

**Option A — Via GitHub (recommended)**

1. Push this folder to a GitHub repo:
   ```bash
   git init
   git add .
   git commit -m "initial"
   gh repo create chess-predictions --public --push
   ```

2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import your GitHub repo

3. In **Environment Variables**, add these 4 values:
   ```
   NEXT_PUBLIC_SUPABASE_URL       = https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY  = eyJ...your anon key...
   SUPABASE_SERVICE_ROLE_KEY      = eyJ...your service role key...
   NEXT_PUBLIC_ADMIN_PASSWORD     = choose_a_strong_password
   ```

4. Click **Deploy** — done! You get a URL like `chess-predictions.vercel.app`

**Option B — Via Vercel CLI**

```bash
npm install -g vercel
cd chess-predictions
cp .env.example .env.local
# Edit .env.local with your values
vercel --prod
# It will ask you to log in and configure — follow the prompts
```

---

### Step 3 — Set up rounds before the tournament

1. Visit `your-site.vercel.app/admin`
2. Enter your admin password (the one you set in env vars)
3. Go to **Rounds** tab → create all 14 rounds with:
   - Round number (1–14)
   - Date of the round
   - Prediction deadline (set to ~30 min before round starts, e.g. 14:30 if round starts at 15:00)
   - The 4 board pairings for that day

**Tip**: You can create all 14 rounds on day 1 if you have the full schedule, or add them day by day.

---

### Step 4 — Daily routine during the tournament

**Before each round** (automatic):
- Predictions auto-lock at the deadline you set

**After each round** (you do this):
1. Go to `/admin` → **Results** tab
2. Find the round → click `1-0`, `½-½`, or `0-1` for each board
3. Scores are calculated and leaderboard updates instantly
4. Click **Mark complete** on the round
5. Share the leaderboard link with your group!

---

## Sharing with participants

Send your friends this message:

> 🏆 Join our FIDE Candidates 2026 prediction contest!
> 
> Visit: **chess-predictions.vercel.app**
> 
> Register with your name + email, predict the 4 daily boards, and climb the leaderboard over 14 rounds!
> 
> Correct draw = 1 point, correct win = 3 points.
> Predictions lock before each round starts.

---

## Scoring rules (implemented in code)

| Prediction | Actual result | Points |
|-----------|---------------|--------|
| White wins | White wins | **3** |
| Black wins | Black wins | **3** |
| Draw | Draw | **1** |
| Anything | Wrong | **0** |

---

## Tech stack

- **Next.js 14** — React framework
- **Supabase** — Postgres database + auth
- **Vercel** — hosting (free tier is plenty for 30 users)
- No other dependencies needed

---

## Troubleshooting

**"Cannot read properties of null"** — Check your Supabase URL and anon key in env vars.

**Admin panel shows wrong password** — Make sure `NEXT_PUBLIC_ADMIN_PASSWORD` is set in Vercel env vars, then redeploy.

**Predictions not locking** — The deadline is stored in UTC in Supabase. When creating rounds, the datetime-local input uses your local time — this is fine, Vercel will convert correctly.

**Leaderboard empty** — Results need to be entered via the admin panel to trigger scoring.
