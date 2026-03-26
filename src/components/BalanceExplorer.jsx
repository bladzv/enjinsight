/**
 * BalanceExplorer — main container for the Historical Balance Viewer feature.
 *
 * Renders a unified input card (tab bar + query form / import panel) plus
 * a shared results section (records bar + chart + table + export).
 *
 * Changes from original:
 * - Query Range toggle hidden on Relaychain (auto-uses date range)
 * - Step label = "Step (every N days)" on Relaychain date-range mode
 * - Address validation: warns on wrong SS58 prefix for selected network
 * - Quick preset buttons highlight the active selection
 * - Import stays on result view (no auto-switch to query tab)
 * - BalanceTable receives isLoading for real-time population indication
 * - Custom endpoint option removed (only preset networks)
 */
import { useState, useRef, useEffect } from 'react'
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto'
import { Activity, AlertTriangle, Calendar, ChevronDown, Info, RotateCcw, Server, Square, Upload } from 'lucide-react'
import useBalanceExplorer, { STATUS } from '../hooks/useBalanceExplorer.js'
import { ENJIN_NETWORKS, MAX_RPC_CALLS } from '../constants.js'
import { fetchEraBoundariesFromRpc } from '../utils/eraRpc.js'
import BalanceChart       from './BalanceChart.jsx'
import BalanceTable       from './BalanceTable.jsx'
import BalanceExportPanel from './BalanceExportPanel.jsx'
import BalanceImportPanel from './BalanceImportPanel.jsx'
import TerminalLog        from './TerminalLog.jsx'

// ── Address prefix map ───────────────────────────────────────────────────────
const ADDR_PREFIX_MAP = {
  matrixchain:   { prefix: 'ef', label: 'Matrixchain' },
  relaychain:    { prefix: 'en', label: 'Relaychain' },
  'canary-matrix': { prefix: 'cx', label: 'Canary Matrixchain' },
  'canary-relay':  { prefix: 'cn', label: 'Canary Relaychain' },
}

// Filter out the custom endpoint option
const PRESET_NETWORKS = ENJIN_NETWORKS.filter(n => n.key !== 'custom')

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
      startTs:    parseInt(p[4], 10) || null, // unix seconds
      endTs:      parseInt(p[6], 10) || null, // unix seconds
    }
  }).filter(r => !isNaN(r.era) && !isNaN(r.startBlock))
  return _eraCache
}

function findBlocksForDateRange(eraData, startDateStr, endDateStr) {
  const startMs = new Date(startDateStr).getTime()
  const endMs   = new Date(endDateStr).getTime() + 86_400_000 - 1 // end of day

  let startEra = eraData[0]
  for (let i = eraData.length - 1; i >= 0; i--) {
    if (((eraData[i].startTs ?? 0) * 1000) <= startMs) { startEra = eraData[i]; break }
  }

  let endEra = eraData[eraData.length - 1]
  for (let i = eraData.length - 1; i >= 0; i--) {
    if (((eraData[i].startTs ?? 0) * 1000) <= endMs) { endEra = eraData[i]; break }
  }

  // If endDate is beyond the last CSV era's coverage, estimate additional eras.
  // Block numbers are approximate (~14400 blocks/era); the hook queries whatever
  // blocks actually exist and skips any that don't.
  const lastRow = eraData[eraData.length - 1]
  if (lastRow?.startTs) {
    const lastCoverageMs = (lastRow.endTs ?? (lastRow.startTs + 86400)) * 1000
    if (endMs > lastCoverageMs) {
      const extraEras   = Math.ceil((endMs - lastCoverageMs) / 86_400_000)
      const lastEndBlock = lastRow.endBlock ?? (lastRow.startBlock + 14399)
      endEra = {
        era:        lastRow.era + extraEras,
        startBlock: lastEndBlock + 1,
        endBlock:   lastEndBlock + extraEras * 14400,
        startTs:    lastRow.endTs ?? (lastRow.startTs + 86400),
        endTs:      null,
      }
    }
  }

  return {
    startBlock: startEra.startBlock,
    endBlock:   endEra.endBlock ?? (endEra.startBlock + 14399),
    startEra:   startEra.era,
    endEra:     endEra.era,
  }
}

