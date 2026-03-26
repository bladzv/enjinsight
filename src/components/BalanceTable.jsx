/**
 * BalanceTable — sortable, paginated balance history table.
 *
 * Security: all cell content is rendered via React's JSX pipeline (auto-escaped).
 * Block hashes are validated before display and truncated; full values are
 * stored in a tooltip only.
 */
import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtENJ } from '../utils/balanceExport.js'
import { isValidBlockHash } from '../utils/substrate.js'

const ZOOM_SIZES = ['text-xs', 'text-sm', 'text-base']
const DEFAULT_ZOOM = 0

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250]

const COLS = [
  { key: 'block',      label: 'Block',              align: 'left'  },
  { key: 'blockHash',  label: 'Hash',               align: 'left'  },
  { key: 'free',       label: 'Free (ENJ)',          align: 'right' },
  { key: 'reserved',   label: 'Reserved (ENJ)',      align: 'right' },
  { key: 'miscFrozen', label: 'Misc Frozen (ENJ)',   align: 'right' },
  { key: 'feeFrozen',  label: 'Fee Frozen (ENJ)',    align: 'right' },
]

function colValue(d, col, isNewFormat) {
  if (col === 'miscFrozen' && isNewFormat) return 'frozen'
  if (col === 'feeFrozen'  && isNewFormat) return 'n/a'
  return d[col]
}

function truncHash(h) { return `${h.slice(0, 10)}…${h.slice(-8)}` }

