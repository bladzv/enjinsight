import { useReducer, useCallback, useRef } from 'react'
import {
  fetchValidators, fetchNominators, fetchEraStat, probeEndpoint, delay,
} from '../utils/api.js'
import { computeMissedEras, resolveLatestEra } from '../utils/eraAnalysis.js'
import { nowHHMMSS, safeInt, parseCommission } from '../utils/format.js'
import { API_DELAY_MS, MAX_RETRY_ATTEMPTS, DEFAULT_ERA_COUNT, VALIDATOR_ENDPOINTS_TO_PROBE, ENDPOINTS } from '../constants.js'
import { truncateAddress } from '../utils/format.js'
import { enqueueRequest } from '../utils/api.js'

// ── State shape ────────────────────────────────────────────────────────────
const initialState = {
  status:     'idle',   // idle | loading | done | stopped | error
  validators: [],
  logs:       [],
  proxyUrl:   '',
  progress:   null,
}

// ── Reducer ────────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {
    case 'SET_PROXY':
      return { ...state, proxyUrl: action.payload }

    case 'START':
      return {
        ...state,
        status: 'loading',
        validators: [],
        logs: [],
        progress: {
          phases: [
            { key: 'probe',      label: 'Check API Endpoints', total: VALIDATOR_ENDPOINTS_TO_PROBE.length, completed: 0, status: 'in_progress' },
            { key: 'list',       label: 'Fetch Validators',    total: 1, completed: 0, status: 'pending' },
            { key: 'nominators', label: 'Fetch Nominators',    total: 0, completed: 0, status: 'pending' },
            { key: 'eras',       label: 'Fetch Era Stats',     total: 0, completed: 0, status: 'pending' },
          ],
        },
      }

    case 'LOG':
      return {
        ...state,
        logs: [...state.logs, {
          id:        Date.now() + Math.random(),
          ts:        nowHHMMSS(),
          level:     action.level,
          message:   action.message,
        }],
      }

    case 'SET_VALIDATORS':
      return { ...state, validators: action.payload }

    case 'PATCH_VALIDATOR': {
      const validators = state.validators.map(v =>
        v.address === action.address ? { ...v, ...action.patch } : v
      )
      return { ...state, validators }
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

// helper utilities exported for testing

// parseCommission is now in format.js — re-export for test backward compat
export { parseCommission } from '../utils/format.js'

export function determineActive(v) {
  const raw = v?.status ?? v?.is_active ?? v?.active ?? ''
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw === 1
  if (typeof raw === 'string' && raw.trim() !== '') {
    const s = raw.toLowerCase().trim()
    if (s === 'active' || s === 'validating' || s === 'validator') return true
    if (s === 'inactive' || s === 'disabled' || s === 'chilled') return false
    if (s === '1') return true
    if (s === '0') return false
  }
  try {
    const rank = safeInt(v?.rank_validator)
    if (rank > 0) return true
  } catch {}
  try {
    const mining = safeInt(v?.latest_mining)
    if (mining > 0) return true
  } catch {}
  return false
}

// ── Hook ───────────────────────────────────────────────────────────────────
export function useValidatorChecker() {
  const [state, dispatch] = useReducer(reducer, initialState)
  // Hold an AbortController to cancel in-flight requests when user resets
  const abortControllerRef = useRef(null)

  const log = useCallback((level, message) => {
    dispatch({ type: 'LOG', level, message })
  }, [])

  const setProxy = useCallback((url) => {
    // Proxy configuration removed: prefer same-origin serverless proxy in production.
    const safe = String(url || '').trim()
    if (!safe) {
      dispatch({ type: 'SET_PROXY', payload: '' })
      return true
    }
    // Reject external proxies: instruct users to use the built-in serverless proxy in production.
    return false
  }, [])

  const runCheck = useCallback(async (eraCount) => {
    // create a fresh controller for this run
    abortControllerRef.current = new AbortController()
    dispatch({ type: 'START' })
    const proxy = state.proxyUrl
    const signal = abortControllerRef.current.signal
    const phases = [
      { key: 'probe',      label: 'Check API Endpoints', total: VALIDATOR_ENDPOINTS_TO_PROBE.length, completed: 0, status: 'in_progress' },
      { key: 'list',       label: 'Fetch Validators',    total: 1, completed: 0, status: 'pending' },
      { key: 'nominators', label: 'Fetch Nominators',    total: 0, completed: 0, status: 'pending' },
      { key: 'eras',       label: 'Fetch Era Stats',     total: 0, completed: 0, status: 'pending' },
    ]
    const syncProgress = () => {
      dispatch({ type: 'SET_PROGRESS', payload: { phases: phases.map(p => ({ ...p })) } })
    }

    // ── Step 0: Probe required API endpoints ───────────────────────────────
    log('INFO', `─── Step 0: Checking ${VALIDATOR_ENDPOINTS_TO_PROBE.length} required Subscan API endpoints ───`)
    let probesFailed = false
    for (let i = 0; i < VALIDATOR_ENDPOINTS_TO_PROBE.length; i++) {
      if (signal.aborted) return
      const { key, label } = VALIDATOR_ENDPOINTS_TO_PROBE[i]
      log('INFO', `[${i + 1}/${VALIDATOR_ENDPOINTS_TO_PROBE.length}] Probing: ${label}…`)
      const result = await enqueueRequest(() => probeEndpoint(ENDPOINTS[key], null, signal))
      if (signal.aborted) return
      if (result.ok) {
        log('OK', `[${i + 1}/${VALIDATOR_ENDPOINTS_TO_PROBE.length}] ${label}: reachable ✔`)
      } else {
        log('ERR', `[${i + 1}/${VALIDATOR_ENDPOINTS_TO_PROBE.length}] ${label}: FAILED — ${result.error}`)
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

    // ── Step 1: Validator list ──────────────────────────────────────────
    log('INFO', 'Fetching validator list from Subscan…')
    let rawValidators
    try {
      rawValidators = await fetchValidators(proxy, signal)
    } catch (err) {
      if (signal.aborted) return
      // Generic user-facing error (avoid exposing upstream details)
      log('ERR', 'Failed to fetch validators — please check your network or proxy and retry.')
      dispatch({ type: 'ERROR' })
      return
    }

    if (!rawValidators?.length) {
      log('WARN', 'Validator list is empty.')
      dispatch({ type: 'DONE' })
      return
    }

    // Map to our internal shape — extract only what we need (data minimisation)
    const validators = rawValidators.map(v => ({
      // Accept multiple possible field names returned by Subscan (defensive mapping)
      address:       String(
        v?.stash_account_display?.address
        ?? v?.controller_account_display?.address
        ?? v?.account_display?.address
        ?? v?.stash_account?.address
        ?? v?.controller_account?.address
        ?? v?.stash
        ?? v?.controller
        ?? ''
      ),
      display:       String(
        v?.stash_account_display?.display
        ?? v?.controller_account_display?.display
        ?? v?.account_display?.display
        ?? v?.name
        ?? ''
      ),
      // Commission comes from Substrate prefs stored in parts-per-billion.
      // API returns `validator_prefs_value` (e.g. 50_000_000 for 5%).
      // Convert to percentage with two decimal places.
      commission: parseCommission(v?.validator_prefs_value),
      bondedTotal:   BigInt(String(v?.bonded_total ?? '0').replace(/[^0-9]/g, '') || '0'),
      countNominators: safeInt(v?.count_nominators),
      // Determine active status defensively: Subscan may return strings, booleans, or numeric codes.
      isActive: determineActive(v),
      nominators:    null,
      eraStat:       null,
      missedEras:    [],
      fetchStatus:   'pending',
    })).filter(v => v.address.length > 0)

    log('OK', `Found ${validators.length} validators.`)
    dispatch({ type: 'SET_VALIDATORS', payload: validators })
    phases[1] = { ...phases[1], completed: 1, status: 'completed' }
    phases[2] = { ...phases[2], total: validators.length, completed: 0, status: 'in_progress' }
    syncProgress()

    if (signal.aborted) return

    // ── Step 2: Nominators (sequential, 1 req/s) ────────────────────────
    log('INFO', `Fetching nominators for ${validators.length} validators (sequential, ${API_DELAY_MS}ms between requests)…`)

    for (let idx = 0; idx < validators.length; idx++) {
      if (signal.aborted) return
      const v = validators[idx]
      dispatch({ type: 'PATCH_VALIDATOR', address: v.address, patch: { fetchStatus: 'loading', retryAttempts: 0, lastError: null } })
      try {
        const list = await fetchNominators(v.address, proxy, {
          signal,
          attempts: MAX_RETRY_ATTEMPTS,
          onRetry: (attempt, errOrStatus, waitMs) => {
            dispatch({ type: 'PATCH_VALIDATOR', address: v.address, patch: { retryAttempts: attempt } })
            log('INFO', `Retry ${attempt}/${MAX_RETRY_ATTEMPTS} fetching nominators for ${truncateAddress(v.address)} (waiting ${waitMs}ms)`)
          },
        })
        const nominators = (list ?? []).map(n => ({
          address: String(n?.account_display?.address ?? ''),
          display: String(n?.account_display?.display ?? ''),
          bonded:  BigInt(String(n?.bonded ?? '0').replace(/[^0-9]/g, '') || '0'),
        }))
        dispatch({ type: 'PATCH_VALIDATOR', address: v.address, patch: { nominators } })
        log('OK', `[${idx + 1}/${validators.length}] ${v.display || v.address.slice(0, 10)}: ${nominators.length} nominator(s).`)
      } catch (err) {
        if (signal.aborted) return
        dispatch({ type: 'PATCH_VALIDATOR', address: v.address, patch: { nominators: [], fetchStatus: 'failed', lastError: String(err?.message ?? err) } })
        log('WARN', `[${idx + 1}/${validators.length}] Nominators failed for ${truncateAddress(v.address)} — ${String(err?.message ?? '')}`)
      }
      phases[2] = { ...phases[2], completed: idx + 1 }
      syncProgress()
      await delay(API_DELAY_MS)
      if (signal.aborted) return
    }
    phases[2] = { ...phases[2], status: 'completed' }
    phases[3] = { ...phases[3], total: validators.length, completed: 0, status: 'in_progress' }
    syncProgress()
    if (signal.aborted) return

    // ── Step 3: Era stats (sequential, 1 req/s) ─────────────────────────
    log('INFO', `Fetching era stats (last ${eraCount} eras) for ${validators.length} validators (sequential, ${API_DELAY_MS}ms between requests)…`)

    for (let idx = 0; idx < validators.length; idx++) {
      if (signal.aborted) return
      const v = validators[idx]
      try {
        const list = await fetchEraStat(v.address, eraCount, proxy, {
          signal,
          attempts: MAX_RETRY_ATTEMPTS,
          onRetry: (attempt, errOrStatus, waitMs) => {
            dispatch({ type: 'PATCH_VALIDATOR', address: v.address, patch: { retryAttempts: attempt } })
            log('INFO', `Retry ${attempt}/${MAX_RETRY_ATTEMPTS} fetching era stats for ${truncateAddress(v.address)} (waiting ${waitMs}ms)`)
          },
        })
        const eraStat = (list ?? []).map(e => {
          const countUniqueBlocks = raw => {
            if (!raw) return 0
            if (Array.isArray(raw)) return new Set(raw.map(String)).size
            if (typeof raw === 'string') {
              const parts = raw.split(/,|\s+/).map(s => s.trim()).filter(Boolean)
              return new Set(parts).size
            }
            return 0
          }

          return {
            era:            safeInt(e?.era),
            reward:         BigInt(String(e?.validator_reward_total ?? e?.reward ?? '0').replace(/[^0-9]/g, '') || '0'),
            validatorStake: BigInt(String(e?.validator_stash_amount ?? '0').replace(/[^0-9]/g, '') || '0'),
            nominatorStake: BigInt(String(e?.nominator_stash_amount ?? '0').replace(/[^0-9]/g, '') || '0'),
            startBlock:     safeInt(e?.start_block_num),
            endBlock:       safeInt(e?.end_block_num),
            rewardPoint:    safeInt(e?.reward_point),
            blocksProduced: countUniqueBlocks(e?.block_produced),
          }
        })
        const latestInBatch = eraStat.reduce((m, e) => Math.max(m, e.era), 0)
        dispatch({ type: 'PATCH_VALIDATOR', address: v.address, patch: { eraStat, fetchStatus: 'done' } })
        log('OK', `[${idx + 1}/${validators.length}] ${v.display || v.address.slice(0, 10)}: era stat done (latest era: ${latestInBatch}).`)
      } catch (err) {
        if (signal.aborted) return
        dispatch({ type: 'PATCH_VALIDATOR', address: v.address, patch: { eraStat: [], fetchStatus: 'failed', lastError: String(err?.message ?? err) } })
        log('ERR', `[${idx + 1}/${validators.length}] Era stat failed for ${truncateAddress(v.address)} — ${String(err?.message ?? '')}`)
      }
      phases[3] = { ...phases[3], completed: idx + 1 }
      syncProgress()
      await delay(API_DELAY_MS)
      if (signal.aborted) return
    }
    if (signal.aborted) return

    phases[3] = { ...phases[3], status: 'completed' }
    syncProgress()
    log('DONE', 'All data loaded. Summary generated below.')
    dispatch({ type: 'DONE' })
  }, [state.proxyUrl, log])

  const reset = useCallback(() => {
    // cancel in-flight requests
    try { abortControllerRef.current?.abort() } catch (e) { /* noop */ }
    abortControllerRef.current = null
    dispatch({ type: 'RESET' })
  }, [])

  const stop = useCallback(() => {
    try { abortControllerRef.current?.abort() } catch (e) { /* noop */ }
    abortControllerRef.current = null
    dispatch({ type: 'STOP' })
    log('WARN', 'Scan stopped by user.')
  }, [log])

  const retryValidator = useCallback(async (address) => {
    if (!address) return
    // ensure we have an AbortController for this action
    if (!abortControllerRef.current) abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal
    dispatch({ type: 'PATCH_VALIDATOR', address, patch: { fetchStatus: 'queued', queued: true, retryAttempts: 0, lastError: null } })
    log('INFO', `Manual retry queued for ${truncateAddress(address)}`)

    try {
      const nominators = await enqueueRequest({
        fn: () => fetchNominators(address, state.proxyUrl, {
          signal,
          attempts: MAX_RETRY_ATTEMPTS,
          onRetry: (attempt, errOrStatus, waitMs) => {
            dispatch({ type: 'PATCH_VALIDATOR', address, patch: { retryAttempts: attempt } })
            log('INFO', `Retry ${attempt}/${MAX_RETRY_ATTEMPTS} fetching nominators for ${truncateAddress(address)} (waiting ${waitMs}ms)`)
          },
        }),
        onStart: () => {
          dispatch({ type: 'PATCH_VALIDATOR', address, patch: { fetchStatus: 'loading', queued: false } })
          log('INFO', `Dequeued retry for ${truncateAddress(address)} — starting requests`)        
        },
      })
      dispatch({ type: 'PATCH_VALIDATOR', address, patch: { nominators } })
      log('OK', `Manual retry: nominators fetched for ${truncateAddress(address)}`)
    } catch (err) {
      dispatch({ type: 'PATCH_VALIDATOR', address, patch: { nominators: [], fetchStatus: 'failed', lastError: String(err?.message ?? err) } })
      log('ERR', `Manual retry nominators failed for ${truncateAddress(address)} — ${String(err?.message ?? '')}`)
      return
    }

    try {
      const eraStat = await enqueueRequest({
        fn: () => fetchEraStat(address, /* row */ DEFAULT_ERA_COUNT, state.proxyUrl, {
          signal,
          attempts: MAX_RETRY_ATTEMPTS,
          onRetry: (attempt, errOrStatus, waitMs) => {
            dispatch({ type: 'PATCH_VALIDATOR', address, patch: { retryAttempts: attempt } })
            log('INFO', `Retry ${attempt}/${MAX_RETRY_ATTEMPTS} fetching era stats for ${truncateAddress(address)} (waiting ${waitMs}ms)`)
          },
        }),
        onStart: () => {
          dispatch({ type: 'PATCH_VALIDATOR', address, patch: { fetchStatus: 'loading', queued: false } })
        },
      })
      dispatch({ type: 'PATCH_VALIDATOR', address, patch: { eraStat, fetchStatus: 'done' } })
      log('OK', `Manual retry: era stats fetched for ${truncateAddress(address)}`)
    } catch (err) {
      dispatch({ type: 'PATCH_VALIDATOR', address, patch: { eraStat: [], fetchStatus: 'failed', lastError: String(err?.message ?? err) } })
      log('ERR', `Manual retry era stats failed for ${truncateAddress(address)} — ${String(err?.message ?? '')}`)
    }
  }, [state.proxyUrl, log])

  // Derive latestEra and missedEras after loading
  const enrichedValidators = state.status === 'done' || state.status === 'loading'
    ? enrichValidators(state.validators)
    : state.validators

  return {
    ...state,
    validators: enrichedValidators,
    setProxy,
    runCheck,
    stop,
    reset,
    retryValidator,
  }
}

// ── Enrichment (pure) ──────────────────────────────────────────────────────
function enrichValidators(validators) {
  if (!validators.length) return validators
  const latestEra = resolveLatestEra(validators)
  if (!latestEra) return validators
  return validators.map(v => {
    if (!Array.isArray(v.eraStat) || !v.eraStat.length) return v
    // Use the max era across all validators as the reference point
    const eraCount = Math.max(...validators
      .filter(x => x.eraStat?.length)
      .map(x => x.eraStat.length), 1)
    const missedEras = computeMissedEras(v.eraStat, latestEra, eraCount)
    return { ...v, missedEras }
  })
}
