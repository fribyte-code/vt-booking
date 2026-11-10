import { Check, Copy, Mail } from 'lucide-react'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { cn } from '../../lib/cn'
import { type EmailDraft, emailText, mailtoOf } from '../../services/email'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

/**
 * Copies text to the clipboard. Falls back to a hidden textarea and `execCommand` where the
 * Clipboard API is missing or refused (e.g. plain HTTP on another host than localhost).
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

/** "Kopiert!" for a moment after copying; an error if the browser refused. */
function useCopied(): [state: 'idle' | 'copied' | 'failed', copy: (text: string) => void] {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state !== 'copied') return
    const timer = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [state])
  return [state, (text) => void copyText(text).then((ok) => setState(ok ? 'copied' : 'failed'))]
}

/**
 * Every email the app prepares (replies to public requests, orders to the guards): the app sends
 * nothing itself. Shows the recipient with its own copy button (empty when the admin fills it in),
 * the subject and text in a box that can be selected, "Kopier e-post" (subject and text) and
 * "Åpne i e-postprogram" (`mailto:`).
 */
export function EmailDialog({ title, draft, onClose }: { title: string; draft: EmailDraft; onClose: () => void }) {
  const id = useId()
  const [mail, copyMail] = useCopied()
  const [address, copyAddress] = useCopied()

  return (
    <Modal
      title={title}
      size="lg"
      onClose={onClose}
      footer={
        // Stacked at full width on a phone, the main button on top; side by side from sm.
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <a
            href={mailtoOf(draft)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-slate-700 ring-1 ring-slate-300 ring-inset hover:bg-slate-50 sm:mr-auto"
          >
            <Mail className="size-4" /> Åpne i e-postprogram
          </a>
          <Button variant="primary" className="justify-center" onClick={() => copyMail(emailText(draft))} aria-live="polite">
            {mail === 'copied' ? <Check className="size-4" /> : <Copy className="size-4" />}
            {mail === 'copied' ? 'Kopiert!' : 'Kopier e-post'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div>
          <p id={`${id}-to`} className="mb-1 text-sm font-medium text-slate-700">
            Til
          </p>
          <div className="flex items-center gap-2">
            <p
              aria-labelledby={`${id}-to`}
              className={cn(
                'min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200 ring-inset select-all',
                draft.to ? 'text-slate-900' : 'text-slate-400 italic',
              )}
            >
              {draft.to || 'Fyll inn mottaker selv'}
            </p>
            {draft.to && (
              <Button size="sm" onClick={() => copyAddress(draft.to)} aria-label={`Kopier adressen ${draft.to}`}>
                {address === 'copied' ? <Check className="size-4" /> : <Copy className="size-4" />}
                {address === 'copied' ? 'Kopiert!' : 'Kopier'}
              </Button>
            )}
          </div>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Emne og tekst</p>
          <div className="max-h-[50vh] overflow-y-auto rounded-lg bg-white p-3 text-sm ring-1 ring-slate-300 ring-inset select-text">
            <p className="font-semibold text-slate-900">{draft.subject}</p>
            <p className="mt-3 whitespace-pre-wrap text-slate-700">{draft.body}</p>
          </div>
        </div>
        {(mail === 'failed' || address === 'failed') && (
          <p role="alert" className="text-sm text-red-700">
            Nettleseren lot ikke appen kopiere. Marker teksten og kopier den selv.
          </p>
        )}
      </div>
    </Modal>
  )
}

/** A button that opens an `EmailDialog` with the draft, made when clicked (so it is never stale). */
export function EmailButton({
  title,
  draft,
  children,
  className,
  variant = 'secondary',
}: {
  title: string
  draft: () => EmailDraft
  children: ReactNode
  className?: string
  variant?: 'secondary' | 'ghost'
}) {
  const [open, setOpen] = useState<EmailDraft | null>(null)
  return (
    <>
      <Button size="sm" variant={variant} className={className} onClick={() => setOpen(draft())}>
        {children}
      </Button>
      {open && <EmailDialog title={title} draft={open} onClose={() => setOpen(null)} />}
    </>
  )
}
