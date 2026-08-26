import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap.js'

export default function DetailModal({
  open,
  title,
  subtitle,
  onClose,
  children,
  actions = null,
  eyebrow = 'Detailed View',
  widthClass = 'max-w-6xl',
}) {
  const panelRef = useRef(null)
  const titleId = useId()
  useFocusTrap(panelRef, open)

  useEffect(() => {
    if (!open) return undefined

    const prevOverflow = document.body.style.overflow
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center overflow-hidden sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        type="button"
        className="absolute inset-0 bg-ink/85 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close detail view"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className={`modal-panel relative z-10 flex max-h-[100dvh] w-full min-w-0 flex-col overflow-hidden rounded-sm bg-card shadow-[0_32px_80px_rgba(0,0,0,0.45)] sm:max-h-[calc(100dvh-3rem)] ${widthClass}`}
        style={{ border: '1px solid var(--hairline)' }}
      >
        <div className="sticky top-0 z-10 flex min-w-0 items-start gap-3 border-b border-[var(--hairline)] bg-[var(--surface)] px-3 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0 flex-1">
            {eyebrow ? <p className="section-label">{eyebrow}</p> : null}
            <h2 id={titleId} className={`${eyebrow ? 'mt-1.5' : ''} break-words font-headline text-base font-bold text-text sm:text-2xl`}>{title}</h2>
            {subtitle ? <p className="mt-1 break-words text-xs leading-snug text-text-secondary sm:mt-2 sm:text-sm">{subtitle}</p> : null}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <button
              type="button"
              onClick={onClose}
              className="btn-icon"
              aria-label="Close detail view"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-term/20 px-3 py-3 sm:px-6 sm:py-5">
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}
