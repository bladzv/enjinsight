import { Activity, ChevronLeft, Github } from 'lucide-react'

const VIEW_LABELS = {
  era:            'Era Block Explorer',
  staking:        'Staking Rewards Cadence',
  balance:        'Historical Balance Viewer',
  'reward-history': 'Reward History Viewer',
}

export default function AppHeader({ status, view, onBack }) {
  const viewLabel = VIEW_LABELS[view] ?? ''

  return (
    <header className="sticky top-0 z-30 bg-ink/95 backdrop-blur-xl">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">

        {/* Left — brand */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Logo mark */}
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded bg-card flex items-center justify-center">
                <img src="/enjin-logo.png" alt="Enjin logo" className="w-4 h-4" />
            </div>
            {status === 'loading' && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-cyan animate-pulse-slow" />
            )}
          </div>

          {/* Title */}
          <h1 className="text-base sm:text-lg font-bold font-brand text-primary tracking-tighter leading-tight truncate">
            EnjinSight
          </h1>

          {/* Nav links — shown on non-home views as breadcrumb */}
          {view && view !== 'home' && (
            <div className="hidden md:flex items-center gap-1.5 ml-4">
              <button
                onClick={onBack}
                className="text-text-secondary hover:text-primary transition-colors text-sm"
              >
                Dashboard
              </button>
              <span className="text-muted text-xs">/</span>
              <span className="text-primary text-sm font-medium truncate">{viewLabel}</span>
            </div>
          )}
        </div>

        {/* Right — status + GitHub link */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {status === 'loading' && (
            <span className="flex items-center gap-1.5 text-[11px] sm:text-xs text-cyan font-mono">
              <Activity size={12} className="animate-pulse" />
              <span className="hidden sm:inline">Scanning</span>
            </span>
          )}
          <a
            href="https://github.com/bladzv/enjinsight"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-text-secondary hover:bg-surface-bright transition-all rounded"
            aria-label="Open source on GitHub"
          >
            <Github size={16} />
          </a>
        </div>
      </nav>

      {/* Mobile breadcrumb + back (non-home views) */}
      {view && view !== 'home' && (
        <div className="md:hidden px-4 sm:px-6 pb-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-primary transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded flex-shrink-0 w-fit"
            aria-label="Back to tool selection"
          >
            <ChevronLeft size={13} />
            <span>{viewLabel}</span>
          </button>
        </div>
      )}
    </header>
  )
}
