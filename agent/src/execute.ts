/**
 * execute.ts
 *
 * Shared agent-execution helpers used by run.ts and loop.ts.
 *
 * Two ideas make agent execution deterministic and crash-free:
 *
 *  1. Deterministic argument resolution. Small LLMs reliably pick *which* action
 *     to call (an enum) but fill arguments poorly. So the API only returns the
 *     chosen action plus an `argsTemplate` (param name → source token); the runner
 *     resolves the actual values here, from on-chain state — never from the model.
 *
 *  2. Simulate-before-send. Before broadcasting a transaction we `eth_call` it.
 *     If it would revert (wrong action for the current state, a race, a guard),
 *     we skip it instead of sending a doomed tx. A wrong pick becomes a no-op the
 *     loop retries — the agent can interact with any contract without erroring.
 */

import { keccak256, toHex, type Abi } from 'viem'
import { publicClient } from './client.js'

const API_URL = process.env.API_URL ?? 'http://localhost:8080'

export interface ContractRef { id: number; name: string; address: string; chainId: number }
export interface ActionDef {
  id: number
  contract: ContractRef
  functionName: string
  functionAbi: any
  argsTemplate?: Record<string, string>
}

type Ctx = { caller: `0x${string}`; address: `0x${string}`; abi: Abi }

// ── Full-ABI cache (for resolving `view:` tokens against the whole contract) ────

const abiCache = new Map<string, Abi>()

async function fullAbi(address: string, chainId: number): Promise<Abi> {
  const key = `${chainId}:${address.toLowerCase()}`
  const hit = abiCache.get(key)
  if (hit) return hit
  const res = await fetch(`${API_URL}/contracts/${address}?chainId=${chainId}`)
  if (!res.ok) throw new Error(`cannot load ABI for ${address}: ${res.status}`)
  const c = await res.json()
  // The API may return the ABI as a JSON string or as an already-parsed array.
  const abi = (typeof c.abi === 'string' ? JSON.parse(c.abi) : c.abi) as Abi
  abiCache.set(key, abi)
  return abi
}

// ── Argument resolution ─────────────────────────────────────────────────────--

/**
 * Resolve one template token to a concrete value for a parameter.
 * Supported tokens:
 *   self            → the calling wallet's address
 *   view:<fn>       → result of a no-arg view function on the same contract
 *   const:<value>   → a literal (coerced to the param's solidity type)
 *   random32        → a deterministic bytes32 (reproducible per wallet+contract)
 *   <anything else> → treated as a literal value
 */
async function resolveToken(token: string, inp: any, ctx: Ctx): Promise<unknown> {
  const t: string = inp.type
  const coerce = (v: any) =>
    t.startsWith('uint') || t.startsWith('int') ? BigInt(v) : v

  if (token === 'self') return ctx.caller
  if (token === 'random32') return keccak256(toHex(`${ctx.caller}:${ctx.address}`))
  if (token.startsWith('const:')) return coerce(token.slice('const:'.length))
  if (token.startsWith('view:')) {
    const fn = token.slice('view:'.length)
    return publicClient.readContract({ address: ctx.address, abi: ctx.abi, functionName: fn })
  }
  return coerce(token)
}

/**
 * Build the ordered argument list for an action from its template.
 * Throws only if a required parameter has no template entry — that's a config
 * error worth surfacing, not a silent skip.
 */
export async function resolveArgs(action: ActionDef, caller: `0x${string}`): Promise<unknown[]> {
  const inputs: any[] = action.functionAbi.inputs ?? []
  if (inputs.length === 0) return []

  const template = action.argsTemplate ?? {}
  const ctx: Ctx = {
    caller,
    address: action.contract.address as `0x${string}`,
    abi: await fullAbi(action.contract.address, action.contract.chainId),
  }

  const args: unknown[] = []
  for (const inp of inputs) {
    const token = template[inp.name]
    if (token === undefined) {
      throw new Error(
        `action ${action.functionName}: no argsTemplate entry for parameter "${inp.name}"`,
      )
    }
    args.push(await resolveToken(token, inp, ctx))
  }
  return args
}

