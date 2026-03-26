/**
 * RewardHistoryViewer — Reward history computation for Enjin staking pools.
 *
 * Features:
 * - Compute rewards via Archive RPC (Subscan only for optional history pool discovery)
 * - Era range OR date range input with quick presets
 * - Unified interactive table (all eras × pools), filterable + sortable
 * - Line chart reactive to table filters
 * - Summary aggregation section
 * - Export as JSON / CSV / XML (optionally encrypted)
 * - Import previously exported reward data
 * - Sticky terminal log
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  TrendingUp, Play, Square, RotateCcw, Download, Upload,
  ChevronDown, ChevronUp, Lock, Unlock, FolderOpen,
  AlertTriangle, Calendar, Server,
} from 'lucide-react'
import { useRewardHistory, RH_STATUS } from '../hooks/useRewardHistory.js'
import TerminalLog from './TerminalLog.jsx'
import { PLANCK_PER_ENJ } from '../constants.js'
import { aesEncrypt, downloadFile, safeFilename } from '../utils/balanceExport.js'
import { MAX_IMPORT_MB } from '../constants.js'

// ── Era-CSV date helpers (copied from BalanceExplorer) ───────────────────────
let _eraCache = null
async function loadEraDataRH() {
  if (_eraCache) return _eraCache
  const resp = await fetch('/relay-era-reference.csv')
  const text = await resp.text()
  const lines = text.trim().split('\n').slice(1)
  _eraCache = lines.map(line => {
    const p = line.split(',')
    return {
      era:        parseInt(p[0], 10),
      startBlock: parseInt(p[1], 10),
      endBlock:   parseInt(p[2], 10) || null,
      startTs:    parseInt(p[4], 10) || null,
      endTs:      parseInt(p[6], 10) || null,
    }
  }).filter(r => !isNaN(r.era) && !isNaN(r.startBlock))
  return _eraCache
}

function findErasForDateRange(eraData, startDateStr, endDateStr) {
  const startMs = new Date(startDateStr).getTime()
  const endMs   = new Date(endDateStr).getTime() + 86_400_000 - 1

  // Only match rows with a valid (non-zero) timestamp to avoid null/0 entries
  // being treated as Jan 1 1970 and always satisfying the <= comparison.
  let startEra = null
  for (let i = eraData.length - 1; i >= 0; i--) {
    const ts = eraData[i].startTs
    if (ts && ts * 1000 <= startMs) { startEra = eraData[i]; break }
  }
  if (!startEra) startEra = eraData[0]  // fallback: oldest known era

  let endEra = null
  for (let i = eraData.length - 1; i >= 0; i--) {
    const ts = eraData[i].startTs
    if (ts && ts * 1000 <= endMs) { endEra = eraData[i]; break }
  }
  if (!endEra) endEra = eraData[eraData.length - 1]  // fallback: newest known era

  // Extend endEra if endDate falls beyond the last CSV era's coverage.
  // useRewardHistory phase 1.5 will binary-search the actual block boundaries
  // for these extra eras; eras beyond the current chain era are skipped with a WARN.
  const lastRow = eraData[eraData.length - 1]
  if (lastRow?.startTs) {
    const lastCoverageMs = (lastRow.endTs ?? (lastRow.startTs + 86400)) * 1000
    if (endMs > lastCoverageMs) {
      const extraEras = Math.ceil((endMs - lastCoverageMs) / 86_400_000)
      endEra = { era: lastRow.era + extraEras }
    }
  }

  return { startEra: startEra.era, endEra: endEra.era }
}

function toDateInput(d) { return d.toISOString().slice(0, 10) }

const DATE_PRESETS = [
  { label: '1 week',   days: 7   },
  { label: '1 month',  days: 30  },
  { label: '3 months', days: 90  },
  { label: '6 months', days: 180 },
  { label: '1 year',   days: 365 },
]

// ── Formatting helpers ───────────────────────────────────────────────────────
function fmtEnj(planck) {
  if (!planck && planck !== 0n) return '—'
  if (typeof planck === 'string') {
    try { planck = BigInt(planck) } catch { return '—' }
  }
  if (planck === 0n) return '0.000000'
  const whole = planck / PLANCK_PER_ENJ
  const frac  = String(planck % PLANCK_PER_ENJ).padStart(18, '0').slice(0, 6)
  return `${whole.toLocaleString()}.${frac}`
}
function fmtApy(apy) {
  if (!Number.isFinite(apy) || apy <= 0) return '—'
  return `${apy.toFixed(2)}%`
}
function fmtDate(utcStr) {
  if (!utcStr) return '—'
  try { return new Date(utcStr).toISOString().slice(0, 10) } catch { return utcStr }
}

// ── Reward CSV/JSON export utilities ────────────────────────────────────────
function rewardToObj(r) {
  return {
    era:             r.era,
    pool_id:         r.poolId,
    pool_label:      r.poolLabel,
    era_start_block: r.eraStartBlock ?? '',
    era_date_utc:    (r.eraStartDateUtc ?? '').slice(0, 10) || '',
    member_senj:     String(r.memberBalance),
    pool_supply_senj:String(r.poolSupply),
    reinvested_enj:  String(r.reinvested),
    reward_enj:      String(r.reward),
    cumulative_enj:  String(r.accumulated),
    apy_pct:         r.apy.toFixed(4),
  }
}

function rewardToJSON(results, meta) {
  return JSON.stringify({
    _meta: meta,
    records: results.map(rewardToObj),
  }, null, 2)
}

function rewardToCSV(results, meta) {
  const H = Object.keys(rewardToObj(results[0] || {}))
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const comments = [
    '# enjin_reward_history_export',
    `# address: ${meta.address ?? ''}`,
    `# exportedAt: ${meta.exportedAt}`,
  ]
  return [
    ...comments,
    H.join(','),
    ...results.map(r => { const o = rewardToObj(r); return H.map(k => esc(o[k])).join(',') }),
  ].join('\r\n')
}

function rewardToXML(results, meta) {
  const ex = v =>
    String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
  const metaXml = `  <meta>\n    <address>${ex(meta.address ?? '')}</address>\n    <exportedAt>${ex(meta.exportedAt)}</exportedAt>\n  </meta>`
  const rows = results.map(r => {
    const o = rewardToObj(r)
    return '  <record>\n' + Object.entries(o).map(([k, v]) => `    <${k}>${ex(v)}</${k}>`).join('\n') + '\n  </record>'
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<enjinRewardHistory>\n${metaXml}\n${rows}\n</enjinRewardHistory>`
}

/** Parse imported reward JSON/CSV back into result rows */
function parseRewardImport(text, ext) {
  if (ext === 'json') {
    let parsed
    try { parsed = JSON.parse(text) } catch { throw new Error('JSON parse failed.') }
    const arr = Array.isArray(parsed) ? parsed : parsed?.records
    if (!Array.isArray(arr)) throw new Error('Expected JSON array or {records:[]}.')
    const meta = parsed?._meta ?? null
    return {
      results: arr.map(r => ({
        era:             Number(r.era ?? r.Era ?? 0),
        poolId:          Number(r.pool_id ?? r.poolId ?? 0),
        poolLabel:       String(r.pool_label ?? r.poolLabel ?? ''),
        eraStartBlock:   r.era_start_block != null ? Number(r.era_start_block) : null,
        eraStartDateUtc: r.era_date_utc || r.eraStartDateUtc || null,
        memberBalance:   BigInt(String(r.member_senj ?? r.memberBalance ?? '0').replace(/[^0-9]/g, '') || '0'),
        poolSupply:      BigInt(String(r.pool_supply_senj ?? r.poolSupply ?? '0').replace(/[^0-9]/g, '') || '0'),
        reinvested:      BigInt(String(r.reinvested_enj ?? r.reinvested ?? '0').replace(/[^0-9]/g, '') || '0'),
        reward:          BigInt(String(r.reward_enj ?? r.reward ?? '0').replace(/[^0-9]/g, '') || '0'),
        accumulated:     BigInt(String(r.cumulative_enj ?? r.accumulated ?? '0').replace(/[^0-9]/g, '') || '0'),
        apy:             parseFloat(r.apy_pct ?? r.apy ?? '0') || 0,
      })),
      meta,
    }
  }
  if (ext === 'csv') {
    const allLines = text.trim().split(/\r?\n/)
    const comments  = allLines.filter(l => l.startsWith('#'))
    const dataLines = allLines.filter(l => !l.startsWith('#'))
    if (dataLines.length < 2) throw new Error('CSV has no data rows.')
    let address = ''
    comments.forEach(c => { const m = c.match(/^# address:\s*(.+)/); if (m) address = m[1].trim() })
    const headers = dataLines[0].replace(/"/g, '').split(',')
    const idx = k => headers.indexOf(k)
    const results = dataLines.slice(1).map(row => {
      const c = row.replace(/"/g, '').split(',')
      const g = k => c[idx(k)] ?? ''
      return {
        era:             Number(g('era')) || 0,
        poolId:          Number(g('pool_id')) || 0,
        poolLabel:       g('pool_label'),
        eraStartBlock:   g('era_start_block') ? Number(g('era_start_block')) : null,
        eraStartDateUtc: g('era_date_utc') || null,
        memberBalance:   BigInt(g('member_senj').replace(/[^0-9]/g,'') || '0'),
        poolSupply:      BigInt(g('pool_supply_senj').replace(/[^0-9]/g,'') || '0'),
        reinvested:      BigInt(g('reinvested_enj').replace(/[^0-9]/g,'') || '0'),
        reward:          BigInt(g('reward_enj').replace(/[^0-9]/g,'') || '0'),
        accumulated:     BigInt(g('cumulative_enj').replace(/[^0-9]/g,'') || '0'),
        apy:             parseFloat(g('apy_pct')) || 0,
      }
    })
    return { results, meta: address ? { address } : null }
  }
  throw new Error('Unsupported format. Export from this app first.')
}

// ── Reward Chart (combo: bar=member sENJ, line=reward ENJ) ──────────────────
// Custom vertical-crosshair plugin for Chart.js
const crosshairPlugin = {
  id: 'rh-crosshair',
  afterDraw(chart) {
    if (!chart.tooltip?._active?.length) return
    const { ctx, scales } = chart
    const x    = chart.tooltip._active[0].element.x
    const top  = Math.min(...Object.values(scales).map(s => s.top))
    const bot  = Math.max(...Object.values(scales).map(s => s.bottom))
    ctx.save()
    ctx.beginPath()
    ctx.strokeStyle = 'rgba(0,217,255,0.45)'
    ctx.lineWidth   = 1
    ctx.setLineDash([4, 4])
    ctx.moveTo(x, top)
    ctx.lineTo(x, bot)
    ctx.stroke()
    ctx.restore()
  },
}

function RewardChart({ data }) {
  const canvasRef = useRef(null)
  const chartRef  = useRef(null)

  useEffect(() => {
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }
    if (!canvasRef.current || !data.length) return

    let destroyed = false

    // Aggregate reward ENJ by era (filters already applied by table, ignores pagination)
    const allEras = [...new Set(data.map(r => r.era))].sort((a, b) => a - b)
    const byEra = {}
    for (const r of data) {
      byEra[r.era] = (byEra[r.era] ?? 0n) + r.reward
    }
    const rwdData = allEras.map(e => Number(byEra[e]) / 1e18)

    const uniquePools = [...new Set(data.map(r => r.poolLabel))]
    const rwdLabel = uniquePools.length === 1 ? `${uniquePools[0]} — Reward ENJ` : 'Aggregated Reward ENJ'

    import('chart.js').then(({ Chart, CategoryScale, LinearScale, BarElement, Tooltip, Legend }) => {
      if (destroyed) return
      Chart.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }

      chartRef.current = new Chart(canvasRef.current, {
        type: 'bar',
        data: {
          labels: allEras,
          datasets: [{
            label:           rwdLabel,
            data:            rwdData,
            backgroundColor: 'rgba(0,217,255,0.35)',
            borderColor:     '#00d9ff',
            borderWidth:     1,
            borderRadius:    2,
          }],
        },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          interaction:         { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: true,
              labels: { color: '#A0A0C8', font: { size: 11 }, boxWidth: 14, padding: 16 },
            },
            tooltip: {
              backgroundColor: 'rgba(18,18,30,0.97)',
              borderColor:     '#2A2A45',
              borderWidth:     1,
              titleColor:      '#00d9ff',
              bodyColor:       '#A0A0C8',
              padding:         10,
              callbacks: {
                title: ctx => `Era ${ctx[0]?.label}`,
                label: ctx => ctx.raw == null ? null
                  : ` ${ctx.raw.toLocaleString('en', { minimumFractionDigits: 6, maximumFractionDigits: 6 })} ENJ`,
              },
            },
          },
          scales: {
            x: {
              ticks: { color: '#6B6B8A', font: { size: 10 }, maxTicksLimit: 14 },
              grid:  { color: 'rgba(255,255,255,0.04)' },
              title: { display: true, text: 'Era', color: '#6B6B8A', font: { size: 11 } },
            },
            y: {
              ticks: { color: '#00d9ff', font: { size: 10 } },
              grid:  { color: 'rgba(255,255,255,0.04)' },
              title: { display: true, text: 'Reward ENJ', color: '#00d9ff', font: { size: 11 } },
            },
          },
        },
        plugins: [crosshairPlugin],
      })
    })

    return () => { destroyed = true; chartRef.current?.destroy(); chartRef.current = null }
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data.length) return null
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
        <h3 className="text-xs font-bold tracking-widest uppercase text-cyan">Reward Chart</h3>
        <span className="text-[10px] text-dim ml-1">(all filtered eras · aggregated by pool)</span>
      </div>
      <div style={{ height: '280px' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

// ── Pool multi-select dropdown ────────────────────────────────────────────────
function PoolMultiSelect({ pools, value, onChange }) {
  // value = Set<number> of included poolIds; empty Set = all included
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDown(e) { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const allSelected = value.size === 0
  const countLabel  = allSelected
    ? 'All pools'
    : `${value.size} / ${pools.length} pool${value.size !== 1 ? 's' : ''}`

  function toggle(id) {
    if (allSelected) {
      // Deselecting from "all" — start an explicit include-set without this pool
      const next = new Set(pools.map(([pid]) => pid))
      next.delete(id)
      onChange(next.size === pools.length ? new Set() : next)
    } else {
      const next = new Set(value)
      if (next.has(id)) next.delete(id)
      else              next.add(id)
      // If user re-selected all, collapse back to "all" (empty set)
      onChange(next.size === pools.length ? new Set() : next)
    }
  }

  function isChecked(id) { return allSelected || value.has(id) }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-surface border border-border rounded px-2.5 py-1 text-xs text-text hover:border-rim transition-colors min-w-[110px] justify-between"
      >
        <span className={allSelected ? 'text-dim' : 'text-cyan font-semibold'}>{countLabel}</span>
        <ChevronDown size={10} className={`text-dim transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 min-w-[200px] max-h-64 overflow-y-auto
                        bg-surface border border-border rounded-lg shadow-xl shadow-black/40 py-1">
          {/* Select All / Clear */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50">
            <button
              onClick={() => { onChange(new Set()); setOpen(false) }}
              className="text-[10px] font-bold tracking-widest uppercase text-primary hover:text-cyan transition-colors"
            >All</button>
            <span className="text-dim text-[10px]">·</span>
            <button
              onClick={() => onChange(new Set())}
              className="text-[10px] font-bold tracking-widest uppercase text-dim hover:text-danger transition-colors"
            >Reset</button>
          </div>
          {pools.map(([id, label]) => (
            <label key={id}
              className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-primary/10 transition-colors select-none">
              <input
                type="checkbox"
                checked={isChecked(id)}
                onChange={() => toggle(id)}
                className="w-3.5 h-3.5 accent-cyan cursor-pointer"
              />
              <span className="text-xs text-text truncate max-w-[150px]" title={label}>{label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Unified results table ────────────────────────────────────────────────────
const TABLE_COLS = [
  { key: 'era',          label: 'Era',            align: 'left',  sortable: true },
  { key: 'eraDate',      label: 'Date',           align: 'left',  sortable: true },
  { key: 'poolLabel',    label: 'Pool',           align: 'left',  sortable: true },
  { key: 'memberBalance',label: 'Member sENJ',    align: 'right', sortable: true },
  { key: 'reinvested',   label: 'Reinvested ENJ', align: 'right', sortable: true },
  { key: 'reward',       label: 'Reward ENJ',     align: 'right', sortable: true },
  { key: 'accumulated',  label: 'Cumulative ENJ', align: 'right', sortable: true },
  { key: 'apy',          label: 'APY',            align: 'right', sortable: true },
]

const PAGE_SIZES = [10, 25, 50, 100]

// ── RewardTable v2 — exposes filtered rows via prop ──────────────────────────
function RewardTableV2({ results, onFilter }) {
  const [sortCol, setSortCol]       = useState('era')
  const [sortDir, setSortDir]       = useState(1)
  const [filterPools, setFilterPools] = useState(new Set())   // empty = all included
  const [filterEraMin, setFilterEraMin] = useState('')
  const [filterEraMax, setFilterEraMax] = useState('')
  const [page, setPage]             = useState(1)
  const [pageSize, setPageSize]     = useState(25)

  const pools = useMemo(() => {
    const seen = new Map()
    for (const r of results) seen.set(r.poolId, r.poolLabel || `Pool #${r.poolId}`)
    return [...seen.entries()].sort((a, b) => a[0] - b[0])
  }, [results])

  function handleSort(key) {
    if (sortCol === key) setSortDir(d => -d)
    else { setSortCol(key); setSortDir(1) }
    setPage(1)
  }

  const filtered = useMemo(() => {
    let rows = results
    if (filterPools.size > 0) rows = rows.filter(r => filterPools.has(r.poolId))
    if (filterEraMin) rows = rows.filter(r => r.era >= parseInt(filterEraMin, 10))
    if (filterEraMax) rows = rows.filter(r => r.era <= parseInt(filterEraMax, 10))
    return rows.sort((a, b) => {
      let av, bv
      switch (sortCol) {
        case 'era':          av = a.era;          bv = b.era;          break
        case 'eraDate':      av = a.eraStartDateUtc ?? ''; bv = b.eraStartDateUtc ?? ''; break
        case 'poolLabel':    av = a.poolLabel;    bv = b.poolLabel;    break
        case 'memberBalance':av = a.memberBalance;bv = b.memberBalance;break
        case 'reinvested':   av = a.reinvested;   bv = b.reinvested;   break
        case 'reward':       av = a.reward;       bv = b.reward;       break
        case 'accumulated':  av = a.accumulated;  bv = b.accumulated;  break
        case 'apy':          av = a.apy;          bv = b.apy;          break
        default:             av = a.era;          bv = b.era;
      }
      if (typeof av === 'bigint' && typeof bv === 'bigint') return av < bv ? -sortDir : av > bv ? sortDir : 0
      return (av < bv ? -sortDir : av > bv ? sortDir : 0)
    })
  }, [results, sortCol, sortDir, filterPools, filterEraMin, filterEraMax])

  // Notify parent of filtered rows (for chart + summary)
  useEffect(() => { onFilter?.(filtered) }, [filtered]) // eslint-disable-line

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage   = Math.min(page, totalPages)
  const pageSlice  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="w-0.5 h-3.5 bg-cyan rounded-sm flex-shrink-0" />
        <h3 className="text-xs font-bold tracking-widest uppercase text-cyan">Reward History</h3>
        <span className="text-xs text-dim font-mono ml-1">{filtered.length} / {results.length} rows</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold tracking-widest uppercase text-dim">Pool:</span>
          <PoolMultiSelect
            pools={pools}
            value={filterPools}
            onChange={next => { setFilterPools(next); setPage(1) }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold tracking-widest uppercase text-dim">Era:</span>
          <input type="number" placeholder="Min" value={filterEraMin}
            onChange={e => { setFilterEraMin(e.target.value); setPage(1) }}
            className="w-16 bg-surface border border-border rounded px-2 py-1 text-xs text-text font-mono focus:outline-none focus:border-primary/50" />
          <span className="text-dim text-xs">–</span>
          <input type="number" placeholder="Max" value={filterEraMax}
            onChange={e => { setFilterEraMax(e.target.value); setPage(1) }}
            className="w-16 bg-surface border border-border rounded px-2 py-1 text-xs text-text font-mono focus:outline-none focus:border-primary/50" />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] font-bold tracking-widest uppercase text-dim">Per page:</span>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
            className="bg-surface border border-border rounded px-1.5 py-0.5 text-xs text-text focus:outline-none focus:border-primary/50">
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full border-collapse text-xs font-mono">
          <thead className="sticky top-0 z-10">
            <tr>
              {TABLE_COLS.map(col => {
                const isSorted = sortCol === col.key
                return (
                  <th key={col.key} onClick={() => col.sortable && handleSort(col.key)}
                    className={`bg-surface border-b border-border px-3 py-2 font-bold tracking-widest
                                uppercase select-none whitespace-nowrap transition-colors text-[calc(1em*0.79)]
                                ${col.align === 'right' ? 'text-right' : 'text-left'}
                                ${col.sortable ? 'cursor-pointer' : ''}
                                ${isSorted ? 'text-cyan' : 'text-dim hover:text-cyan'}`}>
                    {col.label}{isSorted && (sortDir === 1 ? ' ↑' : ' ↓')}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pageSlice.length === 0 ? (
              <tr><td colSpan={TABLE_COLS.length} className="px-3 py-6 text-center text-dim">No rows match filters.</td></tr>
            ) : pageSlice.map((r, i) => (
              <tr key={`${r.era}-${r.poolId}`} className={`border-b border-border/40 hover:bg-surface/50 transition-colors ${i % 2 ? 'bg-surface/20' : ''}`}>
                <td className="px-3 py-1.5 text-cyan font-bold">{r.era}</td>
                <td className="px-3 py-1.5 text-dim whitespace-nowrap">{fmtDate(r.eraStartDateUtc)}</td>
                <td className="px-3 py-1.5 text-text max-w-[150px] truncate" title={r.poolLabel}>{r.poolLabel}</td>
                <td className="px-3 py-1.5 text-right text-text">{fmtEnj(r.memberBalance)}</td>
                <td className="px-3 py-1.5 text-right text-text">{fmtEnj(r.reinvested)}</td>
                <td className="px-3 py-1.5 text-right text-success font-semibold">{fmtEnj(r.reward)}</td>
                <td className="px-3 py-1.5 text-right text-cyan">{fmtEnj(r.accumulated)}</td>
                <td className="px-3 py-1.5 text-right text-primary">{fmtApy(r.apy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {filtered.length > pageSize && (
        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
          <span className="text-xs text-dim font-mono">
            Page {safePage}/{totalPages} · {((safePage-1)*pageSize+1).toLocaleString('en')}–{Math.min(safePage*pageSize,filtered.length).toLocaleString('en')}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={safePage===1} className="px-2 py-1 rounded border border-border bg-surface text-xs text-dim hover:text-cyan disabled:opacity-40 transition-colors">«</button>
            <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={safePage===1} className="px-2 py-1 rounded border border-border bg-surface text-xs text-dim hover:text-cyan disabled:opacity-40 transition-colors">‹</button>
            {Array.from({length:Math.min(5,totalPages)},(_,i)=>{
              const p=totalPages<=5?i+1:safePage<=3?i+1:safePage>=totalPages-2?totalPages-4+i:safePage-2+i
              return <button key={p} onClick={()=>setPage(p)} className={`w-7 h-7 rounded text-xs transition-colors ${p===safePage?'bg-primary text-white border border-primary':'border border-border bg-surface text-dim hover:text-cyan'}`} aria-current={p===safePage?'page':undefined}>{p}</button>
            })}
            <button onClick={() => setPage(p=>Math.min(totalPages,p+1))} disabled={safePage===totalPages} className="px-2 py-1 rounded border border-border bg-surface text-xs text-dim hover:text-cyan disabled:opacity-40 transition-colors">›</button>
            <button onClick={() => setPage(totalPages)} disabled={safePage===totalPages} className="px-2 py-1 rounded border border-border bg-surface text-xs text-dim hover:text-cyan disabled:opacity-40 transition-colors">»</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Summary section ──────────────────────────────────────────────────────────
function RewardSummary({ results }) {
  if (!results.length) return null

  const totalReward  = results.reduce((s, r) => s + r.reward, 0n)
  const avgApy       = results.reduce((s, r) => s + r.apy, 0) / results.length
  const maxApyRow    = [...results].sort((a, b) => b.apy - a.apy)[0]
  const maxRewardRow = [...results].sort((a, b) => (b.reward > a.reward ? 1 : -1))[0]
  const poolCount    = new Set(results.map(r => r.poolId)).size
  const eraCount     = new Set(results.map(r => r.era)).size
  const eraMin       = Math.min(...results.map(r => r.era))
  const eraMax       = Math.max(...results.map(r => r.era))

  // Per-pool totals
  const byPool = new Map()
  for (const r of results) {
    const cur = byPool.get(r.poolId) ?? { label: r.poolLabel, total: 0n, rows: 0 }
    byPool.set(r.poolId, { label: cur.label, total: cur.total + r.reward, rows: cur.rows + 1 })
  }
  const bestPool = [...byPool.entries()].sort((a, b) => (b[1].total > a[1].total ? 1 : -1))[0]

  const stats = [
    { label: 'Total Reward',  value: `${fmtEnj(totalReward)} ENJ`, accent: 'text-success' },
    { label: 'Avg APY',       value: fmtApy(avgApy),               accent: 'text-primary' },
    { label: 'Era Range',     value: `${eraMin} – ${eraMax}`,      accent: 'text-text' },
    { label: 'Eras with Reward', value: eraCount,                  accent: 'text-cyan' },
    { label: 'Pools',         value: poolCount,                    accent: 'text-text' },
    { label: 'Best APY Era',  value: maxApyRow ? `Era ${maxApyRow.era} (${fmtApy(maxApyRow.apy)})` : '—', accent: 'text-warning' },
  ]

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
        <h3 className="text-xs font-bold tracking-widest uppercase text-cyan">Summary</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map(({ label, value, accent }) => (
          <div key={label} className="bg-surface/40 border border-border rounded-lg p-3 text-center">
            <p className="text-[10px] font-bold tracking-widest uppercase text-dim mb-1">{label}</p>
            <p className={`text-sm font-bold font-mono leading-tight ${accent}`}>{value}</p>
          </div>
        ))}
      </div>
      {bestPool && (
        <p className="mt-3 text-xs text-dim">
          Best pool: <span className="text-text font-semibold">{bestPool[1].label}</span>
          {' · '}{fmtEnj(bestPool[1].total)} ENJ over {bestPool[1].rows} era(s)
        </p>
      )}
    </div>
  )
}

// ── Export panel ─────────────────────────────────────────────────────────────
function RewardExportPanel({ results, address }) {
  const [filename, setFilename] = useState('')
  const [format,   setFormat]   = useState('json')
  const [encOn,    setEncOn]    = useState(false)
  const [password, setPassword] = useState('')
  const [busy,     setBusy]     = useState(false)
  const [msg,      setMsg]      = useState(null)

  async function handleExport() {
    if (!results.length) { setMsg({ type: 'err', text: 'No data to export.' }); return }
    if (encOn && !password) { setMsg({ type: 'err', text: 'Enter an encryption password.' }); return }
    setBusy(true); setMsg(null)
    try {
      const fname = filename.trim() || `reward-history-${(address || 'enjin').slice(0, 10)}-${Date.now()}`
      const meta  = { address, exportedAt: new Date().toISOString() }
      let content = format === 'json' ? rewardToJSON(results, meta)
                  : format === 'csv'  ? rewardToCSV(results, meta)
                  : rewardToXML(results, meta)
      if (encOn) {
        content = await aesEncrypt(content, password)
        downloadFile(content, `${fname}.enc.json`, 'application/json')
        setMsg({ type: 'ok', text: `Encrypted: ${safeFilename(fname)}.enc.json` })
      } else {
        const mime = { json: 'application/json', csv: 'text/csv', xml: 'application/xml' }
        downloadFile(content, `${fname}.${format}`, mime[format])
        setMsg({ type: 'ok', text: `Saved: ${safeFilename(fname)}.${format}` })
      }
    } catch (e) {
      setMsg({ type: 'err', text: `Export failed: ${e.message}` })
    } finally { setBusy(false) }
  }

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
        <h3 className="text-xs font-bold tracking-widest uppercase text-cyan">Export Data</h3>
      </div>
      {msg && (
        <div role="alert" className={`mb-4 px-3 py-2 rounded-lg border text-sm font-medium
          ${msg.type==='ok'?'bg-success/10 border-success/30 text-success':'bg-danger/10 border-danger/30 text-danger'}`}>
          {msg.text}
        </div>
      )}
      {/* Encrypt toggle */}
      <div role="button" tabIndex={0}
        onClick={() => { setEncOn(v => { if (v) setPassword(''); return !v }) }}
        onKeyDown={e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); setEncOn(v => { if(v) setPassword(''); return !v }) } }}
        className="flex items-center gap-3 mb-4 cursor-pointer select-none w-fit">
        <div role="switch" aria-checked={encOn}
          className={`relative w-9 h-5 rounded-full border transition-all flex-shrink-0 ${encOn?'bg-cyan border-cyan':'bg-surface border-border'}`}>
          <span className={`absolute top-0.5 left-0 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${encOn?'translate-x-[18px]':'translate-x-0.5'}`} />
        </div>
        <span className="text-sm font-semibold text-dim flex items-center gap-1.5">
          {encOn ? <Lock size={13} className="text-cyan" /> : <Unlock size={13} />}
          Encrypt Output (AES-256-GCM)
        </span>
      </div>
      {encOn && (
        <div className="mb-4 max-w-sm">
          <label htmlFor="rh-enc-pwd" className="block text-xs font-bold tracking-widest uppercase text-dim mb-1.5">Encryption Password</label>
          <input id="rh-enc-pwd" type="password" placeholder="Enter password…" maxLength={1024}
            value={password} onChange={e => setPassword(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-base text-text font-mono focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20" />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto] items-end">
        <div>
          <label htmlFor="rh-fname" className="block text-xs font-bold tracking-widest uppercase text-dim mb-1.5">Filename</label>
          <input id="rh-fname" type="text" maxLength={200} autoComplete="off" spellCheck="false"
            placeholder={`reward-history-${(address||'').slice(0,10)}`}
            value={filename} onChange={e => setFilename(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20" />
        </div>
        <div>
          <label htmlFor="rh-fmt" className="block text-xs font-bold tracking-widest uppercase text-dim mb-1.5">Format</label>
          <select id="rh-fmt" value={format} onChange={e => setFormat(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text focus:outline-none focus:border-primary/50">
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
            <option value="xml">XML</option>
          </select>
        </div>
        <button onClick={handleExport} disabled={busy||!results.length}
          className="btn-primary py-2 px-5 disabled:opacity-40 self-end">
          {busy ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <Download size={14} />}
          Export
        </button>
      </div>
    </div>
  )
}

// ── Import panel ─────────────────────────────────────────────────────────────
function RewardImportPanel({ onImport }) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isPending,  setIsPending]  = useState(false)
  const [encPending, setEncPending] = useState(null)
  const [decPwd,     setDecPwd]     = useState('')
  const [alert,      setAlert]      = useState(null)
  const fileInputRef = useRef(null)

  function showAlert(type, text) { setAlert({ type, text }); setTimeout(() => setAlert(null), 8000) }

  function processFile(file) {
    if (file.size > MAX_IMPORT_MB * 1024 * 1024) { showAlert('err', `File too large (max ${MAX_IMPORT_MB} MB).`); return }
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['json','csv'].includes(ext)) { showAlert('err', 'Only .json and .csv exports from this app are supported.'); return }
    setIsPending(true); setAlert(null); setEncPending(null)
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target.result
      if (ext === 'json') {
        try {
          const obj = JSON.parse(text)
          if (obj?.encrypted === true) { setEncPending({ text, fname: file.name, ext }); setIsPending(false); return }
        } catch {}
      }
      try {
        const { results } = parseRewardImport(text, ext)
        onImport(results)
      } catch (e) { showAlert('err', e.message) }
      setIsPending(false)
    }
    reader.onerror = () => { showAlert('err', 'Failed to read file.'); setIsPending(false) }
    reader.readAsText(file)
  }

  async function handleDecrypt() {
    if (!decPwd) { showAlert('err', 'Enter the decryption password.'); return }
    setIsPending(true)
    try {
      const { aesDecrypt } = await import('../utils/balanceExport.js')
      const plain = await aesDecrypt(encPending.text, decPwd)
      const { results } = parseRewardImport(plain, 'json')
      onImport(results)
      setEncPending(null); setDecPwd('')
    } catch (e) { showAlert('err', `Decryption failed: ${e.message}`) }
    setIsPending(false)
  }

  function onDrop(e) { e.preventDefault(); setIsDragOver(false); const f=e.dataTransfer.files?.[0]; if(f) processFile(f) }
  function onFileChange(e) { const f=e.target.files?.[0]; if(f) processFile(f); e.target.value='' }

  return (
    <div className="space-y-3">
      {alert && (
        <div role="alert" className={`px-4 py-2.5 rounded-lg border text-sm font-medium
          ${alert.type==='ok'?'bg-success/10 border-success/30 text-success':'bg-danger/10 border-danger/30 text-danger'}`}>
          {alert.text}
        </div>
      )}
      <div role="button" tabIndex={0} aria-label="Drop file or click to browse"
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-all
          ${isDragOver?'border-cyan bg-cyan/10':'border-border hover:border-rim hover:bg-surface/50'}`}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={e => e.key==='Enter'&&fileInputRef.current?.click()}
        onDragOver={e=>{e.preventDefault();setIsDragOver(true)}}
        onDragLeave={()=>setIsDragOver(false)}
        onDrop={onDrop}>
        {isPending ? (
          <div className="flex flex-col items-center gap-2">
            <span className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-sm text-dim">Reading file…</p>
          </div>
        ) : (
          <>
            <FolderOpen size={32} className="mx-auto mb-3 text-dim" />
            <p className="font-semibold text-text mb-1">Drop file here or click to browse</p>
            <p className="text-sm text-dim">JSON or CSV exports from this tool (max {MAX_IMPORT_MB} MB)</p>
          </>
        )}
        <input ref={fileInputRef} type="file" accept=".json,.csv" className="hidden" onChange={onFileChange} aria-hidden />
      </div>
      {encPending && (
        <div className="space-y-3">
          <div className="flex gap-2 px-4 py-3 rounded-lg bg-cyan/10 border border-cyan/30 text-sm text-cyan">
            🔒 Encrypted file detected. Enter password to decrypt.
          </div>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label htmlFor="rh-dec-pwd" className="block text-xs font-bold tracking-widest uppercase text-dim mb-1.5">Password</label>
              <input id="rh-dec-pwd" type="password" placeholder="Enter password…" maxLength={1024}
                value={decPwd} onChange={e=>setDecPwd(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleDecrypt()}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-base text-text font-mono focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20" />
            </div>
            <button onClick={handleDecrypt} disabled={isPending} className="btn-primary py-2 px-4 self-end">
              {isPending?<span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"/>:<Upload size={14}/>}
              Decrypt &amp; Import
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────
export default function RewardHistoryViewer() {
  const { status, results, logs, progress, csvCount, errorMsg, run, stop, reset } = useRewardHistory()

  const [tab,       setTab]      = useState('compute')  // 'compute' | 'import'
  const [address,   setAddress]  = useState('')
  const [addrError, setAddrError]= useState('')

  // Era range mode
  const [rangeMode,   setRangeMode]   = useState('era')    // 'era' | 'date'
  const [startEra,    setStartEra]    = useState('')
  const [endEra,      setEndEra]      = useState('')
  const [startDate,   setStartDate]   = useState('')
  const [endDate,     setEndDate]     = useState('')
  const [activePreset,setActivePreset]= useState(null)
  const [eraError,    setEraError]    = useState('')
  const [dateError,   setDateError]   = useState('')

  // Imported results (separate from computed)
  const [importedResults, setImportedResults] = useState(null)

  // Include past pool interactions toggle
  const [includeHistory, setIncludeHistory] = useState(false)

  // Filtered rows (from table, drives chart + summary)
  const [filteredRows, setFilteredRows] = useState([])

  const isLoading = status === RH_STATUS.LOADING
  const isDone    = status === RH_STATUS.DONE
  const isStopped = status === RH_STATUS.STOPPED
  const isError   = status === RH_STATUS.ERROR

  // Active results: computed or imported
  const activeResults = importedResults ?? results

  // Progress state
  const phases      = progress?.phases ?? []
  const activePhase = phases.find(p => p.status === 'in_progress') ?? phases[phases.length - 1]
  const phasePct    = activePhase && activePhase.total > 0
    ? Math.min(100, Math.round(activePhase.completed / activePhase.total * 100))
    : 0
  const allDone     = phases.length > 0 && phases.every(p => p.status === 'completed')

  // Sync filtered rows when results change
  useEffect(() => {
    setFilteredRows(activeResults)
  }, [activeResults])

  // ── Validation ──────────────────────────────────────────────────────────
  function validate() {
    let ok = true
    const trimAddr = address.trim()
    if (!trimAddr.startsWith('en')) {
      setAddrError('Enjin Relaychain addresses start with "en".')
      ok = false
    } else {
      setAddrError('')
    }
    if (rangeMode === 'era') {
      const s = parseInt(startEra, 10), e = parseInt(endEra, 10)
      if (isNaN(s) || isNaN(e) || s < 1 || e < s) {
        setEraError('Enter valid start and end era numbers (start ≤ end).')
        ok = false
      } else { setEraError('') }
    } else {
      if (!startDate || !endDate) {
        setDateError('Select start and end dates.')
        ok = false
      } else { setDateError('') }
    }
    return ok
  }

  // ── Handle run ──────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!validate()) return
    setImportedResults(null)
    const ARCHIVE = 'wss://archive.relay.blockchain.enjin.io'
    if (rangeMode === 'era') {
      run({ address: address.trim(), startEra: parseInt(startEra,10), endEra: parseInt(endEra,10), endpoint: ARCHIVE, includeHistory })
    } else {
      // Convert dates to era range via CSV
      try {
        const eraData = await loadEraDataRH()
        const { startEra: s, endEra: e } = findErasForDateRange(eraData, startDate, endDate)
        run({ address: address.trim(), startEra: s, endEra: e, endpoint: ARCHIVE, includeHistory })
      } catch {
        setDateError('Failed to load era reference CSV.')
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, rangeMode, startEra, endEra, startDate, endDate, run, includeHistory])

  function applyDatePreset(days, label) {
    const now = new Date(), from = new Date(now.getTime() - days * 86_400_000)
    setStartDate(toDateInput(from)); setEndDate(toDateInput(now)); setActivePreset(label)
  }

  function handleImportResults(rows) {
    setImportedResults(rows)
    setFilteredRows(rows)
    setTab('compute')  // show results on compute tab
  }

  const showResults = (isDone || isStopped || importedResults) && activeResults.length > 0

  return (
    <div className="space-y-4 pb-24">

      {/* ── Tabs ── */}
      <div className="card overflow-hidden">
        <div role="tablist" className="flex border-b border-border bg-surface/30">
          {[
            { key: 'compute', label: 'Compute Rewards', icon: Server },
            { key: 'import',  label: 'Import Data',     icon: Upload },
          ].map(({ key, label, icon: Icon }) => (
            <button key={key} role="tab" aria-selected={tab===key}
              disabled={isLoading}
              onClick={() => setTab(key)}
              className={`flex items-center justify-center gap-1.5 flex-1 px-4 py-3
                text-xs sm:text-sm font-medium border-b-2 transition-colors disabled:opacity-50
                ${tab===key?'border-primary text-text bg-primary/5':'border-transparent text-dim hover:text-text hover:bg-surface/60'}`}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>

        {/* ── Compute pane ── */}
        {tab === 'compute' && (
          <div role="tabpanel" className="p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-primary flex-shrink-0" />
              <h2 className="text-sm font-semibold text-text">Reward History Viewer</h2>
              <span className="inline-flex items-center gap-1 ml-1 px-2 py-0.5 rounded-full
                               bg-cyan/10 border border-cyan/25 text-[10px] font-semibold tracking-widest uppercase text-cyan">
                Relaychain
              </span>
              {csvCount > 0 && (
                <span className="ml-auto text-xs text-muted font-mono">{csvCount} eras in CSV</span>
              )}
            </div>

            <p className="text-xs text-dim leading-relaxed">
              Computes staking rewards per era for pools you are staked in,
              using archive-node RPC. Subscan is only used when
              <span className="text-text/70"> Include past pool interactions </span>
              is enabled.
              See <code className="text-primary">docs/reward-history-computation.md</code> for formula details.
            </p>

            {/* Tax information note */}
            <div className="flex gap-2.5 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-[11px] text-dim leading-relaxed space-y-1.5">
                <p>
                  <span className="font-semibold text-text/80">Tax note:</span>{' '}
                  In most jurisdictions, nomination pool staking is treated as a{' '}
                  <span className="text-text/70">capital gain</span> rather than dividend income —
                  similar to buying and selling an ETF. The taxable event is generally the{' '}
                  <span className="text-text/70">difference in fiat value</span> of your ENJ when
                  you bonded versus when you unbonded and withdrew. If you bonded or exited
                  multiple times, FIFO (first-in, first-out) is the commonly accepted accounting
                  method.
                </p>
                <p className="text-muted">
                  This tool is for informational purposes only and does not constitute tax advice.
                  Consult a qualified tax professional for guidance specific to your jurisdiction.
                </p>
              </div>
            </div>

            {/* Address */}
            <div className="space-y-1.5">
              <label className="text-[0.6rem] font-bold tracking-widest uppercase text-dim">Wallet Address</label>
              <input type="text" value={address}
                onChange={e => { setAddress(e.target.value); setAddrError('') }}
                placeholder="en…" disabled={isLoading}
                className={`w-full bg-surface border rounded-lg px-3 py-2 text-sm font-mono text-text placeholder:text-muted
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 transition-colors
                  ${addrError ? 'border-danger/50' : 'border-border'}`}
                maxLength={60} />
              {addrError && (
                <p className="flex items-center gap-1 text-xs text-danger">
                  <AlertTriangle size={11} className="flex-shrink-0" />{addrError}
                </p>
              )}
            </div>

            {/* Pool scope toggle */}
            <div className="p-3 rounded-lg bg-surface/40 border border-border space-y-1">
              <div className="flex items-center justify-between gap-2.5">
                <span className="text-xs font-medium text-text">Include past pool interactions</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={includeHistory}
                  disabled={isLoading}
                  onClick={() => setIncludeHistory(v => !v)}
                  className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors focus-visible:outline-none
                    focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50
                    ${includeHistory ? 'bg-primary' : 'bg-border'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
                    ${includeHistory ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              <p className="text-[11px] text-dim leading-relaxed">
                When enabled, also queries Subscan for pools this address
                has ever interacted with (bond, unbond, withdraw). Useful
                if you have exited a pool but want rewards from those eras.
              </p>
            </div>

            {/* Range mode toggle */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[0.6rem] font-bold tracking-widest uppercase text-dim">Query Mode</span>
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button type="button" onClick={() => setRangeMode('era')} disabled={isLoading}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-r border-border transition-colors
                    ${rangeMode==='era'?'bg-primary/20 text-primary':'text-dim hover:text-text'}`}>
                  Era Range
                </button>
                <button type="button" onClick={() => setRangeMode('date')} disabled={isLoading}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors
                    ${rangeMode==='date'?'bg-primary/20 text-primary':'text-dim hover:text-text'}`}>
                  <Calendar size={12} /> Date Range
                </button>
              </div>
            </div>

            {/* Era range inputs */}
            {rangeMode === 'era' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[0.6rem] font-bold tracking-widest uppercase text-dim">Start Era</label>
                  <input type="number" min="1" step="1" value={startEra}
                    onChange={e => { setStartEra(e.target.value); setEraError('') }}
                    placeholder="e.g. 980" disabled={isLoading}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[0.6rem] font-bold tracking-widest uppercase text-dim">End Era</label>
                  <input type="number" min="1" step="1" value={endEra}
                    onChange={e => { setEndEra(e.target.value); setEraError('') }}
                    placeholder="e.g. 1000" disabled={isLoading}
                    className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50" />
                </div>
                {eraError && <p className="col-span-2 flex items-center gap-1 text-xs text-danger"><AlertTriangle size={11} className="flex-shrink-0" />{eraError}</p>}
              </div>
            )}

            {/* Date range inputs */}
            {rangeMode === 'date' && (
              <div className="space-y-3">
                {/* Quick presets */}
                <div>
                  <span className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">Quick Range</span>
                  <div className="flex flex-wrap gap-2">
                    {DATE_PRESETS.map(({ label, days }) => (
                      <button key={label} type="button"
                        onClick={() => applyDatePreset(days, label)}
                        disabled={isLoading}
                        className={`px-2.5 py-1 rounded-md border text-[11px] transition-colors disabled:opacity-50
                          ${activePreset===label
                            ?'bg-primary/20 border-primary/60 text-primary font-semibold'
                            :'border-border text-dim hover:border-primary/50 hover:text-primary'}`}>
                        {label} ago
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[0.6rem] font-bold tracking-widest uppercase text-dim">Start Date</label>
                    <input type="date" max={toDateInput(new Date())} value={startDate}
                      onChange={e => { setStartDate(e.target.value); setActivePreset(null); setDateError('') }}
                      disabled={isLoading}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[0.6rem] font-bold tracking-widest uppercase text-dim">End Date</label>
                    <input type="date" max={toDateInput(new Date())} value={endDate}
                      onChange={e => { setEndDate(e.target.value); setActivePreset(null); setDateError('') }}
                      disabled={isLoading}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm font-mono text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50" />
                  </div>
                </div>
                {dateError && <p className="flex items-center gap-1 text-xs text-danger"><AlertTriangle size={11} className="flex-shrink-0"/>{dateError}</p>}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              {!isLoading ? (
                <button onClick={handleRun} className="btn-primary gap-1.5 px-5"
                  disabled={!address.trim()}>
                  <Play size={14} />Compute Rewards
                </button>
              ) : (
                <button onClick={stop} className="btn-danger gap-1.5 px-5">
                  <Square size={14} />Stop
                </button>
              )}
              {(isDone || isStopped || isError || importedResults) && (
                <button onClick={() => { reset(); setImportedResults(null) }} className="btn-secondary gap-1.5 px-4">
                  <RotateCcw size={14} />Reset
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Import pane ── */}
        {tab === 'import' && (
          <div role="tabpanel" className="p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
              <h3 className="text-xs font-bold tracking-widest uppercase text-cyan">Import Reward Data</h3>
            </div>
            <p className="text-xs text-dim leading-relaxed">
              Import previously exported reward history (JSON or CSV). Encrypted files (.enc.json) are also supported.
            </p>
            <RewardImportPanel onImport={handleImportResults} />
          </div>
        )}
      </div>

      {/* ── Progress ── */}
      {isLoading && phases.length > 0 && (
        <section className="card p-4 space-y-3" aria-live="polite">
          <div className="flex items-center justify-between text-xs mb-1">
            <p className="text-dim">{allDone ? 'Complete!' : (activePhase?.label ?? 'Computing…')}</p>
            <p className="font-mono text-text">{activePhase?.completed ?? 0} / {activePhase?.total ?? 0} ({phasePct}%)</p>
          </div>
          <div className="h-2 rounded-full bg-surface overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-primary-dim via-primary to-cyan transition-all duration-300"
                 style={{ width: `${phasePct}%` }} />
          </div>
          <div className="space-y-1.5">
            {phases.map((ph, i) => {
              const cls = ph.status==='completed'?'text-success':ph.status==='in_progress'?'text-cyan':'text-dim'
              const lbl = ph.status==='completed'?'Done':ph.status==='in_progress'?'Running':'Pending'
              return (
                <div key={ph.key} className="flex items-center justify-between text-[11px] bg-surface/40 rounded border border-border px-2.5 py-1.5">
                  <span className={`font-medium ${cls}`}>Phase {i}: {ph.label}</span>
                  <span className={`font-semibold ${cls}`}>{lbl}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Error ── */}
      {isError && errorMsg && (
        <div className="card p-4 border-danger/30 bg-danger/5">
          <p className="text-sm text-danger">{errorMsg}</p>
        </div>
      )}

      {/* ── Stopped ── */}
      {isStopped && !activeResults.length && (
        <div className="card p-4 border-warning/30 bg-warning/5">
          <p className="text-sm text-warning">Computation stopped before results were available.</p>
        </div>
      )}

      {/* ── Empty result ── */}
      {isDone && !activeResults.length && (
        <div className="card p-6 text-center">
          <p className="text-sm text-dim">No rewards found for the given address and era range.</p>
          <p className="text-xs text-muted mt-2">
            If you have exited your pool(s), enable "Include past pool interactions"
            to scan historical pools.
          </p>
        </div>
      )}

      {/* ── Results section ── */}
      {showResults && (
        <>
          <RewardSummary results={filteredRows.length ? filteredRows : activeResults} />
          <RewardTableV2 results={activeResults} onFilter={setFilteredRows} />
          <RewardChart data={filteredRows} />
          {!importedResults && <RewardExportPanel results={activeResults} address={address} />}
          {importedResults && (
            <div className="flex items-center gap-2 text-xs text-dim px-1">
              <span>Showing imported data.</span>
              <button onClick={() => setImportedResults(null)} className="text-primary hover:underline">Clear import</button>
            </div>
          )}
        </>
      )}

      {/* ── Sticky terminal log — always visible ── */}
      <TerminalLog logs={logs} sticky />
    </div>
  )
}
