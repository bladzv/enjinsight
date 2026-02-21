import { ExternalLink, Activity } from 'lucide-react'

export default function AppHeader({ status }) {
  return (
    <header className="sticky top-0 z-30 bg-ink/90 backdrop-blur border-b border-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">

        {/* Left — brand */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Logo mark */}
          <div className="relative flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
              <svg viewBox="0 0 16 16" className="w-4 h-4 fill-primary">
                <circle cx="8" cy="8" r="3"/>
                <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1"/>
                <line x1="8" y1="1" x2="8" y2="3.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                <line x1="8" y1="12.5" x2="8" y2="15" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                <line x1="1" y1="8" x2="3.5" y2="8" stroke="#00D4FF" strokeWidth="1" strokeLinecap="round"/>
                <line x1="12.5" y1="8" x2="15" y2="8" stroke="#00D4FF" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            </div>
            {status === 'loading' && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-cyan animate-pulse-slow" />
            )}
          </div>

          {/* Title */}
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-semibold text-text leading-tight truncate">
              Validator Reward Checker
            </h1>
            <p className="text-xs text-dim hidden sm:block leading-none mt-0.5">Enjin Relaychain</p>
          </div>
        </div>

        {/* Right — links */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {status === 'loading' && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-cyan font-mono">
              <Activity size={12} className="animate-pulse" />
              Scanning
            </span>
          )}
          <a
            href="https://enjin.subscan.io"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-dim hover:text-cyan"
            aria-label="Open Enjin Subscan in a new tab"
          >
            <span className="hidden sm:inline">Subscan</span>
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    </header>
  )
}
