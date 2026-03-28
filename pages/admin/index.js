import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { format, addDays } from 'date-fns'

// Simple admin check
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

export default function Admin() {
  const { auth, pw, setPw, check } = useAdmin()
  const [tab, setTab] = useState('rounds')
  const [rounds, setRounds] = useState([])
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  // New round form
  const [newRound, setNewRound] = useState({
    round_number: '',
    round_date: '',
    prediction_deadline: '',
  })
  const [boards, setBoards] = useState([
    { board_number: 1, white_player_id: '', black_player_id: '' },
    { board_number: 2, white_player_id: '', black_player_id: '' },
    { board_number: 3, white_player_id: '', black_player_id: '' },
    { board_number: 4, white_player_id: '', black_player_id: '' },
  ])

  useEffect(() => {
    if (auth) { loadRounds(); loadPlayers() }
  }, [auth])

  async function loadRounds() {
    const { data } = await supabase
      .from('rounds')
      .select('*, games(*, white_player:chess_players!games_white_player_id_fkey(*), black_player:chess_players!games_black_player_id_fkey(*))')
      .order('round_number')
    if (data) setRounds(data)
  }

  async function loadPlayers() {
    const { data } = await supabase.from('chess_players').select('*').order('display_order')
    if (data) setPlayers(data)
  }

  async function createRound() {
    setLoading(true); setMsg('')
    try {
      const { data: round, error } = await supabase
        .from('rounds')
        .insert({
          round_number: parseInt(newRound.round_number),
          round_date: newRound.round_date,
          prediction_deadline: newRound.prediction_deadline,
        })
        .select().single()
      if (error) throw error

      const gameRows = boards.filter(b => b.white_player_id && b.black_player_id).map(b => ({
        round_id: round.id,
        board_number: b.board_number,
        white_player_id: b.white_player_id,
        black_player_id: b.black_player_id,
      }))
      const { error: gErr } = await supabase.from('games').insert(gameRows)
      if (gErr) throw gErr

      setMsg('✓ Round created!')
      setNewRound({ round_number: '', round_date: '', prediction_deadline: '' })
      setBoards([1,2,3,4].map(n => ({ board_number: n, white_player_id: '', black_player_id: '' })))
      await loadRounds()
    } catch (e) { setMsg('Error: ' + e.message) }
    setLoading(false)
  }

  async function setResult(gameId, result, roundId) {
    setLoading(true)
    const { error } = await supabase.from('games').update({ result }).eq('id', gameId)
    if (!error) {
      await scoreGame(gameId, result)
      await loadRounds()
      setMsg('✓ Result saved & scores updated')
    } else setMsg('Error: ' + error.message)
    setLoading(false)
  }

  async function scoreGame(gameId, result) {
    // Get all predictions for this game
    const { data: preds } = await supabase
      .from('predictions')
      .select('id, prediction')
      .eq('game_id', gameId)

    if (!preds) return

    const updates = preds.map(p => ({
      id: p.id,
      points_earned: p.prediction === result
        ? (result === 'draw' ? 1 : 3)
        : 0,
    }))

    for (const u of updates) {
      await supabase.from('predictions').update({ points_earned: u.points_earned }).eq('id', u.id)
    }
  }

  async function markRoundComplete(roundId) {
    await supabase.from('rounds').update({ is_complete: true }).eq('id', roundId)
    await loadRounds()
    setMsg('✓ Round marked complete')
  }

  async function clearResult(gameId) {
    await supabase.from('games').update({ result: null }).eq('id', gameId)
    await supabase.from('predictions').update({ points_earned: 0 }).eq('game_id', gameId)
    await loadRounds()
    setMsg('Result cleared')
  }

  if (!auth) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', fontFamily: 'DM Sans, sans-serif' }}>
      <div className="card" style={{ width: 360, background: 'var(--bg2)' }}>
        <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 20 }}>♟ Admin Panel</h2>
        <label>Password</label>
        <input type="password" value={pw} onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && check()} placeholder="Enter admin password" style={{ marginBottom: 16 }} />
        <button className="btn-gold" onClick={check} style={{ width: '100%', justifyContent: 'center' }}>Enter</button>
      </div>
    </div>
  )

  const TABS = ['rounds', 'results', 'players']

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'DM Sans, sans-serif', color: 'var(--text)' }}>
      <div style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--border)', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 24 }}>
        <span style={{ fontFamily: 'Playfair Display', color: 'var(--gold)', fontSize: 18 }}>♟ Admin</span>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'DM Sans',
            color: tab === t ? 'var(--text)' : 'var(--text2)', fontWeight: tab === t ? 500 : 400,
            fontSize: 14, borderBottom: tab === t ? '2px solid var(--gold)' : '2px solid transparent', paddingBottom: 4,
          }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <a href="/" style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text2)' }}>← Public site</a>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        {msg && (
          <div style={{ padding: '10px 16px', marginBottom: 24, borderRadius: 8, background: msg.startsWith('✓') ? 'rgba(76,175,120,0.12)' : 'rgba(224,85,85,0.12)', color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)', fontSize: 14 }}>
            {msg}
          </div>
        )}

        {/* Create Round */}
        {tab === 'rounds' && (
          <div>
            <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 24 }}>Create Round</h2>
            <div className="card" style={{ marginBottom: 32 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
                <div>
                  <label>Round number</label>
                  <input type="number" value={newRound.round_number} onChange={e => setNewRound(p => ({ ...p, round_number: e.target.value }))} placeholder="1" min="1" max="14" />
                </div>
                <div>
                  <label>Date</label>
                  <input type="date" value={newRound.round_date} onChange={e => setNewRound(p => ({ ...p, round_date: e.target.value }))} />
                </div>
                <div>
                  <label>Prediction deadline (local time)</label>
                  <input type="datetime-local" value={newRound.prediction_deadline} onChange={e => setNewRound(p => ({ ...p, prediction_deadline: e.target.value }))} />
                </div>
              </div>

              <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Board pairings</p>
              {boards.map((board, i) => (
                <div key={board.board_number} style={{ display: 'grid', gridTemplateColumns: '60px 1fr 40px 1fr', gap: 12, alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text2)' }}>Board {board.board_number}</span>
                  <select value={board.white_player_id} onChange={e => setBoards(b => b.map((x, j) => j === i ? { ...x, white_player_id: e.target.value } : x))}>
                    <option value="">White player</option>
                    {players.map(p => <option key={p.id} value={p.id}>{p.flag} {p.name}</option>)}
                  </select>
                  <span style={{ textAlign: 'center', color: 'var(--text3)' }}>vs</span>
                  <select value={board.black_player_id} onChange={e => setBoards(b => b.map((x, j) => j === i ? { ...x, black_player_id: e.target.value } : x))}>
                    <option value="">Black player</option>
                    {players.map(p => <option key={p.id} value={p.id}>{p.flag} {p.name}</option>)}
                  </select>
                </div>
              ))}

              <button className="btn-gold" onClick={createRound} disabled={loading} style={{ marginTop: 16 }}>
                {loading ? 'Creating...' : 'Create Round'}
              </button>
            </div>

            {/* Existing rounds list */}
            <h3 style={{ fontFamily: 'Playfair Display', marginBottom: 16 }}>All Rounds</h3>
            {rounds.map(r => (
              <div key={r.id} className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500 }}>Round {r.round_number} · {r.round_date}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {r.is_complete
                      ? <span style={{ fontSize: 12, color: 'var(--green)' }}>✓ Complete</span>
                      : <button className="btn-outline" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => markRoundComplete(r.id)}>Mark complete</button>
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Enter Results */}
        {tab === 'results' && (
          <div>
            <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 24 }}>Enter Results</h2>
            {rounds.map(round => (
              <div key={round.id} className="card" style={{ marginBottom: 20 }}>
                <h3 style={{ fontFamily: 'Playfair Display', marginBottom: 16 }}>
                  Round {round.round_number}
                  <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text2)', marginLeft: 10 }}>{round.round_date}</span>
                </h3>
                {round.games?.sort((a, b) => a.board_number - b.board_number).map(game => (
                  <div key={game.id} style={{ display: 'grid', gridTemplateColumns: '50px 1fr auto 1fr auto', gap: 10, alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>Bd {game.board_number}</span>
                    <span style={{ fontSize: 14 }}>{game.white_player?.flag} {game.white_player?.name}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {['white', 'draw', 'black'].map(res => (
                        <button key={res} onClick={() => setResult(game.id, res, round.id)} style={{
                          padding: '5px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans',
                          border: '1px solid',
                          borderColor: game.result === res ? 'var(--gold)' : 'var(--border)',
                          background: game.result === res ? 'var(--gold-dim)' : 'var(--bg3)',
                          color: game.result === res ? 'var(--gold)' : 'var(--text2)',
                        }}>
                          {res === 'white' ? '1-0' : res === 'draw' ? '½-½' : '0-1'}
                        </button>
                      ))}
                      {game.result && (
                        <button onClick={() => clearResult(game.id)} style={{ padding: '5px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', fontFamily: 'DM Sans' }}>✕</button>
                      )}
                    </div>
                    <span style={{ fontSize: 14, textAlign: 'right' }}>{game.black_player?.name} {game.black_player?.flag}</span>
                    <span />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Players */}
        {tab === 'players' && (
          <div>
            <h2 style={{ fontFamily: 'Playfair Display', marginBottom: 24 }}>Chess Candidates</h2>
            <div className="card">
              {players.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 20 }}>{p.flag}</span>
                  <div>
                    <p style={{ fontWeight: 500 }}>{p.name}</p>
                    <p style={{ fontSize: 12, color: 'var(--text2)' }}>{p.country}</p>
                  </div>
                </div>
              ))}
              <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 16 }}>
                Players are seeded from the database. Edit directly in Supabase to add/modify.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
