import { useEffect, useState, useCallback } from 'react'
import { api, type Agent, type Action, type Status, type LoopState } from '../api'

function LoopPanel({ agentId }: { agentId: number }) {
  const [loop, setLoop]       = useState<LoopState | null>(null)
  const [interval, setIval]   = useState('10')
  const [busy, setBusy]       = useState(false)

  const refresh = useCallback(() =>
    api.loops.status(agentId).then(setLoop).catch(() => {}), [agentId])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [refresh])

  const start = async () => {
    setBusy(true)
    await api.loops.start(agentId, parseInt(interval) || 10).catch(e => alert(e.message))
    refresh(); setBusy(false)
  }
  const stop = async () => {
    setBusy(true)
    await api.loops.stop(agentId).catch(e => alert(e.message))
    refresh(); setBusy(false)
  }

  const running = loop?.running ?? false

  return (
    <div className={`loop-card ${running ? 'running' : ''}`}>
      <div className="loop-stat">
        <span className="ls-label">Status</span>
        <span className="ls-value">
          <span className={`badge ${running ? 'green' : 'gray'}`}>{running ? 'Running' : 'Stopped'}</span>
        </span>
      </div>
      <div className="loop-stat">
        <span className="ls-label">Iterations</span>
        <span className="ls-value">{loop?.iterations ?? 0}</span>
      </div>
      {loop?.interval && (
        <div className="loop-stat">
          <span className="ls-label">Interval</span>
          <span className="ls-value">{loop.interval}s</span>
        </div>
      )}
      {loop?.lastRunAt && (
        <div className="loop-stat">
          <span className="ls-label">Last Run</span>
          <span className="ls-value" style={{ fontSize: 13 }}>{new Date(loop.lastRunAt).toLocaleTimeString()}</span>
        </div>
      )}
      {loop?.lastAction && (
        <div className="loop-stat" style={{ flex: 1, minWidth: 0 }}>
          <span className="ls-label">Last Action</span>
          <span className="ls-value" style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {loop.lastAction}
          </span>
        </div>
      )}
      <div className="loop-actions">
        {!running && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Every</span>
            <input value={interval} onChange={e => setIval(e.target.value)} style={{ width: 60 }} />
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>sec</span>
          </div>
        )}
        {running
          ? <button className="btn danger sm" onClick={stop} disabled={busy}>Stop Loop</button>
          : <button className="btn success sm" onClick={start} disabled={busy}>Start Loop</button>
        }
      </div>
      {running && (
        <div style={{ width: '100%', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 6, padding: '8px 12px', fontSize: 13, color: '#15803d' }}>
          Loop is active. Run <code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: 3 }}>npm run loop -- {agentId} &lt;walletIndex&gt;</code> in the <code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: 3 }}>agent/</code> directory to execute iterations.
        </div>
      )}
    </div>
  )
}

