import { PAYOUT_PCT } from './data'
import type { Playlist, Verdict } from './types'

export function verdictOf(pl: Playlist): Verdict {
  const pct    = PAYOUT_PCT[pl.score - 1] ?? 0
  const payout = pl.agentPayout ?? (pl.stake * BigInt(pct) / 100n)
  const kind   = !pl.scored ? 'pending' : pct > 100 ? 'reward' : pct < 100 ? 'slash' : 'even'
  return { kind, pct, payout, delta: pct - 100 } as Verdict
}