// ── Simulate-before-send ───────────────────────────────────────────────────--

export interface ExecResult {
  status: 'sent' | 'skipped' | 'reverted'
  summary: string
}

/**
 * Simulate the action; broadcast only if it would succeed. A simulated revert
 * (wrong action for the current state) is reported as "skipped" — never thrown —
 * so the agent loop keeps running.
 */
export async function executeAction(
  action: ActionDef,
  args: unknown[],
  walletClient: any,
  account: any,
): Promise<ExecResult> {
  const address = action.contract.address as `0x${string}`
  const abi = [action.functionAbi] as Abi
  const label = `${action.functionName}(${args.map(String).join(',')})`

  let request
  try {
    const sim = await publicClient.simulateContract({
      address,
      abi,
      functionName: action.functionName,
      args: args as any,
      account,
    })
    request = sim.request
  } catch (err: any) {
    return { status: 'skipped', summary: `${label} would revert → skipped (${shortReason(err)})` }
  }

  const hash = await walletClient.writeContract(request)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  const status = receipt.status === 'success' ? 'sent' : 'reverted'
  return { status, summary: `${label} tx=${hash.slice(0, 10)}… block=${receipt.blockNumber} ${receipt.status}` }
}

function shortReason(err: any): string {
  const msg = err?.shortMessage ?? err?.message ?? String(err)
  return msg.split('\n')[0].slice(0, 120)
}

// ── Status reading ─────────────────────────────────────────────────────────--

interface StatusDef {
  contract: ContractRef
  functionName: string
  functionAbi: any
  address: string | null
}

/**
 * Read one status from chain. No-argument views are called directly; a single
 * address parameter is bound to the caller (e.g. balanceOf). Anything needing
 * richer arguments returns null — keep agent statuses to no-arg views.
 */
export async function readStatus(status: StatusDef, caller: `0x${string}`): Promise<unknown> {
  const addr = status.contract.address as `0x${string}`
  const abi = [status.functionAbi] as Abi
  const inputs: any[] = status.functionAbi.inputs ?? []
  const read = (args?: any[]) =>
    publicClient.readContract({ address: addr, abi, functionName: status.functionName, ...(args ? { args } : {}) })

  if (inputs.length === 0) return read()
  if (inputs.length === 1 && inputs[0].type === 'address') return read([caller])
  return null
}

// ── Full agent iteration: read state → LLM picks → resolve args → execute ─────-

export interface AgentScope {
  id: number
  prompt: string
  statuses: StatusDef[]
  actions: ActionDef[]
}

export interface RunOutcome {
  action: string | null
  status: 'no-op' | 'sent' | 'skipped' | 'reverted'
  summary: string
  reasoning?: string
}

/**
 * One full agent tick against a live API + chain. The LLM (via the API) only
 * chooses an action; arguments are resolved deterministically and the tx is
 * simulated before sending, so a wrong choice is a skipped no-op, never a crash.
 */
export async function runAgentOnce(
  agent: AgentScope,
  wallet: { address: `0x${string}` },
  walletClient: any,
): Promise<RunOutcome> {
  const state = []
  for (const status of agent.statuses) {
    let result = await readStatus(status, wallet.address)
    result = JSON.parse(JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))
    state.push({ functionName: status.functionName, address: status.address, result })
  }

  const res = await fetch(`${API_URL}/agents/${agent.id}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  })
  if (!res.ok) throw new Error(`/run failed: ${await res.text()}`)
  const decision = await res.json()

  if (!decision.functionName || decision.action === null) {
    return { action: null, status: 'no-op', summary: 'no-op', reasoning: decision.reasoning }
  }

  const action = agent.actions.find((a) => a.functionName === decision.functionName)
  if (!action) return { action: decision.functionName, status: 'skipped', summary: `unknown action ${decision.functionName}` }

  const args = await resolveArgs(action, wallet.address)
  const result = await executeAction(action, args, walletClient, wallet)
  return { action: action.functionName, status: result.status, summary: result.summary, reasoning: decision.reasoning }
}