export default function BalanceTable({ records, isLoading = false }) {
  const [sortCol, setSortCol] = useState('block')
  const [sortDir, setSortDir] = useState(-1)  // -1 = desc (newest first)
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_ZOOM)
  const [page,    setPage]    = useState(1)
  const [pageSize, setPageSize] = useState(25)

  const isNewFormat = records.some(d => d.newFormat)

  function handleSort(key) {
    if (sortCol === key) {
      setSortDir(d => -d)
    } else {
      setSortCol(key)
      setSortDir(1)
    }
    setPage(1)
  }

  const sorted = useMemo(() => {
    return [...records].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol]
      if (typeof av === 'bigint') return av < bv ? -sortDir : av > bv ? sortDir : 0
      return av < bv ? -sortDir : av > bv ? sortDir : 0
    })
  }, [records, sortCol, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage   = Math.min(page, totalPages)
  const pageSlice  = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  const textSize = ZOOM_SIZES[zoomIdx]

  const colLabel = (col) => {
    if (col.key === 'miscFrozen' && isNewFormat) return 'Frozen (ENJ)'
    if (col.key === 'feeFrozen'  && isNewFormat) return 'Fee Frozen (n/a)'
    return col.label
  }

  return (
    <div className="card p-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
          <h3 className="text-xs font-bold tracking-widest uppercase text-cyan">Balance History</h3>
          {isLoading && (
            <span className="text-[10px] text-cyan animate-pulse font-mono">Populating…</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-mono text-xs text-dim">
            {records.length.toLocaleString('en')} record{records.length !== 1 ? 's' : ''}
          </span>
          {/* Page size selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-dim">Per page:</span>
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
              className="bg-surface border border-border rounded px-1.5 py-0.5 text-xs text-text focus:outline-none focus:border-primary/50"
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          {/* Table zoom */}
          <div className="flex items-center gap-1" title="Table text size">
            <button
              className="w-6 h-6 rounded border border-border bg-surface text-dim text-sm font-bold
                         flex items-center justify-center hover:border-cyan hover:text-cyan transition-colors"
              onClick={() => setZoomIdx(i => Math.max(0, i - 1))}
              aria-label="Zoom out table"
              disabled={zoomIdx === 0}
            >−</button>
            <span className="font-mono text-[11px] text-dim w-9 text-center">
              {['S', 'M', 'L'][zoomIdx]}
            </span>
            <button
              className="w-6 h-6 rounded border border-border bg-surface text-dim text-sm font-bold
                         flex items-center justify-center hover:border-cyan hover:text-cyan transition-colors"
              onClick={() => setZoomIdx(i => Math.min(ZOOM_SIZES.length - 1, i + 1))}
              aria-label="Zoom in table"
              disabled={zoomIdx === ZOOM_SIZES.length - 1}
            >+</button>
            <button
              className="w-6 h-6 rounded border border-border bg-surface text-[10px] text-dim font-bold
                         flex items-center justify-center hover:border-cyan hover:text-cyan transition-colors"
              onClick={() => setZoomIdx(DEFAULT_ZOOM)}
              aria-label="Reset table zoom"
            >⊙</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className={`w-full border-collapse ${textSize}`}>
          <thead className="sticky top-0 z-10">
            <tr>
              {COLS.map(col => {
                const isSorted = sortCol === col.key
                return (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`bg-surface border-b border-border px-3 py-2 font-bold tracking-widest
                                uppercase cursor-pointer select-none whitespace-nowrap transition-colors
                                text-[calc(1em*0.79)] ${col.align === 'right' ? 'text-right' : 'text-left'}
                                ${isSorted ? 'text-cyan' : 'text-dim hover:text-cyan'}`}
                    aria-sort={isSorted ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}
                  >
                    {colLabel(col)}
                    {isSorted && (sortDir === 1 ? ' ↑' : ' ↓')}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={COLS.length} className="px-3 py-8 text-center text-dim text-sm">
                  {isLoading ? 'Fetching balance data…' : 'No records yet.'}
                </td>
              </tr>
            ) : pageSlice.map((d, idx) => {
              const safeHash = isValidBlockHash(d.blockHash) ? d.blockHash : ''
              return (
                <tr key={`${d.block}-${idx}`} className="hover:bg-surface/50 transition-colors">
                  <td className="px-3 py-2 border-b border-border/40 font-semibold text-text whitespace-nowrap font-mono">
                    {d.block.toLocaleString('en')}
                  </td>
                  <td className="px-3 py-2 border-b border-border/40 whitespace-nowrap">
                    {safeHash
                      ? (
                        <span
                          className="text-dim cursor-pointer hover:text-cyan transition-colors font-mono"
                          title={safeHash}
                        >
                          {truncHash(safeHash)}
                        </span>
                      )
                      : <span className="text-muted">—</span>
                    }
                  </td>
                  <td className="px-3 py-2 border-b border-border/40 text-cyan font-mono text-right whitespace-nowrap">
                    {fmtENJ(d.free)}
                  </td>
                  <td className="px-3 py-2 border-b border-border/40 text-[#ffc400] font-mono text-right whitespace-nowrap">
                    {fmtENJ(d.reserved)}
                  </td>
                  <td className="px-3 py-2 border-b border-border/40 text-[#ff7a35] font-mono text-right whitespace-nowrap">
                    {fmtENJ(d.miscFrozen)}
                  </td>
                  <td className={`px-3 py-2 border-b border-border/40 font-mono whitespace-nowrap
                    ${d.newFormat ? 'text-center text-muted' : 'text-right text-[#ff2d78]'}`}>
                    {d.newFormat ? 'N/A' : fmtENJ(d.feeFrozen)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {records.length > pageSize && (
        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
          <span className="text-xs text-dim font-mono">
            Page {safePage} of {totalPages}
            {' · '}
            Rows {((safePage - 1) * pageSize + 1).toLocaleString('en')}–{Math.min(safePage * pageSize, sorted.length).toLocaleString('en')}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={safePage === 1}
              className="px-2 py-1 rounded border border-border bg-surface text-xs text-dim
                         hover:text-cyan hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="First page"
            >«</button>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="px-2 py-1 rounded border border-border bg-surface text-xs text-dim
                         hover:text-cyan hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft size={12} />
            </button>
            {/* Page number pills */}
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let p
              if (totalPages <= 5) {
                p = i + 1
              } else if (safePage <= 3) {
                p = i + 1
              } else if (safePage >= totalPages - 2) {
                p = totalPages - 4 + i
              } else {
                p = safePage - 2 + i
              }
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-7 h-7 rounded text-xs font-mono transition-colors
                    ${p === safePage
                      ? 'bg-primary text-white border border-primary'
                      : 'border border-border bg-surface text-dim hover:text-cyan hover:border-primary/40'}`}
                  aria-label={`Page ${p}`}
                  aria-current={p === safePage ? 'page' : undefined}
                >
                  {p}
                </button>
              )
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="px-2 py-1 rounded border border-border bg-surface text-xs text-dim
                         hover:text-cyan hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Next page"
            >
              <ChevronRight size={12} />
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={safePage === totalPages}
              className="px-2 py-1 rounded border border-border bg-surface text-xs text-dim
                         hover:text-cyan hover:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              aria-label="Last page"
            >»</button>
          </div>
        </div>
      )}
    </div>
  )
}
