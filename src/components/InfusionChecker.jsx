import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, Database, ExternalLink, ImageIcon, Loader2, Search, Wallet } from 'lucide-react'
import DetailModal from './DetailModal.jsx'
import TerminalLog from './TerminalLog.jsx'

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
const BULK_RPC_CONCURRENCY = 4
const BULK_PAGE_SIZE_OPTIONS = [10, 25, 50]

const RPC_ENDPOINTS = [
  ['Alchemy', ALCHEMY_ETH_CALL_URL],
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

async function callRpc([name, url], data) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12000)

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

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const body = await response.json()
    if (body.error) throw new Error(body.error.message || 'RPC returned an error.')

    return { name, result: body.result }
  } finally {
    window.clearTimeout(timeout)
  }
}

async function readInfusion(tokenId, onEndpoint) {
  const data = buildTypeDataCall(tokenId)
  const errors = []

  for (const endpoint of RPC_ENDPOINTS) {
    onEndpoint?.(`Trying ${endpoint[0]}`)

    try {
      const response = await callRpc(endpoint, data)
      onEndpoint?.(response.name)
      return parseUint256Words(response.result)[3]
    } catch (error) {
      errors.push(`${endpoint[0]}: ${error.message}`)
    }
  }

  throw new Error(`All RPC endpoints failed. ${errors.join(' | ')}`)
}

async function fetchWalletTokens(address, onStatus) {
  onStatus('Fetching wallet ERC-1155 transfer history.')
  const url = new URL(ETHERSCAN_NFT_HOLDINGS_URL, window.location.origin)
  url.searchParams.set('address', address)

  const response = await fetch(url)
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
    description: detail.description || base.description,
    properties: detail.properties?.length ? detail.properties : base.properties,
    tokenUri: detail.tokenUri || base.tokenUri,
    metadataError: detail.metadataError || base.metadataError,
    source: detail.tokenUri ? 'etherscan-api-eth-call' : base.source,
  }
}

async function fetchTokenDetails(owner, tokenId) {
  const url = new URL(ENJ_TOKEN_DETAILS_URL, window.location.origin)
  url.searchParams.set('owner', owner)
  url.searchParams.set('tokenId', tokenId)

  const response = await fetch(url)
  const body = await response.json().catch(() => ({}))

  if (!response.ok) throw new Error(body.error || `Token details returned HTTP ${response.status}.`)
  return body
}

