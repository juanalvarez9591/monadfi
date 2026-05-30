/**
 * loop.ts
 *
 * Polling agent loop — runs until the Go API says to stop.
 * The UI starts/stops the loop via POST /agents/{id}/loop/start|stop.
 * This process polls the status and executes one run per interval.
 *
 * Usage:
 *   npm run loop -- <agentId> <walletIndex>
 *   npm run loop -- 3 0
 */

import { getAnvilAccount, makeWalletClient } from './src/client.js'
import { getAgentWallet } from './src/wallets.js'
import { runAgentOnce } from './src/execute.js'

const AGENT_ID     = parseInt(process.argv[2] ?? '1', 10)
const WALLET_INDEX = parseInt(process.argv[3] ?? '0', 10)
const WALLET_TYPE  = process.argv[4] ?? 'agent'   // 'agent' (HD mnemonic) | 'anvil' (pre-funded)
const API_URL      = process.env.API_URL ?? 'http://localhost:8080'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── One agent iteration (shared logic: read state → pick → resolve → execute) ──

async function runOnce(agent: any, wallet: any, walletClient: any): Promise<string> {
  const outcome = await runAgentOnce(agent, wallet, walletClient)
  if (outcome.status !== 'no-op') {
    console.log(`  [${new Date().toISOString()}] wallet=${wallet.address.slice(0,10)}… ${outcome.summary}`)
  }
  return outcome.summary
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function main() {
  const wallet       = WALLET_TYPE === 'anvil' ? getAnvilAccount(WALLET_INDEX) : getAgentWallet(WALLET_INDEX)
  const walletClient = makeWalletClient(wallet)

  console.log(`Loop agent=${AGENT_ID} wallet=${wallet.address} (${WALLET_TYPE}[${WALLET_INDEX}])  api=${API_URL}`)
  console.log('Waiting for loop to be started via API (POST /agents/{id}/loop/start)...\n')

  while (true) {
    // Poll loop status from Go API
    const statusRes = await fetch(`${API_URL}/agents/${AGENT_ID}/loop/status`)
    const loopState = await statusRes.json()

    if (!loopState.running) {
      console.log(`[${new Date().toISOString()}] loop not running — polling every 3s`)
      await sleep(3000)
      continue
    }

    // Fetch agent scope
    const agentRes = await fetch(`${API_URL}/agents/${AGENT_ID}`)
    if (!agentRes.ok) throw new Error('agent not found')
    const agent = await agentRes.json()

    console.log(`\n[${new Date().toISOString()}] iter=${loopState.iterations + 1}  agent=${AGENT_ID}  interval=${loopState.interval}s`)

    let lastAction = 'no-op'
    try {
      lastAction = await runOnce(agent, wallet, walletClient)
    } catch (err: any) {
      lastAction = `error: ${err.message}`
      console.error(`  ERROR: ${err.message}`)
    }

    // Report tick back to Go API
    await fetch(`${API_URL}/agents/${AGENT_ID}/loop/tick`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ lastAction }),
    })

    await sleep(loopState.interval * 1000)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
