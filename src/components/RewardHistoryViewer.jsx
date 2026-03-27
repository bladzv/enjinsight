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
import { fetchLiveChainInfo } from '../utils/chainInfo.js'
import TerminalLog from './TerminalLog.jsx'
import { PLANCK_PER_ENJ } from '../constants.js'
import { aesEncrypt, aesDecrypt, downloadFile, safeFilename } from '../utils/balanceExport.js'
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
    const stMs = parseInt(p[4], 10) || null  // CSV stores unix ms
    const etMs = parseInt(p[6], 10) || null  // CSV stores unix ms
    return {
      era:        parseInt(p[0], 10),
      startBlock: parseInt(p[1], 10),
      endBlock:   parseInt(p[2], 10) || null,
      startTs:    stMs ? Math.floor(stMs / 1000) : null, // unix seconds
      endTs:      etMs ? Math.floor(etMs / 1000) : null, // unix seconds
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
    rolling_apy_pct: Number.isFinite(r.rollingApy) ? r.rollingApy.toFixed(4) : '',
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
        rollingApy:      parseFloat(r.rolling_apy_pct ?? r.rollingApy ?? '') || undefined,
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
        rollingApy:      parseFloat(g('rolling_apy_pct')) || undefined,
      }
    })
    return { results, meta: address ? { address } : null }
  }
  throw new Error('Unsupported format. Export from this app first.')
}

