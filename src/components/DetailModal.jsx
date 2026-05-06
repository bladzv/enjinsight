import { useEffect } from 'react'
import { X } from 'lucide-react'

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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden p-2 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-ink/85 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close detail view"
      />

      <div
        className={`relative z-10 flex max-h-[calc(100dvh-1rem)] w-full min-w-0 flex-col overflow-hidden rounded-[1.15rem] bg-card shadow-[0_32px_80px_rgba(0,0,0,0.45)] sm:max-h-[calc(100dvh-3rem)] sm:rounded-[1.75rem] ${widthClass}`}
        style={{ border: '1px solid rgba(70,71,82,0.16)' }}
      >
        <div className="flex min-w-0 flex-col gap-3 border-b border-white/8 bg-[#05070f] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="min-w-0 flex-1">
            {eyebrow ? <p className="section-label">{eyebrow}</p> : null}
            <h2 className={`${eyebrow ? 'mt-2' : ''} break-words font-headline text-xl font-bold text-text sm:text-2xl`}>{title}</h2>
            {subtitle ? <p className="mt-2 break-words text-sm text-text-secondary">{subtitle}</p> : null}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:justify-start">
            {actions}
            <button
              type="button"
              onClick={onClose}
              className="btn-icon bg-card"
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
    </div>
  )
}
