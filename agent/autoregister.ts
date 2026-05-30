/**
 * autoregister.ts
 *
 * Register ANY deployed contract with the API and derive its agent execution
 * schema automatically from the ABI:
 *   - statuses = no-arg / single-address view functions
 *   - actions  = state-changing functions, each with an inferred argsTemplate
 *   - one generic agent that tries an action and waits otherwise
 *
 * Combined with the runner's simulate-before-send guard, this lets an agent
 * interact with an arbitrary contract without erroring. The UI can refine the
 * generated prompts/templates afterwards.
 *
 * Usage:
 *   npm run autoregister -- <Contract>
 *   CONTRACT=MonadToken npm run autoregister
 */

import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { loadContract } from './src/contracts.js'
import { deriveStatuses, deriveActions, inferArgsTemplate } from './src/abi.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const API = process.env.API_URL ?? 'http://localhost:8080'

const name = process.argv[2] ?? process.env.CONTRACT
if (!name) { console.error('Usage: npm run autoregister -- <Contract>'); process.exit(1) }

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function main() {
  const dep = JSON.parse(readFileSync(join(__dirname, 'deployments.json'), 'utf-8'))
  const address = dep[name!]
  if (!address) throw new Error(`${name} not found in deployments.json — deploy it first`)

  const { abi } = loadContract(name!, name!)

  const contract = await post<any>('/contracts', {
    name, address, abi: JSON.stringify(abi), chainId: dep.chainId, deployedAt: dep.deployedAt,
  })
  console.log(`Contract ${name} id=${contract.id} @ ${address}`)

  const statuses = deriveStatuses(abi)
  const actions = deriveActions(abi)

  const statusIds: number[] = []
  for (const f of statuses) {
    const s = await post<any>('/statuses', { contractId: contract.id, functionName: f.name, functionAbi: f })
    statusIds.push(s.id)
    console.log(`  status  ${f.name}(${f.inputs.map((i) => i.type).join(',')})`)
  }

  const actionIds: number[] = []
  for (const f of actions) {
    const argsTemplate = inferArgsTemplate(f, abi)
    const a = await post<any>('/actions', { contractId: contract.id, functionName: f.name, functionAbi: f, argsTemplate })
    actionIds.push(a.id)
    console.log(`  action  ${f.name}  template=${JSON.stringify(argsTemplate)}`)
  }

  const actionList = actions.map((f) => f.name).join(', ')
  const agent = await post<any>('/agents', {
    prompt: `You operate the ${name} contract. Read the status values and pick exactly one action to take, or wait if nothing is appropriate. Available actions: ${actionList || '(none)'}. When unsure, wait.`,
    statusIds,
    actionIds,
  })
  console.log(`\nGeneric agent id=${agent.id}  (${statusIds.length} statuses, ${actionIds.length} actions)`)

  writeFileSync(join(__dirname, '.agent-ids'), `AGENT_ID=${agent.id}\n`)
  console.log('Saved → .agent-ids')
}

main().catch((e) => { console.error(e); process.exit(1) })
