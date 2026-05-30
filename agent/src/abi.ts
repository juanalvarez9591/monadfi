/**
 * abi.ts
 *
 * Generic ABI introspection so the agent execution schema can be derived for ANY
 * contract. Used by autoregister.ts.
 *
 *   - statuses  = view/pure functions the agent reads (no-arg, or one address arg)
 *   - actions   = state-changing functions the agent can call, each with an
 *                 inferred argsTemplate the runner resolves deterministically
 *
 * Inference is heuristic but safe: even if a template guesses wrong, the runner's
 * simulate-before-send guard skips a reverting call rather than erroring. The UI
 * can always override templates for precise behaviour.
 */

import type { Abi } from 'viem'

export interface AbiFn {
  name: string
  inputs: { name: string; type: string }[]
  outputs: { name: string; type: string }[]
  stateMutability: string
}

function fns(abi: Abi): AbiFn[] {
  return (abi as any[]).filter((x) => x.type === 'function') as AbiFn[]
}

const isView = (f: AbiFn) => f.stateMutability === 'view' || f.stateMutability === 'pure'

/** Functions the agent reads each tick: no-arg or single-address views. */
export function deriveStatuses(abi: Abi): AbiFn[] {
  return fns(abi).filter(
    (f) => isView(f) && (f.inputs.length === 0 || (f.inputs.length === 1 && f.inputs[0].type === 'address')),
  )
}

/** Functions the agent may call: anything that changes state. */
export function deriveActions(abi: Abi): AbiFn[] {
  return fns(abi).filter((f) => !isView(f))
}

/** Name of a no-arg uint counter view, if the contract exposes one (e.g. gameCount). */
export function counterView(abi: Abi): string | null {
  const c = fns(abi).find(
    (f) =>
      isView(f) &&
      f.inputs.length === 0 &&
      f.outputs.length === 1 &&
      f.outputs[0].type.startsWith('uint') &&
      /count|total|length|next/i.test(f.name),
  )
  return c?.name ?? null
}

/**
 * Infer an argsTemplate for one action. Token vocabulary matches execute.ts:
 *   self | view:<fn> | const:<value> | random32
 */
export function inferArgsTemplate(fn: AbiFn, abi: Abi): Record<string, string> {
  const counter = counterView(abi)
  const tmpl: Record<string, string> = {}
  for (const inp of fn.inputs) {
    const name = inp.name || ''
    const t = inp.type
    if (t === 'address') tmpl[name] = 'self'
    else if (t === 'bool') tmpl[name] = 'const:false'
    else if (t.startsWith('bytes')) tmpl[name] = 'random32'
    else if (t.startsWith('uint') || t.startsWith('int')) {
      if (/amount|value|stake|price|cost|wad|qty|quantity/i.test(name)) tmpl[name] = 'const:1000000000000000000'
      else if (counter && /id$|index|game|round|epoch/i.test(name)) tmpl[name] = `view:${counter}`
      else tmpl[name] = 'const:1'
    } else if (t === 'string') tmpl[name] = 'const:'
    else tmpl[name] = 'const:0'
  }
  return tmpl
}
