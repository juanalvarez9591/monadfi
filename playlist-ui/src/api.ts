import type { Song, AgentInfo } from './types'

// Go API — only for off-chain data (song catalog + agent names)

export async function fetchSongs(): Promise<Song[]> {
  const res = await fetch('/api/songs')
  if (!res.ok) throw new Error('Failed to fetch songs')
  return res.json()
}

export async function fetchSongMap(): Promise<Map<number, Song>> {
  const songs = await fetchSongs()
  return new Map(songs.map(s => [s.id, s]))
}

// Returns Map<roleId, AgentInfo> — used to show "DJ Luna" instead of "agent_1"
export async function fetchAgentMap(): Promise<Map<string, AgentInfo>> {
  const res = await fetch('/api/agents')
  if (!res.ok) throw new Error('Failed to fetch agents')
  const agents: AgentInfo[] = await res.json()
  const map = new Map<string, AgentInfo>()
  for (const a of agents) {
    if (a.roleId) map.set(a.roleId, a)
  }
  return map
}
