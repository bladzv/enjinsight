import { useState, useEffect } from 'react'
import { AlertTriangle, Database, Shield, Sparkles, X } from 'lucide-react'

const STORAGE_KEY = 'enjinsight_disclaimer_v1'

export function DisclaimerContent({ compact = false } = {}) {
  return (
    <div className={`rounded-[1.5rem] border border-warning/20 bg-warning/5 ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-warning/10 text-warning">
          <AlertTriangle size={16} />
        </div>
        <div className="space-y-2">
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
    if (!isFirstVisit || seconds <= 0) return
    const t = setTimeout(() => setSeconds(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds, isFirstVisit])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-ink/80 backdrop-blur-sm"
        onClick={isFirstVisit ? undefined : onClose}
      />

      <div
        className={`relative z-10 w-full animate-fade-in overflow-hidden rounded-[2rem] bg-surface shadow-float ${
          isFirstVisit ? 'max-w-xl' : 'max-w-3xl'
        }`}
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

        <div className="relative z-10 space-y-6 p-6 sm:p-8">
          <div className="rounded-[1.5rem] bg-card/80 p-5 shadow-inset-soft sm:p-6">
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl ${
                  isFirstVisit ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'
                }`}
              >
                {isFirstVisit ? <AlertTriangle size={20} /> : <Sparkles size={20} />}
              </div>
              <div className="space-y-2">
                <p className="section-label">
                  {isFirstVisit ? 'Before You Continue' : 'About'}
                </p>
                <h2 className="font-headline text-3xl font-bold tracking-tight text-text">
                  {isFirstVisit ? 'Read This First' : 'EnjinSight'}
                </h2>
                <p className="max-w-2xl text-sm leading-6 text-text-secondary">
                  {isFirstVisit
                    ? 'This app is designed for read-only blockchain research. Please review the disclaimer before using the tools.'
                    : 'Read-only diagnostics for Enjin staking, era tracking, and historical balance or reward analysis.'}
                </p>
              </div>
            </div>
          </div>

          {isFirstVisit ? <DisclaimerContent /> : <AboutContent />}

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

function AboutContent() {
  return (
    <div className="space-y-4">
      <div className="rounded-[1.5rem] bg-card/80 p-5 shadow-inset-soft">
        <p className="section-label">Overview</p>
        <h3 className="mt-2 font-headline text-2xl font-bold text-text">Built for quick Enjin chain research</h3>
        <p className="mt-3 section-subtitle">
          EnjinSight brings together live era tracking, staking cadence checks, historical balance snapshots, and reward-history estimates in one read-only workspace.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="mini-chip">Read-only</span>
          <span className="mini-chip">Archive RPC</span>
          <span className="mini-chip">Staking + Balance</span>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-[1.5rem] bg-card px-5 py-5 shadow-ambient">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-success/10 text-success">
            <Shield size={18} />
          </div>
          <p className="section-label mt-4">Usage</p>
          <h4 className="mt-2 font-headline text-xl font-bold text-text">Read-only by design</h4>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            The app is meant for investigation and review. It does not require wallet connection or signing.
          </p>
        </div>
        <div className="rounded-[1.5rem] bg-card px-5 py-5 shadow-ambient">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Database size={18} />
          </div>
          <p className="section-label mt-4">Data</p>
          <h4 className="mt-2 font-headline text-xl font-bold text-text">RPC-first workflow</h4>
          <p className="mt-3 text-sm leading-6 text-text-secondary">
            Results come from archive RPC endpoints, era references, and selective public explorer lookups where needed.
          </p>
        </div>
      </div>

      <DisclaimerContent compact />
    </div>
  )
}