async function findBlocksForEraRange(eraData, startEraNum, endEraNum, archiveWss) {
  const s = parseInt(startEraNum, 10)
  const e = parseInt(endEraNum, 10)
  const startRow = eraData.find(r => r.era === s)
  const endRow   = eraData.find(r => r.era === e)

  if (startRow && endRow) {
    return {
      startBlock: startRow.startBlock,
      endBlock:   endRow.endBlock ?? (endRow.startBlock + 14399),
    }
  }

  // One or both eras are missing from the CSV — fetch via archive RPC.
  const missingEras = []
  if (!startRow) missingEras.push(s)
  if (!endRow && e !== s) missingEras.push(e)

  let rpcRows = {}
  if (missingEras.length > 0 && archiveWss) {
    rpcRows = await fetchEraBoundariesFromRpc(archiveWss, missingEras)
  }

  const finalStart = startRow || rpcRows[s]
  const finalEnd   = endRow   || rpcRows[e] || (e === s ? finalStart : null)

  if (!finalStart) throw new Error(`Era ${s} not found in reference data.`)
  if (!finalEnd)   throw new Error(`Era ${e} not found in reference data.`)

  return {
    startBlock: finalStart.startBlock,
    endBlock:   finalEnd.endBlock ?? (finalEnd.startBlock + 14399),
  }
}

/**
 * Compute an approximate step (in blocks) for N days on the Relaychain.
 * Each era ≈ 14400 blocks ≈ 1 day.
 * If era data is available we use actual era boundaries to be more accurate.
 */
