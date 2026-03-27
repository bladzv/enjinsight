/**
 * BalanceChart — Chart.js balance history chart with:
 *  - Stacked bar mode (Total) and individual line modes (Free/Reserved/Misc/Fee)
 *  - Custom crosshair plugin (dashed vertical line + dot)
 *  - enjinSmart tooltip positioner (flips left/right based on cursor position)
 *  - Rich tooltip showing all 4 fields for any chart mode
 *  - Chart height zoom (−/+/⊙)
 *
 * Chart.js is driven imperatively via useRef/useEffect to preserve the
 * full MVP chart fidelity without wrapper abstractions.
 */
import { useRef, useEffect, useCallback, useState } from 'react'
import { BALANCE_FIELDS, CHART_MAX_PTS } from '../constants.js'
import { planckToFloat, fmtENJ } from '../utils/balanceExport.js'

// ── Decimation ─────────────────────────────────────────────────────────────
function decimateForChart(data) {
  if (data.length <= CHART_MAX_PTS) return data
  const step = Math.ceil(data.length / CHART_MAX_PTS)
  return data.filter((_, i) => i % step === 0 || i === data.length - 1)
}

// ── Chart height zoom levels (% of base 340 px) ───────────────────────────
const ZOOM_STEPS = [60, 75, 100, 130, 160, 200]
const DEFAULT_ZOOM_IDX = 2
const BASE_HEIGHT_PX = 340

// ── Crosshair plugin ───────────────────────────────────────────────────────
const crosshairPlugin = {
  id: 'enjinCrosshair',
  afterDraw(chart) {
    if (chart._xhairIdx == null) return
    const meta = chart.getDatasetMeta(0)
    if (!meta?.data?.length) return
    const el = meta.data[chart._xhairIdx]
    if (!el) return
    const { ctx, chartArea: { top, bottom } } = chart
    ctx.save()
    ctx.beginPath()
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = 'rgba(0,217,255,0.6)'
    ctx.lineWidth   = 1.5
    ctx.moveTo(el.x, top)
    ctx.lineTo(el.x, bottom)
    ctx.stroke()
    ctx.beginPath()
    ctx.setLineDash([])
    ctx.arc(el.x, top + 4, 3, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0,217,255,0.8)'
    ctx.fill()
    ctx.restore()
  },
  afterEvent(chart, args) {
    const evt = args.event
    if (evt.type === 'mouseout') { chart._xhairIdx = null; chart.draw(); return }
    if (evt.type !== 'mousemove') return
    const meta = chart.getDatasetMeta(0)
    if (!meta?.data?.length) return
    let closest = null, minDist = Infinity
    meta.data.forEach((el, i) => {
      const d = Math.abs(el.x - evt.x)
      if (d < minDist) { minDist = d; closest = i }
    })
    if (chart._xhairIdx !== closest) { chart._xhairIdx = closest; chart.draw() }
  },
}

