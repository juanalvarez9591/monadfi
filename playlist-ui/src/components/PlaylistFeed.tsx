import type { Playlist, Song } from '../types'
import { fmtMon } from '../chain'

interface Props {
  playlists: Playlist[]
  songMap: Map<number, Song>
}

const SCORE_BADGE: Record<number, string> = {
  1: 'badge-error',   2: 'badge-error',
  3: 'badge-warning', 4: 'badge-warning',
  5: 'badge-ghost',
  6: 'badge-info',    7: 'badge-info',
  8: 'badge-success', 9: 'badge-success', 10: 'badge-success',
}

const SCORE_EMOJI: Record<number, string> = {
  1: '💀', 2: '😱', 3: '😞', 4: '😐', 5: '😶',
  6: '🙂', 7: '😊', 8: '😃', 9: '🤩', 10: '🏆',
}

const PAYOUT_PCT = [0, 20, 40, 60, 100, 110, 120, 140, 170, 200]

const PALETTE = [
  'bg-primary', 'bg-secondary', 'bg-accent',
  'bg-info', 'bg-success', 'bg-warning', 'bg-error',
  'bg-neutral',
]

function albumColor(str: string) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function roleColor(roleId: string) {
  const n = parseInt(roleId.replace(/\D/g, '') || '0')
  const colors = ['badge-primary', 'badge-secondary', 'badge-accent', 'badge-neutral', 'badge-info']
  return colors[n % colors.length]
}

function AlbumArt({ song }: { song: Song }) {
  if (song.imageUrl) {
    return (
      <img
        src={song.imageUrl}
        alt={song.album}
        className="w-12 h-12 rounded object-cover flex-shrink-0"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  const color = albumColor(song.album || song.artist)
  const initial = (song.artist[0] ?? '?').toUpperCase()
  return (
    <div className={`w-12 h-12 rounded flex items-center justify-center flex-shrink-0 ${color} text-base-100 font-bold text-lg`}>
      {initial}
    </div>
  )
}

export default function PlaylistFeed({ playlists, songMap }: Props) {
  const sorted = [...playlists].reverse()

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-base-content/40">
        <span className="text-4xl mb-2">🎵</span>
        <span>Waiting for agents to submit playlists…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {sorted.map(pl => {
        const pct    = PAYOUT_PCT[pl.score - 1] ?? 0
        const payout = pl.agentPayout ?? (pl.scored ? pl.stake * BigInt(pct) / 100n : undefined)
        const songs  = pl.songIds.map(id => songMap.get(id)).filter(Boolean) as Song[]

        const albums  = [...new Set(songs.map(s => s.album).filter(Boolean))]
        const genres  = [...new Set(songs.map(s => s.genre).filter(Boolean))]

        const borderClass = !pl.scored          ? 'border-base-content/20'
          : pl.score >= 8                        ? 'border-success'
          : pl.score >= 6                        ? 'border-info'
          : pl.score <= 2                        ? 'border-error'
          :                                        'border-warning'

        return (
          <div key={pl.id} className={`card bg-base-200 shadow border-l-4 ${borderClass}`}>
            <div className="card-body p-4 gap-3">

              {/* ── Header row ── */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-base-content/40">#{pl.id}</span>
                    <span className={`badge badge-sm ${roleColor(pl.roleId)}`}>
                      {pl.agentName || pl.roleId}
                    </span>
                  </div>
                  {pl.name && (
                    <div className="text-sm font-semibold truncate mt-0.5">{pl.name}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {pl.scored ? (
                    <>
                      <span className="text-lg">{SCORE_EMOJI[pl.score]}</span>
                      <span className={`badge ${SCORE_BADGE[pl.score] ?? 'badge-ghost'}`}>
                        {pl.score}/10
                      </span>
                    </>
                  ) : (
                    <span className="badge badge-outline badge-sm animate-pulse">pending…</span>
                  )}
                </div>
              </div>

              {/* ── Album art strip ── */}
              {songs.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {songs.map(s => (
                    <div key={s.id} className="flex flex-col items-center gap-1 flex-shrink-0 w-12 group relative">
                      <AlbumArt song={s} />
                      {/* tooltip on hover */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 z-10 pointer-events-none
                                      opacity-0 group-hover:opacity-100 transition-opacity
                                      bg-base-300 border border-base-content/20 rounded px-2 py-1
                                      text-[10px] whitespace-nowrap shadow-lg">
                        <div className="font-semibold">{s.name}</div>
                        <div className="text-base-content/60">{s.artist}</div>
                        {s.album && <div className="text-base-content/40 italic">{s.album}</div>}
                      </div>
                      <span className="text-[9px] text-base-content/50 text-center leading-tight w-full truncate">
                        {s.name}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {pl.songIds.map(id => (
                    <span key={id} className="badge badge-ghost badge-xs">#{id}</span>
                  ))}
                </div>
              )}

              {/* ── Album + genre tags ── */}
              {(albums.length > 0 || genres.length > 0) && (
                <div className="flex flex-wrap gap-1">
                  {albums.map(a => (
                    <span key={a} className="badge badge-outline badge-xs text-[10px] opacity-70">{a}</span>
                  ))}
                  {genres.map(g => (
                    <span key={g} className="badge badge-ghost badge-xs text-[10px] opacity-50">{g}</span>
                  ))}
                </div>
              )}

              {/* ── Stake / payout row ── */}
              <div className="flex items-center justify-between text-xs text-base-content/60">
                <span>
                  Staked: <span className="text-base-content font-mono">{fmtMon(pl.stake)}</span>
                </span>
                {pl.scored && payout !== undefined && (
                  <span>
                    Payout:{' '}
                    <span className={`font-mono font-bold ${
                      pct > 100 ? 'text-success' : pct < 100 ? 'text-error' : 'text-base-content'
                    }`}>
                      {fmtMon(payout)}
                    </span>
                    <span className="ml-1 opacity-60">({pct}%)</span>
                  </span>
                )}
              </div>

            </div>
          </div>
        )
      })}
    </div>
  )
}
