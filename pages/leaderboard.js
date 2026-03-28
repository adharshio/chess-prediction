import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'

export default function Leaderboard() {
  const [standings, setStandings] = useState([])
  const [rounds, setRounds] = useState([])
  const [selectedRound, setSelectedRound] = useState('overall')
  const [loading, setLoading] = useState(true)
  const myEmail = typeof window !== 'undefined' ? JSON.parse(sessionStorage.getItem('participant') || '{}')?.email : null

  useEffect(() => {
    loadLeaderboard()
    loadRounds()
    const interval = setInterval(loadLeaderboard, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [])

  async function loadLeaderboard() {
    const { data } = await supabase
      .from('leaderboard')
      .select('*')
    if (data) setStandings(data)
    setLoading(false)
  }

  async function loadRounds() {
    const { data } = await supabase
      .from('rounds')
      .select('round_number, round_date, is_complete')
      .order('round_number')
    if (data) setRounds(data)
  }

  async function loadRoundLeaderboard(roundNum) {
    setLoading(true)
    const { data } = await supabase
      .from('round_leaderboard')
      .select('*')
      .eq('round_number', roundNum)
      .order('round_points', { ascending: false })
    if (data) setStandings(data.map(r => ({ name: r.participant_name, total_points: r.round_points })))
    setLoading(false)
  }

  function handleRoundChange(val) {
    setSelectedRound(val)
    if (val === 'overall') loadLeaderboard()
    else loadRoundLeaderboard(parseInt(val))
  }

  const topScore = standings[0]?.total_points || 0

  return (
    <>
      <Nav />
      <div className="container" style={{ padding: '40px 20px' }}>
        <div style={{ marginBottom: 32 }}>
          <p className="mono text-muted" style={{ fontSize: 12, marginBottom: 8, letterSpacing: '0.1em' }}>LIVE RANKINGS</p>
          <h1 style={{ fontSize: 36, marginBottom: 8 }}>Leaderboard</h1>
          <p style={{ color: 'var(--text2)', fontSize: 14 }}>Updates after each round's results are entered. Draw = 1 pt · Correct win = 4 pts.</p>
        </div>

        {/* Round filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 32, flexWrap: 'wrap' }}>
          <button
            onClick={() => handleRoundChange('overall')}
            style={{
              padding: '6px 16px', borderRadius: 20, border: '1px solid',
              borderColor: selectedRound === 'overall' ? 'var(--gold)' : 'var(--border)',
              background: selectedRound === 'overall' ? 'var(--gold-dim)' : 'transparent',
              color: selectedRound === 'overall' ? 'var(--gold)' : 'var(--text2)',
              cursor: 'pointer', fontSize: 13, fontFamily: 'DM Sans',
            }}>
            Overall
          </button>
          {rounds.filter(r => r.is_complete).map(r => (
            <button key={r.round_number}
              onClick={() => handleRoundChange(String(r.round_number))}
              style={{
                padding: '6px 16px', borderRadius: 20, border: '1px solid',
                borderColor: selectedRound === String(r.round_number) ? 'var(--gold)' : 'var(--border)',
                background: selectedRound === String(r.round_number) ? 'var(--gold-dim)' : 'transparent',
                color: selectedRound === String(r.round_number) ? 'var(--gold)' : 'var(--text2)',
                cursor: 'pointer', fontSize: 13, fontFamily: 'DM Sans',
              }}>
              R{r.round_number}
            </button>
          ))}
        </div>

        {loading ? (
          <p style={{ color: 'var(--text2)' }}>Loading...</p>
        ) : standings.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '60px 24px' }}>
            <p style={{ fontSize: 40, marginBottom: 12 }}>♟</p>
            <p style={{ color: 'var(--text2)' }}>No scores yet. Tournament hasn't started.</p>
          </div>
        ) : (
          <div>
            {/* Top 3 podium */}
            {selectedRound === 'overall' && standings.length >= 3 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 32 }}>
                {[standings[1], standings[0], standings[2]].map((p, i) => {
                  if (!p) return <div key={i} />
                  const ranks = [2, 1, 3]
                  const rank = ranks[i]
                  const heights = ['160px', '200px', '140px']
                  return (
                    <div key={p.id || p.name} className="card" style={{
                      textAlign: 'center',
                      paddingTop: heights[i],
                      position: 'relative',
                      borderColor: rank === 1 ? 'var(--gold)' : 'var(--border)',
                      background: rank === 1 ? 'linear-gradient(to bottom, rgba(201,168,76,0.08), var(--bg2))' : 'var(--bg2)',
                    }}>
                      <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
                        fontSize: rank === 1 ? 48 : 36 }}>
                        {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
                      </div>
                      <p style={{ fontFamily: 'Playfair Display', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{p.name}</p>
                      <p className="mono" style={{ fontSize: 24, color: rank === 1 ? 'var(--gold)' : 'var(--text)', fontWeight: 500 }}>{p.total_points}</p>
                      <p style={{ fontSize: 12, color: 'var(--text3)' }}>points</p>
                      {p.accuracy_pct != null && (
                        <p style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6 }}>{p.accuracy_pct}% accuracy</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Full table */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['#', 'Participant', 'Points', selectedRound === 'overall' ? 'Correct' : null, selectedRound === 'overall' ? 'Accuracy' : null].filter(Boolean).map(h => (
                      <th key={h} style={{ padding: '12px 20px', textAlign: h === '#' ? 'center' : 'left', fontSize: 12, color: 'var(--text2)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {standings.map((p, i) => {
                    const isMe = p.email === myEmail
                    const pct = topScore > 0 ? (p.total_points / topScore) * 100 : 0
                    return (
                      <tr key={p.id || p.name} style={{
                        borderBottom: '1px solid var(--border)',
                        background: isMe ? 'var(--gold-dim)' : 'transparent',
                      }}>
                        <td style={{ padding: '14px 20px', textAlign: 'center', width: 50 }}>
                          <span className={`mono rank-${i + 1}`} style={{ fontSize: 14, fontWeight: 500 }}>
                            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                          </span>
                        </td>
                        <td style={{ padding: '14px 20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: '50%',
                              background: `hsl(${(p.name?.charCodeAt(0) || 0) * 13}, 40%, 25%)`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 13, fontWeight: 500, color: 'var(--text)', flexShrink: 0
                            }}>
                              {p.name?.charAt(0).toUpperCase()}
                            </div>
                            <span style={{ fontWeight: isMe ? 600 : 400 }}>
                              {p.name} {isMe && <span style={{ fontSize: 11, color: 'var(--gold)' }}>you</span>}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '14px 20px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span className="mono" style={{ fontSize: 18, fontWeight: 500, color: i < 3 ? 'var(--gold)' : 'var(--text)', minWidth: 36 }}>
                              {p.total_points}
                            </span>
                            <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, minWidth: 60 }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--gold)', borderRadius: 2, transition: 'width 0.5s' }} />
                            </div>
                          </div>
                        </td>
                        {selectedRound === 'overall' && p.correct_predictions != null && (
                          <td style={{ padding: '14px 20px', color: 'var(--text2)', fontSize: 14 }}>
                            {p.correct_predictions}/{p.total_predictions}
                          </td>
                        )}
                        {selectedRound === 'overall' && p.accuracy_pct != null && (
                          <td style={{ padding: '14px 20px' }}>
                            <span className="mono" style={{ fontSize: 14, color: p.accuracy_pct >= 60 ? 'var(--green)' : 'var(--text2)' }}>
                              {p.accuracy_pct}%
                            </span>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 12, textAlign: 'center' }}>
              Auto-refreshes every 30 seconds
            </p>
          </div>
        )}
      </div>
    </>
  )
}
