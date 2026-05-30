import { createPublicClient, http, formatEther } from 'viem'
import { foundry } from 'viem/chains'
import type { Playlist } from './types'

export const client = createPublicClient({
  chain: foundry,
  transport: http('http://localhost:8545'),
  pollingInterval: 1_000,
})

// Minimal ABI — events + views we actually use
export const ABI = [
  {
    type: 'event',
    name: 'PlaylistSubmitted',
    inputs: [
      { name: 'playlistId', type: 'uint256',   indexed: true  },
      { name: 'roleId',     type: 'string',    indexed: false },
      { name: 'name',       type: 'string',    indexed: false },
      { name: 'songIds',    type: 'uint256[]', indexed: false },
      { name: 'stake',      type: 'uint256',   indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PlaylistScored',
    inputs: [
      { name: 'playlistId',    type: 'uint256', indexed: true  },
      { name: 'roleId',        type: 'string',  indexed: false },
      { name: 'score',         type: 'uint8',   indexed: false },
      { name: 'agentPayout',   type: 'uint256', indexed: false },
      { name: 'treasuryDelta', type: 'uint256', indexed: false },
      { name: 'treasuryGained',type: 'bool',    indexed: false },
    ],
  },
  {
    type: 'function', name: 'playlistCount', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'treasury', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'pendingCount', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'round', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'roundSubmitted', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'POOL_SIZE', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'RoundComplete',
    inputs: [
      { name: 'round',       type: 'uint256', indexed: true  },
      { name: 'poolSize',    type: 'uint256', indexed: false },
      { name: 'totalScore',  type: 'uint256', indexed: false },
      { name: 'avgScore10x', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'function', name: 'getPlaylist', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [
      { name: 'roleId',      type: 'string'    },
      { name: 'name',        type: 'string'    },
      { name: 'songIds',     type: 'uint256[]' },
      { name: 'stake',       type: 'uint256'   },
      { name: 'submittedAt', type: 'uint256'   },
      { name: 'scored',      type: 'bool'      },
      { name: 'score',       type: 'uint8'     },
    ],
  },
] as const

// ── Contract address from Go API ──────────────────────────────────────────────

export async function fetchContractAddress(): Promise<`0x${string}`> {
  const res = await fetch('/api/contracts')
  if (!res.ok) throw new Error('API unreachable')
  const contracts: any[] = await res.json()
  const found = contracts.find((c: any) => c.name === 'PlaylistBounty')
  if (!found) throw new Error('PlaylistBounty not registered in API — run: npm run setup:playlist')
  return found.address as `0x${string}`
}

// ── Read helpers ──────────────────────────────────────────────────────────────

export async function readTreasury(addr: `0x${string}`): Promise<bigint> {
  return client.readContract({ address: addr, abi: ABI, functionName: 'treasury' }) as Promise<bigint>
}

export async function readPlaylistCount(addr: `0x${string}`): Promise<number> {
  const n = await client.readContract({ address: addr, abi: ABI, functionName: 'playlistCount' }) as bigint
  return Number(n)
}

export async function readPendingCount(addr: `0x${string}`): Promise<number> {
  const n = await client.readContract({ address: addr, abi: ABI, functionName: 'pendingCount' }) as bigint
  return Number(n)
}

export async function readRoundInfo(addr: `0x${string}`): Promise<{ round: number; submitted: number; poolSize: number }> {
  const [round, submitted, poolSize] = await Promise.all([
    client.readContract({ address: addr, abi: ABI, functionName: 'round' }),
    client.readContract({ address: addr, abi: ABI, functionName: 'roundSubmitted' }),
    client.readContract({ address: addr, abi: ABI, functionName: 'POOL_SIZE' }),
  ]) as [bigint, bigint, bigint]
  return { round: Number(round), submitted: Number(submitted), poolSize: Number(poolSize) }
}

export async function readPlaylist(
  addr: `0x${string}`,
  id: number,
  agentMap: Map<string, { name: string; roleId: string }>,
): Promise<Playlist> {
  const [roleId, name, songIds, stake, submittedAt, scored, score] = await client.readContract({
    address: addr, abi: ABI, functionName: 'getPlaylist', args: [BigInt(id)],
  }) as [string, string, bigint[], bigint, bigint, boolean, number]

  return {
    id,
    roleId,
    agentName: agentMap.get(roleId)?.name ?? roleId,
    name,
    songIds: songIds.map(Number),
    stake,
    submittedAt: Number(submittedAt),
    scored,
    score: Number(score),
  }
}

export async function readAllPlaylists(
  addr: `0x${string}`,
  agentMap: Map<string, { name: string; roleId: string }>,
): Promise<Playlist[]> {
  const count = await readPlaylistCount(addr)
  return Promise.all(Array.from({ length: count }, (_, i) => readPlaylist(addr, i, agentMap)))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export const fmtMon = (wei: bigint) =>
  `${parseFloat(formatEther(wei)).toFixed(4)} MON`
