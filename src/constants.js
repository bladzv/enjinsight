// ── API ────────────────────────────────────────────────────────────────────
export const SUBSCAN_BASE = 'https://enjin.webapi.subscan.io'

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

// ── Request tuning ─────────────────────────────────────────────────────────
export const REQUEST_TIMEOUT_MS    = 15000
export const MAX_RETRIES           = 3     // retry attempts on 429 rate-limit responses
export const API_DELAY_MS          = 1000  // global delay between sequential API requests (1 req/s)
export const NOMINATORS_ROW        = 100  // max nominators to fetch per validator
export const POOLS_PAGE_SIZE       = 100  // rows per page when fetching pools (multi-page loop)
export const REWARD_SLASH_ROW      = 100  // max reward/slash events per request
export const PROXY_STORAGE_KEY     = 'enjin_checker_proxy_url'
export const ERA_VALIDATORS_SAMPLE = 3    // validators to check for era block-range consensus

// ── Defaults ───────────────────────────────────────────────────────────────
export const DEFAULT_ERA_COUNT     = 14
export const MIN_ERA_COUNT         = 1
export const MAX_ERA_COUNT         = 100
export const CONSECUTIVE_MISS_THRESHOLD = 3   // eras before critical alert

// ── ENJ precision ─────────────────────────────────────────────────────────
export const PLANCK_PER_ENJ        = BigInt('1000000000000000000') // 10^18
