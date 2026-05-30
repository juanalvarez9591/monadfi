import { useEffect, useState } from 'react'
import type { Toast } from '../types'

interface Props {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

const ALERT_CLASS: Record<string, string> = {
  info:    'alert-info',
  success: 'alert-success',
  warning: 'alert-warning',
  error:   'alert-error',
}

const ICONS: Record<string, string> = {
  info:    'ℹ️',
  success: '✅',
  warning: '⚠️',
  error:   '❌',
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const hide = setTimeout(() => setVisible(false), 4200)
    const remove = setTimeout(onDismiss, 4700)
    return () => { clearTimeout(hide); clearTimeout(remove) }
  }, [])

  return (
    <div
      className={`alert ${ALERT_CLASS[toast.type]} shadow-lg transition-all duration-500 cursor-pointer max-w-sm
        ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}
      onClick={onDismiss}
    >
      <span className="text-lg">{ICONS[toast.type]}</span>
      <div>
        <div className="font-bold text-sm">{toast.title}</div>
        {toast.body && <div className="text-xs opacity-80">{toast.body}</div>}
      </div>
    </div>
  )
}

export default function ToastQueue({ toasts, onDismiss }: Props) {
  return (
    <div className="toast toast-top toast-end z-50 gap-2 p-4">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  )
}
