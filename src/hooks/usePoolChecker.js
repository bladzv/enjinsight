import { useReducer, useCallback, useRef } from 'react'
import {
  fetchAllPools, fetchVoted, fetchEraStat,
  fetchRewardSlash, delay,
} from '../utils/api.js'
import { enqueueRequest } from '../utils/api.js'
import { computePoolMissedEras } from '../utils/eraAnalysis.js'
import { nowHHMMSS, safeInt, truncateAddress, poolLabel, parseCommission } from '../utils/format.js'
import {
  ERA_VALIDATORS_SAMPLE, API_DELAY_MS,
  DEFAULT_ERA_COUNT, MAX_RETRY_ATTEMPTS,
} from '../constants.js'

// ── State shape ────────────────────────────────────────────────────────────
const initialState = {
  status:  'idle',   // idle | loading | done | stopped | error
  pools:   [],
  logs:    [],
  proxyUrl: '',
  progress: null,
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
        progress: {
          phases: [
            { key: 'list', label: 'Fetch Pools', total: 1, completed: 0, status: 'in_progress' },
            { key: 'validators', label: 'Fetch Nominated Validators', total: 0, completed: 0, status: 'pending' },
            { key: 'ranges', label: 'Resolve Era Ranges', total: 1, completed: 0, status: 'pending' },
            { key: 'rewards', label: 'Confirm Rewards', total: 0, completed: 0, status: 'pending' },
          ],
        },
      }

      case 'SET_PROXY':
        return { ...state, proxyUrl: action.payload }

    case 'LOG':
      return {
        ...state,
        logs: [...state.logs, {
          id:      Date.now() + Math.random(),
          ts:      nowHHMMSS(),
          level:   action.level,
          message: action.message,
        }],
      }

    case 'SET_POOLS':
      return { ...state, pools: action.payload }

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

