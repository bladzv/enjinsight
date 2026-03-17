import { Activity, ChevronLeft, Github } from 'lucide-react'

const VIEW_LABELS = {
  staking: 'Staking Rewards Cadence',
  balance: 'Historical Balance Viewer',
}

export default function AppHeader({ status, view, onBack }) {
  const viewLabel = VIEW_LABELS[view] ?? ''

  return (
    <header className="sticky top-0 z-30 bg-ink/90 backdrop-blur border-b border-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">

        {/* Left — brand only */}
        <div className="flex items-center gap-3 min-w-0">

          {/* Logo mark */}
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
                <img src="/enjin-logo.png" alt="Enjin logo" className="w-4 h-4" />
            </div>
            {status === 'loading' && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-cyan animate-pulse-slow" />
            )}
          </div>

          {/* Title */}
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-semibold text-text leading-tight truncate">
              EnjinSight
            </h1>
          </div>
        </div>

        {/* Right — status + GitHub link */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {status === 'loading' && (
            <span className="flex items-center gap-1 text-[11px] sm:text-xs text-cyan font-mono">
              <Activity size={12} className="animate-pulse" />
              Scanning
            </span>
          )}
          <a
            href="https://github.com/bladzv/enjinsight"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-dim hover:text-cyan flex items-center gap-1"
            aria-label="Open source on GitHub"
          >
            <Github size={14} />
            <span className="text-xs sm:text-sm">GitHub</span>
          </a>
        </div>
      </div>

      {/* Breadcrumb bar (non-home views) */}
      {view && view !== 'home' && (
        <div className="border-t border-border/40 bg-ink/90">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2 flex flex-col gap-2">
            <div className="text-xs text-muted flex items-center gap-1.5">
              <span className="flex-shrink-0">Tool Selection</span>
              <span className="flex-shrink-0 text-border">›</span>
              <span className="text-text font-medium truncate">{viewLabel}</span>
            </div>
            <button
              onClick={onBack}
              className="flex items-center gap-1 text-xs text-dim hover:text-cyan transition-colors
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded flex-shrink-0 w-fit"
              aria-label="Back to tool selection"
            >
              <ChevronLeft size={13} />
              Go back
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
