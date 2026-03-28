import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'
import { format, isBefore } from 'date-fns'

export default function Home() {
  const [step, setStep] = useState('register')
  const [participant, setParticipant] = useState(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const [round, setRound] = useState(null)
  const [games, setGames] = useState([])
  const [locked, setLocked] = useState(false)

  // predictions = what's currently selected (working state)
  const [predictions, setPredictions] = useState({})
  // savedPreds = what's already saved in DB
  const [savedPreds, setSavedPreds] = useState({})
  // editing = user clicked "Change my picks"
  const [editing, setEditing] = useState(false)

  const [loading, setLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const [error, setError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)

  // ── Load round + games on mount ──
  const loadRound = useCallback(async () => {
    setPageLoading(true)
    const today = new Date().toISOString().split('T')[0]

    const { data: roundData } = await supabase
      .from('rounds')
      .select('*')
      .gte('round_date', today)
      .order('round_number', { ascending: true })
      .limit(1)
      .single()

    if (!roundData) { setPageLoading(false); return }

    const { data: gamesData } = await supabase
      .from('games')
      .select('*')
      .eq('round_id', roundData.id)
      .order('board_number')

    const { data: playersData } = await supabase
      .from('chess_players')
      .select('*')

    const playerMap = {}
    if (playersData) playersData.forEach(p => { playerMap[p.id] = p })

    const enriched = (gamesData || []).map(g => ({
      ...g,
      white_player: playerMap[g.white_player_id] || null,
      black_player: playerMap[g.black_player_id] || null,
    }))

    setRound(roundData)
    setGames(enriched)
    setLocked(isBefore(new Date(roundData.prediction_deadline), new Date()))
    setPageLoading(false)
  }, [])

  // ── Check session on mount ──
  useEffect(() => {
    loadRound()
    const saved = sessionStorage.getItem('participant')
    if (saved) {
      try {
        const p = JSON.parse(saved)
        setParticipant(p)
        setStep('predict')
      } catch (e) {}
    }
  }, [loadRound])

  // ── Load existing predictions once we have both participant and games ──
  useEffect(() => {
    if (!participant || games.length === 0) return
    loadExistingPredictions()
  }, [participant, games])

  async function loadExistingPredictions() {
    const gameIds = games.map(g => g.id)
    if (gameIds.length === 0) return

    const { data } = await supabase
      .from('predictions')
      .select('game_id, prediction, points_earned')
      .eq('participant_id', participant.id)
      .in('game_id', gameIds)

    const map = {}
    if (data) data.forEach(p => { map[p.game_id] = p.prediction })
    setSavedPreds(map)
    setPredictions(map)
  }

  // ── Register / login ──
  async function handleRegister(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
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
      } else {
        // Email already exists — treat as login, use stored name
        if (existing.name !== name.trim() && name.trim()) {
          // name mismatch is fine, just use the DB name
        }
      }

      setParticipant(existing)
      sessionStorage.setItem('participant', JSON.stringify(existing))
      setStep('predict')
    } catch (err) {
      if (err.message?.includes('unique')) {
        setError('That email is already registered under a different name.')
      } else {
        setError(err.message || 'Something went wrong. Try again.')
      }
    }
    setLoading(false)
  }

  // ── Pick a result for a board ──
  function pick(gameId, value) {
    if (locked) return
    // Allow picking if: no saved preds yet, OR currently editing
    if (Object.keys(savedPreds).length > 0 && !editing) return
    setPredictions(prev => ({ ...prev, [gameId]: value }))
  }

  // ── Submit (new or updated) predictions ──
  async function handleSubmit() {
    const picked = Object.keys(predictions).length
    if (picked < games.length) {
      setError(`Please predict all ${games.length} boards. You've picked ${picked}/${games.length}.`)
      return
    }
    setLoading(true)
    setError('')
    setSaveSuccess(false)
    try {
      const rows = Object.entries(predictions).map(([game_id, prediction]) => ({
        participant_id: participant.id,
        game_id,
        prediction,
        points_earned: 0,
      }))

      const { error: upsertErr } = await supabase
        .from('predictions')
        .upsert(rows, { onConflict: 'participant_id,game_id' })

      if (upsertErr) throw upsertErr

      setSavedPreds({ ...predictions })
      setEditing(false)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 4000)
    } catch (err) {
      setError(err.message || 'Failed to save. Try again.')
    }
    setLoading(false)
  }

  // ── Cancel editing — revert to saved ──
  function cancelEdit() {
    setPredictions({ ...savedPreds })
    setEditing(false)
    setError('')
  }

  const hasSaved = Object.keys(savedPreds).length > 0
  const hasChanges = hasSaved && JSON.stringify(predictions) !== JSON.stringify(savedPreds)
  const allPicked = Object.keys(predictions).length === games.length
  const deadline = round ? new Date(round.prediction_deadline) : null

  // ── Styles ──
  const s = {
    optBtn: (selected, isCorrect, isWrong) => ({
      padding: '13px 8px',
      borderRadius: 8,
      border: selected ? '2px solid var(--gold)' : '1px solid var(--border)',
      background: isCorrect
        ? 'rgba(76,175,120,0.15)'
        : isWrong
        ? 'rgba(224,85,85,0.08)'
        : selected
        ? 'var(--gold-dim)'
        : 'var(--bg3)',
      color: isCorrect
        ? 'var(--green)'
        : isWrong
        ? 'var(--red)'
        : selected
        ? 'var(--gold-light)'
        : 'var(--text2)',
      cursor: (locked || (hasSaved && !editing)) ? 'default' : 'pointer',
      textAlign: 'center',
      transition: 'all 0.15s',
      opacity: (locked || (hasSaved && !editing)) && !selected ? 0.5 : 1,
    }),
  }

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
          <p style={{ color: 'var(--text2)', maxWidth: 520, lineHeight: 1.6 }}>
            Predict the result of each board every day. Correct draw = 1 point. Correct win = 4 points.
            Best predictor after 14 rounds wins.
          </p>
        </div>

        {/* ── REGISTER STEP ── */}
        {step === 'register' && (
          <div className="card" style={{ maxWidth: 460 }}>
            <h2 style={{ fontSize: 22, marginBottom: 6 }}>Join the contest</h2>
            <p style={{ color: 'var(--text2)', fontSize: 14, marginBottom: 24 }}>
              Enter your name and email. Returning? Just use the same email to pick up where you left off.
            </p>
            <form onSubmit={handleRegister}>
              <div style={{ marginBottom: 16 }}>
                <label>Your name</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Vishy Fan" required />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label>Email address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
                <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
                  Used only to identify you across rounds. No spam.
                </p>
              </div>
              {error && <p style={{ color: 'var(--red)', fontSize: 14, marginBottom: 16 }}>{error}</p>}
              <button type="submit" className="btn-gold" disabled={loading}
                style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15 }}>
                {loading ? 'Loading...' : 'Continue →'}
              </button>
            </form>
          </div>
        )}

        {/* ── PREDICT STEP ── */}
        {step === 'predict' && (
          <div>

            {/* Round header + user info */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
              <div>
                {pageLoading ? (
                  <p style={{ color: 'var(--text2)' }}>Loading round...</p>
                ) : round ? (
                  <>
                    <h2 style={{ fontSize: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
                      Round {round.round_number}
                      <span className="mono text-muted" style={{ fontSize: 14, fontWeight: 400 }}>
                        {format(new Date(round.round_date + 'T00:00:00'), 'EEE, MMM d')}
                      </span>
                    </h2>
                    {locked ? (
                      <p style={{ fontSize: 13, color: 'var(--red)', marginTop: 6 }}>
                        🔒 Predictions locked — round has started
                      </p>
                    ) : (
                      <p style={{ fontSize: 13, color: 'var(--gold)', marginTop: 6 }}>
                        ⏰ Predictions lock at {format(deadline, 'h:mm a, MMM d')}
                      </p>
                    )}
                  </>
                ) : (
                  <div>
                    <h2 style={{ fontSize: 22, color: 'var(--text2)' }}>No active round today</h2>
                    <p style={{ fontSize: 14, color: 'var(--text3)', marginTop: 6 }}>
                      The admin hasn't posted today's pairings yet. Check back soon.
                    </p>
                  </div>
                )}
              </div>

              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 13, color: 'var(--text2)' }}>Predicting as</p>
                <p style={{ fontSize: 16, fontWeight: 600 }}>{participant?.name}</p>
                <button onClick={() => { sessionStorage.clear(); setStep('register'); setParticipant(null); setPredictions({}); setSavedPreds({}); }}
                  style={{ fontSize: 12, color: 'var(--text3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 4 }}>
                  Switch account
                </button>
              </div>
            </div>

            {/* Status banner */}
            {saveSuccess && (
              <div style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 8, background: 'rgba(76,175,120,0.12)', border: '1px solid rgba(76,175,120,0.3)', color: 'var(--green)', fontSize: 14 }}>
                ✓ Predictions saved successfully!
              </div>
            )}

            {hasSaved && !editing && !locked && round && (
              <div style={{ marginBottom: 20, padding: '14px 18px', borderRadius: 8, background: 'var(--gold-dim)', border: '1px solid rgba(201,168,76,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <p style={{ color: 'var(--gold-light)', fontWeight: 500, fontSize: 14 }}>
                    ✓ Your predictions are saved ({Object.keys(savedPreds).length}/{games.length} boards)
                  </p>
                  <p style={{ color: 'var(--text2)', fontSize: 13, marginTop: 3 }}>
                    You can change your picks until the round locks.
                  </p>
                </div>
                <button onClick={() => { setEditing(true); setSaveSuccess(false); }}
                  style={{ padding: '8px 18px', borderRadius: 8, background: 'none', border: '1px solid var(--gold)', color: 'var(--gold)', fontFamily: 'DM Sans', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
                  ✏ Change my picks
                </button>
              </div>
            )}

            {editing && !locked && (
              <div style={{ marginBottom: 20, padding: '12px 18px', borderRadius: 8, background: 'rgba(224,85,85,0.08)', border: '1px solid rgba(224,85,85,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <p style={{ color: 'var(--red)', fontSize: 14 }}>
                  ✏ Editing mode — make your changes and hit Save.
                </p>
                <button onClick={cancelEdit} style={{ padding: '6px 14px', borderRadius: 8, background: 'none', border: '1px solid rgba(224,85,85,0.4)', color: 'var(--red)', fontFamily: 'DM Sans', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            )}

            {/* Game boards */}
            {!pageLoading && round && games.length === 0 && (
              <div className="card" style={{ textAlign: 'center', padding: '50px 24px', color: 'var(--text2)' }}>
                <p style={{ fontSize: 36, marginBottom: 12 }}>♟</p>
                <p style={{ fontSize: 16 }}>Board pairings haven't been set yet.</p>
                <p style={{ fontSize: 13, marginTop: 6, color: 'var(--text3)' }}>The admin will add them shortly.</p>
              </div>
            )}

            {games.map((game) => {
              const pred = predictions[game.id]
              const saved = savedPreds[game.id]
              const hasResult = !!game.result
              const isEditable = !locked && (!hasSaved || editing)

              return (
                <div key={game.id} className="card" style={{ marginBottom: 16 }}>
                  {/* Board header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text3)', letterSpacing: '0.08em' }}>
                      BOARD {game.board_number}
                    </span>
                    <span>
                      {hasResult ? (
                        game.result === 'white' ? <span className="badge-white">White wins</span>
                        : game.result === 'black' ? <span className="badge-black">Black wins</span>
                        : <span className="badge-draw">Draw ½–½</span>
                      ) : (
                        <span className="badge-pending">Pending</span>
                      )}
                    </span>
                  </div>

                  {/* Matchup display */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                    <div>
                      <p style={{ fontSize: 17, fontFamily: 'Playfair Display', fontWeight: 700 }}>
                        {game.white_player?.flag} {game.white_player?.name || '?'}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>White</p>
                    </div>
                    <span style={{ color: 'var(--text3)', fontSize: 16 }}>vs</span>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 17, fontFamily: 'Playfair Display', fontWeight: 700 }}>
                        {game.black_player?.name || '?'} {game.black_player?.flag}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>Black</p>
                    </div>
                  </div>

                  {/* Prediction buttons */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    {[
                      { value: 'white', label: game.white_player?.name?.split(' ').pop() || 'White', sublabel: 'White wins', pts: '4 pts' },
                      { value: 'draw', label: 'Draw', sublabel: '½–½', pts: '1 pt' },
                      { value: 'black', label: game.black_player?.name?.split(' ').pop() || 'Black', sublabel: 'Black wins', pts: '4 pts' },
                    ].map(opt => {
                      const selected = pred === opt.value
                      const wasSelected = saved === opt.value
                      const isCorrect = hasResult && wasSelected && game.result === opt.value
                      const isWrong = hasResult && wasSelected && game.result !== opt.value
                      const changed = editing && wasSelected && pred !== opt.value
                      const newChoice = editing && !wasSelected && selected

                      return (
                        <button
                          key={opt.value}
                          onClick={() => pick(game.id, opt.value)}
                          style={s.optBtn(selected, isCorrect, isWrong)}
                        >
                          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{opt.label}</p>
                          <p style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>{opt.sublabel}</p>
                          <p className="mono" style={{ fontSize: 11, opacity: 0.6 }}>{opt.pts}</p>
                          {isCorrect && <p style={{ fontSize: 11, marginTop: 4, color: 'var(--green)' }}>✓ Correct!</p>}
                          {isWrong && <p style={{ fontSize: 11, marginTop: 4 }}>✗ Wrong</p>}
                          {changed && <p style={{ fontSize: 10, marginTop: 4, color: 'var(--text3)' }}>was saved</p>}
                          {newChoice && <p style={{ fontSize: 10, marginTop: 4, color: 'var(--gold)' }}>new pick ↑</p>}
                        </button>
                      )
                    })}
                  </div>

                  {/* Per-board hint when locked and not predicted */}
                  {locked && !saved && (
                    <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10, textAlign: 'center' }}>
                      You didn't predict this board before the deadline.
                    </p>
                  )}
                </div>
              )
            })}

            {/* Submit / Save button area */}
            {round && !locked && games.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {error && (
                  <p style={{ color: 'var(--red)', fontSize: 14, marginBottom: 12 }}>{error}</p>
                )}

                {/* First submission */}
                {!hasSaved && (
                  <button onClick={handleSubmit} disabled={loading || !allPicked}
                    className="btn-gold"
                    style={{ width: '100%', justifyContent: 'center', padding: '14px', fontSize: 15, opacity: (!allPicked || loading) ? 0.5 : 1, cursor: (!allPicked || loading) ? 'not-allowed' : 'pointer' }}>
                    {loading ? 'Saving...' : `Submit Predictions (${Object.keys(predictions).length}/${games.length})`}
                  </button>
                )}

                {/* Editing - save updated picks */}
                {hasSaved && editing && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={handleSubmit} disabled={loading || !allPicked}
                      className="btn-gold"
                      style={{ flex: 1, justifyContent: 'center', padding: '13px', fontSize: 15, opacity: (!allPicked || loading) ? 0.5 : 1, cursor: (!allPicked || loading) ? 'not-allowed' : 'pointer' }}>
                      {loading ? 'Saving...' : hasChanges ? 'Save updated picks ✓' : 'Save (no changes)'}
                    </button>
                    <button onClick={cancelEdit}
                      style={{ padding: '13px 20px', borderRadius: 8, background: 'none', border: '1px solid var(--border)', color: 'var(--text2)', fontFamily: 'DM Sans', fontSize: 14, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Locked state + already saved */}
            {locked && hasSaved && round && (
              <div style={{ marginTop: 8, textAlign: 'center', padding: '16px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <p style={{ color: 'var(--text2)', fontSize: 14 }}>
                  🔒 Round locked · Your predictions are in · Good luck!
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
