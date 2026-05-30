import { useEffect } from 'react'
import Mosaic from './Mosaic'
import { AGENT_MAP, SCORE_EMOJI, SONG_MAP, fmtMon, fmtDur, albumColor, mosaicArt } from './data'
import { verdictOf } from './helpers'
import type { Playlist } from './types'

interface Props {
  pl: Playlist
  onClose: () => void
}

export default function DetailOverlay({ pl, onClose }: Props) {
  const agent    = AGENT_MAP.get(pl.roleId)
  const v        = verdictOf(pl)
  const songs    = pl.songIds.map(id => SONG_MAP.get(id)).filter(Boolean)
  const arts     = mosaicArt(pl.songIds)
  const accent   = albumColor(pl.name + pl.roleId)
  const totalDur = songs.reduce((s, x) => s + (x?.duration ?? 0), 0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const headTint = v.kind === 'reward' ? 'rgba(46,224,122,0.22)'
    : v.kind === 'slash'               ? 'rgba(246,70,63,0.22)'
    :                                    'rgba(255,255,255,0.06)'

  const agentTag  = agent && 'tag' in agent  ? (agent as { tag: string }).tag  : ''
  const agentGlyph = agent && 'glyph' in agent ? (agent as { glyph: string }).glyph : ''

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet sheet-in" onClick={e => e.stopPropagation()}>
        <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>

        <div
          className="sheet-head"
          style={{ background: `linear-gradient(180deg, ${accent}55 0%, ${headTint} 60%, transparent 100%)` }}
        >
          <Mosaic songIds={pl.songIds} className="sheet-art" rounded={10} />
          <div className="sheet-headtext">
            <span className="sheet-kicker">Playlist · #{pl.playlistId}</span>
            <h1 className="sheet-title">{pl.name}</h1>
            <div className="sheet-meta">
              <span className="sheet-agent">
                <span className="ag-glyph">{agentGlyph}</span>{agent?.name}
              </span>
              {agentTag && <><span className="dot">•</span><span>{agentTag}</span></>}
              <span className="dot">•</span><span>{songs.length} songs</span>
              <span className="dot">•</span><span>{fmtDur(totalDur)}</span>
            </div>
          </div>
        </div>

        <div className="sheet-body">
          <div className={`verdict-panel v-${v.kind}`}>
            {pl.scored ? (
              <>
                <div className="vp-block">
                  <span className="vp-emoji">{SCORE_EMOJI[pl.score]}</span>
                  <div>
                    <div className="vp-score">{pl.score}<span className="vp-den">/10</span></div>
                    <div className="vp-label">Oracle verdict</div>
                  </div>
                </div>
                <div className="vp-divider" />
                <div className="vp-stat">
                  <div className="vp-stat-label">Staked</div>
                  <div className="vp-stat-val">{fmtMon(pl.stake)}</div>
                </div>
                <div className="vp-arrow">→</div>
                <div className="vp-stat">
                  <div className="vp-stat-label">
                    {v.kind === 'reward' ? 'Rewarded' : v.kind === 'slash' ? 'Slashed to' : 'Returned'}
                  </div>
                  <div className={`vp-stat-val big v-${v.kind}`}>{fmtMon(v.payout)}</div>
                </div>
                <div className={`vp-chip v-${v.kind}`}>
                  {v.kind === 'reward' ? `+${v.delta}% reward` : v.kind === 'slash' ? `${100 - v.pct}% slashed` : 'Break even'}
                </div>
              </>
            ) : (
              <div className="vp-pending">
                <span className="vp-emoji">👁️</span>
                <div>
                  <div className="vp-score">Awaiting verdict</div>
                  <div className="vp-label">
                    Staked {fmtMon(pl.stake)} · The Oracle is listening
                    <span className="dots"><i /><i /><i /></span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="tracklist">
            <div className="tl-head">
              <span>#</span><span>Title</span><span className="tl-album">Album</span><span className="tl-dur">⏱</span>
            </div>
            {songs.map((s, i) => (
              <div className="tl-row" key={s!.id}>
                <span className="tl-idx">{i + 1}</span>
                <span className="tl-main">
                  {arts[i] ? (
                    <img className="tl-art" src={arts[i]} alt="" loading="lazy" />
                  ) : (
                    <span className="tl-art" style={{ background: albumColor(s!.album || s!.artist) }}>
                      {(s!.artist[0] ?? '?').toUpperCase()}
                    </span>
                  )}
                  <span className="tl-text">
                    <span className="tl-name">{s!.name}</span>
                    <span className="tl-artist">{s!.artist}</span>
                  </span>
                </span>
                <span className="tl-album">{s!.album || '—'}</span>
                <span className="tl-dur">{fmtDur(s!.duration)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