// ── Chart config builder ───────────────────────────────────────────────────
// chartPts is kept as a module-level variable per-instance via ref
function buildChartConfig(mode, pts, chartPtsRef) {
  // Expose pts for tooltip callbacks via ref
  chartPtsRef.current = pts

  const labels = pts.map(d => `#${d.block.toLocaleString('en')}`)
  const vals   = key => pts.map(d => planckToFloat(d[key]))

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        labels: {
          color: '#b8cfe0',
          font: { family: '"JetBrains Mono", monospace', size: 13 },
          boxWidth: 14,
        },
      },
      tooltip: {
        position: 'enjinSmart',
        mode: 'index',
        intersect: false,
        backgroundColor: '#13131F',
        borderColor: '#2A2A45',
        borderWidth: 1,
        titleColor: '#F0EEFF',
        bodyColor: '#b8cfe0',
        footerColor: '#8B8AB0',
        titleFont: { family: 'Sora, sans-serif', size: 13, weight: '700' },
        bodyFont:  { family: '"JetBrains Mono", monospace', size: 12 },
        footerFont:{ family: '"JetBrains Mono", monospace', size: 11 },
        padding: 12,
        callbacks: {
          title(items) {
            const idx = items[0]?.dataIndex
            if (idx == null || !chartPtsRef.current[idx]) return ''
            return `Block #${chartPtsRef.current[idx].block.toLocaleString('en')}`
          },
          afterTitle(items) {
            const idx = items[0]?.dataIndex
            if (idx == null || !chartPtsRef.current[idx]) return ''
            const h = chartPtsRef.current[idx].blockHash
            return h ? `${h.slice(0, 14)}…${h.slice(-8)}` : ''
          },
          label(ctx) {
            return ` ${ctx.dataset.label}: ${fmtENJ(ctx.raw)} ENJ`
          },
          afterBody(items) {
            // For single-field line charts, append all 4 fields as a footer
            if (!items.length || items.length > 1) return []
            const idx = items[0]?.dataIndex
            if (idx == null || !chartPtsRef.current[idx]) return []
            const d = chartPtsRef.current[idx]
            const shownLabel = items[0]?.dataset?.label || ''
            const lines = ['', '── All balances ──']
            BALANCE_FIELDS.forEach(({ key, label }) => {
              const prefix = label === shownLabel ? '▸' : ' '
              lines.push(`${prefix} ${label.padEnd(13)}: ${fmtENJ(d[key])} ENJ`)
            })
            return lines
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#8B8AB0', font: { family: '"JetBrains Mono", monospace', size: 11 }, maxTicksLimit: 10 },
        grid:  { color: 'rgba(30,30,53,.6)' },
      },
      y: {
        ticks: { color: '#8B8AB0', font: { family: '"JetBrains Mono", monospace', size: 11 } },
        grid:  { color: 'rgba(30,30,53,.6)' },
      },
    },
  }

  if (mode === 'total') {
    return {
      type: 'bar',
      data: {
        labels,
        datasets: BALANCE_FIELDS.map(({ key, label, color, colorBg }) => ({
          label,
          data:            vals(key),
          backgroundColor: colorBg,
          borderColor:     color,
          borderWidth:     1,
          stack:           's',
        })),
      },
      options: {
        ...baseOptions,
        scales: {
          x: { ...baseOptions.scales.x, stacked: true },
          y: { ...baseOptions.scales.y, stacked: true },
        },
      },
    }
  }

  const field = BALANCE_FIELDS.find(f => f.key === mode)
  return {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label:           field.label,
        data:            vals(mode),
        borderColor:     field.color,
        backgroundColor: field.colorBg.replace('.65)', '.12)'),
        borderWidth:     2,
        fill:            true,
        tension:         0.3,
        pointRadius:     pts.length > 80 ? 0 : 3,
        pointHoverRadius: 5,
      }],
    },
    options: baseOptions,
  }
}

