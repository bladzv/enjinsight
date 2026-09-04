import { useReducer, useCallback, useRef, useEffect, useMemo } from 'react'
import {
  fetchValidators, fetchNominators, fetchEraStat, probeEndpoint, delay,
  resetSubscanRequestCount, readSubscanRequestCount,
} from '../utils/api.js'
import { computeMissedEras, resolveLatestEra } from '../utils/eraAnalysis.js'
import { nowHHMMSS, safeInt, parseCommission } from '../utils/format.js'
import { API_DELAY_MS, MAX_RETRY_ATTEMPTS, DEFAULT_ERA_COUNT, MIN_ERA_COUNT, MAX_ERA_COUNT, VALIDATOR_ENDPOINTS_TO_PROBE, ENDPOINTS } from '../constants.js'
import { clampInt } from '../utils/substrate.js'
import { truncateAddress } from '../utils/format.js'
import { enqueueRequest } from '../utils/api.js'

// ── State shape ────────────────────────────────────────────────────────────
const initialState = {
  status:     'idle',   // idle | loading | done | stopped | error
  validators: [],
  logs:       [],
  proxyUrl:   '',
  progress:   null,
  // The N the user asked for. Pinned here at START so missed-era detection
  // measures against the requested window rather than against whatever
  // happens to have loaded — see enrichValidators.
  requestedEraCount: 0,
  // 'scan' for data this session fetched, 'import' for data read from a file.
  // Consumers hide the export panel for imported data and show its provenance.
  dataSource: 'scan',
  // { fileName, exportedAt } for an imported scan, else null.
  importMeta: null,
}

/**
 * A completed-looking progress object for an imported scan.
 *
 * The phase cards render from `progress`, so an import that left it null would
 * show the scan as never having run, and one that left a live scan's progress
 * in place would show the wrong totals.
 */
function importedProgress(validatorCount) {
  return {
    phases: [
      { key: 'probe',      label: 'Check API Endpoints', total: VALIDATOR_ENDPOINTS_TO_PROBE.length, completed: VALIDATOR_ENDPOINTS_TO_PROBE.length, status: 'completed' },
      { key: 'list',       label: 'Fetch Validators',    total: 1, completed: 1, status: 'completed' },
      { key: 'nominators', label: 'Fetch Nominators',    total: validatorCount, completed: validatorCount, status: 'completed' },
      { key: 'eras',       label: 'Fetch Era Stats',     total: validatorCount, completed: validatorCount, status: 'completed' },
    ],
  }
}

