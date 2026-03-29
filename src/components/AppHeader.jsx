import { Activity, ChevronLeft, Github, Orbit, Radar } from 'lucide-react'

const NAV_ITEMS = [
  { key: 'home', label: 'Home' },
  { key: 'era', label: 'Era Explorer' },
  { key: 'staking', label: 'Staking Cadence' },
  { key: 'balance', label: 'Balance Viewer' },
  { key: 'reward-history', label: 'Reward History' },
]

const VIEW_LABELS = {
  era: 'Era Block Explorer',
  staking: 'Staking Rewards Cadence',
  balance: 'Historical Balance Viewer',
  'reward-history': 'Reward History Viewer',
}

export default function AppHeader({ status, view, onBack, onNavigate }) {
  const isLoading = status === 'loading'
  const currentLabel = VIEW_LABELS[view] ?? 'Digital Observatory'

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-ink/80 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-[92rem] flex-col gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              onClick={() => onNavigate?.('home')}
              className="group flex min-w-0 items-center gap-3 text-left"
              aria-label="Go to home"
            >
              <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-card shadow-card ring-1 ring-white/5 transition-transform duration-200 group-hover:-translate-y-0.5">
                <img src="/enjin-logo.png" alt="Enjin logo" className="h-5 w-5" />
                {isLoading && (
                  <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-cyan shadow-cyan-glow" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-brand text-xl font-bold tracking-tight text-primary sm:text-2xl">
                  EnjinSight
                </p>
              </div>
            </button>

            
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-full bg-card px-3 py-2 text-[11px] uppercase tracking-[0.22em] text-text-secondary xl:flex">
              <Orbit size={13} className="text-cyan" />
              Enjin Matrixchain
            </div>
            <a
              href="https://github.com/bladzv/enjinsight"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-icon flex items-center gap-2 px-4"
              aria-label="Open source on GitHub"
            >
              <Github size={16} />
              <span className="hidden md:inline-block text-sm font-semibold text-text-secondary">GitHub</span>
            </a>
          </div>
        </div>

        <div className="flex items-center gap-3 overflow-x-auto pb-1 scrollbar-thin">
          {NAV_ITEMS.map(item => {
            const isActive = view === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate?.(item.key)}
                aria-current={isActive ? 'page' : undefined}
                className={`nav-link-pill whitespace-nowrap ${isActive ? 'nav-link-pill-active' : 'nav-link-pill-idle'}`}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      </div>
    </header>
  )
}
