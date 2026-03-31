import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { adminAction } from '../../lib/adminApi'

// ── Auth ──
function useAdmin() {
  const [auth, setAuth] = useState(false)
  const [pw, setPw] = useState('')
  const [authError, setAuthError] = useState('')

  const check = async (currentPw) => {
    const password = currentPw !== undefined ? currentPw : pw
    if (!password) { setAuthError('Enter a password.'); return }
    sessionStorage.setItem('adminPw', password)
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-token': password },
        body: JSON.stringify({ action: 'ping', payload: {} }),
      })
      if (res.status === 401) {
        sessionStorage.removeItem('adminPw')
        setAuthError('Wrong password. Try again.')
        return
      }
      setAuth(true)
      setAuthError('')
    } catch (e) {
      setAuthError('Could not connect. Try again.')
      sessionStorage.removeItem('adminPw')
    }
  }

  useEffect(() => {
    const saved = sessionStorage.getItem('adminPw')
    if (saved) { setPw(saved); setAuth(true) }
  }, [])

  return { auth, pw, setPw, check, authError }
}

const EMPTY_BOARDS = () => [1,2,3,4].map(n => ({ board_number: n, white_player_id: '', black_player_id: '' }))

function utcToLocalInput(utcStr) {
  if (!utcStr) return ''
  const d = new Date(utcStr)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function localInputToISO(s) { return s ? new Date(s).toISOString() : '' }
function displayLocalTime(utcStr) {
  if (!utcStr) return '—'
  return new Date(utcStr).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
}

export default function Admin() {
  const { auth, pw, setPw, check, authError } = useAdmin()
  const [tab, setTab] = useState('rounds')
  const [rounds, setRounds] = useState([])
  const [players, setPlayers] = useState([])
  const [participants, setParticipants] = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  // Create round form
  const [newRound, setNewRound] = useState({ round_number: '', round_date: '', prediction_deadline: '' })
  const [boards, setBoards] = useState(EMPTY_BOARDS())

  // Edit modal
  const [editingRound, setEditingRound] = useState(null)
  const [editBoards, setEditBoards] = useState(EMPTY_BOARDS())
  const [editMeta, setEditMeta] = useState({ round_date: '', prediction_deadline: '' })

  // Points tab
  const [selectedParticipant, setSelectedParticipant] = useState(null)
  const [participantPredictions, setParticipantPredictions] = useState([])
  const [adjustments, setAdjustments] = useState({})
  const [bonusParticipant, setBonusParticipant] = useState('')
  const [bonusPoints, setBonusPoints] = useState('')
  const [bonusNote, setBonusNote] = useState('')
  const [fetchingRound, setFetchingRound] = useState(null) // roundId being fetched
  const [fetchPreview, setFetchPreview] = useState({})    // roundId -> fetched results array

  useEffect(() => { if (auth) loadAll() }, [auth])

  // ── All reads use the anon supabase client (public data) ──
  async function loadAll() {
    const [{ data: roundsData }, { data: gamesData }, { data: playersData }, { data: participantsData }] = await Promise.all([
      supabase.from('rounds').select('*').order('round_number'),
      supabase.from('games').select('*').order('board_number'),
      supabase.from('chess_players').select('*').order('display_order'),
      supabase.from('participants').select('*').order('name'),
    ])
    if (playersData) setPlayers(playersData)
    if (participantsData) setParticipants(participantsData)
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

  // ── All writes go through adminAction (server-side API with service_role) ──
  async function createRound() {
    if (!newRound.round_number || !newRound.round_date || !newRound.prediction_deadline)
      return flash('Error: Fill in round number, date, and deadline.')
    const validBoards = boards.filter(b => b.white_player_id && b.black_player_id)
    if (validBoards.length < 4) return flash('Error: Set all 4 board pairings.')
    setLoading(true)
    try {
      await adminAction('createRound', {
        round_number: parseInt(newRound.round_number),
        round_date: newRound.round_date,
        prediction_deadline: localInputToISO(newRound.prediction_deadline),
        boards: validBoards,
      })
      flash('✓ Round ' + newRound.round_number + ' created!')
      setNewRound({ round_number: '', round_date: '', prediction_deadline: '' })
      setBoards(EMPTY_BOARDS())
      await loadAll()
    } catch (e) { flash('Error: ' + e.message) }
    setLoading(false)
  }

  async function deleteRound(round) {
    if (!confirm(`Delete Round ${round.round_number}?\n\nThis permanently removes all games and predictions.`)) return
    setLoading(true)
    try {
      await adminAction('deleteRound', { id: round.id, gameIds: round.games.map(g => g.id) })
      flash('✓ Round ' + round.round_number + ' deleted.')
      await loadAll()
    } catch (e) { flash('Error: ' + e.message) }
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
      await adminAction('updateRound', {
        id: editingRound.id,
        round_date: editMeta.round_date,
        prediction_deadline: localInputToISO(editMeta.prediction_deadline),
        boards: editBoards,
      })
      flash('✓ Round updated!')
      setEditingRound(null)
      await loadAll()
    } catch (e) { flash('Error: ' + e.message) }
    setLoading(false)
  }

  async function setResult(gameId, result, currentResult) {
    if (currentResult === result) { await clearResult(gameId); return }
    setLoading(true)
    try {
      await adminAction('setResult', { gameId, result })
      await loadAll()
      flash('✓ Result saved & scores recalculated')
    } catch (e) { flash('Error: ' + e.message) }
    setLoading(false)
  }

  async function clearResult(gameId) {
    setLoading(true)
    try {
      await adminAction('clearResult', { gameId })
      await loadAll()
      flash('Result cleared — points reset to 0')
    } catch (e) { flash('Error: ' + e.message) }
    setLoading(false)
  }

  async function fetchResultsFromFIDE(round) {
    setFetchingRound(round.id)
    try {
      const games = round.games.map(g => ({
        board_number: g.board_number,
        game_id: g.id,
        white_player: g.white_player?.name || '',
        black_player: g.black_player?.name || '',
      }))
      const res = await fetch('/api/admin/fetch-results', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': sessionStorage.getItem('adminPw') || '',
        },
        body: JSON.stringify({ round_number: round.round_number, games }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setFetchPreview(prev => ({ ...prev, [round.id]: data }))
      flash(data.note || '✓ Results fetched')
    } catch (e) {
      flash('Error fetching: ' + e.message)
    }
    setFetchingRound(null)
  }

  async function applyFetchedResults(round) {
    const preview = fetchPreview[round.id]
    if (!preview) return
    setLoading(true)
    let applied = 0
    for (const r of preview.results) {
      if (!r.result || !r.game_id) continue
      try {
        await adminAction('setResult', { gameId: r.game_id, result: r.result })
        applied++
      } catch (e) { console.error(e) }
    }
    await loadAll()
    setFetchPreview(prev => { const n = {...prev}; delete n[round.id]; return n })
    flash(`✓ Applied ${applied} result${applied !== 1 ? 's' : ''} and updated all scores`)
    setLoading(false)
  }

  async function markRoundComplete(round, complete) {
    setLoading(true)
    try {
      await adminAction('markRoundComplete', { id: round.id, complete })
      if (complete) {
        await adminAction('rescoreRound', { games: round.games.map(g => ({ id: g.id, result: g.result })) })
        flash('✓ Round marked complete — scores verified')
      } else {
        flash('✓ Round reopened')
      }
      await loadAll()
    } catch (e) { flash('Error: ' + e.message) }
    setLoading(false)
  }

  async function loadParticipantPredictions(participantId) {
    const { data } = await supabase.from('predictions').select('*').eq('participant_id', participantId).order('created_at')
    setParticipantPredictions(data || [])
    setAdjustments({})
  }

  async function saveAdjustments() {
    if (Object.keys(adjustments).length === 0) { flash('No changes to save.'); return }
    setLoading(true)
    try {
      const updates = Object.entries(adjustments).map(([id, pts]) => ({ id, points_earned: Math.max(0, parseInt(pts) || 0) }))
      await adminAction('updatePredictionPoints', { updates })
      flash('✓ Points updated!')
      await loadParticipantPredictions(selectedParticipant.id)
    } catch (e) { flash('Error: ' + e.message) }
    setLoading(false)
  }

  async function applyBonus() {
    if (!bonusParticipant || !bonusPoints) return flash('Error: Select participant and enter points.')
    const pts = parseInt(bonusPoints)
    if (isNaN(pts)) return flash('Error: Enter a valid number.')
    setLoading(true)
    try {
      await adminAction('applyBonus', { participantId: bonusParticipant, points: pts })
      const name = participants.find(p => p.id === bonusParticipant)?.name
      flash(`✓ ${pts >= 0 ? '+' : ''}${pts} points applied to ${name}`)
      setBonusPoints(''); setBonusNote('')
      if (selectedParticipant?.id === bonusParticipant) await loadParticipantPredictions(bonusParticipant)
    } catch (e) { flash('Error: ' + e.message) }
    setLoading(false)
  }

  // Build game info map for points tab
  const gameInfoMap = {}
  rounds.forEach(r => r.games.forEach(g => {
    gameInfoMap[g.id] = { round: r.round_number, board: g.board_number, white: g.white_player?.name, black: g.black_player?.name, result: g.result }
  }))

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
        <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 6 }}>♟ Admin Panel</h2>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>Enter your admin password to continue.</p>
        <label style={s.lbl}>Password</label>
        <Inp type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && check(e.target.value)} placeholder="Admin password" style={{ ...s.inp, marginBottom: authError ? 8 : 16 }} />
        {authError && <p style={{ fontSize: 13, color: 'var(--red)', marginBottom: 12 }}>{authError}</p>}
        <button onClick={() => check(pw)} style={{ width: '100%', padding: 12, background: 'var(--gold)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Enter</button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'DM Sans, sans-serif', color: 'var(--text)' }}>
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 24, position: 'sticky', top: 0, zIndex: 50 }}>
        <span style={{ fontFamily: 'Playfair Display', color: 'var(--gold)', fontSize: 18 }}>♟ Admin</span>
        {['rounds','results','points','players'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background: 'none', border: 'none', borderBottom: tab===t ? '2px solid var(--gold)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'DM Sans', color: tab===t ? 'var(--text)' : 'var(--text2)', fontWeight: tab===t ? 500 : 400, fontSize: 14, paddingBottom: 4, textTransform: 'capitalize' }}>{t}</button>
        ))}
        <button onClick={() => { sessionStorage.removeItem('adminPw'); window.location.reload() }} style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 12px', fontSize: 12, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'DM Sans' }}>Log out</button>
        <a href="/" style={{ fontSize: 13, color: 'var(--text2)' }}>← Public site</a>
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
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16, padding: '8px 12px', background: 'var(--bg3)', borderRadius: 6 }}>ℹ Times are entered and displayed in your local timezone.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div><label style={s.lbl}>Round number</label><Inp type="number" value={newRound.round_number} min={1} max={14} placeholder="1" onChange={e => setNewRound(p => ({ ...p, round_number: e.target.value }))} /></div>
              <div><label style={s.lbl}>Date</label><Inp type="date" value={newRound.round_date} onChange={e => setNewRound(p => ({ ...p, round_date: e.target.value }))} /></div>
              <div>
                <label style={s.lbl}>Prediction deadline (local time)</label>
                <Inp type="datetime-local" value={newRound.prediction_deadline} onChange={e => setNewRound(p => ({ ...p, prediction_deadline: e.target.value }))} />
                {newRound.prediction_deadline && <p style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>Locks: {displayLocalTime(localInputToISO(newRound.prediction_deadline))}</p>}
              </div>
            </div>
            <label style={s.lbl}>Board pairings</label>
            {boards.map((board, i) => (
              <div key={board.board_number} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 30px 1fr', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--text2)' }}>Board {board.board_number}</span>
                <Sel value={board.white_player_id} onChange={e => setBoards(b => b.map((x,j) => j===i ? {...x, white_player_id: e.target.value} : x))}><option value="">White player</option><PlayerOptions /></Sel>
                <span style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>vs</span>
                <Sel value={board.black_player_id} onChange={e => setBoards(b => b.map((x,j) => j===i ? {...x, black_player_id: e.target.value} : x))}><option value="">Black player</option><PlayerOptions /></Sel>
              </div>
            ))}
            <button onClick={createRound} disabled={loading} style={{ marginTop: 16, padding: '10px 24px', background: 'var(--gold)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>{loading ? 'Creating...' : 'Create Round'}</button>
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
                    : <button onClick={() => markRoundComplete(r, true)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid rgba(76,175,120,0.4)', color: 'var(--green)', fontFamily: 'DM Sans' }}>Mark complete</button>}
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
                  {g.result && <span style={{ marginLeft: 'auto', fontSize: 11, padding: '1px 8px', borderRadius: 4, background: g.result==='draw' ? 'var(--draw)' : g.result==='white' ? '#e8f4e8' : '#1a1a1a', color: g.result==='draw' ? 'var(--draw-text)' : g.result==='white' ? '#1a4a1a' : '#ccc', border: g.result==='black' ? '1px solid #444' : 'none' }}>{g.result==='white' ? '1–0' : g.result==='black' ? '0–1' : '½–½'}</span>}
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
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => fetchResultsFromFIDE(round)}
                    disabled={fetchingRound === round.id || loading}
                    style={{ padding: '4px 14px', borderRadius: 6, fontSize: 12, cursor: (fetchingRound === round.id || loading) ? 'not-allowed' : 'pointer', background: 'none', border: '1px solid rgba(201,168,76,0.5)', color: 'var(--gold)', fontFamily: 'DM Sans', opacity: (fetchingRound === round.id || loading) ? 0.6 : 1 }}>
                    {fetchingRound === round.id ? '⏳ Fetching...' : '⬇ Auto-fetch from FIDE'}
                  </button>
                  {round.is_complete
                    ? <><span style={{ fontSize: 12, color: 'var(--green)' }}>✓ Complete</span><button onClick={() => markRoundComplete(round, false)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontFamily: 'DM Sans' }}>Reopen</button></>
                    : <button onClick={() => markRoundComplete(round, true)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid rgba(76,175,120,0.4)', color: 'var(--green)', fontFamily: 'DM Sans' }}>Mark complete</button>}
                </div>
              </div>
              {round.games.length === 0 && <p style={{ fontSize: 13, color: 'var(--text3)' }}>No games for this round.</p>}

              {/* Auto-fetch preview panel */}
              {fetchPreview[round.id] && (
                <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 8, background: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <p style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 500 }}>
                      ⬇ Fetched from FIDE — {fetchPreview[round.id].note}
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => applyFetchedResults(round)}
                        disabled={loading || !fetchPreview[round.id].results.some(r => r.result)}
                        style={{ padding: '5px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'var(--gold)', border: 'none', color: '#0a0a0a', fontFamily: 'DM Sans', fontWeight: 500, opacity: loading ? 0.6 : 1 }}>
                        {loading ? 'Applying...' : 'Apply all ✓'}
                      </button>
                      <button
                        onClick={() => setFetchPreview(prev => { const n={...prev}; delete n[round.id]; return n })}
                        style={{ padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontFamily: 'DM Sans' }}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                  {fetchPreview[round.id].results.map(r => (
                    <div key={r.board_number} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', borderTop: '1px solid rgba(201,168,76,0.15)', fontSize: 13 }}>
                      <span style={{ color: 'var(--text3)', minWidth: 55 }}>Board {r.board_number}</span>
                      <span style={{ flex: 1 }}>{r.white_player}</span>
                      {r.result ? (
                        <span style={{ padding: '2px 10px', borderRadius: 4, fontSize: 12, fontFamily: 'DM Mono', fontWeight: 500,
                          background: r.result === 'draw' ? 'var(--draw)' : r.result === 'white' ? '#e8f4e8' : '#1a1a1a',
                          color: r.result === 'draw' ? 'var(--draw-text)' : r.result === 'white' ? '#1a4a1a' : '#ccc',
                          border: r.result === 'black' ? '1px solid #444' : 'none',
                        }}>
                          {r.result === 'white' ? '1–0' : r.result === 'black' ? '0–1' : '½–½'}
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>not found / in progress</span>
                      )}
                      <span style={{ flex: 1, textAlign: 'right' }}>{r.black_player}</span>
                    </div>
                  ))}
                </div>
              )}

              {round.games.map(game => (
                <div key={game.id} style={{ display: 'grid', gridTemplateColumns: '55px 1fr auto 1fr', gap: 12, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>Board {game.board_number}</span>
                  <span style={{ fontSize: 14, fontFamily: 'Playfair Display' }}>{game.white_player?.flag} {game.white_player?.name || '?'}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[{val:'white',label:'1–0'},{val:'draw',label:'½–½'},{val:'black',label:'0–1'}].map(opt => (
                      <button key={opt.val} onClick={() => setResult(game.id, opt.val, game.result)} disabled={loading} style={{ padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'DM Mono', border: `1px solid ${game.result===opt.val ? 'var(--gold)' : 'var(--border)'}`, background: game.result===opt.val ? 'var(--gold-dim)' : 'var(--bg3)', color: game.result===opt.val ? 'var(--gold-light)' : 'var(--text2)', fontWeight: game.result===opt.val ? 600 : 400 }}>{opt.label}</button>
                    ))}
                    {game.result && <button onClick={() => clearResult(game.id)} style={{ padding: '7px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontFamily: 'DM Sans' }}>✕</button>}
                  </div>
                  <span style={{ fontSize: 14, fontFamily: 'Playfair Display', textAlign: 'right' }}>{game.black_player?.name || '?'} {game.black_player?.flag}</span>
                </div>
              ))}
            </div>
          ))}
        </>)}

        {/* ── POINTS ── */}
        {tab === 'points' && (<>
          <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 8 }}>Points Adjustment</h2>
          <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 24 }}>Manually correct or bonus points for any participant.</p>

          <div style={s.card}>
            <h3 style={{ fontFamily: 'Playfair Display', fontSize: 17, marginBottom: 4 }}>Quick bonus / deduction</h3>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>Add or subtract points from a participant's total in one step.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr auto', gap: 12, alignItems: 'flex-end' }}>
              <div><label style={s.lbl}>Participant</label><Sel value={bonusParticipant} onChange={e => setBonusParticipant(e.target.value)}><option value="">Select...</option>{participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel></div>
              <div><label style={s.lbl}>Points (±)</label><Inp type="number" value={bonusPoints} onChange={e => setBonusPoints(e.target.value)} placeholder="+4 or -2" /></div>
              <div><label style={s.lbl}>Note (optional)</label><Inp type="text" value={bonusNote} onChange={e => setBonusNote(e.target.value)} placeholder="e.g. tiebreaker" /></div>
              <button onClick={applyBonus} disabled={loading} style={{ padding: '8px 20px', background: 'var(--gold)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, whiteSpace: 'nowrap' }}>Apply</button>
            </div>
          </div>

          <div style={s.card}>
            <h3 style={{ fontFamily: 'Playfair Display', fontSize: 17, marginBottom: 4 }}>Edit individual predictions</h3>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>Select a participant to view and override points for each of their predictions.</p>
            <div style={{ marginBottom: 20 }}>
              <label style={s.lbl}>Select participant</label>
              <Sel value={selectedParticipant?.id || ''} onChange={async e => {
                const p = participants.find(x => x.id === e.target.value)
                setSelectedParticipant(p || null)
                if (p) await loadParticipantPredictions(p.id)
                else setParticipantPredictions([])
              }}><option value="">Choose participant...</option>{participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
            </div>

            {selectedParticipant && (<>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <p style={{ fontSize: 14, fontWeight: 500 }}>
                  {selectedParticipant.name}
                  <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 400, marginLeft: 8 }}>
                    Current total: {participantPredictions.reduce((s,p) => s + (p.points_earned||0), 0)} pts
                    {Object.keys(adjustments).length > 0 && <span style={{ color: 'var(--gold)', marginLeft: 8 }}>→ after save: {participantPredictions.reduce((s,p) => s + (adjustments[p.id] !== undefined ? (parseInt(adjustments[p.id])||0) : (p.points_earned||0)), 0)} pts</span>}
                  </span>
                </p>
                <button onClick={saveAdjustments} disabled={loading || !Object.keys(adjustments).length} style={{ padding: '7px 18px', background: 'var(--gold)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 500, cursor: (loading||!Object.keys(adjustments).length) ? 'not-allowed' : 'pointer', opacity: (loading||!Object.keys(adjustments).length) ? 0.5 : 1 }}>
                  Save {Object.keys(adjustments).length > 0 ? `(${Object.keys(adjustments).length})` : ''}
                </button>
              </div>
              {participantPredictions.length === 0 && <p style={{ fontSize: 13, color: 'var(--text3)' }}>No predictions found.</p>}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['Round','Board','Matchup','Result','Their pick','Auto pts','Override'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text2)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {participantPredictions.map(pred => {
                      const info = gameInfoMap[pred.game_id] || {}
                      const curVal = adjustments[pred.id] !== undefined ? adjustments[pred.id] : pred.points_earned
                      const changed = adjustments[pred.id] !== undefined
                      return (
                        <tr key={pred.id} style={{ borderBottom: '1px solid var(--border)', background: changed ? 'rgba(201,168,76,0.06)' : 'transparent' }}>
                          <td style={{ padding: '10px 12px', color: 'var(--text2)' }}>R{info.round||'?'}</td>
                          <td style={{ padding: '10px 12px', color: 'var(--text2)' }}>B{info.board||'?'}</td>
                          <td style={{ padding: '10px 12px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.white||'?'} vs {info.black||'?'}</td>
                          <td style={{ padding: '10px 12px' }}>{info.result ? <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 4, background: info.result==='draw'?'var(--draw)':info.result==='white'?'#e8f4e8':'#222', color: info.result==='draw'?'var(--draw-text)':info.result==='white'?'#1a4a1a':'#ccc', border: info.result==='black'?'1px solid #444':'none' }}>{info.result==='white'?'1–0':info.result==='black'?'0–1':'½–½'}</span> : <span style={{ color: 'var(--text3)' }}>pending</span>}</td>
                          <td style={{ padding: '10px 12px', color: pred.prediction===info.result ? 'var(--green)' : 'var(--text2)' }}>{pred.prediction==='white'?'1–0':pred.prediction==='black'?'0–1':'½–½'}{pred.prediction===info.result?' ✓':''}</td>
                          <td style={{ padding: '10px 12px', fontFamily: 'DM Mono', color: pred.points_earned > 0 ? 'var(--gold)' : 'var(--text3)' }}>{pred.points_earned}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <input type="number" min={0} max={99} value={curVal} onChange={e => setAdjustments(prev => ({ ...prev, [pred.id]: e.target.value }))}
                              style={{ width: 64, background: changed ? 'rgba(201,168,76,0.1)' : 'var(--bg3)', border: `1px solid ${changed ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 6, color: 'var(--text)', padding: '4px 8px', fontFamily: 'DM Mono', fontSize: 13, textAlign: 'center', outline: 'none' }} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {Object.keys(adjustments).length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => setAdjustments({})} style={{ padding: '7px 16px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>Reset</button>
                  <button onClick={saveAdjustments} disabled={loading} style={{ padding: '7px 18px', background: 'var(--gold)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 13, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer' }}>{loading ? 'Saving...' : `Save ${Object.keys(adjustments).length} change${Object.keys(adjustments).length>1?'s':''}`}</button>
                </div>
              )}
            </>)}
          </div>
        </>)}

        {/* ── PLAYERS ── */}
        {tab === 'players' && (<>
          <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 20 }}>Chess Candidates</h2>
          <div style={s.card}>
            {players.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0', borderBottom: i < players.length-1 ? '1px solid var(--border)' : 'none' }}>
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
              <div><label style={s.lbl}>Round date</label><Inp type="date" value={editMeta.round_date} onChange={e => setEditMeta(p => ({ ...p, round_date: e.target.value }))} /></div>
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
                <Sel value={board.white_player_id} onChange={e => setEditBoards(b => b.map((x,j) => j===i ? {...x, white_player_id: e.target.value} : x))}><option value="">White player</option><PlayerOptions /></Sel>
                <span style={{ textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>vs</span>
                <Sel value={board.black_player_id} onChange={e => setEditBoards(b => b.map((x,j) => j===i ? {...x, black_player_id: e.target.value} : x))}><option value="">Black player</option><PlayerOptions /></Sel>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button onClick={saveEdit} disabled={loading} style={{ padding: '10px 24px', background: 'var(--gold)', border: 'none', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>{loading ? 'Saving...' : 'Save Changes'}</button>
              <button onClick={() => setEditingRound(null)} style={{ padding: '10px 20px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'DM Sans', fontSize: 14, color: 'var(--text2)', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
