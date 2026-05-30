import { useEffect, useState } from 'react'
import { api, type Contract } from '../api'

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [err, setErr]   = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [editing, setEditing]   = useState<{ id: number; name: string } | null>(null)
  const [form, setForm] = useState({ name: '', address: '', abi: '', chainId: '31337', deployedAt: '' })

  const load = () => api.contracts.list().then(setContracts).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setErr('')
    try {
      await api.contracts.create({
        name: form.name, address: form.address, abi: form.abi,
        chainId: parseInt(form.chainId),
        deployedAt: form.deployedAt || new Date().toISOString(),
      })
      setForm({ name: '', address: '', abi: '', chainId: '31337', deployedAt: '' })
      load()
    } catch (e: any) { setErr(e.message) }
    setSaving(false)
  }

  const del = async (id: number, name: string) => {
    if (!confirm(`Delete contract "${name}"? This cannot be undone.`)) return
    await api.contracts.delete(id).catch(e => setErr(e.message))
    load()
  }

  const saveRename = async () => {
    if (!editing) return
    await api.contracts.rename(editing.id, editing.name).catch(e => setErr(e.message))
    setEditing(null)
    load()
  }

  return (
    <>
      <h1 className="page-title">Contracts</h1>
      {err && <div className="alert error">{err}</div>}

      <div className="card">
        <div className="card-title">Register Contract</div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field">
              <label>Contract Name</label>
              <input value={form.name} onChange={set('name')} placeholder="CasinoRoulette" required />
            </div>
            <div className="field">
              <label>Address</label>
              <input value={form.address} onChange={set('address')} placeholder="0x..." required />
            </div>
            <div className="field">
              <label>Chain ID</label>
              <input value={form.chainId} onChange={set('chainId')} placeholder="31337" />
            </div>
            <div className="field">
              <label>Deployed At <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
              <input value={form.deployedAt} onChange={set('deployedAt')} placeholder={new Date().toISOString()} />
            </div>
          </div>
          <div className="field">
            <label>ABI (JSON array)</label>
            <textarea value={form.abi} onChange={set('abi')} placeholder='[{"type":"function","name":"contribute",...}]' style={{ minHeight: 120, fontFamily: 'var(--mono)', fontSize: 12 }} required />
          </div>
          <div className="btn-row">
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Saving…' : 'Register Contract'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-title">Registered Contracts ({contracts.length})</div>
        {contracts.length === 0
          ? <div className="empty">No contracts registered yet.</div>
          : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Name</th><th>Address</th><th>Chain</th><th>Functions</th><th>Deployed</th><th></th></tr>
                </thead>
                <tbody>
                  {contracts.map(c => (
                    <>
                      <tr key={c.id}>
                        <td>
                          {editing?.id === c.id
                            ? (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <input
                                  value={editing.name}
                                  onChange={e => setEditing({ ...editing, name: e.target.value })}
                                  style={{ width: 160 }}
                                  autoFocus
                                  onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setEditing(null) }}
                                />
                                <button className="btn sm primary" onClick={saveRename}>Save</button>
                                <button className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
                              </div>
                            )
                            : <strong>{c.name}</strong>
                          }
                        </td>
                        <td><code>{c.address}</code></td>
                        <td><span className="badge gray">{c.chainId}</span></td>
                        <td>{c.abi.filter((x: any) => x.type === 'function').length} functions</td>
                        <td className="addr">{c.deployedAt ? new Date(c.deployedAt).toLocaleString() : '—'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn sm" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                              {expanded === c.id ? 'Hide ABI' : 'ABI'}
                            </button>
                            {editing?.id !== c.id && (
                              <button className="btn sm" onClick={() => setEditing({ id: c.id, name: c.name })}>Rename</button>
                            )}
                            <button className="btn sm danger" onClick={() => del(c.id, c.name)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                      {expanded === c.id && (
                        <tr key={`${c.id}-abi`}>
                          <td colSpan={6} style={{ padding: '0 14px 14px' }}>
                            <pre>{JSON.stringify(c.abi, null, 2)}</pre>
                          </td>
                        </tr>
                      )}
                    </>
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