function computeDayStep(eraData, dayStep) {
  if (!eraData || eraData.length < 2) return dayStep * 14400
  // Average blocks per era from the last 50 eras
  const sample = eraData.slice(-50)
  let totalBlocks = 0, count = 0
  for (let i = 1; i < sample.length; i++) {
    const prev = sample[i - 1], cur = sample[i]
    if (cur.startBlock > prev.startBlock) {
      totalBlocks += cur.startBlock - prev.startBlock
      count++
    }
  }
  const avgBlocksPerEra = count > 0 ? totalBlocks / count : 14400
  return Math.round(avgBlocksPerEra * dayStep)
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
  const [showImportResults, setShowImportResults] = useState(false)

  // Network selection state — no custom endpoint
  const [networkKey, setNetworkKey] = useState(PRESET_NETWORKS[0].key)

  // Form state (controlled inputs — validated before any API call)
  const [address,    setAddress]    = useState('')
  const [startBlock, setStartBlock] = useState('')
  const [endBlock,   setEndBlock]   = useState('')
  const [step,       setStep]       = useState('100')

  // Range mode: 'block' | 'date' | 'era'
  const [rangeMode, setRangeMode]   = useState('block')
  const [startDate, setStartDate]   = useState('')
  const [endDate,   setEndDate]     = useState('')
  const [eraLoadErr, setEraLoadErr] = useState(null)
  const [eraDataRef, setEraDataRef] = useState(null)  // loaded era data for step computation
  const [startEraNum, setStartEraNum] = useState('')
  const [endEraNum,   setEndEraNum]   = useState('')

  // Track active quick-range preset (null = custom / manual)
  const [activePreset, setActivePreset] = useState(null)

  // Address validation note
  const [addressNote, setAddressNote] = useState(null)
  const addrDebounceRef = useRef(null)

  // Derived: active network preset
  const activeNetwork        = PRESET_NETWORKS.find(n => n.key === networkKey) ?? PRESET_NETWORKS[0]
  const endpoint             = activeNetwork.endpoint
  const isDateRangeSupported = activeNetwork.supportsDateRange === true
  const isRelaychain         = networkKey === 'relaychain'

  // On Relaychain: switch to era range by default; on non-Relaychain: revert if needed
  useEffect(() => {
    if (isRelaychain) {
      if (rangeMode === 'block') {
        setRangeMode('era')
        setStep('14400')
      }
    } else {
      if ((rangeMode === 'era') || (rangeMode === 'date' && !isDateRangeSupported)) {
        setRangeMode('block')
      }
    }
  }, [networkKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load era data when date range or era range is active
  useEffect(() => {
    if ((rangeMode === 'date' || rangeMode === 'era') && isDateRangeSupported) {
      loadEraData().then(setEraDataRef).catch(() => {})
    }
  }, [rangeMode, isDateRangeSupported])

  /**
   * Validate address against expected prefix for the selected network.
   */
  function checkAddressForNetwork(rawAddr, network) {
    if (!rawAddr.trim()) { setAddressNote(null); return }
    // First check the expected human-readable prefix
    const prefixInfo = ADDR_PREFIX_MAP[network.key]
    if (prefixInfo) {
      const trimmed = rawAddr.trim()
      if (!trimmed.startsWith(prefixInfo.prefix)) {
        setAddressNote({
          type: 'prefix-warn',
          msg: `${prefixInfo.label} addresses start with "${prefixInfo.prefix}". This address may be for a different network.`,
        })
        return
      }
    }
    // Then do full SS58 validation
    if (network.ss58Prefix === null || network.ss58Prefix === undefined) {
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

  // Real-time address validation — debounced 350 ms
  useEffect(() => {
    clearTimeout(addrDebounceRef.current)
    if (!address.trim()) { setAddressNote(null); return }
    addrDebounceRef.current = setTimeout(() => {
      checkAddressForNetwork(address, activeNetwork)
    }, 350)
    return () => clearTimeout(addrDebounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, networkKey])

  // RPC meta for export
  const rpcMetaRef = useRef({ endpoint: '', address: '' })

  const {
    status, records, logs, progress, dataSource, errorMsg,
    reset, cancel, runQuery, importData, importEncrypted,
  } = useBalanceExplorer()

  useEffect(() => () => { cancel() }, [cancel])

  const isLoading  = status === STATUS.CONNECTING || status === STATUS.QUERYING
  const hasResults = records.length > 0

  async function handleFetch() {
    let effStart = startBlock
    let effEnd   = endBlock
    let effStep  = step

    if (rangeMode === 'era') {
      if (!startEraNum || !endEraNum) return
      setEraLoadErr(null)
      let eraData
      try {
        eraData = await loadEraData()
        setEraDataRef(eraData)
      } catch {
        setEraLoadErr('Failed to load era reference data. Check network.')
        return
      }
      let eraBlocks
      try {
        eraBlocks = await findBlocksForEraRange(eraData, startEraNum, endEraNum, endpoint)
      } catch (e) {
        setEraLoadErr(e.message ?? 'Failed to resolve era blocks.')
        return
      }
      const { startBlock: sb, endBlock: eb } = eraBlocks
      effStart = String(sb)
      effEnd   = String(eb)
      setStartBlock(effStart)
      setEndBlock(effEnd)
    }

    if (rangeMode === 'date') {
      if (!startDate || !endDate) return
      setEraLoadErr(null)
      let eraData
      try {
        eraData = await loadEraData()
        setEraDataRef(eraData)
      } catch {
        setEraLoadErr('Failed to load era reference data. Check network.')
        return
      }
      const { startBlock: sb, endBlock: eb } = findBlocksForDateRange(eraData, startDate, endDate)
      effStart = String(sb)
      effEnd   = String(eb)
      setStartBlock(effStart)
      setEndBlock(effEnd)
      // Convert day step to block step
      const dayStepVal = parseInt(step, 10) || 1
      effStep = String(computeDayStep(eraData, dayStepVal))
    }

    const effectiveAddress = addressNote?.type === 'converted'
      ? addressNote.convertedAddress
      : address
    rpcMetaRef.current = { endpoint, address: effectiveAddress }
    await runQuery({ endpoint, address: effectiveAddress, startBlock: effStart, endBlock: effEnd, step: effStep })
  }

  // Apply a preset shortcut
  function applyDatePreset(days, label) {
    const now  = new Date()
    const from = new Date(now.getTime() - days * 86_400_000)
    setStartDate(toDateInput(from))
    setEndDate(toDateInput(now))
    setActivePreset(label)
  }

  function handleImport(text, ext, fname) {
    const { rpcConfig } = importData(text, ext, fname)
    if (rpcConfig?.address) setAddress(rpcConfig.address.slice(0, 64))
    // Stay on import tab to show results, don't auto-switch
    setShowImportResults(true)
  }

  async function handleImportEncrypted(encText, pwd, ext, fname) {
    const { rpcConfig } = await importEncrypted(encText, pwd, ext, fname)
    if (rpcConfig?.address) setAddress(rpcConfig.address.slice(0, 64))
    // Stay on import tab to show results, don't auto-switch
    setShowImportResults(true)
  }

  // Estimate RPC calls
  const { estCalls, estTimeLabel } = (() => {
    const s  = parseInt(startBlock, 10)
    const e  = parseInt(endBlock,   10)
    const st = parseInt(step, 10) || 100
    if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) return { estCalls: null, estTimeLabel: null }
    const calls = Math.min(Math.ceil((e - s) / st) + 1, MAX_RPC_CALLS + 1)
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

  // Step label/hint
  const stepLabel       = rangeMode === 'date'  ? 'Step (every N days)' :
                          rangeMode === 'era'   ? 'Step (every N blocks)' :
                                                 'Step (every N blocks)'
  const stepMin         = 1
  const stepPlaceholder = rangeMode === 'date' ? 'e.g. 1' :
                          rangeMode === 'era'  ? 'e.g. 14400' : 'e.g. 100'

  return (
    <div className="space-y-4 sm:space-y-5">

      {/* ── Unified input card (tab bar + pane) ────────────────────── */}
      <div className="card overflow-hidden">

        {/* Tab bar */}
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
              onClick={() => { setTab(key); if (key === 'query') setShowImportResults(false) }}
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

            {/* Network dropdown + address */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="bal-rpc-net" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                  Archive Node WS Endpoint
                </label>
                <div className="relative">
                  <select
                    id="bal-rpc-net"
                    value={networkKey}
                    onChange={e => setNetworkKey(e.target.value)}
                    disabled={isLoading}
                    className={`${inputField} appearance-none pr-8 cursor-pointer`}
                  >
                    {PRESET_NETWORKS.map(n => (
                      <option key={n.key} value={n.key}>{n.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-dim" />
                </div>
                <p className="mt-1.5 text-[11px] font-mono text-muted truncate" title={activeNetwork.endpoint}>
                  {activeNetwork.endpoint}
                </p>
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
                  className={`${inputField} ${
                    addressNote?.type === 'error' ? 'border-danger/50 focus:border-danger/70' :
                    addressNote?.type === 'prefix-warn' ? 'border-warning/50 focus:border-warning/70' : ''
                  }`}
                />
                {addressNote?.type === 'converted' && (
                  <p className="mt-1.5 text-[11px] font-mono text-warning/90 leading-snug break-all">
                    ⚠️ Converted for {addressNote.networkLabel}:{' '}
                    <span className="select-all">{addressNote.convertedAddress}</span>
                  </p>
                )}
                {addressNote?.type === 'prefix-warn' && (
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] font-mono text-warning/90 leading-snug">
                    <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                    <span>{addressNote.msg}</span>
                  </p>
                )}
                {addressNote?.type === 'error' && (
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] font-mono text-danger leading-snug">
                    <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                    <span>❌ Invalid address: {addressNote.msg}</span>
                  </p>
                )}
              </div>
            </div>

            {/* ── Range mode toggle ─────────────────────────────────────── */}
            {isRelaychain && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[0.6rem] font-bold tracking-widest uppercase text-dim">Query Range</span>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => { setRangeMode('era'); setStep('14400') }}
                    disabled={isLoading}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-r border-border transition-colors
                      ${rangeMode === 'era' ? 'bg-primary/20 text-primary' : 'text-dim hover:text-text'}`}
                  >
                    Era Range
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRangeMode('date'); setStep('1') }}
                    disabled={isLoading}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors
                      ${rangeMode === 'date' ? 'bg-primary/20 text-primary' : 'text-dim hover:text-text'}`}
                  >
                    <Calendar size={12} />
                    Date Range
                  </button>
                </div>
              </div>
            )}
            {!isRelaychain && isDateRangeSupported && (
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
                    disabled={isLoading}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors
                      ${rangeMode === 'date' ? 'bg-primary/20 text-primary' : 'text-dim hover:text-text'}`}
                  >
                    <Calendar size={12} />
                    Date Range
                  </button>
                </div>
              </div>
            )}

            {/* ── Era range inputs (Relaychain era mode) ──────────── */}
            {rangeMode === 'era' && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="bal-start-era" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                      Start Era
                    </label>
                    <input
                      id="bal-start-era"
                      type="number"
                      placeholder="e.g. 900"
                      min={1} step={1}
                      value={startEraNum}
                      onChange={e => setStartEraNum(e.target.value)}
                      disabled={isLoading}
                      className={inputField}
                    />
                  </div>
                  <div>
                    <label htmlFor="bal-end-era" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                      End Era
                    </label>
                    <input
                      id="bal-end-era"
                      type="number"
                      placeholder="e.g. 950"
                      min={1} step={1}
                      value={endEraNum}
                      onChange={e => setEndEraNum(e.target.value)}
                      disabled={isLoading}
                      className={inputField}
                    />
                  </div>
                  <div>
                    <label htmlFor="bal-step-era" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                      {stepLabel}
                    </label>
                    <input
                      id="bal-step-era"
                      type="number"
                      min={1} max={999999} step={1}
                      placeholder={stepPlaceholder}
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
                {startBlock && endBlock && rangeMode === 'era' && (
                  <p className="text-[11px] font-mono text-dim">
                    Resolved block range: <span className="text-cyan">{Number(startBlock).toLocaleString('en')}</span>
                    {' – '}
                    <span className="text-cyan">{Number(endBlock).toLocaleString('en')}</span>
                  </p>
                )}
              </div>
            )}

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
                    {stepLabel}
                  </label>
                  <input
                    id="bal-step"
                    type="number"
                    min={stepMin} max={999999} step={1}
                    placeholder={stepPlaceholder}
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
                        onClick={() => applyDatePreset(days, label)}
                        disabled={isLoading}
                        className={`px-2.5 py-1 rounded-md border text-[11px] transition-colors disabled:opacity-50
                          ${activePreset === label
                            ? 'bg-primary/20 border-primary/60 text-primary font-semibold'
                            : 'border-border text-dim hover:border-primary/50 hover:text-primary'}`}
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
                      onChange={e => { setStartDate(e.target.value); setActivePreset(null) }}
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
                      onChange={e => { setEndDate(e.target.value); setActivePreset(null) }}
                      disabled={isLoading}
                      className={inputField}
                    />
                  </div>
                  <div>
                    <label htmlFor="bal-step-date" className="block text-[0.6rem] font-bold tracking-widest uppercase text-dim mb-1.5">
                      {stepLabel}
                    </label>
                    <input
                      id="bal-step-date"
                      type="number"
                      min={stepMin} max={999} step={1}
                      placeholder={stepPlaceholder}
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
                <span className="text-text font-medium">Note:</span> Balance data is fetched
                directly from the Archive RPC endpoint — queries may take time, especially over
                a wide range. Narrowing the range or increasing the step will reduce query time.
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
                    addressNote?.type === 'error' ||
                    (rangeMode === 'block' ? (!startBlock || !endBlock) :
                     rangeMode === 'era'   ? (!startEraNum || !endEraNum) :
                                            (!startDate || !endDate))
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
                <div className="h-2 bg-surface rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary-dim via-primary to-cyan transition-all duration-300"
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
            {!showImportResults ? (
              <>
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
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
                    <h3 className="text-xs font-bold tracking-widest uppercase text-cyan">Imported Data</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowImportResults(false)}
                    className="text-xs text-dim hover:text-text transition-colors"
                  >
                    ← Import another file
                  </button>
                </div>
                {hasResults && (
                  <p className="text-xs text-dim">
                    {records.length.toLocaleString('en')} records loaded. Switch to the <strong className="text-text">Query Node</strong> tab to run a new query.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Results (shown for any data source; also visible DURING query) ── */}
      {(hasResults || isLoading) && (
        <>
          {/* Records summary bar */}
          {hasResults && (
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
          )}

          {hasResults && <BalanceChart records={records} />}
          <BalanceTable records={records} isLoading={isLoading} />

          {dataSource === 'query' && hasResults && (
            <BalanceExportPanel records={records} rpcMeta={rpcMetaRef.current} />
          )}
        </>
      )}

      {/* ── Sticky terminal log ── */}
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
