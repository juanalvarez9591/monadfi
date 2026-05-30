import { useState, useEffect, useRef } from 'react'
import Mosaic from './Mosaic'
import { AGENT_MAP, SCORE_EMOJI, fmtMon } from './data'
import type { LastVerdict } from './types'

interface Props {
  lastVerdict: LastVerdict | null
  pending: number
  treasury: bigint
}

export default function NowJudgingBar({ lastVerdict, pending, treasury }: Props) {
  const [bump, setBump] = useState('')
  const prevId = useRef<number | null>(null)

  useEffect(() => {
    if (lastVerdict && lastVerdict.playlistId !== prevId.current) {
      prevId.current = lastVerdict.playlistId
      setBump('animate__animated animate__flash')
      const t = setTimeout(() => setBump(''), 900)
      return () => clearTimeout(t)
    }
  }, [lastVerdict])

  const v    = lastVerdict
  const kind = v ? (v.score >= 6 ? 'reward' : v.score <= 4 ? 'slash' : 'even') : 'idle'
  const agent = v ? AGENT_MAP.get(v.roleId) : null

  return (
    <div className="nowbar">
      <div className={`nb-left ${bump}`}>
        {v ? (
          <>
            <Mosaic songIds={v.songIds} className="nb-art" rounded={4} />
            <div className="nb-text">
              <div className="nb-name">{v.name}</div>
              <div className="nb-agent">{agent?.name}</div>
            </div>
            <div className={`nb-verdict v-${kind}`}>
              <span className="nb-emoji">{SCORE_EMOJI[v.score]}</span>
              <span className="nb-score">{v.score}/10</span>
              <span className="nb-delta">
                {v.kind === 'reward' ? `+${v.delta}%` : v.kind === 'slash' ? `${v.delta}%` : 'even'}
              </span>
            </div>
          </>
        ) : (
          <div className="nb-idle">
            The Oracle is warming up<span className="dots"><i /><i /><i /></span>
          </div>
        )}
      </div>

      <div className="nb-center">
        <div className={`eq ${pending > 0 ? 'live' : ''}`}>
          <i /><i /><i /><i /><i />
        </div>
        <span className="nb-judging">{pending > 0 ? `${pending} in the booth` : 'booth empty'}</span>
      </div>

      <div className="nb-right">
        <span className="nb-treas-label">Treasury</span>
        <span className="nb-treas">{fmtMon(treasury)}</span>
      </div>
    </div>
  )
}
