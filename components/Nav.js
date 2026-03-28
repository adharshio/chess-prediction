import Link from 'next/link'
import { useRouter } from 'next/router'

export default function Nav() {
  const router = useRouter()
  return (
    <nav className="nav">
      <div className="nav-inner">
        <div className="nav-logo">
          ♟ <span>Candidates 2026</span>
        </div>
        <div className="nav-links">
          <Link href="/" className={router.pathname === '/' ? 'active' : ''}>Predict</Link>
          <Link href="/leaderboard" className={router.pathname === '/leaderboard' ? 'active' : ''}>Leaderboard</Link>
          <Link href="/rounds" className={router.pathname === '/rounds' ? 'active' : ''}>Rounds</Link>
        </div>
      </div>
    </nav>
  )
}
