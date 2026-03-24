/**
 * useRewardHistory — Computes per-era staking rewards for a wallet address
 * directly from the Enjin archive node + Subscan API.
 *
 * Mirrors the logic of staking-rewards-rpc.py:
 *  1. Load relay-era-reference.csv for era block boundaries.
 *  2. Connect to archive node WebSocket.
 *  3. Discover pool memberships: fetch all pools from Subscan, check which
 *     pools contain the user's sENJ (MultiTokens.TokenAccounts, collection 1).
 *  4. For each era × pool: read member balance + total pool supply via archive RPC.
 *  5. For each era × pool with non-zero balance: query pool stash reward events
 *     via Subscan (reward_slash in the era's event block range) → reinvested amount.
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
import { validateWsEndpoint, buildTokenAccountKey, buildTokenKey, decodeU128First } from '../utils/substrate.js'
import { fetchAllPools, fetchRewardSlash, delay, enqueueRequest } from '../utils/api.js'
import { nowHHMMSS } from '../utils/format.js'

// ── Constants ──────────────────────────────────────────────────────────────
const ARCHIVE_WSS    = 'wss://archive.relay.blockchain.enjin.io'
const COLLECTION_ID  = 1n          // sENJ multi-token collection
const ERAS_PER_YEAR  = 365
const EVENT_SCAN_LEN = 41          // blocks to scan after era boundary (inclusive)
const CSV_PATH       = '/relay-era-reference.csv'
const LOG_CAP        = 500

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
    for (const path of [CSV_PATH, CSV_PATH.replace(/^\//, '')]) {
      try {
        const resp = await fetch(path, { credentials: 'same-origin' })
        if (!resp.ok) continue
        const text = await resp.text()
        if (!text.trimStart().startsWith('era,')) continue
        const lines = text.trim().split(/\r?\n/)
        if (lines.length < 2) continue
        const header = lines[0].split(',').map(s => s.trim())
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
        return cache
      } catch {}
    }
    return {}
  }

  // ── Discover member pools (check sENJ balance at current head) ────────
  async function discoverMemberPools(rpc, allPools, address, logFn, signal) {
    logFn('INFO', `Checking sENJ balance in ${allPools.length} pool(s)…`)
    const memberPools = []
    for (const pool of allPools) {
      if (signal?.aborted) throw new Error('Aborted')
      const key = buildTokenAccountKey(COLLECTION_ID, BigInt(pool.poolId), address)
      try {
        const raw = await rpc.call('state_getStorage', [key])
        const bal = decodeU128First(raw)
        if (bal > 0n) {
          memberPools.push(pool)
          logFn('OK', `Pool #${pool.poolId} (${pool.metadata || 'unnamed'}): ${fmtEnj(bal)} sENJ`)
        }
      } catch (e) {
        logFn('WARN', `Pool #${pool.poolId}: balance check failed — ${e.message}`)
      }
    }
    return memberPools
  }

  // ── Main run ──────────────────────────────────────────────────────────
  const run = useCallback(async ({ address, startEra, endEra, endpoint }) => {
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const signal = ctrl.signal

    const eraRange = endEra - startEra + 1

    // Mutable phases array — avoids the functional-update anti-pattern with useReducer
    const phasesArr = [
      { key: 'csv',      label: 'Load Era Reference',      status: 'in_progress', total: 1,        completed: 0 },
      { key: 'connect',  label: 'Connect to Archive Node', status: 'pending',     total: 1,        completed: 0 },
      { key: 'pools',    label: 'Discover Pool Membership',status: 'pending',     total: 1,        completed: 0 },
      { key: 'balances', label: 'Query Era Balances',       status: 'pending',     total: eraRange, completed: 0 },
      { key: 'rewards',  label: 'Fetch Reinvested Amounts', status: 'pending',     total: 0,        completed: 0 },
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

    try {
      // ── Phase 0: Load CSV ────────────────────────────────────────────
      logFn('INFO', '─── Phase 0: Loading era reference CSV ───')
      const eraCache = await loadEraCSV()
      const csvEras  = Object.keys(eraCache).map(Number)
      logFn('OK', `Era CSV: ${csvEras.length} era(s) loaded.`)
      patchPhase('csv', { status: 'completed', completed: 1 })
      patchPhase('connect', { status: 'in_progress' })
      syncProgress()
      if (signal.aborted) { dispatch({ type: 'STOP' }); return }

      // Warn about missing eras
      const missingEras = []
      for (let era = startEra; era <= endEra; era++) {
        if (!eraCache[era]) missingEras.push(era)
      }
      if (missingEras.length > 0) {
        logFn('WARN', `${missingEras.length} era(s) not in CSV — will fetch block hashes via RPC.`)
      }

      // ── Phase 1: Connect to archive ──────────────────────────────────
      logFn('INFO', `─── Phase 1: Connecting to archive node (${endpoint}) ───`)
      rpc = new ArchiveRPC(endpoint)
      await rpc.connect()
      logFn('OK', 'Archive node connected.')
      patchPhase('connect', { status: 'completed', completed: 1 })
      patchPhase('pools', { status: 'in_progress' })
      syncProgress()
      if (signal.aborted) { dispatch({ type: 'STOP' }); return }

      // ── Phase 2: Fetch pools and discover membership ──────────────────
      logFn('INFO', '─── Phase 2: Fetching nomination pools ───')
      let rawPools
      try {
        rawPools = await enqueueRequest(() => fetchAllPools('', signal, (page, count) => {
          logFn('INFO', `Pools page ${page}: ${count} pool(s) received.`)
        }))
      } catch (e) {
        if (signal.aborted) { dispatch({ type: 'STOP' }); return }
        dispatch({ type: 'ERROR', msg: `Failed to fetch pools: ${e.message}` })
        return
      }
      if (!rawPools?.length) {
        dispatch({ type: 'ERROR', msg: 'No nomination pools found.' })
        return
      }

      const allPools = rawPools
        .filter(p => p?.pool_account?.address)
        .map(p => ({
          poolId:       Number(p.pool_id),
          metadata:     String(p.metadata ?? ''),
          stashAddress: String(p.pool_account.address),
        }))

      logFn('INFO', `Checking sENJ membership in ${allPools.length} pool(s)…`)
      const memberPools = await discoverMemberPools(rpc, allPools, address, logFn, signal)

      if (signal.aborted) { dispatch({ type: 'STOP' }); return }

      if (memberPools.length === 0) {
        logFn('WARN', 'No sENJ balance found in any pool at the current block.')
        logFn('INFO', 'Historical rewards (from pools already exited) are not included in this scan.')
        dispatch({ type: 'DONE', results: [] })
        return
      }

      logFn('OK', `Member of ${memberPools.length} pool(s): ${memberPools.map(p => `#${p.poolId}`).join(', ')}`)
      patchPhase('pools', { status: 'completed', completed: 1 })
      patchPhase('balances', { status: 'in_progress', total: eraRange * memberPools.length })
      syncProgress()

      // ── Phase 3: Query era balances via archive RPC ───────────────────
      logFn('INFO', `─── Phase 3: Querying balances for ${eraRange} era(s) × ${memberPools.length} pool(s) ───`)

      const eraPoolData = []
      let balCompleted = 0

      for (let era = startEra; era <= endEra; era++) {
        if (signal.aborted) { dispatch({ type: 'STOP' }); return }

        const csvRow = eraCache[era]
        let blockHash = csvRow?.startBlockHash ?? null

        if (!blockHash && csvRow?.startBlock) {
          try {
            blockHash = await rpc.call('chain_getBlockHash', [csvRow.startBlock])
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
            memberBalance = decodeU128First(raw)
          } catch (e) {
            logFn('WARN', `Era ${era} Pool #${pool.poolId}: balance error — ${e.message}`)
          }

          let poolSupply = 0n
          if (memberBalance > 0n) {
            try {
              const key = buildTokenKey(COLLECTION_ID, BigInt(pool.poolId))
              const raw = await rpc.call('state_getStorage', [key, blockHash])
              poolSupply = decodeU128First(raw)
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
              startBlock:   csvRow?.startBlock ?? null,
              endBlock:     csvRow?.endBlock   ?? null,
              startDateUtc: csvRow?.startDateUtc ?? null,
            })
            logFn('INFO', `Era ${era} Pool #${pool.poolId}: member ${fmtEnj(memberBalance)} / total ${fmtEnj(poolSupply)} sENJ`)
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

      // ── Phase 4: Fetch reinvested amounts via Subscan ─────────────────
      logFn('INFO', `─── Phase 4: Fetching reinvested amounts for ${eraPoolData.length} era+pool pair(s) ───`)
      const results = []
      const accumulatedByPool = {}

      for (let i = 0; i < eraPoolData.length; i++) {
        if (signal.aborted) { dispatch({ type: 'STOP' }); return }

        const { era, pool, memberBalance, poolSupply, startBlock, endBlock, startDateUtc } = eraPoolData[i]

        const eventStart = (endBlock ?? (startBlock + 14400 - 1)) + 1
        const eventEnd   = eventStart + EVENT_SCAN_LEN
        const blockRange = `${eventStart}-${eventEnd}`

        let reinvested = 0n
        try {
          const rewardList = await enqueueRequest(() =>
            fetchRewardSlash(pool.stashAddress, blockRange, '', signal)
          )
          if (Array.isArray(rewardList)) {
            for (const r of rewardList) {
              try { reinvested += BigInt(String(r?.amount ?? '0').replace(/[^0-9]/g, '') || '0') } catch {}
            }
          }
        } catch (e) {
          if (signal.aborted) { dispatch({ type: 'STOP' }); return }
          logFn('WARN', `Era ${era} Pool #${pool.poolId}: reward fetch failed — ${e.message}`)
        }

        if (reinvested === 0n) {
          logFn('INFO', `Era ${era} Pool #${pool.poolId}: no reward events found in blocks ${blockRange}.`)
          patchPhase('rewards', { completed: i + 1 })
          syncProgress()
          continue
        }

        // reward = (memberBalance × reinvested) / poolSupply
        const reward = (memberBalance * reinvested) / poolSupply

        // APY = ((poolSupply + reinvested) / poolSupply)^365 − 1
        const ratio    = Number(poolSupply + reinvested) / Number(poolSupply)
        const apy      = (Math.pow(ratio, ERAS_PER_YEAR) - 1) * 100

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
