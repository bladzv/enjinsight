import { useReducer, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  fetchAllPools, fetchVoted, fetchEraStat,
  fetchRewardSlash, probeEndpoint, delay,
  resetSubscanRequestCount, readSubscanRequestCount,
} from '../utils/api.js'
import { enqueueRequest } from '../utils/api.js'
import { loadEraCsvRows } from '../utils/eraCache.js'
import { fetchEraBoundariesFromRpc } from '../utils/eraRpc.js'
import { fetchLiveChainInfo } from '../utils/chainInfo.js'
import { computePoolMissedEras } from '../utils/eraAnalysis.js'
import { nowHHMMSS, safeInt, truncateAddress, poolLabel, parseCommission } from '../utils/format.js'
import {
  ERA_VALIDATORS_SAMPLE, API_DELAY_MS, SUBSCAN_MAX_ROW,
  DEFAULT_ERA_COUNT, MIN_ERA_COUNT, MAX_ERA_COUNT, MAX_RETRY_ATTEMPTS,
  MAX_ERA_RPC_TOPUP, POOL_ENDPOINTS_TO_PROBE, ENDPOINTS, ENJIN_NETWORKS,
} from '../constants.js'
import { clampInt, validateWsEndpoint } from '../utils/substrate.js'

// Offline era boundary reference, shipped in public/ and shared with the other
// era-aware tools. Loaded through the same localStorage-cached helper they use.
const RELAY_ERA_CSV = '/relay-era-reference.csv'

// Archive node for the relay chain, taken from the shared network table rather
// than hardcoded so it stays in step with the other era-aware tools.
const RELAY_ARCHIVE_WSS = ENJIN_NETWORKS.find(n => n.key === 'relaychain')?.endpoint ?? ''

// ── State shape ────────────────────────────────────────────────────────────
const initialState = {
  status:  'idle',   // idle | loading | done | stopped | error
  pools:   [],
  logs:    [],
  proxyUrl: '',
  progress: null,
  // Era whose payout window is the era in progress: reported, but its rewards
  // are still landing, so it is never counted as a missed payout.
  provisionalEra: null,
}

// ── Reducer ────────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {
    

    case 'START':
      return {
        ...state,
        status: 'loading',
        pools: [],
        logs: [],
        provisionalEra: null,
        progress: {
          phases: [
            { key: 'probe',      label: 'Check API Endpoints',        total: POOL_ENDPOINTS_TO_PROBE.length, completed: 0, status: 'in_progress' },
            { key: 'list',       label: 'Fetch Pools',                total: 1, completed: 0, status: 'pending' },
            { key: 'validators', label: 'Fetch Nominated Validators', total: 0, completed: 0, status: 'pending' },
            { key: 'ranges',     label: 'Resolve Era Ranges',         total: 1, completed: 0, status: 'pending' },
            { key: 'rewards',    label: 'Confirm Rewards',            total: 0, completed: 0, status: 'pending' },
          ],
        },
      }

      case 'SET_PROXY':
        return { ...state, proxyUrl: action.payload }

    case 'LOG':
      return {
        ...state,
        logs: (() => {
          const next = [...state.logs, { id: Date.now() + Math.random(), ts: nowHHMMSS(), level: action.level, message: action.message }]
          return next.length > 500 ? next.slice(-500) : next
        })(),
      }

    case 'SET_POOLS':
      return { ...state, pools: action.payload }

    case 'SET_PROVISIONAL_ERA':
      return { ...state, provisionalEra: action.payload }

    case 'PATCH_POOL': {
      const pools = state.pools.map(p =>
        p.poolId === action.poolId ? { ...p, ...action.patch } : p
      )
      return { ...state, pools }
    }

    case 'SET_PROGRESS':
      return { ...state, progress: action.payload }

    case 'DONE':
      return { ...state, status: 'done' }

    case 'ERROR':
      return { ...state, status: 'error' }

    case 'STOP':
      return { ...state, status: 'stopped' }

    case 'RESET':
      return { ...initialState, proxyUrl: state.proxyUrl, logs: [] }

    default:
      return state
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build Map<era, {start, end}> from era reference CSV rows.
 *
 * Rows without a complete block range are skipped. That always includes the
 * final row (the era in progress when the file was generated) and means the map
 * only ever contains eras whose boundaries are known exactly — era lengths vary
 * by a few blocks, so end_block cannot be derived from the next era's start.
 */
export function buildEraRangeMap(rows) {
  const map = new Map()
  for (const row of rows ?? []) {
    const era   = safeInt(row?.era)
    const start = safeInt(row?.start_block)
    const end   = safeInt(row?.end_block)
    if (era > 0 && start > 0 && end > 0) map.set(era, { start, end })
  }
  return map
}