export default function AgentsPage() {
  const [agents, setAgents]     = useState<Agent[]>([])
  const [actions, setActions]   = useState<Action[]>([])
  const [statuses, setStatuses] = useState<Status[]>([])
  const [err, setErr]     = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [form, setForm] = useState({ prompt: '', statusIds: [] as number[], actionIds: [] as number[] })

  const load = () => Promise.all([
    api.agents.list().then(setAgents),
    api.actions.list().then(setActions),
    api.statuses.list().then(setStatuses),
  ]).catch(e => setErr(e.message))

  useEffect(() => { load() }, [])

  const toggle = (arr: number[], id: number) =>
    arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('')
    try {
      await api.agents.create({ prompt: form.prompt, statusIds: form.statusIds, actionIds: form.actionIds })
      setForm({ prompt: '', statusIds: [], actionIds: [] })
      load()
    } catch (e: any) { setErr(e.message) }
    setSaving(false)
  }

  return (
    <>
      <h1 className="page-title">Agents</h1>

      {err && <div className="alert error">{err}</div>}

      <div className="card">
        <div className="card-title">Create Agent</div>
        <form onSubmit={submit}>
          <div className="field">
            <label>Prompt</label>
            <textarea
              value={form.prompt}
              onChange={e => setForm(f => ({ ...f, prompt: e.target.value }))}
              placeholder="You are a player agent. When a game is open (state=1), contribute 100 tokens to the pot..."
              style={{ minHeight: 100 }}
              required
            />
          </div>

          <div className="form-grid">
            <div className="field">
              <label>Statuses to observe</label>
              {statuses.length === 0
                ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>No statuses yet — go to the Statuses tab first.</p>
                : (
                  <div className="pill-group">
                    {statuses.map(s => (
                      <button key={s.id} type="button"
                        className={`pill ${form.statusIds.includes(s.id) ? 'active' : ''}`}
                        onClick={() => setForm(f => ({ ...f, statusIds: toggle(f.statusIds, s.id) }))}>
                        [{s.id}] {s.functionName}
                      </button>
                    ))}
                  </div>
                )
              }
            </div>
            <div className="field">
              <label>Actions to perform</label>
              {actions.length === 0
                ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>No actions yet — go to the Actions tab first.</p>
                : (
                  <div className="pill-group">
                    {actions.map(a => (
                      <button key={a.id} type="button"
                        className={`pill ${form.actionIds.includes(a.id) ? 'active' : ''}`}
                        onClick={() => setForm(f => ({ ...f, actionIds: toggle(f.actionIds, a.id) }))}>
                        [{a.id}] {a.functionName}
                      </button>
                    ))}
                  </div>
                )
              }
            </div>
          </div>

          <div className="btn-row">
            <button type="submit" className="btn primary" disabled={saving || form.actionIds.length === 0}>
              {saving ? 'Creating…' : 'Create Agent'}
            </button>
            {form.actionIds.length === 0 && (
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>Select at least one action</span>
            )}
          </div>
        </form>
      </div>

      {agents.length > 0 && agents.map(a => (
        <div key={a.id} className="card">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <span className="badge gray">Agent #{a.id}</span>
                {a.statuses.map(s => <span key={s.id} className="badge blue">{s.functionName}</span>)}
                {a.actions.map(ac => <span key={ac.id} className="badge yellow">{ac.functionName}</span>)}
              </div>
              <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>
                {a.prompt.slice(0, 120)}{a.prompt.length > 120 ? '…' : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6, marginLeft: 16, flexShrink: 0 }}>
              <button className="btn sm" onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
                {expanded === a.id ? 'Less' : 'More'}
              </button>
              <button className="btn sm" onClick={async () => {
                await api.agents.duplicate(a.id).catch(e => alert(e.message))
                load()
              }}>Duplicate</button>
            </div>
          </div>

          <LoopPanel agentId={a.id} />

          {expanded === a.id && (
            <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <p style={{ fontSize: 13, marginBottom: 8, color: 'var(--muted)', fontWeight: 600 }}>Full prompt</p>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{a.prompt}</pre>
              <div style={{ marginTop: 12, display: 'flex', gap: 16 }}>
                <div>
                  <p style={{ fontSize: 13, marginBottom: 6, color: 'var(--muted)', fontWeight: 600 }}>Statuses</p>
                  {a.statuses.length === 0 ? <span style={{ color: 'var(--muted)', fontSize: 13 }}>None</span>
                    : a.statuses.map(s => (
                      <div key={s.id} style={{ fontSize: 13, marginBottom: 4 }}>
                        <code>{s.functionName}()</code> on <strong>{s.contract.name}</strong>
                        {s.address ? <span style={{ color: 'var(--muted)' }}> — {s.address.slice(0, 14)}…</span> : <span className="badge green" style={{ marginLeft: 6 }}>global</span>}
                      </div>
                    ))
                  }
                </div>
                <div>
                  <p style={{ fontSize: 13, marginBottom: 6, color: 'var(--muted)', fontWeight: 600 }}>Actions</p>
                  {a.actions.map(ac => (
                    <div key={ac.id} style={{ fontSize: 13, marginBottom: 4 }}>
                      <code>{ac.functionName}()</code> on <strong>{ac.contract.name}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {agents.length === 0 && (
        <div className="card">
          <div className="empty">No agents yet. Create one above.</div>
        </div>
      )}
    </>
  )
}
