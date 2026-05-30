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

type Ctx = { caller: `0x${string}`; address: `0x${string}`; abi: Abi; fetchCache: Map<string, any[]> }

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
 *   self               → the calling wallet's address
 *   view:<fn>          → result of a no-arg view function on the same contract
 *   const:<value>      → a literal; arrays are JSON-parsed (e.g. const:[1,2,3])
 *   random32           → a deterministic bytes32 (reproducible per wallet+contract)
 *   randInt:<min>:<max> → random integer in [min, max] inclusive
 *   <anything else>    → treated as a literal value
 */
async function resolveToken(token: string, inp: any, ctx: Ctx): Promise<unknown> {
  const t: string = inp.type
  const isIntType = (ty: string) => ty.startsWith('uint') || ty.startsWith('int')
  const coerce = (v: any) => isIntType(t) ? BigInt(v) : v

  if (token === 'self') return ctx.caller
  if (token === 'random32') return keccak256(toHex(`${ctx.caller}:${ctx.address}`))

  if (token.startsWith('randInt:')) {
    const parts = token.split(':')
    const min = parseInt(parts[1], 10)
    const max = parseInt(parts[2], 10)
    const val = Math.floor(Math.random() * (max - min + 1)) + min
    return coerce(val)
  }

  if (token.startsWith('randItem:')) {
    const raw  = token.slice('randItem:'.length)
    const arr: any[] = JSON.parse(raw)
    const item = arr[Math.floor(Math.random() * arr.length)]
    return isIntType(t) ? BigInt(item) : String(item)
  }

  if (token.startsWith('const:')) {
    const raw = token.slice('const:'.length)
    // Array types: JSON-parse and coerce each element.
    if (t.endsWith('[]')) {
      const elemType = t.slice(0, -2)
      const arr: any[] = JSON.parse(raw)
      return arr.map((v) => isIntType(elemType) ? BigInt(v) : v)
    }
    return coerce(raw)
  }

  if (token.startsWith('api:')) {
    // api:/songs?limit=10&extract=id
    // Calls GET ${API_URL}<path>, parses JSON array, extracts the named field.
    // Falls back to /songs?limit=<N> if the filtered query returns fewer than 3 results.
    // Uses ctx.fetchCache so a songTitle: token for the same URL shares the same fetch.
    const raw     = token.slice('api:'.length)
    const url     = new URL(raw, API_URL + '/')
    const extract = url.searchParams.get('extract') ?? 'id'
    const limit   = url.searchParams.get('limit') ?? '10'
    url.searchParams.delete('extract')

    const fetchItems = async (u: URL): Promise<any[]> => {
      const key = u.toString()
      if (ctx.fetchCache.has(key)) return ctx.fetchCache.get(key)!
      const res = await fetch(key)
      if (!res.ok) throw new Error(`api: fetch failed: ${key} → ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error(`api: expected array from ${key}`)
      ctx.fetchCache.set(key, data)
      return data
    }

    let data = await fetchItems(url)

    // Fallback: filter returned too few results — query without filter
    if (data.length < 3) {
      const fallback = new URL('/songs', API_URL + '/')
      fallback.searchParams.set('limit', limit)
      data = await fetchItems(fallback)
    }

    const elemType = t.endsWith('[]') ? t.slice(0, -2) : t
    return data.map(item => isIntType(elemType) ? BigInt(item[extract]) : String(item[extract]))
  }

  if (token.startsWith('songTitle:')) {
    // songTitle:/songs?limit=10
    // Shares the fetch cache with api: tokens for the same URL so both name
    // and songIds are derived from the same song objects in one request.
    const raw   = token.slice('songTitle:'.length)
    const url   = new URL(raw, API_URL + '/')
    const limit = url.searchParams.get('limit') ?? '10'

    const fetchItems = async (u: URL): Promise<any[]> => {
      const key = u.toString()
      if (ctx.fetchCache.has(key)) return ctx.fetchCache.get(key)!
      const res = await fetch(key)
      if (!res.ok) throw new Error(`songTitle: fetch failed: ${key} → ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data)) throw new Error(`songTitle: expected array from ${key}`)
      ctx.fetchCache.set(key, data)
      return data
    }

    let data = await fetchItems(url)
    if (data.length < 2) {
      const fallback = new URL('/songs', API_URL + '/')
      fallback.searchParams.set('limit', limit)
      data = await fetchItems(fallback)
    }

    const artistOf = (song: any): string =>
      (song.artist as string | undefined)?.split(',')[0].trim() ?? song.name ?? '?'
    return `${artistOf(data[0])} & ${artistOf(data[1])}`
  }

  if (token.startsWith('view:')) {
    const fn = token.slice('view:'.length)
    return publicClient.readContract({ address: ctx.address, abi: ctx.abi, functionName: fn })
  }

  return coerce(token)
}

