/**
 * BalanceExplorer — main container for the Historical Balance Viewer feature.
 *
 * Renders a unified input card (tab bar + query form / import panel) plus
 * a shared results section (records bar + chart + table + export).
 */
import { useState, useRef, useEffect } from 'react'
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto'
import { Activity, AlertTriangle, Calendar, ChevronDown, Info, RotateCcw, Server, Square, Upload } from 'lucide-react'
import useBalanceExplorer, { STATUS } from '../hooks/useBalanceExplorer.js'
import { ENJIN_NETWORKS, WS_DEFAULT_ENDPOINT, MAX_RPC_CALLS } from '../constants.js'
import BalanceChart       from './BalanceChart.jsx'
import BalanceTable       from './BalanceTable.jsx'
import BalanceExportPanel from './BalanceExportPanel.jsx'
import BalanceImportPanel from './BalanceImportPanel.jsx'
import TerminalLog        from './TerminalLog.jsx'

// ── Era CSV helpers ─────────────────────────────────────────────────────────

let _eraCache = null

async function loadEraData() {
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
      startTs:    parseInt(p[4], 10) || null, // ms
      endTs:      parseInt(p[6], 10) || null, // ms
    }
  }).filter(r => !isNaN(r.era) && !isNaN(r.startBlock))
  return _eraCache
}

function findBlocksForDateRange(eraData, startDateStr, endDateStr) {
  const startMs = new Date(startDateStr).getTime()
  const endMs   = new Date(endDateStr).getTime() + 86_400_000 - 1 // end of day

  let startEra = eraData[0]
  for (let i = eraData.length - 1; i >= 0; i--) {
    if ((eraData[i].startTs ?? 0) <= startMs) { startEra = eraData[i]; break }
  }

  let endEra = eraData[eraData.length - 1]
  for (let i = eraData.length - 1; i >= 0; i--) {
    if ((eraData[i].startTs ?? 0) <= endMs) { endEra = eraData[i]; break }
  }

  return {
    startBlock: startEra.startBlock,
    endBlock:   endEra.endBlock ?? endEra.startBlock + 14399,
    startEra:   startEra.era,
    endEra:     endEra.era,
  }
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10)
}

const DATE_PRESETS = [
  { label: '1 day',    days: 1   },
  { label: '1 week',   days: 7   },
  { label: '1 month',  days: 30  },
  { label: '3 months', days: 90  },
  { label: '6 months', days: 180 },
  { label: '1 year',   days: 365 },
]

const TABS = [
  { key: 'query',  label: 'Query Node',  icon: Server },
  { key: 'import', label: 'Import Data', icon: Upload },
]

