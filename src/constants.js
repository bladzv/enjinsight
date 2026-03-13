// ── API ────────────────────────────────────────────────────────────────────
export const SUBSCAN_BASE = 'https://enjin.api.subscan.io'

// Exact whitelisted path suffixes — any deviation is rejected
export const ENDPOINTS = {
  validators:  '/api/scan/staking/validators',
  nominators:  '/api/scan/staking/nominators',
  eraStat:     '/api/scan/staking/era_stat',
  pools:       '/api/scan/nomination_pool/pools',
  voted:       '/api/scan/staking/voted',
  rewardSlash: '/api/v2/scan/account/reward_slash',
}

// Subscan explorer base for external links
export const EXPLORER_BASE = 'https://enjin.subscan.io'

// Detect production build (Vite)
export const IS_PROD = import.meta.env.PROD === true

// Build a proxied URL in production (Vercel function) or return full upstream URL in dev
export function buildProxyUrl(fullUrl) {
  if (IS_PROD) return `/api/${encodeURIComponent(fullUrl)}`
  return fullUrl
}

// ── Request tuning ─────────────────────────────────────────────────────────
export const REQUEST_TIMEOUT_MS    = 15000
export const MAX_RETRIES           = 3     // retry attempts on 429 rate-limit responses
export const MAX_RETRY_ATTEMPTS    = 5     // general retry attempts for transient errors
export const RETRY_BASE_MS         = 1000  // base backoff in ms for retries (exponential)
export const API_DELAY_MS          = 1000  // global delay between sequential API requests (1 req/s)
export const NOMINATORS_ROW        = 100  // max nominators to fetch per validator
export const POOLS_PAGE_SIZE       = 100  // rows per page when fetching pools (multi-page loop)
export const REWARD_SLASH_ROW      = 100  // max reward/slash events per request
export const ERA_VALIDATORS_SAMPLE = 3    // validators to check for era block-range consensus

// ── Defaults ───────────────────────────────────────────────────────────────
export const DEFAULT_ERA_COUNT     = 14
export const MIN_ERA_COUNT         = 1
export const MAX_ERA_COUNT         = 100
export const CONSECUTIVE_MISS_THRESHOLD = 3   // eras before critical alert

// ── ENJ precision ─────────────────────────────────────────────────────────
export const PLANCK_PER_ENJ        = BigInt('1000000000000000000') // 10^18

// ── Endpoint probe configurations (Step 0) ────────────────────────────────
// probeEndpoint sends {} (empty body) to each path. Subscan responds with
// HTTP 200 + code 400 ("EOF") when required fields are absent — that is enough
// to confirm the endpoint path is correct and the API key is accepted.
export const VALIDATOR_ENDPOINTS_TO_PROBE = [
  { key: 'validators', label: 'Validators list' },
  { key: 'nominators', label: 'Nominators'      },
  { key: 'eraStat',    label: 'Era statistics'  },
]

export const POOL_ENDPOINTS_TO_PROBE = [
  { key: 'pools',       label: 'Nomination pools' },
  { key: 'voted',       label: 'Voted validators' },
  { key: 'rewardSlash', label: 'Reward events'    },
]
