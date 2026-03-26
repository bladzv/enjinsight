/**
 * useRewardHistory — Computes per-era staking rewards for a wallet address
 * directly from the Enjin archive node RPC.
 *
 * Mirrors the logic of staking-rewards-rpc.py:
 *  1. Load relay-era-reference.csv for era block boundaries.
 *  2. Connect to archive node WebSocket.
 *  3. Discover pool memberships from chain RPC (BondedPools + TokenAccounts).
 *     Optional history mode augments pool IDs from Subscan extrinsics.
 *  4. For each era × pool: read member balance + total pool supply via archive RPC.
 *  5. For each era × pool with non-zero balance: scan the ~40 blocks after
 *     the era boundary and aggregate NominationPools reward events.
 *  6. Reward = (memberBalance × reinvested) / poolSupply.
 *     APY    = ((poolSupply + reinvested) / poolSupply)^365 − 1.
 */
import { useReducer, useCallback, useRef } from 'react'
import {
  WS_CONNECT_TIMEOUT_MS,
  WS_CALL_TIMEOUT_MS,
  PLANCK_PER_ENJ,
  API_DELAY_MS,
} from '../constants.js'
import { validateWsEndpoint, buildTokenAccountKey, buildTokenKey, decodeCompactFirst, buildBondedPoolsPrefix, poolIdFromBondedPoolsKey } from '../utils/substrate.js'
import { fetchHistoricalPoolIds, delay, enqueueRequest } from '../utils/api.js'
import { nowHHMMSS } from '../utils/format.js'

// ── Constants ──────────────────────────────────────────────────────────────
const ARCHIVE_WSS    = 'wss://archive.relay.blockchain.enjin.io'
const COLLECTION_ID  = 1n          // sENJ multi-token collection
const ERAS_PER_YEAR  = 365
const EVENT_SCAN_AFTER = 40        // python parity: scan_start..(scan_start+40) inclusive
const CSV_PATHS      = ['/relay-era-range-reference.csv', '/relay-era-reference.csv']
const LOG_CAP        = 500

// Staking.ActiveEra storage key: twox128("Staking") + twox128("ActiveEra")
// Used to query the current era index at any block hash.
const STAKING_ACTIVE_ERA_KEY = '0x5f3e4907f716ac89b6347d15ececedca686dcf6300e60d5d7bce8b49c965bc6d'

// Decode Staking.ActiveEra from raw storage bytes.
// Handles both:
//   - Option<ActiveEraInfo>: 0x01 + <u32 index> + ...
//   - direct struct encoding: <u32 index> + ...
function decodeActiveEraIndex(hex) {
  if (!hex || hex === '0x') return null
  const s = hex.startsWith('0x') ? hex.slice(2) : hex
  if (s.length < 8) return null

  const readU32LEAt = (byteOffset) => {
    const i = byteOffset * 2
    if (s.length < i + 8) return null
    const b0 = parseInt(s.slice(i, i + 2), 16)
    const b1 = parseInt(s.slice(i + 2, i + 4), 16)
    const b2 = parseInt(s.slice(i + 4, i + 6), 16)
    const b3 = parseInt(s.slice(i + 6, i + 8), 16)
    return ((b0) | (b1 << 8) | (b2 << 16) | (b3 * 16777216)) >>> 0
  }

  // Option::Some prefix
  const firstByte = parseInt(s.slice(0, 2), 16)
  if (firstByte === 0x01) {
    const v = readU32LEAt(1)
    if (v != null) return v
  }
  return readU32LEAt(0)
}

function toPosInt(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null
}

function parseHexU32(hex) {
  if (!hex || typeof hex !== 'string') return null
  const n = Number.parseInt(hex, 16)
  return Number.isFinite(n) ? n : null
}

function getEraRow(cache, era) {
  const idx = Number.parseInt(String(era), 10)
  if (!Number.isFinite(idx)) return null
  return cache?.[idx] ?? null
}

// ── Status ─────────────────────────────────────────────────────────────────
export const RH_STATUS = {
  IDLE:       'idle',
  LOADING:    'loading',
  DONE:       'done',
  STOPPED:    'stopped',
  ERROR:      'error',
}

// ── Formatting helper (module-level to avoid closure issues) ───────────────
function fmtEnj(planck) {
  if (planck === 0n) return '0.000000'
  const whole = planck / PLANCK_PER_ENJ
  const frac  = String(planck % PLANCK_PER_ENJ).padStart(18, '0').slice(0, 6)
  return `${whole.toLocaleString()}.${frac}`
}

