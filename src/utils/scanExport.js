/**
 * Scan export / import for the tools that hold a whole scan in reducer state:
 * Staking Cadence (validator and pool modes) and the ENJ Infusion Checker.
 *
 * JSON only. Unlike the Balance Viewer and Reward History exports — which carry
 * no tool or version marker and are recognised by sniffing their contents — every
 * file written here is wrapped in an envelope naming the tool, the schema, and a
 * schema version. Import validates all three, so a file from another tool (or a
 * newer app) is refused with a message saying what it actually is rather than
 * being half-parsed into a plausible-looking wrong result.
 *
 * Security:
 * - Every BigInt field round-trips as a decimal string through `parseBigInt`,
 *   which rejects negatives and decimals rather than silently coercing them.
 * - An import file is untrusted input. Strings are length-capped, enums are
 *   allowlisted, and `metadata.previewImage` — the one imported value that ends
 *   up in an `<img src>` — must be an https: URL or it is dropped. See
 *   `sanitisePreviewImage`.
 * - Encryption reuses `aesEncrypt` / `aesDecrypt` unchanged. The ciphertext is
 *   nested under `payload` rather than spread at the top level, so an encrypted
 *   scan file dropped on the Balance Viewer's importer (which treats any
 *   `{encrypted:true}` JSON as its own) is rejected instead of prompting for a
 *   password and then failing on the plaintext.
 */
import { parseBigInt, aesEncrypt, aesDecrypt } from './balanceExport.js'
import {
  SCAN_TOOL_ID, SCAN_SCHEMAS, SCAN_SCHEMA_VERSION,
  ScanImportError, MAX_TEXT, str, int,
  envelopeHeader, validateHeader,
} from './scanEnvelope.js'

// Re-exported so callers have a single import for everything export/import,
// and so the many existing `from './scanExport.js'` imports keep working.
export {
  SCAN_TOOL_ID, SCAN_SCHEMAS, SCHEMA_LABELS, SCAN_SCHEMA_VERSION,
  ScanImportError, envelopeHeader, readLegacyHeader,
} from './scanEnvelope.js'

const FILENAME_STEMS = {
  [SCAN_SCHEMAS.VALIDATOR]: 'enjin_staking_validator',
  [SCAN_SCHEMAS.POOL]:      'enjin_staking_pool',
  [SCAN_SCHEMAS.INFUSION]:  'enjin_infusion',
}


// ── Field coercion ─────────────────────────────────────────────────────────


/** A finite number (used for commission percentages), or `fallback`. */
function num(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function bool(v) {
  return v === true || v === 'true' || v === 1
}

function oneOf(v, allowed, fallback) {
  const s = String(v ?? '')
  return allowed.includes(s) ? s : fallback
}

/** Integer array, de-duplicated, newest-first. */
function intArray(v) {
  if (!Array.isArray(v)) return []
  const seen = new Set()
  for (const e of v) {
    const n = Number(e)
    if (Number.isSafeInteger(n)) seen.add(n)
  }
  return [...seen].sort((a, b) => b - a)
}

const FETCH_STATUSES = ['pending', 'queued', 'loading', 'done', 'failed', 'error']
function fetchStatus(v) {
  return oneOf(v, FETCH_STATUSES, 'done')
}

/**
 * The only imported value that becomes a live network request: it is rendered
 * as `<img src>` in the bulk table and the detail modal. Anything but an https:
 * URL is dropped.
 *
 * Note this does not make a surviving URL safe to load silently — fetching a
 * remote image named by an imported file tells whoever authored that file that
 * the recipient opened it. Gating the actual render is the caller's job.
 */
function sanitisePreviewImage(v) {
  const s = str(v, MAX_TEXT)
  if (!s) return ''
  let url
  try { url = new URL(s) } catch { return '' }
  return url.protocol === 'https:' ? s : ''
}

// ── Envelope build / parse ─────────────────────────────────────────────────


/**
 * Wrap a payload in the versioned, tool-stamped envelope.
 *
 * `appVersion` is additive and informational only — it identifies which build
 * wrote the file for the provenance banner and for debugging a file that
 * behaves oddly. It does not gate compatibility; that is `schemaVersion`'s
 * job, so an older or newer build's files still import as long as the schema
 * version is understood.
 */
export function buildEnvelope(schema, { meta = {}, data = {} } = {}) {
  return { ...envelopeHeader(schema), meta, data }
}

function serialise(envelope) {
  return JSON.stringify(envelope, null, 2)
}

/** Default download stem for a schema, e.g. `enjin_staking_pool_1757000000`. */
export function defaultScanFilename(schema) {
  const stem = FILENAME_STEMS[schema] ?? 'enjin_scan'
  return `${stem}_${Math.floor(Date.now() / 1000)}`
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new ScanImportError('This file is not valid JSON.', { cause })
  }
}

