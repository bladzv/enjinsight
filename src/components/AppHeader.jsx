import { useEffect, useState } from 'react'
import {
  BarChart3,
  BookOpen,
  Github,
  Gem,
  Home,
  Info,
  Layers,
  LineChart,
  Menu,
  TrendingUp,
  X,
} from 'lucide-react'

const NAV_ITEMS = [
  { key: 'home',           label: 'Home',            icon: Home,       group: 'workspace' },
  { key: 'era',            label: 'Era Explorer',    icon: Layers,     group: 'tools' },
  { key: 'staking',        label: 'Staking Cadence', icon: BarChart3,  group: 'tools' },
  { key: 'balance',        label: 'Balance Viewer',  icon: LineChart,  group: 'tools' },
  { key: 'reward-history', label: 'Reward History',  icon: TrendingUp, group: 'tools' },
  { key: 'infusion',       label: 'ENJ Infusion',    icon: Gem,        group: 'tools' },
]

const GITHUB_URL = 'https://github.com/bladzv/enjinsight'
const README_URL = 'https://github.com/bladzv/enjinsight#readme'
const BRAND_LOGO_URL = '/assets/brand/enjinsight_brand.png'

/**
 * Sidebar navigation rail. The component is still named AppHeader to keep
 * the existing import path stable, but the visual + structural role is now
 * a persistent left-rail with a slide-out drawer below the lg breakpoint.
 */
export default function AppHeader({ status, view, onNavigate, onAbout }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const isLoading = status === 'loading'

  // Close drawer on Escape
  useEffect(() => {
    if (!mobileOpen) return
    function onKey(e) { if (e.key === 'Escape') setMobileOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileOpen])

  function handleNav(key) {
    setMobileOpen(false)
    onNavigate?.(key)
  }

  function handleAbout() {
    setMobileOpen(false)
    onAbout?.()
  }

  const tools = NAV_ITEMS.filter(item => item.group === 'tools')
  const workspace = NAV_ITEMS.filter(item => item.group === 'workspace')

  return (
    <>
      {/* ── Desktop rail ───────────────────────────────────────────── */}
      <aside className="rail hidden lg:flex lg:flex-col" aria-label="Primary">
        <RailContent
          view={view}
          isLoading={isLoading}
          tools={tools}
          workspace={workspace}
          onNavigate={handleNav}
          onAbout={handleAbout}
        />
      </aside>

      {/* ── Mobile top header (only below lg) ───────────────────────── */}
      <header className="lg:hidden sticky top-0 z-40 flex items-center justify-between border-b border-white/[0.06] bg-ink/85 px-4 py-2.5 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => handleNav('home')}
          className="flex items-center"
          aria-label="Go to home"
        >
          <BrandMark loading={isLoading} />
        </button>

        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="btn-icon"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
        >
          <Menu size={18} />
        </button>
      </header>

      {/* ── Mobile drawer ────────────────────────────────────────────── */}
      {mobileOpen && (
        <>
          <div
            className="rail-mobile-overlay lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="rail-mobile-drawer lg:hidden" aria-label="Primary">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <button
                type="button"
                onClick={() => handleNav('home')}
                className="flex items-center"
                aria-label="Go to home"
              >
                <BrandMark loading={isLoading} />
              </button>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="btn-icon"
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-2 py-3">
              <RailContent
                view={view}
                isLoading={isLoading}
                tools={tools}
                workspace={workspace}
                onNavigate={handleNav}
                onAbout={handleAbout}
                mobile
              />
            </div>
          </aside>
        </>
      )}
    </>
  )
}

function RailContent({ view, isLoading, tools, workspace, onNavigate, onAbout, mobile = false }) {
  return (
    <>
      {!mobile && (
        <div className="flex items-center px-4 py-4 border-b border-white/[0.06]">
          <BrandMark loading={isLoading} />
        </div>
      )}

      <nav className="px-2 py-3" aria-label="Workspace">
        <p className="rail-section-label">Workspace</p>
        <ul className="mt-1 space-y-0.5">
          {workspace.map(item => (
            <li key={item.key}>
              <RailLink
                item={item}
                active={view === item.key}
                onClick={() => onNavigate(item.key)}
              />
            </li>
          ))}
        </ul>
      </nav>

      <nav className="px-2 pb-3" aria-label="Tools">
        <p className="rail-section-label">Tools</p>
        <ul className="mt-1 space-y-0.5">
          {tools.map(item => (
            <li key={item.key}>
              <RailLink
                item={item}
                active={view === item.key}
                onClick={() => onNavigate(item.key)}
              />
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-auto" />

      <div className="px-2 py-3 border-t border-white/[0.06]">
        <p className="rail-section-label">Resources</p>
        <ul className="mt-1 space-y-0.5">
          <li>
            <ExternalRailLink href={README_URL} icon={BookOpen}>README</ExternalRailLink>
          </li>
          <li>
            <button
              type="button"
              onClick={onAbout}
              className="rail-item w-full text-left"
            >
              <Info size={15} strokeWidth={2} className="shrink-0 opacity-80" />
              <span className="flex-1 truncate">About</span>
            </button>
          </li>
          <li>
            <ExternalRailLink href="https://github.com/bladzv/enjinsight" icon={Github}>GitHub</ExternalRailLink>
          </li>
        </ul>


      </div>
    </>
  )
}

function RailLink({ item, active, onClick }) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`rail-item w-full text-left ${active ? 'rail-item-active' : ''}`}
    >
      <Icon size={15} strokeWidth={2} className="shrink-0 opacity-90" />
      <span className="flex-1 truncate">{item.label}</span>
    </button>
  )
}

function ExternalRailLink({ href, icon: Icon, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="rail-item w-full"
    >
      <Icon size={15} strokeWidth={2} className="shrink-0 opacity-80" />
      <span className="flex-1 truncate">{children}</span>
      <span aria-hidden="true" className="text-[10px] text-muted">↗</span>
    </a>
  )
}

const ICON_LOGO_URL = '/android-chrome-192x192.png'

function BrandMark({ loading }) {
  return (
    <div className="relative flex items-center gap-2.5">
      <div className="relative flex h-8 w-8 items-center justify-center rounded-sm bg-card ring-1 ring-white/[0.08]">
        <img src={ICON_LOGO_URL} alt="" aria-hidden="true" className="h-5 w-5" />
        {loading && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary shadow-primary-glow animate-pulse" />
        )}
      </div>
      <img src={BRAND_LOGO_URL} alt="EnjinSight" className="h-7 w-auto" />
    </div>
  )
}