export interface ResolvedArgs {
  args: unknown[]
  value?: bigint // native MON/ETH to send with the tx (from _value template key)
}

/**
 * Build the ordered argument list for an action from its template.
 * The special key "_value" in the template is extracted as native value to
 * send with the transaction (for payable functions) and not passed as an arg.
 * Throws only if a required parameter has no template entry.
 */
export async function resolveArgs(action: ActionDef, caller: `0x${string}`): Promise<ResolvedArgs> {
  const inputs: any[] = action.functionAbi.inputs ?? []
  const template = action.argsTemplate ?? {}
  const ctx: Ctx = {
    caller,
    address: action.contract.address as `0x${string}`,
    abi: await fullAbi(action.contract.address, action.contract.chainId),
    fetchCache: new Map(),
  }

  // Extract optional native value (_value is not a Solidity parameter).
  let value: bigint | undefined
  if (template['_value']) {
    const raw = template['_value'].startsWith('const:')
      ? template['_value'].slice('const:'.length)
      : template['_value']
    value = BigInt(raw)
  }

  if (inputs.length === 0) return { args: [], value }

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
  return { args, value }
}

// ── Simulate-before-send ───────────────────────────────────────────────────--

export interface ExecResult {
  status: 'sent' | 'skipped' | 'reverted'
  summary: string
  receipt?: import('viem').TransactionReceipt
}

/**
 * Simulate the action; broadcast only if it would succeed. A simulated revert
 * (wrong action for the current state) is reported as "skipped" — never thrown —
 * so the agent loop keeps running. Pass `value` for payable functions.
 */
export async function executeAction(
  action: ActionDef,
  resolved: ResolvedArgs,
  walletClient: any,
  account: any,
): Promise<ExecResult> {
  const address = action.contract.address as `0x${string}`
  const abi = [action.functionAbi] as Abi
  const { args, value } = resolved
  const label = `${action.functionName}(${args.map(String).join(',')})${value ? ` value=${value}` : ''}`

  let request
  try {
    const sim = await publicClient.simulateContract({
      address,
      abi,
      functionName: action.functionName,
      args: args as any,
      account,
      ...(value !== undefined ? { value } : {}),
    })
    request = sim.request
  } catch (err: any) {
    return { status: 'skipped', summary: `${label} would revert → skipped (${shortReason(err)})` }
  }

  const hash    = await walletClient.writeContract(request)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  const status  = receipt.status === 'success' ? 'sent' : 'reverted'
  return { status, summary: `${label} tx=${hash.slice(0, 10)}… block=${receipt.blockNumber} ${receipt.status}`, receipt }
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
  receipt?: import('viem').TransactionReceipt
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

  const resolved = await resolveArgs(action, wallet.address)
  const result   = await executeAction(action, resolved, walletClient, wallet)
  return { action: action.functionName, status: result.status, summary: result.summary, reasoning: decision.reasoning, receipt: result.receipt }
}
