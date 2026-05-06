import { useEffect, useState } from 'react'
import { fetchLiveChainInfo } from '../utils/chainInfo.js'

const VIEW_LABELS = {
  home: 'Workspace',
  era: 'Era Explorer',
  staking: 'Staking Cadence',
  balance: 'Balance Viewer',
  'reward-history': 'Reward History',
  infusion: 'ENJ Infusion',
}

/**
 * Slim top status bar. Always shows the current view name (left) and a
 * heartbeat with the live Enjin Relaychain era / block (right). Refreshes
 * every 30 s via a one-shot WebSocket query — same helper used by the
 * Balance Viewer's "live chain snapshot" card.
 */
export default function StatusBar({ view, scanStatus }) {
  const [info, setInfo] = useState({ era: null, block: null })
  const [stale, setStale] = useState(true)

  useEffect(() => {
    let cancelled = false
    let timer = null

    async function tick() {
      try {
        const data = await fetchLiveChainInfo('wss://rpc.relay.blockchain.enjin.io')
        if (cancelled) return
        if (data && (data.era != null || data.block != null)) {
          setInfo({ era: data.era ?? null, block: data.block ?? null })
          setStale(false)
        }
      } catch {
        if (!cancelled) setStale(true)
      } finally {
        if (!cancelled) timer = setTimeout(tick, 30_000)
      }
    }

    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [])

  const label = VIEW_LABELS[view] ?? 'Workspace'
  const isScanning = scanStatus === 'loading'

  return (
    <div className="status-bar flex items-center justify-between px-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          /{view === 'home' ? 'home' : view}
        </span>
        <span className="hidden h-3 w-px bg-white/[0.08] sm:inline-block" />
        <span className="hidden truncate text-[13px] font-medium text-text-secondary sm:inline-block">
          {label}
        </span>
        {isScanning && (
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-primary/30 bg-primary/8 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-[0.18em] text-primary-glow">
            <span className="h-1 w-1 rounded-full bg-primary animate-pulse" />
            Scanning
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:gap-4">
        <Stat label="Era"    value={info.era}   stale={stale} />
        <Stat label="Block"  value={info.block} stale={stale} />
        <span
          className={`inline-flex h-1.5 w-1.5 rounded-full ${stale ? 'bg-muted' : 'bg-success animate-pulse'}`}
          title={stale ? 'Reconnecting…' : 'Live'}
          aria-label={stale ? 'Disconnected from Relaychain' : 'Connected to Relaychain'}
        />
      </div>
    </div>
  )
}

function Stat({ label, value, stale }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted">{label}</span>
      <span className={`font-mono text-[12px] tabular-nums ${stale ? 'text-text-secondary' : 'text-text'}`}>
        {value == null ? '—' : value.toLocaleString('en')}
      </span>
    </div>
  )
}