/** True for the outer wrapper written by `wrapEncrypted`. */
export function isEncryptedEnvelope(obj) {
  return Boolean(
    obj
    && typeof obj === 'object'
    && obj.tool === SCAN_TOOL_ID
    && obj.encryption === 'aes-256-gcm'
    && obj.payload
    && obj.payload.encrypted === true,
  )
}

/**
 * Read a file's envelope header without validating its payload.
 * Lets a panel decide whether to prompt for a password, and name the owning
 * tool in an error, before committing to a full parse.
 */
export function peekEnvelope(text) {
  const obj = parseJson(text)
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new ScanImportError('This file is not an EnjinSight scan export.')
  }
  if (obj.tool !== SCAN_TOOL_ID) {
    throw new ScanImportError(
      'This file is not an EnjinSight scan export. Import only accepts files exported from this tool.',
    )
  }
  return {
    tool: obj.tool,
    schema: str(obj.schema, 64),
    schemaVersion: int(obj.schemaVersion, 0),
    appVersion: obj.appVersion ? str(obj.appVersion, 64) : null,
    exportedAt: str(obj.exportedAt, 64),
    encrypted: isEncryptedEnvelope(obj),
  }
}

/**
 * Parse and validate an envelope, requiring it to be `expectedSchema`.
 * @throws {ScanImportError}
 */
export function parseEnvelope(text, expectedSchema) {
  const obj = parseJson(text)
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new ScanImportError('This file is not an EnjinSight scan export.')
  }

  if (isEncryptedEnvelope(obj)) {
    throw new ScanImportError('This file is encrypted. Enter its password to import it.')
  }

  const header = validateHeader(obj, expectedSchema)

  if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
    throw new ScanImportError('This export has no data section.')
  }

  return {
    ...header,
    meta: (obj.meta && typeof obj.meta === 'object' && !Array.isArray(obj.meta)) ? obj.meta : {},
    data: obj.data,
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new ScanImportError(`This export has no ${label}.`)
  }
  return value
}

// ── Encryption wrapper ─────────────────────────────────────────────────────

/**
 * Wrap the JSON string produced by `aesEncrypt` in an outer envelope.
 * `schema` is duplicated outside the ciphertext so the importer can name the
 * owning tool before a password is supplied; it is a routing hint only — the
 * authoritative schema is the one inside the encrypted payload, which is what
 * `parseEnvelope` checks after decryption.
 */
export function wrapEncrypted(schema, cipherJson) {
  return serialise({
    tool: SCAN_TOOL_ID,
    schema,
    schemaVersion: SCAN_SCHEMA_VERSION,
    encryption: 'aes-256-gcm',
    exportedAt: new Date().toISOString(),
    payload: JSON.parse(cipherJson),
  })
}

/** Encrypt an already-serialised scan file. */
export async function encryptScanFile(plainText, password) {
  const schema = peekEnvelope(plainText).schema
  return wrapEncrypted(schema, await aesEncrypt(plainText, password))
}

/**
 * Decrypt a file written by `encryptScanFile`, returning the plaintext envelope
 * JSON. Pass the result to the matching `import*Scan`.
 */
export async function decryptScanFile(text, password) {
  const obj = parseJson(text)
  if (!isEncryptedEnvelope(obj)) {
    throw new ScanImportError('This file is not an encrypted EnjinSight scan export.')
  }
  try {
    // aesDecrypt rebuilds its AAD from the payload's own algorithm/kdf fields,
    // so re-serialising the parsed payload is lossless for its purposes.
    return await aesDecrypt(JSON.stringify(obj.payload), password)
  } catch (cause) {
    throw new ScanImportError('Could not decrypt this file. Check the password.', { cause })
  }
}

