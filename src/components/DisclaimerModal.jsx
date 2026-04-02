import { useState, useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

const STORAGE_KEY = 'enjinsight_disclaimer_v1'

export function DisclaimerContent() {
  return (
    <div className="rounded-xl p-4" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.18)' }}>
      <p className="text-sm leading-relaxed text-text-secondary">
        EnjinSight is{' '}
        <span className="font-semibold text-text">unofficial, third-party tooling</span> and is{' '}
        <span className="font-semibold text-text">not</span> developed by or affiliated with the
        Enjin development team. This is a personal project created independently. The accuracy or
        correctness of information displayed{' '}
        <span className="font-semibold text-text">cannot be guaranteed</span>. Use at your own risk.
      </p>
    </div>
  )
}

export function useFirstVisitDisclaimer() {
  const [show, setShow] = useState(() => {
    try {
      return !localStorage.getItem(STORAGE_KEY)
    } catch {
      return true
    }
  })

  function accept() {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    setShow(false)
  }

  return { show, accept }
}

/**
 * mode="first-visit" — countdown button, backdrop non-dismissible
 * mode="about"       — close button, backdrop dismissible
 */
export default function DisclaimerModal({ mode = 'first-visit', onClose }) {
  const isFirstVisit = mode === 'first-visit'
  const [seconds, setSeconds] = useState(5)

  useEffect(() => {
    if (!isFirstVisit || seconds <= 0) return
    const t = setTimeout(() => setSeconds(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds, isFirstVisit])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/80 backdrop-blur-sm"
        onClick={isFirstVisit ? undefined : onClose}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg animate-fade-in rounded-[1.75rem] bg-card shadow-float" style={{ border: '1px solid rgba(70,71,82,0.14)' }}>
        {/* Close button — about mode only */}
        {!isFirstVisit && (
          <button
            type="button"
            onClick={onClose}
            className="btn-icon absolute right-4 top-4"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}

        <div className="space-y-5 p-6 sm:p-8">
          {/* Icon + heading */}
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl" style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.20)' }}>
              <AlertTriangle size={20} className="text-warning" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-text-secondary">
                {isFirstVisit ? 'Before You Continue' : 'About'}
              </p>
              <h2 className="font-headline text-lg font-bold text-text">
                {isFirstVisit ? 'Disclaimer' : 'EnjinSight'}
              </h2>
            </div>
          </div>

          {/* About description — only in about mode */}
          {!isFirstVisit && (
            <p className="text-sm leading-relaxed text-text-secondary">
              EnjinSight is a read-only blockchain analytics suite for the Enjin ecosystem. It
              provides real-time era metrics, staking cadence detection, historical balance queries,
              and per-era reward computation — with no wallet required and no backend database.
            </p>
          )}

          <DisclaimerContent />

          {/* Action */}
          <div className="flex justify-end">
            {isFirstVisit ? (
              <button
                type="button"
                onClick={onClose}
                disabled={seconds > 0}
                className="btn-primary"
              >
                I understand{seconds > 0 ? ` (${seconds})` : ''}
              </button>
            ) : (
              <button type="button" onClick={onClose} className="btn-secondary">
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
