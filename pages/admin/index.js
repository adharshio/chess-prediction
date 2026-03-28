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
  useEffect(() => {
    if (sessionStorage.getItem('admin') === '1') setAuth(true)
  }, [])
  return { auth, pw, setPw, check }
}

const EMPTY_BOARDS = () => [1,2,3,4].map(n => ({ board_number: n, white_player_id: '', black_player_id: '' }))

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

  useEffect(() => { if (auth) loadAll() }, [auth])

  async function loadAll() {
    const [{ data: roundsData }, { data: gamesData }, { data: playersData }] = await Promise.all([
      supabase.from('rounds').select('*').order('round_number'),
      supabase.from('games').select('*').order('board_number'),
      supabase.from('chess_players').select('*').order('display_order'),
    ])
    if (playersData) setPlayers(playersData)
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
        prediction_deadline: newRound.prediction_deadline,
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
    setEditMeta({
      round_date: round.round_date,
      prediction_deadline: round.prediction_deadline ? round.prediction_deadline.slice(0, 16) : '',
    })
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
        prediction_deadline: editMeta.prediction_deadline,
      }).eq('id', editingRound.id)
      if (rErr) throw rErr
      for (const board of editBoards) {
        if (!board.game_id) continue
        const { error: gErr } = await supabase.from('games').update({
          white_player_id: board.white_player_id,
          black_player_id: board.black_player_id,
        }).eq('id', board.game_id)
        if (gErr) throw gErr
      }
      flash('✓ Round updated!')
      setEditingRound(null)
      await loadAll()
    } catch (e) { flash('Error: ' + e.message) }
    setLoading(false)
  }

  async function setResult(gameId, result) {
    setLoading(true)
    const { error } = await supabase.from('games').update({ result }).eq('id', gameId)
    if (!error) {
      const { data: preds } = await supabase.from('predictions').select('id, prediction').eq('game_id', gameId)
      if (preds) {
        for (const p of preds) {
          const pts = p.prediction === result ? (result === 'draw' ? 1 : 4) : 0
          await supabase.from('predictions').update({ points_earned: pts }).eq('id', p.id)
        }
      }
      await loadAll()
      flash('✓ Result saved & scores updated')
    } else flash('Error: ' + error.message)
    setLoading(false)
  }

  async function clearResult(gameId) {
    await supabase.from('games').update({ result: null }).eq('id', gameId)
    await supabase.from('predictions').update({ points_earned: 0 }).eq('game_id', gameId)
    await loadAll()
    flash('Result cleared')
  }

  async function markRoundComplete(roundId, complete) {
    await supabase.from('rounds').update({ is_complete: complete }).eq('id', roundId)
    await loadAll()
    flash(complete ? '✓ Round marked complete' : '✓ Round reopened')
  }

  const s = {
    card: { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '20px 24px', marginBottom: 16 },
    inp: { width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '8px 12px', fontFamily: 'DM Sans', fontSize: 14, outline: 'none' },
    lbl: { display: 'block', fontSize: 11, color: 'var(--text2)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 },
  }

  const Inp = ({ ...props }) => <input style={s.inp} {...props} />
  const Sel = ({ children, ...props }) => (
    <select style={{ ...s.inp, color: props.value ? 'var(--text)' : 'var(--text3)' }} {...props}>{children}</select>
  )
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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'DM Sans, sans-serif', color: 'var(--text)' }}>

      {/* Nav */}
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 24, position: 'sticky', top: 0, zIndex: 50 }}>
        <span style={{ fontFamily: 'Playfair Display', color: 'var(--gold)', fontSize: 18 }}>♟ Admin</span>
        {['rounds', 'results', 'players'].map(t => (
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div><label style={s.lbl}>Round number</label><Inp type="number" value={newRound.round_number} min={1} max={14} placeholder="1" onChange={e => setNewRound(p => ({ ...p, round_number: e.target.value }))} /></div>
              <div><label style={s.lbl}>Date</label><Inp type="date" value={newRound.round_date} onChange={e => setNewRound(p => ({ ...p, round_date: e.target.value }))} /></div>
              <div><label style={s.lbl}>Prediction deadline</label><Inp type="datetime-local" value={newRound.prediction_deadline} onChange={e => setNewRound(p => ({ ...p, prediction_deadline: e.target.value }))} /></div>
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
                  <span style={{ fontWeight: 500, fontSize: 15 }}>Round {r.round_number}</span>
                  <span style={{ fontSize: 13, color: 'var(--text2)', marginLeft: 12 }}>{r.round_date}</span>
                  {r.prediction_deadline && <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 12 }}>🔒 {new Date(r.prediction_deadline).toLocaleString()}</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {r.is_complete
                    ? <button onClick={() => markRoundComplete(r.id, false)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontFamily: 'DM Sans' }}>Reopen</button>
                    : <button onClick={() => markRoundComplete(r.id, true)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid rgba(76,175,120,0.4)', color: 'var(--green)', fontFamily: 'DM Sans' }}>Mark complete</button>
                  }
                  <button onClick={() => openEdit(r)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid rgba(201,168,76,0.4)', color: 'var(--gold)', fontFamily: 'DM Sans' }}>✏ Edit</button>
                  <button onClick={() => deleteRound(r)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid rgba(224,85,85,0.4)', color: 'var(--red)', fontFamily: 'DM Sans' }}>🗑 Delete</button>
                </div>
              </div>
              {r.games.map(g => (
                <div key={g.id} style={{ fontSize: 13, color: 'var(--text2)', padding: '6px 0', borderTop: '1px solid var(--border)', display: 'flex', gap: 10 }}>
                  <span style={{ color: 'var(--text3)', minWidth: 60 }}>Board {g.board_number}</span>
                  <span>{g.white_player?.flag} {g.white_player?.name || <span style={{ color: 'var(--red)' }}>⚠ missing</span>}</span>
                  <span style={{ color: 'var(--text3)' }}>vs</span>
                  <span>{g.black_player?.name || <span style={{ color: 'var(--red)' }}>⚠ missing</span>} {g.black_player?.flag}</span>
                </div>
              ))}
            </div>
          ))}
        </>)}

        {/* ── RESULTS ── */}
        {tab === 'results' && (<>
          <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 8 }}>Enter Results</h2>
          <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 24 }}>Click a result — points are calculated and saved instantly.</p>
          {rounds.map(round => (
            <div key={round.id} style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontFamily: 'Playfair Display', fontSize: 18 }}>Round {round.round_number} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text2)' }}>{round.round_date}</span></h3>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {round.is_complete && <span style={{ fontSize: 12, color: 'var(--green)' }}>✓ Complete</span>}
                  {!round.is_complete && <button onClick={() => markRoundComplete(round.id, true)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid rgba(76,175,120,0.4)', color: 'var(--green)', fontFamily: 'DM Sans' }}>Mark complete</button>}
                </div>
              </div>
              {round.games.length === 0 && <p style={{ fontSize: 13, color: 'var(--text3)' }}>No games for this round.</p>}
              {round.games.map(game => (
                <div key={game.id} style={{ display: 'grid', gridTemplateColumns: '55px 1fr auto 1fr', gap: 12, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>Board {game.board_number}</span>
                  <span style={{ fontSize: 14, fontFamily: 'Playfair Display' }}>{game.white_player?.flag} {game.white_player?.name || '?'}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[{ val: 'white', label: '1–0' }, { val: 'draw', label: '½–½' }, { val: 'black', label: '0–1' }].map(opt => (
                      <button key={opt.val} onClick={() => setResult(game.id, opt.val)} disabled={loading} style={{
                        padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontFamily: 'DM Mono',
                        border: `1px solid ${game.result === opt.val ? 'var(--gold)' : 'var(--border)'}`,
                        background: game.result === opt.val ? 'var(--gold-dim)' : 'var(--bg3)',
                        color: game.result === opt.val ? 'var(--gold-light)' : 'var(--text2)',
                        fontWeight: game.result === opt.val ? 600 : 400,
                      }}>{opt.label}</button>
                    ))}
                    {game.result && <button onClick={() => clearResult(game.id)} title="Clear" style={{ padding: '7px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontFamily: 'DM Sans' }}>✕</button>}
                  </div>
                  <span style={{ fontSize: 14, fontFamily: 'Playfair Display', textAlign: 'right' }}>{game.black_player?.name || '?'} {game.black_player?.flag}</span>
                </div>
              ))}
            </div>
          ))}
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
              <button onClick={() => setEditingRound(null)} style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              <div><label style={s.lbl}>Round date</label><Inp type="date" value={editMeta.round_date} onChange={e => setEditMeta(p => ({ ...p, round_date: e.target.value }))} /></div>
              <div><label style={s.lbl}>Prediction deadline</label><Inp type="datetime-local" value={editMeta.prediction_deadline} onChange={e => setEditMeta(p => ({ ...p, prediction_deadline: e.target.value }))} /></div>
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
