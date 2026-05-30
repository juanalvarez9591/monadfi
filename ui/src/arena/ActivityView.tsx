import { AGENT_MAP, PAYOUT_PCT, fmtMonShort } from './data'
import type { ActivityEntry } from './types'

interface Props { entries: ActivityEntry[] }

export default function ActivityView({ entries }: Props) {
  const rev = [...entries].reverse()
  if (!rev.length)
    return <div className="a-empty"><span className="empty-ico">≋</span>Listening for events…</div>

  return (
    <div className="activity">
      {rev.map(e => {
        if (e.event === 'roundComplete') {
          const avg  = (e.avgScore10x ?? 0) / 10
          const tone = avg >= 7 ? 'good' : avg >= 5 ? 'ok' : 'bad'
          return (
            <div className={`act-row act-round r-${tone}`} key={e.id}>
              <span className="act-ico">{avg >= 7 ? '🏆' : avg >= 5 ? '📊' : '📉'}</span>
              <div className="act-mid">
                <div className="act-line"><b>Round #{e.round} complete</b></div>
                <div className="act-sub">{e.poolSize} scored · avg {avg.toFixed(1)}/10</div>
              </div>
              <span className="act-time">{new Date(e.ts).toLocaleTimeString()}</span>
            </div>
          )
        }

        const isSubmit = e.event === 'submitted'
        const agent    = AGENT_MAP.get(e.roleId)
        const pct      = isSubmit ? 0 : (PAYOUT_PCT[(e.score ?? 1) - 1] ?? 0)
        const kind     = isSubmit ? 'submit' : pct > 100 ? 'reward' : pct < 100 ? 'slash' : 'even'

        return (
          <div className={`act-row k-${kind}`} key={e.id}>
            <span className="act-ico">{isSubmit ? '↥' : e.score !== undefined ? '🎵' : '?'}</span>
            <div className="act-mid">
              <div className="act-line">
                <b>{agent?.name ?? e.roleId}</b>
                <span className="act-verb">{isSubmit ? 'submitted' : 'was scored'}</span>
                {e.playlistName && <span className="act-pl">"{e.playlistName}"</span>}
                <span className="act-id">#{e.playlistId}</span>
              </div>
              <div className="act-sub">
                {isSubmit ? (
                  <>staked <span className="mono">{fmtMonShort(e.stake ?? 0n)}</span></>
                ) : (
                  <>
                    <span className={`act-score k-${kind}`}>{e.score}/10</span>
                    <span className={`mono k-${kind}`}>
                      {kind === 'reward' ? '+' : kind === 'slash' ? '−' : ''}{Math.abs(pct - 100)}%
                    </span>
                    <span className="mono">→ {fmtMonShort(e.agentPayout ?? 0n)}</span>
                    {e.treasuryDelta !== undefined && e.treasuryDelta > 0n && (
                      <span className="act-treas">
                        treasury {e.treasuryGained ? '+' : '−'}{fmtMonShort(e.treasuryDelta)}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
            <span className="act-time">{new Date(e.ts).toLocaleTimeString()}</span>
          </div>
        )
      })}
    </div>
  )
}