// ── Staking Cadence — validator mode ───────────────────────────────────────

function eraStatToObj(e) {
  return {
    era:            int(e?.era),
    reward:         String(e?.reward ?? 0n),
    validatorStake: String(e?.validatorStake ?? 0n),
    nominatorStake: String(e?.nominatorStake ?? 0n),
    startBlock:     int(e?.startBlock),
    endBlock:       int(e?.endBlock),
    rewardPoint:    int(e?.rewardPoint),
    blocksProduced: int(e?.blocksProduced),
  }
}

function eraStatFromObj(e, where) {
  return {
    era:            int(e?.era),
    reward:         parseBigInt(e?.reward,         { field: `${where} reward` }),
    validatorStake: parseBigInt(e?.validatorStake, { field: `${where} validatorStake` }),
    nominatorStake: parseBigInt(e?.nominatorStake, { field: `${where} nominatorStake` }),
    startBlock:     int(e?.startBlock),
    endBlock:       int(e?.endBlock),
    rewardPoint:    int(e?.rewardPoint),
    blocksProduced: int(e?.blocksProduced),
  }
}

/**
 * Serialise a validator-mode scan.
 *
 * `missedEras` is deliberately omitted: `enrichValidators` recomputes it from
 * `eraStat` plus `requestedEraCount` on every render, so persisting it would
 * store a value that is immediately overwritten — and, if the two disagreed,
 * hide the disagreement.
 */
export function exportValidatorScan({ validators = [], requestedEraCount = 0 } = {}) {
  const rows = validators.map(v => ({
    address:         str(v?.address),
    display:         str(v?.display),
    commission:      num(v?.commission),
    bondedTotal:     String(v?.bondedTotal ?? 0n),
    countNominators: int(v?.countNominators),
    isActive:        bool(v?.isActive),
    fetchStatus:     str(v?.fetchStatus, 32),
    lastError:       v?.lastError ? str(v.lastError, MAX_TEXT) : null,
    nominators: Array.isArray(v?.nominators)
      ? v.nominators.map(n => ({
        address: str(n?.address),
        display: str(n?.display),
        bonded:  String(n?.bonded ?? 0n),
      }))
      : null,
    eraStat: Array.isArray(v?.eraStat) ? v.eraStat.map(eraStatToObj) : null,
  }))

  return serialise(buildEnvelope(SCAN_SCHEMAS.VALIDATOR, {
    meta: { requestedEraCount: int(requestedEraCount), validatorCount: rows.length },
    data: { validators: rows },
  }))
}

export function importValidatorScan(text) {
  const env = parseEnvelope(text, SCAN_SCHEMAS.VALIDATOR)
  const raw = requireArray(env.data.validators, 'validator list')

  const validators = raw.map((v, i) => {
    const where = `validator ${i + 1}`
    return {
      address:         str(v?.address),
      display:         str(v?.display),
      commission:      num(v?.commission),
      bondedTotal:     parseBigInt(v?.bondedTotal, { field: `${where} bondedTotal` }),
      countNominators: int(v?.countNominators),
      isActive:        bool(v?.isActive),
      fetchStatus:     fetchStatus(v?.fetchStatus),
      lastError:       v?.lastError ? str(v.lastError, MAX_TEXT) : null,
      nominators: Array.isArray(v?.nominators)
        ? v.nominators.map((n, j) => ({
          address: str(n?.address),
          display: str(n?.display),
          bonded:  parseBigInt(n?.bonded, { field: `${where} nominator ${j + 1} bonded` }),
        }))
        : null,
      eraStat: Array.isArray(v?.eraStat)
        ? v.eraStat.map(e => eraStatFromObj(e, where))
        : null,
      // Recomputed by enrichValidators; present so the shape matches a live scan.
      missedEras: [],
    }
  }).filter(v => v.address.length > 0)

  return {
    validators,
    requestedEraCount: int(env.meta.requestedEraCount),
    exportedAt: env.exportedAt,
    appVersion: env.appVersion,
  }
}

// ── Staking Cadence — pool mode ────────────────────────────────────────────

