import { useState } from 'react'
import ContractsPage from './pages/Contracts'
import ActionsPage   from './pages/Actions'
import StatusesPage  from './pages/Statuses'
import AgentsPage    from './pages/Agents'
import LogsPage      from './pages/Logs'

const TABS = [
  { id: 'agents',    label: 'Agents' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'actions',   label: 'Actions' },
  { id: 'statuses',  label: 'Statuses' },
  { id: 'logs',      label: 'Logs' },
] as const

type Tab = typeof TABS[number]['id']

export default function App() {
  const [tab, setTab] = useState<Tab>('agents')

  return (
    <>
      <header>
        <span className="logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          Monad Agent Swarm
        </span>
        <nav>
          {TABS.map(t => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'contracts' && <ContractsPage />}
        {tab === 'actions'   && <ActionsPage />}
        {tab === 'statuses'  && <StatusesPage />}
        {tab === 'agents'    && <AgentsPage />}
        {tab === 'logs'      && <LogsPage />}
      </main>
    </>
  )
}
