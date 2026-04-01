import { createClient } from '@supabase/supabase-js'
import { fetchFIDEResults, namesMatch } from '../../../lib/fideParser'

// This route is called automatically by Vercel Cron.
// It is also protected by CRON_SECRET so only Vercel can trigger it.
function isAuthorized(req) {
  const auth = req.headers['authorization']
  return auth === `Bearer ${process.env.CRON_SECRET}`
}

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const db = getAdmin()
  const log = [] // collect what we did for the response

  try {
    // 1. Find the current active round (not complete)
    const { data: activeRound } = await db
      .from('rounds')
      .select('*')
      .eq('is_complete', false)
      .order('round_number', { ascending: true })
      .limit(1)
      .single()

    if (!activeRound) {
      return res.json({ ok: true, message: 'No active round found', log })
    }

    log.push(`Active round: ${activeRound.round_number}`)

    // 2. Only run during round hours: between prediction_deadline and midnight+2h
    // Rounds start at ~15:30 Cyprus time (UTC+3). We fetch after games are likely done.
    // Games last ~6h max, so we stop fetching after 23:30 UTC (02:30 Cyprus next day)
    const now = new Date()
    const deadlinePassed = new Date(activeRound.prediction_deadline) < now
    const hourUTC = now.getUTCHours()

    // Only auto-fetch between 12:00 UTC and 23:30 UTC on round days
    // (covers 15:00–02:30 Cyprus time)
    if (!deadlinePassed || hourUTC < 12 || hourUTC >= 24) {
      return res.json({
        ok: true,
        message: `Outside fetch window (UTC hour: ${hourUTC}, deadline passed: ${deadlinePassed})`,
        log
      })
    }

    // 3. Load games for this round that don't have a result yet
    const { data: games } = await db
      .from('games')
      .select('*, white_player:chess_players!games_white_player_id_fkey(name), black_player:chess_players!games_black_player_id_fkey(name)')
      .eq('round_id', activeRound.id)
      .is('result', null) // only games without a result

    if (!games?.length) {
      log.push('All games already have results')
      // All 4 done — auto-mark round complete if not already
      const { data: allGames } = await db.from('games').select('result').eq('round_id', activeRound.id)
      const allDone = allGames?.every(g => g.result !== null)
      if (allDone) {
        await db.from('rounds').update({ is_complete: true }).eq('id', activeRound.id)
        log.push('Round auto-marked complete')
      }
      return res.json({ ok: true, message: 'All games already have results', log })
    }

    log.push(`Games without result: ${games.length}`)

    // 4. Fetch FIDE page
    const fideResults = await fetchFIDEResults()
    log.push(`FIDE results parsed: ${fideResults.length} completed games found on page`)

    // 5. Match and save new results
    let saved = 0
    for (const game of games) {
      const whiteName = game.white_player?.name || ''
      const blackName = game.black_player?.name || ''

      const hit = fideResults.find(f =>
        namesMatch(f.white, whiteName) && namesMatch(f.black, blackName)
      )

      if (!hit) {
        log.push(`  Board ${game.board_number}: ${whiteName} vs ${blackName} — not found yet`)
        continue
      }

      // Save result
      await db.from('games').update({ result: hit.result }).eq('id', game.id)

      // Score all predictions for this game
      const { data: preds } = await db
        .from('predictions')
        .select('id, prediction')
        .eq('game_id', game.id)

      if (preds?.length) {
        for (const p of preds) {
          const pts = p.prediction === hit.result ? (hit.result === 'draw' ? 1 : 4) : 0
          await db.from('predictions').update({ points_earned: pts }).eq('id', p.id)
        }
      }

      log.push(`  Board ${game.board_number}: ${whiteName} vs ${blackName} → ${hit.result} (scored ${preds?.length || 0} predictions)`)
      saved++
    }

    // 6. Check if all games now have results and auto-complete round
    if (saved > 0) {
      const { data: remaining } = await db
        .from('games')
        .select('result')
        .eq('round_id', activeRound.id)
        .is('result', null)

      if (!remaining?.length) {
        await db.from('rounds').update({ is_complete: true }).eq('id', activeRound.id)
        log.push(`Round ${activeRound.round_number} auto-marked complete — all 4 results in`)
      }
    }

    return res.json({
      ok: true,
      round: activeRound.round_number,
      saved,
      log,
    })

  } catch (err) {
    console.error('Cron error:', err)
    return res.status(500).json({ ok: false, error: err.message, log })
  }
}
