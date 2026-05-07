import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Database, ExternalLink, ImageIcon, Loader2, RefreshCw, Search, Square, Wallet } from 'lucide-react'
import DetailModal from './DetailModal.jsx'
import PhaseProgressCards from './PhaseProgressCards.jsx'
import TerminalLog from './TerminalLog.jsx'
import ToolInfoSection from './ToolInfoSection.jsx'

const CONTRACT_ADDRESS = '0xfaafdc07907ff5120a76b34b731b278c38d6043c'
const ETHERSCAN_NFT_HOLDINGS_URL = import.meta.env.DEV
  ? '/__enj-wallet-tokens'
  : '/api/enj-wallet-tokens'
const ENJ_TOKEN_DETAILS_URL = import.meta.env.DEV
  ? '/__enj-token-details'
  : '/api/enj-token-details'
const ALCHEMY_ETH_CALL_URL = import.meta.env.DEV
  ? '/__eth-call'
  : '/api/eth-call'
const TYPE_DATA_SELECTOR = '4341963e'
const WEI_PER_ENJ = 10n ** 18n
const BULK_RPC_CONCURRENCY = 3
const BULK_PAGE_SIZE_OPTIONS = [10, 25, 50]
const BULK_SORT_LABELS = {
  tokenId: 'Token ID',
  previewImage: 'Token Preview Image',
  tokenName: 'Token Name',
  amount: 'ENJ Infusion',
  raw: 'Raw ENJ Infusion',
}
const SINGLE_PROGRESS_PHASES = [
  { key: 'input', label: 'Validate Token', total: 1, completed: 0, status: 'pending' },
  { key: 'rpc', label: 'Read Contract', total: 1, completed: 0, status: 'pending' },
  { key: 'decode', label: 'Decode Infusion', total: 1, completed: 0, status: 'pending' },
]
const BULK_PROGRESS_PHASES = [
  { key: 'wallet', label: 'Step 0: Fetch Wallet Tokens', total: 1, completed: 0, status: 'pending' },
  { key: 'infusions', label: 'Step 1: Read Infusion', total: 1, completed: 0, status: 'pending' },
  { key: 'metadata', label: 'Step 2: Fetch Token Metadata', total: 1, completed: 0, status: 'pending' },
  { key: 'review', label: 'Step 3: Review', total: 1, completed: 0, status: 'pending' },
  { key: 'retries', label: 'Auto Retry Failed Reads', total: 0, completed: 0, status: 'pending' },
]

const RPC_ENDPOINTS = [
  ['Alchemy/Etherscan', ALCHEMY_ETH_CALL_URL],
  ['PublicNode', 'https://ethereum-rpc.publicnode.com'],
  ['LlamaRPC', 'https://eth.llamarpc.com'],
  ['Ankr', 'https://rpc.ankr.com/eth'],
]

function getEtherscanTokenUrl(tokenId) {
  return `https://etherscan.io/nft/${CONTRACT_ADDRESS}/${tokenId}`
}

function normalizeTokenId(value) {
  const trimmed = value.trim()

  try {
    const url = new URL(trimmed)
    const parts = url.pathname.split('/').filter(Boolean)
    const tokenId = parts[parts.length - 1]?.replaceAll('_', '') ?? ''
    const contractAddress = parts[1]?.toLowerCase()

    if (
      url.hostname.replace(/^www\./, '').toLowerCase() === 'etherscan.io' &&
      parts[0]?.toLowerCase() === 'nft' &&
      contractAddress === CONTRACT_ADDRESS.toLowerCase() &&
      /^\d+$/.test(tokenId)
    ) {
      return tokenId
    }
  } catch (error) {
    // Plain token IDs are handled below.
  }

  return trimmed.replaceAll('_', '')
}

function normalizeAddress(value) {
  return value.trim()
}

function validateTokenId(tokenId) {
  if (!tokenId) throw new Error('Enter a token ID.')
  if (!/^\d+$/.test(tokenId)) throw new Error('Token ID must contain digits only.')

  const parsed = BigInt(tokenId)
  const maxUint256 = (1n << 256n) - 1n
  if (parsed > maxUint256) throw new Error('Token ID is larger than uint256.')

  return parsed
}

function validateAddress(address) {
  if (!address) throw new Error('Enter an Ethereum wallet address.')
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('Wallet address must be a 0x-prefixed Ethereum address.')
  }

  return address
}

function encodeUint256(value) {
  return value.toString(16).padStart(64, '0')
}

function buildTypeDataCall(tokenId) {
  return `0x${TYPE_DATA_SELECTOR}${encodeUint256(tokenId)}`
}

function parseUint256Words(hex) {
  if (!hex || hex === '0x') throw new Error('The contract returned no data.')

  const payload = hex.startsWith('0x') ? hex.slice(2) : hex
  if (payload.length < 64 * 4) {
    throw new Error('The contract returned an unexpected response.')
  }

  return [0, 1, 2, 3].map(index => {
    const word = payload.slice(index * 64, (index + 1) * 64)
    return BigInt(`0x${word}`)
  })
}

function formatEnj(raw) {
  const whole = raw / WEI_PER_ENJ
  const fraction = raw % WEI_PER_ENJ

  if (fraction === 0n) return `${whole.toLocaleString('en')} ENJ`

  const decimals = fraction.toString().padStart(18, '0').replace(/0+$/, '')
  return `${whole.toLocaleString('en')}.${decimals} ENJ`
}

function formatTokenId(tokenId) {
  return tokenId.length > 12 ? `${tokenId.slice(0, 5)}...${tokenId.slice(-5)}` : tokenId
}

function sumSuccessfulRaw(rows) {
  return rows.reduce((total, row) => {
    if (row.error || !/^\d+$/.test(String(row.raw || ''))) return total
    return total + BigInt(row.raw)
  }, 0n)
}

