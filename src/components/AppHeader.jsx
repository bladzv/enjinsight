import { useEffect, useRef, useState } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap.js'
import PillSwitch from './PillSwitch.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import {
  BarChart3,
  BookOpen,
  Gem,
  Home,
  Info,
  Layers,
  LineChart,
  Menu,
  TrendingUp,
  X,
} from 'lucide-react'

// lucide-react v1 removed all brand/trademark icons (GitHub included) — see
// https://lucide.dev/guide/version-1. Inlined here rather than pulling in a
// new icon package for a single glyph. Matches the size/className props the
// lucide icon components accept; strokeWidth is accepted for API parity with
// ExternalRailLink's other icons but unused since this is a filled mark.
function GithubIcon({ size = 15, className = '', strokeWidth: _strokeWidth, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56 0-.27-.01-1.16-.02-2.11-3.2.7-3.88-1.35-3.88-1.35-.52-1.34-1.28-1.69-1.28-1.69-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.76.12 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.41-5.27 5.69.42.36.78 1.07.78 2.16 0 1.56-.01 2.82-.01 3.2 0 .32.21.68.8.56A10.99 10.99 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5Z" />
    </svg>
  )
}

// Option table for the rail's Mode switch. Declared at module scope so the
// array is referentially stable — PillSwitch measures its options on every
// render pass that changes them, and a fresh array each render would thrash
// that measurement.
const UI_MODE_OPTIONS = [
  { value: 'simple', label: 'Simple' },
  { value: 'advanced', label: 'Advanced' },
]

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
const BRAND_LOGO_URL = '/assets/brand/enjinsight-wordmark-512.png'

/**
 * Sidebar navigation rail. The component is still named AppHeader to keep
 * the existing import path stable, but the visual + structural role is now
 * a persistent left-rail with a slide-out drawer below the lg breakpoint.
 */
export default function AppHeader({ status, view, onNavigate, onAbout, theme = 'dark', onToggleTheme, onThemeChange, simpleMode = false, onSimpleModeChange }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const drawerRef = useRef(null)
  const isLoading = status === 'loading'

  // Traps Tab within the drawer while open and returns focus to the hamburger
  // button on close — the drawer previously had no keyboard containment at all.
  useFocusTrap(drawerRef, mobileOpen)

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

  function selectTheme(nextTheme) {
    if (typeof onThemeChange === 'function') {
      onThemeChange(nextTheme)
      return
    }
    if (typeof onToggleTheme === 'function') onToggleTheme()
  }

  const tools = NAV_ITEMS.filter(item => item.group === 'tools')
  const workspace = NAV_ITEMS.filter(item => item.group === 'workspace')

  return (
    <>
      {/* ── Desktop rail ───────────────────────────────────────────── */}
      <aside className="rail hidden lg:flex lg:flex-col" aria-label="Primary">
        {/* The rail's own header. It used to live inside RailContent behind a
            `mobile` flag; it is lifted out so both it and the drawer header
            can host the theme toggle without RailContent having to carry the
            theme props through purely to hand them back. */}
        <div className="flex items-center justify-between px-4 py-4" style={{ borderBottom: '1px solid var(--hairline)' }}>
          <BrandMark loading={isLoading} />
          <ThemeToggle theme={theme} onChange={selectTheme} />
        </div>

        <RailContent
          view={view}
          isLoading={isLoading}
          tools={tools}
          workspace={workspace}
          onNavigate={handleNav}
          onAbout={handleAbout}
          simpleMode={simpleMode}
          onSimpleModeChange={onSimpleModeChange}
        />
      </aside>

      {/* ── Mobile top header (only below lg) ───────────────────────── */}
      <header
        className="lg:hidden sticky top-0 z-40 flex items-center gap-0 px-4 py-2.5 backdrop-blur-xl"
        style={{ borderBottom: '1px solid var(--hairline)', background: 'color-mix(in srgb, var(--surface) 88%, transparent)' }}
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="btn-icon"
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
        >
          <Menu size={18} />
        </button>

        <button
          type="button"
          onClick={() => handleNav('home')}
          className="flex items-center"
          aria-label="Go to home"
        >
          <BrandMark loading={isLoading} />
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
          <aside ref={drawerRef} tabIndex={-1} role="dialog" aria-modal="true" className="rail-mobile-drawer lg:hidden" aria-label="Primary navigation">
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--hairline)' }}>
              <button
                type="button"
                onClick={() => handleNav('home')}
                className="flex items-center"
                aria-label="Go to home"
              >
                <BrandMark loading={isLoading} />
              </button>
              <div className="flex items-center gap-1">
                <ThemeToggle theme={theme} onChange={selectTheme} />
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="btn-icon"
                  aria-label="Close navigation"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="px-2 py-3">
              <RailContent
                view={view}
                isLoading={isLoading}
                tools={tools}
                workspace={workspace}
                onNavigate={handleNav}
                onAbout={handleAbout}
                simpleMode={simpleMode}
                onSimpleModeChange={onSimpleModeChange}
              />
            </div>
          </aside>
        </>
      )}
    </>
  )
}

