/**
 * useBalanceExplorer — state machine for the Historical Balance Viewer.
 *
 * Manages:
 *  - WebSocket RPC connection lifecycle (opens, queries, closes, cancels)
 *  - Progress tracking per-block
 *  - Activity log messages (info / ok / warn / err)
 *  - Import from JSON / CSV / XML (with optional AES-256-GCM decryption)
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
  WS_CONNECT_TIMEOUT_MS,
  WS_CALL_TIMEOUT_MS,
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
  progress:   null,     // { pct, text } | null
  dataSource: 'none',   // 'query' | 'import' | 'none'
  errorMsg:   null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'RESET':
      return { ...initialState }

    case 'STATUS':
      return { ...state, status: action.payload }

    case 'PROGRESS':
      return { ...state, progress: action.payload }

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
        progress:   { pct: 100, text: `✓ ${action.records.length} records loaded.` },
      }

    case 'ERROR':
      return { ...state, status: STATUS.ERROR, errorMsg: action.payload, progress: null }

    case 'CANCELLED':
      return { ...state, status: STATUS.CANCELLED, progress: { pct: 0, text: 'Query cancelled.' } }

    default:
      return state
  }
}

// ── EnjinRPC WebSocket client ────────────────────────────────────────────

class EnjinRPC {
  constructor(ep) {
    this.ep   = ep
    this.ws   = null
    this.pend = new Map()
    this.id   = 0
    this.dead = false
  }

  connect() {
    return new Promise((res, rej) => {
      try { this.ws = new WebSocket(this.ep) }
      catch (e) { return rej(new Error(`Cannot open WebSocket: ${e.message}`)) }

      const tout = setTimeout(
        () => rej(new Error(`Connection timed out (${WS_CONNECT_TIMEOUT_MS / 1000} s)`)),
        WS_CONNECT_TIMEOUT_MS,
      )

      this.ws.onopen  = () => { clearTimeout(tout); res() }
      this.ws.onerror = () => {
        clearTimeout(tout)
        rej(new Error('WebSocket connection failed — check endpoint'))
      }
      this.ws.onclose = () => {
        this.pend.forEach(p => p.rej(new Error('Connection closed')))
        this.pend.clear()
      }
      this.ws.onmessage = ev => {
        let msg
        try { msg = JSON.parse(ev.data) } catch { return }
        if (typeof msg !== 'object' || msg === null) return
        const p = this.pend.get(msg.id)
        if (!p) return
        this.pend.delete(msg.id)
        msg.error
          ? p.rej(new Error(String(msg.error?.message || 'RPC error')))
          : p.res(msg.result)
      }
    })
  }

  call(method, params = []) {
    return new Promise((res, rej) => {
      if (this.dead) return rej(new Error('Cancelled'))
      const id   = ++this.id
      const tout = setTimeout(() => {
        this.pend.delete(id)
        rej(new Error(`RPC timeout: ${method}`))
      }, WS_CALL_TIMEOUT_MS)
      this.pend.set(id, {
        res: v => { clearTimeout(tout); res(v) },
        rej: e => { clearTimeout(tout); rej(e) },
      })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  cancel() {
    this.dead = true
    this.pend.forEach(p => p.rej(new Error('Cancelled')))
    this.pend.clear()
  }

  close() { try { this.ws?.close() } catch {} }
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

    // ── Query ────────────────────────────────────────────────────────────
    dispatch({ type: 'STATUS', payload: STATUS.CONNECTING })
    dispatch({ type: 'PROGRESS', payload: { pct: 0, text: `Connecting to ${ep}…` } })

    log('info', 'Session started')
    log('info', `Endpoint: ${ep}`)
    log('info', `Range: block ${start.toLocaleString('en')} → ${end.toLocaleString('en')}, step=${stepN}`)
    log('info', `Planned RPC calls: ${blocks.length.toLocaleString('en')}`)

    const rpc = new EnjinRPC(ep)
    rpcRef.current = rpc
    const results = []

    try {
      log('info', 'Opening WebSocket connection…')
      await rpc.connect()
      log('ok', 'WebSocket connected')

      dispatch({ type: 'STATUS', payload: STATUS.QUERYING })
      log('info', `Querying ${blocks.length.toLocaleString('en')} blocks…`)

      for (let i = 0; i < blocks.length; i++) {
        const blk = blocks[i]
        const pct = Math.round((i / blocks.length) * 100)
        dispatch({
          type: 'PROGRESS',
          payload: { pct, text: `Block ${blk.toLocaleString('en')}  (${i + 1} / ${blocks.length})` },
        })

        const hash = await rpc.call('chain_getBlockHash', [blk])
        if (!hash || !isValidBlockHash(hash) || /^0x0{64}$/.test(hash)) {
          log('warn', `Block #${blk.toLocaleString('en')}: no valid hash returned — block may not exist in the archive (skipped)`)
          results.push({
            block: blk, blockHash: '', free: 0n, reserved: 0n,
            miscFrozen: 0n, feeFrozen: 0n, nonce: 0, newFormat: false,
          })
          continue
        }

        const raw = await rpc.call('state_getStorage', [storKey, hash])
        if (!raw || raw === '0x') {
          log('warn', `Block #${blk.toLocaleString('en')}: no account storage at this block — account may not exist yet or has zero balance`)
          results.push({
            block: blk, blockHash: hash, free: 0n, reserved: 0n,
            miscFrozen: 0n, feeFrozen: 0n, nonce: 0, newFormat: false,
          })
          continue
        }
        const dec = decodeAccountInfo(raw)
        log('info', `Block #${blk.toLocaleString('en')} → free=${dec.free} res=${dec.reserved}${dec.newFormat ? ' [new-fmt]' : ''}`)
        results.push({ block: blk, blockHash: hash, ...dec })
      }

      log('ok', `Fetch complete — ${results.length.toLocaleString('en')} records`)
      dispatch({ type: 'DONE', records: results, dataSource: 'query' })

    } catch (e) {
      if (e.message === 'Cancelled') {
        log('warn', 'Query cancelled by user')
        dispatch({ type: 'CANCELLED' })
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
