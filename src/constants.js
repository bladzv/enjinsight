// ── API ────────────────────────────────────────────────────────────────────
export const SUBSCAN_BASE = 'https://enjin.api.subscan.io'

// Exact whitelisted path suffixes — any deviation is rejected
export const ENDPOINTS = {
  validators:  '/api/scan/staking/validators',
  nominators:  '/api/scan/staking/nominators',
  eraStat:     '/api/scan/staking/era_stat',
  pools:       '/api/scan/nomination_pool/pools',
  voted:       '/api/scan/staking/voted',
  rewardSlash:     '/api/v2/scan/account/reward_slash',
  extrinsics:      '/api/v2/scan/extrinsics',
  extrinsicParams: '/api/scan/extrinsic/params',
  events:          '/api/v2/scan/events',
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

// ── Historical Balance Viewer ──────────────────────────────────────────────
// Network presets for the archive node dropdown.
// Only networks with publicly documented archive WS endpoints are listed.
export const ENJIN_NETWORKS = [
  {
    key:          'matrixchain',
    label:        'Enjin Matrixchain',
    endpoint:     'wss://archive.matrix.blockchain.enjin.io',
    addrHint:     'e.g. efTpCuJYg7jnjA8HxYb9dFKp7…',
    ss58Prefix:   1110,
  },
  {
    key:              'relaychain',
    label:            'Enjin Relaychain',
    endpoint:         'wss://archive.relay.blockchain.enjin.io',
    addrHint:         'e.g. enqFfD3mAaH7dzXxFhHNwxnk2…',
    ss58Prefix:       2135,
    supportsDateRange: true,   // relay-era-reference.csv covers this network
  },
  {
    key:          'canary-matrix',
    label:        'Canary Matrixchain',
    endpoint:     'wss://archive.matrix.canary.enjin.io',
    addrHint:     'e.g. cxLNrtPNJnnEUkZMjWxPiHvNe…',
    ss58Prefix:   9030,
  },
  {
    key:              'canary-relay',
    label:            'Canary Relaychain',
    endpoint:         'wss://archive.relay.canary.enjin.io',
    addrHint:         'e.g. cnLNrtPNJnnEUkZMjWxPiHvNe…',
    ss58Prefix:       69,
    supportsDateRange: true,   // canary-relay-era-reference.csv covers this network
    eraRefCsv:        '/canary-relay-era-reference.csv',
  },
  {
    key:          'custom',
    label:        'Custom endpoint…',
    endpoint:     '',
    addrHint:     'SS58 wallet address',
    ss58Prefix:   null,
  },
]
export const WS_DEFAULT_ENDPOINT   = ENJIN_NETWORKS[0].endpoint
export const WS_CONNECT_TIMEOUT_MS = 10000
export const WS_CALL_TIMEOUT_MS    = 15000
export const MAX_RPC_CALLS         = 2000   // upper cap on block-range query size
export const CHART_MAX_PTS         = 250    // decimate chart data above this many points
export const MAX_IMPORT_MB         = 10     // maximum import file size in megabytes
// The IS_NEW_LOGIC flag bit distinguishes the new frozen-field format
export const IS_NEW_LOGIC_BIT      = 1n << 127n
// System account prefix for building storage keys (System.Account map)
export const SYS_ACCT_PREFIX       = '26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9'
// Balance chart field definitions (order matters for stacked rendering)
export const BALANCE_FIELDS = [
  { key: 'free',       label: 'Free',        color: '#00d9ff', colorBg: 'rgba(0,217,255,.65)'  },
  { key: 'reserved',   label: 'Reserved',    color: '#ffc400', colorBg: 'rgba(255,196,0,.65)'  },
  { key: 'miscFrozen', label: 'Misc Frozen', color: '#ff7a35', colorBg: 'rgba(255,122,53,.65)' },
  { key: 'feeFrozen',  label: 'Fee Frozen',  color: '#ff2d78', colorBg: 'rgba(255,45,120,.65)' },
]

// ── Typical chain sizes (used for scan-time estimates in ControlPanel) ──────
// Approximate counts for Enjin Relaychain at time of writing. Used only for
// pre-scan time estimates; actual counts are determined during the scan itself.
export const TYPICAL_VALIDATOR_COUNT = 28  // typical active validators on Enjin Relaychain
export const TYPICAL_POOL_COUNT      = 40  // typical nomination pools on Enjin Relaychain

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
