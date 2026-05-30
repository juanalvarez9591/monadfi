import type { Song, AgentDef, OracleDef } from './types'
import SONGS_RAW from './songs.json'

export const SONGS: Song[] = SONGS_RAW as Song[]
export const SONG_MAP = new Map(SONGS.map(s => [s.id, s]))

export const AGENTS: AgentDef[] = [
  { roleId: 'agent_1', name: 'Mateo', tag: 'Music Lover',  glyph: '🎵' },
  { roleId: 'agent_2', name: 'Sofia', tag: 'Playlist Geek', glyph: '🎶' },
  { roleId: 'agent_3', name: 'Lucas', tag: 'Vibe Setter',   glyph: '🎸' },
  { roleId: 'agent_4', name: 'Emma',  tag: 'Sound Chaser',  glyph: '🎹' },
  { roleId: 'agent_5', name: 'Diego', tag: 'Beat Hunter',   glyph: '🥁' },
  { roleId: 'agent_6', name: 'Vale',  tag: 'Mood Maker',    glyph: '🎤' },
]

export const ORACLE: OracleDef = { roleId: 'oracle_1', name: 'The Oracle', glyph: '👁️' }
export const AGENT_MAP = new Map<string, AgentDef | OracleDef>([
  ...AGENTS.map(a => [a.roleId, a] as [string, AgentDef]),
  [ORACLE.roleId, ORACLE],
])

// Payout curve (% of stake returned) by score 1..10 — preserved from App.tsx
export const PAYOUT_PCT = [0, 20, 40, 60, 100, 110, 120, 140, 170, 200]
export const SCORE_EMOJI: Record<number, string> = {
  1:'💀', 2:'😱', 3:'😞', 4:'😐', 5:'😶', 6:'🙂', 7:'😊', 8:'😃', 9:'🤩', 10:'🏆',
}
export const POOL_SIZE = 15

export const fmtMon  = (wei: bigint) => (Number(wei) / 1e18).toFixed(4) + ' MON'
export const fmtMonShort = (wei: bigint) => {
  const v = Number(wei) / 1e18
  return (v >= 1 ? v.toFixed(2) : v.toFixed(3)) + ' MON'
}
export const parseMon = (n: number): bigint => BigInt(Math.round(n * 1e18))
export const fmtDur  = (sec = 0) => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

export function mosaicArt(songIds: number[]): string[] {
  const seen = new Set<string>()
  const arts: string[] = []
  for (const id of songIds) {
    const s = SONG_MAP.get(id)
    if (!s?.imageUrl) continue
    if (seen.has(s.imageUrl)) continue
    seen.add(s.imageUrl)
    arts.push(s.imageUrl)
    if (arts.length === 4) break
  }
  if (arts.length < 4) {
    for (const id of songIds) {
      const s = SONG_MAP.get(id)
      if (s?.imageUrl && arts.length < 4) arts.push(s.imageUrl)
      if (arts.length === 4) break
    }
  }
  return arts
}

const PALETTE = ['#1f6feb','#a371f7','#db61a2','#3fb950','#d29922','#f85149','#39c5cf','#8b949e']
export function albumColor(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h * 31 + str.charCodeAt(i)) >>> 0)
  return PALETTE[h % PALETTE.length]
}
