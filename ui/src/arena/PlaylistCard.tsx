import { useState, useEffect, useRef } from 'react'
import Mosaic from './Mosaic'
import { AGENT_MAP, SCORE_EMOJI, fmtMonShort } from './data'
import { verdictOf } from './helpers'
import type { Playlist } from './types'

interface Props {
  pl: Playlist
  onOpen: (pl: Playlist) => void
}

export default function PlaylistCard({ pl, onOpen }: Props) {
  const agent      = AGENT_MAP.get(pl.roleId)
  const v          = verdictOf(pl)
  const wasScored  = useRef(pl.scored)
  const [anim, setAnim] = useState('')

  useEffect(() => {
    if (pl.scored && !wasScored.current) {
      const big = pl.score >= 9
      setAnim(
        v.kind === 'slash'  ? 'fx-slash animate__animated animate__headShake' :
        big                 ? 'fx-reward animate__animated animate__tada' :
        v.kind === 'reward' ? 'fx-reward animate__animated animate__pulse' :
                              'fx-even'
      )
      const t = setTimeout(() => setAnim(''), 1300)
      return () => clearTimeout(t)
    }
    wasScored.current = pl.scored
  }, [pl.scored, pl.score, v.kind])

  const ringClass = !pl.scored    ? 'ring-pending'
    : v.kind === 'reward'         ? 'ring-reward'
    : v.kind === 'slash'          ? 'ring-slash'
    :                               'ring-even'

  return (
    <button className={`pcard ${ringClass} ${anim}`} onClick={() => onOpen(pl)}>
      <div className="pcard-art">
        <Mosaic songIds={pl.songIds} />
        <span className="pcard-play" aria-hidden="true">▶</span>
        {pl.scored ? (
          <span className={`pcard-score s-${v.kind}`}>
            <span className="pcard-score-emoji">{SCORE_EMOJI[pl.score]}</span>
            {pl.score}<span className="pcard-score-den">/10</span>
          </span>
        ) : (
          <span className="pcard-score s-pending">
            judging<span className="dots"><i /><i /><i /></span>
          </span>
        )}
      </div>
      <div className="pcard-title" title={pl.name}>{pl.name}</div>
      <div className="pcard-sub">
        <span className="pcard-agent">
          <span className="ag-glyph">{'glyph' in (agent ?? {}) ? (agent as { glyph: string }).glyph : ''}</span>
          {agent?.name ?? pl.roleId}
        </span>
      </div>
      <div className="pcard-foot">
        <span className="pcard-stake">{fmtMonShort(pl.stake)}</span>
        {pl.scored && (
          <span className={`pcard-delta d-${v.kind}`}>
            {v.kind === 'reward' ? `+${v.delta}%` : v.kind === 'slash' ? `${v.delta}%` : 'even'}
          </span>
        )}
      </div>
    </button>
  )
}