/**
 * Choose which eras can actually be reward-checked, given known block ranges.
 *
 * Rewards for era N are paid out *during* era N+1, so era N is only checkable
 * once era N+1's block range is fully closed. The newest closed era is therefore
 * never itself checkable — it is the payout window for the era below it.
 *
 * The search window is bounded to the `eraCount` eras below the newest closed
 * era, so a gap in the reference data reduces the number of eras reported rather
 * than silently widening the window further into the past.
 *
 * `liveEra` is the era currently in progress on chain, and it splits the newest
 * era into its own category. Subscan reports an `end_block_num` for the live era
 * too — the current chain head, not a real era boundary — so a range carrying
 * `partial: true` is known but still filling. The era whose payout window is
 * that partial range is *provisional*: worth reporting, because most payouts
 * land early in the window, but its absence of a reward is not yet evidence of
 * a miss. It is returned at the head of `completedEras` and named separately as
 * `provisionalEra` so callers can label it and exclude it from miss detection.
 *
 * Pass `liveEra` as null when the live era genuinely could not be determined;
 * the function then falls back to closed ranges only, and reports no
 * provisional era.
 *
 * @returns {{maxClosedEra:number, completedEras:number[], skipped:number[],
 *            provisionalEra:number|null}}
 *          completedEras is newest-first; skipped lists in-window eras whose
 *          payout range is unknown.
 */