// ── Reward Chart (line: Reward ENJ per era) ─────────────────────────────────
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

    import('chart.js/auto').then(({ Chart }) => {
      if (destroyed) return
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }

      chartRef.current = new Chart(canvasRef.current, {
        type: 'bar',
        data: {
          labels: allEras,
          datasets: [{
            label:           rwdLabel,
            data:            rwdData,
            backgroundColor: 'rgba(0,217,255,0.55)',
            borderColor:     '#00d9ff',
            borderWidth:     1,
            borderRadius:    3,
            hoverBackgroundColor: 'rgba(0,217,255,0.85)',
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
              backgroundColor: 'rgba(12,14,23,0.97)',
              borderColor:     'rgba(70,71,82,0.15)',
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
              beginAtZero: true,
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
    <div className="bg-surface rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
        <h3 className="text-xs font-bold font-headline tracking-widest uppercase text-cyan">Reward Chart</h3>
        <span className="text-[10px] text-text-secondary ml-1">(all filtered eras · aggregated by pool)</span>
      </div>
      <div style={{ height: '280px' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

// ── Shared pie colour palette ─────────────────────────────────────────────────
const PIE_COLORS = [
  '#00d9ff','#7c3aed','#10b981','#f59e0b','#ef4444',
  '#8b5cf6','#06b6d4','#84cc16','#f97316','#ec4899',
  '#14b8a6','#a78bfa','#34d399','#fbbf24','#fb7185',
]

function makePieChart(canvasEl, labels, values, colors) {
  // Returns a Chart.js instance configured as a doughnut
  return import('chart.js/auto').then(({ Chart }) => {
    return new Chart(canvasEl, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors, borderColor: '#0d0d1a', borderWidth: 2 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'right',
            labels: { color: '#A0A0C8', font: { size: 11 }, boxWidth: 12, padding: 10 },
          },
          tooltip: {
            backgroundColor: 'rgba(12,14,23,0.97)',
            borderColor: 'rgba(70,71,82,0.15)',
            borderWidth: 1,
            titleColor: '#00d9ff',
            bodyColor: '#A0A0C8',
            padding: 10,
            callbacks: {
              label: ctx => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0)
                const pct   = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : '0.0'
                return ` ${ctx.raw.toLocaleString('en', { maximumFractionDigits: 2 })} ENJ (${pct}%)`
              },
            },
          },
        },
      },
    })
  })
}

// ── Pie: bonded ENJ per pool ──────────────────────────────────────────────────
function PoolBondedPieChart({ data }) {
  const canvasRef = useRef(null)
  const chartRef  = useRef(null)

  useEffect(() => {
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }
    if (!canvasRef.current || !data.length) return
    let destroyed = false

    // Per pool: wallet's proportional share of bonded ENJ at latest era
    // userBonded = (memberBalance / poolSupply) × activeStake
    const latestByPool = new Map()
    for (const r of data) {
      const cur = latestByPool.get(r.poolId)
      if (!cur || r.era > cur.era) {
        const poolBonded = (r.activeStake && r.activeStake > 0n) ? r.activeStake : r.poolSupply
        const userBonded = r.poolSupply > 0n ? (r.memberBalance * poolBonded) / r.poolSupply : 0n
        latestByPool.set(r.poolId, { era: r.era, value: userBonded, label: r.poolLabel })
      }
    }
    const entries = [...latestByPool.entries()].filter(([, v]) => v.value > 0n)
    if (!entries.length) return

    const labels = entries.map(([, v]) => v.label)
    const values = entries.map(([, v]) => Number(v.value) / 1e18)
    const colors = entries.map((_, i) => PIE_COLORS[i % PIE_COLORS.length])

    makePieChart(canvasRef.current, labels, values, colors).then(chart => {
      if (destroyed) { chart.destroy(); return }
      chartRef.current = chart
    })

    return () => { destroyed = true; chartRef.current?.destroy(); chartRef.current = null }
  }, [data])

  if (!data.length) return null
  return (
    <div className="bg-surface rounded-xl p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
        <h3 className="text-xs font-bold font-headline tracking-widest uppercase text-cyan">My Bonded ENJ by Pool</h3>
        <span className="text-[10px] text-text-secondary ml-1">(wallet share · latest era per pool)</span>
      </div>
      <div style={{ height: '240px' }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}

// ── Pie: reward ENJ per pool ──────────────────────────────────────────────────
function PoolRewardPieChart({ data }) {
  const canvasRef = useRef(null)
  const chartRef  = useRef(null)

  useEffect(() => {
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }
    if (!canvasRef.current || !data.length) return
    let destroyed = false

    // Sum reward per pool
    const rewardByPool = new Map()
    for (const r of data) {
      const cur = rewardByPool.get(r.poolId) ?? { value: 0n, label: r.poolLabel }
      rewardByPool.set(r.poolId, { value: cur.value + r.reward, label: r.poolLabel })
    }
    const entries = [...rewardByPool.entries()].filter(([, v]) => v.value > 0n)
    if (!entries.length) return

    const labels = entries.map(([, v]) => v.label)
    const values = entries.map(([, v]) => Number(v.value) / 1e18)
    const colors = entries.map((_, i) => PIE_COLORS[i % PIE_COLORS.length])

    makePieChart(canvasRef.current, labels, values, colors).then(chart => {
      if (destroyed) { chart.destroy(); return }
      chartRef.current = chart
    })

    return () => { destroyed = true; chartRef.current?.destroy(); chartRef.current = null }
  }, [data])

  if (!data.length) return null
  return (
    <div className="bg-surface rounded-xl p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-0.5 h-3.5 bg-violet-400 rounded-sm" />
        <h3 className="text-xs font-bold font-headline tracking-widest uppercase text-violet-400">Reward ENJ by Pool</h3>
        <span className="text-[10px] text-text-secondary ml-1">(aggregated across filtered eras)</span>
      </div>
      <div style={{ height: '240px' }}>
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

  // null = all selected; Set = explicit include-set (empty Set = none selected)
  const allSelected = value === null
  const noneSelected = !allSelected && value.size === 0
  const countLabel  = allSelected
    ? 'All pools'
    : noneSelected
      ? 'No pools'
      : `${value.size} / ${pools.length} pool${value.size !== 1 ? 's' : ''}`

  function toggle(id) {
    if (allSelected) {
      // Deselecting from "all" — start an explicit include-set without this pool
      const next = new Set(pools.map(([pid]) => pid))
      next.delete(id)
      onChange(next)
    } else {
      const next = new Set(value)
      if (next.has(id)) next.delete(id)
      else              next.add(id)
      // If user re-selected all pools, collapse back to null (all selected)
      onChange(next.size === pools.length ? null : next)
    }
  }

  function isChecked(id) { return allSelected || value.has(id) }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-card rounded px-2.5 py-1 text-xs text-text hover:bg-surface-bright transition-colors min-w-[110px] justify-between"
      >
        <span className={allSelected ? 'text-text-secondary' : 'text-cyan font-semibold'}>{countLabel}</span>
        <ChevronDown size={10} className={`text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 min-w-[200px] max-h-64 overflow-y-auto
                        bg-card rounded-lg shadow-xl shadow-black/40 py-1">
          {/* Select All / Clear */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-bright rounded-t-lg">
            <button
              onClick={() => { onChange(null); setOpen(false) }}
              className="text-[10px] font-bold tracking-widest uppercase text-violet-400 hover:text-cyan transition-colors"
            >All</button>
            <span className="text-text-secondary text-[10px]">·</span>
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

// ── Pool name helper ─────────────────────────────────────────────────────────
function getPoolName(r) {
  const prefix = `#${r.poolId} — `
  if (r.poolLabel?.startsWith(prefix)) return r.poolLabel.slice(prefix.length)
  return r.poolLabel || `Pool #${r.poolId}`
}

// ── Unified results table ────────────────────────────────────────────────────
const TABLE_COLS = [
  { key: 'era',          label: 'Era',            align: 'left',  sortable: true,
    tooltip: 'Era index on the Enjin Relaychain. One era ≈ 24 hours.' },
  { key: 'eraDate',      label: 'Date',           align: 'left',  sortable: true,
    tooltip: 'UTC start date of the era.' },
  { key: 'poolId',       label: 'Pool ID',        align: 'left',  sortable: true,
    tooltip: 'Nomination pool ID number on the Enjin Relaychain.' },
  { key: 'poolName',     label: 'Pool Name',      align: 'left',  sortable: true,
    tooltip: 'Pool name fetched from Subscan. Empty if the pool has no metadata set.' },
  { key: 'memberBalance',label: 'Member sENJ',    align: 'right', sortable: true,
    tooltip: 'Your pool share tokens (sENJ) at the era\'s start block. sENJ represents your proportional ownership of the pool — more sENJ = larger share of rewards.' },
  { key: 'reinvested',   label: 'Reinvested ENJ', align: 'right', sortable: true,
    tooltip: 'Total ENJ reward the entire pool earned this era, automatically compounded back into the pool\'s bonded stake. This is pool-wide — not wallet-specific.' },
  { key: 'reward',       label: 'Reward ENJ',     align: 'right', sortable: true,
    tooltip: 'Your wallet\'s share of the pool\'s reinvested reward: (your sENJ ÷ total pool sENJ) × Reinvested ENJ. The ENJ that accrued to your position this era.' },
  { key: 'accumulated',  label: 'Cumulative ENJ', align: 'right', sortable: true,
    tooltip: 'Running total of your Reward ENJ across all eras in the result set, per pool.' },
  { key: 'apy',          label: 'APY*',           align: 'right', sortable: true,
    tooltip: 'Per-era annualised yield: ((bonded ENJ + reinvested) ÷ bonded ENJ)^365 − 1. An estimate — actual returns vary each era.' },
  { key: 'rollingApy',   label: 'APY 15d*',       align: 'right', sortable: true,
    tooltip: 'Rolling 15-era APY: the same formula compounded over a sliding 15-era window and annualised. Smooths out single-era spikes.' },
]

const PAGE_SIZES = [10, 25, 50, 100]

// ── RewardTable v2 — exposes filtered rows via prop ──────────────────────────
function RewardTableV2({ results, onFilter }) {
  const [sortCol, setSortCol]       = useState('era')
  const [sortDir, setSortDir]       = useState(1)
  const [filterPools, setFilterPools] = useState(null)   // null = all included; Set = explicit selection
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
    if (filterPools !== null) rows = rows.filter(r => filterPools.has(r.poolId))
    if (filterEraMin) rows = rows.filter(r => r.era >= parseInt(filterEraMin, 10))
    if (filterEraMax) rows = rows.filter(r => r.era <= parseInt(filterEraMax, 10))
    return rows.sort((a, b) => {
      let av, bv
      switch (sortCol) {
        case 'era':          av = a.era;          bv = b.era;          break
        case 'eraDate':      av = a.eraStartDateUtc ?? ''; bv = b.eraStartDateUtc ?? ''; break
        case 'poolId':       av = a.poolId;       bv = b.poolId;       break
        case 'poolName':     av = getPoolName(a); bv = getPoolName(b); break
        case 'memberBalance':av = a.memberBalance;bv = b.memberBalance;break
        case 'reinvested':   av = a.reinvested;   bv = b.reinvested;   break
        case 'reward':       av = a.reward;       bv = b.reward;       break
        case 'accumulated':  av = a.accumulated;  bv = b.accumulated;  break
        case 'apy':          av = a.apy;          bv = b.apy;          break
        case 'rollingApy':   av = a.rollingApy ?? -1; bv = b.rollingApy ?? -1; break
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
    <div className="bg-surface rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="w-0.5 h-3.5 bg-cyan rounded-sm flex-shrink-0" />
        <h3 className="text-xs font-bold font-headline tracking-widest uppercase text-cyan">Reward History</h3>
        <span className="text-xs text-text-secondary font-mono ml-1">{filtered.length} / {results.length} rows</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold tracking-widest uppercase text-text-secondary">Pool:</span>
          <PoolMultiSelect
            pools={pools}
            value={filterPools}
            onChange={next => { setFilterPools(next); setPage(1) }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold tracking-widest uppercase text-text-secondary">Era:</span>
          <input type="number" placeholder="Min" value={filterEraMin}
            onChange={e => { setFilterEraMin(e.target.value); setPage(1) }}
            className="w-16 bg-card rounded px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary" />
          <span className="text-text-secondary text-xs">–</span>
          <input type="number" placeholder="Max" value={filterEraMax}
            onChange={e => { setFilterEraMax(e.target.value); setPage(1) }}
            className="w-16 bg-card rounded px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary" />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] font-bold tracking-widest uppercase text-text-secondary">Per page:</span>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
            className="bg-card rounded px-1.5 py-0.5 text-xs text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg">
        <table className="border-collapse text-xs font-mono w-max">
          <thead className="sticky top-0 z-10">
            <tr>
              {TABLE_COLS.map(col => {
                const isSorted = sortCol === col.key
                return (
                  <th key={col.key} onClick={() => col.sortable && handleSort(col.key)}
                    className={`bg-surface-high px-3 py-2 font-bold tracking-widest
                                uppercase select-none whitespace-nowrap transition-colors text-[10px]
                                relative group
                                ${col.align === 'right' ? 'text-right' : 'text-left'}
                                ${col.sortable ? 'cursor-pointer' : ''}
                                ${isSorted ? 'text-cyan' : 'text-muted hover:text-cyan'}`}>
                    {col.label}{isSorted && (sortDir === 1 ? ' ↑' : ' ↓')}
                    {col.tooltip && (
                      <div className={`pointer-events-none absolute z-50 top-full mt-1 w-56 p-2.5
                                       rounded-lg border border-rim bg-ink shadow-xl shadow-black/60
                                       text-[10px] font-normal normal-case tracking-normal leading-relaxed text-text-secondary
                                       whitespace-normal break-words text-left
                                       opacity-0 group-hover:opacity-100 transition-opacity duration-150
                                       ${col.align === 'right' ? 'right-0' : 'left-0'}`}>
                        {col.tooltip}
                      </div>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pageSlice.length === 0 ? (
              <tr><td colSpan={TABLE_COLS.length} className="px-3 py-6 text-center text-text-secondary">No rows match filters.</td></tr>
            ) : pageSlice.map((r, i) => (
              <tr key={`${r.era}-${r.poolId}`} className={`hover:bg-surface-bright transition-colors ${i % 2 ? 'bg-card' : ''}`}>
                <td className="px-3 py-1.5 text-cyan font-bold">{r.era}</td>
                <td className="px-3 py-1.5 text-text-secondary whitespace-nowrap">{fmtDate(r.eraStartDateUtc)}</td>
                <td className="px-3 py-1.5 text-text whitespace-nowrap font-semibold">#{r.poolId}</td>
                <td className="px-3 py-1.5 text-text min-w-[180px]" title={getPoolName(r)}>{getPoolName(r)}</td>
                <td className="px-3 py-1.5 text-right text-text">{fmtEnj(r.memberBalance)}</td>
                <td className="px-3 py-1.5 text-right text-text">{fmtEnj(r.reinvested)}</td>
                <td className="px-3 py-1.5 text-right text-success font-semibold">{fmtEnj(r.reward)}</td>
                <td className="px-3 py-1.5 text-right text-cyan">{fmtEnj(r.accumulated)}</td>
                <td className="px-3 py-1.5 text-right text-violet-400">{fmtApy(r.apy)}</td>
                <td className="px-3 py-1.5 text-right text-violet-300">{fmtApy(r.rollingApy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* APY footnote */}
      <p className="text-[0.6rem] text-text-secondary font-mono mt-1.5">
        * APY: per-era estimate — (1 + reinvested÷poolSupply)^365 − 1. APY 15d: 15-era rolling window, same formula compounded. Actual returns vary with era length and pool fees.
      </p>

      {/* Pagination */}
      {filtered.length > pageSize && (
        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
          <span className="text-xs text-text-secondary font-mono">
            Page {safePage}/{totalPages} · {((safePage-1)*pageSize+1).toLocaleString('en')}–{Math.min(safePage*pageSize,filtered.length).toLocaleString('en')}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={safePage===1} className="px-2 py-1 rounded bg-card text-xs text-muted hover:text-cyan disabled:opacity-40 transition-colors">«</button>
            <button onClick={() => setPage(p=>Math.max(1,p-1))} disabled={safePage===1} className="px-2 py-1 rounded bg-card text-xs text-muted hover:text-cyan disabled:opacity-40 transition-colors">‹</button>
            {Array.from({length:Math.min(5,totalPages)},(_,i)=>{
              const p=totalPages<=5?i+1:safePage<=3?i+1:safePage>=totalPages-2?totalPages-4+i:safePage-2+i
              return <button key={p} onClick={()=>setPage(p)} className={`w-7 h-7 rounded text-xs transition-colors ${p===safePage?'bg-primary text-white':'bg-card text-muted hover:text-cyan'}`} aria-current={p===safePage?'page':undefined}>{p}</button>
            })}
            <button onClick={() => setPage(p=>Math.min(totalPages,p+1))} disabled={safePage===totalPages} className="px-2 py-1 rounded bg-card text-xs text-muted hover:text-cyan disabled:opacity-40 transition-colors">›</button>
            <button onClick={() => setPage(totalPages)} disabled={safePage===totalPages} className="px-2 py-1 rounded bg-card text-xs text-muted hover:text-cyan disabled:opacity-40 transition-colors">»</button>
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
    { label: 'Avg APY',       value: fmtApy(avgApy),               accent: 'text-violet-400' },
    { label: 'Era Range',     value: `${eraMin} – ${eraMax}`,      accent: 'text-text' },
    { label: 'Eras with Reward', value: eraCount,                  accent: 'text-cyan' },
    { label: 'Pools',         value: poolCount,                    accent: 'text-text' },
    { label: 'Best APY Era',  value: maxApyRow ? `Era ${maxApyRow.era} (${fmtApy(maxApyRow.apy)})` : '—', accent: 'text-warning' },
  ]

  return (
    <div className="bg-surface rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
        <h3 className="text-xs font-bold font-headline tracking-widest uppercase text-cyan">Summary</h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map(({ label, value, accent }) => (
          <div key={label} className="bg-card rounded-xl p-6 hover:bg-surface-bright text-center transition-colors">
            <p className="text-[10px] font-bold tracking-widest uppercase text-muted mb-1">{label}</p>
            <p className={`text-sm font-bold font-mono leading-tight ${accent}`}>{value}</p>
          </div>
        ))}
      </div>
      {bestPool && (
        <p className="mt-3 text-xs text-text-secondary">
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
    <div className="bg-surface rounded-xl p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
        <h3 className="text-xs font-bold font-headline tracking-widest uppercase text-cyan">Export Data</h3>
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
          className={`relative w-9 h-5 rounded-full transition-all flex-shrink-0 ${encOn?'bg-cyan':'bg-surface-bright'}`}>
          <span className={`absolute top-0.5 left-0 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${encOn?'translate-x-[18px]':'translate-x-0.5'}`} />
        </div>
        <span className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
          {encOn ? <Lock size={13} className="text-cyan" /> : <Unlock size={13} />}
          Encrypt Output (AES-256-GCM)
        </span>
      </div>
      {encOn && (
        <div className="mb-4 max-w-sm">
          <label htmlFor="rh-enc-pwd" className="block text-xs font-bold tracking-widest uppercase text-text-secondary mb-1.5">Encryption Password</label>
          <input id="rh-enc-pwd" type="password" placeholder="Enter password…" maxLength={1024}
            value={password} onChange={e => setPassword(e.target.value)}
            className="w-full bg-card rounded px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary" />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto] items-end">
        <div>
          <label htmlFor="rh-fname" className="block text-xs font-bold tracking-widest uppercase text-text-secondary mb-1.5">Filename</label>
          <input id="rh-fname" type="text" maxLength={200} autoComplete="off" spellCheck="false"
            placeholder={`reward-history-${(address||'').slice(0,10)}`}
            value={filename} onChange={e => setFilename(e.target.value)}
            className="w-full bg-card rounded px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary" />
        </div>
        <div>
          <label htmlFor="rh-fmt" className="block text-xs font-bold tracking-widest uppercase text-text-secondary mb-1.5">Format</label>
          <select id="rh-fmt" value={format} onChange={e => setFormat(e.target.value)}
            className="w-full bg-card rounded px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
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
          ${isDragOver?'border-cyan bg-cyan/10':'border-[rgba(70,71,82,0.10)] hover:border-primary hover:bg-surface-bright'}`}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={e => e.key==='Enter'&&fileInputRef.current?.click()}
        onDragOver={e=>{e.preventDefault();setIsDragOver(true)}}
        onDragLeave={()=>setIsDragOver(false)}
        onDrop={onDrop}>
        {isPending ? (
          <div className="flex flex-col items-center gap-2">
            <span className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <p className="text-sm text-text-secondary">Reading file…</p>
          </div>
        ) : (
          <>
            <FolderOpen size={32} className="mx-auto mb-3 text-text-secondary" />
            <p className="font-semibold text-text mb-1">Drop file here or click to browse</p>
            <p className="text-sm text-text-secondary">JSON or CSV exports from this tool (max {MAX_IMPORT_MB} MB)</p>
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
              <label htmlFor="rh-dec-pwd" className="block text-xs font-bold tracking-widest uppercase text-text-secondary mb-1.5">Password</label>
              <input id="rh-dec-pwd" type="password" placeholder="Enter password…" maxLength={1024}
                value={decPwd} onChange={e=>setDecPwd(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleDecrypt()}
                className="w-full bg-card rounded px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary" />
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
  const { status, results, logs, progress, csvCount, errorMsg, run, stop, reset, log } = useRewardHistory()

  const [tab,       setTab]      = useState('compute')  // 'compute' | 'import'
  const [address,   setAddress]  = useState('')

  // Era range mode
  const [rangeMode,   setRangeMode]   = useState('era')    // 'era' | 'date'
  const [startEra,    setStartEra]    = useState('')
  const [endEra,      setEndEra]      = useState('')
  const [startDate,   setStartDate]   = useState('')
  const [endDate,     setEndDate]     = useState('')
  const [activePreset,setActivePreset]= useState(null)

  // Imported results (separate from computed)
  const [importedResults, setImportedResults] = useState(null)

  // Include past pool interactions toggle
  const [includeHistory, setIncludeHistory] = useState(false)

  // Filtered rows (from table, drives chart + summary)
  const [filteredRows, setFilteredRows] = useState([])

  // Log drawer expanded state — used to push content above the fixed overlay
  const [logExpanded, setLogExpanded] = useState(false)

  // Live chain info — fetched from archive at mount
  const ARCHIVE_WSS = 'wss://archive.relay.blockchain.enjin.io'
  const [chainInfo, setChainInfo] = useState({ era: null, block: null, timestamp: null, loading: false })
  useEffect(() => {
    let cancelled = false
    setChainInfo({ era: null, block: null, timestamp: null, loading: true })
    log('info', `Fetching chain info from ${ARCHIVE_WSS}…`)
    fetchLiveChainInfo(ARCHIVE_WSS)
      .then(info => {
        if (!cancelled) {
          setChainInfo({ ...info, loading: false })
          log('info', `Chain info: era=${info.era != null ? info.era.toLocaleString() : '—'}, block=${info.block != null ? info.block.toLocaleString() : '—'}`)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setChainInfo({ era: null, block: null, timestamp: null, loading: false })
          log('warn', `Chain info fetch failed: ${err?.message ?? 'unknown error'}`)
        }
      })
    return () => { cancelled = true }
  }, [log])

  // Scroll to top on mount
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [])

  // Real-time validation (computed, no state)
  const addrErr = (() => {
    const t = address.trim()
    if (!t) return ''
    if (!t.startsWith('en')) return 'Relaychain addresses start with "en". Please enter a valid Relaychain address.'
    return ''
  })()

  const eraValidErr = (() => {
    if (rangeMode !== 'era') return ''
    const s = parseInt(startEra, 10), e = parseInt(endEra, 10)
    const cur = chainInfo.era
    if (startEra && (isNaN(s) || s < 1)) return 'Start era must be ≥ 1.'
    if (endEra   && (isNaN(e) || e < 1)) return 'End era must be ≥ 1.'
    if (startEra && cur && !isNaN(s) && s > cur) return `Era ${s} is in the future (current era: ${cur}).`
    if (endEra   && cur && !isNaN(e) && e > cur) return `Era ${e} is in the future (current era: ${cur}).`
    if (startEra && endEra && !isNaN(s) && !isNaN(e) && s > e) return 'Start era must be ≤ end era.'
    return ''
  })()

  const dateValidErr = (() => {
    if (rangeMode !== 'date') return ''
    const today = toDateInput(new Date())
    if (startDate && startDate > today) return 'Start date cannot be in the future.'
    if (endDate   && endDate   > today) return 'End date cannot be in the future.'
    if (startDate && endDate && startDate > endDate) return 'Start date must be ≤ end date.'
    return ''
  })()

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

  // ── Handle run ──────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    setImportedResults(null)
    if (rangeMode === 'era') {
      run({ address: address.trim(), startEra: parseInt(startEra,10), endEra: parseInt(endEra,10), endpoint: ARCHIVE_WSS, includeHistory })
    } else {
      // Convert dates to era range via CSV
      try {
        const eraData = await loadEraDataRH()
        const { startEra: s, endEra: e } = findErasForDateRange(eraData, startDate, endDate)
        run({ address: address.trim(), startEra: s, endEra: e, endpoint: ARCHIVE_WSS, includeHistory })
      } catch {
        // date era lookup failed — user will see dateValidErr
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
  }

  const showResults = (isDone || isStopped || importedResults) && activeResults.length > 0

  return (
    <div className={`space-y-4 transition-[padding] duration-200 ${logExpanded ? 'pb-[380px]' : 'pb-16'}`}>

      {/* ── Tabs ── */}
      <div className="bg-surface rounded-xl overflow-hidden">
        <div role="tablist" className="flex bg-card">
          {[
            { key: 'compute', label: 'Compute Rewards', icon: Server },
            { key: 'import',  label: 'Import Data',     icon: Upload },
          ].map(({ key, label, icon: Icon }) => (
            <button key={key} role="tab" aria-selected={tab===key}
              disabled={isLoading}
              onClick={() => setTab(key)}
              className={`flex items-center justify-center gap-1.5 flex-1 px-4 py-3
                text-xs sm:text-sm font-medium transition-colors disabled:opacity-50
                ${tab===key?'bg-surface-bright text-cyan':'text-muted hover:text-text'}`}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>

        {/* ── Compute pane ── */}
        {tab === 'compute' && (
          <div role="tabpanel" className="p-4 sm:p-5 space-y-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-primary flex-shrink-0" />
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                               bg-cyan/10 border border-cyan/25 text-[10px] font-semibold tracking-widest uppercase text-cyan">
                Relaychain
              </span>
              {csvCount > 0 && (
                <span className="ml-1 text-xs text-muted font-mono">{csvCount} eras in CSV</span>
              )}
            </div>

            <p className="text-xs text-text-secondary leading-relaxed">
              Computes staking rewards per era for pools you are staked in,
              using archive-node RPC. Subscan is only used when
              <span className="text-text/70"> Include past pool interactions </span>
              is enabled.
            </p>

            {/* Tax information note */}
            <div className="flex gap-2.5 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-[11px] text-text-secondary leading-relaxed space-y-1.5">
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

            {/* ── Live chain snapshot ──────────────────────────────── */}
            <div className="flex flex-wrap gap-x-5 gap-y-1 px-3 py-2 rounded-lg bg-card text-[11px] font-mono">
              <span className="text-text-secondary">Era:&nbsp;
                <span className="text-cyan">{chainInfo.loading ? '…' : (chainInfo.era != null ? chainInfo.era.toLocaleString() : '—')}</span>
              </span>
              <span className="text-text-secondary">Block:&nbsp;
                <span className="text-text">{chainInfo.loading ? '…' : (chainInfo.block != null ? chainInfo.block.toLocaleString() : '—')}</span>
              </span>
              <span className="text-text-secondary">Time:&nbsp;
                <span className="text-text">{chainInfo.loading ? '…' : (chainInfo.timestamp != null ? new Date(chainInfo.timestamp).toUTCString().replace(' GMT', ' UTC') : '—')}</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
              <h3 className="text-xs font-bold font-headline tracking-widest uppercase text-cyan">RPC Configuration</h3>
            </div>

            {/* Address */}
            <div className="space-y-1.5">
              <label className="text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary">Wallet Address</label>
              <input type="text" value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="en…" disabled={isLoading}
                className={`w-full bg-card rounded px-3 py-2 text-sm font-mono text-text placeholder:text-muted
                  focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50 transition-colors
                  ${addrErr ? 'border border-danger/50' : ''}`}
                maxLength={60} />
              {addrErr && (
                <p className="flex items-center gap-1 text-xs text-danger">
                  <AlertTriangle size={11} className="flex-shrink-0" />{addrErr}
                </p>
              )}
            </div>

            {/* Pool scope toggle */}
            <div className="p-3 rounded-lg bg-card space-y-1">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={includeHistory}
                  disabled={isLoading}
                  onClick={() => setIncludeHistory(v => !v)}
                  className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors focus-visible:outline-none
                    focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50
                    ${includeHistory ? 'bg-primary' : 'bg-surface-bright'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
                    ${includeHistory ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
                <span className="text-xs font-medium text-text">Include past pool interactions</span>
              </div>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                When enabled, also queries Subscan for pools this address
                has ever interacted with (bond, unbond, withdraw). Useful
                if you have exited a pool but want rewards from those eras.
              </p>
            </div>

            {/* Range mode toggle */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary">Query Mode</span>
              <div className="flex rounded-lg bg-card overflow-hidden">
                <button type="button" onClick={() => setRangeMode('era')} disabled={isLoading}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors
                    ${rangeMode==='era'?'bg-surface-bright text-cyan':'text-muted hover:text-text'}`}>
                  Era Range
                </button>
                <button type="button" onClick={() => setRangeMode('date')} disabled={isLoading}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors
                    ${rangeMode==='date'?'bg-surface-bright text-cyan':'text-muted hover:text-text'}`}>
                  <Calendar size={12} /> Date Range
                </button>
              </div>
            </div>

            {/* Era range inputs */}
            {rangeMode === 'era' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary">Start Era</label>
                  <input type="number" min="1" max={chainInfo.era ?? undefined} step="1" value={startEra}
                    onChange={e => setStartEra(e.target.value)}
                    placeholder="e.g. 980" disabled={isLoading}
                    className="w-full bg-card rounded px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary">End Era</label>
                  <input type="number" min="1" max={chainInfo.era ?? undefined} step="1" value={endEra}
                    onChange={e => setEndEra(e.target.value)}
                    placeholder="e.g. 1000" disabled={isLoading}
                    className="w-full bg-card rounded px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50" />
                </div>
                {eraValidErr && <p className="col-span-2 flex items-center gap-1 text-xs text-danger"><AlertTriangle size={11} className="flex-shrink-0" />{eraValidErr}</p>}
              </div>
            )}

            {/* Date range inputs */}
            {rangeMode === 'date' && (
              <div className="space-y-3">
                {/* Quick presets */}
                <div>
                  <span className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">Quick Range</span>
                  <div className="flex flex-wrap gap-2">
                    {DATE_PRESETS.map(({ label, days }) => (
                      <button key={label} type="button"
                        onClick={() => applyDatePreset(days, label)}
                        disabled={isLoading}
                        className={`px-2.5 py-1 rounded-md text-[11px] transition-colors disabled:opacity-50
                          ${activePreset===label
                            ?'bg-primary/15 text-primary font-semibold'
                            :'bg-card text-text-secondary hover:bg-surface-bright hover:text-text'}`}>
                        {label} ago
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary">Start Date</label>
                    <input type="date" placeholder="2026-03-01" max={toDateInput(new Date())} value={startDate}
                      onChange={e => { setStartDate(e.target.value); setActivePreset(null) }}
                      disabled={isLoading}
                      className="w-full bg-card rounded px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50 [color-scheme:dark]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary">End Date</label>
                    <input type="date" placeholder="2026-03-04" max={toDateInput(new Date())} value={endDate}
                      onChange={e => { setEndDate(e.target.value); setActivePreset(null) }}
                      disabled={isLoading}
                      className="w-full bg-card rounded px-3 py-2 text-sm font-mono text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:opacity-50 [color-scheme:dark]" />
                  </div>
                </div>
                {dateValidErr && <p className="flex items-center gap-1 text-xs text-danger"><AlertTriangle size={11} className="flex-shrink-0"/>{dateValidErr}</p>}
              </div>
            )}

            {/* Action button — single slot: Stop → Reset → Compute Rewards */}
            <div className="flex flex-wrap gap-2">
              {isLoading ? (
                <button onClick={stop} className="btn-danger gap-1.5 px-5">
                  <Square size={14} />Stop
                </button>
              ) : (isDone || isStopped || isError || importedResults) ? (
                <button onClick={() => { reset(); setImportedResults(null) }} className="btn-primary gap-1.5 px-5">
                  <RotateCcw size={14} />Reset
                </button>
              ) : (
                <button onClick={handleRun} className="btn-primary gap-1.5 px-5"
                  disabled={!address.trim() || !!addrErr || (rangeMode === 'era' ? (!startEra || !endEra || !!eraValidErr) : (!startDate || !endDate || !!dateValidErr))}>
                  <Play size={14} />Compute Rewards
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
              <h3 className="text-xs font-bold font-headline tracking-widest uppercase text-cyan">Import Reward Data</h3>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">
              Import previously exported reward history (JSON or CSV). Encrypted files (.enc.json) are also supported.
            </p>
            <RewardImportPanel onImport={handleImportResults} />
          </div>
        )}
      </div>

      {/* ── Progress ── */}
      {isLoading && phases.length > 0 && (
        <section className="bg-surface rounded-xl p-4 space-y-3" aria-live="polite">
          <div className="flex items-center justify-between text-xs mb-1">
            <p className="text-text-secondary">{allDone ? 'Complete!' : (activePhase?.label ?? 'Computing…')}</p>
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
                <div key={ph.key} className="flex items-center justify-between text-[11px] bg-card rounded px-2.5 py-1.5">
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
        <div className="bg-surface rounded-xl p-4 border border-danger/30 bg-danger/5">
          <p className="text-sm text-danger">{errorMsg}</p>
        </div>
      )}

      {/* ── Stopped ── */}
      {isStopped && !activeResults.length && (
        <div className="bg-surface rounded-xl p-4 border border-warning/30 bg-warning/5">
          <p className="text-sm text-warning">Computation stopped before results were available.</p>
        </div>
      )}

      {/* ── Empty result ── */}
      {isDone && !activeResults.length && (
        <div className="bg-surface rounded-xl p-6 text-center">
          <p className="text-sm text-text-secondary">No rewards found for the given address and era range.</p>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PoolBondedPieChart data={filteredRows} />
            <PoolRewardPieChart data={filteredRows} />
          </div>
          {!importedResults && <RewardExportPanel results={activeResults} address={address} />}
          {importedResults && (
            <div className="flex items-center gap-2 text-xs text-text-secondary px-1">
              <span>Showing imported data.</span>
              <button onClick={() => setImportedResults(null)} className="text-violet-400 hover:underline">Clear import</button>
            </div>
          )}
        </>
      )}

      {/* ── Sticky terminal log — always visible ── */}
      <TerminalLog logs={logs} sticky onExpandChange={setLogExpanded} />
    </div>
  )
}
