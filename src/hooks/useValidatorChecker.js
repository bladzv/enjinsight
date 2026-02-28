import { useReducer, useCallback, useRef } from 'react'
import {
  fetchValidators, fetchNominators, fetchEraStat, delay,
} from '../utils/api.js'
import { computeMissedEras, resolveLatestEra } from '../utils/eraAnalysis.js'
import { nowHHMMSS, safeInt, parseCommission } from '../utils/format.js'
import { PROXY_STORAGE_KEY, API_DELAY_MS } from '../constants.js'

// ── State shape ────────────────────────────────────────────────────────────
const initialState = {
  status:     'idle',   // idle | loading | done | error
  validators: [],
  logs:       [],
  proxyUrl:   typeof localStorage !== 'undefined'
                ? localStorage.getItem(PROXY_STORAGE_KEY) ?? ''
                : '',
}

// ── Reducer ────────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {
    case 'SET_PROXY':
      return { ...state, proxyUrl: action.payload }

    case 'START':
      return { ...state, status: 'loading', validators: [], logs: [] }

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

    case 'DONE':
      return { ...state, status: 'done' }

    case 'ERROR':
      return { ...state, status: 'error' }

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
    const safe = String(url || '').trim()
    // Only store if it looks like a valid HTTPS URL or is blank
    try {
      if (safe) new URL(safe) // throws if invalid
    } catch {
      return false
    }
    localStorage.setItem(PROXY_STORAGE_KEY, safe)
    dispatch({ type: 'SET_PROXY', payload: safe })
    return true
  }, [])

  const runCheck = useCallback(async (eraCount) => {
    // create a fresh controller for this run
    abortControllerRef.current = new AbortController()
    dispatch({ type: 'START' })
    const proxy = state.proxyUrl

    // ── Step 1: Validator list ──────────────────────────────────────────
    log('INFO', 'Fetching validator list from Subscan…')
    let rawValidators
    try {
      rawValidators = await fetchValidators(proxy, abortControllerRef.current.signal)
    } catch (err) {
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

    if (abortControllerRef.current?.signal.aborted) return

    // ── Step 2: Nominators (sequential, 1 req/s) ────────────────────────
    log('INFO', `Fetching nominators for ${validators.length} validators (sequential, ${API_DELAY_MS}ms between requests)…`)

    for (let idx = 0; idx < validators.length; idx++) {
      if (abortControllerRef.current?.signal.aborted) return
      const v = validators[idx]
      dispatch({ type: 'PATCH_VALIDATOR', address: v.address, patch: { fetchStatus: 'loading' } })
      try {
        const list = await fetchNominators(v.address, proxy, abortControllerRef.current.signal)
        const nominators = (list ?? []).map(n => ({
          address: String(n?.account_display?.address ?? ''),
          display: String(n?.account_display?.display ?? ''),
          bonded:  BigInt(String(n?.bonded ?? '0').replace(/[^0-9]/g, '') || '0'),
        }))
        dispatch({ type: 'PATCH_VALIDATOR', address: v.address, patch: { nominators } })
        log('OK', `[${idx + 1}/${validators.length}] ${v.display || v.address.slice(0, 10)}: ${nominators.length} nominator(s).`)
      } catch (err) {
        dispatch({ type: 'PATCH_VALIDATOR', address: v.address, patch: { nominators: [], fetchStatus: 'error' } })
        log('WARN', `[${idx + 1}/${validators.length}] Nominators failed for ${v.address.slice(0, 10)} — request failed.`)
      }
      await delay(API_DELAY_MS)
    }
    if (abortControllerRef.current?.signal.aborted) return

    // ── Step 3: Era stats (sequential, 1 req/s) ─────────────────────────
    log('INFO', `Fetching era stats (last ${eraCount} eras) for ${validators.length} validators (sequential, ${API_DELAY_MS}ms between requests)…`)

    for (let idx = 0; idx < validators.length; idx++) {
      if (abortControllerRef.current?.signal.aborted) return
      const v = validators[idx]
      try {
        const list = await fetchEraStat(v.address, eraCount, proxy, abortControllerRef.current.signal)
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
        dispatch({ type: 'PATCH_VALIDATOR', address: v.address, patch: { eraStat: [], fetchStatus: 'error' } })
        log('ERR', `[${idx + 1}/${validators.length}] Era stat failed for ${v.address.slice(0, 10)} — request failed.`)
      }
      await delay(API_DELAY_MS)
    }
    if (abortControllerRef.current?.signal.aborted) return

    log('DONE', 'All data loaded. Summary generated below.')
    dispatch({ type: 'DONE' })
  }, [state.proxyUrl, log])

  const reset = useCallback(() => {
    // cancel in-flight requests
    try { abortControllerRef.current?.abort() } catch (e) { /* noop */ }
    abortControllerRef.current = null
    dispatch({ type: 'RESET' })
  }, [])

  // Derive latestEra and missedEras after loading
  const enrichedValidators = state.status === 'done' || state.status === 'loading'
    ? enrichValidators(state.validators)
    : state.validators

  return {
    ...state,
    validators: enrichedValidators,
    setProxy,
    runCheck,
    reset,
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
