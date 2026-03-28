import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'
import { format, isBefore } from 'date-fns'

export default function Home() {
  const [step, setStep] = useState('register') // register | predict | done
  const [participant, setParticipant] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [round, setRound] = useState(null)
  const [games, setGames] = useState([])
  const [predictions, setPredictions] = useState({})
  const [existingPreds, setExistingPreds] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [locked, setLocked] = useState(false)

  useEffect(() => {
    loadCurrentRound()
    // Check if already registered this session
    const saved = sessionStorage.getItem('participant')
    if (saved) {
      const p = JSON.parse(saved)
      setParticipant(p)
      setStep('predict')
    }
  }, [])

  useEffect(() => {
    if (participant && round) loadExistingPredictions()
  }, [participant, round])

  async function loadCurrentRound() {
    const today = new Date().toISOString().split('T')[0]

    // Step 1: get the round
    const { data: roundData, error: roundErr } = await supabase
      .from('rounds')
      .select('*')
      .gte('round_date', today)
      .order('round_number', { ascending: true })
      .limit(1)
      .single()

    if (roundErr || !roundData) return

    // Step 2: get games for that round
    const { data: gamesData, error: gamesErr } = await supabase
      .from('games')
      .select('*')
      .eq('round_id', roundData.id)
      .order('board_number')

    if (gamesErr || !gamesData) {
      setRound(roundData)
      setGames([])
      setLocked(isBefore(new Date(roundData.prediction_deadline), new Date()))
      return
    }

    // Step 3: get all chess players and map them in
    const { data: playersData } = await supabase
      .from('chess_players')
      .select('*')

    const playerMap = {}
    if (playersData) playersData.forEach(p => { playerMap[p.id] = p })

    const enrichedGames = gamesData.map(g => ({
      ...g,
      white_player: playerMap[g.white_player_id] || null,
      black_player: playerMap[g.black_player_id] || null,
    }))

    setRound(roundData)
    setGames(enrichedGames)
    setLocked(isBefore(new Date(roundData.prediction_deadline), new Date()))
  }

  async function loadExistingPredictions() {
    const { data } = await supabase
      .from('predictions')
      .select('*')
      .eq('participant_id', participant.id)
      .in('game_id', games.map(g => g.id))

    if (data && data.length > 0) {
      const map = {}
      data.forEach(p => { map[p.game_id] = p.prediction })
      setExistingPreds(map)
      setPredictions(map)
      setSubmitted(true)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      // Check if participant exists
      let { data: existing } = await supabase
        .from('participants')
        .select('*')
        .eq('email', email.toLowerCase().trim())
        .single()

      if (!existing) {
        const { data: newP, error: insertErr } = await supabase
          .from('participants')
          .insert({ name: name.trim(), email: email.toLowerCase().trim() })
          .select()
          .single()
        if (insertErr) throw insertErr
        existing = newP
      }

      setParticipant(existing)
      sessionStorage.setItem('participant', JSON.stringify(existing))
      setStep('predict')
    } catch (err) {
      setError(err.message.includes('unique') ? 'That email is already taken by someone else.' : err.message)
    }
    setLoading(false)
  }

  async function handleSubmit() {
    if (Object.keys(predictions).length < games.length) {
      setError('Please predict all 4 boards before submitting.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const rows = Object.entries(predictions).map(([game_id, prediction]) => ({
        participant_id: participant.id,
        game_id,
        prediction,
        points_earned: 0
      }))

      const { error: upsertErr } = await supabase
        .from('predictions')
        .upsert(rows, { onConflict: 'participant_id,game_id' })

      if (upsertErr) throw upsertErr
      setSubmitted(true)
      setExistingPreds(predictions)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  function pick(gameId, value) {
    if (locked || submitted) return
    setPredictions(prev => ({ ...prev, [gameId]: value }))
  }

  const deadline = round ? new Date(round.prediction_deadline) : null
  const timeUntilLock = deadline && !locked
    ? `Predictions lock at ${format(deadline, 'h:mm a')}`
    : null

  return (
    <>
      <Nav />
      <div className="container" style={{ padding: '40px 20px' }}>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <p className="mono text-muted" style={{ fontSize: 12, marginBottom: 8, letterSpacing: '0.1em' }}>
            FIDE CANDIDATES TOURNAMENT 2026
          </p>
          <h1 style={{ fontSize: 36, lineHeight: 1.1, marginBottom: 12 }}>
            Daily Prediction Contest
          </h1>
          <p style={{ color: 'var(--text2)', maxWidth: 500, lineHeight: 1.6 }}>
            Predict the result of each board every day. Correct draw = 1 point. Correct win = 3 points.
            Best predictor after 14 rounds wins.
          </p>
        </div>

        {/* Step 1: Register */}
        {step === 'register' && (
          <div className="card" style={{ maxWidth: 460 }}>
            <h2 style={{ fontSize: 22, marginBottom: 6 }}>Join the contest</h2>
            <p style={{ color: 'var(--text2)', fontSize: 14, marginBottom: 24 }}>
              Enter your name and email to track your predictions across all 14 rounds.
            </p>
            <form onSubmit={handleRegister}>
              <div style={{ marginBottom: 16 }}>
                <label>Your name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Vishy Fan" required />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label>Email address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
                <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                  Used to identify you. No spam — ever.
                </p>
              </div>
              {error && <p style={{ color: 'var(--red)', fontSize: 14, marginBottom: 16 }}>{error}</p>}
              <button type="submit" className="btn-gold" disabled={loading} style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>
                {loading ? 'Joining...' : 'Join & Start Predicting →'}
              </button>
            </form>
          </div>
        )}

        {/* Step 2: Predict */}
        {step === 'predict' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 22 }}>
                  {round ? `Round ${round.round_number}` : 'No active round'}
                  {round && <span className="mono text-muted" style={{ fontSize: 14, marginLeft: 12, fontWeight: 400 }}>
                    {format(new Date(round.round_date), 'EEEE, MMM d')}
                  </span>}
                </h2>
                {timeUntilLock && (
                  <p style={{ fontSize: 13, color: 'var(--gold)', marginTop: 4 }}>⏰ {timeUntilLock}</p>
                )}
                {locked && (
                  <p style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>🔒 Predictions are locked for this round</p>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 14, color: 'var(--text2)' }}>Predicting as</p>
                <p style={{ fontSize: 15, fontWeight: 500 }}>{participant?.name}</p>
                <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 0' }}
                  onClick={() => { sessionStorage.clear(); setStep('register'); setParticipant(null); }}>
                  Switch account
                </button>
              </div>
            </div>

            {!round && (
              <div className="card" style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--text2)' }}>
                <p style={{ fontSize: 40, marginBottom: 16 }}>♟</p>
                <p style={{ fontSize: 18, marginBottom: 8 }}>No active round today</p>
                <p style={{ fontSize: 14 }}>Come back when the next round is posted.</p>
              </div>
            )}

            {round && games.map((game, i) => {
              const pred = predictions[game.id]
              const existing = existingPreds[game.id]
              const hasResult = !!game.result

              return (
                <div key={game.id} className="card" style={{ marginBottom: 16, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <span className="mono text-muted" style={{ fontSize: 12 }}>BOARD {game.board_number}</span>
                    {hasResult && (
                      <span>
                        Result: {game.result === 'white' ? <span className="badge-white">White wins</span>
                          : game.result === 'black' ? <span className="badge-black">Black wins</span>
                          : <span className="badge-draw">Draw</span>}
                      </span>
                    )}
                    {!hasResult && <span className="badge-pending">Pending</span>}
                  </div>

                  {/* Matchup */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                    <div>
                      <p style={{ fontSize: 18, fontFamily: 'Playfair Display', fontWeight: 700 }}>
                        {game.white_player?.flag} {game.white_player?.name}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>White</p>
                    </div>
                    <div style={{ fontSize: 20, color: 'var(--text3)', fontWeight: 300 }}>vs</div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 18, fontFamily: 'Playfair Display', fontWeight: 700 }}>
                        {game.black_player?.name} {game.black_player?.flag}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Black</p>
                    </div>
                  </div>

                  {/* Prediction buttons */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    {[
                      { value: 'white', label: `${game.white_player?.name} wins`, pts: '3 pts' },
                      { value: 'draw', label: 'Draw', pts: '1 pt' },
                      { value: 'black', label: `${game.black_player?.name} wins`, pts: '3 pts' },
                    ].map(opt => {
                      const selected = pred === opt.value
                      const isCorrect = hasResult && existing === opt.value && game.result === opt.value
                      const isWrong = hasResult && existing === opt.value && game.result !== opt.value
                      return (
                        <button
                          key={opt.value}
                          onClick={() => pick(game.id, opt.value)}
                          disabled={locked || submitted}
                          style={{
                            padding: '12px 8px',
                            borderRadius: 8,
                            border: selected ? '2px solid var(--gold)' : '1px solid var(--border)',
                            background: isCorrect ? 'rgba(76,175,120,0.15)' : isWrong ? 'rgba(224,85,85,0.1)' : selected ? 'var(--gold-dim)' : 'var(--bg3)',
                            color: isCorrect ? 'var(--green)' : isWrong ? 'var(--red)' : selected ? 'var(--gold-light)' : 'var(--text2)',
                            cursor: (locked || submitted) ? 'default' : 'pointer',
                            textAlign: 'center',
                            transition: 'all 0.15s',
                          }}
                        >
                          <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{opt.label}</p>
                          <p className="mono" style={{ fontSize: 11, opacity: 0.7 }}>{opt.pts}</p>
                          {isCorrect && <p style={{ fontSize: 11, marginTop: 4 }}>✓ Correct!</p>}
                          {isWrong && <p style={{ fontSize: 11, marginTop: 4 }}>✗ Wrong</p>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {round && !locked && !submitted && (
              <div style={{ marginTop: 24 }}>
                {error && <p style={{ color: 'var(--red)', fontSize: 14, marginBottom: 12 }}>{error}</p>}
                <button className="btn-gold" onClick={handleSubmit} disabled={loading}
                  style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: 16 }}>
                  {loading ? 'Saving...' : `Submit Predictions (${Object.keys(predictions).length}/4)`}
                </button>
              </div>
            )}

            {submitted && (
              <div style={{ marginTop: 24, textAlign: 'center', padding: '20px', background: 'var(--gold-dim)', borderRadius: 8, border: '1px solid var(--gold)' }}>
                <p style={{ color: 'var(--gold)', fontWeight: 500 }}>
                  {locked ? '🔒 Predictions locked for this round' : '✓ Predictions submitted! Come back after the games to see your score.'}
                </p>
                {!locked && !round?.is_complete && (
                  <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 6 }}>
                    You can update your predictions until the round starts.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
