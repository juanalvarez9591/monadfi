import type { ActivityEntry, Song } from '../types'
import { fmtMon } from '../chain'

interface Props {
  entries: ActivityEntry[]
  songMap: Map<number, Song>
}

const SCORE_EMOJI: Record<number, string> = {
  1: '💀', 2: '😱', 3: '😞', 4: '😐', 5: '😶',
  6: '🙂', 7: '😊', 8: '😃', 9: '🤩', 10: '🏆',
}

const PAYOUT_PCT = [0, 20, 40, 60, 100, 110, 120, 140, 170, 200]

const PALETTE = [
  'bg-primary', 'bg-secondary', 'bg-accent',
  'bg-info', 'bg-success', 'bg-warning', 'bg-error', 'bg-neutral',
]

function albumColor(str: string) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function MiniArt({ song }: { song: Song }) {
  if (song.imageUrl) {
    return (
      <img
        src={song.imageUrl}
        alt={song.name}
        className="w-8 h-8 rounded object-cover flex-shrink-0"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  const color = albumColor(song.album || song.artist)
  return (
    <div className={`w-8 h-8 rounded flex items-center justify-center flex-shrink-0 ${color} text-base-100 font-bold text-xs`}>
      {(song.artist[0] ?? '?').toUpperCase()}
    </div>
  )
}

export default function ActivityFeed({ entries, songMap }: Props) {
  const reversed = [...entries].reverse()

  return (
    <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-180px)]">
      {reversed.length === 0 && (
        <div className="text-center py-12 text-base-content/40">
          <div className="text-3xl mb-2">📡</div>
          <div className="text-sm">Listening for events…</div>
        </div>
      )}

      {reversed.map(e => {
        if (e.event === 'roundComplete') {
          const avg    = (e.avgScore10x ?? 0) / 10
          const emoji  = avg >= 7 ? '🏆' : avg >= 5 ? '📊' : '📉'
          const color  = avg >= 7 ? 'border-success/50 bg-success/10' : avg >= 5 ? 'border-info/50 bg-info/10' : 'border-warning/50 bg-warning/10'
          const bar    = '█'.repeat(Math.round(avg))
          return (
            <div key={e.id} className={`rounded-lg p-3 text-sm border ${color}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 font-bold">
                  <span>{emoji}</span>
                  <span>Round #{e.round} Complete</span>
                </div>
                <span className="font-mono text-xs opacity-40">{new Date(e.ts).toLocaleTimeString()}</span>
              </div>
              <div className="ml-6 space-y-0.5 text-xs text-base-content/70">
                <div><span className="opacity-50">pool </span>{e.poolSize} playlists scored</div>
                <div>
                  <span className="opacity-50">avg  </span>
                  <span className="font-bold">{avg.toFixed(1)}/10</span>
                  <span className="ml-2 font-mono text-[10px] opacity-40">{bar}</span>
                </div>
              </div>
            </div>
          )
        }

        const isSubmit = e.event === 'submitted'
        const scoreN   = e.score ?? 0
        const pct      = PAYOUT_PCT[scoreN - 1] ?? 0

        const borderClass = isSubmit
          ? 'border-base-300'
          : scoreN >= 6 ? 'border-success/40'
          : scoreN <= 4 ? 'border-error/40'
          :               'border-warning/40'

        const bgClass = isSubmit
          ? 'bg-base-200'
          : scoreN >= 6 ? 'bg-success/10'
          : scoreN <= 4 ? 'bg-error/10'
          :               'bg-warning/10'

        const songs = (e.songIds ?? []).map(id => songMap.get(id)).filter(Boolean) as Song[]

        return (
          <div key={e.id} className={`rounded-lg p-3 text-sm border ${bgClass} ${borderClass}`}>

            {/* ── Event header ── */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span>{isSubmit ? '📋' : '🎯'}</span>
                <span className="font-semibold text-xs">
                  {isSubmit ? 'PlaylistSubmitted' : 'PlaylistScored'}
                </span>
                <span className="badge badge-xs badge-ghost">#{e.playlistId}</span>
              </div>
              <span className="font-mono text-xs opacity-40">
                {new Date(e.ts).toLocaleTimeString()}
              </span>
            </div>

            <div className="space-y-1.5 ml-5">

              {/* ── Submitted ── */}
              {isSubmit && (
                <>
                  <div className="text-xs">
                    <span className="opacity-50">agent </span>
                    <span className="font-semibold">{e.agentName || e.roleId}</span>
                    {e.stake !== undefined && (
                      <>
                        <span className="opacity-40 mx-1">·</span>
                        <span className="font-mono text-warning">{fmtMon(e.stake)}</span>
                        <span className="opacity-40 text-[10px] ml-1">→ contract</span>
                      </>
                    )}
                  </div>
                  {e.playlistName && (
                    <div className="text-xs font-medium text-base-content/80">"{e.playlistName}"</div>
                  )}

                  {/* Song list with album art */}
                  {songs.length > 0 ? (
                    <div className="flex flex-col gap-1 mt-1">
                      {songs.slice(0, 5).map(s => (
                        <div key={s.id} className="flex items-center gap-2">
                          <MiniArt song={s} />
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate leading-tight">{s.name}</div>
                            <div className="text-[10px] text-base-content/50 truncate leading-tight">{s.artist}</div>
                          </div>
                        </div>
                      ))}
                      {songs.length > 5 && (
                        <div className="text-[10px] text-base-content/40 ml-10">
                          +{songs.length - 5} more
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-base-content/50">
                      {(e.songIds ?? []).slice(0, 5).map(id => `#${id}`).join(', ')}
                      {(e.songIds?.length ?? 0) > 5 && ` +${(e.songIds?.length ?? 0) - 5} more`}
                    </div>
                  )}
                </>
              )}

              {/* ── Scored ── */}
              {!isSubmit && scoreN > 0 && (
                <>
                  <div className="text-xs">
                    <span className="opacity-50">oracle </span>
                    <span className="font-semibold">{e.agentName || e.roleId}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl leading-none">{SCORE_EMOJI[scoreN]}</span>
                    <div>
                      <div className="text-sm font-bold leading-tight">{scoreN}/10</div>
                      {e.agentPayout !== undefined && (
                        <div className={`text-[10px] font-mono ${
                          pct > 100 ? 'text-success' : pct < 100 ? 'text-error' : 'text-base-content/60'
                        }`}>
                          {pct > 100 ? '+' : pct < 100 ? '-' : ''}{Math.abs(pct - 100)}%
                          {' '}·{' '}
                          {fmtMon(e.agentPayout)}
                          <span className="opacity-50 ml-1">← wallet</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {e.treasuryDelta !== undefined && e.treasuryDelta > 0n && (
                    <div className="text-[10px]">
                      <span className="opacity-50">treasury </span>
                      <span className={e.treasuryGained ? 'text-success' : 'text-error'}>
                        {e.treasuryGained ? '+' : '-'}{fmtMon(e.treasuryDelta)}
                      </span>
                    </div>
                  )}
                </>
              )}

            </div>
          </div>
        )
      })}
    </div>
  )
}
