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
  Play, Square, RotateCcw, Download,
  ChevronDown, Lock, Unlock,
  AlertTriangle, Info, FileDown,
} from 'lucide-react'
import { useRewardHistory, RH_STATUS } from '../hooks/useRewardHistory.js'
import { fetchLiveChainInfo } from '../utils/chainInfo.js'
import PhaseProgressCards from './PhaseProgressCards.jsx'
import StepProgress from './StepProgress.jsx'
import TerminalLog from './TerminalLog.jsx'
import ToolInfoSection from './ToolInfoSection.jsx'
import RewardImportPanel from './RewardImportPanel.jsx'
import ToolModeStrip from './ToolModeStrip.jsx'
import { PLANCK_PER_ENJ, SUBSCAN_HISTORY_DAYS, MAX_SCAN_DAYS, MAX_REWARD_ERA_SPAN } from '../constants.js'
import { aesEncryptLabelled, downloadFile, safeFilename, parseBigInt, splitCsvRow } from '../utils/balanceExport.js'
import { SCAN_SCHEMAS, envelopeHeader, readLegacyHeader } from '../utils/scanEnvelope.js'
import { formatExportedAtUTC } from '../utils/format.js'
import Spinner from './Spinner.jsx'
import Field from './Field.jsx'
import Skeleton from './Skeleton.jsx'
import HoldButton from './HoldButton.jsx'
import ScanStatusBar from './ScanStatusBar.jsx'

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

// Two separate ceilings applied here. Subscan's free-plan history window is the
// past 3 months, which already ruled out 6-month/1-year presets. The binding
// limit now is MAX_SCAN_DAYS: the reward sweep is (eras × pools) archive reads,
// so a month-long range is minutes of querying. Presets that always error are
// worse than no preset, so the list is capped rather than left to be rejected.
const DATE_PRESETS = [
  { label: '1 day',  days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
]

function estimateRewardEraSpan(rangeMode, startEra, endEra, startDate, endDate) {
  if (rangeMode === 'era') {
    const s = parseInt(startEra, 10)
    const e = parseInt(endEra, 10)
    if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) return null
    return (e - s) + 1
  }

  if (rangeMode === 'date') {
    const startMs = new Date(startDate).getTime()
    const endMs = new Date(endDate).getTime()
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return null
    return Math.round((endMs - startMs) / 86_400_000) + 1
  }

  return null
}

