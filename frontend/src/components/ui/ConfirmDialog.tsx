import { type ReactNode, useState } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  title: string
  children: ReactNode
  confirmLabel: string
  onConfirm: () => Promise<unknown> | void
  onClose: () => void
  destructive?: boolean
}

export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onClose, destructive }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button
            variant="primary"
            className={destructive ? 'bg-red-600 hover:bg-red-700' : undefined}
            onClick={confirm}
            disabled={busy}
            data-autofocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-600">{children}</div>
    </Modal>
  )
}
