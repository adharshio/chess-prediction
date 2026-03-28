import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'
import { format } from 'date-fns'

export default function Rounds() {
  const [rounds, setRounds] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadRounds() }, [])

  async function loadRounds() {
    const { data: roundsData } = await supabase
      .from('rounds')
      .select('*')
      .order('round_number')

    if (!roundsData) { setLoading(false); return }

    const { data: gamesData } = await supabase
      .from('games')
      .select('*')
      .order('board_number')

    const { data: playersData } = await supabase
      .from('chess_players')
      .select('*')

    const playerMap = {}
    if (playersData) playersData.forEach(p => { playerMap[p.id] = p })

    const enriched = roundsData.map(r => ({
      ...r,
      games: (gamesData || [])
        .filter(g => g.round_id === r.id)
        .map(g => ({
          ...g,
          white_player: playerMap[g.white_player_id] || null,
          black_player: playerMap[g.black_player_id] || null,
        }))
    }))

    setRounds(enriched)
    setLoading(false)
  }

  function ResultBadge({ result }) {
    if (!result) return <span className="badge-pending">Pending</span>
    if (result === 'white') return <span className="badge-white">White ½</span>
    if (result === 'black') return <span className="badge-black">Black ½</span>
    return <span className="badge-draw">½–½</span>
  }

  return (
    <>
      <Nav />
      <div className="container" style={{ padding: '40px 20px' }}>
        <div style={{ marginBottom: 32 }}>
          <p className="mono text-muted" style={{ fontSize: 12, marginBottom: 8, letterSpacing: '0.1em' }}>TOURNAMENT SCHEDULE</p>
          <h1 style={{ fontSize: 36, marginBottom: 8 }}>All Rounds</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>14 rounds · 4 boards per round · Double round-robin</p>
        </div>

        {loading && <p style={{ color: 'var(--text2)' }}>Loading...</p>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {rounds.map(round => (
            <div key={round.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <h2 style={{ fontSize: 20 }}>Round {round.round_number}</h2>
                    {round.is_complete
                      ? <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 20, background: 'rgba(76,175,120,0.12)', color: 'var(--green)' }}>Complete</span>
                      : <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 20, background: 'var(--border)', color: 'var(--text2)' }}>Upcoming</span>
                    }
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
                    {format(new Date(round.round_date), 'EEEE, MMMM d, yyyy')}
                  </p>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text3)' }}>
                  🔒 {format(new Date(round.prediction_deadline), 'h:mm a')}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {round.games?.sort((a, b) => a.board_number - b.board_number).map(game => (
                  <div key={game.id} style={{
                    display: 'grid',
                    gridTemplateColumns: '60px 1fr auto 1fr auto',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 0',
                    borderTop: '1px solid var(--border)',
                  }}>
                    <span className="mono text-muted" style={{ fontSize: 11 }}>BD {game.board_number}</span>
                    <span style={{ fontSize: 14, fontFamily: 'Playfair Display' }}>
                      {game.white_player?.flag} {game.white_player?.name}
                    </span>
                    <ResultBadge result={game.result} />
                    <span style={{ fontSize: 14, fontFamily: 'Playfair Display', textAlign: 'right' }}>
                      {game.black_player?.name} {game.black_player?.flag}
                    </span>
                    <span />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {!loading && rounds.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--text2)' }}>
              <p style={{ fontSize: 40, marginBottom: 12 }}>♟</p>
              <p>No rounds posted yet. Check back soon.</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
