import { createClient } from '@supabase/supabase-js'

// This runs SERVER-SIDE only — the service role key is never exposed to the browser.
// The service_role key bypasses RLS completely, so admin can do anything.
function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

// Verify the admin password before allowing any operation
function isAuthorized(req) {
  const token = req.headers['x-admin-token']
  return token && token === process.env.ADMIN_PASSWORD
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const db = getAdmin()
  const { action, payload } = req.body || {}

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    switch (action) {

      case 'ping':
        return res.json({ ok: true })


      // ── Rounds ──
      case 'createRound': {
        const { round_number, round_date, prediction_deadline, boards } = payload
        const { data: round, error } = await db.from('rounds').insert({
          round_number, round_date, prediction_deadline,
        }).select().single()
        if (error) throw error
        const { error: gErr } = await db.from('games').insert(
          boards.map(b => ({ round_id: round.id, board_number: b.board_number, white_player_id: b.white_player_id, black_player_id: b.black_player_id }))
        )
        if (gErr) throw gErr
        return res.json({ success: true, round })
      }

      case 'updateRound': {
        const { id, round_date, prediction_deadline, boards } = payload
        const { error } = await db.from('rounds').update({ round_date, prediction_deadline }).eq('id', id)
        if (error) throw error
        for (const b of boards) {
          if (!b.game_id) continue
          const { error: gErr } = await db.from('games').update({ white_player_id: b.white_player_id, black_player_id: b.black_player_id }).eq('id', b.game_id)
          if (gErr) throw gErr
        }
        return res.json({ success: true })
      }

      case 'deleteRound': {
        const { id, gameIds } = payload
        if (gameIds?.length) {
          await db.from('predictions').delete().in('game_id', gameIds)
          await db.from('games').delete().in('id', gameIds)
        }
        await db.from('rounds').delete().eq('id', id)
        return res.json({ success: true })
      }

      case 'markRoundComplete': {
        const { id, complete } = payload
        await db.from('rounds').update({ is_complete: complete }).eq('id', id)
        return res.json({ success: true })
      }

      // ── Results & scoring ──
      case 'setResult': {
        const { gameId, result } = payload
        const { error } = await db.from('games').update({ result }).eq('id', gameId)
        if (error) throw error
        // Re-score all predictions for this game
        const { data: preds } = await db.from('predictions').select('id, prediction').eq('game_id', gameId)
        if (preds?.length) {
          for (const p of preds) {
            const pts = p.prediction === result ? (result === 'draw' ? 1 : 4) : 0
            await db.from('predictions').update({ points_earned: pts }).eq('id', p.id)
          }
        }
        return res.json({ success: true })
      }

      case 'clearResult': {
        const { gameId } = payload
        await db.from('games').update({ result: null }).eq('id', gameId)
        await db.from('predictions').update({ points_earned: 0 }).eq('game_id', gameId)
        return res.json({ success: true })
      }

      case 'rescoreRound': {
        const { games } = payload // array of { id, result }
        for (const game of games) {
          if (!game.result) continue
          const { data: preds } = await db.from('predictions').select('id, prediction').eq('game_id', game.id)
          if (preds?.length) {
            for (const p of preds) {
              const pts = p.prediction === game.result ? (game.result === 'draw' ? 1 : 4) : 0
              await db.from('predictions').update({ points_earned: pts }).eq('id', p.id)
            }
          }
        }
        return res.json({ success: true })
      }

      // ── Points adjustments ──
      case 'updatePredictionPoints': {
        const { updates } = payload // array of { id, points_earned }
        for (const u of updates) {
          await db.from('predictions').update({ points_earned: u.points_earned }).eq('id', u.id)
        }
        return res.json({ success: true })
      }

      case 'applyBonus': {
        const { participantId, points } = payload
        // Get first prediction to apply bonus to
        const { data: preds } = await db.from('predictions').select('id, points_earned').eq('participant_id', participantId).order('created_at').limit(1)
        if (!preds?.length) throw new Error('No predictions found for this participant')
        const first = preds[0]
        const newPts = Math.max(0, (first.points_earned || 0) + points)
        await db.from('predictions').update({ points_earned: newPts }).eq('id', first.id)
        return res.json({ success: true })
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` })
    }
  } catch (err) {
    console.error('Admin API error:', err)
    return res.status(500).json({ error: err.message })
  }
}
