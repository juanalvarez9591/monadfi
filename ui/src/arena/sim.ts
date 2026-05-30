import { AGENTS, SONGS, SONG_MAP, PAYOUT_PCT, POOL_SIZE, parseMon } from './data'
import type { SimHandlers, SubmittedEvent } from './types'

const rand   = (a: number, b: number) => a + Math.random() * (b - a)
const pick   = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const sample = <T>(arr: T[], n: number): T[] => {
  const pool = [...arr]; const out: T[] = []
  while (out.length < n && pool.length)
    out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  return out
}

function playlistTitle(songIds: number[]): string {
  const a = SONG_MAP.get(songIds[0])
  const b = SONG_MAP.get(songIds[1])
  const artistOf = (s: typeof a) => s?.artist.split(',')[0].trim() ?? '?'
  return `${artistOf(a)} & ${artistOf(b)}`
}

function rollScore() {
  const r = Math.random()
  if (r < 0.10) return Math.floor(rand(1, 3.99))
  if (r < 0.24) return 4
  if (r < 0.34) return 5
  if (r < 0.62) return Math.floor(rand(6, 7.99))
  if (r < 0.88) return Math.floor(rand(8, 9.99))
  return 10
}

interface SimState {
  nextId: number
  round: number
  roundScored: number
  roundTotal: number
  treasury: bigint
}

export class SimEngine {
  private state: SimState
  private handlers: SimHandlers
  private timers: ReturnType<typeof setTimeout>[]
  private pending: SubmittedEvent[]

  constructor() {
    this.state = { nextId: 0, round: 1, roundScored: 0, roundTotal: 0, treasury: parseMon(40) }
    this.handlers = {}
    this.timers = []
    this.pending = []
  }

  on(h: SimHandlers) { this.handlers = h; return this }

  private makePlaylist(): SubmittedEvent {
    const agent   = pick(AGENTS)
    const songIds = sample(SONGS.map(s => s.id), 5)
    const stake   = parseMon(+rand(0.25, 2.5).toFixed(3))
    return {
      playlistId: this.state.nextId++,
      roleId: agent.roleId,
      name: playlistTitle(songIds),
      songIds,
      stake,
    }
  }

  private scoreOf(stake: bigint, score: number) {
    const pct    = PAYOUT_PCT[score - 1] ?? 0
    const payout = stake * BigInt(pct) / 100n
    const gained = pct < 100
    const delta  = gained ? (stake - payout) : (payout - stake)
    return { pct, payout, treasuryDelta: delta, treasuryGained: gained }
  }

  private emitSubmit(pl: SubmittedEvent) {
    this.handlers.onSubmitted?.(pl)
  }

  private emitScore(pl: SubmittedEvent, score: number) {
    const { payout, treasuryDelta, treasuryGained } = this.scoreOf(pl.stake, score)
    this.state.treasury += treasuryGained ? treasuryDelta : -treasuryDelta
    if (this.state.treasury < 0n) this.state.treasury = 0n
    this.handlers.onScored?.({
      playlistId: pl.playlistId, roleId: pl.roleId, score,
      agentPayout: payout, treasuryDelta, treasuryGained,
      treasury: this.state.treasury,
    })
    this.state.roundScored += 1
    this.state.roundTotal  += score
    if (this.state.roundScored >= POOL_SIZE) {
      const total  = this.state.roundTotal
      const avg10x = Math.round((total / this.state.roundScored) * 10)
      this.handlers.onRoundComplete?.({
        round: this.state.round, poolSize: this.state.roundScored,
        totalScore: total, avgScore10x: avg10x,
      })
      this.state.round       += 1
      this.state.roundScored  = 0
      this.state.roundTotal   = 0
    }
  }

  seed(n = 6) {
    for (let i = 0; i < n; i++) {
      const pl = this.makePlaylist()
      this.emitSubmit(pl)
      this.emitScore(pl, rollScore())
    }
    for (let i = 0; i < 2; i++) {
      const pl = this.makePlaylist()
      this.emitSubmit(pl)
      this.pending.push(pl)
      this.queueVerdict(pl, rand(2200, 4200))
    }
    this.handlers.onTreasury?.(this.state.treasury)
  }

  private queueVerdict(pl: SubmittedEvent, delay: number) {
    const t = setTimeout(() => {
      this.pending = this.pending.filter(p => p !== pl)
      this.emitScore(pl, rollScore())
    }, delay)
    this.timers.push(t)
  }

  start() {
    const loop = () => {
      const pl = this.makePlaylist()
      this.emitSubmit(pl)
      this.pending.push(pl)
      this.queueVerdict(pl, rand(2600, 5200))
      this.timers.push(setTimeout(loop, rand(2600, 4400)))
    }
    this.timers.push(setTimeout(loop, 1800))
  }

  stop() { this.timers.forEach(clearTimeout); this.timers = [] }
}
