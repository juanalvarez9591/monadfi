/**
 * functional.ts
 *
 * End-to-end deterministic functional test of the House Roulette + MonadToken
 * use case, driven entirely through the agent execution schema.
 *
 * It plays one full round by ticking the real agents (each tick: read chain state
 * → API/LLM picks an action from an enum → runner resolves args deterministically
 * → simulate-before-send → execute), advancing anvil's clock between phases so the
 * round completes in milliseconds instead of waiting out the real window.
 *
 * Determinism: a single player contributes, so the winner is that player
 * regardless of the on-chain randomness — the end state is fully predictable.
 *
 * Preconditions (the `make functional` target sets these up):
 *   anvil (instamine) + API + Ollama running, contracts deployed, `npm run setup`
 *   done, player wallet funded.  Usage:  npm run functional
 */

import { type Abi, getAddress } from 'viem'
import { publicClient, getAnvilAccount, makeWalletClient, timeTravel } from './src/client.js'
import { getAgentWallet } from './src/wallets.js'
import { runAgentOnce, type AgentScope } from './src/execute.js'
import { loadDeployments, casinoRouletteABI, monadTokenABI } from './src/contracts.js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const API = process.env.API_URL ?? 'http://localhost:8080'

function agentIds(): { house: number; player: number } {
  const txt = readFileSync(join(__dirname, '.agent-ids'), 'utf-8')
  const house = Number(/HOUSE_ID=(\d+)/.exec(txt)?.[1])
  const player = Number(/PLAYER_ID=(\d+)/.exec(txt)?.[1])
  if (!house || !player) throw new Error('.agent-ids missing HOUSE_ID/PLAYER_ID — run npm run setup')
  return { house, player }
}

async function scope(id: number): Promise<AgentScope> {
  const res = await fetch(`${API}/agents/${id}`)
  if (!res.ok) throw new Error(`agent ${id} not found`)
  return res.json()
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

async function main() {
  const dep = loadDeployments()
  const casino = dep.CasinoRoulette as `0x${string}`
  const mtkn = dep.MonadToken as `0x${string}`
  const ids = agentIds()

  const houseWallet = getAnvilAccount(0)            // contract owner / deployer
  const playerWallet = getAgentWallet(0)            // funded by `npm run fund`
  const houseClient = makeWalletClient(houseWallet)
  const playerClient = makeWalletClient(playerWallet)

  const house = await scope(ids.house)
  const player = await scope(ids.player)

  const readGame = () =>
    publicClient.readContract({ address: casino, abi: casinoRouletteABI, functionName: 'getCurrentGame' }) as Promise<any>
  const balOf = (a: `0x${string}`) =>
    publicClient.readContract({ address: mtkn, abi: monadTokenABI, functionName: 'balanceOf', args: [a] }) as Promise<bigint>
  const window = (await publicClient.readContract({
    address: casino, abi: casinoRouletteABI, functionName: 'CONTRIBUTION_WINDOW',
  })) as bigint

  console.log(`\nHouse  agent=${ids.house}  wallet=${houseWallet.address}`)
  console.log(`Player agent=${ids.player}  wallet=${playerWallet.address}`)
  console.log(`Contribution window: ${window}s\n`)

  const playerBalBefore = await balOf(playerWallet.address)

  // ── Phase 1: house opens a game ────────────────────────────────────────────
  console.log('── Phase 1: house opens a game')
  const open = await runAgentOnce(house, houseWallet, houseClient)
  console.log(`   house → ${open.action} (${open.status})`)
  assert(open.action === 'openGame', 'house chose openGame')
  assert(open.status === 'sent', 'openGame transaction sent')

  const [gid, g1] = await readGame()
  assert(Number(g1.state) === 1, `game ${gid} is Open`)

  // ── Phase 2: player contributes ────────────────────────────────────────────
  console.log('── Phase 2: player contributes')
  const contribute = await runAgentOnce(player, playerWallet, playerClient)
  console.log(`   player → ${contribute.action} (${contribute.status})`)
  assert(contribute.action === 'contribute', 'player chose contribute')
  assert(contribute.status === 'sent', 'contribute transaction sent')

  const [, g2] = await readGame()
  assert(g2.totalPot > 0n, `pot funded (${g2.totalPot})`)

  // ── Phase 3: advance past the contribution window ──────────────────────────
  console.log('── Phase 3: advance time past the window')
  await timeTravel(Number(window) + 1)

  // House should NOT be able to open now (game still active) and SHOULD resolve.
  console.log('── Phase 4: house resolves the game')
  const resolve = await runAgentOnce(house, houseWallet, houseClient)
  console.log(`   house → ${resolve.action} (${resolve.status})`)
  assert(resolve.action === 'resolveGame', 'house chose resolveGame')
  assert(resolve.status === 'sent', 'resolveGame transaction sent')

  // ── Assertions: winner paid, pot cleared ───────────────────────────────────
  console.log('── Phase 5: verify outcome')
  const [, g3] = await readGame()
  assert(Number(g3.state) === 2, 'game is Resolved')
  assert(getAddress(g3.winner) === getAddress(playerWallet.address), 'player is the winner')

  const playerBalAfter = await balOf(playerWallet.address)
  // No house fee by default → player gets the whole pot back (net zero), but the
  // key invariant is they received the payout (balance not reduced by the stake).
  assert(playerBalAfter >= playerBalBefore, 'player received the payout')

  console.log('\n✅ Functional test passed — full round played deterministically through agents.\n')
}

main().catch((e) => {
  console.error(`\n❌ Functional test FAILED:\n${e.message ?? e}\n`)
  process.exit(1)
})
