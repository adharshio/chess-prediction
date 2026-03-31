// Fetches live results from the official FIDE Candidates 2026 pairings page
// candidates2026.fide.com/pairings — updated in real time by FIDE

function isAuthorized(req) {
  const token = req.headers['x-admin-token']
  return token && token === process.env.ADMIN_PASSWORD
}

// Normalise player name for fuzzy matching
// Handles "Praggnanandhaa R" vs "R Praggnanandhaa", "Blübaum" vs "Bluebaum" etc.
function normaliseName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents: ü→u, é→e
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .sort()  // sort tokens so "R Praggnanandhaa" == "Praggnanandhaa R"
    .join(' ')
}

function namesMatch(a, b) {
  const na = normaliseName(a)
  const nb = normaliseName(b)
  if (na === nb) return true
  // Check if one contains all tokens of the other (handles partial names)
  const ta = na.split(' ')
  const tb = nb.split(' ')
  return ta.every(t => nb.includes(t)) || tb.every(t => na.includes(t))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' })

  const { round_number, games } = req.body
  if (!round_number || !games?.length) {
    return res.status(400).json({ error: 'round_number and games are required' })
  }

  try {
    // Fetch the FIDE official pairings page
    const response = await fetch('https://candidates2026.fide.com/pairings', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; chess-prediction-bot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      return res.status(502).json({ error: `FIDE site returned ${response.status}` })
    }

    const html = await response.text()

    // Parse results from the HTML text content
    // The page contains lines like:
    //   "Javokhir Sindarov 1—0 Andrey Esipenko"
    //   "Matthias Bluebaum ½—½ Wei Yi"
    //   "Praggnanandhaa R 0—1 Javokhir Sindarov"
    // Result symbols used: 1—0  ½—½  0—1  and sometimes 1-0  ½-½  0-1

    // Normalise all dash variants to standard hyphen
    const normalised = html
      .replace(/\u2014/g, '-') // em dash
      .replace(/\u2013/g, '-') // en dash
      .replace(/\u00bd/g, '½') // ½ unicode

    // Extract all result lines with pattern: PlayerName RESULT PlayerName
    // Result can be: 1-0, 0-1, ½-½, 1/2-1/2
    const resultPattern = /([A-Za-záéíóúàèìòùäëïöüñçæøåβ\s\.\-]+?)\s+(1-0|0-1|½-½|1\/2-1\/2|½—½|1—0|0—1)\s+([A-Za-záéíóúàèìòùäëïöüñçæøåβ\s\.\-]+?)(?=\n|<|$)/g

    const found = []
    let match
    while ((match = resultPattern.exec(normalised)) !== null) {
      const white = match[1].trim()
      const rawResult = match[2].trim()
      const black = match[3].trim()

      // Skip very short names (likely noise)
      if (white.length < 3 || black.length < 3) continue

      let result
      if (rawResult === '1-0' || rawResult === '1—0') result = 'white'
      else if (rawResult === '0-1' || rawResult === '0—1') result = 'black'
      else result = 'draw'

      found.push({ white, black, result })
    }

    // Match parsed results against the games in our DB for this round
    const matched = games.map(game => {
      const hit = found.find(f =>
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
      // Pass back a note if we found fewer results than expected
      note: foundCount === 0
        ? 'No results found yet — games may still be in progress, or the page format may have changed.'
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
