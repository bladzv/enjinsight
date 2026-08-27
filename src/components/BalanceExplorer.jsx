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
import { useState, useRef, useEffect, useMemo } from 'react'
import { fetchLiveChainInfo } from '../utils/chainInfo.js'
import { Activity, AlertTriangle, ChevronDown, Info, RotateCcw, Server, Sparkles, Square, Upload } from 'lucide-react'
import { fmtENJ } from '../utils/balanceExport.js'
import useBalanceExplorer, { STATUS } from '../hooks/useBalanceExplorer.js'
import { ENJIN_NETWORKS, MAX_RPC_CALLS, MAX_SCAN_DAYS } from '../constants.js'
import { fetchEraBoundariesFromRpc } from '../utils/eraRpc.js'
import BalanceChart       from './BalanceChart.jsx'
import BalanceTable       from './BalanceTable.jsx'
import BalanceExportPanel from './BalanceExportPanel.jsx'
import BalanceImportPanel from './BalanceImportPanel.jsx'
import PhaseProgressCards from './PhaseProgressCards.jsx'
import StepProgress       from './StepProgress.jsx'
import TerminalLog        from './TerminalLog.jsx'
import ToolInfoSection    from './ToolInfoSection.jsx'
import Spinner from './Spinner.jsx'
import Field from './Field.jsx'
import HoldButton from './HoldButton.jsx'

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

// Capped at MAX_SCAN_DAYS — longer presets are unreachable under the date-range
// limit, and offering a button that always errors is worse than not offering it.
// Block mode stays uncapped for anyone who needs a wider window.
const DATE_PRESETS = [
  { label: '1 day',    days: 1 },
  { label: '3 days',   days: 3 },
  { label: '1 week',   days: 7 },
]

const TABS = [
  { key: 'query',  label: 'Query Node',  icon: Server },
  { key: 'import', label: 'Import Data', icon: Upload },
]

function buildEstimateMeta(calls) {
  if (!Number.isFinite(calls) || calls <= 0) return { estCalls: null, estTimeLabel: null }
  const secs = Math.round(calls * 0.6 + 2.5)
  let label
  if (secs < 5) label = '< 5s'
  else if (secs < 60) label = `~${secs}s`
  else if (secs < 3600) label = `~${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`
  else label = `~${Math.floor(secs / 3600)}h ${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}m`
  return { estCalls: calls, estTimeLabel: label }
}

function estimateRangeCalls({ rangeMode, startBlock, endBlock, startEraNum, endEraNum, startDate, endDate, step }) {
  const stepValue = parseInt(step, 10)
  if (!Number.isFinite(stepValue) || stepValue <= 0) return { estCalls: null, estTimeLabel: null }

  if (rangeMode === 'block') {
    const s = parseInt(startBlock, 10)
    const e = parseInt(endBlock, 10)
    if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) return { estCalls: null, estTimeLabel: null }
    return buildEstimateMeta(Math.ceil((e - s) / stepValue) + 1)
  }

  if (rangeMode === 'era') {
    const s = parseInt(startEraNum, 10)
    const e = parseInt(endEraNum, 10)
    if (!Number.isFinite(s) || !Number.isFinite(e) || s > e) return { estCalls: null, estTimeLabel: null }
    return buildEstimateMeta(Math.ceil((e - s) / stepValue) + 1)
  }

  if (rangeMode === 'date') {
    const startMs = new Date(startDate).getTime()
    const endMs = new Date(endDate).getTime()
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
      return { estCalls: null, estTimeLabel: null }
    }
    const spanDays = Math.round((endMs - startMs) / 86_400_000)
    return buildEstimateMeta(Math.ceil(spanDays / stepValue) + 1)
  }

  return { estCalls: null, estTimeLabel: null }
}

const BALANCE_SIMPLE_STEPS = [
  { key: 'address',  label: 'Address'  },
  { key: 'range',    label: 'Range'    },
  { key: 'querying', label: 'Querying' },
  { key: 'results',  label: 'Results'  },
]

