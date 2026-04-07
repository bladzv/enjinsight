/**
 * useBalanceExplorer — state machine for the Historical Balance Viewer.
 *
 * Manages:
 *  - WebSocket RPC connection lifecycle (opens, queries, closes, cancels)
 *  - Progress tracking per-block
 *  - Activity log messages (info / ok / warn / err)
 *  - Import from JSON / CSV / XML (with optional AES-256-GCM decryption)
 *
 * Performance optimisations vs. the original sequential implementation:
 *  1. SubstrateRPC with concurrency=3: up to 3 RPC calls in-flight simultaneously
 *     instead of one. Block queries are dispatched via Promise.all and the semaphore
 *     manages back-pressure, giving ~3× throughput for large block ranges.
 *  2. Era hash pre-lookup: for relay/canary-relay networks the era reference CSV is
 *     loaded (from localStorage cache when available) and era start-block hashes are
 *     used directly, skipping the chain_getBlockHash RPC call for those blocks.
 *
 * Security:
 *  - Endpoint validated with validateWsEndpoint() before any WS connection open
 *  - Block range inputs clamped with clampInt() before use
 *  - Address validated via buildStorageKey() which calls ss58Decode()
 *  - No user-supplied data is interpolated into evaluated code
 */
import { useReducer, useCallback, useRef } from 'react'
import {
  WS_DEFAULT_ENDPOINT,
  MAX_RPC_CALLS,
} from '../constants.js'
import {
  validateWsEndpoint,
  clampInt,
  buildStorageKey,
  decodeAccountInfo,
  isValidBlockHash,
} from '../utils/substrate.js'
import { parseImport, aesDecrypt } from '../utils/balanceExport.js'
import { SubstrateRPC } from '../utils/rpc.js'
import { loadEraCsvRows, buildEraHashMap } from '../utils/eraCache.js'

// ── Status values ─────────────────────────────────────────────────────────
export const STATUS = {
  IDLE:        'idle',
  CONNECTING:  'connecting',
  QUERYING:    'querying',
  DONE:        'done',
  CANCELLED:   'cancelled',
  ERROR:       'error',
}

// ── Reducer ───────────────────────────────────────────────────────────────
const initialState = {
  status:     STATUS.IDLE,
  records:    [],       // array of decoded AccountInfo records
  logs:       [],       // { level, msg, ts } log entries
  progress:   null,     // { text, phases:[...] } | null
  dataSource: 'none',   // 'query' | 'import' | 'none'
  errorMsg:   null,
}

function buildPhaseProgress({
  totalBlocks = 0,
  queriedBlocks = 0,
  connectStatus = 'pending',
  queryStatus = 'pending',
  finalizeStatus = 'pending',
  text = '',
}) {
  return {
    text,
    phases: [
      {
        key: 'connect',
        label: 'Connect to Archive',
        total: 1,
        completed: connectStatus === 'completed' ? 1 : 0,
        status: connectStatus,
      },
      {
        key: 'query',
        label: 'Query Balance Snapshots',
        total: totalBlocks,
        completed: Math.min(Math.max(queriedBlocks, 0), Math.max(totalBlocks, 0)),
        status: queryStatus,
      },
      {
        key: 'finalize',
        label: 'Assemble Records',
        total: 1,
        completed: finalizeStatus === 'completed' ? 1 : 0,
        status: finalizeStatus,
      },
    ],
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return { ...initialState }

    case 'STATUS':
      return { ...state, status: action.payload }

    case 'PROGRESS':
      return { ...state, progress: action.payload }

    case 'SET_RECORDS':
      return {
        ...state,
        records: action.records,
        dataSource: action.dataSource ?? state.dataSource,
      }

    case 'LOG': {
      // Keep at most 500 log entries to cap memory
      const next = [...state.logs, action.payload]
      return { ...state, logs: next.length > 500 ? next.slice(-500) : next }
    }

    case 'DONE':
      return {
        ...state,
        status:     STATUS.DONE,
        records:    action.records,
        dataSource: action.dataSource,
        progress:   action.progress ?? state.progress,
      }

    case 'ERROR':
      return { ...state, status: STATUS.ERROR, errorMsg: action.payload, progress: null }

    case 'CANCELLED':
      return { ...state, status: STATUS.CANCELLED, progress: action.payload ?? state.progress }

    default:
      return state
  }
}

