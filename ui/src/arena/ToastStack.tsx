import { useState, useEffect } from 'react'
import type { Toast } from './types'

interface ItemProps { t: Toast; onDismiss: () => void }

function ToastItem({ t, onDismiss }: ItemProps) {
  const [out, setOut] = useState(false)
  useEffect(() => {
    const h = setTimeout(() => setOut(true), 4200)
    const r = setTimeout(onDismiss, 4700)
    return () => { clearTimeout(h); clearTimeout(r) }
  }, [onDismiss])
  return (
    <div
      className={`toast t-${t.type} animate__animated ${out ? 'animate__fadeOutRight' : 'animate__fadeInRight'}`}
      onClick={onDismiss}
    >
      <span className="toast-ico">{t.ico}</span>
      <div className="toast-body">
        <div className="toast-title">{t.title}</div>
        {t.body && <div className="toast-sub">{t.body}</div>}
      </div>
    </div>
  )
}

interface Props { toasts: Toast[]; onDismiss: (id: number) => void }

export default function ToastStack({ toasts, onDismiss }: Props) {
  return (
    <div className="toaststack">
      {toasts.map(t => <ToastItem key={t.id} t={t} onDismiss={() => onDismiss(t.id)} />)}
    </div>
  )
}