export default function BalanceExplorer({ onScanStateChange, simpleMode = false }) {
  const [tab, setTab] = useState('query')
  const [showImportResults, setShowImportResults] = useState(false)

  // Network selection state — no custom endpoint
  const [networkKey, setNetworkKey] = useState(PRESET_NETWORKS[0].key)

  // Form state (controlled inputs — validated before any API call)
  const [address,    setAddress]    = useState('')
  const [queriedAddress, setQueriedAddress] = useState('')
  const [startBlock, setStartBlock] = useState('')
  const [endBlock,   setEndBlock]   = useState('')
  const [step,       setStep]       = useState('')

  // Range mode: 'block' | 'date' | 'era'
  const [rangeMode, setRangeMode]   = useState('block')
  const [startDate, setStartDate]   = useState('')
  const [endDate,   setEndDate]     = useState('')
  const [eraLoadErr, setEraLoadErr] = useState(null)
  const [startEraNum, setStartEraNum] = useState('')
  const [endEraNum,   setEndEraNum]   = useState('')

  // Track active quick-range preset (null = custom / manual)
  const [activePreset, setActivePreset] = useState(null)
  const resultsRef = useRef(null)
  const previousStatusRef = useRef(null)

  // Address validation note
  const [addressNote, setAddressNote] = useState(null)
  const addrDebounceRef = useRef(null)

  // Live chain info (era, block, timestamp) — fetched once per network change
  const [chainInfo, setChainInfo] = useState({ era: null, block: null, timestamp: null, loading: false })

  // Derived: active network preset
  const activeNetwork        = PRESET_NETWORKS.find(n => n.key === networkKey) ?? PRESET_NETWORKS[0]
  const endpoint             = activeNetwork.endpoint
  const isDateRangeSupported = activeNetwork.supportsDateRange === true

  function clearResolvedRange() {
    setStartBlock('')
    setEndBlock('')
  }

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
      loadEraData(activeNetwork.eraRefCsv).catch(() => {})
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
  const [balancePage, setBalancePage] = useState(1)
  const [balanceSimpleRunning, setBalanceSimpleRunning] = useState(false)
  const [simpleInfoOpen, setSimpleInfoOpen] = useState(false)
  const balanceSimpleStep = (isLoading && balanceSimpleRunning) ? 3
    : ((status === STATUS.DONE || status === STATUS.CANCELLED || status === STATUS.ERROR) && balanceSimpleRunning) ? 4
    : balancePage
  // CANCELLED/ERROR also land on step 4 above, so only DONE earns the check.
  const balanceSimpleComplete = balanceSimpleStep === BALANCE_SIMPLE_STEPS.length && status === STATUS.DONE
  useEffect(() => {
    onScanStateChange?.(isLoading)
  }, [isLoading, onScanStateChange])

  useEffect(() => () => {
    onScanStateChange?.(false)
  }, [onScanStateChange])

  const phases = progress?.phases ?? []
  const activePhase = phases.find(p => p.status === 'in_progress') ?? phases.find(p => p.status === 'pending') ?? phases[phases.length - 1]
  const activePhasePct = activePhase && activePhase.total > 0
    ? Math.round((Math.min(activePhase.completed, activePhase.total) / activePhase.total) * 100)
    : 0
  const completedPhaseCount = phases.filter(p => p.status === 'completed').length
  const progressMeta = activePhase && activePhase.total > 0
    ? `${activePhase.completed ?? 0} / ${activePhase.total} (${activePhasePct}%)`
    : `${completedPhaseCount} / ${phases.length} phases complete`
  const progressSummary = progress?.text ?? null

  // Pre-scan placeholder phases (shown before any query starts)
  const previewPhases = useMemo(() => [
    { key: 'connect',  label: 'Connect to Archive',       status: 'pending', total: 1, completed: 0 },
    { key: 'query',    label: 'Query Balance Snapshots',   status: 'pending', total: 1, completed: 0 },
    { key: 'finalize', label: 'Assemble Records',          status: 'pending', total: 1, completed: 0 },
  ], [])
  const displayPhases  = phases.length > 0 ? phases : previewPhases
  const displaySummary = phases.length > 0 ? progressSummary : null
  const displayMeta    = phases.length > 0 ? progressMeta    : null
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

  async function handleFetch() {
    setBalanceSimpleRunning(true)
    let effStart = startBlock
    let effEnd   = endBlock
    let effStep  = step

    if (rangeMode === 'era') {
      if (!startEraNum || !endEraNum) return
      setEraLoadErr(null)
      let eraData
      try {
        eraData = await loadEraData(activeNetwork.eraRefCsv)
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
    setQueriedAddress(effectiveAddress)
    await runQuery({ endpoint, address: effectiveAddress, startBlock: effStart, endBlock: effEnd, step: effStep })
  }

  // Apply a preset shortcut
  function applyDatePreset(days, label) {
    const now  = new Date()
    const from = new Date(now.getTime() - days * 86_400_000)
    setStartDate(toDateInput(from))
    setEndDate(toDateInput(now))
    setActivePreset(label)
    clearResolvedRange()
  }

  function handleImport(text, ext, fname) {
    const { rpcConfig } = importData(text, ext, fname)
    if (rpcConfig?.address) {
      setAddress(rpcConfig.address)
      setQueriedAddress(rpcConfig.address)
    }
    // Stay on import tab to show results, don't auto-switch
    setShowImportResults(true)
  }

  async function handleImportEncrypted(encText, pwd, ext, fname) {
    const { rpcConfig } = await importEncrypted(encText, pwd, ext, fname)
    if (rpcConfig?.address) {
      setAddress(rpcConfig.address)
      setQueriedAddress(rpcConfig.address)
    }
    // Stay on import tab to show results, don't auto-switch
    setShowImportResults(true)
  }

  // Estimate RPC calls
  const { estCalls, estTimeLabel } = estimateRangeCalls({
    rangeMode,
    startBlock,
    endBlock,
    startEraNum,
    endEraNum,
    startDate,
    endDate,
    step,
  })

  const blks    = hasResults ? records.map(d => d.block) : []
  const minBlk  = hasResults ? Math.min(...blks) : null
  const maxBlk  = hasResults ? Math.max(...blks) : null
  const hasNewFmt = hasResults && records.some(d => d.newFormat)

  useEffect(() => {
    const prevStatus = previousStatusRef.current
    previousStatusRef.current = status

    if (!(prevStatus === STATUS.QUERYING && (status === STATUS.DONE || status === STATUS.CANCELLED))) return
    if (!hasResults) return

    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [status, hasResults])

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
    if (startEraNum && endEraNum && !isNaN(s) && !isNaN(e) && (e - s + 1) > MAX_SCAN_DAYS)
      return `Era range is limited to ${MAX_SCAN_DAYS} eras (requested ${e - s + 1}). Narrow the range, or use Block mode for a wider window.`
    return ''
  })()

  const dateValidErr = (() => {
    if (rangeMode !== 'date') return ''
    const today = toDateInput(new Date())
    if (startDate && startDate > today) return 'Start date cannot be in the future.'
    if (endDate   && endDate   > today) return 'End date cannot be in the future.'
    if (startDate && endDate && startDate > endDate)
      return 'Start date must be before or equal to end date.'
    if (startDate && endDate) {
      const spanDays = Math.round((new Date(endDate) - new Date(startDate)) / 86_400_000) + 1
      if (spanDays > MAX_SCAN_DAYS)
        return `Date range is limited to ${MAX_SCAN_DAYS} days (requested ${spanDays}). Narrow the range, or use Block mode for a wider window.`
    }
    return ''
  })()


  // Step label/hint
  const stepLabel       = rangeMode === 'date' ? 'Step (Every N Days)' :
                          rangeMode === 'era'  ? 'Step (Every N Eras)' :
                                                'Step (Every N Blocks)'
  const stepMin         = 1
  const stepPlaceholder = rangeMode === 'date' ? '1' :
                          rangeMode === 'era'  ? '1' : '14400'
  const rangeModeOptions = [
    { key: 'block', badge: 'BLK', title: 'Block Range', description: 'Query exact archive block heights.' },
    { key: 'era', badge: 'ERA', title: 'Era Range', description: 'Resolve the window through staking eras.' },
    { key: 'date', badge: 'DAY', title: 'Date Range', description: 'Pick dates and let the app resolve blocks.' },
  ]

  return (
    <div className="space-y-4 sm:space-y-5">

      <section className="page-hero">
        <div className="relative z-10 flex flex-col gap-3">
          <div className="hero-kicker self-start">
            <span className="hero-dot" />
            Historical Balance Viewer
          </div>
          <h1 className="hero-title">Balance archive</h1>
          <p className="hero-copy">
            Query archive-node snapshots across blocks, eras, or dates. Chart, sort, import, export.
          </p>
        </div>
      </section>

      {simpleMode && (
        <StepProgress
          steps={BALANCE_SIMPLE_STEPS}
          currentStep={balanceSimpleStep}
          complete={balanceSimpleComplete}
          onReset={balanceSimpleStep > 1 ? () => { reset(); setQueriedAddress(''); setBalancePage(1); setBalanceSimpleRunning(false); setSimpleInfoOpen(false) } : undefined}
          infoOpen={simpleInfoOpen}
          onInfoOpenChange={setSimpleInfoOpen}
          infoContent={
            <p>Archive RPC queries take longer over wide ranges. Narrowing the window or increasing the step reduces query time and sample count.</p>
          }
        />
      )}

      {!simpleMode && <div className="flex w-full gap-1 rounded-sm border border-[var(--hairline)] bg-card p-1 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => { setTab(key); if (key === 'query') setShowImportResults(false) }}
            className={`flex flex-1 min-w-[6rem] items-center justify-center gap-1.5 rounded-sm px-2 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors sm:gap-2 sm:px-3 sm:text-[13px] ${
              tab === key
                ? 'bg-primary/15 text-primary-glow'
                : 'text-text-secondary hover:bg-surface-high hover:text-text'
            }`}
            style={{ fontFamily: 'JetBrains Mono, ui-monospace, monospace', ...(tab === key ? { boxShadow: 'inset 0 0 0 1px rgba(124, 58, 237, 0.35)' } : {}) }}
          >
            <Icon size={13} />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>}

      {/* ── Simple step 3: running screen ── */}
      {simpleMode && balanceSimpleStep === 3 && !simpleInfoOpen && (
        <div className="mx-auto w-full max-w-md rounded-sm border border-white/[0.06] bg-surface px-6 py-14 text-center shadow-ambient">
          <Spinner size={40} className="mx-auto mb-5" />
          <h2 className="mb-1 text-base font-semibold text-text">{activePhase?.label ?? 'Querying archive…'}</h2>
          {displayMeta && (
            <p className="mb-6 text-sm text-text-secondary">{displayMeta}</p>
          )}
          <HoldButton onActivate={cancel} className="btn-stop mx-auto flex items-center gap-2">
            <Square size={14} />
            Stop
          </HoldButton>
        </div>
      )}

      {/* ── Simple page 1: Address + Network ── */}
      {simpleMode && balanceSimpleStep === 1 && !simpleInfoOpen && (
        <div className="mx-auto w-full max-w-lg data-panel space-y-5">
          <div>
            <h2 className="section-title">Select network &amp; enter address</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label htmlFor="bal-rpc-net-sm" className="input-label mb-2 block">Network</label>
              <div className="relative">
                <select
                  id="bal-rpc-net-sm"
                  value={networkKey}
                  onChange={e => { setNetworkKey(e.target.value); clearResolvedRange() }}
                  className="w-full select-field appearance-none pr-8"
                >
                  {PRESET_NETWORKS.map(n => <option key={n.key} value={n.key}>{n.label}</option>)}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
              </div>
              <p className="mt-2 break-all font-mono text-xs text-muted">{activeNetwork.endpoint}</p>
            </div>
            <div>
              <Field
                label="Wallet Address"
                id="bal-addr-sm"
                type="text"
                maxLength={64}
                autoComplete="off"
                spellCheck="false"
                placeholder={`${ADDR_PREFIX_MAP[activeNetwork.key]?.prefix ?? ''}…`}
                value={address}
                onChange={e => setAddress(e.target.value)}
                controlClassName="font-mono"
                error={addressNote?.type === 'error' ? addressNote.msg : undefined}
              />
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => { setSimpleInfoOpen(false); setBalancePage(2) }}
              disabled={!address.trim() || addressNote?.type === 'error'}
              className="btn-primary flex items-center gap-2 disabled:opacity-40"
            >
              Next <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Simple page 2: Range parameters ── */}
      {simpleMode && balanceSimpleStep === 2 && !simpleInfoOpen && (
        <div className="mx-auto w-full max-w-lg data-panel space-y-5">
          <div>
            <h2 className="section-title">Set the query window</h2>
          </div>
          {liveChainSnapshot}
          {isDateRangeSupported && (
            <div>
              <p className="input-label mb-2">Query Mode</p>
              <div className="range-mode-grid">
                {rangeModeOptions.map(option => {
                  const isActive = rangeMode === option.key
                  return (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => { if (option.key === 'block') setStep(''); else setStep('1'); setRangeMode(option.key); clearResolvedRange() }}
                      className={`range-mode-option ${isActive ? 'range-mode-option-active' : 'range-mode-option-idle'}`}
                    >
                      <span className="range-mode-badge" aria-hidden="true">{option.badge}</span>
                      <span className="min-w-0">
                        <span className={`block text-sm font-semibold ${isActive ? 'text-text' : 'text-text-secondary'}`}>{option.title}</span>
                        <span className={`mt-1 block text-xs leading-5 ${isActive ? 'text-text-secondary' : 'text-muted'}`}>{option.description}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {/* Range inputs */}
          {rangeMode === 'era' && (
            <div className="range-params-card space-y-3">
              <h4 className="text-base font-semibold text-text">Range Parameters</h4>
              <div className="space-y-3">
                <Field label="Start Era" id="bal-start-era-sm" type="number" placeholder="1000" min={1} max={chainInfo.era ?? undefined} step={1} value={startEraNum} onChange={e => { setStartEraNum(e.target.value); clearResolvedRange() }} controlClassName="font-mono" />
                <Field label="End Era" id="bal-end-era-sm" type="number" placeholder="1010" min={1} max={chainInfo.era ?? undefined} step={1} value={endEraNum} onChange={e => { setEndEraNum(e.target.value); clearResolvedRange() }} controlClassName="font-mono" />
                <Field label={stepLabel} id="bal-step-era-sm" type="number" min={1} max={999999} step={1} placeholder={stepPlaceholder} value={step} onChange={e => setStep(e.target.value)} controlClassName="font-mono" />
              </div>
              {eraValidErr && <p className="flex items-center gap-1.5 text-[11px] font-mono text-danger"><AlertTriangle size={11} className="flex-shrink-0" />{eraValidErr}</p>}
              {eraLoadErr  && <p className="flex items-center gap-1.5 text-[11px] font-mono text-danger"><AlertTriangle size={11} className="flex-shrink-0" />{eraLoadErr}</p>}
            </div>
          )}
          {rangeMode === 'block' && (
            <div className="range-params-card space-y-3">
              <h4 className="text-base font-semibold text-text">Range Parameters</h4>
              <div className="space-y-3">
                <Field label="Start Block" id="bal-start-sm" type="number" placeholder="14400" min={0} max={chainInfo.block ?? 999999999} step={1} value={startBlock} onChange={e => setStartBlock(e.target.value)} controlClassName="font-mono" />
                <Field label="End Block" id="bal-end-sm" type="number" placeholder="28799" min={0} max={chainInfo.block ?? 999999999} step={1} value={endBlock} onChange={e => setEndBlock(e.target.value)} controlClassName="font-mono" />
                <Field label={stepLabel} id="bal-step-sm" type="number" min={stepMin} max={999999} step={1} placeholder={stepPlaceholder} value={step} onChange={e => setStep(e.target.value)} controlClassName="font-mono" />
              </div>
              {blockErr && <p className="flex items-center gap-1.5 text-[11px] font-mono text-danger"><AlertTriangle size={11} className="flex-shrink-0" />{blockErr}</p>}
            </div>
          )}
          {rangeMode === 'date' && (
            <div className="range-params-card space-y-3">
              <h4 className="text-base font-semibold text-text">Range Parameters</h4>
              <div>
                <span className="input-label">Quick Range</span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {DATE_PRESETS.map(({ label, days }) => (
                    <button key={label} type="button" onClick={() => applyDatePreset(days, label)} className={`range-preset-button ${activePreset === label ? 'range-preset-button-active' : 'range-preset-button-idle'}`}>{label} ago</button>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <Field label="Start Date" id="bal-start-date-sm" type="date" max={toDateInput(new Date())} value={startDate} onChange={e => { setStartDate(e.target.value); setActivePreset(null); clearResolvedRange() }} controlClassName="font-mono" />
                <Field label="End Date" id="bal-end-date-sm" type="date" max={toDateInput(new Date())} value={endDate} onChange={e => { setEndDate(e.target.value); setActivePreset(null); clearResolvedRange() }} controlClassName="font-mono" />
                <Field label={stepLabel} id="bal-step-date-sm" type="number" min={stepMin} max={999} step={1} placeholder={stepPlaceholder} value={step} onChange={e => setStep(e.target.value)} controlClassName="font-mono" />
              </div>
              {dateValidErr && <p className="flex items-center gap-1.5 text-[11px] font-mono text-danger"><AlertTriangle size={11} className="flex-shrink-0" />{dateValidErr}</p>}
              {eraLoadErr   && <p className="flex items-center gap-1.5 text-[11px] font-mono text-danger"><AlertTriangle size={11} className="flex-shrink-0" />{eraLoadErr}</p>}
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={() => { setSimpleInfoOpen(false); setBalancePage(1) }} className="btn-secondary flex items-center gap-2">
              <span aria-hidden="true">←</span> Back
            </button>
            <button
              onClick={handleFetch}
              className="btn-primary btn-push flex items-center gap-2 disabled:opacity-40"
              disabled={
                (step === '' || step == null) ||
                (rangeMode === 'block' ? (!startBlock || !endBlock || !!blockErr) :
                 rangeMode === 'era'   ? (!startEraNum || !endEraNum || !!eraValidErr) :
                                        (!startDate || !endDate || !!dateValidErr))
              }
            >
              <Activity size={14} /> Fetch Balance
            </button>
          </div>
        </div>
      )}

      {/* ── Query pane — advanced only ── */}
      {tab === 'query' && !simpleMode && (
        <div className="space-y-3 sm:space-y-4">
          {!simpleMode && <ToolInfoSection tone="warning">
            <p>Archive RPC queries take longer over wide ranges. Narrowing the window or increasing the step reduces query time and sample count.</p>
          </ToolInfoSection>}
          <div className="grid gap-4 xl:grid-cols-3 xl:items-stretch">
              <div className="data-panel">
                <h3 className="font-headline text-lg font-bold text-text sm:text-xl">Scan Configuration</h3>

                  <div className="mt-4 grid gap-3">
                    <div className="rounded-sm border border-[var(--hairline)] bg-card px-3 py-3 sm:px-4 sm:py-4">
                      <p className="text-sm font-semibold text-text">Select network</p>
                      <div className="relative mt-3">
                        <select
                          id="bal-rpc-net"
                          value={networkKey}
                          onChange={e => {
                            setNetworkKey(e.target.value)
                            clearResolvedRange()
                          }}
                          disabled={isLoading}
                          className="w-full select-field appearance-none pr-8"
                        >
                          {PRESET_NETWORKS.map(n => (
                            <option key={n.key} value={n.key}>{n.label}</option>
                          ))}
                        </select>
                        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary" />
                      </div>
                      <p className="section-label mt-4">Endpoint</p>
                      <p className="mt-2 break-all rounded-sm bg-card px-3 py-3 font-mono text-sm text-text-secondary" title={activeNetwork.endpoint}>
                        {activeNetwork.endpoint}
                      </p>
                    </div>

                    <div className="rounded-sm border border-[var(--hairline)] bg-card px-3 py-3 sm:px-4 sm:py-4">
                      <Field
                        label="Wallet Address"
                        id="bal-addr"
                        type="text"
                        maxLength={64}
                        autoComplete="off"
                        spellCheck="false"
                        placeholder={`${ADDR_PREFIX_MAP[activeNetwork.key]?.prefix ?? ''}...`}
                        value={address}
                        onChange={e => setAddress(e.target.value)}
                        disabled={isLoading}
                        controlClassName="font-mono"
                        error={addressNote?.type === 'error' ? addressNote.msg : undefined}
                      />
                    </div>

                    {isDateRangeSupported && null}
                  </div>
                </div>

              {/* Col 2: Query Range + Live chain + Range Parameters + action */}
              <div className="data-panel space-y-4">
              {liveChainSnapshot}

              {/* ── Query Range selector (Relaychain / Canary Relaychain) ── */}
              {isDateRangeSupported && (
                <div className="rounded-sm border border-[var(--hairline)] bg-card px-3 py-3 sm:px-4 sm:py-4">
                  <p className="text-sm font-semibold text-text">Query Range</p>
                  <div className="range-mode-grid mt-3">
                    {rangeModeOptions.map(option => {
                      const isActive = rangeMode === option.key
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => {
                            if (option.key === 'block') setStep('')
                            else setStep('1')
                            setRangeMode(option.key)
                            clearResolvedRange()
                          }}
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
              )}

              {/* ── Era range inputs (Relaychain era mode) ──────────── */}
              {rangeMode === 'era' && (
                <div className="range-params-card space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-semibold text-text">Range Parameters</h4>
                  </div>
                </div>
                <div className="space-y-3">
                  <Field
                    label="Start Era" id="bal-start-era" type="number" placeholder="1000"
                    min={1} max={chainInfo.era ?? undefined} step={1}
                    value={startEraNum}
                    onChange={e => { setStartEraNum(e.target.value); clearResolvedRange() }}
                    disabled={isLoading}
                    controlClassName="font-mono"
                  />
                  <Field
                    label="End Era" id="bal-end-era" type="number" placeholder="1010"
                    min={1} max={chainInfo.era ?? undefined} step={1}
                    value={endEraNum}
                    onChange={e => { setEndEraNum(e.target.value); clearResolvedRange() }}
                    disabled={isLoading}
                    controlClassName="font-mono"
                  />
                  <Field
                    label={stepLabel} id="bal-step-era" type="number"
                    min={1} max={999999} step={1} placeholder={stepPlaceholder}
                    value={step}
                    onChange={e => setStep(e.target.value)}
                    disabled={isLoading}
                    controlClassName="font-mono"
                  />
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
                <div className="range-params-card space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-semibold text-text">Range Parameters</h4>
                  </div>
                </div>
                <div className="space-y-3">
                <Field
                  label="Start Block" id="bal-start" type="number" placeholder="14400"
                  min={0} max={chainInfo.block ?? 999999999} step={1}
                  value={startBlock}
                  onChange={e => setStartBlock(e.target.value)}
                  disabled={isLoading}
                  controlClassName="font-mono"
                />
                <Field
                  label="End Block" id="bal-end" type="number" placeholder="28799"
                  min={0} max={chainInfo.block ?? 999999999} step={1}
                  value={endBlock}
                  onChange={e => setEndBlock(e.target.value)}
                  disabled={isLoading}
                  controlClassName="font-mono"
                />
                <Field
                  label={stepLabel} id="bal-step" type="number"
                  min={stepMin} max={999999} step={1} placeholder={stepPlaceholder}
                  value={step}
                  onChange={e => setStep(e.target.value)}
                  disabled={isLoading}
                  controlClassName="font-mono"
                />
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
                <div className="range-params-card space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-base font-semibold text-text">Range Parameters</h4>
                  </div>
                </div>
                {/* Quick presets */}
                <div>
                  <span className="input-label">Quick Range</span>
                  <div className="flex flex-wrap gap-2">
                    {DATE_PRESETS.map(({ label, days }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => applyDatePreset(days, label)}
                        disabled={isLoading}
                        className={`range-preset-button ${
                          activePreset === label ? 'range-preset-button-active' : 'range-preset-button-idle'
                        }`}
                      >
                        {label} ago
                      </button>
                    ))}
                  </div>
                </div>

                {/* Start / End date + step */}
                <div className="space-y-3">
                  <Field
                    label="Start Date" id="bal-start-date" type="date"
                    max={toDateInput(new Date())}
                    value={startDate}
                    onChange={e => { setStartDate(e.target.value); setActivePreset(null); clearResolvedRange() }}
                    disabled={isLoading}
                    controlClassName="font-mono"
                  />
                  <Field
                    label="End Date" id="bal-end-date" type="date"
                    max={toDateInput(new Date())}
                    value={endDate}
                    onChange={e => { setEndDate(e.target.value); setActivePreset(null); clearResolvedRange() }}
                    disabled={isLoading}
                    controlClassName="font-mono"
                  />
                  <Field
                    label={stepLabel} id="bal-step-date" type="number"
                    min={stepMin} max={999} step={1} placeholder={stepPlaceholder}
                    value={step}
                    onChange={e => setStep(e.target.value)}
                    disabled={isLoading}
                    controlClassName="font-mono"
                  />
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

              {/* Error banner */}
              {status === STATUS.ERROR && errorMsg && (
                <div
                  role="alert"
                  className="flex gap-3 px-4 py-3 rounded-sm bg-danger/10 animate-fade-in"
                >
                  <AlertTriangle size={16} className="text-danger flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-danger leading-relaxed">{errorMsg}</p>
                </div>
              )}

              {/* Action row */}
              <div className="flex flex-col items-center gap-3">
                {/* Distinct keys: Stop and Reset share this slot, and without
                    them the charge earned on Stop would carry straight over to
                    Reset on a double click. */}
                {isLoading ? (
                  <HoldButton key="stop" onActivate={cancel} className="btn-stop w-full sm:w-auto sm:min-w-[200px]">
                    <Square size={14} />
                    STOP
                  </HoldButton>
                ) : hasResults ? (
                  <HoldButton key="reset" onActivate={() => { reset(); setQueriedAddress('') }} className="btn-primary w-full sm:w-auto sm:min-w-[200px]">
                    <RotateCcw size={14} />
                    RESET
                  </HoldButton>
                ) : (
                  <button
                    onClick={handleFetch}
                    className="btn-primary btn-push w-full sm:w-auto sm:min-w-[200px]"
                    disabled={
                      !address.trim() ||
                      addressNote?.type === 'error' ||
                      (step === '' || step == null) ||
                      (rangeMode === 'block' ? (!startBlock || !endBlock || !!blockErr) :
                       rangeMode === 'era'   ? (!startEraNum || !endEraNum || !!eraValidErr) :
                                              (!startDate || !endDate || !!dateValidErr))
                    }
                  >
                    <Activity size={14} />
                    Fetch Balance
                  </button>
                )}
                {estCalls != null && addressNote?.type !== 'error' && step !== '' && step != null && !(rangeMode === 'block' ? !!blockErr : rangeMode === 'era' ? !!eraValidErr : !!dateValidErr) && (
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

              </div>

              {/* Col 3: Scan Progress — advanced only */}
              {!simpleMode && (
                <div className="hidden xl:flex xl:flex-col">
                  <PhaseProgressCards
                    indexLabel="Phase"
                    title="Scan Progress"
                    summary={displaySummary}
                    meta={displayMeta}
                    phases={displayPhases}
                    ariaLabel="Balance query progress"
                  />
                </div>
              )}
          </div>

          {!simpleMode && (
            <div className="xl:hidden mt-4">
              <PhaseProgressCards
                indexLabel="Phase"
                title="Scan Progress"
                summary={displaySummary}
                meta={displayMeta}
                phases={displayPhases}
                ariaLabel="Balance query progress"
              />
            </div>
          )}
        </div>
      )}

      {/* ── Import pane — advanced only ── */}
      {!simpleMode && tab === 'import' && (
        <div className="overflow-hidden rounded-sm border border-[var(--hairline)] bg-surface">
          <div role="tabpanel" className="p-4 sm:p-6">
              {!showImportResults ? (
                <div className="space-y-3">
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
                <BalanceImportPanel
                  bare
                  onImport={handleImport}
                  onImportEncrypted={handleImportEncrypted}
                />
                </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="section-label">Import</p>
                    <h3 className="mt-2 font-headline text-2xl font-bold text-text">Imported Data</h3>
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
        </div>
      )}

      {/* ── Results (shown for any data source; also visible DURING query) ── */}
      {(hasResults || isLoading) && (!simpleMode || balanceSimpleStep !== 3) && (
        <section ref={resultsRef} className="space-y-4">
          {/* Records summary bar */}
          {hasResults && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 data-panel">
              {[
                { label: 'Wallet',         value: queriedAddress ? queriedAddress : '—' },
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

          {hasResults && (() => {
            const maxFree = records.reduce((m, r) => r.free > m ? r.free : m, 0n)
            let totalLocked = 0n, totalBalance = 0n
            for (const r of records) {
              const frozen = r.miscFrozen ?? r.feeFrozen ?? 0n
              const locked = r.reserved + frozen
              totalLocked += locked
              totalBalance += r.free + locked
            }
            const utilizationPct = totalBalance > 0n
              ? Number((totalLocked * 10000n) / totalBalance) / 100
              : 0
            return (
              <div className="data-panel border border-white/5">
                <div className="mb-3 flex items-center gap-2">
                  <Sparkles size={14} className="text-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-secondary">Smart Insights</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-sm bg-card px-4 py-3 border-l-[3px] border-l-cyan" style={{ border: '1px solid rgba(70,71,82,0.08)', borderLeft: '3px solid var(--cyan)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-secondary">Max Free Balance</p>
                    <p className="mt-2 font-headline text-lg font-bold text-cyan">{fmtENJ(maxFree)}</p>
                  </div>
                  <div className="rounded-sm bg-card px-4 py-3" style={{ border: '1px solid rgba(70,71,82,0.08)', borderLeft: '3px solid var(--primary)' }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-secondary">Balance Utilization</p>
                    <div className="mt-2 flex items-end gap-2">
                      <p className="font-headline text-lg font-bold text-primary">{utilizationPct.toFixed(1)}%</p>
                      <p className="mb-0.5 text-[11px] text-text-secondary">reserved + frozen</p>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-surface overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary-dim to-primary transition-[width] duration-500" style={{ width: `${Math.min(100, utilizationPct)}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}

          <BalanceTable records={records} isLoading={isLoading} />

          {dataSource === 'query' && hasResults && (status === STATUS.DONE || status === STATUS.CANCELLED) && (
            <div className="md:w-1/2"><BalanceExportPanel records={records} rpcMeta={rpcMetaRef.current} /></div>
          )}
        </section>
      )}

      {/* ── Sticky terminal log — advanced only ── */}
      {!simpleMode && (
        <TerminalLog
          sticky
          logs={logs.map((l, i) => ({
            id: i,
            ts: l.ts,
            level: l.level.toUpperCase(),
            message: l.msg,
          }))}
        />
      )}
    </div>
  )
}