// ── Reducer ────────────────────────────────────────────────────────────────
const initialState = {
  status:   RH_STATUS.IDLE,
  results:  [],        // [{era,poolId,poolLabel,memberBalance,poolSupply,reinvested,reward,accumulated,apy,eraStartBlock,eraStartDateUtc}]
  logs:     [],
  progress: null,      // {phases:[...]}
  csvCount: 0,
  errorMsg: null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'START':
      return { ...initialState, status: RH_STATUS.LOADING, progress: action.payload }
    case 'CSV_LOADED':
      return { ...state, csvCount: action.count }
    case 'SET_PROGRESS':
      return { ...state, progress: action.payload }
    case 'LOG': {
      const next = [...state.logs, action.payload]
      return { ...state, logs: next.length > LOG_CAP ? next.slice(-LOG_CAP) : next }
    }
    case 'DONE':
      return { ...state, status: RH_STATUS.DONE, results: action.results, progress: null }
    case 'STOP':
      return { ...state, status: RH_STATUS.STOPPED, progress: null }
    case 'ERROR':
      return { ...state, status: RH_STATUS.ERROR, errorMsg: action.msg, progress: null }
    case 'RESET':
      return { ...initialState }
    default:
      return state
  }
}

// ── Tiny WS-RPC client (same pattern as useBalanceExplorer's EnjinRPC) ─────
class ArchiveRPC {
  constructor(ep) {
    this.ep   = ep
    this.ws   = null
    this.pend = new Map()
    this.id   = 0
    this.dead = false
  }

  connect() {
    return new Promise((res, rej) => {
      let ws
      try { ws = new WebSocket(this.ep) }
      catch (e) { return rej(new Error(`Cannot open WebSocket: ${e.message}`)) }
      this.ws = ws
      const tout = setTimeout(() => rej(new Error(`Connection timed out (${WS_CONNECT_TIMEOUT_MS / 1000}s)`)), WS_CONNECT_TIMEOUT_MS)
      ws.onopen  = () => { clearTimeout(tout); res() }
      ws.onerror = () => { clearTimeout(tout); rej(new Error('WebSocket connection failed — check archive endpoint')) }
      ws.onclose = () => {
        this.pend.forEach(p => p.rej(new Error('Connection closed')))
        this.pend.clear()
      }
      ws.onmessage = ev => {
        let msg
        try { msg = JSON.parse(ev.data) } catch { return }
        if (!msg?.id) return
        const p = this.pend.get(msg.id)
        if (!p) return
        this.pend.delete(msg.id)
        if (msg.error) p.rej(new Error(String(msg.error?.message ?? 'RPC error')))
        else           p.res(msg.result)
      }
    })
  }

