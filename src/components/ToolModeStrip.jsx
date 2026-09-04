/**
 * ToolModeStrip — the Query | Import selector every tool with an import shares.
 *
 * Balance Viewer and Reward History each had a byte-for-byte copy of this
 * markup (same classes, same inline `boxShadow`), and the Staking Cadence and
 * Infusion tools had no strip at all — they showed their import panel inline
 * instead. One component, used by all four, is what makes the four behave the
 * same way.
 *
 * The extraction also adds the tab semantics none of the copies had: the
 * buttons were plain `<button>`s, so a screen reader announced four unrelated
 * controls rather than a two-item tablist with one selected.
 */
import { Server, Upload } from 'lucide-react'

/** The two modes, in order. `queryLabel` is per-tool; Import never varies. */
export function modeTabs(queryLabel) {
  return [
    { key: 'query',  label: queryLabel,   icon: Server },
    { key: 'import', label: 'Import Data', icon: Upload },
  ]
}

/**
 * @param {object} props
 * @param {string} props.queryLabel - e.g. "Query Node", "Compute Rewards", "Scan".
 * @param {'query'|'import'} props.value
 * @param {(next: 'query'|'import') => void} props.onChange
 * @param {string} props.idPrefix - namespaces the tab/panel ids when more than
 *   one strip could exist in the document.
 */
export default function ToolModeStrip({ queryLabel, value, onChange, idPrefix }) {
  return (
    <div
      role="tablist"
      aria-label="Data source"
      className="flex w-full gap-1 overflow-x-auto rounded-sm border border-[var(--hairline)] bg-card p-1"
    >
      {modeTabs(queryLabel).map(({ key, label, icon: Icon }) => {
        const selected = value === key
        return (
          <button
            key={key}
            id={`${idPrefix}-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${key}`}
            onClick={() => onChange(key)}
            className={`flex min-w-[6rem] flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors sm:gap-2 sm:px-3 sm:text-[13px] ${
              selected
                ? 'bg-primary/15 text-primary-glow'
                : 'text-text-secondary hover:bg-surface-high hover:text-text'
            }`}
            style={{
              fontFamily: 'JetBrains Mono, ui-monospace, monospace',
              ...(selected ? { boxShadow: 'inset 0 0 0 1px rgba(124, 58, 237, 0.35)' } : {}),
            }}
          >
            <Icon size={13} />
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
