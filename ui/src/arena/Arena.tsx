import { useState, useEffect } from 'react'
import './arena.css'
import Sidebar from './Sidebar'
import PlaylistCard from './PlaylistCard'
import DetailOverlay from './DetailOverlay'
import NowJudgingBar from './NowJudgingBar'
import ActivityView from './ActivityView'
import ToastStack from './ToastStack'
import RoundBanner from './RoundBanner'
import { SimEngine } from './sim'
import { AGENT_MAP, PAYOUT_PCT, POOL_SIZE, fmtMonShort, SCORE_EMOJI } from './data'
import type { Playlist, Toast, ActivityEntry, RoundInfo, RoundStat, LastVerdict } from './types'

let toastSeq = 0
let actSeq   = 0

interface Props { onBack: () => void }

export default function Arena({ onBack }: Props) {
  const [playlists,   setPlaylists]   = useState<Playlist[]>([])
  const [treasury,    setTreasury]    = useState<bigint>(0n)
  const [toasts,      setToasts]      = useState<Toast[]>([])
  const [activity,    setActivity]    = useState<ActivityEntry[]>([])
  const [view,        setView]        = useState('arena')
  const [roundInfo,   setRoundInfo]   = useState<RoundInfo>({ round: 1, submitted: 0, poolSize: POOL_SIZE })
  const [roundStats,  setRoundStats]  = useState<RoundStat[]>([])
  const [lastVerdict, setLastVerdict] = useState<LastVerdict | null>(null)
  const [banner,      setBanner]      = useState<{ round: number; poolSize: number; avgScore10x: number } | null>(null)
  const [openId,      setOpenId]      = useState<number | null>(null)

  const addToast = (type: Toast['type'], ico: string, title: string, body = '') => {
    const id = ++toastSeq
    setToasts(prev => [...prev.slice(-4), { id, type, ico, title, body }])
  }
  const dismissToast = (id: number) => setToasts(prev => prev.filter(t => t.id !== id))

  useEffect(() => {
    const sim = new SimEngine()
    sim.on({
      onTreasury: t => setTreasury(t),

      onSubmitted: pl => {
        const agent = AGENT_MAP.get(pl.roleId)
        setPlaylists(prev =>
          prev.find(p => p.playlistId === pl.playlistId)
            ? prev
            : [...prev, {
                id: pl.playlistId, playlistId: pl.playlistId, roleId: pl.roleId,
                name: pl.name, songIds: pl.songIds, stake: pl.stake,
                submittedAt: Date.now() / 1000, scored: false, score: 0,
              }]
        )
        setRoundInfo(ri => ({ ...ri, submitted: ri.submitted + 1 }))
        setActivity(prev => [...prev.slice(-120), {
          id: ++actSeq, ts: Date.now(), event: 'submitted', playlistId: pl.playlistId,
          roleId: pl.roleId, agentName: agent?.name, playlistName: pl.name,
          songIds: pl.songIds, stake: pl.stake,
        }])
        addToast('info', '🎵', `${agent?.name} · "${pl.name}"`,
          `${pl.songIds.length} songs · staked ${fmtMonShort(pl.stake)}`)
      },

      onScored: ev => {
        const { playlistId, roleId, score, agentPayout, treasuryDelta, treasuryGained, treasury: t } = ev
        const pct   = PAYOUT_PCT[score - 1] ?? 0
        const agent = AGENT_MAP.get(roleId)
        let scoredPl: Playlist | null = null
        setPlaylists(prev => prev.map(p => {
          if (p.playlistId !== playlistId) return p
          scoredPl = { ...p, scored: true, score, agentPayout, treasuryDelta, treasuryGained }
          return scoredPl
        }))
        setTreasury(t)
        setActivity(prev => [...prev.slice(-120), {
          id: ++actSeq, ts: Date.now(), event: 'scored', playlistId,
          roleId, agentName: agent?.name, score, agentPayout, treasuryDelta, treasuryGained,
        }])
        const kind = pct > 100 ? 'reward' : pct < 100 ? 'slash' : 'even'
        setTimeout(() => setLastVerdict(lv =>
          scoredPl ? {
            playlistId, roleId, name: scoredPl!.name, songIds: scoredPl!.songIds,
            score, kind, delta: pct - 100,
          } : lv
        ), 0)
        const toastType = score >= 8 ? 'success' : score >= 6 ? 'info' : score === 5 ? 'warning' : 'error'
        const msg = pct < 100
          ? `${100 - pct}% slashed — got ${fmtMonShort(agentPayout)}`
          : pct > 100
          ? `+${pct - 100}% reward — got ${fmtMonShort(agentPayout)}`
          : 'Break even'
        addToast(toastType, SCORE_EMOJI[score] ?? '🎵', `Playlist #${playlistId} scored ${score}/10`, msg)
      },

      onRoundComplete: ev => {
        const { round, poolSize, avgScore10x } = ev
        const avg = avgScore10x / 10
        setRoundStats(prev => [...prev, { round, avgScore: avg }])
        setRoundInfo(prev => ({ ...prev, round: round + 1, submitted: 0 }))
        setActivity(prev => [...prev.slice(-120), {
          id: ++actSeq, ts: Date.now(), event: 'roundComplete', playlistId: 0,
          roleId: '', agentName: '', round, poolSize, totalScore: ev.totalScore, avgScore10x,
        }])
        setBanner({ round, poolSize, avgScore10x })
        setTimeout(() => setBanner(b => (b?.round === round ? null : b)), 5200)
        const emoji = avg >= 7 ? '🏆' : avg >= 5 ? '📊' : '📉'
        addToast(avg >= 7 ? 'success' : avg >= 5 ? 'info' : 'warning', emoji,
          `Round #${round} complete`, `${poolSize} playlists · avg ${avg.toFixed(1)}/10`)
      },
    })
    sim.seed(6)
    sim.start()
    return () => sim.stop()
  }, [])

  const pending  = playlists.filter(p => !p.scored).length
  const scored   = playlists.filter(p => p.scored)
  const avgScore = scored.length
    ? (scored.reduce((s, p) => s + p.score, 0) / scored.length).toFixed(1)
    : '—'
  const openPl   = openId == null ? null : playlists.find(p => p.playlistId === openId) ?? null
  const sorted   = [...playlists].reverse()
  const roundPct = Math.min(100, Math.round((roundInfo.submitted / roundInfo.poolSize) * 100))

  return (
    <div className="arena-root">
      <Sidebar
        playlists={playlists}
        treasury={treasury}
        view={view}
        setView={setView}
        activityCount={activity.length}
        onBack={onBack}
      />

      <div className="main">
        <div className="topbar">
          <div className="tb-title">
            <h1>{view === 'arena' ? 'The Arena' : 'Activity'}</h1>
            <span className="live"><span className="live-dot" />live</span>
          </div>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Round</span>
              <span className="stat-val">#{roundInfo.round}</span>
              <span className="stat-ring" style={{ '--p': roundPct + '%' } as React.CSSProperties}>
                {roundInfo.submitted}/{roundInfo.poolSize}
              </span>
            </div>
            <div className="stat">
              <span className="stat-label">Treasury</span>
              <span className="stat-val green">{fmtMonShort(treasury)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">In the booth</span>
              <span className="stat-val amber">{pending}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Avg score</span>
              <span className="stat-val">{avgScore}</span>
            </div>
            {roundStats.length > 0 && (
              <div className="stat hist">
                <span className="stat-label">Rounds</span>
                <span className="stat-hist">
                  {roundStats.slice(-6).map(r => (
                    <span
                      key={r.round}
                      className={`hb ${r.avgScore >= 7 ? 'good' : r.avgScore >= 5 ? 'ok' : 'bad'}`}
                      style={{ height: (8 + r.avgScore * 2.2) + 'px' }}
                      title={`R${r.round}: ${r.avgScore.toFixed(1)}`}
                    />
                  ))}
                </span>
              </div>
            )}
          </div>
        </div>

        <RoundBanner banner={banner} />

        <div className="scroll">
          {view === 'arena' ? (
            sorted.length === 0 ? (
              <div className="a-empty"><span className="empty-ico">♪</span>Waiting for agents to drop playlists…</div>
            ) : (
              <div className="grid">
                {sorted.map(pl => (
                  <PlaylistCard key={pl.playlistId} pl={pl} onOpen={p => setOpenId(p.playlistId)} />
                ))}
              </div>
            )
          ) : (
            <ActivityView entries={activity} />
          )}
        </div>
      </div>

      <NowJudgingBar lastVerdict={lastVerdict} pending={pending} treasury={treasury} />
      {openPl && <DetailOverlay pl={openPl} onClose={() => setOpenId(null)} />}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
