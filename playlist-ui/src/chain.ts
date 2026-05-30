import { createPublicClient, http, formatEther, defineChain } from 'viem'
import { foundry } from 'viem/chains'
import type { Playlist } from './types'

// ── Monad testnet chain definition ────────────────────────────────────────────

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] },
  },
  blockExplorers: {
    default: { name: 'MonadExplorer', url: 'https://testnet.monadexplorer.com' },
  },
})

// ── Runtime config (set as env vars at build time) ────────────────────────────

const RPC_URL: string =
  import.meta.env.VITE_RPC_URL ?? 'https://testnet-rpc.monad.xyz'

// VITE_CONTRACT_ADDRESS must be set at build time (or in playlist-ui/.env for dev).
export const CONTRACT_ADDRESS: `0x${string}` =
  (import.meta.env.VITE_CONTRACT_ADDRESS ?? '') as `0x${string}`

// Use foundry chain for local dev (localhost RPC), Monad testnet otherwise.
const isLocal = RPC_URL.includes('localhost') || RPC_URL.includes('127.0.0.1')
const chain = isLocal ? foundry : monadTestnet

export const client = createPublicClient({
  chain,
  transport: http(RPC_URL),
  pollingInterval: 2_000,
})

// ── Minimal ABI — events + views used by the frontend ─────────────────────────

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
  const results: Playlist[] = []
  // Fetch sequentially with a small delay to stay under the 15 req/s public RPC limit
  for (let i = 0; i < count; i++) {
    results.push(await readPlaylist(addr, i, agentMap))
    if (i < count - 1) await new Promise(r => setTimeout(r, 100))
  }
  return results
}

export const fmtMon = (wei: bigint) =>
  `${parseFloat(formatEther(wei)).toFixed(4)} MON`
