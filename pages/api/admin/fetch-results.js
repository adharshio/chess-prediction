import { fetchFIDEResults, namesMatch } from '../../../lib/fideParser'

function isAuthorized(req) {
  const token = req.headers['x-admin-token']
  return token && token === process.env.ADMIN_PASSWORD
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const { round_number, games } = req.body
  if (!round_number || !games?.length) {
    return res.status(400).json({ error: 'round_number and games are required' })
  }

  try {
    const fideResults = await fetchFIDEResults()

    const matched = games.map(game => {
      const hit = fideResults.find(f =>
        namesMatch(f.white, game.white_player) &&
        namesMatch(f.black, game.black_player)
      )
      return {
        board_number: game.board_number,
        game_id: game.game_id,
        white_player: game.white_player,
        black_player: game.black_player,
        result: hit ? hit.result : null,
        found: !!hit,
      }
    })

    const foundCount = matched.filter(m => m.found).length

    return res.json({
      success: true,
      round_number,
      found_count: foundCount,
      total: games.length,
      results: matched,
      note: foundCount === 0
        ? 'No results found yet — games may still be in progress.'
        : foundCount < games.length
        ? `Found ${foundCount} of ${games.length} results. Remaining games may still be in progress.`
        : `All ${foundCount} results found.`,
    })

  } catch (err) {
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'FIDE site timed out. Try again in a moment.' })
    }
    console.error('Fetch results error:', err)
    return res.status(500).json({ error: err.message })
  }
}