function RailContent({ view, isLoading, tools, workspace, onNavigate, onAbout, simpleMode = false, onSimpleModeChange }) {
  return (
    <>
      <nav className="px-2 py-3" aria-label="Workspace">
        <p className="rail-section-label">Workspace</p>
        <ul className="mt-1 space-y-0.5">
          {workspace.map(item => (
            <li key={item.key}>
              <RailLink
                item={item}
                active={view === item.key}
                locked={isLoading}
                onClick={() => onNavigate(item.key)}
              />
            </li>
          ))}
        </ul>
      </nav>

      <section className="px-2 pb-3" aria-label="UI mode">
        <div className="space-y-2 px-1">
          <p className="rail-section-label px-2">Mode</p>
          <PillSwitch
            ariaLabel="UI mode switch"
            value={simpleMode ? 'simple' : 'advanced'}
            onChange={(next) => onSimpleModeChange?.(next === 'simple')}
            options={UI_MODE_OPTIONS}
          />
        </div>
      </section>

      <nav className="px-2 pb-3" aria-label="Tools">
        <p className="rail-section-label">Tools</p>
        <ul className="mt-1 space-y-0.5">
          {tools.map(item => (
            <li key={item.key}>
              <RailLink
                item={item}
                active={view === item.key}
                locked={isLoading}
                onClick={() => onNavigate(item.key)}
              />
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-auto" />

      <div className="px-2 py-3" style={{ borderTop: '1px solid var(--hairline)' }}>
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
            <ExternalRailLink href={GITHUB_URL} icon={GithubIcon}>GitHub</ExternalRailLink>
          </li>
        </ul>


      </div>
    </>
  )
}

function RailLink({ item, active, locked = false, onClick }) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      // aria-disabled, not the disabled attribute: a scan in progress blocks
      // navigation but the click handler still needs to run so the user gets
      // the "stop the scan first" toast — a real disabled button would take
      // the control out of the tab order and swallow the click entirely.
      aria-disabled={locked || undefined}
      className={`rail-item w-full text-left ${active ? 'rail-item-active' : ''} ${locked ? 'opacity-60' : ''}`}
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

const ICON_LOGO_URL = '/assets/brand/enjinsight-logo-128.png'

function BrandMark({ loading }) {
  return (
    <div className="relative flex items-center gap-2">
      <div className="relative">
        <img src={ICON_LOGO_URL} alt="" aria-hidden="true" className="h-6 w-6 shrink-0" />
        {loading && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary shadow-primary-glow animate-pulse" />
        )}
      </div>
      <img src={BRAND_LOGO_URL} alt="EnjinSight" className="h-[1.8rem] w-auto" />
    </div>
  )
}