  call(method, params = []) {
    return new Promise((res, rej) => {
      if (this.dead || !this.ws || this.ws.readyState !== WebSocket.OPEN)
        return rej(new Error('Not connected'))
      const id = ++this.id
      const t = setTimeout(() => {
        this.pend.delete(id)
        rej(new Error(`Timeout: ${method}`))
      }, WS_CALL_TIMEOUT_MS)
      this.pend.set(id, {
        res: v => { clearTimeout(t); res(v) },
        rej: e => { clearTimeout(t); rej(e) },
      })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  close() {
    this.dead = true
    this.pend.forEach(p => p.rej(new Error('Closed')))
    this.pend.clear()
    try { this.ws?.close(1000, 'done') } catch {}
    this.ws = null
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useRewardHistory() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const abortRef = useRef(null)

  const log = useCallback((level, message) => {
    dispatch({ type: 'LOG', payload: { id: Date.now() + Math.random(), ts: nowHHMMSS(), level, message } })
  }, [])

  // ── Load era CSV ──────────────────────────────────────────────────────
  async function loadEraCSV() {
    const candidates = []
    for (const p of CSV_PATHS) {
      candidates.push(p)
      candidates.push(p.replace(/^\//, ''))
    }
    for (const path of candidates) {
      try {
        const resp = await fetch(path, { credentials: 'same-origin' })
        if (!resp.ok) continue
        const text = await resp.text()
        if (!text.trimStart().startsWith('era,')) continue
        const lines = text.trim().split(/\r?\n/)
        if (lines.length < 2) continue
        const header = lines[0].split(',').map(s => s.trim().replace(/^\uFEFF/, ''))
        const cache = {}
        let count = 0
        for (let i = 1; i < lines.length; i++) {
          const cols  = lines[i].split(',')
          if (cols.length < 2) continue
          const row   = {}; header.forEach((h, j) => { row[h] = (cols[j] ?? '').trim() })
          const era   = parseInt(row.era, 10); if (isNaN(era)) continue
          const sb    = parseInt(row.start_block, 10); if (isNaN(sb)) continue
          const eb    = row.end_block ? parseInt(row.end_block, 10) : NaN
          cache[era] = {
            startBlock:      sb,
            endBlock:        isNaN(eb) ? null : eb,
            startBlockHash:  row.start_block_hash   || null,
            startDateUtc:    row.start_datetime_utc || null,
            endDateUtc:      row.end_datetime_utc   || null,
          }
          count++
        }
        if (count === 0) continue
        dispatch({ type: 'CSV_LOADED', count })
        return { cache, path }
      } catch {}
    }
    return { cache: {}, path: null }
  }

  // ── Enumerate all bonded pool IDs from chain (NominationPools.BondedPools) ──────────────
  // Mirrors Python's api.query_map("NominationPools", "BondedPools").
  // Uses state_getKeysPaged to walk the storage map and extract pool IDs from keys.
  async function enumerateBondedPools(rpc, logFn, signal) {
    const prefix   = buildBondedPoolsPrefix()
    const poolIds  = []
    let startKey   = null
    const pageSize = 500
    try {
      while (true) {
        if (signal?.aborted) throw new Error('Aborted')
        const params = startKey
          ? [prefix, pageSize, startKey]
          : [prefix, pageSize]
        const keys = await rpc.call('state_getKeysPaged', params)
        if (!Array.isArray(keys) || keys.length === 0) break
        for (const k of keys) {
          const id = poolIdFromBondedPoolsKey(k)
          if (id !== null && !isNaN(id)) poolIds.push(id)
        }
        if (keys.length < pageSize) break
        startKey = keys[keys.length - 1]
        await delay(200)
      }
    } catch (e) {
      if (signal?.aborted) throw e
      logFn('WARN', `BondedPools RPC enumeration failed: ${e.message}`)
    }
    return poolIds
  }

  // ── Discover member pools (check sENJ balance at finalized chain head) ──────
  // Mirrors Python's find_member_pools(): checks MultiTokens.TokenAccounts for non-zero balance.
  // headHash is passed explicitly so the archive node receives an unambiguous block reference
  // (archive nodes return null for state_getStorage calls without a block hash).
  async function discoverMemberPools(rpc, allPools, address, headHash, logFn, signal) {
    logFn('INFO', `Checking sENJ balance in ${allPools.length} pool(s) at current chain head…`)
    const memberPools = []
    for (const pool of allPools) {
      if (signal?.aborted) throw new Error('Aborted')
      const key = buildTokenAccountKey(COLLECTION_ID, BigInt(pool.poolId), address)
      try {
        const queryParams = headHash ? [key, headHash] : [key]
        const raw = await rpc.call('state_getStorage', queryParams)
        const bal = decodeCompactFirst(raw)
        if (bal > 0n) {
          memberPools.push(pool)
          logFn('OK', `Pool #${pool.poolId} (${pool.metadata || 'unnamed'}): ${fmtEnj(bal)} sENJ (current chain head — era-start balances will be read per-era)`)
        }
      } catch (e) {
        logFn('WARN', `Pool #${pool.poolId}: balance check failed — ${e.message}`)
      }
    }
    return memberPools
  }

  function toIntLoose(v) {
    if (v == null) return null
    if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null
    if (typeof v === 'bigint') return Number(v)
    if (typeof v === 'string') {
      const parsed = parseBigIntLoose(v)
      if (parsed == null) return null
      const n = Number(parsed)
      return Number.isFinite(n) ? Math.trunc(n) : null
    }
    if (typeof v === 'object') {
      if ('value' in v) return toIntLoose(v.value)
      if ('index' in v) return toIntLoose(v.index)
      if ('amount' in v) return toIntLoose(v.amount)
    }
    return null
  }

  function parseBigIntLoose(raw) {
    if (typeof raw !== 'string') return null
    const s = raw.trim()
    if (!s) return null

    // Common codec JSON form for U128 on this chain is hex ("0x...").
    if (/^-?0x[0-9a-f]+$/i.test(s)) {
      try { return BigInt(s) } catch { return null }
    }

    // Decimal strings may include separators.
    const cleaned = s.replace(/[,_\s]/g, '')
    if (/^-?\d+$/.test(cleaned)) {
      try { return BigInt(cleaned) } catch { return null }
    }

    // Last-resort fallback for malformed strings with extra characters.
    const digitsOnly = cleaned.replace(/[^0-9-]/g, '')
    if (/^-?\d+$/.test(digitsOnly)) {
      try { return BigInt(digitsOnly) } catch { return null }
    }

    return null
  }

  function toBigIntLoose(v) {
    if (v == null) return 0n
    if (typeof v === 'bigint') return v
    if (typeof v === 'number') return Number.isFinite(v) ? BigInt(Math.trunc(v)) : 0n
    if (typeof v === 'string') {
      return parseBigIntLoose(v) ?? 0n
    }
    if (Array.isArray(v)) {
      if (v.length >= 2) return toBigIntLoose(v[1])
      if (v.length === 1) return toBigIntLoose(v[0])
      return 0n
    }
    if (typeof v === 'object') {
      if ('amount' in v) return toBigIntLoose(v.amount)
      if ('value' in v) return toBigIntLoose(v.value)
      if ('commission' in v) return toBigIntLoose(v.commission)
      if (typeof v.toString === 'function') return toBigIntLoose(v.toString())
    }
    return 0n
  }

  function eventField(obj, keys, fallback = null) {
    if (Array.isArray(obj)) {
      return fallback != null ? obj[fallback] : undefined
    }
    if (obj && typeof obj === 'object') {
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) return obj[k]
      }
    }
    return undefined
  }

  async function openRpcEventApi(endpoint) {
    const mod = await import('@polkadot/api')
    const WsProvider = mod.WsProvider
    const ApiPromise = mod.ApiPromise
    const provider = new WsProvider(endpoint, WS_CONNECT_TIMEOUT_MS)
    const api = await ApiPromise.create({
      provider,
      throwOnConnect: true,
      noInitWarn: true,
      noTelemetryWarn: true,
    })
    await api.isReady
    return {
      api,
      async close() {
        try { await api.disconnect() } catch {}
      },
    }
  }

  // Mirrors staking-rewards-rpc.py find_reinvested() via direct RPC event reads.
  async function findReinvestedViaRpc(eventApi, poolId, era, eventStart, eventEnd, signal) {
    let total = 0n
    for (let blk = eventStart; blk <= eventEnd; blk++) {
      if (signal?.aborted) throw new Error('Aborted')

      let events
      try {
        const blockHash = await eventApi.rpc.chain.getBlockHash(blk)
        events = await eventApi.query.system.events.at(blockHash)
      } catch {
        continue
      }

      for (const rec of events) {
        try {
          const sec = String(rec?.event?.section ?? '')
          const meth = String(rec?.event?.method ?? '')
          if (sec !== 'nominationPools') continue

          const data = rec?.event?.data?.toJSON?.() ?? rec?.event?.data ?? []
          const evPool = toIntLoose(eventField(data, ['pool_id', 'poolId'], 0))
          const evEra = toIntLoose(eventField(data, ['era', 'era_index', 'eraIndex'], 1))
          if (evPool !== poolId || evEra !== era) continue

          if (meth === 'EraRewardsProcessed') {
            const reinvested = toBigIntLoose(eventField(data, ['reinvested'], 2))
            return reinvested
          }

          if (meth === 'RewardPaid') {
            const reward = toBigIntLoose(eventField(data, ['reward'], 3))
            const comm = toBigIntLoose(eventField(data, ['commission'], 4))
            total += reward + comm
          }
        } catch {
          // best-effort per event; continue scanning
        }
      }
    }
    return total
  }

  async function eraAtBlock(rpc, blockNumber) {
    const bh = await rpc.call('chain_getBlockHash', [blockNumber])
    if (!bh || /^0x0+$/.test(bh)) return null
    const raw = await rpc.call('state_getStorage', [STAKING_ACTIVE_ERA_KEY, bh])
    return decodeActiveEraIndex(raw)
  }

  // Mirrors staking-rewards-rpc.py find_era_start_block()
  async function findEraStartBlock(rpc, era, chainHead, signal) {
    let lo = 1
    let hi = chainHead
    let result = null

    while (lo <= hi) {
      if (signal?.aborted) throw new Error('Aborted')
      const mid = Math.floor((lo + hi) / 2)
      let midEra = null

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          midEra = await eraAtBlock(rpc, mid)
          break
        } catch (e) {
          if (attempt < 2) await delay(1000)
        }
      }

      if (midEra == null) {
        lo = mid + 1
        continue
      }

      if (midEra < era) lo = mid + 1
      else if (midEra > era) hi = mid - 1
      else {
        result = mid
        hi = mid - 1
      }
    }

    if (result == null) return null

    while (result > 1) {
      if (signal?.aborted) throw new Error('Aborted')
      let prevEra = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          prevEra = await eraAtBlock(rpc, result - 1)
          break
        } catch (e) {
          if (attempt < 2) await delay(1000)
        }
      }
      if (prevEra == null || prevEra !== era) break
      result -= 1
    }

    return result
  }