// ── Network → era-reference CSV mapping ──────────────────────────────────
// Only relay and canary-relay have era reference CSVs with block hashes.
// Pattern matching on the archive WS endpoint is sufficient for known networks.
function detectEraRefCsv(endpoint) {
  if (/archive\.relay\.blockchain\.enjin/i.test(endpoint)) return '/relay-era-reference.csv'
  if (/archive\.relay\.canary\.enjin/i.test(endpoint))    return '/canary-relay-era-reference.csv'
  return null
}

// ── Hook ─────────────────────────────────────────────────────────────────

export default function useBalanceExplorer() {
  const [state, dispatch] = useReducer(reducer, initialState)
  // Hold a ref to the active RPC instance so cancel() can reach it
  const rpcRef = useRef(null)

  const log = useCallback((level, msg) => {
    dispatch({
      type: 'LOG',
      payload: {
        level,
        msg: String(msg),
        ts:  new Date().toLocaleTimeString('en', {
          hour12: false, hour: '2-digit', minute: '2-digit',
          second: '2-digit', fractionalSecondDigits: 2,
        }),
      },
    })
  }, [])

  const reset = useCallback(() => {
    rpcRef.current?.cancel()
    rpcRef.current?.close()
    rpcRef.current = null
    dispatch({ type: 'RESET' })
  }, [])

  const cancel = useCallback(() => {
    rpcRef.current?.cancel()
    rpcRef.current?.close()
    rpcRef.current = null
    dispatch({ type: 'CANCELLED' })
  }, [])

  /**
   * Run a block-range balance query over WebSocket RPC.
   *
   * @param {{ endpoint, address, startBlock, endBlock, step }} params
   */
  const runQuery = useCallback(async ({ endpoint, address, startBlock, endBlock, step }) => {
    dispatch({ type: 'RESET' })

    // ── Input validation ────────────────────────────────────────────────
    let ep
    try { ep = validateWsEndpoint(endpoint) }
    catch (e) { dispatch({ type: 'ERROR', payload: e.message }); return }

    let start, end, stepN
    try {
      start = clampInt(startBlock, 0, 999_999_999)
      end   = clampInt(endBlock,   0, 999_999_999)
      stepN = clampInt(step,       1, 999_999)
    } catch {
      dispatch({ type: 'ERROR', payload: 'Block numbers must be valid positive integers.' })
      return
    }
    if (start > end) {
      dispatch({ type: 'ERROR', payload: 'Start block must be ≤ end block.' })
      return
    }

    const total = Math.ceil((end - start) / stepN) + 1
    if (total > MAX_RPC_CALLS) {
      dispatch({
        type: 'ERROR',
        payload: `Query would require ${total.toLocaleString('en')} RPC calls (max ${MAX_RPC_CALLS.toLocaleString('en')}). Increase step or narrow range.`,
      })
      return
    }

    let storKey
    try { storKey = buildStorageKey(address) }
    catch (e) { dispatch({ type: 'ERROR', payload: `Invalid address: ${e.message}` }); return }

    log('info', `Storage key: ${storKey.slice(0, 18)}…${storKey.slice(-8)} (System.Account + Blake2_128Concat)`)
    log('info', `Archive endpoint: ${ep}`)

    // ── Build block list ────────────────────────────────────────────────
    const blocks = []
    for (let b = start; b <= end; b += stepN) blocks.push(b)
    if (blocks[blocks.length - 1] !== end) blocks.push(end)

    // ── Era hash pre-lookup (relay/canary-relay only) ───────────────────
    // Load the era reference CSV (from localStorage cache when available) and
    // build a Map<blockNumber, blockHash> so that era start-block hash lookups
    // skip the chain_getBlockHash RPC call entirely.
    let eraHashMap = null
    const csvPath = detectEraRefCsv(ep)
    if (csvPath) {
      try {
        const rows = await loadEraCsvRows(csvPath)
        eraHashMap = buildEraHashMap(rows)
        if (eraHashMap.size > 0) {
          log('info', `Era hash map loaded: ${eraHashMap.size} era boundary hashes available for pre-lookup`)
        }
      } catch {
        // Non-fatal — fall back to querying every block hash via RPC
      }
    }

    // ── Query ────────────────────────────────────────────────────────────
    dispatch({ type: 'STATUS', payload: STATUS.CONNECTING })
    dispatch({
      type: 'PROGRESS',
      payload: buildPhaseProgress({
        totalBlocks: blocks.length,
        connectStatus: 'in_progress',
        queryStatus: 'pending',
        finalizeStatus: 'pending',
        text: `Connecting to ${ep}…`,
      }),
    })

    log('info', 'Session started')
    log('info', `Endpoint: ${ep}`)
    log('info', `Range: block ${start.toLocaleString('en')} → ${end.toLocaleString('en')}, step=${stepN}`)
    log('info', `Planned block queries: ${blocks.length.toLocaleString('en')} (concurrency: 3)`)

    // SubstrateRPC with concurrency=3: at most 3 calls in-flight simultaneously.
    // The semaphore manages back-pressure across all parallel block fetches.
    const rpc = new SubstrateRPC(ep, { concurrency: 3 })
    rpcRef.current = rpc
    // Pre-allocate results array so parallel writes by index are safe.
    const results = new Array(blocks.length).fill(null)
    let connected = false
    let queriedBlocks = 0

    try {
      log('info', 'Opening WebSocket connection…')
      await rpc.connect()
      connected = true
      log('ok', 'WebSocket connected')

      dispatch({ type: 'STATUS', payload: STATUS.QUERYING })
      log('info', `Querying ${blocks.length.toLocaleString('en')} blocks in parallel (cap 3)…`)
      dispatch({
        type: 'PROGRESS',
        payload: buildPhaseProgress({
          totalBlocks: blocks.length,
          queriedBlocks: 0,
          connectStatus: 'completed',
          queryStatus: 'in_progress',
          finalizeStatus: 'pending',
          text: `Querying ${blocks.length.toLocaleString('en')} block snapshots…`,
        }),
      })

      // Fan-out: all blocks are started at once; the SubstrateRPC semaphore (cap=3)
      // ensures at most 3 RPC calls are in-flight at any given time.
      // Results are stored by index so the final array is in block order.
      await Promise.all(blocks.map(async (blk, i) => {
        try {
          // Use pre-loaded hash for era boundary blocks; fall back to RPC otherwise.
          const hash = eraHashMap?.get(blk) ?? await rpc.call('chain_getBlockHash', [blk])

          if (!hash || !isValidBlockHash(hash) || /^0x0{64}$/.test(hash)) {
            log('warn', `Block #${blk.toLocaleString('en')}: no valid hash returned — block may not exist in the archive (skipped)`)
            results[i] = {
              block: blk, blockHash: '', free: 0n, reserved: 0n,
              miscFrozen: 0n, feeFrozen: 0n, nonce: 0, newFormat: false,
            }
          } else {
            const raw = await rpc.call('state_getStorage', [storKey, hash])
            if (!raw || raw === '0x') {
              log('warn', `Block #${blk.toLocaleString('en')}: no account storage at this block — account may not exist yet or has zero balance`)
              results[i] = {
                block: blk, blockHash: hash, free: 0n, reserved: 0n,
                miscFrozen: 0n, feeFrozen: 0n, nonce: 0, newFormat: false,
              }
            } else {
              const dec = decodeAccountInfo(raw)
              log('info', `Block #${blk.toLocaleString('en')} → free=${dec.free} res=${dec.reserved}${dec.newFormat ? ' [new-fmt]' : ''}`)
              results[i] = { block: blk, blockHash: hash, ...dec }
            }
          }
        } catch (e) {
          if (e.message === 'Cancelled') throw e   // propagate cancel to Promise.all
          log('warn', `Block #${blk.toLocaleString('en')}: RPC error — ${e.message}`)
          results[i] = {
            block: blk, blockHash: '', free: 0n, reserved: 0n,
            miscFrozen: 0n, feeFrozen: 0n, nonce: 0, newFormat: false,
          }
        }

        queriedBlocks++
        dispatch({
          type: 'SET_RECORDS',
          records: results.filter(Boolean),
          dataSource: 'query',
        })
        dispatch({
          type: 'PROGRESS',
          payload: buildPhaseProgress({
            totalBlocks: blocks.length,
            queriedBlocks,
            connectStatus: 'completed',
            queryStatus: 'in_progress',
            finalizeStatus: 'pending',
            text: `Block ${blk.toLocaleString('en')} (${queriedBlocks} / ${blocks.length})`,
          }),
        })
      }))

      // Sort final results by block number (parallel completion may reorder)
      const sorted = results.filter(Boolean).sort((a, b) => a.block - b.block)

      log('ok', `Fetch complete — ${sorted.length.toLocaleString('en')} records`)
      dispatch({
        type: 'DONE',
        records: sorted,
        dataSource: 'query',
        progress: buildPhaseProgress({
          totalBlocks: blocks.length,
          queriedBlocks: blocks.length,
          connectStatus: 'completed',
          queryStatus: 'completed',
          finalizeStatus: 'completed',
          text: `✓ ${sorted.length} records loaded.`,
        }),
      })

    } catch (e) {
      if (e.message === 'Cancelled') {
        log('warn', 'Query cancelled by user')
        dispatch({
          type: 'CANCELLED',
          payload: buildPhaseProgress({
            totalBlocks: blocks.length,
            queriedBlocks,
            connectStatus: connected ? 'completed' : 'in_progress',
            queryStatus: connected ? 'in_progress' : 'pending',
            finalizeStatus: 'pending',
            text: 'Query cancelled.',
          }),
        })
      } else {
        log('err', `Query failed: ${e.message}`)
        dispatch({ type: 'ERROR', payload: `Error: ${e.message}` })
      }
    } finally {
      rpc.close()
      log('info', 'WebSocket connection closed')
      if (rpcRef.current === rpc) rpcRef.current = null
    }
  }, [log])

  /**
   * Import balance data from a parsed file string.
   * Handles encrypted files by accepting the decrypted text directly.
   *
   * @param {string} text  File content (already decrypted if necessary)
   * @param {'json'|'csv'|'xml'} ext
   * @param {string} fname  Original filename for logging
   * @returns {{ rpcConfig: object|null }} — rpcConfig to pre-fill query form
   */
  const importData = useCallback((text, ext, fname) => {
    dispatch({ type: 'RESET' })
    try {
      const { records, rpcConfig } = parseImport(text, ext)
      if (!records.length) throw new Error('No records found in file.')
      log('ok', `Imported ${records.length.toLocaleString('en')} records from "${fname}"`)
      dispatch({ type: 'DONE', records, dataSource: 'import' })
      return { rpcConfig }
    } catch (e) {
      log('err', `Import failed: ${e.message}`)
      dispatch({ type: 'ERROR', payload: `Import failed: ${e.message}` })
      return { rpcConfig: null }
    }
  }, [log])

  /**
   * Decrypt an AES-256-GCM encrypted file then import it.
   * @returns {Promise<{ rpcConfig: object|null }>}
   */
  const importEncrypted = useCallback(async (encText, password, ext, fname) => {
    try {
      const plain = await aesDecrypt(encText, password)
      return importData(plain, ext, fname)
    } catch {
      log('err', 'Decryption failed — wrong password or corrupted file.')
      dispatch({ type: 'ERROR', payload: 'Decryption failed — wrong password or corrupted file.' })
      return { rpcConfig: null }
    }
  }, [importData, log])

  return {
    ...state,
    log,
    reset,
    cancel,
    runQuery,
    importData,
    importEncrypted,
  }
}