// ── Component ──────────────────────────────────────────────────────────────
export default function BalanceChart({ records }) {
  const canvasRef   = useRef(null)
  const chartRef    = useRef(null)
  const chartPtsRef = useRef([])
  const pluginsRef  = useRef(false)

  const [mode,    setMode]    = useState('total')
  const [zoomIdx, setZoomIdx] = useState(DEFAULT_ZOOM_IDX)

  const heightPx = Math.round(BASE_HEIGHT_PX * ZOOM_STEPS[zoomIdx] / 100)
  const zoomPct  = ZOOM_STEPS[zoomIdx]

  // Register Chart.js plugins once (idempotent after first registration)
  const registerPlugins = useCallback(async () => {
    if (pluginsRef.current) return
    // Destructure both Chart and Tooltip — Chart.Tooltip is not a static property in ESM
    const { Chart, Tooltip } = await import('chart.js/auto')
    // Register crosshair plugin
    Chart.register(crosshairPlugin)
    // Register smart tooltip positioner
    Tooltip.positioners.enjinSmart = function (items, pos) {
      const ca = this.chart.chartArea
      if (!ca || !items.length) return false
      let avgY = items.reduce((s, el) => s + el.element.y, 0) / items.length
      avgY = Math.max(ca.top + 10, Math.min(ca.bottom - 10, avgY))
      const midX = (ca.left + ca.right) / 2
      return pos.x > midX
        ? { x: pos.x - 16, y: avgY, xAlign: 'right', yAlign: 'center' }
        : { x: pos.x + 16, y: avgY, xAlign: 'left',  yAlign: 'center' }
    }
    pluginsRef.current = true
  }, [])

  // Rebuild chart whenever records or mode change.
  // Uses a `cancelled` flag to avoid creating a stale chart if the effect
  // cleanup fires before the async imports resolve (e.g. React StrictMode).
  useEffect(() => {
    if (!records.length) return
    let cancelled = false

    ;(async () => {
      try {
        await registerPlugins()
        if (cancelled) return
        const { Chart } = await import('chart.js/auto')
        if (cancelled) return
        const cv = canvasRef.current
        if (!cv) return
        if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }
        const pts = decimateForChart(records)
        chartRef.current = new Chart(cv, buildChartConfig(mode, pts, chartPtsRef))
      } catch (err) {
        if (!cancelled) console.error('[BalanceChart] draw() failed:', err)
      }
    })()

    return () => {
      cancelled = true
      if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null }
    }
  }, [records, mode, registerPlugins])

  // Resize chart when zoom step changes (height changes via inline style — Chart.js needs a hint)
  useEffect(() => {
    if (chartRef.current) {
      requestAnimationFrame(() => chartRef.current?.resize())
    }
  }, [zoomIdx])

  if (!records.length) return null

  const pts = decimateForChart(records)
  const isDecimated = records.length > CHART_MAX_PTS

  const modeButtons = [
    { key: 'total',      label: 'Total (Stacked)', activeColour: 'text-cyan border-cyan bg-cyan/10'  },
    { key: 'free',       label: 'Free',            activeColour: 'text-cyan border-cyan bg-cyan/5'   },
    { key: 'reserved',   label: 'Reserved',        activeColour: 'text-[#ffc400] border-[#ffc400] bg-[#ffc400]/5' },
    { key: 'miscFrozen', label: 'Misc Frozen',     activeColour: 'text-[#ff7a35] border-[#ff7a35] bg-[#ff7a35]/5' },
    { key: 'feeFrozen',  label: 'Fee Frozen',      activeColour: 'text-[#ff2d78] border-[#ff2d78] bg-[#ff2d78]/5' },
  ]

  return (
    <div className="bg-surface rounded-xl p-4 animate-fade-in">
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
          <h3 className="text-xs font-bold tracking-widest uppercase text-cyan font-headline">Balance Chart</h3>
        </div>
        <div className="flex items-center gap-3">
          {isDecimated && (
            <span className="text-xs text-text-secondary">
              ~{CHART_MAX_PTS} sampled of {records.length.toLocaleString('en')}
            </span>
          )}
          {/* Height zoom controls */}
          <div className="flex items-center gap-1" title="Chart height">
            <button
              className="w-6 h-6 rounded bg-card text-text-secondary text-sm font-bold
                         flex items-center justify-center hover:text-cyan transition-colors"
              onClick={() => setZoomIdx(i => Math.max(0, i - 1))}
              aria-label="Chart zoom out"
              disabled={zoomIdx === 0}
            >−</button>
            <span className="font-mono text-[11px] text-text-secondary w-9 text-center">{zoomPct}%</span>
            <button
              className="w-6 h-6 rounded bg-card text-text-secondary text-sm font-bold
                         flex items-center justify-center hover:text-cyan transition-colors"
              onClick={() => setZoomIdx(i => Math.min(ZOOM_STEPS.length - 1, i + 1))}
              aria-label="Chart zoom in"
              disabled={zoomIdx === ZOOM_STEPS.length - 1}
            >+</button>
            <button
              className="w-6 h-6 rounded bg-card text-[10px] text-text-secondary font-bold
                         flex items-center justify-center hover:text-cyan transition-colors"
              onClick={() => setZoomIdx(DEFAULT_ZOOM_IDX)}
              aria-label="Reset chart zoom"
            >⊙</button>
          </div>
        </div>
      </div>

      {/* Mode toggles */}
      <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Chart mode">
        {modeButtons.map(({ key, label, activeColour }) => (
          <button
            key={key}
            className={`px-3 py-1 rounded-full border text-xs font-bold tracking-wide transition-all
                        ${mode === key
                          ? activeColour
                          : 'border-[rgba(70,71,82,0.10)] text-text-secondary hover:text-text bg-transparent'}`}
            onClick={() => setMode(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Canvas wrapper */}
      <div
        className="relative bg-card rounded-xl p-4 transition-all duration-200"
        style={{ height: `${heightPx}px` }}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
