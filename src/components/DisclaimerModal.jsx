import { useState, useEffect } from 'react'
import { AlertTriangle, CheckCircle2, Database, Eye, X } from 'lucide-react'

const STORAGE_KEY = 'enjinsight_disclaimer_v1'
const BRAND_LOGO_URL = '/android-chrome-192x192.png'
const BRAND_NAME_URL = '/assets/brand/enjinsight_brand.png'

export function DisclaimerContent({ compact = false } = {}) {
  return (
    <div className={`rounded-[1.15rem] border border-warning/20 bg-warning/5 sm:rounded-[1.5rem] ${compact ? 'p-4' : 'p-4 sm:p-5'}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning sm:h-10 sm:w-10 sm:rounded-2xl">
          <AlertTriangle size={16} />
        </div>
        <div className="min-w-0 space-y-2">
          <p className="section-label text-warning">Disclaimer</p>
          <p className="text-sm leading-6 text-text-secondary">
            EnjinSight is unofficial third-party tooling and is not developed by or affiliated with the Enjin development team.
            The information shown here is assembled from public chain data and should be treated as a research aid, not a guarantee.
            Verify important operational, accounting, or tax decisions against your own records.
          </p>
        </div>
      </div>
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
    const prevOverflow = document.body.style.overflow
    const onKeyDown = (event) => {
      if (!isFirstVisit && event.key === 'Escape') onClose?.()
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isFirstVisit, onClose])

  useEffect(() => {
    if (!isFirstVisit || seconds <= 0) return
    const t = setTimeout(() => setSeconds(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds, isFirstVisit])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden p-2 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-ink/80 backdrop-blur-sm"
        onClick={isFirstVisit ? undefined : onClose}
      />

      <div
        className="relative z-10 flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl animate-fade-in flex-col overflow-hidden rounded-[1.25rem] bg-surface shadow-float sm:max-h-[calc(100dvh-2rem)] sm:rounded-[2rem]"
        style={{ border: '1px solid rgba(70,71,82,0.14)' }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-48"
          style={{ background: 'radial-gradient(circle at top left, rgba(0,238,252,0.12), transparent 58%), radial-gradient(circle at top right, rgba(255,197,61,0.10), transparent 45%)' }}
        />

        {!isFirstVisit && (
          <button
            type="button"
            onClick={onClose}
            className="btn-icon absolute right-4 top-4 z-20"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}

        <div className="relative z-10 min-h-0 space-y-5 overflow-y-auto overscroll-contain p-4 sm:space-y-6 sm:p-8">
          <div className="rounded-[1.15rem] bg-card/80 p-4 shadow-inset-soft sm:rounded-[1.5rem] sm:p-6">
            <div className="space-y-2">
              {!isFirstVisit && (
                <div className="mb-4 flex items-center gap-3">
                  <img src={BRAND_LOGO_URL} alt="EnjinSight logo" className="h-12 w-12 rounded-2xl" />
                  <img src={BRAND_NAME_URL} alt="EnjinSight" className="h-9 w-auto max-w-[13rem]" />
                </div>
              )}
              {isFirstVisit && (
                <p className="section-label">
                  Before You Continue
                </p>
              )}
              {isFirstVisit && (
                <h2 className="font-headline text-2xl font-bold tracking-tight text-text sm:text-3xl">
                  Read This First
                </h2>
              )}
              <div className="space-y-2">
                <p className="max-w-2xl text-sm leading-6 text-text-secondary">
                  EnjinSight is a read-only research workspace. It never asks you to connect a wallet, but the data still deserves verification before you act on it.
                </p>
              </div>
            </div>
          </div>

          <FirstVisitContent />

          <div className="flex justify-end pb-1">
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

function FirstVisitContent() {
  return (
    <div className="space-y-4">
      <DisclaimerContent />

      <div className="grid gap-3 sm:grid-cols-3">
        <FirstVisitCard
          icon={Eye}
          title="Read-only"
          text="No wallet connection, no signing, and no transaction flow."
        />
        <FirstVisitCard
          icon={Database}
          title="Public data"
          text="Values are assembled from public RPC nodes, indexers, and bundled era references."
        />
        <FirstVisitCard
          icon={CheckCircle2}
          title="Verify"
          text="Use the output as a research aid and confirm important decisions independently."
        />
      </div>
    </div>
  )
}

function FirstVisitCard({ icon: Icon, title, text }) {
  return (
    <div className="min-w-0 rounded-[1rem] bg-card px-4 py-4 shadow-inset-soft sm:rounded-[1.25rem]">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary sm:h-10 sm:w-10 sm:rounded-2xl">
        <Icon size={17} />
      </div>
      <h3 className="mt-3 font-headline text-lg font-bold text-text">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-text-secondary">{text}</p>
    </div>
  )
}
