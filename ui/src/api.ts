const BASE = '/api'

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status}: ${body}`)
  }
  return res.json()
}

const post = <T>(path: string, body: unknown) =>
  req<T>(path, { method: 'POST', body: JSON.stringify(body) })

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContractRef { id: number; name: string; address: string; chainId: number }

export interface Contract extends ContractRef {
  abi: any[]
  deployedAt: string
  createdAt: string
}

export interface Action {
  id: number
  contract: ContractRef
  functionName: string
  functionAbi: any
  createdAt: string
}

export interface Status {
  id: number
  contract: ContractRef
  functionName: string
  functionAbi: any
  address: string | null
  createdAt: string
}

export interface Agent {
  id: number
  prompt: string
  statuses: Status[]
  actions: Action[]
  createdAt: string
}

export interface LoopState {
  agentId: number
  running: boolean
  interval: number
  iterations: number
  startedAt?: string
  lastRunAt?: string
  lastAction?: string
}

export interface LogEntry {
  time: string
  level: string
  msg: string
  attrs?: Record<string, unknown>
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const api = {
  contracts: {
    list:   ()   => req<Contract[]>('/contracts'),
    get:    (addr: string) => req<Contract>(`/contracts/${addr}`),
    create: (d: { name: string; address: string; abi: string; chainId: number; deployedAt: string }) =>
      post<Contract>('/contracts', d),
    delete: (id: number) => req<unknown>(`/contracts/${id}`, { method: 'DELETE' }),
    rename: (id: number, name: string) =>
      req<Contract>(`/contracts/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  },
  actions: {
    list:   ()  => req<Action[]>('/actions'),
    get:    (id: number) => req<Action>(`/actions/${id}`),
    create: (d: { contractId: number; functionName: string; functionAbi: any }) =>
      post<Action>('/actions', d),
    delete: (id: number) => req<unknown>(`/actions/${id}`, { method: 'DELETE' }),
  },
  statuses: {
    list:   ()  => req<Status[]>('/statuses'),
    get:    (id: number) => req<Status>(`/statuses/${id}`),
    create: (d: { contractId: number; functionName: string; functionAbi: any; address?: string }) =>
      post<Status>('/statuses', d),
  },
  agents: {
    list:      ()  => req<Agent[]>('/agents'),
    get:       (id: number) => req<Agent>(`/agents/${id}`),
    create:    (d: { prompt: string; statusIds: number[]; actionIds: number[] }) =>
      post<Agent>('/agents', d),
    duplicate: (id: number) => post<Agent>(`/agents/${id}/duplicate`, {}),
  },
  loops: {
    list:   ()  => req<LoopState[]>('/loops'),
    status: (id: number) => req<LoopState>(`/agents/${id}/loop/status`),
    start:  (id: number, interval: number) => post<LoopState>(`/agents/${id}/loop/start`, { interval }),
    stop:   (id: number) => post<LoopState>(`/agents/${id}/loop/stop`, {}),
  },
  logs: {
    list: (n = 200) => req<LogEntry[]>(`/logs?n=${n}`),
  },
}
