export interface Song {
  id: number
  name: string
  artist: string
  album: string
  releaseDate: string
  duration: number
  genre: string
  imageUrl: string
  createdAt: string
}

export interface AgentDef {
  roleId: string
  name: string
  tag: string
  glyph: string
}

export interface OracleDef {
  roleId: string
  name: string
  glyph: string
}

export interface Playlist {
  id: number
  playlistId: number
  roleId: string
  name: string
  songIds: number[]
  stake: bigint
  submittedAt: number
  scored: boolean
  score: number
  agentPayout?: bigint
  treasuryDelta?: bigint
  treasuryGained?: boolean
}

export type VerdictKind = 'reward' | 'slash' | 'even' | 'pending'

export interface Verdict {
  kind: VerdictKind
  pct: number
  payout: bigint
  delta: number
}

export interface ActivityEntry {
  id: number
  ts: number
  event: 'submitted' | 'scored' | 'roundComplete'
  playlistId: number
  roleId: string
  agentName?: string
  playlistName?: string
  songIds?: number[]
  stake?: bigint
  score?: number
  agentPayout?: bigint
  treasuryDelta?: bigint
  treasuryGained?: boolean
  round?: number
  poolSize?: number
  totalScore?: number
  avgScore10x?: number
}

export interface Toast {
  id: number
  type: 'success' | 'error' | 'warning' | 'info'
  ico: string
  title: string
  body?: string
}

export interface RoundInfo {
  round: number
  submitted: number
  poolSize: number
}

export interface RoundStat {
  round: number
  avgScore: number
}

export interface LastVerdict {
  playlistId: number
  roleId: string
  name: string
  songIds: number[]
  score: number
  kind: 'reward' | 'slash' | 'even'
  delta: number
}

export interface SubmittedEvent {
  playlistId: number
  roleId: string
  name: string
  songIds: number[]
  stake: bigint
}

export interface ScoredEvent {
  playlistId: number
  roleId: string
  score: number
  agentPayout: bigint
  treasuryDelta: bigint
  treasuryGained: boolean
  treasury: bigint
}

export interface RoundCompleteEvent {
  round: number
  poolSize: number
  totalScore: number
  avgScore10x: number
}

export interface SimHandlers {
  onTreasury?: (treasury: bigint) => void
  onSubmitted?: (ev: SubmittedEvent) => void
  onScored?: (ev: ScoredEvent) => void
  onRoundComplete?: (ev: RoundCompleteEvent) => void
}
