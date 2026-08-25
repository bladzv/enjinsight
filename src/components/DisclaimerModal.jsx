import { useState, useEffect, useId, useRef, useCallback } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Database, Eye, X } from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap.js'

const STORAGE_KEY = 'enjinsight_disclaimer_v1'
const BRAND_LOGO_URL = '/android-chrome-192x192.png'
const BRAND_NAME_URL = '/assets/brand/enjinsight_brand.png'

export function DisclaimerContent({ compact = false, titleId } = {}) {
  return (
    <div className={`rounded-sm border border-warning/20 bg-warning/5 sm:rounded-sm ${compact ? 'p-4' : 'p-4 sm:p-5'}`}>
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-warning/10 text-warning">
          <AlertTriangle size={16} />
        </div>
        <p id={titleId} className="font-headline text-base font-bold text-warning">Disclaimer</p>
      </div>
      <p className="mt-2.5 text-sm leading-6 text-text-secondary">
        EnjinSight is a third-party, community-built tool. Information displayed is derived from publicly available on-chain data and is provided for research and reference purposes only. It does not constitute financial, accounting, tax, or legal advice, and should not be relied upon as a definitive or complete record. Always verify any information against your own primary records before making operational, accounting, tax, or other material decisions.
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
  const scrollRef = useRef(null)
  const panelRef = useRef(null)
  const titleId = useId()
  const [showNudge, setShowNudge] = useState(false)

  // Always active while mounted — the parent conditionally renders this
  // component in and out rather than passing an `open` prop.
  useFocusTrap(panelRef, true)

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setShowNudge(el.scrollTop + el.clientHeight < el.scrollHeight - 20)
  }, [])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    const onKeyDown = (event) => {
      if (!isFirstVisit && event.key === 'Escape') onClose?.()
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', checkOverflow)

    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', checkOverflow)
    }
  }, [isFirstVisit, onClose, checkOverflow])

  useEffect(() => {
    const id = requestAnimationFrame(checkOverflow)
    return () => cancelAnimationFrame(id)
  }, [checkOverflow])

  useEffect(() => {
    if (!isFirstVisit || seconds <= 0) return
    const t = setTimeout(() => setSeconds(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds, isFirstVisit])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden p-2 sm:p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div
        className="absolute inset-0 bg-ink/80 backdrop-blur-sm"
        onClick={isFirstVisit ? undefined : onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl animate-fade-in flex-col overflow-hidden rounded-sm bg-surface shadow-float sm:max-h-[calc(100dvh-2rem)] sm:rounded-sm"
        style={{ border: '1px solid rgba(70,71,82,0.14)' }}
      >
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

        <div ref={scrollRef} onScroll={checkOverflow} className="relative z-10 min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4 sm:space-y-6 sm:p-8">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <img src={BRAND_LOGO_URL} alt="EnjinSight logo" className="h-8 w-8 rounded-sm sm:h-12 sm:w-12" />
            <img src={BRAND_NAME_URL} alt="EnjinSight" className="h-6 w-auto max-w-[9rem] sm:h-9 sm:max-w-[13rem]" />
          </div>

          <FirstVisitContent titleId={titleId} />

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

        {showNudge && (
          <div className="pointer-events-none absolute bottom-0 inset-x-0 z-20 flex flex-col items-center justify-end h-16 bg-gradient-to-t from-surface to-transparent pb-3">
            <ChevronDown size={18} className="animate-scroll-nudge text-text-secondary/60" />
          </div>
        )}
      </div>
    </div>
  )
}

function FirstVisitContent({ titleId }) {
  return (
    <div className="space-y-4">
      <DisclaimerContent titleId={titleId} />

      <div className="grid gap-3 sm:grid-cols-3">
        <FirstVisitCard
          icon={Eye}
          title="Read-only"
          text="No wallet, no signing, no transactions."
        />
        <FirstVisitCard
          icon={Database}
          title="Public data"
          text="From public RPC nodes, indexers, and era references."
        />
        <FirstVisitCard
          icon={CheckCircle2}
          title="Verify"
          text="Confirm outputs against your own records."
        />
      </div>
    </div>
  )
}

function FirstVisitCard({ icon: Icon, title, text }) {
  return (
    <div className="min-w-0 rounded-sm bg-card px-3 py-3 shadow-inset-soft sm:px-4 sm:py-4">
      <div className="flex items-center gap-2 sm:gap-2.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-primary/10 text-primary sm:h-8 sm:w-8">
          <Icon size={14} className="sm:hidden" />
          <Icon size={16} className="hidden sm:block" />
        </div>
        <h3 className="font-headline text-sm font-bold text-text sm:text-base">{title}</h3>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-text-secondary sm:mt-2.5 sm:text-sm sm:leading-6">{text}</p>
    </div>
  )
}