const REWARD_RANGE_MODE_OPTIONS = [
  { key: 'era', badge: 'ERA', title: 'Era Range', description: 'Use exact era numbers for the reward window.' },
  { key: 'date', badge: 'DAY', title: 'Date Range', description: 'Use dates and let the app estimate the eras.' },
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

/**
 * Serialise to JSON.
 *
 * The shared header is spread across the existing flat shape rather than
 * wrapping it, so a build predating the header still recognises and reads the
 * file — see scanEnvelope.js. `exportedAt` therefore appears twice: once in
 * the header, once inside `_meta` where older builds look for it.
 */
function rewardToJSON(results, meta) {
  return JSON.stringify({
    ...envelopeHeader(SCAN_SCHEMAS.REWARD),
    _meta: meta,
    records: results.map(rewardToObj),
  }, null, 2)
}

function rewardToCSV(results, meta) {
  const H = Object.keys(rewardToObj(results[0] || {}))
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  // The original marker line stays first so an older build's sniff still
  // matches; the provenance lines are additive.
  const header = envelopeHeader(SCAN_SCHEMAS.REWARD)
  const comments = [
    '# enjin_reward_history_export',
    `# tool: ${header.tool}`,
    `# schema: ${header.schema}`,
    `# schemaVersion: ${header.schemaVersion}`,
    `# appVersion: ${header.appVersion}`,
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
  const header = envelopeHeader(SCAN_SCHEMAS.REWARD)
  const metaXml = [
    '  <meta>',
    `    <tool>${ex(header.tool)}</tool>`,
    `    <schema>${ex(header.schema)}</schema>`,
    `    <schemaVersion>${ex(header.schemaVersion)}</schemaVersion>`,
    `    <appVersion>${ex(header.appVersion)}</appVersion>`,
    `    <address>${ex(meta.address ?? '')}</address>`,
    `    <exportedAt>${ex(meta.exportedAt)}</exportedAt>`,
    '  </meta>',
  ].join('\n')
  const rows = results.map(r => {
    const o = rewardToObj(r)
    return '  <record>\n' + Object.entries(o).map(([k, v]) => `    <${k}>${ex(v)}</${k}>`).join('\n') + '\n  </record>'
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<enjinRewardHistory>\n${metaXml}\n${rows}\n</enjinRewardHistory>`
}

/**
 * Rebuild a header object from a CSV comment block's `# key: value` lines.
 *
 * Yields an object with no `tool` key for a file predating the header, which is
 * what makes `readLegacyHeader` fall through to the caller's own sniff.
 */
function commentHeader(comments) {
  const out = {}
  for (const c of comments) {
    const m = c.match(/^#\s*(tool|schema|schemaVersion|appVersion|exportedAt):\s*(.+)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

/** Parse imported reward JSON/CSV back into result rows. Exported for tests. */
export function parseRewardImport(text, ext) {
  // ── Shared row mapper ─────────────────────────────────────────────────────
  function mapRow(r) {
    return {
      era:             Number(r.era ?? r.Era ?? 0),
      poolId:          Number(r.pool_id ?? r.poolId ?? 0),
      poolLabel:       String(r.pool_label ?? r.poolLabel ?? ''),
      eraStartBlock:   r.era_start_block != null ? Number(r.era_start_block) : null,
      eraStartDateUtc: r.era_date_utc || r.eraStartDateUtc || null,
      memberBalance:   parseBigInt(r.member_senj ?? r.memberBalance, { field: 'member_senj' }),
      poolSupply:      parseBigInt(r.pool_supply_senj ?? r.poolSupply, { field: 'pool_supply_senj' }),
      reinvested:      parseBigInt(r.reinvested_enj ?? r.reinvested, { field: 'reinvested_enj' }),
      reward:          parseBigInt(r.reward_enj ?? r.reward, { field: 'reward_enj' }),
      accumulated:     parseBigInt(r.cumulative_enj ?? r.accumulated, { field: 'cumulative_enj' }),
      apy:             parseFloat(r.apy_pct ?? r.apy ?? '0') || 0,
      rollingApy:      parseFloat(r.rolling_apy_pct ?? r.rollingApy ?? '') || undefined,
    }
  }

  if (ext === 'json') {
    let parsed
    try { parsed = JSON.parse(text) } catch { throw new Error('JSON parse failed.') }
    // Validates the shared header when present, throwing by name if the file
    // belongs to another tool; returns null for a headerless legacy export,
    // which the shape check below still accepts.
    const header = readLegacyHeader(parsed, SCAN_SCHEMAS.REWARD)
    const arr = Array.isArray(parsed) ? parsed : parsed?.records
    if (!Array.isArray(arr)) throw new Error('Expected JSON array or {records:[]}.')
    return { results: arr.map(mapRow), meta: parsed?._meta ?? null, header }
  }

  if (ext === 'csv') {
    const allLines = text.trim().split(/\r?\n/)
    const comments  = allLines.filter(l => l.startsWith('#'))
    const dataLines = allLines.filter(l => !l.startsWith('#'))
    if (dataLines.length < 2) throw new Error('CSV has no data rows.')
    // Header lines are comments, so the same validation applies.
    const header = readLegacyHeader(commentHeader(comments), SCAN_SCHEMAS.REWARD)
    let address = ''
    comments.forEach(c => { const m = c.match(/^# address:\s*(.+)/); if (m) address = m[1].trim() })
    const headers = splitCsvRow(dataLines[0])
    const idx = k => headers.indexOf(k)
    const results = dataLines.slice(1).map((row, i) => {
      const c = splitCsvRow(row)
      const g = k => c[idx(k)] ?? ''
      try {
        return mapRow({
          era: g('era'), pool_id: g('pool_id'), pool_label: g('pool_label'),
          era_start_block: g('era_start_block'), era_date_utc: g('era_date_utc'),
          member_senj: g('member_senj'), pool_supply_senj: g('pool_supply_senj'),
          reinvested_enj: g('reinvested_enj'), reward_enj: g('reward_enj'),
          cumulative_enj: g('cumulative_enj'), apy_pct: g('apy_pct'),
          rolling_apy_pct: g('rolling_apy_pct'),
        })
      } catch (e) {
        // +2: one for the header row, one for 1-based line numbering.
        throw new Error(`CSV row ${i + 2}: ${e.message}`, { cause: e })
      }
    })
    return { results, meta: address ? { address } : null, header }
  }

  if (ext === 'xml') {
    const doc = new DOMParser().parseFromString(text, 'text/xml')
    if (doc.querySelector('parsererror')) throw new Error('XML parse failed.')
    const g = (el, k) => el.querySelector(k)?.textContent ?? ''
    const results = Array.from(doc.querySelectorAll('record')).map(r =>
      mapRow({
        era: g(r,'era'), pool_id: g(r,'pool_id'), pool_label: g(r,'pool_label'),
        era_start_block: g(r,'era_start_block'), era_date_utc: g(r,'era_date_utc'),
        member_senj: g(r,'member_senj'), pool_supply_senj: g(r,'pool_supply_senj'),
        reinvested_enj: g(r,'reinvested_enj'), reward_enj: g(r,'reward_enj'),
        cumulative_enj: g(r,'cumulative_enj'), apy_pct: g(r,'apy_pct'),
        rolling_apy_pct: g(r,'rolling_apy_pct'),
      })
    )
    const metaEl = doc.querySelector('meta')
    // Header elements live inside <meta>, so the same validation applies.
    const header = readLegacyHeader({
      tool:          g(metaEl, 'tool') || undefined,
      schema:        g(metaEl, 'schema'),
      schemaVersion: g(metaEl, 'schemaVersion'),
      appVersion:    g(metaEl, 'appVersion'),
      exportedAt:    g(metaEl, 'exportedAt'),
    }, SCAN_SCHEMAS.REWARD)
    const meta = metaEl ? { address: g(metaEl,'address'), exportedAt: g(metaEl,'exportedAt') } : null
    return { results, meta, header }
  }

  throw new Error('Unsupported format.')
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

    // One dataset per pool, plotting cumulative ENJ (r.accumulated) over eras
    const allEras   = [...new Set(data.map(r => r.era))].sort((a, b) => a - b)
    const poolIds   = [...new Set(data.map(r => r.poolId))].sort((a, b) => a - b)

    // Design-token colours cycling across pools
    const POOL_COLORS = [
      { line: '#b6a0ff', fill: 'rgba(182,160,255,0.12)' },
      { line: '#00d9ff', fill: 'rgba(0,217,255,0.10)' },
      { line: '#8eff71', fill: 'rgba(142,255,113,0.10)' },
      { line: '#f59e0b', fill: 'rgba(245,158,11,0.10)' },
      { line: '#ef4444', fill: 'rgba(239,68,68,0.10)' },
    ]

    const datasets = poolIds.map((poolId, idx) => {
      const poolRows = data.filter(r => r.poolId === poolId)
      const eraMap   = new Map(poolRows.map(r => [r.era, r]))
      const clr      = POOL_COLORS[idx % POOL_COLORS.length]
      const lbl      = poolRows[0]?.poolLabel ?? `Pool #${poolId}`
      return {
        label:           lbl,
        data:            allEras.map(era => {
          const row = eraMap.get(era)
          return row ? Number(row.accumulated) / 1e18 : null
        }),
        borderColor:     clr.line,
        backgroundColor: clr.fill,
        fill:            true,
        tension:         0.35,
        borderWidth:     2.5,
        pointRadius:     0,
        pointHoverRadius: 4,
        spanGaps:        true,
      }
    })

    import('chart.js/auto').then(({ Chart }) => {
      if (destroyed) return
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }

      chartRef.current = new Chart(canvasRef.current, {
        type: 'line',
        data: { labels: allEras, datasets },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          interaction:         { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: true,
              labels: { color: '#A0A0C8', font: { size: 11 }, boxWidth: 12, padding: 16, usePointStyle: true },
            },
            tooltip: {
              backgroundColor: 'rgba(23,25,36,0.97)',
              borderColor:     'rgba(70,71,82,0.3)',
              borderWidth:     1,
              titleColor:      '#b6a0ff',
              bodyColor:       '#A0A0C8',
              padding:         10,
              callbacks: {
                title: ctx => `Era ${ctx[0]?.label}`,
                label: ctx => ctx.raw == null ? null
                  : ` ${ctx.raw.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ENJ`,
              },
            },
          },
          scales: {
            x: {
              ticks: { color: '#6B6B8A', font: { size: 10 }, maxTicksLimit: 12 },
              grid:  { color: 'rgba(70,71,82,0.15)', drawBorder: false },
              title: { display: true, text: 'Era', color: '#6B6B8A', font: { size: 11 } },
            },
            y: {
              ticks: { color: '#b6a0ff', font: { size: 10 } },
              grid:  { color: 'rgba(70,71,82,0.15)', drawBorder: false },
              title: { display: true, text: 'Cumulative ENJ', color: '#b6a0ff', font: { size: 11 } },
              beginAtZero: true,
            },
          },
        },
        plugins: [crosshairPlugin],
      })
    })

    return () => { destroyed = true; chartRef.current?.destroy(); chartRef.current = null }
  }, [data])

  const uniqueEras = [...new Set(data.map(r => r.era))]
  if (!data.length || uniqueEras.length < 2) return null
  return (
    <div className="data-panel">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="font-headline text-xl font-bold text-text">Reward Growth</h3>
          <p className="mt-1 text-xs text-text-secondary">Cumulative ENJ rewards per pool over selected eras</p>
        </div>
      </div>
      <div className="rounded-sm border border-[var(--hairline)] bg-card p-3" style={{ height: '320px' }}>
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
    <div className="flex flex-col data-panel">
      <div className="mb-3">
        <p className="section-label">Allocation</p>
        <h3 className="mt-2 font-headline text-2xl font-bold text-text">My Bonded ENJ by Pool</h3>
        <p className="mt-2 text-xs text-text-secondary">(wallet share, latest era per pool)</p>
      </div>
      <div className="rounded-sm border border-[var(--hairline)] bg-card p-3" style={{ height: '240px' }}>
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
    <div className="flex flex-col data-panel">
      <div className="mb-3">
        <p className="section-label">Distribution</p>
        <h3 className="mt-2 font-headline text-2xl font-bold text-text">Reward ENJ by Pool</h3>
        <p className="mt-2 text-xs text-text-secondary">(aggregated across filtered eras)</p>
      </div>
      <div className="rounded-sm border border-[var(--hairline)] bg-card p-3" style={{ height: '240px' }}>
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
        className="flex min-w-[130px] items-center justify-between gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs text-text transition-colors hover:bg-surface-bright"
      >
        <span className={allSelected ? 'text-text-secondary' : 'text-cyan font-semibold'}>{countLabel}</span>
        <ChevronDown size={10} className={`text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 max-h-64 min-w-[220px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-sm bg-card py-1 shadow-xl shadow-black/40 sm:left-0 sm:right-auto">
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
              <span className="max-w-[220px] whitespace-normal break-words text-xs text-text" title={label}>{label}</span>
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
    tooltip: 'Total ENJ the entire pool reinvested this era, net of the pool operator\'s commission, automatically compounded back into the pool\'s bonded stake. This is pool-wide — not wallet-specific.' },
  { key: 'reward',       label: 'Reward ENJ',     align: 'right', sortable: true,
    tooltip: 'Your wallet\'s share of the pool\'s reinvested reward (net of operator commission): (your sENJ ÷ total pool sENJ) × Reinvested ENJ. The ENJ that accrued to your position this era.' },
  { key: 'accumulated',  label: 'Cumulative ENJ', align: 'right', sortable: true,
    tooltip: 'Running total of your Reward ENJ across all eras in the result set, per pool.' },
  { key: 'apy',          label: 'APY*',           align: 'right', sortable: true,
    tooltip: 'Per-era annualised yield: ((bonded ENJ + reinvested) ÷ bonded ENJ)^365 − 1, where reinvested is net of operator commission. An estimate — actual returns vary each era.' },
  { key: 'rollingApy',   label: 'APY 15d*',       align: 'right', sortable: true,
    tooltip: 'Rolling 15-era APY: the same formula compounded over a sliding 15-era window and annualised. Smooths out single-era spikes.' },
]

const PAGE_SIZES = [10, 25, 50, 100]

// ── RewardTable v2 — exposes filtered rows via prop ──────────────────────────
function RewardTableV2({ results, onFilter, isLoading = false }) {
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
    // .filter() below always returns a fresh array, but when no filter is
    // active `rows` stays the `results` reference straight through to .sort(),
    // which mutates in place — silently reordering the hook's own state out
    // from under any other consumer of it (e.g. the chart and summary).
    let rows = results.slice()
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
  // onFilter is RewardHistoryViewer's setFilteredRows — a useState setter, so
  // it is referentially stable and including it cannot cause extra re-runs.
  useEffect(() => { onFilter?.(filtered) }, [filtered, onFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage   = Math.min(page, totalPages)
  const pageSlice  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <div className="data-panel">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-headline text-2xl font-bold text-text">Ledger Data</h3>
          <p className="mt-1 text-xs text-text-secondary">Deep-dive into per-era nomination performance</p>
        </div>
        <span className="mini-chip">{filtered.length} / {results.length} rows</span>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
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
            aria-label="Minimum era"
            className="w-20 input-field font-mono !rounded-full" />
          <span className="text-text-secondary text-xs">–</span>
          <input type="number" placeholder="Max" value={filterEraMax}
            onChange={e => { setFilterEraMax(e.target.value); setPage(1) }}
            aria-label="Maximum era"
            className="w-20 input-field font-mono !rounded-full" />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-[10px] font-bold tracking-widest uppercase text-text-secondary">Per page:</span>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
            className="select-compact">
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-sm bg-card/70 p-1">
        <table className="border-collapse text-xs font-mono w-full min-w-max">
          <caption className="sr-only">Per-era pool reward history</caption>
          <thead className="sticky top-0 z-10">
            <tr>
              {TABLE_COLS.map(col => {
                const isSorted = sortCol === col.key
                const directionLabel = isSorted
                  ? `sorted ${sortDir === 1 ? 'ascending' : 'descending'}`
                  : 'not sorted'
                return (
                  <th key={col.key}
                    scope="col"
                    aria-sort={col.sortable ? (isSorted ? (sortDir === 1 ? 'ascending' : 'descending') : 'none') : undefined}
                    className={`bg-surface-high px-3 py-3 font-bold tracking-widest
                                uppercase whitespace-nowrap text-[10px]
                                relative group
                                ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(col.key)}
                        className={`select-none transition-colors ${isSorted ? 'text-cyan' : 'text-primary/70 hover:text-cyan'}`}
                        aria-label={`Sort by ${col.label} (${directionLabel})`}
                      >
                        {col.label}{isSorted && (sortDir === 1 ? ' ↑' : ' ↓')}
                      </button>
                    ) : (
                      <span className="text-primary/70">{col.label}</span>
                    )}
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
              <tr key={`${r.era}-${r.poolId}`} className={`transition-colors hover:bg-surface-bright/80 ${i % 2 ? 'bg-card' : ''}`}>
                <td className="px-3 py-1.5 text-cyan font-bold">{r.era}</td>
                <td className="px-3 py-1.5 text-text-secondary whitespace-nowrap">{fmtDate(r.eraStartDateUtc)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-primary/20 text-[10px] font-bold text-primary">
                    {r.poolId}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-text min-w-[180px]" title={getPoolName(r)}>{getPoolName(r)}</td>
                <td className="px-3 py-1.5 text-right text-text">{fmtEnj(r.memberBalance)}</td>
                <td className="px-3 py-1.5 text-right text-success">{fmtEnj(r.reinvested)}</td>
                <td className="px-3 py-1.5 text-right text-success font-semibold">{fmtEnj(r.reward)}</td>
                <td className="px-3 py-1.5 text-right text-cyan">{fmtEnj(r.accumulated)}</td>
                <td className="px-3 py-1.5 text-right">
                  <span className="inline-block px-2 py-0.5 rounded bg-cyan/10 text-cyan text-[10px] font-bold">{fmtApy(r.apy)}</span>
                </td>
                {/* Rolling APY needs a 15-era window per pool, so it is only
                    computed once every row has landed. Until then a dash would
                    be indistinguishable from a genuine zero/absent APY, which
                    fmtApy also renders as a dash — the skeleton says "still
                    coming" instead of "nothing here". */}
                <td className="px-3 py-1.5 text-right text-violet-300">
                  {isLoading && r.rollingApy === undefined
                    ? <Skeleton.Line width="2.5rem" height="0.75rem" className="ml-auto" />
                    : fmtApy(r.rollingApy)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>



      {/* Pagination */}
      {filtered.length > pageSize && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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
  // All of this is a pure function of `results` alone. Previously recomputed
  // on every render — two full sorts, three Set builds, and two spread
  // Math.min/max calls that would also blow the argument limit on a large
  // result set — regardless of whether `results` had actually changed.
  const summary = useMemo(() => {
    if (!results.length) return null

    let eraMin = Infinity, eraMax = -Infinity
    const poolIds = new Set()
    const eraIds  = new Set()
    const byPool  = new Map()

    for (const r of results) {
      if (r.era < eraMin) eraMin = r.era
      if (r.era > eraMax) eraMax = r.era
      poolIds.add(r.poolId)
      eraIds.add(r.era)
      const cur = byPool.get(r.poolId) ?? { label: r.poolLabel, total: 0n, rows: 0 }
      byPool.set(r.poolId, { label: cur.label, total: cur.total + r.reward, rows: cur.rows + 1 })
    }

    const totalReward  = results.reduce((s, r) => s + r.reward, 0n)
    const avgApy       = results.reduce((s, r) => s + r.apy, 0) / results.length
    const maxApyRow    = [...results].sort((a, b) => b.apy - a.apy)[0]
    const maxRewardRow = [...results].sort((a, b) => (b.reward > a.reward ? 1 : -1))[0]
    const bestPool      = [...byPool.entries()].sort((a, b) => (b[1].total > a[1].total ? 1 : -1))[0]

    return {
      totalReward, avgApy, maxApyRow, maxRewardRow, bestPool,
      poolCount: poolIds.size, eraCount: eraIds.size, eraMin, eraMax,
    }
  }, [results])

  if (!summary) return null
  const { totalReward, avgApy, poolCount, eraCount, bestPool } = summary

  const stats = [
    { label: 'Total Rewards',    value: `${fmtEnj(totalReward)}`, unit: 'ENJ', accent: 'text-success',      border: 'metric-card-left-success' },
    { label: 'Average APY',      value: fmtApy(avgApy),            unit: null,  accent: 'text-violet-400',   border: 'metric-card-left-primary' },
    { label: 'Era Range',        value: `${eraCount} Eras`,        unit: null,  accent: 'text-cyan',          border: 'metric-card-left-cyan' },
    { label: 'Number of Pools',  value: `${poolCount} Active`,     unit: null,  accent: 'text-text',          border: 'metric-card-left-warning' },
  ]

  return (
    <div className="data-panel">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-headline text-2xl font-bold text-text">Reward Overview</h3>
          <p className="mt-1 text-xs text-text-secondary">Aggregated across all filtered eras</p>
        </div>
        {bestPool && (
          <p className="text-xs text-text-secondary">
            Best pool: <span className="text-text font-semibold">{bestPool[1].label}</span>
            {' · '}{fmtEnj(bestPool[1].total)} ENJ over {bestPool[1].rows} era(s)
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(({ label, value, unit, accent, border }) => (
          <div key={label} className={`metric-card ${border}`}>
            <p className="metric-label">{label}</p>
            <p className={`mt-2 font-headline text-2xl font-bold leading-tight ${accent}`}>
              {value}{unit && <span className="text-xs font-body text-primary-dim uppercase tracking-wide ml-1">{unit}</span>}
            </p>
          </div>
        ))}
      </div>
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
        content = await aesEncryptLabelled(content, password, SCAN_SCHEMAS.REWARD)
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
    <div className="data-panel">
      <div className="mb-4">
        <p className="section-label">Export</p>
        <h3 className="mt-2 font-headline text-2xl font-bold text-text">Save reward dataset</h3>
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
          <Field label="Encryption Password" id="rh-enc-pwd" type="password" placeholder="Enter password…" maxLength={1024}
            value={password} onChange={e => setPassword(e.target.value)}
            controlClassName="font-mono" />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto] items-end">
        <div>
          <Field label="Filename" id="rh-fname" type="text" maxLength={200} autoComplete="off" spellCheck="false"
            placeholder={`reward-history-${(address||'').slice(0,10)}`}
            value={filename} onChange={e => setFilename(e.target.value)}
            controlClassName="font-mono" />
        </div>
        <div>
          <label htmlFor="rh-fmt" className="block text-xs font-bold tracking-widest uppercase text-text-secondary mb-2">Format</label>
          <select id="rh-fmt" value={format} onChange={e => setFormat(e.target.value)}
            className="w-full select-field">
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
            <option value="xml">XML</option>
          </select>
        </div>
        <button onClick={handleExport} disabled={busy||!results.length}
          className="btn-primary py-2 px-5 disabled:opacity-40 self-end">
          {busy ? <Spinner size={16} tone="on-primary" /> : <Download size={14} />}
          Export
        </button>
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────
const RH_SIMPLE_STEPS = [
  { key: 'address',  label: 'Address'  },
  { key: 'mode',     label: 'Mode'     },
  { key: 'range',    label: 'Range'    },
  { key: 'running',  label: 'Running'  },
  { key: 'results',  label: 'Results'  },
]

export default function RewardHistoryViewer({ onScanStateChange, simpleMode = false }) {
  const { status, results, logs, progress, errorMsg, run, stop, reset, log } = useRewardHistory()

  const [tab,       setTab]      = useState('query')  // 'query' | 'import'
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
  const [importMeta, setImportMeta] = useState(null)
  const [importedAddress, setImportedAddress] = useState('')

  // Include past pool interactions toggle
  const [includeHistory, setIncludeHistory] = useState(false)

  // Filtered rows (from table, drives chart + summary)
  const [filteredRows, setFilteredRows] = useState([])
  const resultsRef = useRef(null)
  const previousStatusRef = useRef(null)

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
    if (startEra && endEra && !isNaN(s) && !isNaN(e) && (e - s + 1) > MAX_REWARD_ERA_SPAN)
      return `Era span is limited to ${MAX_REWARD_ERA_SPAN} eras (requested ${e - s + 1}). Narrow the range and run again.`
    return ''
  })()

  const dateValidErr = (() => {
    if (rangeMode !== 'date') return ''
    const today = toDateInput(new Date())
    if (startDate && startDate > today) return 'Start date cannot be in the future.'
    if (endDate   && endDate   > today) return 'End date cannot be in the future.'
    if (startDate && endDate && startDate > endDate) return 'Start date must be ≤ end date.'
    if (startDate && endDate) {
      const spanDays = Math.round((new Date(endDate) - new Date(startDate)) / 86_400_000) + 1
      if (spanDays > MAX_SCAN_DAYS)
        return `Date range is limited to ${MAX_SCAN_DAYS} days (requested ${spanDays}). Narrow the range and run again.`
    }
    return ''
  })()
  const estimatedEraSpan = estimateRewardEraSpan(rangeMode, startEra, endEra, startDate, endDate)

  const [rhPage, setRhPage] = useState(1)
  const [rhSimpleRunning, setRhSimpleRunning] = useState(false)
  const [simpleInfoOpen, setSimpleInfoOpen] = useState(false)

  const isLoading = status === RH_STATUS.LOADING
  const isDone    = status === RH_STATUS.DONE
  const isStopped = status === RH_STATUS.STOPPED
  const isError   = status === RH_STATUS.ERROR
  const rhSimpleStep = (isLoading && rhSimpleRunning) ? 4
    : ((isDone || isStopped || isError) && rhSimpleRunning) ? 5
    : rhPage
  // isStopped/isError also land on step 5 above, so only isDone earns the check.
  const rhSimpleComplete = rhSimpleStep === RH_SIMPLE_STEPS.length && isDone

  useEffect(() => {
    onScanStateChange?.(isLoading)
  }, [isLoading, onScanStateChange])

  useEffect(() => () => {
    onScanStateChange?.(false)
  }, [onScanStateChange])

  // Active results: computed or imported
  const activeResults = importedResults ?? results

  // Progress state
  const phases      = progress?.phases ?? []
  const activePhase = phases.find(p => p.status === 'in_progress') ?? phases.find(p => p.status === 'pending') ?? phases[phases.length - 1]
  const phasePct    = activePhase && activePhase.total > 0
    ? Math.min(100, Math.round(activePhase.completed / activePhase.total * 100))
    : 0
  const allDone     = phases.length > 0 && phases.every(p => p.status === 'completed')
  const completedPhaseCount = phases.filter(p => p.status === 'completed').length
  const progressMeta = activePhase && activePhase.total > 0
    ? `${activePhase.completed ?? 0} / ${activePhase.total} (${phasePct}%)`
    : `${completedPhaseCount} / ${phases.length} phases complete`
  const progressSummary = allDone
    ? 'All reward-history phases completed successfully.'
    : isStopped
      ? 'The computation was stopped before every phase completed.'
      : null

  // Pre-scan placeholder phases (shown before any run starts)
  const previewPhases = useMemo(() => [
    { key: 'csv',       label: 'Load Era Reference',           status: 'pending', total: 1, completed: 0 },
    { key: 'poolnames', label: 'Fetch Pool Names',             status: 'pending', total: 1, completed: 0 },
    { key: 'connect',   label: 'Connect to Archive Node',      status: 'pending', total: 1, completed: 0 },
    { key: 'pools',     label: 'Discover Pool Membership',     status: 'pending', total: 1, completed: 0 },
    ...(includeHistory ? [{ key: 'history', label: 'Fetch Past Pool Interactions', status: 'pending', total: 1, completed: 0 }] : []),
    { key: 'balances',  label: 'Query Era Balances',           status: 'pending', total: 1, completed: 0 },
    { key: 'rewards',   label: 'Fetch Reinvested Amounts',     status: 'pending', total: 0, completed: 0 },
  ], [includeHistory])
  const displayPhases   = phases.length > 0 ? phases : previewPhases
  const displaySummary  = phases.length > 0 ? progressSummary : null
  const displayMeta     = phases.length > 0 ? progressMeta    : null
  const liveChainSnapshot = (
    <div className="grid grid-cols-2 gap-2 sm:gap-3">
      <div className="metric-card metric-card-left-cyan py-2.5">
        <p className="metric-label">Live Era</p>
        <p className="mt-1 truncate font-mono text-base font-semibold leading-tight text-cyan sm:text-lg" style={{ fontVariantNumeric: 'tabular-nums' }}>{chainInfo.loading ? '…' : (chainInfo.era != null ? chainInfo.era.toLocaleString() : '—')}</p>
      </div>
      <div className="metric-card metric-card-left-primary py-2.5">
        <p className="metric-label">Live Block</p>
        <p className="mt-1 truncate font-mono text-base font-semibold leading-tight text-text sm:text-lg" style={{ fontVariantNumeric: 'tabular-nums' }}>{chainInfo.loading ? '…' : (chainInfo.block != null ? chainInfo.block.toLocaleString() : '—')}</p>
      </div>
    </div>
  )

  // Sync filtered rows when results change
  useEffect(() => {
    setFilteredRows(activeResults)
  }, [activeResults])

  // ── Handle run ──────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    setImportedResults(null)
    setRhSimpleRunning(true)
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
  }, [address, rangeMode, startEra, endEra, startDate, endDate, run, includeHistory])

  function applyDatePreset(days, label) {
    const now = new Date(), from = new Date(now.getTime() - days * 86_400_000)
    setStartDate(toDateInput(from)); setEndDate(toDateInput(now)); setActivePreset(label)
  }

  function handleImportResults(rows, meta, header, fileName) {
    setImportedResults(rows)
    setFilteredRows(rows)
    setImportedAddress(meta?.address ?? '')
    // `header` is null for an export predating the shared header; the banner
    // then simply shows fewer details rather than claiming false ones.
    setImportMeta({
      fileName: fileName ?? '',
      exportedAt: header?.exportedAt || meta?.exportedAt || '',
      appVersion: header?.appVersion ?? null,
    })
  }

  function clearImport() {
    setImportedResults(null)
    setImportedAddress('')
    setImportMeta(null)
    setFilteredRows([])
  }

  const showResults = (isLoading || isDone || isStopped || isError || importedResults) && activeResults.length > 0

  useEffect(() => {
    const prevStatus = previousStatusRef.current
    previousStatusRef.current = status

    if (!(prevStatus === RH_STATUS.LOADING && (status === RH_STATUS.DONE || status === RH_STATUS.STOPPED))) return
    if (!activeResults.length) return

    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [status, activeResults.length])

  return (
    <div className={`space-y-4 transition-[padding] duration-200 ${!simpleMode && logExpanded ? 'pb-[380px]' : 'pb-16'}`}>

      <section className="page-hero">
        <div className="relative z-10 flex flex-col gap-2">
          <div className="hero-kicker self-start">
            <span className="hero-dot" />
            Reward History Viewer
          </div>
          <h1 className="hero-title">Pool reward history</h1>
          <p className="hero-copy">
            Compute per-era reward attribution for nomination pools, filter and visualize the result, and keep import/export intact.
          </p>
        </div>
      </section>

      {/* The stepper describes the Query flow, so it hides in Import mode. */}
      {simpleMode && tab === 'query' && (
        <StepProgress
          steps={RH_SIMPLE_STEPS}
          currentStep={rhSimpleStep}
          complete={rhSimpleComplete}
          onReset={rhSimpleStep > 1 ? () => { reset(); setImportedResults(null); setImportedAddress(''); setRhPage(1); setRhSimpleRunning(false); setSimpleInfoOpen(false) } : undefined}
          infoOpen={simpleInfoOpen}
          onInfoOpenChange={setSimpleInfoOpen}
          infoContent={
            <>
              <p className="font-semibold text-text">Reward history is an estimate</p>
              <p className="mt-1">Archive snapshots reconstruct pool-level rewards and member share over time, so the output is best used for investigation and planning.</p>
              <p className="mt-2"><span className="font-semibold text-text">Pool-level payouts.</span> The pool gets daily rewards, not the user, so these values are estimations rather than wallet-level settlement records.</p>
              <p className="mt-2"><span className="font-semibold text-text">Enjin Wallet may show different values.</span> The wallet derives reward figures from its own data pipeline and may reflect claimable balances or rounding differently from the era-by-era archive reconstruction used here.</p>
              <p className="mt-2"><span className="font-semibold text-text">Tax note.</span> Tax treatment depends on your jurisdiction and activity history. Use this tool as a research aid, not tax advice.</p>
            </>
          }
        />
      )}

      <ToolModeStrip
        queryLabel="Compute Rewards"
        value={tab}
        onChange={setTab}
        idPrefix="reward"
      />

      {/* ── Compute pane (advanced only) ── */}
      {tab === 'query' && !simpleMode && (
        <div className="space-y-3 sm:space-y-4">
          <ToolInfoSection tone="warning">
            <p className="font-semibold text-text">Reward history is an estimate</p>
            <p className="mt-1">Archive snapshots reconstruct pool-level rewards and member share over time, so the output is best used for investigation and planning.</p>
            <p className="mt-2"><span className="font-semibold text-text">Pool-level payouts.</span> The pool gets daily rewards, not the user, so these values are estimations rather than wallet-level settlement records.</p>
            <p className="mt-2"><span className="font-semibold text-text">Enjin Wallet may show different values.</span> The wallet derives reward figures from its own data pipeline and may reflect claimable balances or rounding differently from the era-by-era archive reconstruction used here.</p>
            <p className="mt-2"><span className="font-semibold text-text">Historical figures corrected.</span> Reward, Cumulative, and APY figures shown before this fix were overstated for eras after the pool commission mechanism launched — the calculation mistakenly added the pool operator's commission instead of subtracting it. Figures shown now are net of commission and correct; if you saved or exported numbers earlier, they may be higher than the current values.</p>
            <p className="mt-2"><span className="font-semibold text-text">APY is now ENJ-denominated.</span> APY previously divided by the pool's sENJ share supply because the pool's bonded-stake lookup was silently failing. It now divides by the actual bonded ENJ, which is the correct unit. Since 1 sENJ is worth well over 1 ENJ in mature pools, APY figures are roughly half what this tool showed before — the lower numbers are the accurate ones.</p>
            <p className="mt-2"><span className="font-semibold text-text">Tax note.</span> Tax treatment depends on your jurisdiction and activity history. Use this tool as a research aid, not tax advice.</p>
          </ToolInfoSection>

          <div className="grid gap-4 xl:grid-cols-3 xl:items-start">
          {/* Col 1: RPC Config */}
          <div className="data-panel">
            <h3 className="font-headline text-lg font-bold text-text sm:text-xl">Scan Configuration</h3>
            <div className="mt-4 grid gap-3">

              {/* Address */}
              <div className="rounded-sm border border-[var(--hairline)] bg-card px-3 py-3 sm:px-4 sm:py-4">
                <Field
                  label="Relaychain Wallet Address" id="rh-address" type="text" value={address}
                  onChange={e => setAddress(e.target.value)}
                  placeholder="en…" disabled={isLoading}
                  controlClassName={`font-mono ${addrErr ? 'error-shake ring-1 ring-danger/60' : ''}`}
                  error={addrErr}
                  maxLength={60}
                />
              </div>

              {/* Pool scope toggle */}
              <div className="rounded-sm border border-[var(--hairline)] bg-card px-3 py-3 sm:px-4 sm:py-4 space-y-2">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={includeHistory}
                    disabled={isLoading}
                    onClick={() => setIncludeHistory(v => !v)}
                    className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus-visible:outline-none
                      focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50
                      ${includeHistory ? 'bg-primary' : 'bg-surface-bright'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200
                      ${includeHistory ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-sm font-semibold text-text">Include past pool interactions</span>
                </div>
                <p className="text-sm leading-6 text-text-secondary">
                  Also query historical pool bond, unbond, and withdraw activity through Subscan when you want to include previously exited pools.
                </p>
              </div>

            </div>
          </div> {/* close Col 1 */}

          {/* Col 2: Query Mode + Range Params + action */}
            <div className="data-panel space-y-4">

            {/* Live chain snapshot */}
            {liveChainSnapshot}

            {/* Range mode toggle */}
            <div className="rounded-sm bg-card px-4 py-4">
              <p className="text-sm font-semibold text-text">Query Mode</p>
              <div className="range-mode-grid mt-3">
                {REWARD_RANGE_MODE_OPTIONS.map(option => {
                  const isActive = rangeMode === option.key
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setRangeMode(option.key)}
                      disabled={isLoading}
                      className={`range-mode-option ${isActive ? 'range-mode-option-active' : 'range-mode-option-idle'}`}
                    >
                      <span className="range-mode-badge" aria-hidden="true">{option.badge}</span>
                      <span className="min-w-0">
                        <span className={`block text-sm font-semibold ${isActive ? 'text-text' : 'text-text-secondary'}`}>
                          {option.title}
                        </span>
                        <span className={`mt-1 block text-xs leading-5 ${isActive ? 'text-text-secondary' : 'text-muted'}`}>
                          {option.description}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Era range inputs */}
            {rangeMode === 'era' && (
              <div className="range-params-card space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="mt-1 text-base font-semibold text-text">Range Parameters</h4>
                  </div>
                </div>
                <div className="space-y-3">
                  <Field label="Start Era" id="reward-start-era" type="number" min="1" max={chainInfo.era ?? undefined} step="1" value={startEra}
                    onChange={e => setStartEra(e.target.value)}
                    placeholder="e.g. 980" disabled={isLoading}
                    controlClassName="font-mono" />
                  <Field label="End Era" id="reward-end-era" type="number" min="1" max={chainInfo.era ?? undefined} step="1" value={endEra}
                    onChange={e => setEndEra(e.target.value)}
                    placeholder="e.g. 1000" disabled={isLoading}
                    controlClassName="font-mono" />
                  {eraValidErr && <p className="flex items-center gap-1 text-xs text-danger"><AlertTriangle size={11} className="flex-shrink-0" />{eraValidErr}</p>}
                </div>
              </div>
            )}

            {/* Date range inputs */}
            {rangeMode === 'date' && (
              <div className="range-params-card space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="mt-1 text-base font-semibold text-text">Range Parameters</h4>
                  </div>
                </div>
                {/* Quick presets */}
                <div>
                  <span className="input-label">Quick Range</span>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Scans are limited to {MAX_SCAN_DAYS} days per run. Subscan's free tier also only indexes the past {SUBSCAN_HISTORY_DAYS} days.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {DATE_PRESETS.map(({ label, days }) => (
                      <button key={label} type="button"
                        onClick={() => applyDatePreset(days, label)}
                        disabled={isLoading}
                        className={`range-preset-button ${
                          activePreset === label ? 'range-preset-button-active' : 'range-preset-button-idle'
                        }`}>
                        {label} ago
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <Field label="Start Date" id="reward-start-date" type="date" max={toDateInput(new Date())} value={startDate}
                    onChange={e => { setStartDate(e.target.value); setActivePreset(null) }}
                    disabled={isLoading}
                    controlClassName="font-mono" />
                  <Field label="End Date" id="reward-end-date" type="date" max={toDateInput(new Date())} value={endDate}
                    onChange={e => { setEndDate(e.target.value); setActivePreset(null) }}
                    disabled={isLoading}
                    controlClassName="font-mono" />
                </div>
                {dateValidErr && <p className="flex items-center gap-1 text-xs text-danger"><AlertTriangle size={11} className="flex-shrink-0"/>{dateValidErr}</p>}
              </div>
            )}

            {/* Action button — single slot: Stop → Reset → Compute Rewards */}
            <div className="flex flex-col items-center gap-2">
              {/* Distinct keys: Stop and Reset share this slot, and without
                  them the charge earned on Stop would carry straight over to
                  Reset on a double click. */}
              {isLoading ? (
                <HoldButton key="stop" onActivate={stop} className="btn-danger gap-1.5 px-5">
                  <Square size={14} />Stop
                </HoldButton>
              ) : (isDone || isStopped || isError || importedResults) ? (
                <HoldButton key="reset" onActivate={() => { reset(); setImportedResults(null); setImportedAddress('') }} className="btn-primary gap-1.5 px-5">
                  <RotateCcw size={14} />Reset
                </HoldButton>
              ) : (
                <button onClick={handleRun} className="btn-primary btn-push gap-1.5 px-5"
                  disabled={!address.trim() || !!addrErr || (rangeMode === 'era' ? (!startEra || !endEra || !!eraValidErr) : (!startDate || !endDate || !!dateValidErr))}>
                  <Play size={14} />Compute Rewards
                </button>
              )}
              {estimatedEraSpan != null && !((rangeMode === 'era' && eraValidErr) || (rangeMode === 'date' && dateValidErr)) && (
                <span className="text-xs font-mono text-text-secondary">
                  <span className="flex items-center gap-2">
                    <span>{rangeMode === 'date' ? `~${estimatedEraSpan.toLocaleString('en')} era estimates` : `${estimatedEraSpan.toLocaleString('en')} eras selected`}</span>
                  </span>
                </span>
              )}
            </div>
          </div>  {/* close Col 2 */}

            {/* Col 3: Scan Progress */}
            <div className="hidden xl:block">
              <PhaseProgressCards
                indexLabel="Phase"
                title="Computation Progress"
                summary={displaySummary}
                meta={displayMeta}
                phases={displayPhases}
                ariaLabel="Reward history progress"
              />
            </div>
          </div>  {/* close 3-col grid */}

          <div className="xl:hidden mt-4">
            <PhaseProgressCards
              indexLabel="Phase"
              title="Computation Progress"
              summary={displaySummary}
              meta={displayMeta}
              phases={displayPhases}
              ariaLabel="Reward history progress"
            />
          </div>
        </div>
      )}

      {/* ── Simple page 1: Address ── */}
      {simpleMode && rhSimpleStep === 1 && !simpleInfoOpen && (
        <div className="mx-auto w-full max-w-lg data-panel space-y-5">
          <div>
            <h2 className="font-headline text-xl font-bold text-text">Enter your wallet address</h2>
            <p className="mt-1 text-sm text-text-secondary">Your Enjin Relaychain address — starts with "en".</p>
          </div>
          <div>
            <Field
              label="Relaychain Address"
              id="rh-simple-address"
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="en…"
              maxLength={60}
              controlClassName={`font-mono ${addrErr ? 'error-shake ring-1 ring-danger/60' : ''}`}
              error={addrErr}
            />
          </div>
          <div className="flex justify-end pt-1">
            <button
              onClick={() => { setSimpleInfoOpen(false); setRhPage(2) }}
              disabled={!address.trim() || !!addrErr}
              className="btn-primary px-6 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ── Simple page 2: Mode ── */}
      {simpleMode && rhSimpleStep === 2 && !simpleInfoOpen && (
        <div className="mx-auto w-full max-w-lg data-panel space-y-5">
          <div>
            <h2 className="font-headline text-xl font-bold text-text">Choose query mode</h2>
            <p className="mt-1 text-sm text-text-secondary">Pick how you want to define the reward window.</p>
          </div>
          <div className="range-mode-grid">
            {REWARD_RANGE_MODE_OPTIONS.map(option => {
              const isActive = rangeMode === option.key
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setRangeMode(option.key)}
                  className={`range-mode-option ${isActive ? 'range-mode-option-active' : 'range-mode-option-idle'}`}
                >
                  <span className="range-mode-badge" aria-hidden="true">{option.badge}</span>
                  <span className="min-w-0">
                    <span className={`block text-sm font-semibold ${isActive ? 'text-text' : 'text-text-secondary'}`}>
                      {option.title}
                    </span>
                    <span className={`mt-1 block text-xs leading-5 ${isActive ? 'text-text-secondary' : 'text-muted'}`}>
                      {option.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex justify-between pt-1">
            <button onClick={() => { setSimpleInfoOpen(false); setRhPage(1) }} className="btn-secondary px-5">Back</button>
            <button onClick={() => { setSimpleInfoOpen(false); setRhPage(3) }} className="btn-primary px-6">Next</button>
          </div>
        </div>
      )}

      {/* ── Simple page 3: Range Parameters ── */}
      {simpleMode && rhSimpleStep === 3 && !simpleInfoOpen && (
        <div className="mx-auto w-full max-w-lg data-panel space-y-5">
          <div>
            <h2 className="font-headline text-xl font-bold text-text">Set the reward window</h2>
            <p className="mt-1 text-sm text-text-secondary">
              {rangeMode === 'era' ? 'Enter start and end era numbers.' : 'Pick a date range to look up.'}
            </p>
          </div>

          {/* Live chain snapshot */}
          {liveChainSnapshot}

          {/* Era range inputs */}
          {rangeMode === 'era' && (
            <div className="space-y-3">
              <Field label="Start Era" id="reward-start-era" type="number" min="1" max={chainInfo.era ?? undefined} step="1" value={startEra}
                onChange={e => setStartEra(e.target.value)}
                placeholder="e.g. 980"
                controlClassName="font-mono" />
              <Field label="End Era" id="reward-end-era" type="number" min="1" max={chainInfo.era ?? undefined} step="1" value={endEra}
                onChange={e => setEndEra(e.target.value)}
                placeholder="e.g. 1000"
                controlClassName="font-mono" />
              {eraValidErr && (
                <p className="flex items-center gap-1 text-xs text-danger">
                  <AlertTriangle size={11} className="flex-shrink-0" />{eraValidErr}
                </p>
              )}
            </div>
          )}

          {/* Date range inputs */}
          {rangeMode === 'date' && (
            <div className="space-y-3">
              <div>
                <span className="input-label">Quick Range</span>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Scans are limited to {MAX_SCAN_DAYS} days per run. Subscan's free tier also only indexes the past {SUBSCAN_HISTORY_DAYS} days.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DATE_PRESETS.map(({ label, days }) => (
                    <button key={label} type="button"
                      onClick={() => applyDatePreset(days, label)}
                      className={`range-preset-button ${activePreset === label ? 'range-preset-button-active' : 'range-preset-button-idle'}`}>
                      {label} ago
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Start Date" id="reward-start-date" type="date" max={toDateInput(new Date())} value={startDate}
                onChange={e => { setStartDate(e.target.value); setActivePreset(null) }}
                controlClassName="font-mono" />
              <Field label="End Date" id="reward-end-date" type="date" max={toDateInput(new Date())} value={endDate}
                onChange={e => { setEndDate(e.target.value); setActivePreset(null) }}
                controlClassName="font-mono" />
              {dateValidErr && (
                <p className="flex items-center gap-1 text-xs text-danger">
                  <AlertTriangle size={11} className="flex-shrink-0" />{dateValidErr}
                </p>
              )}
            </div>
          )}

          {/* Include past pool interactions toggle */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setIncludeHistory(v => !v)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIncludeHistory(v => !v) } }}
            className="flex cursor-pointer select-none items-start gap-3 rounded-sm border border-[var(--hairline)] bg-card px-4 py-3"
          >
            <div
              role="switch"
              aria-checked={includeHistory}
              className={`relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-200 ${includeHistory ? 'bg-primary' : 'bg-surface-bright'}`}
            >
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${includeHistory ? 'translate-x-5' : 'translate-x-0'}`} />
            </div>
            <div>
              <p className="text-sm font-semibold text-text">Include past pool interactions</p>
              <p className="mt-0.5 text-xs leading-5 text-text-secondary">
                Also look up historical bond, unbond, and withdraw activity to include pools you've already exited.
              </p>
            </div>
          </div>

          {estimatedEraSpan != null && !((rangeMode === 'era' && eraValidErr) || (rangeMode === 'date' && dateValidErr)) && (
            <p className="text-xs font-mono text-text-secondary">
              {rangeMode === 'date' ? `~${estimatedEraSpan.toLocaleString('en')} era estimates` : `${estimatedEraSpan.toLocaleString('en')} eras selected`}
            </p>
          )}

          <div className="flex justify-between pt-1">
            <button onClick={() => { setSimpleInfoOpen(false); setRhPage(2) }} className="btn-secondary px-5">Back</button>
            <button
              onClick={handleRun}
              disabled={rangeMode === 'era' ? (!startEra || !endEra || !!eraValidErr) : (!startDate || !endDate || !!dateValidErr)}
              className="btn-primary btn-push px-6 disabled:opacity-40"
            >
              <Play size={14} />
              Compute Rewards
            </button>
          </div>
        </div>
      )}

      {/* ── Import pane — both UI modes ── */}
      {tab === 'import' && (
        <div className="overflow-hidden rounded-sm border border-[var(--hairline)] bg-surface">
          <div role="tabpanel" id="reward-panel-import" aria-labelledby="reward-tab-import" className="p-4 sm:p-5 space-y-3">
            <div>
              <p className="section-label">Import</p>
            </div>
            <div className="flex gap-2.5 p-3 rounded-lg bg-card border border-surface-bright text-[11px] leading-relaxed">
              <Info size={13} className="text-text-secondary flex-shrink-0 mt-0.5" />
              <p className="text-text-secondary">
                Only files previously exported by this tool{' '}
                <span className="font-mono text-muted">(JSON, CSV, or XML)</span>{' '}
                can be imported. Files from other sources or tools are not supported.
              </p>
            </div>
            <RewardImportPanel parse={parseRewardImport} onImport={handleImportResults} />
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {isError && errorMsg && (
        <div className="rounded-sm bg-danger/5 p-4 border border-danger/30">
          <p className="text-sm text-danger">{errorMsg}</p>
        </div>
      )}

      {/* ── Stopped ── */}
      {isStopped && !activeResults.length && (
        <div className="rounded-sm bg-warning/5 p-4 border border-warning/30">
          <p className="text-sm text-warning">Computation stopped before results were available.</p>
        </div>
      )}

      {/* ── Empty result ── */}
      {isDone && !activeResults.length && (
        <div className="data-panel text-center">
          <p className="text-sm text-text-secondary">No rewards found for the given address and era range.</p>
          <p className="text-xs text-muted mt-2">
            If you have exited your pool(s), enable "Include past pool interactions"
            to scan historical pools.
          </p>
        </div>
      )}

      {/* Independent of showResults, which additionally requires
          activeResults.length > 0 — this bar must appear from the first
          instant of a scan, before any row has landed. */}
      {isLoading && (
        <ScanStatusBar
          label={activePhase?.label ?? 'Computing rewards…'}
          meta={displayMeta}
          onStop={stop}
        />
      )}

      {/* ── Results section. Live during a scan in guided mode too, where a
             spinner panel used to stand in for these. ── */}
      {showResults && (
        <section ref={resultsRef} className="space-y-4">
          {/* Address summary bar */}
          {(() => { const dispAddr = importedResults ? importedAddress : address; return dispAddr ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 data-panel">
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] font-bold tracking-widest uppercase text-text-secondary">Wallet</span>
                <span className="text-sm font-bold text-text font-mono" title={dispAddr}>{dispAddr}</span>
              </div>
            </div>
          ) : null })()
          }
          <RewardSummary results={filteredRows.length ? filteredRows : activeResults} />
          <RewardTableV2 results={activeResults} onFilter={setFilteredRows} isLoading={isLoading} />
          <RewardChart data={filteredRows} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PoolBondedPieChart data={filteredRows} />
            <PoolRewardPieChart data={filteredRows} />
          </div>
          {/* Export only for computed data. Imported data is a snapshot of a
              past run, and a re-export would be indistinguishable from an
              original — the same rule the other three tools follow. */}
          {!importedResults && (isDone || isStopped) && (
            <div className="md:w-1/2"><RewardExportPanel results={activeResults} address={address} /></div>
          )}

          {/* Provenance, adjacent to the results it describes. */}
          {importedResults && (
            <div className="flex items-start gap-2 rounded-sm border border-cyan/30 bg-cyan/10 px-3 py-2 text-xs text-cyan">
              <FileDown size={14} className="mt-0.5 flex-shrink-0" />
              <p className="min-w-0 flex-1">
                Showing imported data
                {importMeta?.fileName && <> from <span className="break-all font-mono">{importMeta.fileName}</span></>}
                {importMeta?.exportedAt && <> · exported {formatExportedAtUTC(importMeta.exportedAt)}</>}
                {importMeta?.appVersion && <> · EnjinSight v{importMeta.appVersion}</>}
                {' '}· {activeResults.length} row{activeResults.length === 1 ? '' : 's'}.
                {' '}Nothing was computed.
              </p>
              <button
                type="button"
                onClick={clearImport}
                className="btn-secondary shrink-0 px-3 py-1 text-xs"
              >
                Clear
              </button>
            </div>
          )}
        </section>
      )}

      {/* ── Sticky terminal log — advanced only ── */}
      {!simpleMode && <TerminalLog logs={logs} sticky onExpandChange={setLogExpanded} />}
    </div>
  )
}
