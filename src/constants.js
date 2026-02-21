// ── API ────────────────────────────────────────────────────────────────────
export const SUBSCAN_BASE = 'https://enjin.webapi.subscan.io'

// Exact whitelisted path suffixes — any deviation is rejected
export const ENDPOINTS = {
  validators: '/api/scan/staking/validators',
  nominators: '/api/scan/staking/nominators',
  eraStat:    '/api/scan/staking/era_stat',
}

// Subscan explorer base for external links
export const EXPLORER_BASE = 'https://enjin.subscan.io'

// ── Request tuning ─────────────────────────────────────────────────────────
export const BATCH_SIZE            = 10   // concurrent requests per wave
export const REQUEST_TIMEOUT_MS    = 15000
export const NOMINATORS_ROW        = 100  // max nominators to fetch per validator
export const PROXY_STORAGE_KEY     = 'enjin_checker_proxy_url'

// ── Defaults ───────────────────────────────────────────────────────────────
export const DEFAULT_ERA_COUNT     = 14
export const MIN_ERA_COUNT         = 1
export const MAX_ERA_COUNT         = 100
export const CONSECUTIVE_MISS_THRESHOLD = 3   // eras before critical alert

// ── ENJ precision ─────────────────────────────────────────────────────────
export const PLANCK_PER_ENJ        = BigInt('1000000000000000000') // 10^18
