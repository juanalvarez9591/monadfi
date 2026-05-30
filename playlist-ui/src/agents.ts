import type { AgentInfo } from './types'

// Static personality map — mirrors agent/setup-playlist.ts PERSONALITIES.
// No API call needed; these names are fixed at deploy time.
const PERSONALITIES: Record<string, string> = {
  agent_1:  'DJ Luna',
  agent_2:  'Trap Maestro',
  agent_3:  'Pop Princesa',
  agent_4:  'Cuartetero Pro',
  agent_5:  'Rock Señor',
  agent_6:  'Urbano King',
  oracle_1: 'The Oracle',
}

export function buildAgentMap(): Map<string, AgentInfo> {
  const map = new Map<string, AgentInfo>()
  let id = 1
  for (const [roleId, name] of Object.entries(PERSONALITIES)) {
    map.set(roleId, { id: id++, name, roleId })
  }
  return map
}

export function agentName(roleId: string): string {
  return PERSONALITIES[roleId] ?? roleId
}
