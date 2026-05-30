import { useEffect, useState } from 'react'
import { api, type Status, type Contract } from '../api'

export default function StatusesPage() {
  const [statuses, setStatuses]   = useState<Status[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [err, setErr]     = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm]   = useState({ contractId: '', functionName: '', functionAbi: '', address: '' })

  const load = () => Promise.all([
    api.statuses.list().then(setStatuses),
    api.contracts.list().then(setContracts),
  ]).catch(e => setErr(e.message))

  useEffect(() => { load() }, [])

  const selectedContract = contracts.find(c => c.id === parseInt(form.contractId))
  const viewFns = selectedContract
    ? selectedContract.abi.filter((x: any) => x.type === 'function' && (x.stateMutability === 'view' || x.stateMutability === 'pure'))
    : []

  const pickFn = (name: string) => {
    const frag = selectedContract?.abi.find((x: any) => x.name === name)
    setForm(f => ({ ...f, functionName: name, functionAbi: frag ? JSON.stringify(frag, null, 2) : '' }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('')
    try {
      await api.statuses.create({
        contractId: parseInt(form.contractId),
        functionName: form.functionName,
        functionAbi: JSON.parse(form.functionAbi),
        address: form.address || undefined,
      })
      setForm(f => ({ ...f, functionName: '', functionAbi: '', address: '' }))
      load()
    } catch (e: any) { setErr(e.message) }
    setSaving(false)
  }

  return (
    <>
      <h1 className="page-title">Statuses</h1>

      {err && <div className="alert error">{err}</div>}

      <div className="card">
        <div className="card-title">Create Status</div>
        <div className="alert info" style={{ marginBottom: 16 }}>
          Leave <strong>Address</strong> empty for global state (e.g. <code>gameCount</code>). Fill it for user-scoped reads (e.g. token balance of a specific wallet).
        </div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label>Contract</label>
              <select value={form.contractId} onChange={e => setForm(f => ({ ...f, contractId: e.target.value, functionName: '', functionAbi: '' }))} required>
                <option value="">Select a contract…</option>
                {contracts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Address <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional — leave blank for global)</span></label>
              <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="0x…" />
            </div>
          </div>

          {viewFns.length > 0 && (
            <div className="field">
              <label>Select View Function</label>
              <div className="pill-group">
                {viewFns.map((fn: any) => (
                  <button key={fn.name} type="button" className={`pill ${form.functionName === fn.name ? 'active' : ''}`} onClick={() => pickFn(fn.name)}>
                    {fn.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label>Function Name</label>
            <input value={form.functionName} onChange={e => setForm(f => ({ ...f, functionName: e.target.value }))} placeholder="getGame" required />
          </div>
          <div className="field">
            <label>Function ABI Fragment (JSON)</label>
            <textarea value={form.functionAbi} onChange={e => setForm(f => ({ ...f, functionAbi: e.target.value }))} style={{ fontFamily: 'var(--mono)', fontSize: 12, minHeight: 100 }} placeholder='{"type":"function","name":"getGame","inputs":[...],...}' required />
          </div>
          <div className="btn-row">
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Create Status'}</button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-title">Statuses ({statuses.length})</div>
        {statuses.length === 0
          ? <div className="empty">No statuses yet. Create one above.</div>
          : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Contract</th><th>Function</th><th>Scope</th><th>Created</th></tr></thead>
                <tbody>
                  {statuses.map(s => (
                    <tr key={s.id}>
                      <td className="addr">{s.id}</td>
                      <td><span className="badge blue">{s.contract.name}</span></td>
                      <td><code>{s.functionName}()</code></td>
                      <td>
                        {s.address
                          ? <><span className="badge yellow">user-scoped</span> <span className="addr" style={{ marginLeft: 6 }}>{s.address.slice(0, 14)}…</span></>
                          : <span className="badge green">global</span>
                        }
                      </td>
                      <td className="addr">{new Date(s.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>
    </>
  )
}
