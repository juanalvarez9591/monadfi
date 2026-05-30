/**
 * setup.ts
 *
 * One-shot bootstrap: registers the CasinoRoulette + MonadToken contracts, then
 * wires up a House Agent and a Player Agent.
 *
 * The agents read no-argument boolean views (canOpen / canResolve / canContribute)
 * and pick a single action from an enum. Arguments are filled deterministically by
 * the runner from each action's argsTemplate — see agent/src/execute.ts.
 *
 * Run after deploy + API start:  npm run setup
 */

import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { Abi } from 'viem'
import { loadDeployments, casinoRouletteABI, monadTokenABI } from './src/contracts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const API = process.env.API_URL ?? 'http://localhost:8080'

// A whole MonadToken (18 decimals) — the fixed stake every player contributes.
const STAKE = (10n ** 18n * 100n).toString() // 100 MTKN

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

function fragment(name: string, abi: Abi): any {
  const f = (abi as any[]).find((x) => x.name === name)
  if (!f) throw new Error(`ABI fragment not found: ${name}`)
  return f
}

async function main() {
  const dep = loadDeployments()
  console.log('Deployments:', dep)

  // ── 1. Register contracts ──────────────────────────────────────────────────
  console.log('\n── Registering contracts…')

  const casino = await post<any>('/contracts', {
    name: 'CasinoRoulette',
    address: dep.CasinoRoulette,
    abi: JSON.stringify(casinoRouletteABI),
    chainId: dep.chainId,
    deployedAt: dep.deployedAt,
  })
  console.log(`  CasinoRoulette  id=${casino.id}  ${casino.address}`)

  const token = await post<any>('/contracts', {
    name: 'MonadToken',
    address: dep.MonadToken,
    abi: JSON.stringify(monadTokenABI),
    chainId: dep.chainId,
    deployedAt: dep.deployedAt,
  })
  console.log(`  MonadToken      id=${token.id}  ${token.address}`)

  // ── 2. Create statuses (no-arg booleans → trivial, reliable dispatch) ───────
  console.log('\n── Creating statuses…')

  const mkStatus = (name: string) =>
    post<any>('/statuses', {
      contractId: casino.id,
      functionName: name,
      functionAbi: fragment(name, casinoRouletteABI),
    })

  const sCanOpen       = await mkStatus('canOpen')
  const sCanResolve    = await mkStatus('canResolve')
  const sCanContribute = await mkStatus('canContribute')
  console.log(`  [${sCanOpen.id}] canOpen  [${sCanResolve.id}] canResolve  [${sCanContribute.id}] canContribute`)

  // ── 3. Create actions with deterministic arg templates ──────────────────────
  console.log('\n── Creating actions…')

  const mkAction = (name: string, argsTemplate: Record<string, string>) =>
    post<any>('/actions', {
      contractId: casino.id,
      functionName: name,
      functionAbi: fragment(name, casinoRouletteABI),
      argsTemplate,
    })

  const aOpenGame   = await mkAction('openGame',    { randomSeed: 'random32' })
  const aResolve    = await mkAction('resolveGame', { gameId: 'view:gameCount' })
  const aContribute = await mkAction('contribute',  { gameId: 'view:gameCount', amount: `const:${STAKE}` })
  console.log(`  [${aOpenGame.id}] openGame  [${aResolve.id}] resolveGame  [${aContribute.id}] contribute`)

  // ── 4. House Agent: open when idle, resolve when ready ──────────────────────
  console.log('\n── Creating House Agent…')

  const houseAgent = await post<any>('/agents', {
    prompt: `You are the casino house. Read the state booleans and pick exactly one action.
Rules:
- if canResolve=true then resolveGame
- else if canOpen=true then openGame
- else wait
Examples:
State: canOpen=true canResolve=false -> openGame
State: canOpen=false canResolve=true -> resolveGame
State: canOpen=false canResolve=false -> wait
State: canOpen=true canResolve=true -> resolveGame`,
    statusIds: [sCanResolve.id, sCanOpen.id],
    actionIds: [aResolve.id, aOpenGame.id],
  })
  console.log(`  House Agent  id=${houseAgent.id}`)

  // ── 5. Player Agent: contribute whenever the window is open ─────────────────
  console.log('\n── Creating Player Agent…')

  const playerAgent = await post<any>('/agents', {
    prompt: `You are a casino player. Read the state boolean and pick exactly one action.
Rules:
- if canContribute=true then contribute
- else wait
Examples:
State: canContribute=true -> contribute
State: canContribute=false -> wait`,
    statusIds: [sCanContribute.id],
    actionIds: [aContribute.id],
  })
  console.log(`  Player Agent  id=${playerAgent.id}`)

  console.log(`
Done. Summary:
  Contracts:  CasinoRoulette=${casino.id}  MonadToken=${token.id}
  Statuses:   canOpen=${sCanOpen.id}  canResolve=${sCanResolve.id}  canContribute=${sCanContribute.id}
  Actions:    openGame=${aOpenGame.id}  resolveGame=${aResolve.id}  contribute=${aContribute.id}
  Agents:     House=${houseAgent.id}  Player=${playerAgent.id}
`)

  writeFileSync(join(__dirname, '.agent-ids'), `HOUSE_ID=${houseAgent.id}\nPLAYER_ID=${playerAgent.id}\n`)
  console.log('Saved → .agent-ids')
}

main().catch((e) => { console.error(e); process.exit(1) })