function poolValidatorToObj(v) {
  const out = {
    address:       str(v?.address),
    display:       str(v?.display),
    bonded:        String(v?.bonded ?? 0n),
    isActive:      bool(v?.isActive),
    fetchStatus:   str(v?.fetchStatus, 32),
    retryAttempts: int(v?.retryAttempts),
    lastError:     v?.lastError ? str(v.lastError, MAX_TEXT) : null,
  }
  // Only present after a manual retry. Raw Subscan JSON, already plain data.
  if (Array.isArray(v?.eraStat)) out.eraStat = v.eraStat
  return out
}

function poolValidatorFromObj(v, where) {
  const out = {
    address:       str(v?.address),
    display:       str(v?.display),
    bonded:        parseBigInt(v?.bonded, { field: `${where} bonded` }),
    isActive:      bool(v?.isActive),
    fetchStatus:   fetchStatus(v?.fetchStatus),
    retryAttempts: int(v?.retryAttempts),
    lastError:     v?.lastError ? str(v.lastError, MAX_TEXT) : null,
  }
  if (Array.isArray(v?.eraStat)) out.eraStat = v.eraStat
  return out
}

function rewardToObj(r) {
  return {
    era:            int(r?.era),
    // Already a decimal string in live state; normalised here so a hand-edited
    // file cannot smuggle a non-numeric amount past the row builder.
    amount:         String(r?.amount ?? '0'),
    blockTimestamp: int(r?.blockTimestamp),
    eventIndex:     str(r?.eventIndex, 64),
    validatorStash: str(r?.validatorStash),
  }
}

function rewardFromObj(r, where) {
  return {
    era:            int(r?.era),
    // Kept as a string to match live state, but validated as an integer so a
    // malformed amount fails loudly here rather than silently summing to 0n
    // inside buildEraRows.
    amount:         parseBigInt(r?.amount, { field: `${where} reward amount` }).toString(),
    blockTimestamp: int(r?.blockTimestamp),
    eventIndex:     str(r?.eventIndex, 64),
    validatorStash: str(r?.validatorStash),
  }
}

/**
 * Serialise a pool-mode scan.
 *
 * `eraValidatorBreakdown` is omitted: it is a `Map` of BigInt amounts, and it is
 * derivable from `eraRewards` + `nominatedValidators` + `completedEras`, all of
 * which are stored. Flattening it would write pools x eras x validators rows and
 * let the copy drift from the rewards it summarises. `completedEras` is exported
 * precisely so the import side can rebuild it.
 *
 * Unlike the validator side, `missedEras` *is* stored — there it is derived on
 * every render, here it is reducer state written once by the scan.
 */
export function exportPoolScan({
  pools = [],
  requestedEraCount = 0,
  provisionalEra = null,
  completedEras = [],
  latestCompletedEra = 0,
} = {}) {
  const rows = pools.map(p => ({
    poolId:        int(p?.poolId),
    metadata:      str(p?.metadata),
    state:         str(p?.state, 32),
    stashAddress:  str(p?.stashAddress),
    stashDisplay:  str(p?.stashDisplay),
    rewardAddress: str(p?.rewardAddress),
    rewardDisplay: str(p?.rewardDisplay),
    memberCount:   int(p?.memberCount),
    totalBonded:   String(p?.totalBonded ?? 0n),
    commission:    num(p?.commission),
    fetchStatus:   str(p?.fetchStatus, 32),
    nominatedValidators: Array.isArray(p?.nominatedValidators)
      ? p.nominatedValidators.map(poolValidatorToObj)
      : null,
    eraRewards: Array.isArray(p?.eraRewards) ? p.eraRewards.map(rewardToObj) : null,
    missedEras: intArray(p?.missedEras),
  }))

  return serialise(buildEnvelope(SCAN_SCHEMAS.POOL, {
    meta: {
      requestedEraCount: int(requestedEraCount),
      provisionalEra: provisionalEra == null ? null : int(provisionalEra),
      completedEras: intArray(completedEras),
      latestCompletedEra: int(latestCompletedEra),
      poolCount: rows.length,
    },
    data: { pools: rows },
  }))
}