export function selectCheckableEras(eraRangeMap, eraCount, liveEra = null) {
  // A range is usable as a payout window once its bounds are known; it is
  // *closed* only when those bounds are final.
  const isUsable = r => !!(r && r.start > 0 && r.end > 0)
  const isClosed = r => isUsable(r) && r.partial !== true

  const closed = [...eraRangeMap.entries()]
    .filter(([era, r]) => isClosed(r) && (liveEra == null || era < liveEra))
    .map(([era]) => era)
  if (closed.length === 0) {
    return { maxClosedEra: 0, completedEras: [], skipped: [], provisionalEra: null }
  }

  const maxClosedEra = Math.max(...closed)

  // Era N is provisional when its payout era N+1 is the one in progress.
  let provisionalEra = null
  if (liveEra != null) {
    const livePayout = eraRangeMap.get(liveEra)
    if (isUsable(livePayout) && !isClosed(livePayout)) provisionalEra = liveEra - 1
  }

  const newest = provisionalEra ?? (maxClosedEra - 1)
  const completedEras = []
  const skipped = []
  for (let era = newest; era > 0 && era > newest - eraCount; era--) {
    if (isUsable(eraRangeMap.get(era + 1))) completedEras.push(era)
    else skipped.push(era)
  }
  return { maxClosedEra, completedEras, skipped, provisionalEra }
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function usePoolChecker() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const abortControllerRef = useRef(null)

  // Abort any in-flight scan on unmount. Without this, navigating away mid-scan
  // left the request chain running and dispatching into a dead reducer.
  useEffect(() => () => {
    try { abortControllerRef.current?.abort() } catch { /* noop */ }
    abortControllerRef.current = null
  }, [])

  const log = useCallback((level, message) => {
    dispatch({ type: 'LOG', level, message })
  }, [])

  const setProxy = useCallback((url) => {
    // Proxy configuration removed: prefer same-origin serverless proxy in production.
    // Keep function signature for compatibility but do not persist or accept external proxy URLs.
    const safe = String(url || '').trim()
    if (!safe) {
      dispatch({ type: 'SET_PROXY', payload: '' })
      return true
    }
    // Reject external proxies: instruct users to use the built-in serverless proxy in production.
    return false
  }, [])

  const runCheck = useCallback(async (requestedEraCount) => {
    // See useValidatorChecker.runCheck — the UI bound alone is not enforcement.
    const eraCount = clampInt(Number(requestedEraCount) || DEFAULT_ERA_COUNT, MIN_ERA_COUNT, MAX_ERA_COUNT)
    abortControllerRef.current = new AbortController()
    dispatch({ type: 'START' })
    resetSubscanRequestCount()
    const proxy  = state.proxyUrl
    const signal = abortControllerRef.current.signal
    const runStart = Date.now()
    const phases = [
      { key: 'probe',      label: 'Check API Endpoints',        total: POOL_ENDPOINTS_TO_PROBE.length, completed: 0, status: 'in_progress' },
      { key: 'list',       label: 'Fetch Pools',                total: 1, completed: 0, status: 'pending' },
      { key: 'validators', label: 'Fetch Nominated Validators', total: 0, completed: 0, status: 'pending' },
      { key: 'ranges',     label: 'Resolve Era Ranges',         total: 1, completed: 0, status: 'pending' },
      { key: 'rewards',    label: 'Confirm Rewards',            total: 0, completed: 0, status: 'pending' },
    ]
    const syncProgress = () => {
      dispatch({ type: 'SET_PROGRESS', payload: { phases: phases.map(p => ({ ...p })) } })
    }

    const elapsed = (since = runStart) => ((Date.now() - since) / 1000).toFixed(1)

    // ── Step 0: Probe required API endpoints ──────────────────────────────
    log('INFO', `─── Step 0: Checking ${POOL_ENDPOINTS_TO_PROBE.length} required Subscan API endpoints ───`)
    let probesFailed = false
    for (let i = 0; i < POOL_ENDPOINTS_TO_PROBE.length; i++) {
      if (signal.aborted) return
      const { key, label } = POOL_ENDPOINTS_TO_PROBE[i]
      log('INFO', `[${i + 1}/${POOL_ENDPOINTS_TO_PROBE.length}] Probing: ${label}…`)
      const result = await enqueueRequest(() => probeEndpoint(ENDPOINTS[key], null, signal))
      if (signal.aborted) return
      if (result.ok) {
        log('OK', `[${i + 1}/${POOL_ENDPOINTS_TO_PROBE.length}] ${label}: reachable ✔`)
      } else {
        log('ERR', `[${i + 1}/${POOL_ENDPOINTS_TO_PROBE.length}] ${label}: FAILED — ${result.error}`)
        probesFailed = true
      }
      phases[0] = { ...phases[0], completed: i + 1 }
      syncProgress()
    }
    if (probesFailed) {
      log('ERR', 'One or more required endpoints failed. Check your API key and network connection, then retry.')
      dispatch({ type: 'ERROR' })
      return
    }
    log('OK', 'All endpoints reachable. Proceeding with scan.')
    phases[0] = { ...phases[0], status: 'completed' }
    phases[1] = { ...phases[1], status: 'in_progress' }
    syncProgress()
    if (signal.aborted) return

    log('INFO', '─── Step 1: Fetching nomination pools ───')
    const s1 = Date.now()
    let rawPools
    try {
      rawPools = await fetchAllPools(proxy, signal, (pageNum, count) => {
        log('INFO', `Pools page ${pageNum}: ${count} pool(s) received.`)
      })
    } catch (err) {
      if (signal.aborted) return
      log('ERR', `Failed to fetch pools: ${err?.message || 'unknown error'}. Check your network or proxy and retry.`)
      dispatch({ type: 'ERROR' })
      return
    }

    if (!rawPools?.length) {
      log('WARN', 'Pool list is empty — nothing to scan.')
      dispatch({ type: 'DONE' })
      return
    }

    const pools = rawPools.map(p => ({
      poolId:        safeInt(p?.pool_id),
      metadata:      String(p?.metadata ?? ''),
      state:         String(p?.state ?? 'Unknown'),
      stashAddress:  String(p?.pool_account?.address ?? ''),
      stashDisplay:  String(p?.pool_account?.display ?? ''),
      rewardAddress: String(p?.pool_reward_account?.address ?? ''),
      rewardDisplay: String(p?.pool_reward_account?.display ?? ''),
      memberCount:   safeInt(p?.member_count),
      totalBonded:   BigInt(String(p?.total_bonded ?? '0').replace(/[^0-9]/g, '') || '0'),
      commission:    parseCommission(p?.commission),
      nominatedValidators: null,
      eraRewards:          null,
      missedEras:          [],
      eraValidatorBreakdown: null,
      fetchStatus:         'pending',
    })).filter(p => p.stashAddress.length > 0)

    log('OK', `Found ${pools.length} nomination pool(s). Step 1 completed in ${elapsed(s1)}s.`)
    dispatch({ type: 'SET_POOLS', payload: pools })
    phases[1] = { ...phases[1], completed: 1, status: 'completed' }
    phases[2] = { ...phases[2], total: pools.length, completed: 0, status: 'in_progress' }
    syncProgress()
    if (signal.aborted) return

    log('INFO', `─── Step 2: Fetching nominated validators (${pools.length} pools, sequential, ${API_DELAY_MS}ms between requests) ───`)
    const s2 = Date.now()
    const allCollectedValidators = []
    const poolValidatorsMap = new Map()

    for (let idx = 0; idx < pools.length; idx++) {
      if (signal.aborted) return
      const p = pools[idx]
      dispatch({ type: 'PATCH_POOL', poolId: p.poolId, patch: { fetchStatus: 'loading' } })
      try {
        const list = await fetchVoted(p.stashAddress, proxy, signal)
        const validators = (list ?? []).map(v => ({
          address: String(v?.stash_account_display?.address ?? ''),
          display: String(
            v?.stash_account_display?.parent
              ? `${v.stash_account_display.parent.display || ''}${v.stash_account_display.parent.sub_symbol ? ` / ${v.stash_account_display.parent.sub_symbol}` : ''}`
              : v?.stash_account_display?.display ?? ''
          ),
          bonded: BigInt(String(v?.bonded ?? '0').replace(/[^0-9]/g, '') || '0'),
          isActive: v?.active === true || (typeof v?.active === 'undefined' && String(v?.status ?? '') === ''),
          fetchStatus: 'done',
          retryAttempts: 0,
          lastError: null,
        }))
        dispatch({ type: 'PATCH_POOL', poolId: p.poolId, patch: { nominatedValidators: validators } })
        poolValidatorsMap.set(p.poolId, validators)
        for (const v of validators) {
          if (v.address) allCollectedValidators.push({ address: v.address, display: v.display })
        }
        log('OK', `[${idx + 1}/${pools.length}] ${poolLabel(p)}: ${validators.length} nominated validator(s).`)
      } catch (err) {
        dispatch({ type: 'PATCH_POOL', poolId: p.poolId, patch: { nominatedValidators: [], fetchStatus: 'error' } })
        poolValidatorsMap.set(p.poolId, [])
        log('WARN', `[${idx + 1}/${pools.length}] Voted fetch failed for Pool #${p.poolId}: ${err?.message || 'unknown error'}.`)
      }
      phases[2] = { ...phases[2], completed: idx + 1 }
      syncProgress()
      await delay(API_DELAY_MS)
    }
    phases[2] = { ...phases[2], status: 'completed' }
    phases[3] = { ...phases[3], total: 1, completed: 0, status: 'in_progress' }
    syncProgress()
    if (signal.aborted) return

    const seenAddrs = new Set()
    const uniqueValidators = []
    for (const v of allCollectedValidators) {
      if (!seenAddrs.has(v.address)) {
        seenAddrs.add(v.address)
        uniqueValidators.push(v)
      }
    }
    log('OK', `${allCollectedValidators.length} validator references collected across ${pools.length} pools (${uniqueValidators.length} unique). Step 2 completed in ${elapsed(s2)}s.`)

    log('INFO', '─── Step 3: Resolving era block ranges (era reference + live era + Subscan / RPC top-up) ───')
    const s3 = Date.now()
    if (uniqueValidators.length === 0) {
      log('ERR', 'No nominated validators found — cannot resolve era block ranges.')
      dispatch({ type: 'ERROR' })
      return
    }

    // Primary source: the checked-in era reference CSV. It covers era 1 onwards,
    // is immutable once written, and costs zero Subscan requests — which also
    // means eras older than the free tier's 3-month index still resolve.
    const eraRangeMap = new Map()
    let csvRows = []
    try {
      csvRows = await loadEraCsvRows(RELAY_ERA_CSV)
    } catch (err) {
      log('WARN', `Era reference CSV failed to load: ${err?.message || 'unknown error'}.`)
    }
    if (signal.aborted) return
    for (const [era, range] of buildEraRangeMap(csvRows)) eraRangeMap.set(era, range)
    const csvMaxEra = eraRangeMap.size ? Math.max(...eraRangeMap.keys()) : 0
    if (csvMaxEra > 0) {
      log('OK', `Era reference CSV: ${eraRangeMap.size} era(s) with complete block ranges (newest: era ${csvMaxEra}).`)
    } else {
      log('WARN', 'Era reference CSV unavailable — resolving every era range from Subscan instead.')
    }

    // Observe the live era rather than inferring it. Everything below — which
    // eras are missing, which are checkable, whether the window is honest —
    // is measured against the chain's own answer. The previous code derived it
    // from whatever data happened to arrive, so a stale reference file simply
    // moved the whole window into the past without ever saying so.
    let liveEra = null
    let liveBlock = 0
    try {
      const wss  = validateWsEndpoint(RELAY_ARCHIVE_WSS)
      const info = await fetchLiveChainInfo(wss)
      const observed = safeInt(info?.era)
      liveBlock = safeInt(info?.block)
      if (observed > 0) {
        liveEra = observed
        log('OK', `Live era read from the archive node: ${liveEra}.`)
      } else {
        log('WARN', 'Archive node did not report an active era — falling back to Subscan for the live era.')
      }
    } catch (err) {
      log('WARN', `Could not read the live era from the archive node (${err?.message || 'unknown error'}) — falling back to Subscan.`)
    }
    if (signal.aborted) return

    // An era is usable as a payout window only when its range is closed, and the
    // era currently in progress never is. Rewards for era N land during N+1, so
    // checking the newest `eraCount` eras needs closed ranges for the eras from
    // (live - eraCount) through (live - 1).
    const isRangeComplete = era => {
      const r = eraRangeMap.get(era)
      return !!(r && r.start > 0 && r.end > 0)
    }
    const missingWindowEras = (targetLiveEra) => {
      if (!targetLiveEra) return []
      const out = []
      for (let era = Math.max(1, targetLiveEra - eraCount); era <= targetLiveEra - 1; era++) {
        if (!isRangeComplete(era)) out.push(era)
      }
      return out
    }

    // Top-up 1 (cheap): Subscan era_stat. The CSV is regenerated periodically, so
    // the newest eras are normally absent from it.
    //
    // era_stat is address-scoped — it only covers eras in which that validator
    // was in the active set — so a single sample is not authoritative. Earlier
    // this loop shuffled the candidates and stopped at the first response that
    // did not throw, which meant a validator that had dropped out of the set
    // returned a stale tail, added nothing, and ended the search: the scan then
    // silently reported a window several eras into the past, differently on each
    // run. Now the candidates are taken in a stable order (most-nominated first,
    // as those are the most likely to still be active), results are merged
    // across them, and the loop stops early only once the window is actually
    // covered.
    const refCounts = new Map()
    for (const v of allCollectedValidators) {
      refCounts.set(v.address, (refCounts.get(v.address) ?? 0) + 1)
    }
    const candidates = [...uniqueValidators]
      .sort((a, b) => (refCounts.get(b.address) ?? 0) - (refCounts.get(a.address) ?? 0))
      .slice(0, ERA_VALIDATORS_SAMPLE)

    const topUpRows = csvMaxEra > 0 ? SUBSCAN_MAX_ROW : eraCount + 1
    const staged = new Map()
    let subscanMaxEra = 0
    let subscanReplied = false

    for (const v of candidates) {
      if (signal.aborted) return
      const vLabel = v.display || truncateAddress(v.address)
      try {
        const list = await fetchEraStat(v.address, topUpRows, proxy, signal)
        subscanReplied = true
        for (const e of (list ?? [])) {
          const era   = safeInt(e?.era)
          const start = safeInt(e?.start_block_num)
          const end   = safeInt(e?.end_block_num)
          if (era <= 0) continue
          if (era > subscanMaxEra) subscanMaxEra = era
          if (start > 0 && !staged.has(era)) staged.set(era, { start, end })
        }
        log('OK', `Era stats from ${vLabel}: ${(list ?? []).length} era(s) reported (newest era ${subscanMaxEra || 'unknown'}).`)
      } catch (err) {
        log('WARN', `Era stat lookup failed for ${vLabel}: ${err?.message || 'unknown error'}. Trying next validator…`)
        await delay(API_DELAY_MS)
        continue
      }
      // Stop early only when the staged rows actually close the window.
      const target = liveEra ?? subscanMaxEra
      if (target > 0) {
        const stillShort = missingWindowEras(target)
          .some(era => !staged.has(era) || !(staged.get(era).start > 0 && staged.get(era).end > 0))
        if (!stillShort) break
      }
    }
    if (signal.aborted) return
    if (!subscanReplied) {
      // Previously a WARN. It is not a warning: with no Subscan reply and a
      // reference file that is days old, the scan is about to report a window
      // well into the past as though it were current.
      log('ERR', `Era stat lookup failed for all ${candidates.length} sampled validator(s) — the era window may be well behind the chain. Check the API key and network, then retry.`)
    }

    // Subscan's end_block_num for the live era is the current chain head rather
    // than an era boundary, so that range is recorded as `partial`. It is still
    // worth having: it is the payout window for the era below it, which lets
    // that era be reported as provisional rather than withheld until tomorrow.
    // What it must not do is masquerade as closed — see selectCheckableEras.
    const effectiveLiveEra = liveEra ?? (subscanMaxEra > 0 ? subscanMaxEra : csvMaxEra + 1)
    let added = 0
    let mismatched = 0
    let openAdded = 0
    for (const [era, r] of [...staged.entries()].sort((a, b) => a[0] - b[0])) {
      const known = eraRangeMap.get(era)
      if (known) {
        // The CSV wins on conflict: it is a verified, checked-in artefact.
        if (r.start > 0 && r.end > 0 && (known.start !== r.start || known.end !== r.end)) mismatched++
        continue
      }
      if (!(r.start > 0 && r.end > 0)) continue
      if (era >= effectiveLiveEra) {
        eraRangeMap.set(era, { start: r.start, end: r.end, partial: true })
        openAdded++
      } else {
        eraRangeMap.set(era, { start: r.start, end: r.end })
        added++
      }
    }
    if (added > 0 || openAdded > 0) {
      log('OK', `Subscan top-up: ${added} closed era(s) added${openAdded > 0 ? `, plus the in-progress era ${effectiveLiveEra} as an open payout window` : ''}.`)
    }
    if (mismatched > 0) {
      log('WARN', `${mismatched} era(s) disagree between the era reference CSV and Subscan — keeping the CSV values.`)
    }

    // Top-up 2 (expensive, last resort): binary-search the archive node for any
    // era the reference file and Subscan between them could not supply. Each era
    // costs a search over the chain head, so the gap is capped rather than ground
    // through silently.
    const rpcNeeded = missingWindowEras(liveEra)
    if (rpcNeeded.length > 0 && liveEra) {
      if (rpcNeeded.length > MAX_ERA_RPC_TOPUP) {
        log('WARN', `${rpcNeeded.length} era(s) in the requested window are missing block ranges — beyond the ${MAX_ERA_RPC_TOPUP}-era archive lookup cap. Update ${RELAY_ERA_CSV} to close the gap.`)
      } else {
        log('INFO', `${rpcNeeded.length} era(s) still missing block ranges (${rpcNeeded.join(', ')}) — resolving from the archive node. This takes a moment.`)
        try {
          const wss     = validateWsEndpoint(RELAY_ARCHIVE_WSS)
          const rpcRows = await fetchEraBoundariesFromRpc(wss, rpcNeeded, signal)
          if (signal.aborted) return
          let rpcAdded = 0
          for (const era of rpcNeeded) {
            const row = rpcRows?.[era]
            const start = safeInt(row?.startBlock)
            const end   = safeInt(row?.endBlock)
            if (start > 0 && end > 0) { eraRangeMap.set(era, { start, end }); rpcAdded++ }
          }
          log(rpcAdded === rpcNeeded.length ? 'OK' : 'WARN',
            `Archive node resolved ${rpcAdded}/${rpcNeeded.length} missing era range(s).`)
        } catch (err) {
          if (signal.aborted) return
          log('WARN', `Archive era lookup failed: ${err?.message || 'unknown error'}. Continuing with the ranges already resolved.`)
        }
      }
    }
    if (signal.aborted) return

    // The newest era is reportable only if the open payout window — the live
    // era's range — is known. Subscan normally supplies it above; when it does
    // not, synthesise it from the chain itself: the archive gives the live era's
    // start block and fetchLiveChainInfo already gave us the head it runs to.
    if (liveEra && liveBlock > 0 && !eraRangeMap.has(liveEra)) {
      try {
        const wss  = validateWsEndpoint(RELAY_ARCHIVE_WSS)
        const rows = await fetchEraBoundariesFromRpc(wss, [liveEra], signal)
        if (signal.aborted) return
        const start = safeInt(rows?.[liveEra]?.startBlock)
        if (start > 0 && liveBlock > start) {
          eraRangeMap.set(liveEra, { start, end: liveBlock, partial: true })
          log('OK', `Open payout window for era ${liveEra} resolved from the archive node (blocks ${start}–${liveBlock}).`)
        }
      } catch (err) {
        if (signal.aborted) return
        log('WARN', `Could not resolve the open payout window for era ${liveEra} (${err?.message || 'unknown error'}) — era ${liveEra - 1} will be withheld until it closes.`)
      }
    }
    if (signal.aborted) return

    const { maxClosedEra, completedEras, skipped, provisionalEra } = selectCheckableEras(eraRangeMap, eraCount, liveEra)
    if (maxClosedEra === 0) {
      log('ERR', 'No complete era block ranges available from the era reference CSV, Subscan or the archive node.')
      dispatch({ type: 'ERROR' })
      return
    }
    const currentEra = liveEra ?? Math.max(subscanMaxEra, maxClosedEra + 1)
    if (skipped.length > 0) {
      log('WARN', `${skipped.length} era(s) in the requested window have no known payout block range and were skipped: ${[...skipped].sort((a, b) => a - b).join(', ')}.`)
    }

    // With the open payout window available, the newest reportable era is one
    // below the live era; without it, two. Warn only when the window lags beyond
    // that structural offset — the offset itself is correct behaviour, and
    // reporting it as a problem trained the reader to ignore the message.
    const latestCompletedEra = completedEras[0] ?? 0
    const expectedNewest = currentEra - (provisionalEra != null ? 1 : 2)
    if (latestCompletedEra > 0 && expectedNewest > latestCompletedEra) {
      log('WARN', `Newest reported era is ${latestCompletedEra}, ${expectedNewest - latestCompletedEra} era(s) behind the newest that should be available (${expectedNewest}) — block ranges for the gap could not be resolved.`)
    }
    const erasAscending = [...completedEras].sort((a, b) => a - b).join(', ')
    log('OK', `Era block ranges resolved: live era ${liveEra ?? `${currentEra} (inferred)`}. ${completedEras.length} era(s) to check: ${erasAscending}. Step 3 completed in ${elapsed(s3)}s.`)
    dispatch({ type: 'SET_PROVISIONAL_ERA', payload: provisionalEra })
    if (provisionalEra != null) {
      log('WARN', `Era ${provisionalEra} is PROVISIONAL: its payout window is era ${currentEra}, which is still in progress. Rewards for it are still landing, so a pool showing none yet is not necessarily missing a payout — it is excluded from missed-era detection until era ${currentEra} closes.`)
    }
    phases[3] = { ...phases[3], completed: 1, status: 'completed' }
    phases[4] = { ...phases[4], total: pools.length, completed: 0, status: 'in_progress' }
    syncProgress()
    if (signal.aborted) return

    if (completedEras.length === 0) {
      log('WARN', 'No completed era data available — skipping reward confirmation.')
      dispatch({ type: 'DONE' })
      return
    }

    log('INFO', `─── Step 4: Confirming rewards for ${pools.length} pools × ${completedEras.length} eras (${pools.length * completedEras.length} requests, ${API_DELAY_MS}ms apart) ───`)
    const s4 = Date.now()
    let poolsOk = 0
    let poolsMissed = 0
    let poolsErrored = 0

    for (let idx = 0; idx < pools.length; idx++) {
      if (signal.aborted) return
      const p = pools[idx]
      const label = poolLabel(p)
      log('INFO', `[${idx + 1}/${pools.length}] Checking rewards for ${label} (${completedEras.length} era queries)…`)
      try {
        const allRewards = []
        let eraErrors = 0
        for (let eIdx = 0; eIdx < completedEras.length; eIdx++) {
          if (signal.aborted) break
          const era = completedEras[eIdx]
          // Guaranteed present: completedEras only contains eras whose era+1
          // payout window has a complete block range.
          const payoutRange = eraRangeMap.get(era + 1)
          const { start, end } = payoutRange
          const blockRange = `${start}-${end}`
          try {
            const rewardList = await fetchRewardSlash(p.stashAddress, blockRange, proxy, signal)
            const mapped = (rewardList ?? []).map(r => ({
              era: safeInt(r?.era),
              amount: String(r?.amount ?? '0'),
              blockTimestamp: safeInt(r?.block_timestamp),
              eventIndex: String(r?.event_index ?? ''),
              validatorStash: String(r?.validator_stash ?? ''),
            }))
            allRewards.push(...mapped)
            log('INFO', `  Era ${era} (payout blocks ${start}–${end}): ${mapped.length} reward event(s).`)
          } catch (eraErr) {
            eraErrors++
            log('WARN', `  Era ${era} reward fetch failed: ${eraErr?.message || 'unknown error'}.`)
          }
          if (!signal.aborted) await delay(API_DELAY_MS)
        }
        if (signal.aborted) break

        const poolVals = poolValidatorsMap.get(p.poolId) ?? []
        const eraValidatorBreakdown = buildEraValidatorBreakdown(allRewards, poolVals, completedEras)
        const missedEras = computePoolMissedEras(allRewards, latestCompletedEra, completedEras.length, provisionalEra)
        dispatch({
          type: 'PATCH_POOL',
          poolId: p.poolId,
          patch: { eraRewards: allRewards, missedEras, eraValidatorBreakdown, fetchStatus: 'done' },
        })

        const errNote = eraErrors > 0 ? ` (${eraErrors} era fetch error(s))` : ''
        if (missedEras.length > 0) {
          poolsMissed++
          log('WARN', `[${idx + 1}/${pools.length}] ${label}: ${allRewards.length} reward event(s), ${missedEras.length} missed era(s) — eras ${missedEras.sort((a, b) => a - b).join(', ')}.${errNote}`)
        } else {
          poolsOk++
          log('OK', `[${idx + 1}/${pools.length}] ${label}: ${allRewards.length} reward event(s), all ${completedEras.length} eras rewarded.${errNote}`)
        }
      } catch (err) {
        poolsErrored++
        dispatch({
          type: 'PATCH_POOL',
          poolId: p.poolId,
          patch: { eraRewards: [], missedEras: [], eraValidatorBreakdown: null, fetchStatus: 'error' },
        })
        log('ERR', `[${idx + 1}/${pools.length}] Reward check failed for ${label}: ${err?.message || 'unknown error'}.`)
      }
      phases[4] = { ...phases[4], completed: idx + 1 }
      syncProgress()
    }

    if (signal.aborted) return
    phases[4] = { ...phases[4], status: 'completed' }
    syncProgress()
    log('OK', `Step 4 completed in ${elapsed(s4)}s. Results: ${poolsOk} all-rewarded, ${poolsMissed} with gaps, ${poolsErrored} errors.`)
    log('DONE', `All pool data loaded. Total elapsed: ${elapsed(runStart)}s. Summary generated below. (${readSubscanRequestCount()} Subscan requests used this run.)`)
    dispatch({ type: 'DONE' })
  }, [state.proxyUrl, log])

  const retryPoolValidator = useCallback(async (poolId, address) => {
    if (!poolId || !address) return
    if (!abortControllerRef.current) abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    const pool = state.pools.find(p => p.poolId === poolId)
    if (!pool) return
    const queued = (pool.nominatedValidators || []).map(v =>
      v.address === address ? { ...v, fetchStatus: 'queued', queued: true, retryAttempts: 0, lastError: null } : v
    )
    dispatch({ type: 'PATCH_POOL', poolId, patch: { nominatedValidators: queued } })
    log('INFO', `Manual retry queued for validator ${truncateAddress(address)} in Pool #${poolId}`)

    try {
      const eraStat = await enqueueRequest({
        fn: () => fetchEraStat(address, DEFAULT_ERA_COUNT, state.proxyUrl, {
          signal,
          attempts: MAX_RETRY_ATTEMPTS,
          onRetry: (attempt, errOrStatus, waitMs) => {
            const updated = (pool.nominatedValidators || []).map(v => v.address === address ? { ...v, retryAttempts: attempt } : v)
            dispatch({ type: 'PATCH_POOL', poolId, patch: { nominatedValidators: updated } })
            log('INFO', `Retry ${attempt}/${MAX_RETRY_ATTEMPTS} fetching era stats for ${truncateAddress(address)} in Pool #${poolId} (waiting ${waitMs}ms)`)
          },
        }),
        onStart: () => {
          const started = (pool.nominatedValidators || []).map(v => v.address === address ? { ...v, fetchStatus: 'loading', queued: false } : v)
          dispatch({ type: 'PATCH_POOL', poolId, patch: { nominatedValidators: started } })
          log('INFO', `Dequeued retry for ${truncateAddress(address)} in Pool #${poolId} — starting requests`)
        },
      })
      const updated = (pool.nominatedValidators || []).map(v => v.address === address ? { ...v, eraStat, fetchStatus: 'done' } : v)
      dispatch({ type: 'PATCH_POOL', poolId, patch: { nominatedValidators: updated } })
      log('OK', `Manual retry: era stats fetched for ${truncateAddress(address)} in Pool #${poolId}`)
    } catch (err) {
      const updated = (pool.nominatedValidators || []).map(v => v.address === address ? { ...v, fetchStatus: 'failed', lastError: String(err?.message ?? err) } : v)
      dispatch({ type: 'PATCH_POOL', poolId, patch: { nominatedValidators: updated } })
      log('ERR', `Manual retry failed for ${truncateAddress(address)} in Pool #${poolId} — ${String(err?.message ?? '')}`)
    }
  }, [state.pools, state.proxyUrl, log])

  const reset = useCallback(() => {
    try { abortControllerRef.current?.abort() } catch { /* noop */ }
    abortControllerRef.current = null
    dispatch({ type: 'RESET' })
  }, [])

  const stop = useCallback(() => {
    try { abortControllerRef.current?.abort() } catch { /* noop */ }
    abortControllerRef.current = null
    dispatch({ type: 'STOP' })
    log('WARN', 'Pool scan stopped by user.')
  }, [log])

  // Derive latestEra from pools' eraRewards for enrichment. Previously
  // recomputed on every render regardless of whether state.pools had changed.
  const latestEra = useMemo(() => resolvePoolLatestEra(state.pools), [state.pools])

  return {
    ...state,
    latestEra,
    setProxy,
    runCheck,
    stop,
    reset,
    retryPoolValidator,
  }
}

