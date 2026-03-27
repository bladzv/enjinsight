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
import { fetchLiveChainInfo } from '../utils/chainInfo.js'
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

// Cache per CSV path so switching networks doesn't force a re-fetch
const _eraCacheMap = new Map()

async function loadEraData(csvPath = '/relay-era-reference.csv') {
  if (_eraCacheMap.has(csvPath)) return _eraCacheMap.get(csvPath)
  const resp = await fetch(csvPath)
  const text = await resp.text()
  const lines = text.trim().split('\n').slice(1)
  const data = lines.map(line => {
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
  _eraCacheMap.set(csvPath, data)
  return data
}

async function findBlocksForDateRange(eraData, startDateStr, endDateStr, archiveWss) {
  const startMs = new Date(startDateStr).getTime()
  const endMs   = new Date(endDateStr).getTime() + 86_400_000 - 1 // end of day

  // Find best matching eras from CSV (startTs is unix seconds, hence * 1000)
  let startEraRow = eraData[0]
  for (let i = eraData.length - 1; i >= 0; i--) {
    if (((eraData[i].startTs ?? 0) * 1000) <= startMs) { startEraRow = eraData[i]; break }
  }

  let endEraRow = eraData[eraData.length - 1]
  for (let i = eraData.length - 1; i >= 0; i--) {
    if (((eraData[i].startTs ?? 0) * 1000) <= endMs) { endEraRow = eraData[i]; break }
  }

  const lastRow = eraData[eraData.length - 1]
  const lastCoverageMs = lastRow?.startTs
    ? (lastRow.endTs ?? (lastRow.startTs + 86400)) * 1000
    : 0

  if (lastRow?.startTs && endMs > lastCoverageMs) {
    // End date extends beyond CSV — fetch exact era boundaries via RPC binary search.
    // Estimate how many extra eras are needed (+2 buffer + 1 for endBlock derivation).
    const extraEras    = Math.ceil((endMs - lastCoverageMs) / 86_400_000)
    const firstMissing = lastRow.era + 1
    const lastNeeded   = lastRow.era + extraEras + 3
    const erasToFetch  = Array.from({ length: lastNeeded - firstMissing + 1 }, (_, i) => firstMissing + i)

    try {
      const rpcData = await fetchEraBoundariesFromRpc(archiveWss, erasToFetch)
      // rpcData timestamps are already in unix seconds (eraRpc.js divides by 1000)
      const rpcRows = Object.entries(rpcData)
        .map(([era, d]) => ({ era: Number(era), ...d }))
        .sort((a, b) => a.era - b.era)

      // Latest RPC era whose start is on or before endMs
      for (let i = rpcRows.length - 1; i >= 0; i--) {
        if (rpcRows[i].startTs && rpcRows[i].startTs * 1000 <= endMs) {
          endEraRow = rpcRows[i]; break
        }
      }

      // If startDate is also beyond the CSV, refine startEraRow from RPC data too
      if (startMs > lastCoverageMs) {
        for (let i = rpcRows.length - 1; i >= 0; i--) {
          if (rpcRows[i].startTs && rpcRows[i].startTs * 1000 <= startMs) {
            startEraRow = rpcRows[i]; break
          }
        }
      }
    } catch {
      // RPC unavailable — fall back to math estimation
      const lastEndBlock = lastRow.endBlock ?? (lastRow.startBlock + 14399)
      endEraRow = {
        era:        lastRow.era + extraEras,
        startBlock: lastEndBlock + 1,
        endBlock:   lastEndBlock + extraEras * 14400,
        startTs:    lastRow.endTs ?? (lastRow.startTs + 86400),
        endTs:      null,
      }
    }
  }

  return {
    startBlock: startEraRow.startBlock,
    endBlock:   endEraRow.endBlock ?? (endEraRow.startBlock + 14399),
    startEra:   startEraRow.era,
    endEra:     endEraRow.era,
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
  const [step,       setStep]       = useState('')

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

  // Live chain info (era, block, timestamp) — fetched once per network change
  const [chainInfo, setChainInfo] = useState({ era: null, block: null, timestamp: null, loading: false })

  // Derived: active network preset
  const activeNetwork        = PRESET_NETWORKS.find(n => n.key === networkKey) ?? PRESET_NETWORKS[0]
  const endpoint             = activeNetwork.endpoint
  const isDateRangeSupported = activeNetwork.supportsDateRange === true

  // Reset era/date modes when switching to a network without CSV support
  useEffect(() => {
    if (!isDateRangeSupported) {
      if (rangeMode === 'era' || rangeMode === 'date') {
        setRangeMode('block')
        setStep('')
      }
    }
  }, [networkKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load era data when date range or era range is active
  useEffect(() => {
    if ((rangeMode === 'date' || rangeMode === 'era') && isDateRangeSupported) {
      loadEraData(activeNetwork.eraRefCsv).then(setEraDataRef).catch(() => {})
    }
  }, [rangeMode, isDateRangeSupported, activeNetwork.eraRefCsv])

  /**
   * Validate address against expected prefix for the selected network.
   */
  function checkAddressForNetwork(rawAddr, network) {
    if (!rawAddr.trim()) { setAddressNote(null); return }
    const prefixInfo = ADDR_PREFIX_MAP[network.key]
    if (prefixInfo && !rawAddr.trim().startsWith(prefixInfo.prefix)) {
      setAddressNote({
        type: 'error',
        msg: `${prefixInfo.label} addresses start with "${prefixInfo.prefix}". Please enter a valid ${prefixInfo.label} address.`,
      })
    } else {
      setAddressNote(null)
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
    log, reset, cancel, runQuery, importData, importEncrypted,
  } = useBalanceExplorer()

  // Fetch live chain info (era, block, timestamp) whenever the network changes
  useEffect(() => {
    let cancelled = false
    setChainInfo({ era: null, block: null, timestamp: null, loading: true })
    log('info', `Fetching chain info from ${endpoint}…`)
    fetchLiveChainInfo(endpoint)
      .then(info => {
        if (!cancelled) {
          setChainInfo({ ...info, loading: false })
          log('info', `Chain info: era=${info.era ?? '—'}, block=${info.block != null ? info.block.toLocaleString() : '—'}`)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setChainInfo({ era: null, block: null, timestamp: null, loading: false })
          log('warn', `Chain info fetch failed: ${err?.message ?? 'unknown error'}`)
        }
      })
    return () => { cancelled = true }
  }, [endpoint, log])

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
        eraData = await loadEraData(activeNetwork.eraRefCsv)
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
      // Convert era step (N eras) to block step
      const eraStepVal = parseInt(step, 10) || 1
      effStep = String(computeDayStep(eraData, eraStepVal))
    }

    if (rangeMode === 'date') {
      if (!startDate || !endDate) return
      setEraLoadErr(null)
      let eraData
      try {
        eraData = await loadEraData(activeNetwork.eraRefCsv)
        setEraDataRef(eraData)
      } catch {
        setEraLoadErr('Failed to load era reference data. Check network.')
        return
      }
      let dateBlocks
      try {
        dateBlocks = await findBlocksForDateRange(eraData, startDate, endDate, endpoint)
      } catch (e) {
        setEraLoadErr(e.message ?? 'Failed to resolve date range blocks.')
        return
      }
      const { startBlock: sb, endBlock: eb } = dateBlocks
      effStart = String(sb)
      effEnd   = String(eb)
      setStartBlock(effStart)
      setEndBlock(effEnd)
      // Convert day step to block step
      const dayStepVal = parseInt(step, 10) || 1
      effStep = String(computeDayStep(eraData, dayStepVal))
    }

    const effectiveAddress = address.trim()
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

  // ── Real-time range validation ────────────────────────────────────────────
  const blockErr = (() => {
    if (rangeMode !== 'block') return ''
    const s = parseInt(startBlock, 10), e = parseInt(endBlock, 10)
    const cur = chainInfo.block
    if (startBlock && (isNaN(s) || s < 1)) return 'Start block must be a positive number.'
    if (endBlock   && (isNaN(e) || e < 1)) return 'End block must be a positive number.'
    if (startBlock && cur && !isNaN(s) && s > cur)
      return `Start block ${s.toLocaleString()} is in the future (current: ${cur.toLocaleString()}).`
    if (endBlock && cur && !isNaN(e) && e > cur)
      return `End block ${e.toLocaleString()} is in the future (current: ${cur.toLocaleString()}).`
    if (startBlock && endBlock && !isNaN(s) && !isNaN(e) && s > e)
      return 'Start block must be less than or equal to end block.'
    return ''
  })()

  const eraValidErr = (() => {
    if (rangeMode !== 'era') return ''
    const s = parseInt(startEraNum, 10), e = parseInt(endEraNum, 10)
    const cur = chainInfo.era
    if (startEraNum && (isNaN(s) || s < 1)) return 'Start era must be ≥ 1.'
    if (endEraNum   && (isNaN(e) || e < 1)) return 'End era must be ≥ 1.'
    if (startEraNum && cur && !isNaN(s) && s > cur)
      return `Era ${s} is in the future (current era: ${cur}).`
    if (endEraNum && cur && !isNaN(e) && e > cur)
      return `Era ${e} is in the future (current era: ${cur}).`
    if (startEraNum && endEraNum && !isNaN(s) && !isNaN(e) && s > e)
      return 'Start era must be less than or equal to end era.'
    return ''
  })()

  const dateValidErr = (() => {
    if (rangeMode !== 'date') return ''
    const today = toDateInput(new Date())
    if (startDate && startDate > today) return 'Start date cannot be in the future.'
    if (endDate   && endDate   > today) return 'End date cannot be in the future.'
    if (startDate && endDate && startDate > endDate)
      return 'Start date must be before or equal to end date.'
    return ''
  })()

  const inputField = 'w-full bg-card rounded px-3 py-1.5 text-[0.8rem] text-text font-mono placeholder-muted disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-primary transition-colors'

  // Step label/hint
  const stepLabel       = rangeMode === 'date' ? 'Step (Every N Days)' :
                          rangeMode === 'era'  ? 'Step (Every N Eras)' :
                                                'Step (Every N Blocks)'
  const stepMin         = 1
  const stepPlaceholder = rangeMode === 'date' ? '1' :
                          rangeMode === 'era'  ? '1' : '14400'

  return (
    <div className="space-y-4 sm:space-y-5">

      {/* ── Unified input card (tab bar + pane) ────────────────────── */}
      <div className="bg-surface rounded-xl overflow-hidden">

        {/* Tab bar */}
        <div
          role="tablist"
          aria-label="Balance explorer mode"
          className="flex bg-card rounded-xl p-1 m-4 mb-0"
        >
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              disabled={isLoading}
              onClick={() => { setTab(key); if (key === 'query') setShowImportResults(false) }}
              className={`flex items-center justify-center gap-1.5 flex-1 px-4 py-2.5
                          text-xs sm:text-sm font-medium rounded-lg transition-colors
                          disabled:opacity-50 disabled:cursor-not-allowed
                          ${tab === key
                            ? 'bg-surface-bright text-cyan'
                            : 'text-muted hover:text-text'}`}
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

            {/* Network dropdown + address */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="bal-rpc-net" className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">
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
                  <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                </div>
                <p className="mt-1.5 text-[11px] font-mono text-muted truncate" title={activeNetwork.endpoint}>
                  {activeNetwork.endpoint}
                </p>
              </div>
              <div>
                <label htmlFor="bal-addr" className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">
                  Wallet Address (SS58)
                </label>
                <input
                  id="bal-addr"
                  type="text"
                  maxLength={64}
                  autoComplete="off"
                  spellCheck="false"
                  placeholder={`${ADDR_PREFIX_MAP[activeNetwork.key]?.prefix ?? ''}...`}
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  disabled={isLoading}
                  className={`${inputField} ${addressNote?.type === 'error' ? 'border-danger/50 focus:border-danger/70' : ''}`}
                />
                {addressNote?.type === 'error' && (
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] font-mono text-danger leading-snug">
                    <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                    <span>{addressNote.msg}</span>
                  </p>
                )}
              </div>
            </div>

            {/* ── Range mode toggle ─────────────────────────────────────── */}
            {isDateRangeSupported && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary">Query Range</span>
                <div className="flex rounded-xl bg-card p-1 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => { setRangeMode('block'); setStep('') }}
                    disabled={isLoading}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                      ${rangeMode === 'block' ? 'bg-primary/15 text-primary' : 'text-muted hover:text-text'}`}
                  >
                    Block Range
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRangeMode('era'); setStep('1') }}
                    disabled={isLoading}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                      ${rangeMode === 'era' ? 'bg-primary/15 text-primary' : 'text-muted hover:text-text'}`}
                  >
                    Era Range
                  </button>
                  <button
                    type="button"
                    onClick={() => { setRangeMode('date'); setStep('1') }}
                    disabled={isLoading}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                      ${rangeMode === 'date' ? 'bg-primary/15 text-primary' : 'text-muted hover:text-text'}`}
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
                    <label htmlFor="bal-start-era" className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">
                      Start Era
                    </label>
                    <input
                      id="bal-start-era"
                      type="number"
                      placeholder="1000"
                      min={1} max={chainInfo.era ?? undefined} step={1}
                      value={startEraNum}
                      onChange={e => setStartEraNum(e.target.value)}
                      disabled={isLoading}
                      className={inputField}
                    />
                  </div>
                  <div>
                    <label htmlFor="bal-end-era" className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">
                      End Era
                    </label>
                    <input
                      id="bal-end-era"
                      type="number"
                      placeholder="1010"
                      min={1} max={chainInfo.era ?? undefined} step={1}
                      value={endEraNum}
                      onChange={e => setEndEraNum(e.target.value)}
                      disabled={isLoading}
                      className={inputField}
                    />
                  </div>
                  <div>
                    <label htmlFor="bal-step-era" className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">
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
                {eraValidErr && (
                  <p className="flex items-center gap-1.5 text-[11px] font-mono text-danger">
                    <AlertTriangle size={11} className="flex-shrink-0" />{eraValidErr}
                  </p>
                )}
                {eraLoadErr && (
                  <p className="flex items-start gap-1.5 text-[11px] font-mono text-danger">
                    <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                    {eraLoadErr}
                  </p>
                )}
                {startBlock && endBlock && rangeMode === 'era' && (
                  <p className="text-[11px] font-mono text-text-secondary">
                    Resolved block range: <span className="text-cyan">{Number(startBlock).toLocaleString('en')}</span>
                    {' – '}
                    <span className="text-cyan">{Number(endBlock).toLocaleString('en')}</span>
                  </p>
                )}
              </div>
            )}

            {/* ── Block range inputs ─────────────────────────── */}
            {rangeMode === 'block' && (
              <div className="space-y-2">
                <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="bal-start" className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">
                    Start Block
                  </label>
                  <input
                    id="bal-start"
                    type="number"
                    placeholder="14400"
                    min={0} max={chainInfo.block ?? 999999999} step={1}
                    value={startBlock}
                    onChange={e => setStartBlock(e.target.value)}
                    disabled={isLoading}
                    className={inputField}
                  />
                </div>
                <div>
                  <label htmlFor="bal-end" className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">
                    End Block
                  </label>
                  <input
                    id="bal-end"
                    type="number"
                    placeholder="28799"
                    min={0} max={chainInfo.block ?? 999999999} step={1}
                    value={endBlock}
                    onChange={e => setEndBlock(e.target.value)}
                    disabled={isLoading}
                    className={inputField}
                  />
                </div>
                <div>
                  <label htmlFor="bal-step" className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">
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
                {blockErr && (
                  <p className="flex items-center gap-1.5 text-[11px] font-mono text-danger">
                    <AlertTriangle size={11} className="flex-shrink-0" />{blockErr}
                  </p>
                )}
              </div>
            )}

            {/* ── Date range inputs ─────────────────────────── */}
            {rangeMode === 'date' && (
              <div className="space-y-3">
                {/* Quick presets */}
                <div>
                  <span className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">Quick Range</span>
                  <div className="flex flex-wrap gap-2">
                    {DATE_PRESETS.map(({ label, days }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => applyDatePreset(days, label)}
                        disabled={isLoading}
                        className={`px-2.5 py-1 rounded-md text-[11px] transition-colors disabled:opacity-50
                          ${activePreset === label
                            ? 'bg-primary/15 text-primary font-semibold'
                            : 'bg-card text-text-secondary hover:text-text'}`}
                      >
                        {label} ago
                      </button>
                    ))}
                  </div>
                </div>

                {/* Start / End date + step */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="bal-start-date" className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">
                      Start Date
                    </label>
                    <input
                      id="bal-start-date"
                      type="date"
                      placeholder="2026-03-01"
                      max={toDateInput(new Date())}
                      value={startDate}
                      onChange={e => { setStartDate(e.target.value); setActivePreset(null) }}
                      disabled={isLoading}
                      className={`${inputField} [color-scheme:dark]`}
                    />
                  </div>
                  <div>
                    <label htmlFor="bal-end-date" className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">
                      End Date
                    </label>
                    <input
                      id="bal-end-date"
                      type="date"
                      placeholder="2026-03-04"
                      max={toDateInput(new Date())}
                      value={endDate}
                      onChange={e => { setEndDate(e.target.value); setActivePreset(null) }}
                      disabled={isLoading}
                      className={`${inputField} [color-scheme:dark]`}
                    />
                  </div>
                  <div>
                    <label htmlFor="bal-step-date" className="block text-[0.6rem] font-bold tracking-widest uppercase text-text-secondary mb-1.5">
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

                {dateValidErr && (
                  <p className="flex items-center gap-1.5 text-[11px] font-mono text-danger">
                    <AlertTriangle size={11} className="flex-shrink-0" />{dateValidErr}
                  </p>
                )}
                {eraLoadErr && (
                  <p className="flex items-start gap-1.5 text-[11px] font-mono text-danger">
                    <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                    {eraLoadErr}
                  </p>
                )}

                {/* Resolved block range preview */}
                {startBlock && endBlock && rangeMode === 'date' && (
                  <p className="text-[11px] font-mono text-text-secondary">
                    Resolved block range: <span className="text-cyan">{Number(startBlock).toLocaleString('en')}</span>
                    {' – '}
                    <span className="text-cyan">{Number(endBlock).toLocaleString('en')}</span>
                  </p>
                )}
              </div>
            )}

            {/* ── Disclaimer — Archive RPC ─────────────────── */}
            <div className="flex gap-2.5 px-3 py-2.5 rounded-lg bg-primary/5">
              <Info size={14} className="text-primary/70 flex-shrink-0 mt-0.5" />
              <p className="text-[11px] text-text-secondary leading-relaxed">
                <span className="text-text font-medium">Note:</span> Balance data is fetched
                directly from the Archive RPC endpoint — queries may take time, especially over
                a wide range. Narrowing the range or increasing the step will reduce query time.
              </p>
            </div>

            {/* Error banner */}
            {status === STATUS.ERROR && errorMsg && (
              <div
                role="alert"
                className="flex gap-3 px-4 py-3 rounded-xl bg-danger/10 animate-fade-in"
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
                    (rangeMode === 'block' ? (!startBlock || !endBlock || !!blockErr) :
                     rangeMode === 'era'   ? (!startEraNum || !endEraNum || !!eraValidErr) :
                                            (!startDate || !endDate || !!dateValidErr))
                  }
                >
                  <Activity size={14} />
                  Fetch Balance
                </button>
              )}
              {estCalls != null && addressNote?.type !== 'error' && !(rangeMode === 'block' ? !!blockErr : rangeMode === 'era' ? !!eraValidErr : !!dateValidErr) && (
                <span className="text-xs font-mono text-text-secondary">
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
                <div className="flex justify-between text-xs text-text-secondary font-mono">
                  <span>{progress.text}</span>
                  <span>{progress.pct}%</span>
                </div>
                <div className="h-2 bg-card rounded-full overflow-hidden">
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
                  <h3 className="text-xs font-bold font-headline tracking-widest uppercase text-cyan">Import Balance Data</h3>
                </div>
                <p className="text-xs text-text-secondary mb-4 leading-relaxed">
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
                    <h3 className="text-xs font-bold font-headline tracking-widest uppercase text-cyan">Imported Data</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowImportResults(false)}
                    className="text-xs text-text-secondary hover:text-text transition-colors"
                  >
                    ← Import another file
                  </button>
                </div>
                {hasResults && (
                  <p className="text-xs text-text-secondary">
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
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-surface rounded-xl px-5 py-3.5">
              {[
                { label: 'Records',        value: records.length.toLocaleString('en') },
                { label: 'Block Range',    value: minBlk != null ? `${minBlk.toLocaleString('en')} – ${maxBlk.toLocaleString('en')}` : '—' },
                { label: 'Balance Format', value: hasNewFmt ? 'New (frozen+flags)' : 'Legacy (misc+fee)' },
              ].map(({ label, value }, i, arr) => (
                <div key={label} className="flex items-center gap-6">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-bold tracking-widest uppercase text-text-secondary">{label}</span>
                    <span className="text-sm font-bold text-text font-mono">{value}</span>
                  </div>
                  {i < arr.length - 1 && <div className="w-px h-7 bg-card flex-shrink-0" />}
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