/**
 * Parse a pool-mode scan.
 *
 * `eraValidatorBreakdown` is returned as `null` on every pool: rebuilding it
 * needs `buildEraValidatorBreakdown`, which lives in `usePoolChecker`. Doing it
 * here would make a util import a hook. The hook's import action rebuilds it
 * from the `completedEras` returned alongside the pools.
 */
export function importPoolScan(text) {
  const env = parseEnvelope(text, SCAN_SCHEMAS.POOL)
  const raw = requireArray(env.data.pools, 'pool list')

  const pools = raw.map((p, i) => {
    const where = `pool ${p?.poolId ?? i + 1}`
    return {
      poolId:        int(p?.poolId),
      metadata:      str(p?.metadata),
      state:         str(p?.state, 32),
      stashAddress:  str(p?.stashAddress),
      stashDisplay:  str(p?.stashDisplay),
      rewardAddress: str(p?.rewardAddress),
      rewardDisplay: str(p?.rewardDisplay),
      memberCount:   int(p?.memberCount),
      totalBonded:   parseBigInt(p?.totalBonded, { field: `${where} totalBonded` }),
      commission:    num(p?.commission),
      fetchStatus:   fetchStatus(p?.fetchStatus),
      nominatedValidators: Array.isArray(p?.nominatedValidators)
        ? p.nominatedValidators.map((v, j) => poolValidatorFromObj(v, `${where} validator ${j + 1}`))
        : null,
      eraRewards: Array.isArray(p?.eraRewards)
        ? p.eraRewards.map(r => rewardFromObj(r, where))
        : null,
      missedEras: intArray(p?.missedEras),
      eraValidatorBreakdown: null,
    }
  }).filter(p => p.stashAddress.length > 0)

  const provisionalEra = env.meta.provisionalEra == null ? null : int(env.meta.provisionalEra)
  const completedEras = intArray(env.meta.completedEras)

  return {
    pools,
    requestedEraCount: int(env.meta.requestedEraCount),
    provisionalEra,
    completedEras,
    latestCompletedEra: int(env.meta.latestCompletedEra) || (completedEras[0] ?? 0),
    exportedAt: env.exportedAt,
    appVersion: env.appVersion,
  }
}

// ── ENJ Infusion Checker ───────────────────────────────────────────────────

const OUTCOME_KINDS = ['empty', 'error', 'canceled', 'done']
// The Infusion Checker's own two modes. 'wallet' — not 'bulk' — is the value the
// component and `derivePhases` compare against; coercing it to something else
// would leave an imported wallet scan with its results table unrendered.
const INFUSION_MODES = ['single', 'wallet']

function metadataToObj(m) {
  if (!m || typeof m !== 'object') return null
  return {
    owner:           str(m.owner),
    contractAddress: str(m.contractAddress),
    creator:         str(m.creator),
    tokenStandard:   str(m.tokenStandard, 64),
    quantity:        str(m.quantity, 64),
    name:            str(m.name),
    previewImage:    str(m.previewImage, MAX_TEXT),
    imageUrl:        str(m.imageUrl, MAX_TEXT),
    description:     str(m.description, MAX_TEXT),
    properties:      Array.isArray(m.properties) ? m.properties : undefined,
    tokenUri:        str(m.tokenUri, MAX_TEXT),
    metadataError:   m.metadataError ? str(m.metadataError, MAX_TEXT) : null,
    source:          str(m.source, 64),
  }
}

function metadataFromObj(m) {
  if (!m || typeof m !== 'object') return null
  return {
    owner:           str(m.owner),
    contractAddress: str(m.contractAddress),
    creator:         str(m.creator),
    tokenStandard:   str(m.tokenStandard, 64),
    quantity:        str(m.quantity, 64),
    name:            str(m.name),
    // The only field that becomes a network request on render.
    previewImage:    sanitisePreviewImage(m.previewImage),
    // Rendered as text (DetailField), never as an href — kept verbatim, capped.
    imageUrl:        str(m.imageUrl, MAX_TEXT),
    description:     str(m.description, MAX_TEXT),
    properties:      Array.isArray(m.properties) ? m.properties : undefined,
    tokenUri:        str(m.tokenUri, MAX_TEXT),
    metadataError:   m.metadataError ? str(m.metadataError, MAX_TEXT) : null,
    source:          str(m.source, 64),
  }
}

