import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function DetailModal({
  open,
  title,
  subtitle,
  onClose,
  children,
  actions = null,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 bg-ink/85 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close detail view"
      />

      <div
        className={`relative z-10 flex max-h-[min(90vh,64rem)] w-full flex-col overflow-hidden rounded-[1.75rem] bg-card shadow-[0_32px_80px_rgba(0,0,0,0.45)] ${widthClass}`}
        style={{ border: '1px solid rgba(70,71,82,0.16)' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/8 bg-[#05070f] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="section-label">Detailed View</p>
            <h2 className="mt-2 break-words font-headline text-2xl font-bold text-text">{title}</h2>
            {subtitle ? <p className="mt-2 break-words text-sm text-text-secondary">{subtitle}</p> : null}
          </div>

          <div className="flex items-center gap-2">
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

        <div className="min-h-0 flex-1 overflow-y-auto bg-term/20 px-4 py-4 sm:px-6 sm:py-5">
          {children}
        </div>
      </div>
    </div>
  )
}