  // ── Main run ──────────────────────────────────────────────────────────
  const run = useCallback(async ({ address, startEra, endEra: endEraInput, endpoint, includeHistory = false }) => {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const signal = ctrl.signal
    let resolvedEndpoint = ARCHIVE_WSS

    // endEra may be clamped to the current active era after connecting (mirrors Python)
    let endEra = endEraInput
    let eraRange = endEra - startEra + 1

    // Mutable phases array — avoids the functional-update anti-pattern with useReducer
    const phasesArr = [
      { key: 'csv',      label: 'Load Era Reference',       status: 'in_progress', total: 1,        completed: 0 },
      { key: 'connect',  label: 'Connect to Archive Node',  status: 'pending',     total: 1,        completed: 0 },
      { key: 'pools',    label: 'Discover Pool Membership', status: 'pending',     total: 1,        completed: 0 },
      ...(includeHistory ? [{ key: 'history', label: 'Fetch Past Pool Interactions', status: 'pending', total: 1, completed: 0 }] : []),
      { key: 'balances', label: 'Query Era Balances',        status: 'pending',     total: eraRange, completed: 0 },
      { key: 'rewards',  label: 'Fetch Reinvested Amounts',  status: 'pending',     total: 0,        completed: 0 },
    ]

    const syncProgress = () =>
      dispatch({ type: 'SET_PROGRESS', payload: { phases: phasesArr.map(p => ({ ...p })) } })

    const patchPhase = (key, patch) => {
      const idx = phasesArr.findIndex(p => p.key === key)
      if (idx >= 0) phasesArr[idx] = { ...phasesArr[idx], ...patch }
    }

    dispatch({
      type: 'START',
      payload: { phases: phasesArr.map(p => ({ ...p })) },
    })

    // Local log helper that also dispatches
    const logFn = (level, message) => {
      dispatch({ type: 'LOG', payload: { id: Date.now() + Math.random(), ts: nowHHMMSS(), level, message } })
    }

    let rpc = null
    let eventApiHandle = null

    try {
      resolvedEndpoint = validateWsEndpoint(endpoint || ARCHIVE_WSS)

      // ── Phase 0: Load CSV ────────────────────────────────────────────
      logFn('INFO', '─── Phase 0: Loading era reference CSV ───')
      const { cache: eraCache, path: csvPath } = await loadEraCSV()
      const csvEras  = Object.keys(eraCache).map(Number)
      logFn('OK', `Era CSV: ${csvEras.length} era(s) loaded.`)
      if (csvPath) logFn('INFO', `Using CSV source: ${csvPath}`)
      patchPhase('csv', { status: 'completed', completed: 1 })
      patchPhase('connect', { status: 'in_progress' })
      syncProgress()
      if (signal.aborted) { dispatch({ type: 'STOP' }); return }

      // ── Phase 1: Connect to archive ──────────────────────────────────
      logFn('INFO', `─── Phase 1: Connecting to archive node (${resolvedEndpoint}) ───`)
      rpc = new ArchiveRPC(resolvedEndpoint)
      await rpc.connect()
      logFn('OK', 'Archive node connected.')

      // Fetch the current active era and clamp endEra — mirrors Python's
      //   if end_era > current_era: end_era = current_era
      let currentEra = null
      let headHash   = null    // saved for Phase 2 pool-membership queries
      let chainHead  = null
      try {
        headHash               = await rpc.call('chain_getFinalizedHead', [])
        const headHeader       = await rpc.call('chain_getHeader', [headHash])
        chainHead              = parseHexU32(headHeader?.number)
        const activeEraRaw = await rpc.call('state_getStorage', [STAKING_ACTIVE_ERA_KEY, headHash])
        currentEra = decodeActiveEraIndex(activeEraRaw)
        if (currentEra !== null) {
          logFn('INFO', `Current chain era: ${currentEra}`)
          if (endEra > currentEra) {
            logFn('WARN', `endEra clamped from ${endEra} to ${currentEra} (cannot query future eras)`)
            endEra = currentEra
          }
        }
      } catch (e) {
        logFn('WARN', `Could not fetch current era: ${e.message} — proceeding with requested endEra.`)
      }
      eraRange = endEra - startEra + 1

      patchPhase('connect', { status: 'completed', completed: 1 })
      patchPhase('pools', { status: 'in_progress' })
      syncProgress()
      if (signal.aborted) { dispatch({ type: 'STOP' }); return }

      // ── Phase 1.5: Resolve exact era boundaries ───────────────────────
      // Priority:
      //   1) If era exists in relay-era-reference.csv, trust its start_block/end_block.
      //   2) Otherwise use era-range-fetch.py-style binary search for start_block.
      //   3) Compute end_block as (start_block of next era - 1).
      for (let era = startEra; era <= endEra; era++) {
        const row = getEraRow(eraCache, era)
        if (!row) continue
        const sb = toPosInt(row.startBlock)
        const eb = toPosInt(row.endBlock)
        if (sb != null) row.startBlock = sb
        if (eb != null) {
          row.endBlock = eb
          // If next-era row is absent, derive its start from this CSV end.
          const next = getEraRow(eraCache, era + 1)
          if (!next) eraCache[era + 1] = {}
          if (toPosInt(getEraRow(eraCache, era + 1)?.startBlock) == null) {
            eraCache[era + 1].startBlock = eb + 1
          }
        } else {
          row.endBlock = null
        }
      }

      if (chainHead != null) {
        const missingStarts = []
        for (let era = startEra; era <= endEra + 1; era++) {
          if (toPosInt(getEraRow(eraCache, era)?.startBlock) == null) missingStarts.push(era)
        }
        if (missingStarts.length > 0) {
          logFn('INFO', `Finding exact start block for ${missingStarts.length} era(s) via RPC binary search…`)
        }

        for (const era of missingStarts) {
          if (signal.aborted) { dispatch({ type: 'STOP' }); return }
          if (currentEra !== null && era > currentEra + 1) {
            logFn('WARN', `Era ${era}: beyond queryable boundary (current era ${currentEra}).`)
            continue
          }

          const found = await findEraStartBlock(rpc, era, chainHead, signal)
          if (found == null) {
            logFn('WARN', `Era ${era}: start block not found on chain.`)
            continue
          }

          const existing = getEraRow(eraCache, era) || {}
          const hash = existing.startBlockHash || await rpc.call('chain_getBlockHash', [found]).catch(() => null)
          eraCache[era] = {
            ...existing,
            startBlock: found,
            startBlockHash: hash || existing.startBlockHash || null,
            startDateUtc: existing.startDateUtc || null,
            endBlock: toPosInt(existing.endBlock),
            endDateUtc: existing.endDateUtc || null,
          }

          // Same as era-range-fetch.py: when era N+1 start is known, era N end = start(N+1)-1.
          if (era > 1) {
            if (!getEraRow(eraCache, era - 1)) eraCache[era - 1] = {}
            if (toPosInt(getEraRow(eraCache, era - 1)?.endBlock) == null) {
              eraCache[era - 1].endBlock = found - 1
            }
          }

          logFn('INFO', `Era ${era}: start block ${found.toLocaleString()}`)
        }
      } else {
        logFn('WARN', 'Could not determine chain head; binary-search fallback skipped.')
      }

      // Final normalize pass: ensure each queried era has start_block and end_block.
      for (let era = startEra; era <= endEra; era++) {
        const row = getEraRow(eraCache, era) || {}
        const sb = toPosInt(row.startBlock)
        let eb = toPosInt(row.endBlock)
        if (sb == null) continue

        const nextStart = toPosInt(getEraRow(eraCache, era + 1)?.startBlock)
        if (eb == null && nextStart != null && nextStart > sb) {
          eb = nextStart - 1
        }

        eraCache[era] = {
          ...row,
          startBlock: sb,
          endBlock: eb,
        }

        if (eb != null) {
          if (!getEraRow(eraCache, era + 1)) eraCache[era + 1] = {}
          if (toPosInt(getEraRow(eraCache, era + 1)?.startBlock) == null) {
            eraCache[era + 1].startBlock = eb + 1
          }
        }
      }

      // ── Phase 2: Enumerate all bonded pools from chain, then discover membership ──────────
      // Mirrors Python: query NominationPools.BondedPools via RPC to get all pool IDs,
      // then check MultiTokens.TokenAccounts for the user's sENJ balance.
      logFn('INFO', '─── Phase 2: Enumerating bonded pools from chain ───')
      const bondedPoolIds = await enumerateBondedPools(rpc, logFn, signal)
      if (signal.aborted) { dispatch({ type: 'STOP' }); return }

      let poolIdCount = bondedPoolIds.length
      logFn('INFO', `Chain reports ${poolIdCount} bonded pool(s).`)

      // Build the pool list solely from chain-enumerated IDs.
      const allPools = bondedPoolIds.map(id => ({
        poolId:   id,
        metadata: '',
      }))

      if (!allPools.length) {
        dispatch({ type: 'ERROR', msg: 'No bonded nomination pools found on chain.' })
        return
      }

      const memberPools = await discoverMemberPools(rpc, allPools, address, headHash, logFn, signal)

      if (signal.aborted) { dispatch({ type: 'STOP' }); return }

      if (memberPools.length === 0 && !includeHistory) {
        logFn('WARN', 'No active sENJ balance found at chain head.')
        logFn('INFO', 'Enable "Include past pool interactions" to scan pools you have previously exited.')
        dispatch({ type: 'DONE', results: [] })
        return
      }

      if (memberPools.length === 0) {
        logFn('INFO', 'No active pool memberships at chain head. Scanning historical pools only…')
      } else {
        logFn('OK', `Active member of ${memberPools.length} pool(s): ${memberPools.map(p => `#${p.poolId}`).join(', ')}`)
      }
      patchPhase('pools', { status: 'completed', completed: 1 })

      // ── Optional: fetch historical pool interactions ───────────────────────
      if (includeHistory) {
        patchPhase('history', { status: 'in_progress' })
        syncProgress()
        logFn('INFO', '─── Phase 2.5: Fetching past pool interactions from Subscan ───')
        try {
          const histPoolIds = await enqueueRequest(() =>
            fetchHistoricalPoolIds(address, signal, (pg, cnt) => {
              logFn('INFO', `Extrinsics page ${pg + 1}: ${cnt} record(s) fetched.`)
            })
          )
          let added = 0
          for (const pid of histPoolIds) {
            const alreadyMember = memberPools.some(p => p.poolId === pid)
            if (!alreadyMember) {
              // Find pool metadata from allPools list
              const poolMeta = allPools.find(p => p.poolId === pid)
              if (poolMeta) {
                memberPools.push(poolMeta)
              } else {
                // Pool may have been destroyed; keep a pool-id-only stub.
                memberPools.push({ poolId: pid, metadata: '' })
              }
              logFn('INFO', `[HISTORICAL] Pool #${pid}: added from past interactions.`)
              added++
            }
          }
          logFn('OK', `Historical scan complete. ${added} additional pool(s) added (${memberPools.length} total).`)
          patchPhase('history', { status: 'completed', completed: 1 })
        } catch (e) {
          if (signal.aborted) { dispatch({ type: 'STOP' }); return }
          logFn('WARN', `Historical pool fetch failed: ${e.message} — proceeding with current pools only.`)
          patchPhase('history', { status: 'completed', completed: 1 })
        }
        syncProgress()
      }

      patchPhase('balances', { status: 'in_progress', total: eraRange * memberPools.length })
      syncProgress()

      // ── Phase 3: Query era balances via archive RPC ───────────────────
      logFn('INFO', `─── Phase 3: Querying balances for ${eraRange} era(s) × ${memberPools.length} pool(s) ───`)

      const eraPoolData = []
      let balCompleted = 0

      for (let era = startEra; era <= endEra; era++) {
        if (signal.aborted) { dispatch({ type: 'STOP' }); return }

        const eraRow = getEraRow(eraCache, era)
        const eraStartBlock = toPosInt(eraRow?.startBlock)
        const eraEndBlock = toPosInt(eraRow?.endBlock)
        const eraEndBoundary = eraEndBlock != null ? eraEndBlock + 1 : toPosInt(getEraRow(eraCache, era + 1)?.startBlock)

        if (eraStartBlock != null && eraEndBlock != null) {
          logFn('INFO', `Era ${era}: CSV boundaries start ${eraStartBlock}, end ${eraEndBlock} (scan starts ${eraEndBlock + 1}).`)
        }

        if (eraStartBlock == null || eraEndBoundary == null) {
          logFn('WARN', `Era ${era}: missing exact era boundary block(s), skipping.`)
          balCompleted += memberPools.length
          patchPhase('balances', { completed: balCompleted })
          syncProgress()
          continue
        }

        const derivedEnd = eraEndBlock != null ? eraEndBlock : (eraEndBoundary - 1)
        logFn('INFO', `Era ${era}: using block range ${eraStartBlock}-${derivedEnd} (scan window starts at ${eraEndBoundary})`)

        let blockHash = eraRow?.startBlockHash ?? null

        if (!blockHash) {
          try {
            blockHash = await rpc.call('chain_getBlockHash', [eraStartBlock])
            if (blockHash) {
              eraCache[era] = { ...(eraCache[era] || {}), startBlockHash: blockHash }
            }
          } catch (e) {
            logFn('WARN', `Era ${era}: failed to get block hash — ${e.message}`)
          }
        }

        if (!blockHash) {
          logFn('WARN', `Era ${era}: no block hash available — skipping.`)
          balCompleted += memberPools.length
          patchPhase('balances', { completed: balCompleted })
          syncProgress()
          continue
        }

        for (const pool of memberPools) {
          if (signal.aborted) { dispatch({ type: 'STOP' }); return }

          let memberBalance = 0n
          try {
            const key = buildTokenAccountKey(COLLECTION_ID, BigInt(pool.poolId), address)
            const raw = await rpc.call('state_getStorage', [key, blockHash])
            memberBalance = decodeCompactFirst(raw)
          } catch (e) {
            logFn('WARN', `Era ${era} Pool #${pool.poolId}: balance error — ${e.message}`)
          }

          let poolSupply = 0n
          if (memberBalance > 0n) {
            try {
              const key = buildTokenKey(COLLECTION_ID, BigInt(pool.poolId))
              const raw = await rpc.call('state_getStorage', [key, blockHash])
              poolSupply = decodeCompactFirst(raw)
            } catch (e) {
              logFn('WARN', `Era ${era} Pool #${pool.poolId}: supply error — ${e.message}`)
            }
          }

          if (memberBalance > 0n && poolSupply > 0n) {
            eraPoolData.push({
              era,
              pool,
              memberBalance,
              poolSupply,
              blockHash,
              startBlock:   eraStartBlock,
              endBlock:     eraEndBlock,
              eraEndBoundary,
              startDateUtc: eraRow?.startDateUtc ?? null,
            })
            logFn('INFO', `Era ${era} Pool #${pool.poolId}: member ${fmtEnj(memberBalance)} / supply ${fmtEnj(poolSupply)} sENJ`)
          } else if (memberBalance === 0n) {
            logFn('INFO', `Era ${era} Pool #${pool.poolId}: not a member at era start — skipping.`)
          }

          balCompleted++
          patchPhase('balances', { completed: balCompleted })
          syncProgress()
        }
      }

      if (signal.aborted) { dispatch({ type: 'STOP' }); return }

      patchPhase('balances', { status: 'completed' })
      patchPhase('rewards', { status: 'in_progress', total: eraPoolData.length })
      syncProgress()

      // Open a dedicated polkadot-js API client for runtime event decoding via RPC.
      // This keeps reward scanning RPC-only (no Subscan events).
      eventApiHandle = await openRpcEventApi(resolvedEndpoint)

      // ── Phase 4: Scan reward events around era boundaries ──────────────
      logFn('INFO', `─── Phase 4: Scanning reward events for ${eraPoolData.length} era+pool pair(s) ───`)
      const results = []
      const accumulatedByPool = {}

      for (let i = 0; i < eraPoolData.length; i++) {
        if (signal.aborted) { dispatch({ type: 'STOP' }); return }

        const { era, pool, memberBalance, poolSupply, startBlock, eraEndBoundary, startDateUtc } = eraPoolData[i]

        const eventStart = eraEndBoundary
        const eventEnd   = eventStart + EVENT_SCAN_AFTER

        // Mirrors Python's find_reinvested(): query NominationPools events by pool_id + era
        // in the ~40 blocks after the era boundary. Checks EraRewardsProcessed first,
        // falls back to summing RewardPaid (reward + commission) across all validators.
        let reinvested = 0n
        try {
          reinvested = await findReinvestedViaRpc(
            eventApiHandle.api, pool.poolId, era, eventStart, eventEnd, signal,
          )
        } catch (e) {
          if (signal.aborted) { dispatch({ type: 'STOP' }); return }
          logFn('WARN', `Era ${era} Pool #${pool.poolId}: reward fetch failed — ${e.message}`)
        }

        if (reinvested === 0n) {
          logFn('INFO', `Era ${era} Pool #${pool.poolId}: no reward events found in blocks ${eventStart}-${eventEnd}.`)
          patchPhase('rewards', { completed: i + 1 })
          syncProgress()
          continue
        }

        // reward = (memberBalance × reinvested) / poolSupply
        const reward = (memberBalance * reinvested) / poolSupply

        // APY formula mirrors staking-rewards-rpc.py:
        // era_apy = ((total_points + reinvested) / total_points) ^ 365 − 1
        // Compute reinvested/poolSupply via scaled BigInt division to avoid
        // Number precision loss (poolSupply can exceed Number.MAX_SAFE_INTEGER).
        const RATIO_PREC = 1_000_000_000n
        const perEraGainScaled = poolSupply > 0n ? (reinvested * RATIO_PREC) / poolSupply : 0n
        const ratio = 1 + Number(perEraGainScaled) / Number(RATIO_PREC)
        const apy   = (Math.pow(ratio, ERAS_PER_YEAR) - 1) * 100

        accumulatedByPool[pool.poolId] = (accumulatedByPool[pool.poolId] ?? 0n) + reward

        results.push({
          era,
          poolId:       pool.poolId,
          poolLabel:    pool.metadata || `Pool #${pool.poolId}`,
          memberBalance,
          poolSupply,
          reinvested,
          reward,
          accumulated:  accumulatedByPool[pool.poolId],
          apy,
          eraStartBlock:   startBlock,
          eraStartDateUtc: startDateUtc,
        })

        logFn('OK', `Era ${era} Pool #${pool.poolId}: reward ${fmtEnj(reward)} ENJ (APY ~${apy.toFixed(2)}%)`)
        patchPhase('rewards', { completed: i + 1 })
        syncProgress()
        await delay(API_DELAY_MS)
      }

      patchPhase('rewards', { status: 'completed' })
      syncProgress()

      const total = results.reduce((s, r) => s + r.reward, 0n)
      logFn('OK', `─── Done. ${results.length} era+pool record(s). Grand total: ${fmtEnj(total)} ENJ ───`)
      dispatch({ type: 'DONE', results })

    } catch (e) {
      if (signal.aborted || e.message === 'Aborted') {
        dispatch({ type: 'STOP' })
      } else {
        logFn('ERR', `Fatal error: ${e.message}`)
        dispatch({ type: 'ERROR', msg: e.message })
      }
    } finally {
      try { await eventApiHandle?.close?.() } catch {}
      rpc?.close()
    }
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    dispatch({ type: 'STOP' })
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    dispatch({ type: 'RESET' })
  }, [])

  return { ...state, run, stop, reset }
}