function compareNumericStrings(a, b) {
  const aIsNumber = /^\d+$/.test(String(a || ''))
  const bIsNumber = /^\d+$/.test(String(b || ''))

  if (aIsNumber && bIsNumber) {
    const aBig = BigInt(a)
    const bBig = BigInt(b)
    return aBig < bBig ? -1 : aBig > bBig ? 1 : 0
  }

  if (aIsNumber) return -1
  if (bIsNumber) return 1
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
}

function getBulkSortValue(row, key) {
  switch (key) {
    case 'tokenId':
      return row.tokenId
    case 'previewImage':
      return row.metadata?.previewImage ? 1 : 0
    case 'tokenName':
      return row.metadata?.name || ''
    case 'amount':
    case 'raw':
      return row.error ? '' : row.raw
    default:
      return ''
  }
}

function compareBulkRows(a, b, key) {
  if (key === 'tokenId' || key === 'amount' || key === 'raw') {
    return compareNumericStrings(getBulkSortValue(a, key), getBulkSortValue(b, key))
  }

  if (key === 'previewImage') {
    return getBulkSortValue(a, key) - getBulkSortValue(b, key)
  }

  return String(getBulkSortValue(a, key)).localeCompare(
    String(getBulkSortValue(b, key)),
    undefined,
    { numeric: true, sensitivity: 'base' },
  )
}

function isAbortError(error) {
  return error?.name === 'AbortError'
}

function createUserAbortError() {
  return new DOMException('Scan canceled by user.', 'AbortError')
}

async function callRpc([name, url], data, signal) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12000)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: CONTRACT_ADDRESS, data }, 'latest'],
      }),
      signal: controller.signal,
    })

    const body = await response.json()
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
    if (body.error) throw new Error(body.error.message || 'RPC returned an error.')

    return { name: response.headers.get('x-rpc-provider') || name, result: body.result }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    window.clearTimeout(timeout)
  }
}

async function readInfusion(tokenId, onEndpoint, signal) {
  const data = buildTypeDataCall(tokenId)
  const errors = []

  for (const endpoint of RPC_ENDPOINTS) {
    if (signal?.aborted) throw createUserAbortError()
    onEndpoint?.({ phase: 'start', label: endpoint[0] })

    try {
      const response = await callRpc(endpoint, data, signal)
      onEndpoint?.({ phase: 'success', label: response.name })
      return parseUint256Words(response.result)[3]
    } catch (error) {
      if (isAbortError(error)) throw error
      errors.push(`${endpoint[0]}: ${error.message}`)
      onEndpoint?.({ phase: 'error', label: endpoint[0], error: error.message })
    }
  }

  throw new Error(`All RPC endpoints failed. ${errors.join(' | ')}`)
}

async function fetchWalletTokens(address, onStatus, signal) {
  onStatus('Fetching wallet ERC-1155 transfer history.')
  const url = new URL(ETHERSCAN_NFT_HOLDINGS_URL, window.location.origin)
  url.searchParams.set('address', address)

  const response = await fetch(url, { signal })
  const body = await response.json().catch(() => ({}))

  if (!response.ok) throw new Error(body.error || `Etherscan returned HTTP ${response.status}.`)
  if (!Array.isArray(body.tokens)) throw new Error('Etherscan returned an unexpected response.')

  onStatus(`Found ${body.tokens.length} current token IDs.`)
  return body.tokens
}

function mergeTokenMetadata(base, detail) {
  if (!detail || detail.error) return base

  return {
    ...base,
    owner: detail.owner || base.owner,
    contractAddress: detail.contractAddress || base.contractAddress,
    creator: detail.creator || base.creator,
    tokenStandard: detail.tokenStandard || base.tokenStandard,
    quantity: detail.quantity || base.quantity,
    name: detail.name || base.name,
    previewImage: detail.previewImage || base.previewImage,
    imageUrl: detail.imageUrl || base.imageUrl,
    description: detail.description || base.description,
    properties: detail.properties?.length ? detail.properties : base.properties,
    tokenUri: detail.tokenUri || base.tokenUri,
    metadataError: detail.metadataError || base.metadataError,
    source: detail.source || (detail.tokenUri ? 'etherscan-api-eth-call' : base.source),
  }
}

async function fetchTokenDetails(owner, tokenId, signal) {
  const url = new URL(ENJ_TOKEN_DETAILS_URL, window.location.origin)
  url.searchParams.set('owner', owner)
  url.searchParams.set('tokenId', tokenId)

  const response = await fetch(url, { signal })
  const body = await response.json().catch(() => ({}))

  if (!response.ok) throw new Error(body.error || `Token details returned HTTP ${response.status}.`)
  return body
}

