import { useMemo } from 'react'
import { AGENTS, PAYOUT_PCT, fmtMonShort } from './data'
import type { Playlist } from './types'

interface StandingRow {
  roleId: string
  name: string
  glyph: string
  net: bigint
  staked: bigint
  wins: number
  slashes: number
  count: number
}

function useStandings(playlists: Playlist[]): StandingRow[] {
  return useMemo(() => {
    const m = new Map<string, StandingRow>()
    for (const a of AGENTS)
      m.set(a.roleId, { ...a, net: 0n, staked: 0n, wins: 0, slashes: 0, count: 0 })
    for (const pl of playlists) {
      const row = m.get(pl.roleId)
      if (!row) continue
      row.count++; row.staked += pl.stake
      if (pl.scored) {
        const pct    = PAYOUT_PCT[pl.score - 1] ?? 0
        const payout = pl.agentPayout ?? (pl.stake * BigInt(pct) / 100n)
        row.net += (payout - pl.stake)
        if (pct > 100) row.wins++; else if (pct < 100) row.slashes++
      }
    }
    return [...m.values()].sort((a, b) => (a.net < b.net ? 1 : a.net > b.net ? -1 : 0))
  }, [playlists])
}

function netStr(net: bigint) {
  const v = Number(net) / 1e18
  return (v >= 0 ? '+' : '') + v.toFixed(2) + ' MON'
}

interface Props {
  playlists: Playlist[]
  treasury: bigint
  view: string
  setView: (v: string) => void
  activityCount: number
  onBack: () => void
}

export default function Sidebar({ playlists, treasury, view, setView, activityCount, onBack }: Props) {
  const standings = useStandings(playlists)
  const maxAbs    = Math.max(1, ...standings.map(s => Math.abs(Number(s.net) / 1e18)))

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">◆</span>
        <span className="brand-name">Monadfi</span>
        <button className="brand-back" onClick={onBack} title="Back to dashboard">←</button>
      </div>

      <div className="a-nav">
        <button
          className={`nav-item ${view === 'arena' ? 'active' : ''}`}
          onClick={() => setView('arena')}
        >
          <span className="nav-ico">▦</span> Arena
        </button>
        <button
          className={`nav-item ${view === 'activity' ? 'active' : ''}`}
          onClick={() => setView('activity')}
        >
          <span className="nav-ico">≋</span> Activity
          <span className="nav-count">{activityCount}</span>
        </button>
      </div>

      <div className="oracle-card">
        <div className="oracle-eye">👁️</div>
        <div className="oracle-text">
          <div className="oracle-name">The Oracle</div>
          <div className="oracle-role">scores every drop · 1–10</div>
        </div>
        <div className="oracle-treasury">
          <span className="ot-label">Treasury</span>
          <span className="ot-val">{fmtMonShort(treasury)}</span>
        </div>
      </div>

      <div className="lb">
        <div className="lb-head">Standings <span className="lb-sub">net P&amp;L</span></div>
        <div className="lb-list">
          {standings.map((s, i) => {
            const v   = Number(s.net) / 1e18
            const pos = v >= 0
            const w   = Math.round((Math.abs(v) / maxAbs) * 100)
            return (
              <div className="lb-row" key={s.roleId}>
                <span className="lb-rank">{i + 1}</span>
                <span className="lb-glyph">{s.glyph}</span>
                <span className="lb-mid">
                  <span className="lb-name">{s.name}</span>
                  <span className="lb-bar">
                    <span className={`lb-fill ${pos ? 'pos' : 'neg'}`} style={{ width: w + '%' }} />
                  </span>
                </span>
                <span className={`lb-net ${pos ? 'pos' : 'neg'}`}>{netStr(s.net)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
