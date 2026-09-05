/**
 * ResultsFilterBar — search, status, missed-era range and sort for the
 * Staking Cadence result grids.
 *
 * Presentational only: every decision about which rows survive lives in
 * `utils/stakingFilter.js`, and the filter state itself lives in App.jsx,
 * because the same filter narrows the card grid, the summary section and the
 * export. One bar serves both modes — the option lists come from the util,
 * keyed on `mode`, rather than this file knowing what a pool state is.
 */
import { Search, ArrowDown, ArrowUp, X } from 'lucide-react'
import Field from './Field.jsx'
import {
  EMPTY_STAKING_FILTER, statusesFor, sortsFor, isStakingFilterActive,
} from '../utils/stakingFilter.js'

/**
 * @param {object} props
 * @param {'validators'|'pools'} props.mode
 * @param {object} props.value - filter state, shape of EMPTY_STAKING_FILTER.
 * @param {(next: object) => void} props.onChange - receives the whole next filter.
 * @param {number} props.total - records before filtering.
 * @param {number} props.shown - records after filtering.
 * @param {string} props.idPrefix - namespaces control ids; both modes can be mounted.
 */
export default function ResultsFilterBar({ mode, value, onChange, total, shown, idPrefix }) {
  const filter = value ?? EMPTY_STAKING_FILTER
  const active = isStakingFilterActive(filter)
  const set = patch => onChange({ ...filter, ...patch })

  const sortLabel = sortsFor(mode).find(s => s.key === filter.sortKey)?.label ?? 'Scan order'
  const ascending = filter.sortDir === 'asc'

  return (
    <div className="data-toolbar !mb-0 rounded-sm border border-[var(--hairline)] bg-card px-3 py-2.5">
      <Field
        label={mode === 'validators' ? 'Search validators' : 'Search pools'}
        id={`${idPrefix}-filter-search`}
        type="search"
        variant="search"
        icon={<Search size={14} />}
        className="min-w-0 md:min-w-[13rem] md:flex-1 md:max-w-xs"
        value={filter.search}
        onChange={e => set({ search: e.target.value })}
        autoComplete="off"
        spellCheck="false"
        placeholder={mode === 'validators' ? 'Name or address' : 'Name, ID or stash'}
      />

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        Status
        <select
          id={`${idPrefix}-filter-status`}
          className="select-compact"
          value={filter.status}
          onChange={e => set({ status: e.target.value })}
        >
          {statusesFor(mode).map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
        <span>Missed eras</span>
        <input
          type="number"
          min="0"
          inputMode="numeric"
          className="input-field w-16 font-mono !rounded-sm !px-2 !py-1 !text-[11px]"
          placeholder="Min"
          aria-label="Minimum missed era count"
          value={filter.missedMin}
          onChange={e => set({ missedMin: e.target.value })}
        />
        <span aria-hidden="true">–</span>
        <input
          type="number"
          min="0"
          inputMode="numeric"
          className="input-field w-16 font-mono !rounded-sm !px-2 !py-1 !text-[11px]"
          placeholder="Max"
          aria-label="Maximum missed era count"
          value={filter.missedMax}
          onChange={e => set({ missedMax: e.target.value })}
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        Sort
        <select
          id={`${idPrefix}-filter-sort`}
          className="select-compact"
          value={filter.sortKey}
          onChange={e => set({ sortKey: e.target.value })}
        >
          {sortsFor(mode).map(({ key, label }) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </label>

      {/* Direction is meaningless in scan order, so it only appears once a
          sort key is chosen rather than sitting there doing nothing. */}
      {filter.sortKey !== 'default' && (
        <button
          type="button"
          onClick={() => set({ sortDir: ascending ? 'desc' : 'asc' })}
          className="btn-ghost gap-1"
          aria-label={`${sortLabel}: sorted ${ascending ? 'ascending' : 'descending'}. Reverse the order.`}
        >
          {ascending ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
          {ascending ? 'Asc' : 'Desc'}
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <span className="mini-chip" role="status" aria-live="polite">
          {active
            ? `${shown.toLocaleString('en')} / ${total.toLocaleString('en')} shown`
            : `${total.toLocaleString('en')} total`}
        </span>
        {active && (
          <button
            type="button"
            onClick={() => onChange({ ...EMPTY_STAKING_FILTER })}
            className="btn-ghost gap-1"
          >
            <X size={13} />
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