export default function InfusionChecker({ onScanStateChange }) {
  const [mode, setMode] = useState('single')
  const [tokenId, setTokenId] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [amount, setAmount] = useState('-')
  const [rawValue, setRawValue] = useState('Raw infusion value will appear here.')
  const [bulkStatus, setBulkStatus] = useState('Wallet results will appear here.')
  const [bulkTotal, setBulkTotal] = useState('-')
  const [rows, setRows] = useState([])
  const [bulkStarted, setBulkStarted] = useState(false)
  const [bulkExpectedTotal, setBulkExpectedTotal] = useState(0)
  const [metadataProgress, setMetadataProgress] = useState({ total: 0, completed: 0 })
  const [retryProgress, setRetryProgress] = useState({ total: 0, completed: 0, active: false })
  const [bulkPage, setBulkPage] = useState(1)
  const [bulkPageSize, setBulkPageSize] = useState(10)
  const [bulkSearch, setBulkSearch] = useState('')
  const [bulkSort, setBulkSort] = useState({ key: '', direction: 'asc' })
  const [selectedTokenDetails, setSelectedTokenDetails] = useState(null)
  const [retryingTokenIds, setRetryingTokenIds] = useState(() => new Set())
  const [isRetryingAllFailed, setIsRetryingAllFailed] = useState(false)
  const [bulkFailureMessage, setBulkFailureMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [logs, setLogs] = useState([])
  const scanAbortRef = useRef(null)
  const rowsRef = useRef([])
  const singleResultRef = useRef(null)
  const bulkResultRef = useRef(null)
  const previousLoadingRef = useRef(false)

  const log = useCallback((level, msg) => {
    setLogs(prev => {
      const entry = {
        level,
        msg: String(msg),
        ts: new Date().toLocaleTimeString('en', {
          hour12: false, hour: '2-digit', minute: '2-digit',
          second: '2-digit', fractionalSecondDigits: 2,
        }),
      }
      const next = [...prev, entry]
      return next.length > 500 ? next.slice(-500) : next
    })
  }, [])

  const resultAmount = mode === 'single' ? amount : bulkTotal
  const resultLabel = mode === 'single' ? 'Token Infusion' : 'Total Wallet Infusion'
  const singleStarted = mode === 'single' && (isLoading || amount !== '-' || rawValue !== 'Raw infusion value will appear here.')
  const progressPhases = useMemo(() => {
    if (mode === 'single') {
      if (!singleStarted) return SINGLE_PROGRESS_PHASES
      if (isLoading) {
        return [
          { ...SINGLE_PROGRESS_PHASES[0], completed: 1, status: 'completed' },
          { ...SINGLE_PROGRESS_PHASES[1], completed: 0, status: 'in_progress' },
          SINGLE_PROGRESS_PHASES[2],
        ]
      }
      const succeeded = amount !== '-'
      return [
        { ...SINGLE_PROGRESS_PHASES[0], completed: 1, status: 'completed' },
        { ...SINGLE_PROGRESS_PHASES[1], completed: succeeded ? 1 : 0, status: succeeded ? 'completed' : 'pending' },
        { ...SINGLE_PROGRESS_PHASES[2], completed: succeeded ? 1 : 0, status: succeeded ? 'completed' : 'pending' },
      ]
    }

    if (!bulkStarted) return BULK_PROGRESS_PHASES
    const checked = rows.length
    const total = Math.max(1, bulkExpectedTotal)
    const metadataTotal = Math.max(1, metadataProgress.total || bulkExpectedTotal || 1)
    const metadataDone = Math.min(metadataProgress.completed, metadataTotal)
    const finished = bulkExpectedTotal > 0 && checked >= bulkExpectedTotal && !isLoading
    const reviewDone = !isLoading && (rows.length > 0 || bulkExpectedTotal === 0)

    const walletStatus = bulkExpectedTotal > 0
      ? 'completed'
      : isLoading
        ? 'in_progress'
        : 'pending'

    const infusionStatus = finished
      ? 'completed'
      : checked > 0 || isLoading
        ? 'in_progress'
        : 'pending'

    const metadataStatus = metadataDone >= metadataTotal && metadataProgress.total > 0
      ? 'completed'
      : metadataDone > 0
        ? 'in_progress'
        : 'pending'

    const retryTotal = Math.max(0, retryProgress.total)
    const retryDone = Math.min(retryProgress.completed, retryTotal)
    const retryStatus = retryProgress.active
      ? 'in_progress'
      : retryTotal > 0 && retryDone >= retryTotal
        ? 'completed'
        : 'pending'

    return [
      { ...BULK_PROGRESS_PHASES[0], completed: bulkExpectedTotal > 0 ? 1 : 0, status: walletStatus },
      {
        ...BULK_PROGRESS_PHASES[1],
        total,
        completed: Math.min(checked, total),
        status: infusionStatus,
      },
      {
        ...BULK_PROGRESS_PHASES[2],
        total: metadataTotal,
        completed: metadataDone,
        status: metadataStatus,
      },
      { ...BULK_PROGRESS_PHASES[3], completed: reviewDone ? 1 : 0, status: reviewDone ? 'completed' : 'pending' },
      {
        ...BULK_PROGRESS_PHASES[4],
        total: retryTotal,
        completed: retryDone,
        status: retryStatus,
      },
    ]
  }, [
    amount,
    bulkExpectedTotal,
    bulkStarted,
    isLoading,
    metadataProgress.completed,
    metadataProgress.total,
    mode,
    retryProgress.active,
    retryProgress.completed,
    retryProgress.total,
    rows.length,
    singleStarted,
  ])
  const progressTitle = 'Scan Progress'
  const progressSummary = null
  const filteredSortedRows = useMemo(() => {
    const query = bulkSearch.trim().toLowerCase()
    const filteredRows = query
      ? rows.filter(row => {
        const tokenName = row.metadata?.name || ''
        return row.tokenId.toLowerCase().includes(query) || tokenName.toLowerCase().includes(query)
      })
      : rows

    if (!bulkSort.key) return filteredRows

    return [...filteredRows].sort((a, b) => {
      const result = compareBulkRows(a, b, bulkSort.key)
      return bulkSort.direction === 'desc' ? -result : result
    })
  }, [bulkSearch, bulkSort, rows])
  const totalBulkPages = Math.max(1, Math.ceil(filteredSortedRows.length / bulkPageSize))
  const safeBulkPage = Math.min(bulkPage, totalBulkPages)
  const visibleRows = useMemo(() => {
    const start = (safeBulkPage - 1) * bulkPageSize
    return filteredSortedRows.slice(start, start + bulkPageSize)
  }, [bulkPageSize, filteredSortedRows, safeBulkPage])
  const failedBulkRows = useMemo(() => rows.filter(row => row.error), [rows])
  const hasRetryingRows = retryingTokenIds.size > 0

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])

  useEffect(() => {
    onScanStateChange?.(isLoading)
  }, [isLoading, onScanStateChange])

  useEffect(() => () => {
    onScanStateChange?.(false)
  }, [onScanStateChange])

  useEffect(() => {
    const wasLoading = previousLoadingRef.current
    previousLoadingRef.current = isLoading

    if (!(wasLoading && !isLoading)) return

    if (mode === 'wallet' && bulkStarted) {
      bulkResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }

    if (mode === 'single' && singleStarted) {
      singleResultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [isLoading, mode, bulkStarted, singleStarted])

  function appendRow(row) {
    setRows(current => [...current, row])
  }

  function createScanController() {
    scanAbortRef.current?.abort()
    const controller = new AbortController()
    scanAbortRef.current = controller
    return controller
  }

  function clearScanController(controller) {
    if (scanAbortRef.current === controller) {
      scanAbortRef.current = null
    }
  }

  function handleStopScan() {
    if (!isLoading) return
    scanAbortRef.current?.abort()
    if (mode === 'wallet') setBulkStatus('Scan canceled by user.')
    setRawValue('Scan canceled by user.')
    log('warn', 'Scan canceled by user.')
  }

  function handleBulkSort(key) {
    setBulkSort(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
    setBulkPage(1)
  }

  function renderSortIcon(key) {
    if (bulkSort.key !== key) return <ArrowUpDown size={13} />
    return bulkSort.direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
  }

  function renderSortableHeader(key, className = '') {
    const isSorted = bulkSort.key === key
    const directionLabel = isSorted
      ? `sorted ${bulkSort.direction === 'asc' ? 'ascending' : 'descending'}`
      : 'not sorted'

    return (
      <th className={`px-3 py-3 text-center ${className}`} aria-sort={isSorted ? (bulkSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          onClick={() => handleBulkSort(key)}
          className={`inline-flex items-center justify-center gap-1.5 text-center uppercase tracking-[0.2em] transition-colors hover:text-cyan ${isSorted ? 'text-cyan' : ''}`}
          aria-label={`Sort by ${BULK_SORT_LABELS[key]} (${directionLabel})`}
        >
          <span>{BULK_SORT_LABELS[key]}</span>
          {renderSortIcon(key)}
        </button>
      </th>
    )
  }

  async function handleSingleCheck(event) {
    event.preventDefault()
    const controller = createScanController()

    try {
      const parsedTokenId = validateTokenId(normalizeTokenId(tokenId))
      setIsLoading(true)
      setAmount('-')
      setRawValue('Waiting for contract response.')
      log('info', `Single check: tokenId=${parsedTokenId.toString()}`)
      log('info', `Contract: ${CONTRACT_ADDRESS} method: typeData(uint256)`)

      const raw = await readInfusion(parsedTokenId, event => {
        if (event.phase === 'start') log('info', `Querying ${event.label}`)
        if (event.phase === 'success') log('ok', `RPC response from ${event.label}`)
        if (event.phase === 'error') log('warn', `${event.label}: ${event.error}`)
      }, controller.signal)

      setAmount(formatEnj(raw))
      setRawValue(`Raw fourth value: ${raw.toString()}`)
      log('ok', `Infusion: ${formatEnj(raw)} (raw=${raw.toString()})`)
    } catch (error) {
      if (isAbortError(error)) {
        setAmount('-')
        setRawValue('Scan canceled by user.')
        log('warn', 'Single check canceled by user.')
        return
      }
      setAmount('-')
      setRawValue(error.message)
      log('err', `Single check failed: ${error.message}`)
    } finally {
      clearScanController(controller)
      setIsLoading(false)
    }
  }

  async function readBulkInfusions(tokens, signal) {
    let cursor = 0
    let completed = 0
    let failed = 0
    let total = 0n
    const failedTokenIds = []

    const worker = async () => {
      while (cursor < tokens.length) {
        if (signal?.aborted) throw createUserAbortError()
        const index = cursor
        cursor += 1
        const token = tokens[index]

        try {
          const parsedTokenId = validateTokenId(token.tokenId)
          const raw = await readInfusion(parsedTokenId, event => {
            if (event.phase === 'start') log('info', `Token ${formatTokenId(token.tokenId)}: querying ${event.label}`)
            if (event.phase === 'success') log('ok', `Token ${formatTokenId(token.tokenId)}: RPC response from ${event.label}`)
            if (event.phase === 'error') log('warn', `Token ${formatTokenId(token.tokenId)}: ${event.label}: ${event.error}`)
          }, signal)

          total += raw
          appendRow({
            tokenId: token.tokenId,
            amount: formatEnj(raw),
            raw: raw.toString(),
            error: false,
            metadata: token.metadata,
            metadataError: null,
          })
          setBulkTotal(formatEnj(total))
          setRawValue(`Total raw infusion: ${total.toString()}`)
          log('info', `Token ${formatTokenId(token.tokenId)}: ${formatEnj(raw)}`)
        } catch (error) {
          if (isAbortError(error)) throw error
          failed += 1
          failedTokenIds.push(token.tokenId)
          appendRow({
            tokenId: token.tokenId,
            amount: 'Failed',
            raw: 'See terminal log',
            error: true,
            metadata: token.metadata,
            metadataError: null,
            errorMessage: error.message,
          })
          log('err', `Token ${formatTokenId(token.tokenId)} failed: ${error.message}`)
        } finally {
          completed += 1
          setBulkStatus(`Checked ${completed} of ${tokens.length} token IDs.`)
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(BULK_RPC_CONCURRENCY, tokens.length) }, worker),
    )

    return { total, failed, failedTokenIds }
  }

  async function fetchBulkMetadata(tokens, signal) {
    let cursor = 0

    const worker = async () => {
      while (cursor < tokens.length) {
        if (signal?.aborted) throw createUserAbortError()
        const index = cursor
        cursor += 1
        const token = tokens[index]

        try {
          const details = await fetchTokenDetails(token.metadata.owner, token.tokenId, signal)
          setRows(current => current.map(row => row.tokenId === token.tokenId
            ? {
              ...row,
              metadata: mergeTokenMetadata(row.metadata || token.metadata || {}, details),
              metadataError: details.metadataError || null,
            }
            : row))
          log('ok', `Token ${formatTokenId(token.tokenId)}: metadata fetched`)
        } catch (error) {
          if (isAbortError(error)) throw error
          setRows(current => current.map(row => row.tokenId === token.tokenId
            ? { ...row, metadataError: error.message }
            : row))
          log('warn', `Token ${formatTokenId(token.tokenId)}: metadata unavailable — ${error.message}`)
        } finally {
          setMetadataProgress(current => ({
            ...current,
            completed: Math.min(current.total || tokens.length, current.completed + 1),
          }))
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(BULK_RPC_CONCURRENCY, tokens.length) }, worker),
    )
  }

  async function retryBulkRow(row) {
    if (!row?.tokenId || retryingTokenIds.has(row.tokenId)) return false

    if (!isRetryingAllFailed) {
      setRetryProgress({ total: 1, completed: 0, active: true })
    }
    setRetryingTokenIds(current => new Set(current).add(row.tokenId))
    setBulkFailureMessage('')
    log('info', `Retrying token ${formatTokenId(row.tokenId)}`)

    try {
      const parsedTokenId = validateTokenId(row.tokenId)
      const [raw, detailResult] = await Promise.all([
        readInfusion(parsedTokenId, event => {
          if (event.phase === 'start') log('info', `Retry ${formatTokenId(row.tokenId)}: querying ${event.label}`)
          if (event.phase === 'success') log('ok', `Retry ${formatTokenId(row.tokenId)}: RPC response from ${event.label}`)
          if (event.phase === 'error') log('warn', `Retry ${formatTokenId(row.tokenId)}: ${event.label}: ${event.error}`)
        }),
        fetchTokenDetails(row.metadata?.owner, row.tokenId)
          .then(details => ({ details }))
          .catch(error => ({ detailsError: error.message })),
      ])
      const metadata = mergeTokenMetadata(row.metadata || {}, detailResult.details)

      setRows(current => {
        const nextRows = current.map(item => item.tokenId === row.tokenId
          ? {
            ...item,
            amount: formatEnj(raw),
            raw: raw.toString(),
            error: false,
            metadata,
            metadataError: detailResult.detailsError || metadata.metadataError || null,
            errorMessage: null,
          }
          : item)
        const nextRawTotal = sumSuccessfulRaw(nextRows)
        setBulkTotal(formatEnj(nextRawTotal))
        setRawValue(`Total raw infusion: ${nextRawTotal.toString()}`)
        return nextRows
      })
      log('ok', `Retry ${formatTokenId(row.tokenId)} succeeded: ${formatEnj(raw)}`)
      return true
    } catch (error) {
      setRows(current => current.map(item => item.tokenId === row.tokenId
        ? { ...item, raw: 'See terminal log', error: true, errorMessage: error.message }
        : item))
      setBulkFailureMessage('Retry failed. See terminal log for provider details.')
      log('err', `Retry ${formatTokenId(row.tokenId)} failed: ${error.message}`)
      return false
    } finally {
      if (!isRetryingAllFailed) {
        setRetryProgress(current => ({ ...current, completed: current.total, active: false }))
      }
      setRetryingTokenIds(current => {
        const next = new Set(current)
        next.delete(row.tokenId)
        return next
      })
    }
  }

  async function retryAllFailedBulkRows(tokenIds = null) {
    if (isRetryingAllFailed) return

    const retrySet = tokenIds ? new Set(tokenIds) : null
    const failedRows = rowsRef.current.filter(row => {
      if (!row.error || retryingTokenIds.has(row.tokenId)) return false
      return retrySet ? retrySet.has(row.tokenId) : true
    })
    if (!failedRows.length) return

    setIsRetryingAllFailed(true)
    setRetryProgress({ total: failedRows.length, completed: 0, active: true })
    setBulkFailureMessage('')
    setBulkStatus(`Retrying ${failedRows.length} failed token read${failedRows.length === 1 ? '' : 's'}.`)
    log('info', `Retrying ${failedRows.length} failed token read${failedRows.length === 1 ? '' : 's'}.`)

    try {
      let succeeded = 0
      let failed = 0

      for (const row of failedRows) {
        const ok = await retryBulkRow(row)
        if (ok) succeeded += 1
        else failed += 1
        setRetryProgress(current => ({
          ...current,
          completed: Math.min(current.total, current.completed + 1),
        }))
      }

      setRows(current => {
        const remainingFailed = current.filter(row => row.error).length
        const nextRawTotal = sumSuccessfulRaw(current)
        setAmount(formatEnj(nextRawTotal))
        setBulkTotal(formatEnj(nextRawTotal))
        setRawValue(`Total raw infusion: ${nextRawTotal.toString()}`)
        setBulkStatus(
          remainingFailed === 0
            ? `Retry complete. All ${current.length} token IDs are readable.`
            : `Retry complete. ${remainingFailed} failed token read${remainingFailed === 1 ? '' : 's'} remain.`,
        )
        setBulkFailureMessage(
          remainingFailed === 0
            ? ''
            : `${remainingFailed} token read${remainingFailed === 1 ? '' : 's'} still failed. See terminal log for provider details.`,
        )
        return current
      })
      log(failed === 0 ? 'ok' : 'warn', `Retry all finished: ${succeeded} succeeded, ${failed} failed.`)
      return { succeeded, failed }
    } finally {
      setRetryProgress(current => ({ ...current, active: false }))
      setIsRetryingAllFailed(false)
    }
  }

  async function handleBulkCheck(event) {
    event.preventDefault()
    const controller = createScanController()

    try {
      const address = validateAddress(normalizeAddress(walletAddress))
      setIsLoading(true)
      setAmount('-')
      setRawValue('Waiting for Etherscan response.')
      setBulkTotal('-')
      setRows([])
      setBulkStarted(true)
      setBulkExpectedTotal(0)
      setMetadataProgress({ total: 0, completed: 0 })
      setRetryProgress({ total: 0, completed: 0, active: false })
      setBulkPage(1)
      setBulkSearch('')
      setBulkSort({ key: '', direction: 'asc' })
      setBulkFailureMessage('')
      setSelectedTokenDetails(null)
      log('info', `Bulk check: wallet=${address}`)
      log('info', `Filtered contract: ${CONTRACT_ADDRESS}`)

      const openSeaQuery = new URL(ETHERSCAN_NFT_HOLDINGS_URL, window.location.origin)
      openSeaQuery.searchParams.set('address', address)
      log('info', `OpenSea query: ${openSeaQuery.pathname}?${openSeaQuery.searchParams.toString()}`)

      const tokens = await fetchWalletTokens(address, status => {
        setBulkStatus(status)
        log('info', status)
      }, controller.signal)

      if (!tokens.length) {
        setRawValue('No matching token IDs found.')
        setBulkStatus('No matching token IDs found.')
        log('warn', 'No matching token IDs found.')
        return
      }

      setBulkExpectedTotal(tokens.length)
      setMetadataProgress({ total: tokens.length, completed: 0 })
      setRawValue(`Found ${tokens.length} token IDs. Reading infusion values.`)
      log('ok', `Found ${tokens.length} token IDs. Reading infusion values (concurrency=${BULK_RPC_CONCURRENCY}).`)

      const { total, failed, failedTokenIds } = await readBulkInfusions(tokens, controller.signal)

      setAmount(formatEnj(total))
      setRawValue(`Total raw infusion: ${total.toString()}`)
      setBulkStatus(`Read infusion values for ${tokens.length} token IDs. Fetching token metadata.`)
      log('info', `Read infusion values for ${tokens.length} token IDs. Fetching token metadata.`)

      await fetchBulkMetadata(tokens, controller.signal)

      setBulkStatus(
        failed === 0
          ? `Finished ${tokens.length} token IDs.`
          : `Finished ${tokens.length} token IDs with ${failed} failed reads.`,
      )

      if (failed > 0) {
        setBulkStatus(`Retrying ${failed} failed token read${failed === 1 ? '' : 's'} automatically.`)
        log('warn', `Retrying ${failed} failed token read${failed === 1 ? '' : 's'} automatically.`)
        await retryAllFailedBulkRows(failedTokenIds)
      }

      if (failed > 0) {
        setBulkFailureMessage(
          failed === tokens.length
            ? 'Infusion reads failed for every token. See terminal log for provider details.'
            : `${failed} token read${failed === 1 ? '' : 's'} failed. See terminal log for provider details.`,
        )
      }
      const doneMsg = failed === 0
        ? `Done — total ${formatEnj(total)} across ${tokens.length} tokens.`
        : `Done — total ${formatEnj(total)} across ${tokens.length} tokens (${failed} failed).`
      log(failed === 0 ? 'done' : 'warn', doneMsg)
    } catch (error) {
      if (isAbortError(error)) {
        setAmount('-')
        setRawValue('Scan canceled by user.')
        setBulkStatus('Scan canceled by user.')
        log('warn', 'Bulk check canceled by user.')
        return
      }
      setAmount('-')
      setRawValue(error.message)
      setBulkTotal('-')
      setRows([])
      setBulkExpectedTotal(0)
      setBulkStatus(error.message)
      setBulkFailureMessage('Bulk scan failed. See terminal log for details.')
      log('err', `Bulk check failed: ${error.message}`)
    } finally {
      clearScanController(controller)
      setIsLoading(false)
    }
  }

  useEffect(() => {
    return () => {
      scanAbortRef.current?.abort()
      scanAbortRef.current = null
    }
  }, [])

  return (
    <div className="space-y-4 overflow-x-hidden sm:space-y-5">
      <section className="page-hero">
        <div className="relative z-10 flex flex-col gap-2">
          <div className="hero-kicker self-start">
            <span className="hero-dot" />
            Ethereum Mainnet
          </div>
          <h1 className="hero-title">ERC-20 ENJ infusion lookup</h1>
          <p className="hero-copy">
            Check an ERC-1155 token ID or total the infused ERC-20 ENJ held by a wallet.
          </p>
        </div>
      </section>

      <ToolInfoSection tone="warning">
        <p>ERC-20 ENJ is different from native ENJ on the Enjin Blockchain.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <div>
            <p className="metric-label">Contract</p>
            <p className="mt-1 break-all font-mono text-[11px] leading-snug text-text">{CONTRACT_ADDRESS}</p>
          </div>
          <div>
            <p className="metric-label">RPC</p>
            <p className="mt-1 font-semibold text-text">Alchemy/Etherscan</p>
          </div>
          <div>
            <p className="metric-label">Scope</p>
            <p className="mt-1 font-semibold text-text">ERC-1155, Ethereum Mainnet</p>
          </div>
        </div>
        <p className="mt-3"><span className="font-semibold text-text">Wallet scan.</span> Wallet token lists can be incomplete. If a token is missing, use Token ID scan with its Etherscan NFT URL or paste the token ID found after:</p>
        <code className="mt-1 block break-all rounded-sm border border-[var(--hairline)] bg-term/80 px-2 py-1 font-mono text-[11px] text-text">https://etherscan.io/nft/0xfaafdc07907ff5120a76b34b731b278c38d6043c/</code>
      </ToolInfoSection>

      <section className="grid gap-4 xl:grid-cols-3 xl:items-stretch">
        <div className="space-y-4 xl:col-span-2">
          <div className="data-panel space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="section-title">Scan</h2>
              </div>
              <div className="inline-grid grid-cols-2 rounded-sm border border-[var(--hairline)] bg-card p-0.5" role="tablist" aria-label="Infusion check mode">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'single'}
                  onClick={() => setMode('single')}
                  disabled={isLoading}
                  className={`tool-tab ${mode === 'single' ? 'tool-tab-active' : 'text-text-secondary hover:text-text'}`}
                >
                  <Search size={14} />
                  Token ID
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'wallet'}
                  onClick={() => setMode('wallet')}
                  disabled={isLoading}
                  className={`tool-tab ${mode === 'wallet' ? 'tool-tab-active' : 'text-text-secondary hover:text-text'}`}
                >
                  <Wallet size={14} />
                  Wallet
                </button>
              </div>
            </div>

            {mode === 'single' ? (
              <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleSingleCheck}>
                <input
                  id="infusion-token-id"
                  className="input-field min-w-0 flex-1 font-mono"
                  value={tokenId}
                  onChange={event => setTokenId(event.target.value)}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck="false"
                  placeholder="Enter token ID or Etherscan NFT URL"
                  required
                />
                <button
                  type={isLoading ? 'button' : 'submit'}
                  onClick={isLoading ? handleStopScan : undefined}
                  className={`${isLoading ? 'btn-stop' : 'btn-primary'} whitespace-nowrap`}
                >
                  {isLoading ? <Square size={14} /> : <Search size={16} />}
                  {isLoading ? 'Stop' : 'Check'}
                </button>
              </form>
            ) : (
              <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleBulkCheck}>
                <input
                  id="infusion-wallet-address"
                  className="input-field min-w-0 flex-1 font-mono"
                  value={walletAddress}
                  onChange={event => setWalletAddress(event.target.value)}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck="false"
                  placeholder="Enter Ethereum wallet address"
                  required
                />
                <button
                  type={isLoading ? 'button' : 'submit'}
                  onClick={isLoading ? handleStopScan : undefined}
                  className={`${isLoading ? 'btn-stop' : 'btn-primary'} whitespace-nowrap`}
                >
                  {isLoading ? <Square size={14} /> : <Wallet size={16} />}
                  {isLoading ? 'Stop' : 'Bulk Check'}
                </button>
              </form>
            )}
          </div>

          <div ref={singleResultRef} className="data-panel space-y-4" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="section-title">Infusion value</h2>
              </div>
            </div>

            <div className="metric-card metric-card-left-primary">
              <p className="metric-label">{resultLabel}</p>
              <p className="metric-value text-primary">{resultAmount}</p>
            </div>

            <div className="inset-panel">
              <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-text-secondary">
                <Database size={14} />
                Raw value
              </p>
              <p className="break-words font-mono text-xs leading-6 text-text">{rawValue}</p>
            </div>
          </div>
        </div>

        <PhaseProgressCards
          className="h-full"
          ariaLabel="Infusion scan progress"
          indexLabel="Phase"
          title={progressTitle}
          summary={progressSummary}
          phases={progressPhases}
        />
      </section>

      {mode === 'wallet' && bulkStarted && (
      <section ref={bulkResultRef} className="data-panel space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-label">Bulk Results</p>
            <h2 className="section-title">Wallet token infusions</h2>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <p className="max-w-xl text-sm leading-6 text-text-secondary">{bulkStatus}</p>
            {(hasRetryingRows || isRetryingAllFailed || retryProgress.active) && (
              <div className="inline-flex items-center gap-2 rounded-sm border border-warning/25 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning animate-pulse">
                <Loader2 className="animate-spin" size={14} />
                Retrying in progress
              </div>
            )}
          </div>
        </div>

        <div className="data-toolbar">
          <label className="w-full min-w-0 sm:min-w-[14rem] sm:flex-1 sm:max-w-sm">
            <span className="input-label mb-1">Search token name or ID</span>
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                className="input-field w-full pl-9"
                value={bulkSearch}
                onChange={event => {
                  setBulkSearch(event.target.value)
                  setBulkPage(1)
                }}
                type="search"
                autoComplete="off"
                spellCheck="false"
                placeholder="Filter wallet results"
              />
            </div>
          </label>

          <label className="flex items-center gap-2 text-xs text-text-secondary">
            Rows per page
            <select
              className="select-compact"
              value={bulkPageSize}
              onChange={event => {
                setBulkPageSize(Number(event.target.value))
                setBulkPage(1)
              }}
            >
              {BULK_PAGE_SIZE_OPTIONS.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>

        {bulkFailureMessage && (
          <div className="flex flex-col gap-3 rounded-sm border border-warning/20 bg-warning/5 px-4 py-3 text-sm font-semibold leading-6 text-warning sm:flex-row sm:items-center sm:justify-between">
            <span>{bulkFailureMessage}</span>
            {failedBulkRows.length > 0 && (
              <button
                type="button"
                onClick={retryAllFailedBulkRows}
                className="btn-secondary shrink-0 px-3 py-2 text-xs"
                disabled={isLoading || hasRetryingRows || isRetryingAllFailed}
              >
                {hasRetryingRows || isRetryingAllFailed ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                Retry All Failed
              </button>
            )}
          </div>
        )}

        <div className="data-table-wrap">
          <table className="data-table min-w-[760px]">
            <thead className="data-table-head">
              <tr>
                {renderSortableHeader('tokenId')}
                {renderSortableHeader('previewImage')}
                {renderSortableHeader('tokenName')}
                {renderSortableHeader('amount')}
                {renderSortableHeader('raw')}
                <th className="px-3 py-3 text-center">More Details</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr className="border-t border-white/5">
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-text-secondary">
                    {rows.length > 0 && bulkSearch.trim()
                      ? 'No completed token reads match your search.'
                      : isLoading ? 'Completed token reads will appear here.' : 'No wallet scan has been run.'}
                  </td>
                </tr>
              )}
              {visibleRows.map((row, index) => (
                <tr
                  key={`${row.tokenId}-${row.raw}-${index}`}
                  className={`bulk-result-row ${row.error ? 'data-table-row-danger' : index % 2 ? 'data-table-row-alt' : 'data-table-row'} border-t border-white/5`}
                >
                  <td className="max-w-[26rem] break-all px-3 py-3 text-center font-mono text-xs text-text">
                    {/^\d+$/.test(row.tokenId) ? (
                      <a
                        href={getEtherscanTokenUrl(row.tokenId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-1.5 text-cyan transition-colors hover:text-primary"
                      >
                        <span title={row.tokenId}>{formatTokenId(row.tokenId)}</span>
                        <ExternalLink size={12} className="shrink-0" />
                      </a>
                    ) : (
                      row.tokenId
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {row.metadata?.previewImage ? (
                      <img
                        src={row.metadata.previewImage}
                        alt={row.metadata.name ? `${row.metadata.name} preview` : 'Token preview'}
                        className="mx-auto h-12 w-12 rounded-lg object-cover ring-1 ring-white/10"
                        loading="lazy"
                      />
                    ) : (
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-surface text-text-secondary ring-1 ring-white/10">
                        <ImageIcon size={16} />
                      </div>
                    )}
                  </td>
                  <td className="max-w-[16rem] px-3 py-3 text-sm text-text">
                    <div className="truncate" title={row.metadata?.name || row.metadataError || 'Metadata unavailable'}>
                      {row.metadata?.name || (row.metadataError ? 'Metadata unavailable' : '-')}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center font-semibold text-text">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <span>{row.amount}</span>
                      {row.error && (
                        <button
                          type="button"
                          onClick={() => retryBulkRow(row)}
                          className="btn-secondary px-3 py-1.5 text-[11px]"
                          disabled={retryingTokenIds.has(row.tokenId) || isRetryingAllFailed}
                        >
                          {retryingTokenIds.has(row.tokenId) && <Loader2 className="animate-spin" size={13} />}
                          Retry
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="max-w-[34rem] break-all px-3 py-3 text-center font-mono text-xs text-text-secondary">{row.raw}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedTokenDetails(row)}
                        className="btn-icon"
                        aria-label={`View details for token ${row.tokenId}`}
                      >
                        <Search size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm bg-card px-4 py-3 text-xs text-text-secondary">
          <span>
            {filteredSortedRows.length.toLocaleString('en')} of {rows.length.toLocaleString('en')} token{rows.length !== 1 ? 's' : ''} shown
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setBulkPage(1)}
              disabled={safeBulkPage === 1}
              className="btn-ghost disabled:opacity-30"
              aria-label="First page"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => setBulkPage(Math.max(1, safeBulkPage - 1))}
              disabled={safeBulkPage === 1}
              className="btn-ghost disabled:opacity-30"
              aria-label="Previous page"
            >
              ‹ Prev
            </button>
            <span className="px-2">{safeBulkPage} / {totalBulkPages}</span>
            <button
              type="button"
              onClick={() => setBulkPage(Math.min(totalBulkPages, safeBulkPage + 1))}
              disabled={safeBulkPage === totalBulkPages}
              className="btn-ghost disabled:opacity-30"
              aria-label="Next page"
            >
              Next ›
            </button>
            <button
              type="button"
              onClick={() => setBulkPage(totalBulkPages)}
              disabled={safeBulkPage === totalBulkPages}
              className="btn-ghost disabled:opacity-30"
              aria-label="Last page"
            >
              »
            </button>
          </div>
        </div>
      </section>
      )}

      <TokenDetailsModal
        row={selectedTokenDetails}
        onClose={() => setSelectedTokenDetails(null)}
      />

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

function TokenDetailsModal({ row, onClose }) {
  const metadata = row?.metadata

  return (
    <DetailModal
      open={Boolean(row)}
      title={metadata?.name || `Token ${row ? formatTokenId(row.tokenId) : ''}`}
      subtitle={row?.tokenId ? `Token ID ${formatTokenId(row.tokenId)}` : ''}
      onClose={onClose}
      widthClass="max-w-5xl"
      eyebrow={null}
      actions={row?.tokenId ? (
        <a
          href={getEtherscanTokenUrl(row.tokenId)}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary px-3 py-2 text-xs"
        >
          <ExternalLink size={14} />
          Etherscan
        </a>
      ) : null}
    >
      {!row ? null : (
        <div className="space-y-5">
          {row.metadataError && (
            <div className="rounded-sm border border-warning/20 bg-warning/5 px-4 py-3 text-sm leading-6 text-warning">
              Extended token-page metadata is unavailable. Basic details are shown from the wallet holdings response.
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="rounded-sm bg-card p-3 border border-[var(--hairline)]">
              {metadata?.previewImage ? (
                <img
                  src={metadata.previewImage}
                  alt={metadata.name ? `${metadata.name} preview` : 'Token preview'}
                  className="aspect-square w-full rounded-sm object-cover"
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-sm bg-surface text-text-secondary">
                  <ImageIcon size={28} />
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <DetailField label="Owner" value={metadata?.owner} />
              <DetailField label="Contract Address" value={metadata?.contractAddress || CONTRACT_ADDRESS} />
              <DetailField label="Creator" value={metadata?.creator} />
              <DetailField label="Token ID" value={metadata?.tokenId || row.tokenId} />
              <DetailField label="Token Standard" value={metadata?.tokenStandard} />
              <DetailField label="Quantity" value={metadata?.quantity} />
              <DetailField label="Metadata URI" value={metadata?.tokenUri} />
              <DetailField label="Image URL" value={metadata?.imageUrl || metadata?.previewImage} />
            </div>
          </div>

          <div className="data-panel bg-card/70">
            <p className="section-label">Properties</p>
            {metadata?.properties?.length ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {metadata.properties.map((property, index) => (
                  <div key={`${property.trait}-${index}`} className="rounded-sm bg-surface px-4 py-3 border border-[var(--hairline)]">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan">{property.trait || 'Property'}</p>
                    <p className="mt-2 break-words text-sm font-semibold text-text">{property.value || '-'}</p>
                    {property.rarity && <p className="mt-2 text-xs text-text-secondary">{property.rarity}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-text-secondary">
                Not available
              </p>
            )}
          </div>

          <div className="data-panel bg-card/70">
            <p className="section-label">Description</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-secondary">
              {metadata?.description || 'Not available'}
            </p>
          </div>
        </div>
      )}
    </DetailModal>
  )
}

function DetailField({ label, value }) {
  return (
    <div className="rounded-sm bg-card px-4 py-3 border border-[var(--hairline)]">
      <p className="metric-label">{label}</p>
      <p className="mt-2 break-words font-mono text-xs leading-5 text-text">{value || '-'}</p>
    </div>
  )
}
