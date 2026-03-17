/**
 * BalanceTable — sortable balance history table.
 *
 * Security: all cell content is rendered via React's JSX pipeline (auto-escaped).
 * Block hashes are validated before display and truncated; full values are
 * stored in a tooltip only.
 */
import { useState, useMemo } from 'react'
import { fmtENJ } from '../utils/balanceExport.js'
import { isValidBlockHash } from '../utils/substrate.js'

const ZOOM_SIZES = ['text-xs', 'text-sm', 'text-base']
const DEFAULT_ZOOM = 0

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

export default function BalanceTable({ records }) {
  const [sortCol, setSortCol] = useState('block')
  const [sortDir, setSortDir] = useState(-1)  // -1 = desc (newest first)
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_ZOOM)

  const isNewFormat = records.some(d => d.newFormat)

  function handleSort(key) {
    if (sortCol === key) {
      setSortDir(d => -d)
    } else {
      setSortCol(key)
      setSortDir(1)
    }
  }

  const sorted = useMemo(() => {
    return [...records].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol]
      if (typeof av === 'bigint') return av < bv ? -sortDir : av > bv ? sortDir : 0
      return av < bv ? -sortDir : av > bv ? sortDir : 0
    })
  }, [records, sortCol, sortDir])

  const textSize = ZOOM_SIZES[zoomIdx]

  const colLabel = (col) => {
    if (col.key === 'miscFrozen' && isNewFormat) return 'Frozen (ENJ)'
    if (col.key === 'feeFrozen'  && isNewFormat) return 'Fee Frozen (n/a)'
    return col.label
  }

  return (
    <div className="card p-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
          <h3 className="text-xs font-bold tracking-widest uppercase text-cyan">Balance History</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-dim">
            {records.length.toLocaleString('en')} records
          </span>
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
      <div className="overflow-x-auto max-h-[440px] border border-border rounded-lg">
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
            {sorted.map((d, idx) => {
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
    </div>
  )
}
