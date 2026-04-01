// Shared utilities for fetching and parsing the FIDE pairings page

export function normaliseName(name) {
  const stripped = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
  const collapsed = stripped
    .replace(/ue/g, 'u')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
  return collapsed.split(/\s+/).sort().join(' ')
}

export function namesMatch(a, b) {
  const na = normaliseName(a)
  const nb = normaliseName(b)
  if (na === nb) return true
  const ta = na.split(' ')
  const tb = nb.split(' ')
  return ta.every(t => nb.includes(t)) || tb.every(t => na.includes(t))
}

// Fetch and parse all completed results from the FIDE pairings page.
// Returns array of { white, black, result } for every game with a result.
export async function fetchFIDEResults() {
  const response = await fetch('https://candidates2026.fide.com/pairings', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; chess-prediction-bot/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(12000),
  })

  if (!response.ok) throw new Error(`FIDE site returned ${response.status}`)

  const html = await response.text()

  // Normalise dash variants
  const normalised = html
    .replace(/\u2014/g, '-') // em dash
    .replace(/\u2013/g, '-') // en dash
    .replace(/\u00bd/g, '½')

  const resultPattern = /([A-Za-záéíóúàèìòùäëïöüñçæøåβ\s.\-]+?)\s+(1-0|0-1|½-½|1\/2-1\/2)\s+([A-Za-záéíóúàèìòùäëïöüñçæøåβ\s.\-]+?)(?=\n|<|$)/g

  const found = []
  let match
  while ((match = resultPattern.exec(normalised)) !== null) {
    const white = match[1].trim()
    const rawResult = match[2].trim()
    const black = match[3].trim()
    if (white.length < 3 || black.length < 3) continue

    let result
    if (rawResult === '1-0') result = 'white'
    else if (rawResult === '0-1') result = 'black'
    else result = 'draw'

    found.push({ white, black, result })
  }

  return found
}
