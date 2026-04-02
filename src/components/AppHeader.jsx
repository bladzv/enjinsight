import { useState } from 'react'
import { Github, Menu, X, BookOpen, Info } from 'lucide-react'

const NAV_ITEMS = [
  { key: 'home', label: 'Home' },
  { key: 'era', label: 'Era Explorer' },
  { key: 'staking', label: 'Staking Cadence' },
  { key: 'balance', label: 'Balance Viewer' },
  { key: 'reward-history', label: 'Reward History' },
]

const GITHUB_URL = 'https://github.com/bladzv/enjinsight'
const README_URL = 'https://github.com/bladzv/enjinsight#readme'

export default function AppHeader({ status, view, onBack, onNavigate, onAbout }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isLoading = status === 'loading'

  function handleNav(key) {
    setMenuOpen(false)
    onNavigate?.(key)
  }

  function handleAbout() {
    setMenuOpen(false)
    onAbout?.()
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-ink/80 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-[92rem] flex-col gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => handleNav('home')}
            className="group flex min-w-0 items-center gap-3 text-left"
            aria-label="Go to home"
          >
            <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-card shadow-card ring-1 ring-white/5 transition-transform duration-200 group-hover:-translate-y-0.5">
              <img src="/enjin-logo.png" alt="Enjin logo" className="h-5 w-5" />
              {isLoading && (
                <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-cyan shadow-cyan-glow" />
              )}
            </div>
            <p className="font-brand text-xl font-bold tracking-tight text-primary sm:text-2xl">
              EnjinSight
            </p>
          </button>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {/* README */}
            <a
              href={README_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-icon flex items-center gap-2 px-3"
              aria-label="Open README on GitHub"
            >
              <BookOpen size={16} />
              <span className="hidden md:inline-block text-sm font-semibold text-text-secondary">README</span>
            </a>

            {/* About */}
            <button
              type="button"
              onClick={handleAbout}
              className="btn-icon flex items-center gap-2 px-3"
              aria-label="About EnjinSight"
            >
              <Info size={16} />
              <span className="hidden md:inline-block text-sm font-semibold text-text-secondary">About</span>
            </button>

            {/* GitHub */}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-icon flex items-center gap-2 px-3"
              aria-label="Open source on GitHub"
            >
              <Github size={16} />
              <span className="hidden md:inline-block text-sm font-semibold text-text-secondary">GitHub</span>
            </a>

            {/* Hamburger — visible below lg breakpoint */}
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              className="btn-icon lg:hidden"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Desktop pill row — only shown at lg+ where all pills fit */}
        <div className="hidden lg:flex items-center gap-3">
          {NAV_ITEMS.map(item => {
            const isActive = view === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleNav(item.key)}
                aria-current={isActive ? 'page' : undefined}
                className={`nav-link-pill whitespace-nowrap ${isActive ? 'nav-link-pill-active' : 'nav-link-pill-idle'}`}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Dropdown — visible below lg when menu is open */}
      {menuOpen && (
        <div className="lg:hidden border-t border-white/5 bg-ink/95 backdrop-blur-2xl px-4 py-3 flex flex-col gap-1">
          {NAV_ITEMS.map(item => {
            const isActive = view === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleNav(item.key)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full text-left px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors
                  ${isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-text-secondary hover:bg-white/5 hover:text-text'}`}
              >
                {item.label}
              </button>
            )
          })}

          {/* Divider */}
          <div className="my-1 h-px bg-white/5" />

          {/* README link */}
          <a
            href={README_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-text-secondary hover:bg-white/5 hover:text-text transition-colors"
            onClick={() => setMenuOpen(false)}
          >
            <BookOpen size={15} />
            README
          </a>

          {/* About */}
          <button
            type="button"
            onClick={handleAbout}
            className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-text-secondary hover:bg-white/5 hover:text-text transition-colors text-left"
          >
            <Info size={15} />
            About
          </button>

          {/* GitHub link */}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold text-text-secondary hover:bg-white/5 hover:text-text transition-colors"
            onClick={() => setMenuOpen(false)}
          >
            <Github size={15} />
            GitHub
          </a>
        </div>
      )}
    </header>
  )
}
