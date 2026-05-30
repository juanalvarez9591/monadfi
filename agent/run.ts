/**
 * run.ts
 *
 * Agent runner: fetches scope from API → reads chain state → asks LLM →
 * executes on-chain action.
 *
 * Usage:
 *   npm run run -- <agentId> [walletIndex]
 *   npm run run -- 3 0
 */

import { type Abi } from 'viem'
import { publicClient, getAnvilAccount, makeWalletClient } from './src/client.js'
import { getAgentWallet } from './src/wallets.js'
import { resolveArgs, executeAction } from './src/execute.js'

const AGENT_ID     = parseInt(process.argv[2] ?? '1', 10)
const WALLET_INDEX = parseInt(process.argv[3] ?? '0', 10)
const API_URL      = process.env.API_URL ?? 'http://localhost:8080'

// ── Types (mirrors the Go API) ────────────────────────────────────────────────

interface ContractRef { id: number; name: string; address: string; chainId: number }

interface StatusDef {
  id: number
  contract: ContractRef
  functionName: string
  functionAbi: any
  address: string | null
}

interface ActionDef {
  id: number
  contract: ContractRef
  functionName: string
  functionAbi: any
  address: string
}

interface AgentScope {
  id: number
  prompt: string
  statuses: StatusDef[]
  actions:  ActionDef[]
}

interface RunResponse {
  actionId:     number
  functionName: string
  args:         Record<string, string> // param name → value (all strings from LLM)
  reasoning:    string
}

// ── Chain state reader ────────────────────────────────────────────────────────

async function readStatus(status: StatusDef, callerAddress: string): Promise<unknown> {
  const addr    = status.contract.address as `0x${string}`
  const abi     = [status.functionAbi] as Abi
  const inputs: any[] = status.functionAbi.inputs ?? []

  const read = (args?: any[]) =>
    publicClient.readContract({ address: addr, abi, functionName: status.functionName, ...(args ? { args } : {}) })

  if (inputs.length === 0) return read()
  // Single address parameter → the caller's own state (e.g. balanceOf).
  if (inputs.length === 1 && inputs[0].type === 'address') return read([callerAddress as `0x${string}`])
  return null // unsupported signature — agent sees null
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const wallet       = getAgentWallet(WALLET_INDEX)
  const walletClient = makeWalletClient(wallet)

  console.log(`Agent    : ${AGENT_ID}`)
  console.log(`Wallet   : ${wallet.address}\n`)

  // 1. Fetch agent scope from registry
  const agentRes = await fetch(`${API_URL}/agents/${AGENT_ID}`)
  if (!agentRes.ok) throw new Error(`Agent ${AGENT_ID} not found in registry`)
  const agent: AgentScope = await agentRes.json()

  console.log(`Prompt   : ${agent.prompt.slice(0, 80)}…`)
  console.log(`Statuses : ${agent.statuses.map(s => s.functionName).join(', ')}`)
  console.log(`Actions  : ${agent.actions.map(a => a.functionName).join(', ')}\n`)

  // 2. Read current chain state for every status
  console.log('── Chain state ──────────────────────────────────')
  const state = []
  for (const status of agent.statuses) {
    let result = await readStatus(status, wallet.address)
    // BigInt → string for JSON
    result = JSON.parse(JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v))
    console.log(`  ${status.functionName}: ${JSON.stringify(result)}`)
    state.push({ functionName: status.functionName, address: status.address, result })
  }

  // 3. Ask LLM (via API) what to do
  console.log('\n── LLM decision ─────────────────────────────────')
  const runRes = await fetch(`${API_URL}/agents/${AGENT_ID}/run`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ state }),
  })
  if (!runRes.ok) throw new Error(`/run failed: ${await runRes.text()}`)
  const decision: RunResponse & { action?: null } = await runRes.json()

  if (!decision.functionName || decision.action === null) {
    console.log('LLM chose not to act.')
    if (decision.reasoning) console.log('Reasoning:', decision.reasoning.slice(0, 300))
    return
  }

  console.log(`Action   : ${decision.functionName}`)
  if (decision.reasoning) console.log(`Reasoning: ${decision.reasoning.slice(0, 300)}`)

  // 4. Resolve args deterministically, then simulate-before-send
  const action = agent.actions.find(a => a.functionName === decision.functionName)
  if (!action) throw new Error(`No registered action for: ${decision.functionName}`)

  const args = await resolveArgs(action as any, wallet.address)

  console.log(`\n── Executing on-chain ───────────────────────────`)
  console.log(`  ${action.functionName}(${args.map(String).join(', ')})`)
  console.log(`  contract : ${action.contract.name} @ ${action.contract.address}`)
  console.log(`  caller   : ${wallet.address}`)

  const result = await executeAction(action as any, args, walletClient, wallet)
  console.log(`\n  ${result.status}: ${result.summary}`)
}

main().catch(e => { console.error(e); process.exit(1) })