/** One log entry, in the shape the LOG action builds. */
function logEntry(level, message) {
  return { id: Date.now() + Math.random(), ts: nowHHMMSS(), level, message }
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
        requestedEraCount: action.requestedEraCount ?? 0,
        // A fresh scan replaces imported data; its provenance must not linger.
        dataSource: 'scan',
        importMeta: null,
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
        logs: (() => {
          return [...state.logs, { id: Date.now() + Math.random(), ts: nowHHMMSS(), level: action.level, message: action.message }]
        })(),
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

    /**
     * Load a scan read from a file, in one dispatch.
     *
     * Deliberately not SET_VALIDATORS followed by DONE: `enrichValidators` runs
     * on every render and recomputes each validator's missed-era list from
     * `requestedEraCount`. Two dispatches would produce an intermediate render
     * holding the new validators against the *old* count, so the summary would
     * briefly show wrong gap counts — and if the import failed between them,
     * would keep showing them.
     */
    case 'IMPORT':
      return {
        ...state,
        status: 'done',
        validators: action.validators,
        requestedEraCount: action.requestedEraCount,
        dataSource: 'import',
        importMeta: action.importMeta,
        progress: importedProgress(action.validators.length),
        // The source file's own log is not restored — replaying it would read as
        // though these requests had just happened. One line of provenance instead.
        logs: [logEntry('INFO', action.logMessage)],
      }

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
    const safe = String(url || '').trim()
    if (!safe) {
      dispatch({ type: 'SET_PROXY', payload: '' })
      return true
    }
    // Reject external proxies: instruct users to use the built-in serverless proxy in production.
    return false
  }, [])

  const runCheck = useCallback(async (requestedEraCount) => {
    // Re-clamp here, not just in ControlPanel: the UI bound is advisory to any
    // programmatic caller, and an unbounded eraCount walks Subscan pages until
    // the request quota is gone.
    // `|| DEFAULT_ERA_COUNT` keeps clampInt from throwing on a missing/NaN arg.
    const eraCount = clampInt(Number(requestedEraCount) || DEFAULT_ERA_COUNT, MIN_ERA_COUNT, MAX_ERA_COUNT)
    // create a fresh controller for this run
    abortControllerRef.current = new AbortController()
    dispatch({ type: 'START', requestedEraCount: eraCount })
    resetSubscanRequestCount()
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
    } catch {
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
    log('DONE', `All data loaded. Summary generated below. (${readSubscanRequestCount()} Subscan requests used this run.)`)
    dispatch({ type: 'DONE' })
  }, [state.proxyUrl, log])

  const reset = useCallback(() => {
    // cancel in-flight requests
    try { abortControllerRef.current?.abort() } catch { /* noop */ }
    abortControllerRef.current = null
    dispatch({ type: 'RESET' })
  }, [])

  /**
   * Load a scan parsed by `importValidatorScan`.
   *
   * Parsing stays with the caller: it is the one that has the file, and it has
   * to catch ScanImportError to show a message anyway. This only takes the
   * already-validated result.
   *
   * Aborts any in-flight scan first — otherwise a scan still running would keep
   * dispatching PATCH_VALIDATOR over the imported rows.
   */
  const importScan = useCallback((parsed, fileName = '') => {
    try { abortControllerRef.current?.abort() } catch { /* noop */ }
    abortControllerRef.current = null
    const { validators = [], requestedEraCount = 0, exportedAt = '', appVersion = null } = parsed ?? {}
    const from = fileName ? ` from ${fileName}` : ''
    const when = exportedAt ? `, exported ${exportedAt}` : ''
    dispatch({
      type: 'IMPORT',
      validators,
      requestedEraCount,
      importMeta: { fileName, exportedAt, appVersion },
      logMessage: `Imported ${validators.length} validator(s)${from}${when}. This is file data — nothing was fetched.`,
    })
  }, [])

  const stop = useCallback(() => {
    try { abortControllerRef.current?.abort() } catch { /* noop */ }
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

  // Derive latestEra and missedEras after loading. Previously recomputed on
  // every render of this hook's consumer — including every appended log line —
  // regardless of whether state.validators had actually changed.
  const enrichedValidators = useMemo(() => (
    state.status === 'done' || state.status === 'loading'
      ? enrichValidators(state.validators, state.requestedEraCount)
      : state.validators
  ), [state.status, state.validators, state.requestedEraCount])

  return {
    ...state,
    validators: enrichedValidators,
    setProxy,
    runCheck,
    stop,
    reset,
    importScan,
    retryValidator,
  }
}

// ── Enrichment (pure) ──────────────────────────────────────────────────────
/**
 * Attach each validator's missed-era list.
 *
 * `requestedEraCount` is the N the user asked to scan, pinned in state at
 * START. It must come from the request rather than from the loaded data,
 * because the window being measured against is "the last N eras" — a fact
 * about the request, not about the response.
 *
 * Deriving it from the responses instead (the previous
 * `Math.max(...eraStat.length)`) under-reports whenever no validator returned
 * a full N eras: the expected window shrinks to fit the data, so eras that
 * every validator missed fall outside it and are silently not counted as
 * missed. That is wrong for a completed scan, and during a live scan it also
 * makes each validator's gap list grow as later validators widen the window.
 *
 * `latestEra` stays a running max over loaded data. It is a lower bound while
 * a scan is in flight — a validator that missed the newest era can hold it
 * down until one that didn't arrives — which is why the summary is labelled
 * provisional until the scan completes.
 */
export function enrichValidators(validators, requestedEraCount) {
  if (!validators.length) return validators
  const latestEra = resolveLatestEra(validators)
  if (!latestEra) return validators
  // Hoisted out of the per-validator map below: this value does not depend on
  // which validator is being enriched, so it was previously recomputed once
  // per validator instead of once per call — O(n^2) for no reason.
  const eraCount = requestedEraCount > 0
    ? requestedEraCount
    : Math.max(...validators
        .filter(x => x.eraStat?.length)
        .map(x => x.eraStat.length), 1)
  return validators.map(v => {
    if (!Array.isArray(v.eraStat) || !v.eraStat.length) return v
    const missedEras = computeMissedEras(v.eraStat, latestEra, eraCount)
    return { ...v, missedEras }
  })
}