export default function BalanceExplorer() {
  const [tab, setTab] = useState('query')

  // Network selection state
  const [networkKey,    setNetworkKey]    = useState(ENJIN_NETWORKS[0].key)
  const [customEndpoint, setCustomEndpoint] = useState('')

  // Form state (controlled inputs — validated before any API call)
  const [address,    setAddress]    = useState('')
  const [startBlock, setStartBlock] = useState('')
  const [endBlock,   setEndBlock]   = useState('')
  const [step,       setStep]       = useState('100')

  // Range mode: 'block' | 'date'
  const [rangeMode, setRangeMode]   = useState('block')
  const [startDate, setStartDate]   = useState('')
  const [endDate,   setEndDate]     = useState('')
  const [eraLoadErr, setEraLoadErr] = useState(null)

  // Address note: { type: 'converted', convertedAddress, networkLabel } | { type: 'error', msg } | null
  const [addressNote, setAddressNote] = useState(null)
  const addrDebounceRef = useRef(null)

  // Derived: active network preset + resolved endpoint
  const activeNetwork       = ENJIN_NETWORKS.find(n => n.key === networkKey) ?? ENJIN_NETWORKS[0]
  const isCustom            = networkKey === 'custom'
  const endpoint            = isCustom ? customEndpoint : activeNetwork.endpoint
  const isDateRangeSupported = activeNetwork.supportsDateRange === true && !isCustom

  // Auto-switch back to block range when the selected network doesn't support date range
  useEffect(() => {
    if (!isDateRangeSupported && rangeMode === 'date') setRangeMode('block')
  }, [networkKey, isDateRangeSupported]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Validate `rawAddr` against `network`'s SS58 prefix using @polkadot/util-crypto.
   * Updates `addressNote` — does NOT modify the address input.
   */
  function checkAddressForNetwork(rawAddr, network) {
    if (!rawAddr.trim() || network.ss58Prefix === null || network.ss58Prefix === undefined) {
      setAddressNote(null)
      return
    }
    try {
      const pubkey    = decodeAddress(rawAddr.trim())
      const converted = encodeAddress(pubkey, network.ss58Prefix)
      if (converted === rawAddr.trim()) {
        setAddressNote(null)
      } else {
        setAddressNote({ type: 'converted', convertedAddress: converted, networkLabel: network.label })
      }
    } catch (e) {
      setAddressNote({ type: 'error', msg: e.message || 'Invalid SS58 address.' })
    }
  }

  // Real-time address validation — debounced 350 ms on address change, instant on network switch
  useEffect(() => {
    clearTimeout(addrDebounceRef.current)
    if (!address.trim()) { setAddressNote(null); return }
    addrDebounceRef.current = setTimeout(() => {
      checkAddressForNetwork(address, activeNetwork)
    }, 350)
    return () => clearTimeout(addrDebounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, networkKey])

  // RPC meta for export (populated after a successful query)
  const rpcMetaRef = useRef({ endpoint: '', address: '' })

  const {
    status, records, logs, progress, dataSource, errorMsg,
    reset, cancel, runQuery, importData, importEncrypted,
  } = useBalanceExplorer()

  // Close the WebSocket connection cleanly when the component unmounts (user navigates away)
  useEffect(() => () => { cancel() }, [cancel])

  const isLoading = status === STATUS.CONNECTING || status === STATUS.QUERYING
  const hasResults = records.length > 0

  async function handleFetch() {
    let effStart = startBlock
    let effEnd   = endBlock

    if (rangeMode === 'date') {
      if (!startDate || !endDate) return
      setEraLoadErr(null)
      let eraData
      try {
        eraData = await loadEraData()
      } catch {
        setEraLoadErr('Failed to load era reference data. Check network.')
        return
      }
      const { startBlock: sb, endBlock: eb } = findBlocksForDateRange(eraData, startDate, endDate)
      effStart = String(sb)
      effEnd   = String(eb)
      setStartBlock(effStart)
      setEndBlock(effEnd)
    }

    const effectiveAddress = addressNote?.type === 'converted'
      ? addressNote.convertedAddress
      : address
    rpcMetaRef.current = { endpoint, address: effectiveAddress }
    await runQuery({ endpoint, address: effectiveAddress, startBlock: effStart, endBlock: effEnd, step })
  }

  // Apply a preset shortcut: sets startDate = N days ago, endDate = today
  function applyDatePreset(days) {
    const now  = new Date()
    const from = new Date(now.getTime() - days * 86_400_000)
    setStartDate(toDateInput(from))
    setEndDate(toDateInput(now))
  }

  function handleImport(text, ext, fname) {
    const { rpcConfig } = importData(text, ext, fname)
    if (rpcConfig?.endpoint) {
      const ep = rpcConfig.endpoint.slice(0, 256)
      const preset = ENJIN_NETWORKS.find(n => n.endpoint === ep && n.key !== 'custom')
      if (preset) {
        setNetworkKey(preset.key)
      } else {
        setNetworkKey('custom')
        setCustomEndpoint(ep)
      }
    }
    if (rpcConfig?.address)  setAddress(rpcConfig.address.slice(0, 64))
    setTab('query')
  }

  async function handleImportEncrypted(encText, pwd, ext, fname) {
    const { rpcConfig } = await importEncrypted(encText, pwd, ext, fname)
    if (rpcConfig?.endpoint) {
      const ep = rpcConfig.endpoint.slice(0, 256)
      const preset = ENJIN_NETWORKS.find(n => n.endpoint === ep && n.key !== 'custom')
      if (preset) {
        setNetworkKey(preset.key)
      } else {
        setNetworkKey('custom')
        setCustomEndpoint(ep)
      }
    }
    if (rpcConfig?.address)  setAddress(rpcConfig.address.slice(0, 64))
    setTab('query')
  }

  // Estimate RPC calls and time for the current form values
  const { estCalls, estTimeLabel } = (() => {
    const s  = parseInt(startBlock, 10)
    const e  = parseInt(endBlock,   10)
    const st = parseInt(step, 10) || 100
    if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) return { estCalls: null, estTimeLabel: null }
    const calls = Math.min(Math.ceil((e - s) / st) + 1, MAX_RPC_CALLS + 1)
    // Empirical: ~600 ms per block + ~2.5s fixed overhead (two sequential RPCs + WS latency)
    const secs = Math.round(calls * 0.60 + 2.5)
    let label
    if (secs < 5)         label = '< 5s'
    else if (secs < 60)   label = `~${secs}s`
    else if (secs < 3600) label = `~${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
    else                  label = `~${Math.floor(secs / 3600)}h ${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}m`
    return { estCalls: calls, estTimeLabel: label }
  })()

  const blks    = hasResults ? records.map(d => d.block) : []
  const minBlk  = hasResults ? Math.min(...blks) : null
  const maxBlk  = hasResults ? Math.max(...blks) : null
  const hasNewFmt = hasResults && records.some(d => d.newFormat)

  const inputField = 'w-full bg-surface border border-border rounded-lg px-3 py-1.5 text-[0.8rem] ' +
    'text-text font-mono placeholder-muted disabled:opacity-50 focus:outline-none ' +
    'focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-colors'

  return (
    <div className="space-y-4 sm:space-y-5">

      {/* ── Unified input card (tab bar + pane) ────────────────────── */}
      <div className="card overflow-hidden">

        {/* Tab bar — flush at top of card */}
        <div
          role="tablist"
          aria-label="Balance explorer mode"
          className="flex border-b border-border bg-surface/30"
        >
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              disabled={isLoading}
              onClick={() => setTab(key)}
              className={`flex items-center justify-center gap-1.5 flex-1 px-4 py-3
                          text-xs sm:text-sm font-medium border-b-2 transition-colors
                          disabled:opacity-50 disabled:cursor-not-allowed
                          ${tab === key
                            ? 'border-primary text-text bg-primary/5'
                            : 'border-transparent text-dim hover:text-text hover:bg-surface/60'}`}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>

        {/* ── Query pane ───────────────────────────────────────── */}
        {tab === 'query' && (
          <div role="tabpanel" className="p-4 sm:p-6 space-y-4">

            {/* Section heading */}
            <div className="flex items-center gap-2">
              <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
              <h3 className="text-xs font-bold tracking-widest uppercase text-cyan">RPC Configuration</h3>
            </div>

            {/* Endpoint dropdown + address */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="bal-rpc-net" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                  Archive Node WS Endpoint
                </label>
                {/* Network preset selector */}
                <div className="relative">
                  <select
                    id="bal-rpc-net"
                    value={networkKey}
                    onChange={e => setNetworkKey(e.target.value)}
                    disabled={isLoading}
                    className={`${inputField} appearance-none pr-8 cursor-pointer`}
                  >
                    {ENJIN_NETWORKS.map(n => (
                      <option key={n.key} value={n.key}>{n.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-dim" />
                </div>
                {/* Custom endpoint text input */}
                {isCustom && (
                  <input
                    id="bal-rpc-ep"
                    type="text"
                    maxLength={256}
                    autoComplete="off"
                    spellCheck="false"
                    placeholder="wss://your-archive-node"
                    value={customEndpoint}
                    onChange={e => setCustomEndpoint(e.target.value)}
                    disabled={isLoading}
                    className={`${inputField} mt-2`}
                  />
                )}
                {/* Show resolved endpoint for presets */}
                {!isCustom && (
                  <p className="mt-1.5 text-[11px] font-mono text-muted truncate" title={activeNetwork.endpoint}>
                    {activeNetwork.endpoint}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="bal-addr" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                  Wallet Address (SS58)
                </label>
                <input
                  id="bal-addr"
                  type="text"
                  maxLength={64}
                  autoComplete="off"
                  spellCheck="false"
                  placeholder={activeNetwork.addrHint}
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  disabled={isLoading}
                  className={inputField}
                />
                {/* Converted address label — shown only when prefix differs */}
                {addressNote?.type === 'converted' && (
                  <p className="mt-1.5 text-[11px] font-mono text-warning/90 leading-snug break-all">
                    ⚠️ Converted address for {addressNote.networkLabel}:{' '}
                    <span className="select-all">{addressNote.convertedAddress}</span>
                  </p>
                )}
                {/* Structural error label */}
                {addressNote?.type === 'error' && (
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] font-mono text-danger leading-snug">
                    <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                    <span>❌ Invalid address: {addressNote.msg}</span>
                  </p>
                )}
              </div>
            </div>

            {/* ── Range mode toggle ─────────────────────────── */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[0.6rem] font-bold tracking-widest uppercase text-dim">Query Range</span>
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setRangeMode('block')}
                  disabled={isLoading}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-r border-border transition-colors
                    ${rangeMode === 'block' ? 'bg-primary/20 text-primary' : 'text-dim hover:text-text'}`}
                >
                  Block Range
                </button>
                <button
                  type="button"
                  onClick={() => setRangeMode('date')}
                  disabled={isLoading || !isDateRangeSupported}
                  title={!isDateRangeSupported ? 'Date Range is only available for Enjin Relaychain archive endpoint' : undefined}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors
                    disabled:opacity-40 disabled:cursor-not-allowed
                    ${rangeMode === 'date' ? 'bg-primary/20 text-primary' : 'text-dim hover:text-text'}`}
                >
                  <Calendar size={12} />
                  Date Range
                </button>
              </div>
            </div>

            {/* ── Block range inputs ─────────────────────────── */}
            {rangeMode === 'block' && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="bal-start" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                    Start Block
                  </label>
                  <input
                    id="bal-start"
                    type="number"
                    placeholder="e.g. 1000000"
                    min={0} max={999999999} step={1}
                    value={startBlock}
                    onChange={e => setStartBlock(e.target.value)}
                    disabled={isLoading}
                    className={inputField}
                  />
                </div>
                <div>
                  <label htmlFor="bal-end" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                    End Block
                  </label>
                  <input
                    id="bal-end"
                    type="number"
                    placeholder="e.g. 1001000"
                    min={0} max={999999999} step={1}
                    value={endBlock}
                    onChange={e => setEndBlock(e.target.value)}
                    disabled={isLoading}
                    className={inputField}
                  />
                </div>
                <div>
                  <label htmlFor="bal-step" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                    Step (every N blocks)
                  </label>
                  <input
                    id="bal-step"
                    type="number"
                    min={1} max={999999} step={1}
                    value={step}
                    onChange={e => setStep(e.target.value)}
                    disabled={isLoading}
                    className={inputField}
                  />
                </div>
              </div>
            )}

            {/* ── Date range inputs ─────────────────────────── */}
            {rangeMode === 'date' && (
              <div className="space-y-3">
                {/* Quick presets */}
                <div>
                  <span className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">Quick Range</span>
                  <div className="flex flex-wrap gap-2">
                    {DATE_PRESETS.map(({ label, days }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => applyDatePreset(days)}
                        disabled={isLoading}
                        className="px-2.5 py-1 rounded-md border border-border text-[11px] text-dim
                                   hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50"
                      >
                        {label} ago
                      </button>
                    ))}
                  </div>
                </div>

                {/* Start / End date + step */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="bal-start-date" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                      Start Date
                    </label>
                    <input
                      id="bal-start-date"
                      type="date"
                      max={toDateInput(new Date())}
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      disabled={isLoading}
                      className={inputField}
                    />
                  </div>
                  <div>
                    <label htmlFor="bal-end-date" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                      End Date
                    </label>
                    <input
                      id="bal-end-date"
                      type="date"
                      max={toDateInput(new Date())}
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      disabled={isLoading}
                      className={inputField}
                    />
                  </div>
                  <div>
                    <label htmlFor="bal-step-date" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                      Step (every N blocks)
                    </label>
                    <input
                      id="bal-step-date"
                      type="number"
                      min={1} max={999999} step={1}
                      value={step}
                      onChange={e => setStep(e.target.value)}
                      disabled={isLoading}
                      className={inputField}
                    />
                  </div>
                </div>

                {eraLoadErr && (
                  <p className="flex items-start gap-1.5 text-[11px] font-mono text-danger">
                    <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                    {eraLoadErr}
                  </p>
                )}

                {/* Resolved block range preview */}
                {startBlock && endBlock && rangeMode === 'date' && (
                  <p className="text-[11px] font-mono text-dim">
                    Resolved block range: <span className="text-cyan">{Number(startBlock).toLocaleString('en')}</span>
                    {' – '}
                    <span className="text-cyan">{Number(endBlock).toLocaleString('en')}</span>
                  </p>
                )}
              </div>
            )}

            {/* ── Disclaimer — Archive RPC ─────────────────── */}
            <div className="flex gap-2.5 px-3 py-2.5 rounded-lg bg-primary/5 border border-primary/20">
              <Info size={14} className="text-primary/70 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-dim leading-relaxed">
                <span className="text-text-sec font-medium">Note:</span> Balance data is fetched
                directly from the Archive RPC endpoint, so queries may take some time to complete —
                especially over a wide block range. Narrowing the range or increasing the step size
                will significantly reduce query time.
              </p>
            </div>

            {/* Error banner */}
            {status === STATUS.ERROR && errorMsg && (
              <div
                role="alert"
                className="flex gap-3 px-4 py-3 rounded-xl bg-danger/10 border border-danger/30 animate-fade-in"
              >
                <AlertTriangle size={16} className="text-danger flex-shrink-0 mt-0.5" />
                <p className="text-sm text-danger leading-relaxed">{errorMsg}</p>
              </div>
            )}

            {/* Action row */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              {isLoading ? (
                <button onClick={cancel} className="btn-stop w-full sm:w-auto sm:min-w-[200px]">
                  <Square size={14} />
                  STOP
                </button>
              ) : hasResults ? (
                <button onClick={reset} className="btn-primary w-full sm:w-auto sm:min-w-[200px]">
                  <RotateCcw size={14} />
                  RESET
                </button>
              ) : (
                <button
                  onClick={handleFetch}
                  className="btn-primary w-full sm:w-auto sm:min-w-[200px]"
                  disabled={
                    !address.trim() ||
                    (rangeMode === 'block' ? (!startBlock || !endBlock) : (!startDate || !endDate))
                  }
                >
                  <Activity size={14} />
                  Fetch Balance
                </button>
              )}
              {estCalls != null && (
                <span className="text-xs font-mono text-dim">
                  {estCalls > MAX_RPC_CALLS
                    ? (
                      <span className="text-warning flex items-center gap-1">
                        <AlertTriangle size={11} />
                        {estCalls.toLocaleString('en')}+ calls — exceeds {MAX_RPC_CALLS.toLocaleString('en')} limit
                      </span>
                    )
                    : (
                      <span className="flex items-center gap-2">
                        <span>~{estCalls.toLocaleString('en')} RPC calls</span>
                        <span className="text-muted">·</span>
                        <span className="text-cyan/80">{estTimeLabel}</span>
                      </span>
                    )
                  }
                </span>
              )}
            </div>

            {/* Progress bar */}
            {isLoading && progress && (
              <div aria-live="polite" className="space-y-1.5">
                <div className="flex justify-between text-xs text-dim font-mono">
                  <span>{progress.text}</span>
                  <span>{progress.pct}%</span>
                </div>
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan rounded-full transition-all duration-300"
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Import pane ───────────────────────────────────────── */}
        {tab === 'import' && (
          <div role="tabpanel" className="p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
              <h3 className="text-xs font-bold tracking-widest uppercase text-cyan">Import Balance Data</h3>
            </div>
            <p className="text-xs text-dim mb-4 leading-relaxed">
              Only files previously exported by this tool (JSON, CSV, or XML) can be imported.
              Files from other sources or tools are not supported.
            </p>
            <BalanceImportPanel
              bare
              onImport={handleImport}
              onImportEncrypted={handleImportEncrypted}
            />
          </div>
        )}
      </div>

      {/* ── Results (shown for any data source) ──────────────────────── */}
      {hasResults && (
        <>
          {/* Records summary bar */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-card border border-border rounded-xl shadow-card px-5 py-3.5">
            {[
              { label: 'Records',        value: records.length.toLocaleString('en') },
              { label: 'Block Range',    value: minBlk != null ? `${minBlk.toLocaleString('en')} – ${maxBlk.toLocaleString('en')}` : '—' },
              { label: 'Balance Format', value: hasNewFmt ? 'New (frozen+flags)' : 'Legacy (misc+fee)' },
            ].map(({ label, value }, i, arr) => (
              <div key={label} className="flex items-center gap-6">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] font-bold tracking-widest uppercase text-dim">{label}</span>
                  <span className="text-sm font-bold text-text font-mono">{value}</span>
                </div>
                {i < arr.length - 1 && <div className="w-px h-7 bg-border flex-shrink-0" />}
              </div>
            ))}
          </div>

          <BalanceChart records={records} />
          <BalanceTable records={records} />

          {dataSource === 'query' && (
            <BalanceExportPanel records={records} rpcMeta={rpcMetaRef.current} />
          )}
        </>
      )}

      {/* ── Sticky terminal log — always visible at viewport bottom ── */}
      <TerminalLog
        sticky
        logs={logs.map((l, i) => ({
          id: i,
          ts: l.ts,
          level: l.level.toUpperCase(),
          message: l.msg,
        }))}
      />
    </div>
  )
}
