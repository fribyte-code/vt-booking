import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { IconButton } from './Button'

interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Small element shown before the title, e.g. a color swatch. */
  leading?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

/** Open modals, innermost last. Only the innermost reacts to Escape; scrolling stays locked until all close. */
const openModals: object[] = []

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }

export function Modal({ title, onClose, children, footer, leading, size = 'md' }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const firstField = panel?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea')
    ;(firstField ?? panel)?.focus()

    const self = {}
    openModals.push(self)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === self) onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      openModals.splice(openModals.indexOf(self), 1)
      if (openModals.length === 0) document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-2xl outline-none sm:rounded-2xl',
          widths[size],
        )}
      >
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 sm:px-6">
          {leading}
          <h2 id={titleId} className="min-w-0 flex-1 text-lg leading-7 font-semibold text-slate-900">
            {title}
          </h2>
          <IconButton aria-label="Lukk" onClick={onClose} className="-mt-1 -mr-2">
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 pb-5 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-4 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