/** Fisher-Yates shuffle (in-place) */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function usePoolChecker() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const abortControllerRef = useRef(null)

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

  const runCheck = useCallback(async (eraCount) => {
    abortControllerRef.current = new AbortController()
    dispatch({ type: 'START' })
    const proxy  = state.proxyUrl
    const signal = abortControllerRef.current.signal
    const runStart = Date.now()
    const phases = [
      { key: 'list', label: 'Fetch Pools', total: 1, completed: 0, status: 'in_progress' },
      { key: 'validators', label: 'Fetch Nominated Validators', total: 0, completed: 0, status: 'pending' },
      { key: 'ranges', label: 'Resolve Era Ranges', total: 1, completed: 0, status: 'pending' },
      { key: 'rewards', label: 'Confirm Rewards', total: 0, completed: 0, status: 'pending' },
    ]
    const syncProgress = () => {
      dispatch({ type: 'SET_PROGRESS', payload: { phases: phases.map(p => ({ ...p })) } })
    }

    const elapsed = (since = runStart) => ((Date.now() - since) / 1000).toFixed(1)

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
    phases[0] = { ...phases[0], completed: 1, status: 'completed' }
    phases[1] = { ...phases[1], total: pools.length, completed: 0, status: 'in_progress' }
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
      phases[1] = { ...phases[1], completed: idx + 1 }
      syncProgress()
      await delay(API_DELAY_MS)
    }
    phases[1] = { ...phases[1], status: 'completed' }
    phases[2] = { ...phases[2], total: 1, completed: 0, status: 'in_progress' }
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

    log('INFO', `─── Step 3: Resolving era block ranges (${ERA_VALIDATORS_SAMPLE}-validator consensus) ───`)
    const s3 = Date.now()
    if (uniqueValidators.length === 0) {
      log('ERR', 'No nominated validators found — cannot resolve era block ranges.')
      dispatch({ type: 'ERROR' })
      return
    }

    const rowsNeeded = eraCount + 1
    let consensusMap = null
    let currentEra = 0
    let usedIdx = 0

    log('INFO', `Requesting ${rowsNeeded} era(s) per validator to identify current + ${eraCount} completed era(s).`)
    shuffle(uniqueValidators)
    const maxRounds = Math.ceil(uniqueValidators.length / ERA_VALIDATORS_SAMPLE)
    for (let round = 0; round < maxRounds && !consensusMap; round++) {
      if (signal.aborted) return
      const sample = uniqueValidators.slice(usedIdx, usedIdx + ERA_VALIDATORS_SAMPLE)
      usedIdx += ERA_VALIDATORS_SAMPLE
      if (sample.length === 0) break

      const eraMaps = []
      log('INFO', `Consensus round ${round + 1}: sampling ${sample.length} validator(s)…`)
      for (const v of sample) {
        if (signal.aborted) return
        const vLabel = v.display || truncateAddress(v.address)
        log('INFO', `Checking era block ranges of validator ${vLabel}…`)
        try {
          const list = await fetchEraStat(v.address, rowsNeeded, proxy, signal)
          const map = new Map()
          for (const e of (list ?? [])) {
            const era = safeInt(e?.era)
            const start = safeInt(e?.start_block_num)
            const end = safeInt(e?.end_block_num)
            if (era > 0) map.set(era, { start, end })
          }
          if (map.size > 0) eraMaps.push(map)
          log('OK', `${vLabel}: ${map.size} era(s) returned.`)
        } catch (err) {
          log('WARN', `Era stat fetch failed for ${vLabel}: ${err?.message || 'unknown error'}. Skipping.`)
        }
        await delay(API_DELAY_MS)
      }

      if (eraMaps.length === 0) continue

      log('INFO', 'Comparing era block ranges...')
      const refMap = eraMaps[0]
      let mismatch = false
      for (const [era, ref] of refMap) {
        for (let m = 1; m < eraMaps.length; m++) {
          const other = eraMaps[m].get(era)
          if (other && (other.start !== ref.start || other.end !== ref.end)) {
            mismatch = true
            log('WARN', `Block range mismatch at era ${era}. Trying next validator set…`)
            break
          }
        }
        if (mismatch) break
      }

      if (!mismatch) {
        consensusMap = refMap
        log('OK', `Consensus achieved with ${eraMaps.length} validator(s) — ${refMap.size} era(s) mapped.`)
      }
    }

    if (!consensusMap || consensusMap.size === 0) {
      log('ERR', `Failed to establish era block range consensus after ${usedIdx} validator(s) tried.`)
      dispatch({ type: 'ERROR' })
      return
    }

    currentEra = Math.max(...consensusMap.keys())
    const currentEraRange = consensusMap.get(currentEra)
    consensusMap.delete(currentEra)

    const completedEras = [...consensusMap.keys()].sort((a, b) => b - a).slice(0, eraCount)
    const completedEraSet = new Set(completedEras)
    for (const era of consensusMap.keys()) {
      if (!completedEraSet.has(era)) consensusMap.delete(era)
    }

    const latestCompletedEra = completedEras[0] ?? 0
    const erasAscending = [...completedEras].sort((a, b) => a - b).join(', ')
    log('OK', `Era block ranges resolved: current era ${currentEra} (excluded), ${completedEras.length} completed era(s): ${erasAscending}. Step 3 completed in ${elapsed(s3)}s.`)
    phases[2] = { ...phases[2], completed: 1, status: 'completed' }
    phases[3] = { ...phases[3], total: pools.length, completed: 0, status: 'in_progress' }
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
          const payoutRange = consensusMap.get(era + 1) ?? currentEraRange
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
        const missedEras = computePoolMissedEras(allRewards, latestCompletedEra, completedEras.length)
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
      phases[3] = { ...phases[3], completed: idx + 1 }
      syncProgress()
    }

    if (signal.aborted) return
    phases[3] = { ...phases[3], status: 'completed' }
    syncProgress()
    log('OK', `Step 4 completed in ${elapsed(s4)}s. Results: ${poolsOk} all-rewarded, ${poolsMissed} with gaps, ${poolsErrored} errors.`)
    log('DONE', `All pool data loaded. Total elapsed: ${elapsed(runStart)}s. Summary generated below.`)
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

  // Derive latestEra from pools' eraRewards for enrichment
  const latestEra = resolvePoolLatestEra(state.pools)

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
  // Group reward events by era → Set of validator_stash addresses that paid
  const rewardsByEra = new Map()
  for (const r of eraRewards) {
    if (r.era <= 0 || !r.validatorStash) continue
    if (!rewardsByEra.has(r.era)) rewardsByEra.set(r.era, new Set())
    rewardsByEra.get(r.era).add(r.validatorStash)
  }

  const breakdown = new Map()
  for (const era of completedEras) {
    const paid = rewardsByEra.get(era) ?? new Set()
    const rewarded   = []
    const unrewarded = []
    for (const v of nominatedValidators) {
      if (!v.address) continue
      const entry = { address: v.address, display: v.display, isActive: !!v.isActive }
      if (paid.has(v.address)) {
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