/**
 * Serialise an Infusion Checker scan.
 *
 * `rows[].raw` is a display string, not a number: a failed row carries
 * "See terminal log". It is therefore *not* run through `parseBigInt` on either
 * side — only capped.
 *
 * Pagination, sort and search are view state and are deliberately not persisted.
 */
export function exportInfusionScan({
  mode = 'wallet',
  walletAddress = '',
  tokenId = '',
  amount = '-',
  rawValue = '',
  bulkStatus = '',
  bulkTotal = '-',
  bulkStarted = false,
  bulkExpectedTotal = 0,
  scanOutcome = null,
  rows = [],
} = {}) {
  const outRows = rows.map(r => ({
    tokenId:       str(r?.tokenId, 128),
    amount:        str(r?.amount, 64),
    raw:           str(r?.raw, 128),
    error:         bool(r?.error),
    metadata:      metadataToObj(r?.metadata),
    metadataError: r?.metadataError ? str(r.metadataError, MAX_TEXT) : null,
    errorMessage:  r?.errorMessage ? str(r.errorMessage, MAX_TEXT) : undefined,
  }))

  return serialise(buildEnvelope(SCAN_SCHEMAS.INFUSION, {
    meta: {
      mode: oneOf(mode, INFUSION_MODES, 'wallet'),
      walletAddress: str(walletAddress),
      tokenId: str(tokenId, 128),
      rowCount: outRows.length,
    },
    data: {
      amount:            str(amount, 64),
      rawValue:          str(rawValue, MAX_TEXT),
      bulkStatus:        str(bulkStatus, MAX_TEXT),
      bulkTotal:         str(bulkTotal, 64),
      bulkStarted:       bool(bulkStarted),
      bulkExpectedTotal: int(bulkExpectedTotal),
      scanOutcome: scanOutcome
        ? {
          kind:    oneOf(scanOutcome.kind, OUTCOME_KINDS, 'done'),
          stage:   str(scanOutcome.stage, 64),
          message: str(scanOutcome.message, MAX_TEXT),
          mode:    oneOf(scanOutcome.mode, INFUSION_MODES, 'wallet'),
        }
        : null,
      rows: outRows,
    },
  }))
}

export function importInfusionScan(text) {
  const env = parseEnvelope(text, SCAN_SCHEMAS.INFUSION)
  const raw = requireArray(env.data.rows, 'token rows')

  const rows = raw.map(r => {
    const out = {
      tokenId:       str(r?.tokenId, 128),
      amount:        str(r?.amount, 64),
      raw:           str(r?.raw, 128),
      error:         bool(r?.error),
      metadata:      metadataFromObj(r?.metadata),
      metadataError: r?.metadataError ? str(r.metadataError, MAX_TEXT) : null,
    }
    if (r?.errorMessage) out.errorMessage = str(r.errorMessage, MAX_TEXT)
    return out
  }).filter(r => r.tokenId.length > 0)

  const outcome = env.data.scanOutcome

  return {
    mode:              oneOf(env.meta.mode, INFUSION_MODES, 'wallet'),
    walletAddress:     str(env.meta.walletAddress),
    tokenId:           str(env.meta.tokenId, 128),
    amount:            str(env.data.amount, 64) || '-',
    rawValue:          str(env.data.rawValue, MAX_TEXT),
    bulkStatus:        str(env.data.bulkStatus, MAX_TEXT),
    bulkTotal:         str(env.data.bulkTotal, 64) || '-',
    bulkStarted:       bool(env.data.bulkStarted),
    bulkExpectedTotal: int(env.data.bulkExpectedTotal),
    scanOutcome: (outcome && typeof outcome === 'object')
      ? {
        kind:    oneOf(outcome.kind, OUTCOME_KINDS, 'done'),
        stage:   str(outcome.stage, 64),
        message: str(outcome.message, MAX_TEXT),
        mode:    oneOf(outcome.mode, INFUSION_MODES, 'wallet'),
      }
      : null,
    rows,
    exportedAt: env.exportedAt,
    appVersion: env.appVersion,
  }
}
