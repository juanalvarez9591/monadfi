import { useEffect, useRef, useState } from 'react'
import { client, ABI, fetchContractAddress, readAllPlaylists, readTreasury, readPendingCount, readRoundInfo, fmtMon } from './chain'
import { fetchSongMap, fetchAgentMap } from './api'
import type { Playlist, Song, Toast, ActivityEntry, AgentInfo, RoundStat } from './types'
import ToastQueue from './components/ToastQueue'
import PlaylistFeed from './components/PlaylistFeed'
import ActivityFeed from './components/ActivityFeed'

const SCORE_EMOJI: Record<number, string> = {
  1: '💀', 2: '😱', 3: '😞', 4: '😐', 5: '😶',
  6: '🙂', 7: '😊', 8: '😃', 9: '🤩', 10: '🏆',
}
const PAYOUT_PCT = [0, 20, 40, 60, 100, 110, 120, 140, 170, 200]

let toastIdSeq = 0
let activityIdSeq = 0

export default function App() {
  const [contractAddr, setContractAddr] = useState<`0x${string}` | null>(null)
  const [error, setError]               = useState<string | null>(null)
  const [songMap, setSongMap]           = useState<Map<number, Song>>(new Map())
  const [agentMap, setAgentMap]         = useState<Map<string, AgentInfo>>(new Map())
  const [playlists, setPlaylists]       = useState<Playlist[]>([])
  const [treasury, setTreasury]         = useState<bigint>(0n)
  const [pending, setPending]           = useState(0)
  const [toasts, setToasts]             = useState<Toast[]>([])
  const [activity, setActivity]         = useState<ActivityEntry[]>([])
  const [tab, setTab]                   = useState<'playlists' | 'activity'>('playlists')
  const [roundStats, setRoundStats]     = useState<RoundStat[]>([])
  const [roundInfo, setRoundInfo]       = useState<{ round: number; submitted: number; poolSize: number }>({ round: 1, submitted: 0, poolSize: 15 })

  const addrRef    = useRef<`0x${string}` | null>(null)
  const agentMapRef = useRef<Map<string, AgentInfo>>(new Map())

  // ── Toast helpers ─────────────────────────────────────────────────────────

  const addToast = (type: Toast['type'], title: string, body = '') => {
    const id = ++toastIdSeq
    setToasts(prev => [...prev.slice(-6), { id, type, title, body }])
  }

  const dismissToast = (id: number) =>
    setToasts(prev => prev.filter(t => t.id !== id))

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  useEffect(() => {
    Promise.all([
      fetchContractAddress().then(addr => {
        addrRef.current = addr
        setContractAddr(addr)
        return addr
      }),
      fetchSongMap().then(setSongMap),
      fetchAgentMap().then(map => {
        agentMapRef.current = map
        setAgentMap(map)
        return map
      }),
    ])
    .then(([addr]) =>
      Promise.all([
        readAllPlaylists(addr, agentMapRef.current).then(setPlaylists),
        readTreasury(addr).then(setTreasury),
        readPendingCount(addr).then(setPending),
        readRoundInfo(addr).then(setRoundInfo),
      ])
    )
    .catch(e => setError(e.message))
  }, [])

  // ── Poll treasury + pending every 5s ──────────────────────────────────────

  useEffect(() => {
    if (!contractAddr) return
    const t = setInterval(async () => {
      const [trs, pnd, ri] = await Promise.all([
        readTreasury(contractAddr),
        readPendingCount(contractAddr),
        readRoundInfo(contractAddr),
      ])
      setTreasury(trs)
      setPending(pnd)
      setRoundInfo(ri)
    }, 5000)
    return () => clearInterval(t)
  }, [contractAddr])

  // ── Watch PlaylistSubmitted ───────────────────────────────────────────────

  useEffect(() => {
    if (!contractAddr) return
    return client.watchContractEvent({
      address: contractAddr,
      abi: ABI,
      eventName: 'PlaylistSubmitted',
      onLogs: logs => {
        for (const log of logs as any[]) {
          const { playlistId, roleId, name, songIds, stake } = log.args
          const id        = Number(playlistId)
          const songs     = (songIds as bigint[]).map(Number)
          const stakeB    = BigInt(stake)
          const agentName = agentMapRef.current.get(roleId)?.name ?? roleId

          // Add to playlist list
          setPlaylists(prev => {
            if (prev.find(p => p.id === id)) return prev
            const pl: Playlist = {
              id, roleId, agentName, name, songIds: songs, stake: stakeB,
              submittedAt: Date.now() / 1000, scored: false, score: 0,
            }
            return [...prev, pl]
          })

          // Activity entry
          setActivity(prev => [...prev, {
            id: ++activityIdSeq, ts: Date.now(),
            event: 'submitted', playlistId: id,
            roleId, agentName, playlistName: name, songIds: songs, stake: stakeB,
          }])

          // Toast
          addToast('info',
            `🎵 ${agentName} · "${name}"`,
            `${songs.length} songs · staked ${fmtMon(stakeB)}`
          )
        }
      },
    })
  }, [contractAddr])

  // ── Watch PlaylistScored ──────────────────────────────────────────────────

  useEffect(() => {
    if (!contractAddr) return
    return client.watchContractEvent({
      address: contractAddr,
      abi: ABI,
      eventName: 'PlaylistScored',
      onLogs: logs => {
        for (const log of logs as any[]) {
          const { playlistId, roleId, score, agentPayout, treasuryDelta, treasuryGained } = log.args
          const id        = Number(playlistId)
          const scoreN    = Number(score)
          const payout    = BigInt(agentPayout)
          const tDelta    = BigInt(treasuryDelta)
          const pct       = PAYOUT_PCT[scoreN - 1] ?? 0
          const agentName = agentMapRef.current.get(roleId)?.name ?? roleId

          // Update playlist in list
          setPlaylists(prev => prev.map(p =>
            p.id === id
              ? { ...p, scored: true, score: scoreN, agentPayout: payout, treasuryDelta: tDelta, treasuryGained }
              : p
          ))

          // Activity entry
          setActivity(prev => [...prev, {
            id: ++activityIdSeq, ts: Date.now(),
            event: 'scored', playlistId: id,
            roleId, agentName, score: scoreN,
            agentPayout: payout, treasuryDelta: tDelta, treasuryGained,
          }])

          // Toast — type depends on outcome
          const toastType =
            scoreN >= 8 ? 'success' :
            scoreN >= 6 ? 'info' :
            scoreN === 5 ? 'warning' : 'error'

          const slashMsg =
            pct < 100 ? `${100 - pct}% slashed — got ${fmtMon(payout)}` :
            pct > 100 ? `+${pct - 100}% reward — got ${fmtMon(payout)}` :
            'Break even'

          addToast(toastType,
            `${SCORE_EMOJI[scoreN]} Playlist #${id} scored ${scoreN}/10`,
            slashMsg
          )
        }
      },
    })
  }, [contractAddr])

  // ── Watch RoundComplete ───────────────────────────────────────────────────

  useEffect(() => {
    if (!contractAddr) return
    return client.watchContractEvent({
      address: contractAddr,
      abi: ABI,
      eventName: 'RoundComplete',
      onLogs: logs => {
        for (const log of logs as any[]) {
          const { round, poolSize, totalScore, avgScore10x } = log.args
          const roundN  = Number(round)
          const avg     = Number(avgScore10x) / 10
          const poolN   = Number(poolSize)

          setRoundStats(prev => [...prev, { round: roundN, avgScore: avg }])
          setRoundInfo(prev => ({ ...prev, round: roundN + 1, submitted: 0 }))

          setActivity(prev => [...prev, {
            id: ++activityIdSeq, ts: Date.now(),
            event: 'roundComplete', playlistId: 0,
            roleId: '', agentName: '',
            round: roundN, poolSize: poolN,
            totalScore: Number(totalScore), avgScore10x: Number(avgScore10x),
          }])

          const emoji = avg >= 7 ? '🏆' : avg >= 5 ? '📊' : '📉'
          addToast(
            avg >= 7 ? 'success' : avg >= 5 ? 'info' : 'warning',
            `${emoji} Round #${roundN} complete`,
            `${poolN} playlists · avg score ${avg.toFixed(1)}/10`
          )
        }
      },
    })
  }, [contractAddr])

  // ── Render ────────────────────────────────────────────────────────────────

  if (error) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="alert alert-error max-w-md">
        <span>⚠️ {error}</span>
      </div>
    </div>
  )

  if (!contractAddr) return (
    <div className="min-h-screen flex items-center justify-center gap-3 text-base-content/60">
      <span className="loading loading-spinner loading-md" />
      Connecting to PlaylistBounty…
    </div>
  )

  const scored   = playlists.filter(p => p.scored)
  const avgScore = scored.length
    ? (scored.reduce((s, p) => s + p.score, 0) / scored.length).toFixed(1)
    : '—'

  return (
    <div className="min-h-screen bg-base-100 flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="navbar bg-base-200 border-b border-base-300 px-4 gap-4 flex-wrap">
        <div className="navbar-start gap-2">
          <span className="text-xl font-bold">🎵 PlaylistBounty</span>
          <span className="badge badge-outline badge-sm font-mono hidden sm:flex">
            {contractAddr.slice(0, 8)}…{contractAddr.slice(-4)}
          </span>
        </div>

        <div className="navbar-center gap-3 flex-wrap">
          <div className="stat py-1 px-3 bg-base-300 rounded-lg min-w-0">
            <div className="stat-title text-xs">Treasury</div>
            <div className="stat-value text-sm text-success">{fmtMon(treasury)}</div>
          </div>
          <div className="stat py-1 px-3 bg-base-300 rounded-lg min-w-0">
            <div className="stat-title text-xs">Round</div>
            <div className="stat-value text-sm text-primary">
              #{roundInfo.round}
              <span className="text-xs font-normal text-base-content/50 ml-1">
                {roundInfo.submitted}/{roundInfo.poolSize}
              </span>
            </div>
          </div>
          <div className="stat py-1 px-3 bg-base-300 rounded-lg min-w-0">
            <div className="stat-title text-xs">Pending</div>
            <div className="stat-value text-sm text-warning">{pending}</div>
          </div>
          <div className="stat py-1 px-3 bg-base-300 rounded-lg min-w-0">
            <div className="stat-title text-xs">Avg Score</div>
            <div className="stat-value text-sm">{avgScore}</div>
          </div>
          {roundStats.length > 0 && (
            <div className="stat py-1 px-3 bg-base-300 rounded-lg min-w-0 hidden xl:flex">
              <div className="stat-title text-xs">Round History</div>
              <div className="stat-value text-[11px] font-mono text-base-content/70 flex gap-1 flex-wrap">
                {roundStats.map(r => (
                  <span key={r.round} className={`${r.avgScore >= 7 ? 'text-success' : r.avgScore >= 5 ? 'text-info' : 'text-error'}`}>
                    R{r.round}:{r.avgScore.toFixed(1)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="navbar-end">
          <div className="badge badge-success gap-1 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            live
          </div>
        </div>
      </header>

      {/* ── Mobile tabs ────────────────────────────────────────────── */}
      <div className="tabs tabs-bordered px-4 pt-3 lg:hidden">
        <button className={`tab ${tab === 'playlists' ? 'tab-active' : ''}`} onClick={() => setTab('playlists')}>
          Playlists ({playlists.length})
        </button>
        <button className={`tab ${tab === 'activity' ? 'tab-active' : ''}`} onClick={() => setTab('activity')}>
          Activity ({activity.length})
        </button>
      </div>

      {/* ── Main ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex gap-4 p-4 overflow-hidden">

        {/* Playlist feed */}
        <section className={`flex-1 overflow-y-auto lg:block ${tab === 'playlists' ? 'block' : 'hidden'}`}>
          <h2 className="text-sm font-semibold text-base-content/60 uppercase tracking-wider mb-3">
            Playlists
          </h2>
          <PlaylistFeed playlists={playlists} songMap={songMap} />
        </section>

        {/* Divider */}
        <div className="divider divider-horizontal hidden lg:flex" />

        {/* Activity feed */}
        <section className={`w-full lg:w-80 xl:w-96 flex-shrink-0 lg:block ${tab === 'activity' ? 'block' : 'hidden'}`}>
          <h2 className="text-sm font-semibold text-base-content/60 uppercase tracking-wider mb-3">
            Live Events
          </h2>
          <ActivityFeed entries={activity} songMap={songMap} />
        </section>

      </main>

      {/* ── Toast queue ────────────────────────────────────────────── */}
      <ToastQueue toasts={toasts} onDismiss={dismissToast} />

    </div>
  )
}
