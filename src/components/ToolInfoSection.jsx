import { useState } from 'react'
import { ChevronDown, ChevronUp, Info } from 'lucide-react'

/**
 * Collapsible "Read tool info" panel — uniform notes container shared across
 * tool pages. Replaces ad-hoc Query/Important/Wallet-Scan notice cards.
 */
export default function ToolInfoSection({
  label = 'Read tool info',
  defaultOpen = false,
  children,
  tone = 'cyan',
}) {
  const [open, setOpen] = useState(defaultOpen)

  const toneClass = tone === 'warning'
    ? 'text-warning'
    : tone === 'primary'
      ? 'text-primary'
      : 'text-cyan'

  return (
    <section className="overflow-hidden rounded-sm border border-[var(--hairline)] bg-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-high sm:px-4"
        aria-expanded={open}
      >
        <Info size={13} className={`flex-shrink-0 ${toneClass}`} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text" style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace' }}>
          {label}
        </span>
        <span className="ml-auto text-muted" aria-hidden="true">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--hairline)] px-3 py-3 text-xs leading-snug text-text-secondary animate-fade-in sm:px-4 sm:text-sm sm:leading-6">
          {children}
        </div>
      )}
    </section>
  )
}
