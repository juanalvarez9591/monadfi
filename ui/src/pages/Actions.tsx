import { useEffect, useState } from 'react'
import { api, type Action, type Contract } from '../api'

export default function ActionsPage() {
  const [actions, setActions]     = useState<Action[]>([])
  const [contracts, setContracts] = useState<Contract[]>([])
  const [err, setErr]     = useState('')
  const [saving, setSaving] = useState(false)
  const [form, setForm]   = useState({ contractId: '', functionName: '', functionAbi: '' })

  const load = () => Promise.all([
    api.actions.list().then(setActions),
    api.contracts.list().then(setContracts),
  ]).catch(e => setErr(e.message))

  useEffect(() => { load() }, [])

  const selectedContract = contracts.find(c => c.id === parseInt(form.contractId))
  const writeFns = selectedContract
    ? selectedContract.abi.filter((x: any) => x.type === 'function' && x.stateMutability !== 'view' && x.stateMutability !== 'pure')
    : []

  const pickFn = (name: string) => {
    const frag = selectedContract?.abi.find((x: any) => x.name === name)
    setForm(f => ({ ...f, functionName: name, functionAbi: frag ? JSON.stringify(frag, null, 2) : '' }))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('')
    try {
      await api.actions.create({
        contractId: parseInt(form.contractId),
        functionName: form.functionName,
        functionAbi: JSON.parse(form.functionAbi),
      })
      setForm(f => ({ ...f, functionName: '', functionAbi: '' }))
      load()
    } catch (e: any) { setErr(e.message) }
    setSaving(false)
  }

  const del = async (id: number) => {
    if (!confirm('Delete this action?')) return
    await api.actions.delete(id).catch(e => setErr(e.message))
    load()
  }

  return (
    <>
      <h1 className="page-title">Actions</h1>
      {err && <div className="alert error">{err}</div>}

      <div className="card">
        <div className="card-title">Create Action</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
          An action is a write function on a contract. The wallet that executes it is determined by which agent runs it.
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label>Contract</label>
            <select value={form.contractId} onChange={e => setForm(f => ({ ...f, contractId: e.target.value, functionName: '', functionAbi: '' }))} required>
              <option value="">Select a contract…</option>
              {contracts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {writeFns.length > 0 && (
            <div className="field">
              <label>Select Write Function</label>
              <div className="pill-group">
                {writeFns.map((fn: any) => (
                  <button key={fn.name} type="button" className={`pill ${form.functionName === fn.name ? 'active' : ''}`} onClick={() => pickFn(fn.name)}>
                    {fn.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field">
            <label>Function Name</label>
            <input value={form.functionName} onChange={e => setForm(f => ({ ...f, functionName: e.target.value }))} placeholder="contribute" required />
          </div>
          <div className="field">
            <label>Function ABI Fragment (JSON)</label>
            <textarea value={form.functionAbi} onChange={e => setForm(f => ({ ...f, functionAbi: e.target.value }))} style={{ fontFamily: 'var(--mono)', fontSize: 12, minHeight: 100 }} placeholder='{"type":"function","name":"contribute","inputs":[...],...}' required />
          </div>
          <div className="btn-row">
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Create Action'}</button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-title">Actions ({actions.length})</div>
        {actions.length === 0
          ? <div className="empty">No actions yet. Create one above.</div>
          : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Contract</th><th>Function</th><th>Created</th><th></th></tr></thead>
                <tbody>
                  {actions.map(a => (
                    <tr key={a.id}>
                      <td className="addr">{a.id}</td>
                      <td><span className="badge blue">{a.contract.name}</span></td>
                      <td><code>{a.functionName}()</code></td>
                      <td className="addr">{new Date(a.createdAt).toLocaleString()}</td>
                      <td>
                        <button className="btn sm danger" onClick={() => del(a.id)}>Delete</button>
                      </td>
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
