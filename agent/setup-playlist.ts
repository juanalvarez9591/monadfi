/**
 * setup-playlist.ts
 *
 * Registers PlaylistBounty and creates agents with real personalities:
 *   - Each agent curator has a genre bias and queries GET /songs to get actual DB IDs
 *   - Each agent gets a curated list of playlist names that rotate via randItem:
 *   - The oracle agent scores pending playlists
 *
 * Arg-template tokens (agent/src/execute.ts):
 *   const:<value>          → literal value
 *   const:[…]              → JSON array for uint256[] params
 *   randItem:[…]           → picks a random item from the list each tick
 *   randInt:<min>:<max>    → random int — oracle score
 *   view:<fn>              → on-chain no-arg view — playlist ID to score
 *   _value                 → native MON to send with payable call
 */

import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { Abi } from 'viem'
import { playlistBountyABI } from './src/contracts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const API        = process.env.API_URL ?? 'http://localhost:8080'
const N_AGENTS   = parseInt(process.env.N_AGENTS ?? '3', 10)

// Stake per playlist submission: 0.01 MON in wei.
const STAKE_WEI = (10n ** 16n).toString()

function loadPlaylistDeployments() {
  const path = join(__dirname, 'playlist-deployments.json')
  if (!existsSync(path)) throw new Error('playlist-deployments.json not found — run: npm run deploy:playlist')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

// ── Agent personalities ────────────────────────────────────────────────────────

interface Personality {
  name:          string    // display name shown in the frontend
  roleId:        string    // contract role string (must start with "agent_")
  genreFilter:   string    // ?genre= param for GET /songs
  playlistNames: string[]  // creative names, one picked at random each tick
  fallbackIds:   number[]  // used when not enough songs match the genre filter
}

const PERSONALITIES: Personality[] = [
  {
    name:          'DJ Luna',
    roleId:        'agent_1',
    genreFilter:   'Reggaeton',
    playlistNames: [
      'Noches de Perreo', 'Reggaeton Sin Filtros', 'Barrio Hits Vol.1',
      'Late Night Reggaeton', 'Flow Tropical', 'Perreo Intenso',
    ],
    fallbackIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  },
  {
    name:          'Trap Maestro',
    roleId:        'agent_2',
    genreFilter:   'Trap',
    playlistNames: [
      'Trap Season Vol.2', 'Hood Classics', 'Midnight Trap Session',
      'Calle Profunda', 'Dark Mode On', 'Trap Para Los Reales',
    ],
    fallbackIds: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  },
  {
    name:          'Pop Princesa',
    roleId:        'agent_3',
    genreFilter:   'Pop',
    playlistNames: [
      'Summer Bops', 'Pop Hits Latam', 'Feel Good Friday',
      'Guilty Pleasures', 'Vibes Solares', 'Pop Sin Fronteras',
    ],
    fallbackIds: [21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  },
  {
    name:          'Cuartetero Pro',
    roleId:        'agent_4',
    genreFilter:   'Cuarteto',
    playlistNames: [
      'Fiesta de Barrio', 'Cuarteto Classics', 'Para Bailar Toda La Noche',
      'Lo Mejor del Cuarteto', 'Cordobazo Musical', 'Che Cuarteto',
    ],
    fallbackIds: [31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
  },
  {
    name:          'Rock Señor',
    roleId:        'agent_5',
    genreFilter:   'Rock',
    playlistNames: [
      'Rock Nacional Eterno', 'Guitarras & Corazones', 'Clásicos del Rock Arg',
      'Viejo Pero Bello', 'Headbang Criollo', 'Rock Sin Fronteras',
    ],
    fallbackIds: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
  },
  {
    name:          'Urbano King',
    roleId:        'agent_6',
    genreFilter:   'Urbano',
    playlistNames: [
      'Urbano Caliente', 'Street Level', 'El Bloque Suena',
      'Desde la Villa', 'Sonido Urbano 24/7', 'Top Urbano Latam',
    ],
    fallbackIds: [1, 7, 15, 22, 30, 38, 47, 3, 6, 24],
  },
]

// ── API helpers ───────────────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}


function fragment(name: string, abi: Abi): any {
  const f = (abi as any[]).find((x: any) => x.type === 'function' && x.name === name)
  if (!f) throw new Error(`ABI fragment not found: ${name}`)
  return f
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const dep = loadPlaylistDeployments()
  if (!dep.PlaylistBounty) throw new Error('PlaylistBounty not in playlist-deployments.json')

  console.log(`PlaylistBounty : ${dep.PlaylistBounty}`)
  console.log(`Creating ${N_AGENTS} agent(s) + 1 oracle\n`)

  // ── 1. Register the contract ──────────────────────────────────────────────
  console.log('── Registering PlaylistBounty…')
  const contract = await post<any>('/contracts', {
    name:       'PlaylistBounty',
    address:    dep.PlaylistBounty,
    abi:        JSON.stringify(playlistBountyABI),
    chainId:    dep.chainId,
    deployedAt: dep.deployedAt,
  })
  console.log(`  id=${contract.id}  ${contract.address}`)

  // ── 2. Statuses ───────────────────────────────────────────────────────────
  console.log('\n── Creating statuses…')
  const mkStatus = (name: string) =>
    post<any>('/statuses', {
      contractId:   contract.id,
      functionName: name,
      functionAbi:  fragment(name, playlistBountyABI),
    })
  const sCanSubmit      = await mkStatus('canSubmit')
  const sCanScore       = await mkStatus('canScore')
  const sRoundSubmitted = await mkStatus('roundSubmitted')
  console.log(`  [${sCanSubmit.id}] canSubmit  [${sCanScore.id}] canScore  [${sRoundSubmitted.id}] roundSubmitted`)

  // ── 3. Preview songs per agent personality (informational only) ──────────
  console.log('\n── Song query tokens per agent (resolved live each tick via api: token)…')
  for (let i = 0; i < N_AGENTS; i++) {
    const p = PERSONALITIES[i % PERSONALITIES.length]
    console.log(`  ${p.name} (${p.roleId}): GET /songs?genre=${encodeURIComponent(p.genreFilter)}&limit=10  (fresh each tick)`)
  }

  // ── 4. Actions ────────────────────────────────────────────────────────────
  console.log('\n── Creating actions…')
  const submitActions: any[] = []
  for (let i = 0; i < N_AGENTS; i++) {
    const p      = PERSONALITIES[i % PERSONALITIES.length]
    // songIds resolved live every tick: GET /songs?genre=<X>&limit=10 → extract id field
    const songToken = `api:/songs?genre=${encodeURIComponent(p.genreFilter)}&limit=10&extract=id`
    const action = await post<any>('/actions', {
      contractId:   contract.id,
      functionName: 'submitPlaylist',
      functionAbi:  fragment('submitPlaylist', playlistBountyABI),
      argsTemplate: {
        roleId:  `const:${p.roleId}`,
        name:    `randItem:${JSON.stringify(p.playlistNames)}`,
        songIds: songToken,
        _value:  `const:${STAKE_WEI}`,
      },
    })
    submitActions.push(action)
    console.log(`  [${action.id}] submitPlaylist  ${p.name} (${p.roleId})  songs=${songToken}`)
  }

  const scoreAction = await post<any>('/actions', {
    contractId:   contract.id,
    functionName: 'scorePlaylist',
    functionAbi:  fragment('scorePlaylist', playlistBountyABI),
    argsTemplate: {
      roleId:     'const:oracle_1',
      playlistId: 'view:pendingPlaylistId',
      score:      'randInt:1:10',
    },
  })
  console.log(`  [${scoreAction.id}] scorePlaylist  role=oracle_1`)

  // ── 5. Agent agents ───────────────────────────────────────────────────────
  console.log('\n── Creating agent agents…')
  const agentIds: number[] = []
  for (let i = 0; i < N_AGENTS; i++) {
    const p     = PERSONALITIES[i % PERSONALITIES.length]
    const agent = await post<any>('/agents', {
      name:      p.name,
      roleId:    p.roleId,
      prompt:    `You are ${p.name} (${p.roleId}), a ${p.genreFilter} playlist curator on PlaylistBounty.
Each round has a pool of ${15} submissions. You compete against other curators for the highest oracle score.
Task: If canSubmit=true → call submitPlaylist to add your playlist to the pool.
      If canSubmit=false → wait (pool is full, oracle is scoring this round).`,
      statusIds: [sCanSubmit.id, sRoundSubmitted.id],
      actionIds: [submitActions[i].id],
    })
    agentIds.push(agent.id)
    console.log(`  [${agent.id}] ${p.name} (${p.roleId})`)
  }

  // ── 6. Oracle agent ───────────────────────────────────────────────────────
  console.log('\n── Creating oracle agent…')
  const oracleAgent = await post<any>('/agents', {
    name:      'The Oracle',
    roleId:    'oracle_1',
    prompt:    `You are The Oracle (oracle_1) on PlaylistBounty. You score submitted playlists.
Task: If canScore=true → call scorePlaylist to judge the next pending playlist.
      If canScore=false → wait (no playlists to score yet).`,
    statusIds: [sCanScore.id],
    actionIds: [scoreAction.id],
  })
  console.log(`  [${oracleAgent.id}] The Oracle (oracle_1)`)

  // ── 7. Save IDs ───────────────────────────────────────────────────────────
  const idsContent = [
    ...agentIds.map((id, i) => `AGENT_${i + 1}_ID=${id}`),
    `ORACLE_ID=${oracleAgent.id}`,
  ].join('\n') + '\n'
  writeFileSync(join(__dirname, '.playlist-agent-ids'), idsContent)

  console.log(`
Done.
  Contract  : PlaylistBounty id=${contract.id}
  Statuses  : canSubmit=${sCanSubmit.id}  canScore=${sCanScore.id}
  Agents    : ${agentIds.map((id, i) => `${PERSONALITIES[i % PERSONALITIES.length].name}=${id}`).join('  ')}
  Oracle    : oracle_1=${oracleAgent.id}
  Stake/tx  : ${Number(STAKE_WEI) / 1e18} MON
  Song query: GET /songs?genre=<X>&limit=10  (resolved live each tick via api: token)
`)
  console.log('Saved → .playlist-agent-ids')
}

main().catch((e) => { console.error(e); process.exit(1) })
