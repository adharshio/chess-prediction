import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

function useAdmin() {
  const [auth, setAuth] = useState(false)
  const [pw, setPw] = useState('')
  const check = () => {
    if (pw === process.env.NEXT_PUBLIC_ADMIN_PASSWORD) {
      sessionStorage.setItem('admin', '1')
      setAuth(true)
    } else alert('Wrong password')
  }
  useEffect(() => { if (sessionStorage.getItem('admin') === '1') setAuth(true) }, [])
  return { auth, pw, setPw, check }
}

const EMPTY_BOARDS = () => [1,2,3,4].map(n => ({ board_number: n, white_player_id: '', black_player_id: '' }))

function utcToLocalInput(utcStr) {
  if (!utcStr) return ''
  const d = new Date(utcStr)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToISO(localStr) {
  if (!localStr) return ''
  return new Date(localStr).toISOString()
}

function displayLocalTime(utcStr) {
  if (!utcStr) return '—'
  return new Date(utcStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

export default function Admin() {
  const { auth, pw, setPw, check } = useAdmin()
  const [tab, setTab] = useState('rounds')
  const [rounds, setRounds] = useState([])
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const [newRound, setNewRound] = useState({ round_number: '', round_date: '', prediction_deadline: '' })
  const [boards, setBoards] = useState(EMPTY_BOARDS())
  const [editingRound, setEditingRound] = useState(null)
  const [editBoards, setEditBoards] = useState(EMPTY_BOARDS())
  const [editMeta, setEditMeta] = useState({ round_date: '', prediction_deadline: '' })

  // Points adjustment state
  const [participants, setParticipants] = useState([])
  const [allGames, setAllGames] = useState([])
  const [selectedParticipant, setSelectedParticipant] = useState(null)
  const [participantPredictions, setParticipantPredictions] = useState([])
  const [adjustments, setAdjustments] = useState({}) // predictionId -> new points value
  const [bonusParticipant, setBonusParticipant] = useState('')
  const [bonusPoints, setBonusPoints] = useState('')
  const [bonusNote, setBonusNote] = useState('')

  useEffect(() => { if (auth) loadAll() }, [auth])

  async function loadAll() {
    const [{ data: roundsData }, { data: gamesData }, { data: playersData }, { data: participantsData }] = await Promise.all([
      supabase.from('rounds').select('*').order('round_number'),
      supabase.from('games').select('*').order('board_number'),
      supabase.from('chess_players').select('*').order('display_order'),
      supabase.from('participants').select('*').order('name'),
    ])
    if (playersData) setPlayers(playersData)
    if (participantsData) setParticipants(participantsData)
    if (gamesData) setAllGames(gamesData)
    if (roundsData) {
      const playerMap = {}
      if (playersData) playersData.forEach(p => { playerMap[p.id] = p })
      setRounds(roundsData.map(r => ({
        ...r,
        games: (gamesData || []).filter(g => g.round_id === r.id).map(g => ({
          ...g,
          white_player: playerMap[g.white_player_id] || null,
          black_player: playerMap[g.black_player_id] || null,
        }))
      })))
    }
  }

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 5000) }

  // ── Load all predictions for a participant ──
  async function loadParticipantPredictions(participantId) {
    const { data } = await supabase
      .from('predictions')
      .select('*')
      .eq('participant_id', participantId)
      .order('created_at')
    setParticipantPredictions(data || [])
    setAdjustments({})
  }

  async function selectParticipant(p) {
    setSelectedParticipant(p)
    await loadParticipantPredictions(p.id)
  }

  // Save individually adjusted points for specific predictions
  async function saveAdjustments() {
    if (Object.keys(adjustments).length === 0) { flash('No changes to save.'); return }
    setLoading(true)
    try {
      for (const [predId, newPts] of Object.entries(adjustments)) {
        const pts = parseInt(newPts)
        if (isNaN(pts) || pts < 0) continue
        await supabase.from('predictions').update({ points_earned: pts }).eq('id', predId)
      }
      flash('✓ Points updated!')
      await loadParticipantPredictions(selectedParticipant.id)
    } catch (e) { flash('Error: ' + e.message) }
    setLoading(false)
  }

  // Apply a flat bonus/deduction to a participant's total
  // We do this by adding a "bonus" prediction record on a dummy game
  // Simpler approach: directly update a specific existing prediction, or add a note
  // Best approach: add a bonus_points column to participants table, or
  // just let admin directly set points on any of their predictions
  // We'll use a clean approach: store bonus as a special prediction with game_id=null
  // Actually simplest: just let admin set total override via a separate bonus_adjustments table
  // For now, we do it by finding all their predictions and updating points manually — already covered above
  // The "bulk bonus" just adds N points by inflating one of their existing predictions by N
  async function applyBonus() {
    if (!bonusParticipant || !bonusPoints) { flash('Error: Select participant and enter points.'); return }
    const pts = parseInt(bonusPoints)
    if (isNaN(pts)) { flash('Error: Enter a valid number.'); return }

    setLoading(true)
    try {
      // Get their first prediction to use as anchor for the bonus
      // Actually, we'll use a special row approach: upsert a prediction with a special marker
      // Cleanest: just insert a prediction row with points_earned = bonus and a sentinel game_id
      // But game_id has FK constraint. So instead, we directly update leaderboard by
      // using a dedicated bonus_adjustments table approach, but we didn't create that table.
      // Practical solution: Get their predictions for round 1 and add bonus there as an offset
      // REAL practical solution for this app: update their first prediction's points by ± amount

      // Find all their predictions
      const { data: preds } = await supabase
        .from('predictions')
        .select('id, points_earned')
        .eq('participant_id', bonusParticipant)
        .order('created_at')
        .limit(1)

      if (!preds || preds.length === 0) {
        flash('Error: This participant has no predictions to adjust. Have them submit at least one prediction first.')
        setLoading(false)
        return
      }

      // Add bonus to their first prediction's points_earned (it's a direct offset)
      const firstPred = preds[0]
      const newPts = Math.max(0, (firstPred.points_earned || 0) + pts)
      await supabase.from('predictions').update({ points_earned: newPts }).eq('id', firstPred.id)

      flash(`✓ ${pts >= 0 ? '+' : ''}${pts} points applied to ${participants.find(p => p.id === bonusParticipant)?.name}. Note: ${bonusNote || 'manual adjustment'}`)
      setBonusPoints('')
      setBonusNote('')
      if (selectedParticipant?.id === bonusParticipant) {
        await loadParticipantPredictions(bonusParticipant)
      }
    } catch (e) { flash('Error: ' + e.message) }
    setLoading(false)
  }

  async function createRound() {
    if (!newRound.round_number || !newRound.round_date || !newRound.prediction_deadline) {
      return flash('Error: Fill in round number, date, and deadline.')
    }
    const validBoards = boards.filter(b => b.white_player_id && b.black_player_id)
    if (validBoards.length < 4) return flash('Error: Set all 4 board pairings.')
    setLoading(true)
    try {
      const { data: round, error } = await supabase.from('rounds').insert({
        round_number: parseInt(newRound.round_number),
        round_date: newRound.round_date,
        prediction_deadline: localInputToISO(newRound.prediction_deadline),
      }).select().single()
      if (error) throw error
      const { error: gErr } = await supabase.from('games').insert(
        validBoards.map(b => ({ round_id: round.id, board_number: b.board_number, white_player_id: b.white_player_id, black_player_id: b.black_player_id }))
      )
      if (gErr) throw gErr
      flash('✓ Round ' + newRound.round_number + ' created!')
      setNewRound({ round_number: '', round_date: '', prediction_deadline: '' })
      setBoards(EMPTY_BOARDS())
      await loadAll()
    } catch (e) { flash('Error: ' + e.message) }
    setLoading(false)
  }

  async function deleteRound(round) {
    if (!confirm(`Delete Round ${round.round_number}?\n\nThis permanently deletes all games and predictions for this round.`)) return
    setLoading(true)
    const gameIds = round.games.map(g => g.id)
    if (gameIds.length > 0) {
      await supabase.from('predictions').delete().in('game_id', gameIds)
      await supabase.from('games').delete().in('id', gameIds)
    }
    await supabase.from('rounds').delete().eq('id', round.id)
    flash('✓ Round ' + round.round_number + ' deleted.')
    await loadAll()
    setLoading(false)
  }

  function openEdit(round) {
    setEditingRound(round)
    setEditMeta({ round_date: round.round_date, prediction_deadline: utcToLocalInput(round.prediction_deadline) })
    const eb = EMPTY_BOARDS()
    round.games.forEach(g => {
      const idx = eb.findIndex(b => b.board_number === g.board_number)
      if (idx !== -1) eb[idx] = { board_number: g.board_number, game_id: g.id, white_player_id: g.white_player_id, black_player_id: g.black_player_id }
    })
    setEditBoards(eb)
  }

  async function saveEdit() {
    setLoading(true)
    try {
      const { error: rErr } = await supabase.from('rounds').update({
        round_date: editMeta.round_date,
        prediction_deadline: localInputToISO(editMeta.prediction_deadline),
      }).eq('id', editingRound.id)
      if (rErr) throw rErr
      for (const board of editBoards) {
        if (!board.game_id) continue
        await supabase.from('games').update({ white_player_id: board.white_player_id, black_player_id: board.black_player_id }).eq('id', board.game_id)
      }
      flash('✓ Round updated!')
      setEditingRound(null)
      await loadAll()
    } catch (e) { flash('Error: ' + e.message) }
    setLoading(false)
  }

  async function scoreGame(gameId, result) {
    const { data: preds } = await supabase.from('predictions').select('id, prediction').eq('game_id', gameId)
    if (!preds || preds.length === 0) return
    for (const p of preds) {
      const pts = p.prediction === result ? (result === 'draw' ? 1 : 4) : 0
      await supabase.from('predictions').update({ points_earned: pts }).eq('id', p.id)
    }
  }

  async function setResult(gameId, result, currentResult) {
    if (currentResult === result) { await clearResult(gameId); return }
    setLoading(true)
    const { error } = await supabase.from('games').update({ result }).eq('id', gameId)
    if (!error) { await scoreGame(gameId, result); await loadAll(); flash('✓ Result saved & scores recalculated') }
    else flash('Error: ' + error.message)
    setLoading(false)
  }

  async function clearResult(gameId) {
    setLoading(true)
    await supabase.from('games').update({ result: null }).eq('id', gameId)
    await supabase.from('predictions').update({ points_earned: 0 }).eq('game_id', gameId)
    await loadAll()
    flash('Result cleared — points reset to 0')
    setLoading(false)
  }

  async function markRoundComplete(round, complete) {
    setLoading(true)
    await supabase.from('rounds').update({ is_complete: complete }).eq('id', round.id)
    if (complete) {
      for (const game of round.games) {
        if (game.result) await scoreGame(game.id, game.result)
      }
      flash('✓ Round marked complete — scores verified')
    } else {
      flash('✓ Round reopened')
    }
    await loadAll()
    setLoading(false)
  }

  const s = {
    card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '20px 24px', marginBottom: 16 },
    inp: { width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '8px 12px', fontFamily: 'DM Sans', fontSize: 14, outline: 'none' },
    lbl: { display: 'block', fontSize: 11, color: 'var(--text2)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 },
  }
  const Inp = (props) => <input style={s.inp} {...props} />
  const Sel = ({ children, ...props }) => <select style={{ ...s.inp, color: props.value ? 'var(--text)' : 'var(--text3)' }} {...props}>{children}</select>
  const PlayerOptions = () => players.map(p => <option key={p.id} value={p.id}>{p.flag} {p.name}</option>)

  if (!auth) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ ...s.card, width: 360 }}>
        <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 20 }}>♟ Admin Panel</h2>
        <label style={s.lbl}>Password</label>
        <Inp type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && check()} placeholder="Enter admin password" style={{ ...s.inp, marginBottom: 16 }} />
        <button onClick={check} style={{ width: '100%', padding: 12, background: 'var(--gold)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Enter</button>
      </div>
    </div>
  )

  // Build a map of gameId → round + game info for the points tab
  const gameInfoMap = {}
  rounds.forEach(r => {
    r.games.forEach(g => {
      gameInfoMap[g.id] = { round: r.round_number, board: g.board_number, white: g.white_player?.name, black: g.black_player?.name, result: g.result }
    })
  })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'DM Sans, sans-serif', color: 'var(--text)' }}>

      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 24, position: 'sticky', top: 0, zIndex: 50 }}>
        <span style={{ fontFamily: 'Playfair Display', color: 'var(--gold)', fontSize: 18 }}>♟ Admin</span>
        {['rounds', 'results', 'points', 'players'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--gold)' : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'DM Sans', color: tab === t ? 'var(--text)' : 'var(--text2)',
            fontWeight: tab === t ? 500 : 400, fontSize: 14, paddingBottom: 4, textTransform: 'capitalize',
          }}>{t}</button>
        ))}
        <a href="/" style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text2)' }}>← Public site</a>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>

        {msg && (
          <div style={{ padding: '10px 16px', marginBottom: 20, borderRadius: 8, fontSize: 14,
            background: msg.startsWith('✓') ? 'rgba(76,175,120,0.12)' : 'rgba(224,85,85,0.12)',
            color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)',
            border: `1px solid ${msg.startsWith('✓') ? 'rgba(76,175,120,0.3)' : 'rgba(224,85,85,0.3)'}`,
          }}>{msg}</div>
        )}

        {/* ── ROUNDS ── */}
        {tab === 'rounds' && (<>
          <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 20 }}>Create Round</h2>
          <div style={s.card}>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16, padding: '8px 12px', background: 'var(--bg3)', borderRadius: 6 }}>
              ℹ Times are entered and displayed in <strong>your local timezone</strong>.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div>
                <label style={s.lbl}>Round number</label>
                <Inp type="number" value={newRound.round_number} min={1} max={14} placeholder="1" onChange={e => setNewRound(p => ({ ...p, round_number: e.target.value }))} />
              </div>
              <div>
                <label style={s.lbl}>Date</label>
                <Inp type="date" value={newRound.round_date} onChange={e => setNewRound(p => ({ ...p, round_date: e.target.value }))} />
              </div>
              <div>
                <label style={s.lbl}>Prediction deadline (local time)</label>
                <Inp type="datetime-local" value={newRound.prediction_deadline} onChange={e => setNewRound(p => ({ ...p, prediction_deadline: e.target.value }))} />
                {newRound.prediction_deadline && (
                  <p style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>
                    Locks: {displayLocalTime(localInputToISO(newRound.prediction_deadline))}
                  </p>
                )}
              </div>
            </div>
            <label style={s.lbl}>Board pairings</label>
            {boards.map((board, i) => (
              <div key={board.board_number} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 30px 1fr', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--text2)' }}>Board {board.board_number}</span>
                <Sel value={board.white_player_id} onChange={e => setBoards(b => b.map((x, j) => j===i ? { ...x, white_player_id: e.target.value } : x))}>
                  <option value="">White player</option><PlayerOptions />
                </Sel>
                <span style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>vs</span>
                <Sel value={board.black_player_id} onChange={e => setBoards(b => b.map((x, j) => j===i ? { ...x, black_player_id: e.target.value } : x))}>
                  <option value="">Black player</option><PlayerOptions />
                </Sel>
              </div>
            ))}
            <button onClick={createRound} disabled={loading} style={{ marginTop: 16, padding: '10px 24px', background: 'var(--gold)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Creating...' : 'Create Round'}
            </button>
          </div>

          <h3 style={{ fontFamily: 'Playfair Display', marginBottom: 16, marginTop: 8 }}>All Rounds</h3>
          {rounds.map(r => (
            <div key={r.id} style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500, fontSize: 15 }}>Round {r.round_number}</span>
                    <span style={{ fontSize: 13, color: 'var(--text2)' }}>{r.round_date}</span>
                    {r.is_complete && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(76,175,120,0.12)', color: 'var(--green)' }}>Complete</span>}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text3)' }}>🔒 Locks: {displayLocalTime(r.prediction_deadline)}</p>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {r.is_complete
                    ? <button onClick={() => markRoundComplete(r, false)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontFamily: 'DM Sans' }}>Reopen</button>
                    : <button onClick={() => markRoundComplete(r, true)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid rgba(76,175,120,0.4)', color: 'var(--green)', fontFamily: 'DM Sans' }}>Mark complete</button>
                  }
                  <button onClick={() => openEdit(r)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid rgba(201,168,76,0.4)', color: 'var(--gold)', fontFamily: 'DM Sans' }}>✏ Edit</button>
                  <button onClick={() => deleteRound(r)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid rgba(224,85,85,0.4)', color: 'var(--red)', fontFamily: 'DM Sans' }}>🗑 Delete</button>
                </div>
              </div>
              {r.games.map(g => (
                <div key={g.id} style={{ fontSize: 13, color: 'var(--text2)', padding: '6px 0', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ color: 'var(--text3)', minWidth: 60 }}>Board {g.board_number}</span>
                  <span>{g.white_player?.flag} {g.white_player?.name || '⚠'}</span>
                  <span style={{ color: 'var(--text3)' }}>vs</span>
                  <span>{g.black_player?.name || '⚠'} {g.black_player?.flag}</span>
                  {g.result && <span style={{ marginLeft: 'auto', fontSize: 11, padding: '1px 8px', borderRadius: 4, background: g.result === 'draw' ? 'var(--draw)' : g.result === 'white' ? '#e8f4e8' : '#1a1a1a', color: g.result === 'draw' ? 'var(--draw-text)' : g.result === 'white' ? '#1a4a1a' : '#ccc', border: g.result === 'black' ? '1px solid #444' : 'none' }}>
                    {g.result === 'white' ? '1–0' : g.result === 'black' ? '0–1' : '½–½'}
                  </span>}
                </div>
              ))}
            </div>
          ))}
        </>)}

        {/* ── RESULTS ── */}
        {tab === 'results' && (<>
          <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 8 }}>Enter Results</h2>
          <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 24 }}>Click a result to save — scores recalculate instantly. Draw = 1 pt · Win = 4 pts.</p>
          {rounds.map(round => (
            <div key={round.id} style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontFamily: 'Playfair Display', fontSize: 18 }}>Round {round.round_number} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text2)' }}>{round.round_date}</span></h3>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {round.is_complete
                    ? <><span style={{ fontSize: 12, color: 'var(--green)' }}>✓ Complete</span><button onClick={() => markRoundComplete(round, false)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontFamily: 'DM Sans' }}>Reopen</button></>
                    : <button onClick={() => markRoundComplete(round, true)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid rgba(76,175,120,0.4)', color: 'var(--green)', fontFamily: 'DM Sans' }}>Mark complete</button>
                  }
                </div>
              </div>
              {round.games.length === 0 && <p style={{ fontSize: 13, color: 'var(--text3)' }}>No games for this round.</p>}
              {round.games.map(game => (
                <div key={game.id} style={{ display: 'grid', gridTemplateColumns: '55px 1fr auto 1fr', gap: 12, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>Board {game.board_number}</span>
                  <span style={{ fontSize: 14, fontFamily: 'Playfair Display' }}>{game.white_player?.flag} {game.white_player?.name || '?'}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[{ val: 'white', label: '1–0' }, { val: 'draw', label: '½–½' }, { val: 'black', label: '0–1' }].map(opt => (
                      <button key={opt.val} onClick={() => setResult(game.id, opt.val, game.result)} disabled={loading} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'DM Mono', border: `1px solid ${game.result === opt.val ? 'var(--gold)' : 'var(--border)'}`, background: game.result === opt.val ? 'var(--gold-dim)' : 'var(--bg3)', color: game.result === opt.val ? 'var(--gold-light)' : 'var(--text2)', fontWeight: game.result === opt.val ? 600 : 400 }}>{opt.label}</button>
                    ))}
                    {game.result && <button onClick={() => clearResult(game.id)} style={{ padding: '7px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontFamily: 'DM Sans' }}>✕</button>}
                  </div>
                  <span style={{ fontSize: 14, fontFamily: 'Playfair Display', textAlign: 'right' }}>{game.black_player?.name || '?'} {game.black_player?.flag}</span>
                </div>
              ))}
            </div>
          ))}
        </>)}

        {/* ── POINTS ADJUSTMENT ── */}
        {tab === 'points' && (<>
          <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 8 }}>Points Adjustment</h2>
          <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 24 }}>
            Manually correct points for any participant — per prediction, or as a bulk bonus/deduction.
          </p>

          {/* Quick bonus / deduction */}
          <div style={s.card}>
            <h3 style={{ fontFamily: 'Playfair Display', fontSize: 17, marginBottom: 4 }}>Quick bonus or deduction</h3>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>Add or subtract points from a participant's total in one step.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr auto', gap: 12, alignItems: 'flex-end' }}>
              <div>
                <label style={s.lbl}>Participant</label>
                <Sel value={bonusParticipant} onChange={e => setBonusParticipant(e.target.value)}>
                  <option value="">Select participant</option>
                  {participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Sel>
              </div>
              <div>
                <label style={s.lbl}>Points (±)</label>
                <Inp type="number" value={bonusPoints} onChange={e => setBonusPoints(e.target.value)} placeholder="+4 or -2" style={{ ...s.inp }} />
              </div>
              <div>
                <label style={s.lbl}>Reason / note (optional)</label>
                <Inp type="text" value={bonusNote} onChange={e => setBonusNote(e.target.value)} placeholder="e.g. tiebreaker bonus" />
              </div>
              <button onClick={applyBonus} disabled={loading}
                style={{ padding: '8px 20px', background: 'var(--gold)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                Apply
              </button>
            </div>
          </div>

          {/* Per-prediction editor */}
          <div style={s.card}>
            <h3 style={{ fontFamily: 'Playfair Display', fontSize: 17, marginBottom: 4 }}>Edit individual predictions</h3>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>Select a participant to see and edit the points awarded for each of their predictions.</p>

            <div style={{ marginBottom: 20 }}>
              <label style={s.lbl}>Select participant</label>
              <Sel value={selectedParticipant?.id || ''} onChange={e => {
                const p = participants.find(x => x.id === e.target.value)
                if (p) selectParticipant(p)
                else { setSelectedParticipant(null); setParticipantPredictions([]) }
              }}>
                <option value="">Choose participant...</option>
                {participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Sel>
            </div>

            {selectedParticipant && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <p style={{ fontSize: 14, fontWeight: 500 }}>
                    {selectedParticipant.name}
                    <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 400, marginLeft: 8 }}>
                      Total: {participantPredictions.reduce((s, p) => s + (p.points_earned || 0), 0)} pts
                      {Object.keys(adjustments).length > 0 && (
                        <span style={{ color: 'var(--gold)', marginLeft: 8 }}>
                          (after save: {participantPredictions.reduce((s, p) => s + (adjustments[p.id] !== undefined ? parseInt(adjustments[p.id]) || 0 : (p.points_earned || 0)), 0)} pts)
                        </span>
                      )}
                    </span>
                  </p>
                  <button onClick={saveAdjustments} disabled={loading || Object.keys(adjustments).length === 0}
                    style={{ padding: '7px 18px', background: 'var(--gold)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 500, cursor: (loading || Object.keys(adjustments).length === 0) ? 'not-allowed' : 'pointer', opacity: (loading || Object.keys(adjustments).length === 0) ? 0.5 : 1 }}>
                    Save {Object.keys(adjustments).length > 0 ? `(${Object.keys(adjustments).length} change${Object.keys(adjustments).length > 1 ? 's' : ''})` : 'changes'}
                  </button>
                </div>

                {participantPredictions.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--text3)' }}>No predictions found for this participant.</p>
                )}

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Round', 'Board', 'Matchup', 'Result', 'Their pick', 'Points', 'Override'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text2)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {participantPredictions.map(pred => {
                        const info = gameInfoMap[pred.game_id] || {}
                        const currentPts = adjustments[pred.id] !== undefined ? adjustments[pred.id] : pred.points_earned
                        const changed = adjustments[pred.id] !== undefined
                        const isCorrect = pred.prediction === info.result
                        return (
                          <tr key={pred.id} style={{ borderBottom: '1px solid var(--border)', background: changed ? 'rgba(201,168,76,0.06)' : 'transparent' }}>
                            <td style={{ padding: '10px 12px', color: 'var(--text2)' }}>R{info.round || '?'}</td>
                            <td style={{ padding: '10px 12px', color: 'var(--text2)' }}>B{info.board || '?'}</td>
                            <td style={{ padding: '10px 12px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {info.white || '?'} vs {info.black || '?'}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {info.result
                                ? <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 4, background: info.result === 'draw' ? 'var(--draw)' : info.result === 'white' ? '#e8f4e8' : '#222', color: info.result === 'draw' ? 'var(--draw-text)' : info.result === 'white' ? '#1a4a1a' : '#ccc', border: info.result === 'black' ? '1px solid #444' : 'none' }}>
                                    {info.result === 'white' ? '1–0' : info.result === 'black' ? '0–1' : '½–½'}
                                  </span>
                                : <span style={{ color: 'var(--text3)' }}>pending</span>}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ color: isCorrect ? 'var(--green)' : 'var(--text2)' }}>
                                {pred.prediction === 'white' ? '1–0' : pred.prediction === 'black' ? '0–1' : '½–½'}
                                {isCorrect && ' ✓'}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px', fontFamily: 'DM Mono', color: pred.points_earned > 0 ? 'var(--gold)' : 'var(--text3)' }}>
                              {pred.points_earned}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <input
                                type="number"
                                min={0}
                                max={99}
                                value={currentPts}
                                onChange={e => setAdjustments(prev => ({ ...prev, [pred.id]: e.target.value }))}
                                style={{ width: 64, background: changed ? 'rgba(201,168,76,0.1)' : 'var(--bg3)', border: `1px solid ${changed ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 6, color: 'var(--text)', padding: '4px 8px', fontFamily: 'DM Mono', fontSize: 13, textAlign: 'center', outline: 'none' }}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {Object.keys(adjustments).length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button onClick={() => setAdjustments({})} style={{ padding: '7px 16px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
                      Reset changes
                    </button>
                    <button onClick={saveAdjustments} disabled={loading}
                      style={{ padding: '7px 18px', background: 'var(--gold)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer' }}>
                      {loading ? 'Saving...' : `Save ${Object.keys(adjustments).length} change${Object.keys(adjustments).length > 1 ? 's' : ''}`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>)}

        {/* ── PLAYERS ── */}
        {tab === 'players' && (<>
          <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 20 }}>Chess Candidates</h2>
          <div style={s.card}>
            {players.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderBottom: i < players.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 22 }}>{p.flag}</span>
                <div><p style={{ fontWeight: 500 }}>{p.name}</p><p style={{ fontSize: 12, color: 'var(--text2)' }}>{p.country}</p></div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10 }}>Edit the <code style={{ background: 'var(--bg3)', padding: '1px 6px', borderRadius: 4 }}>chess_players</code> table in Supabase to modify players.</p>
        </>)}
      </div>

      {/* ── EDIT MODAL ── */}
      {editingRound && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: 24 }}>
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 28, width: '100%', maxWidth: 700, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ fontFamily: 'Playfair Display', fontSize: 22 }}>Edit Round {editingRound.round_number}</h2>
              <button onClick={() => setEditingRound(null)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div>
                <label style={s.lbl}>Round date</label>
                <Inp type="date" value={editMeta.round_date} onChange={e => setEditMeta(p => ({ ...p, round_date: e.target.value }))} />
              </div>
              <div>
                <label style={s.lbl}>Prediction deadline (local time)</label>
                <Inp type="datetime-local" value={editMeta.prediction_deadline} onChange={e => setEditMeta(p => ({ ...p, prediction_deadline: e.target.value }))} />
                {editMeta.prediction_deadline && <p style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>Locks: {displayLocalTime(localInputToISO(editMeta.prediction_deadline))}</p>}
              </div>
            </div>
            <label style={s.lbl}>Board pairings</label>
            {editBoards.map((board, i) => (
              <div key={board.board_number} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 30px 1fr', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--text2)' }}>Board {board.board_number}</span>
                <Sel value={board.white_player_id} onChange={e => setEditBoards(b => b.map((x, j) => j===i ? { ...x, white_player_id: e.target.value } : x))}>
                  <option value="">White player</option><PlayerOptions />
                </Sel>
                <span style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>vs</span>
                <Sel value={board.black_player_id} onChange={e => setEditBoards(b => b.map((x, j) => j===i ? { ...x, black_player_id: e.target.value } : x))}>
                  <option value="">Black player</option><PlayerOptions />
                </Sel>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button onClick={saveEdit} disabled={loading} style={{ padding: '10px 24px', background: 'var(--gold)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => setEditingRound(null)} style={{ padding: '10px 20px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 14, color: 'var(--text2)', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
