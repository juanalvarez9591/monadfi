import { useEffect, useRef, useState } from 'react'
import { api, type LogEntry } from '../api'

export default function LogsPage() {
  const [logs, setLogs]   = useState<LogEntry[]>([])
  const [auto, setAuto]   = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = () => api.logs.list(300).then(setLogs).catch(() => {})

  useEffect(() => {
    load()
    if (!auto) return
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [auto])

  useEffect(() => {
    if (auto) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, auto])

  const fmtAttrs = (attrs?: Record<string, unknown>) => {
    if (!attrs || Object.keys(attrs).length === 0) return null
    return Object.entries(attrs).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join('  ')
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Logs</h1>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />
            Auto-refresh
          </label>
          <button className="btn sm" onClick={load}>Refresh</button>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {logs.length === 0
          ? <div className="empty">No log entries yet. Interact with the API to generate logs.</div>
          : (
            <div className="table-wrap">
              <table className="log-table">
                <thead>
                  <tr>
                    <th style={{ width: 200 }}>Time</th>
                    <th style={{ width: 70 }}>Level</th>
                    <th>Message</th>
                    <th>Attributes</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((e, i) => (
                    <tr key={i} className={`log-row ${e.level}`}>
                      <td style={{ color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{e.time}</td>
                      <td><span className={`level-${e.level}`}>{e.level}</span></td>
                      <td>{e.msg}</td>
                      <td style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                        {fmtAttrs(e.attrs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div ref={bottomRef} />
            </div>
          )
        }
      </div>
    </>
  )
}