/**
 * Build a per-era breakdown of which nominated validators sent rewards and
 * which did not for a single pool.
 *
 * Returns Map<era, { rewarded: [{ address, display }], unrewarded: [{ address, display }] }>
 */
function buildEraValidatorBreakdown(eraRewards, nominatedValidators, completedEras) {
  // Group reward events by era → Map of validator_stash -> BigInt(amount) summed
  const rewardsByEra = new Map()
  for (const r of eraRewards) {
    if (r.era <= 0 || !r.validatorStash) continue
    const era = r.era
    const amtStr = String(r.amount ?? '0').replace(/[^0-9]/g, '') || '0'
    let amt
    try { amt = BigInt(amtStr) } catch { amt = 0n }
    if (!rewardsByEra.has(era)) rewardsByEra.set(era, new Map())
    const vm = rewardsByEra.get(era)
    vm.set(r.validatorStash, (vm.get(r.validatorStash) || 0n) + amt)
  }

  const breakdown = new Map()
  for (const era of completedEras) {
    const paidMap = rewardsByEra.get(era) ?? new Map()
    const rewarded   = []
    const unrewarded = []
    for (const v of nominatedValidators) {
      if (!v.address) continue
      const amount = paidMap.get(v.address) || 0n
      const entry = { address: v.address, display: v.display, isActive: !!v.isActive, amount }
      if (amount > 0n) {
        rewarded.push(entry)
      } else {
        unrewarded.push(entry)
      }
    }
    breakdown.set(era, { rewarded, unrewarded })
  }
  return breakdown
}

/**
 * Determine the global latest era from all pools' eraRewards data.
 * @param {Array} pools
 * @returns {number}
 */
function resolvePoolLatestEra(pools) {
  let max = 0
  for (const p of pools) {
    if (!Array.isArray(p.eraRewards)) continue
    for (const r of p.eraRewards) {
      const n = parseInt(String(r.era), 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return max
}
