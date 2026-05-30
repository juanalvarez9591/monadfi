import { createPublicClient, http, defineChain } from 'viem'
import type { Playlist } from './types'

const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadExplorer', url: 'https://testnet.monadexplorer.com' } },
})

export const CONTRACT_ADDRESS =
  (import.meta.env.VITE_CONTRACT_ADDRESS ?? '') as `0x${string}`

export const client = createPublicClient({
  chain: monadTestnet,
  transport: http('https://testnet-rpc.monad.xyz'),
  pollingInterval: 2_000,
})

export const ABI = [
  {
    type: 'event', name: 'PlaylistSubmitted',
    inputs: [
      { name: 'playlistId', type: 'uint256',   indexed: true  },
      { name: 'roleId',     type: 'string',    indexed: false },
      { name: 'name',       type: 'string',    indexed: false },
      { name: 'songIds',    type: 'uint256[]', indexed: false },
      { name: 'stake',      type: 'uint256',   indexed: false },
    ],
  },
  {
    type: 'event', name: 'PlaylistScored',
    inputs: [
      { name: 'playlistId',     type: 'uint256', indexed: true  },
      { name: 'roleId',         type: 'string',  indexed: false },
      { name: 'score',          type: 'uint8',   indexed: false },
      { name: 'agentPayout',    type: 'uint256', indexed: false },
      { name: 'treasuryDelta',  type: 'uint256', indexed: false },
      { name: 'treasuryGained', type: 'bool',    indexed: false },
    ],
  },
  {
    type: 'event', name: 'RoundComplete',
    inputs: [
      { name: 'round',       type: 'uint256', indexed: true  },
      { name: 'poolSize',    type: 'uint256', indexed: false },
      { name: 'totalScore',  type: 'uint256', indexed: false },
      { name: 'avgScore10x', type: 'uint256', indexed: false },
    ],
  },
  { type: 'function', name: 'treasury',       stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'playlistCount',  stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'pendingCount',   stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'round',          stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'roundSubmitted', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'POOL_SIZE',      stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
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

export async function readTreasury(addr: `0x${string}`): Promise<bigint> {
  return client.readContract({ address: addr, abi: ABI, functionName: 'treasury' }) as Promise<bigint>
}

export async function readRoundInfo(addr: `0x${string}`): Promise<{ round: number; submitted: number; poolSize: number }> {
  const [round, submitted, poolSize] = await Promise.all([
    client.readContract({ address: addr, abi: ABI, functionName: 'round' }),
    client.readContract({ address: addr, abi: ABI, functionName: 'roundSubmitted' }),
    client.readContract({ address: addr, abi: ABI, functionName: 'POOL_SIZE' }),
  ]) as [bigint, bigint, bigint]
  return { round: Number(round), submitted: Number(submitted), poolSize: Number(poolSize) }
}

export async function readAllPlaylists(addr: `0x${string}`): Promise<Playlist[]> {
  const count = Number(
    await client.readContract({ address: addr, abi: ABI, functionName: 'playlistCount' }) as bigint
  )
  const results: Playlist[] = []
  for (let i = 0; i < count; i++) {
    const [roleId, name, songIds, stake, submittedAt, scored, score] = await client.readContract({
      address: addr, abi: ABI, functionName: 'getPlaylist', args: [BigInt(i)],
    }) as [string, string, bigint[], bigint, bigint, boolean, number]
    results.push({
      id: i, playlistId: i, roleId, name,
      songIds: (songIds as bigint[]).map(Number),
      stake: BigInt(stake),
      submittedAt: Number(submittedAt),
      scored, score: Number(score),
    })
    if (i < count - 1) await new Promise(r => setTimeout(r, 80))
  }
  return results
}