export default function InfusionChecker() {
  const [mode, setMode] = useState('single')
  const [tokenId, setTokenId] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [rpcLabel, setRpcLabel] = useState('Automatic fallback')
  const [amount, setAmount] = useState('-')
  const [rawValue, setRawValue] = useState('Raw infusion value will appear here.')
  const [bulkStatus, setBulkStatus] = useState('Wallet results will appear here.')
  const [bulkTotal, setBulkTotal] = useState('-')
  const [rows, setRows] = useState([])
  const [bulkPage, setBulkPage] = useState(1)
  const [bulkPageSize, setBulkPageSize] = useState(10)
  const [selectedTokenDetails, setSelectedTokenDetails] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [logs, setLogs] = useState([])

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
  const totalBulkPages = Math.max(1, Math.ceil(rows.length / bulkPageSize))
  const safeBulkPage = Math.min(bulkPage, totalBulkPages)
  const visibleRows = useMemo(() => {
    const start = (safeBulkPage - 1) * bulkPageSize
    return rows.slice(start, start + bulkPageSize)
  }, [bulkPageSize, rows, safeBulkPage])

  function appendRow(row) {
    setRows(current => [...current, row])
  }

  async function handleSingleCheck(event) {
    event.preventDefault()

    try {
      const parsedTokenId = validateTokenId(normalizeTokenId(tokenId))
      setIsLoading(true)
      setAmount('-')
      setRawValue('Waiting for contract response.')
      log('info', `Single check: tokenId=${parsedTokenId.toString()}`)
      log('info', `Contract: ${CONTRACT_ADDRESS} method: typeData(uint256)`)

      const raw = await readInfusion(parsedTokenId, label => {
        setRpcLabel(label)
        log('info', `RPC: ${label}`)
      })

      setAmount(formatEnj(raw))
      setRawValue(`Raw fourth value: ${raw.toString()}`)
      log('ok', `Infusion: ${formatEnj(raw)} (raw=${raw.toString()})`)
    } catch (error) {
      setAmount('-')
      setRawValue(error.message)
      setRpcLabel('Automatic fallback')
      log('err', `Single check failed: ${error.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  async function readBulkInfusions(tokens) {
    let cursor = 0
    let completed = 0
    let failed = 0
    let total = 0n

    const worker = async () => {
      while (cursor < tokens.length) {
        const index = cursor
        cursor += 1
        const token = tokens[index]

        try {
          const parsedTokenId = validateTokenId(token.tokenId)
          const [raw, detailResult] = await Promise.all([
            readInfusion(parsedTokenId, label => {
              setRpcLabel(label)
            }),
            fetchTokenDetails(token.metadata.owner, token.tokenId)
              .then(details => ({ details }))
              .catch(error => ({ detailsError: error.message })),
          ])
          const metadata = mergeTokenMetadata(token.metadata, detailResult.details)

          total += raw
          appendRow({
            tokenId: token.tokenId,
            amount: formatEnj(raw),
            raw: raw.toString(),
            error: false,
            metadata,
            metadataError: detailResult.detailsError || metadata.metadataError || null,
          })
          setBulkTotal(formatEnj(total))
          log('info', `Token ${formatTokenId(token.tokenId)}: ${formatEnj(raw)}`)
          if (detailResult.detailsError) {
            log('warn', `Token ${formatTokenId(token.tokenId)}: metadata unavailable — ${detailResult.detailsError}`)
          }
        } catch (error) {
          failed += 1
          appendRow({
            tokenId: token.tokenId,
            amount: 'Failed',
            raw: error.message,
            error: true,
            metadata: token.metadata,
            metadataError: null,
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

    return { total, failed }
  }

  async function handleBulkCheck(event) {
    event.preventDefault()

    try {
      const address = validateAddress(normalizeAddress(walletAddress))
      setIsLoading(true)
      setAmount('-')
      setRawValue('Waiting for Etherscan response.')
      setBulkTotal('-')
      setRows([])
      setBulkPage(1)
      setSelectedTokenDetails(null)
      log('info', `Bulk check: wallet=${address}`)
      log('info', `Filtered contract: ${CONTRACT_ADDRESS}`)

      const tokens = await fetchWalletTokens(address, status => {
        setBulkStatus(status)
        log('info', status)
      })

      if (!tokens.length) {
        setRawValue('No matching token IDs found.')
        setBulkStatus('No matching token IDs found.')
        log('warn', 'No matching token IDs found.')
        return
      }

      setRawValue(`Found ${tokens.length} token IDs. Reading infusion values.`)
      log('ok', `Found ${tokens.length} token IDs. Reading infusion values (concurrency=${BULK_RPC_CONCURRENCY}).`)

      const { total, failed } = await readBulkInfusions(tokens)

      setAmount(formatEnj(total))
      setRawValue(`Total raw infusion: ${total.toString()}`)
      setBulkStatus(
        failed === 0
          ? `Finished ${tokens.length} token IDs.`
          : `Finished ${tokens.length} token IDs with ${failed} failed reads.`,
      )
      const doneMsg = failed === 0
        ? `Done — total ${formatEnj(total)} across ${tokens.length} tokens.`
        : `Done — total ${formatEnj(total)} across ${tokens.length} tokens (${failed} failed).`
      log(failed === 0 ? 'done' : 'warn', doneMsg)
    } catch (error) {
      setAmount('-')
      setRawValue(error.message)
      setRpcLabel('Automatic fallback')
      setBulkTotal('-')
      setRows([])
      setBulkStatus(error.message)
      log('err', `Bulk check failed: ${error.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="page-hero">
        <div className="relative z-10">
          <div className="space-y-4">
            <div className="hero-kicker">
              <span className="hero-dot" />
              Ethereum Mainnet
            </div>
            <div className="max-w-3xl space-y-3">
              <h1 className="hero-title text-balance">ERC-20 ENJ infusion lookup for CryptoItems.</h1>
              <p className="hero-copy">
                Check one ERC-1155 token ID, or scan an Ethereum wallet for Enjin CryptoItems and total their infused ERC-20 ENJ.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="data-panel">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div>
            <p className="section-label">Info</p>
            <h2 className="section-title">What this checker reads</h2>
            <p className="section-subtitle mt-2">
              Use this for Ethereum ERC-1155 CryptoItems from the Enjin contract. The checker reads the ERC-20 ENJ infusion value from Ethereum Mainnet.
            </p>
          </div>

          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div className="border-l border-white/10 pl-4">
              <p className="metric-label">Contract</p>
              <p className="mt-2 break-all font-mono text-xs leading-5 text-text">{CONTRACT_ADDRESS}</p>
            </div>
            <div className="border-l border-white/10 pl-4">
              <p className="metric-label">Read Method</p>
              <p className="mt-2 font-mono text-xs leading-5 text-text">typeData(tokenId)</p>
            </div>
            <div className="border-l border-white/10 pl-4">
              <p className="metric-label">RPC</p>
              <p className="mt-2 text-sm font-semibold text-text">{rpcLabel}</p>
            </div>
            <div className="border-l border-white/10 pl-4">
              <p className="metric-label">Scope</p>
              <p className="mt-2 text-sm font-semibold text-text">ERC-1155 assets, Ethereum Mainnet, ERC-20 ENJ infusion</p>
            </div>
            <div className="border-l border-white/10 pl-4 md:col-span-2">
              <p className="metric-label">ENJ Note</p>
              <p className="mt-2 text-sm leading-6 text-text-secondary">
                ERC-20 ENJ is different from native ENJ on the Enjin Blockchain.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="data-panel space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="section-label">Checker</p>
              <h2 className="section-title">Scan</h2>
            </div>
            <div className="inline-grid grid-cols-2 rounded-full bg-card p-1" role="tablist" aria-label="Infusion check mode">
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
            <form className="space-y-3" onSubmit={handleSingleCheck}>
              <label className="input-label" htmlFor="infusion-token-id">Token ID</label>
              <div className="flex flex-col gap-3 sm:flex-row">
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
                <button type="submit" className="btn-primary whitespace-nowrap" disabled={isLoading}>
                  {isLoading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
                  Check
                </button>
              </div>
              <p className="text-xs leading-5 text-text-secondary">
                You can paste the token ID directly or paste its Etherscan NFT URL. To locate it manually, open the asset on Etherscan and copy the number after the contract address in the URL.
              </p>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={handleBulkCheck}>
              <label className="input-label" htmlFor="infusion-wallet-address">Ethereum wallet address</label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  id="infusion-wallet-address"
                  className="input-field min-w-0 flex-1 font-mono"
                  value={walletAddress}
                  onChange={event => setWalletAddress(event.target.value)}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck="false"
                  placeholder="Enter 0x Ethereum wallet address"
                  required
                />
                <button type="submit" className="btn-primary whitespace-nowrap" disabled={isLoading}>
                  {isLoading ? <Loader2 className="animate-spin" size={16} /> : <Wallet size={16} />}
                  Bulk Check
                </button>
              </div>
            </form>
          )}

          <div className="rounded-[1rem] border border-cyan/15 bg-cyan/5 px-4 py-3 text-sm leading-6 text-text-secondary">
            <div className="mb-2 flex items-center gap-2 font-semibold text-cyan">
              <AlertTriangle size={16} />
              Scope disclaimer
            </div>
            This feature applies to ERC-1155 assets on the Ethereum network and checks their ERC-20 ENJ infusion. ERC-20 ENJ is different from native ENJ on the Enjin Blockchain.
          </div>
        </div>

        <div className="data-panel space-y-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="section-label">Result</p>
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
      </section>

      {mode === 'wallet' && (
      <section className="data-panel space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-label">Bulk Results</p>
            <h2 className="section-title">Wallet token infusions</h2>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <p className="max-w-xl text-sm leading-6 text-text-secondary">{bulkStatus}</p>
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
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead className="data-table-head">
              <tr>
                <th className="px-3 py-3 text-left">Token ID</th>
                <th className="px-3 py-3 text-left">Token Preview Image</th>
                <th className="px-3 py-3 text-left">Token Name</th>
                <th className="px-3 py-3 text-left">ENJ Infusion</th>
                <th className="px-3 py-3 text-left">Raw ENJ Infusion</th>
                <th className="px-3 py-3 text-left">More Details</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr className="border-t border-white/5">
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-text-secondary">
                    {isLoading ? 'Completed token reads will appear here.' : 'No wallet scan has been run.'}
                  </td>
                </tr>
              )}
              {visibleRows.map((row, index) => (
                <tr
                  key={`${row.tokenId}-${row.raw}-${index}`}
                  className={`bulk-result-row ${row.error ? 'data-table-row-danger' : index % 2 ? 'data-table-row-alt' : 'data-table-row'} border-t border-white/5`}
                >
                  <td className="max-w-[26rem] break-all px-3 py-3 font-mono text-xs text-text">
                    {/^\d+$/.test(row.tokenId) ? (
                      <a
                        href={getEtherscanTokenUrl(row.tokenId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-cyan transition-colors hover:text-primary"
                      >
                        <span title={row.tokenId}>{formatTokenId(row.tokenId)}</span>
                        <ExternalLink size={12} className="shrink-0" />
                      </a>
                    ) : (
                      row.tokenId
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {row.metadata?.previewImage ? (
                      <img
                        src={row.metadata.previewImage}
                        alt={row.metadata.name ? `${row.metadata.name} preview` : 'Token preview'}
                        className="h-12 w-12 rounded-lg object-cover ring-1 ring-white/10"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface text-text-secondary ring-1 ring-white/10">
                        <ImageIcon size={16} />
                      </div>
                    )}
                  </td>
                  <td className="max-w-[16rem] px-3 py-3 text-sm text-text">
                    <div className="truncate" title={row.metadata?.name || row.metadataError || 'Metadata unavailable'}>
                      {row.metadata?.name || (row.metadataError ? 'Metadata unavailable' : '-')}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-semibold text-text">{row.amount}</td>
                  <td className="max-w-[34rem] break-all px-3 py-3 font-mono text-xs text-text-secondary">{row.raw}</td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setSelectedTokenDetails(row)}
                      className="btn-icon"
                      aria-label={`View details for token ${row.tokenId}`}
                    >
                      <Search size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.15rem] bg-card px-4 py-3 text-xs text-text-secondary">
          <span>
            {rows.length.toLocaleString('en')} token{rows.length !== 1 ? 's' : ''} checked
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
            <div className="rounded-[1rem] border border-warning/20 bg-warning/5 px-4 py-3 text-sm leading-6 text-warning">
              Extended token-page metadata is unavailable. Basic details are shown from the wallet holdings response.
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="rounded-[1.15rem] bg-card p-3 ring-1 ring-white/8">
              {metadata?.previewImage ? (
                <img
                  src={metadata.previewImage}
                  alt={metadata.name ? `${metadata.name} preview` : 'Token preview'}
                  className="aspect-square w-full rounded-xl object-cover"
                />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-surface text-text-secondary">
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
            </div>
          </div>

          <div className="data-panel bg-card/70">
            <p className="section-label">Properties</p>
            {metadata?.properties?.length ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {metadata.properties.map((property, index) => (
                  <div key={`${property.trait}-${index}`} className="rounded-[1rem] bg-surface px-4 py-3 ring-1 ring-white/8">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan">{property.trait || 'Property'}</p>
                    <p className="mt-2 break-words text-sm font-semibold text-text">{property.value || '-'}</p>
                    {property.rarity && <p className="mt-2 text-xs text-text-secondary">{property.rarity}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-text-secondary">
                Properties are not available from the wallet holdings response.
              </p>
            )}
          </div>

          <div className="data-panel bg-card/70">
            <p className="section-label">Description</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-secondary">
              {metadata?.description || 'Description is not available from the wallet holdings response.'}
            </p>
          </div>
        </div>
      )}
    </DetailModal>
  )
}

function DetailField({ label, value }) {
  return (
    <div className="rounded-[1rem] bg-card px-4 py-3 ring-1 ring-white/8">
      <p className="metric-label">{label}</p>
      <p className="mt-2 break-words font-mono text-xs leading-5 text-text">{value || '-'}</p>
    </div>
  )
}
