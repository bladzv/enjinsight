/**
 * The identifying header every EnjinSight export carries, and the rules for
 * validating it on import.
 *
 * Deliberately a leaf module: `scanExport.js` needs `balanceExport.js` (for
 * `parseBigInt` and the AES helpers) and `balanceExport.js` needs this header,
 * so putting the header in either of them would make the two import each other.
 * Nothing here imports anything.
 *
 * Two payload shapes share this header:
 *
 *  - the scan schemas nest under `meta`/`data` (see `buildEnvelope`);
 *  - the two legacy schemas spread the header across their original flat shape
 *    (`{tool, schema, …, _rpcConfig, records}`), so a build predating the
 *    header still recognises and reads a new file. Adding provenance should not
 *    cost a user the ability to open their own export on whichever version they
 *    happen to be running.
 */

export const SCAN_TOOL_ID = 'enjinsight'

export const SCAN_SCHEMAS = {
  VALIDATOR: 'staking-cadence-validator',
  POOL:      'staking-cadence-pool',
  INFUSION:  'infusion-checker',
  // The two older tools, whose payloads keep their original flat shape.
  BALANCE:   'balance-viewer',
  REWARD:    'reward-history',
}

/** Human names, used in "this file belongs to X" import errors. */
export const SCHEMA_LABELS = {
  [SCAN_SCHEMAS.VALIDATOR]: 'Staking Cadence (validator mode)',
  [SCAN_SCHEMAS.POOL]:      'Staking Cadence (pool mode)',
  [SCAN_SCHEMAS.INFUSION]:  'ENJ Infusion Checker',
  [SCAN_SCHEMAS.BALANCE]:   'Balance Viewer',
  [SCAN_SCHEMAS.REWARD]:    'Reward History',
}

export const SCAN_SCHEMA_VERSION = 1

/** Thrown for every rejected import, so callers can tell it from a crash. */
export class ScanImportError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'ScanImportError'
  }
}

// Bounds on untrusted strings. Long enough for any real value (an SS58 address
// is 49 chars, a display name or pool metadata far less), short enough that a
// hostile file cannot blow up memory through a million-character field.
export const MAX_STR = 512
export const MAX_TEXT = 4096

export function str(v, max = MAX_STR) {
  if (v === null || v === undefined) return ''
  return String(v).slice(0, max)
}

/** A finite integer, or `fallback`. Rejects NaN, Infinity and fractions. */
export function int(v, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isSafeInteger(n) ? n : fallback
}

// Injected by vite.config.js's `define` from package.json at build time. Not
// declared anywhere: `typeof` on an unbound identifier safely evaluates to
// 'undefined' rather than throwing, so this degrades to 'unknown' in any
// context (e.g. a bare Node import) that never went through Vite's replace.
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown'

/**
 * The identifying header, for a writer to spread over its own payload.
 *
 * `appVersion` is informational only — it identifies which build wrote the
 * file, for the provenance banner and for debugging one that behaves oddly. It
 * does not gate compatibility; that is `schemaVersion`'s job.
 */
export function envelopeHeader(schema) {
  if (!Object.values(SCAN_SCHEMAS).includes(schema)) {
    throw new Error(`Unknown scan schema: ${schema}`)
  }
  return {
    tool: SCAN_TOOL_ID,
    schema,
    schemaVersion: SCAN_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
  }
}

/**
 * Validate the identifying header on a parsed object.
 * @throws {ScanImportError}
 */
export function validateHeader(obj, expectedSchema) {
  if (obj.tool !== SCAN_TOOL_ID) {
    throw new ScanImportError(
      'This file is not an EnjinSight scan export. Import only accepts files exported from this tool.',
    )
  }

  const schema = String(obj.schema ?? '')
  if (!Object.values(SCAN_SCHEMAS).includes(schema)) {
    throw new ScanImportError(
      `Unrecognised export type "${str(schema, 64) || '(none)'}". It may have been written by a newer version of EnjinSight.`,
    )
  }
  if (schema !== expectedSchema) {
    throw new ScanImportError(
      `This is a ${SCHEMA_LABELS[schema]} export. Import it from that tool, not ${SCHEMA_LABELS[expectedSchema]}.`,
    )
  }

  const version = Number(obj.schemaVersion)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ScanImportError('This export is missing a valid schema version.')
  }
  if (version > SCAN_SCHEMA_VERSION) {
    throw new ScanImportError(
      `This export uses schema version ${version}, but this build understands up to ${SCAN_SCHEMA_VERSION}. Update EnjinSight to open it.`,
    )
  }

  return {
    schema,
    schemaVersion: version,
    appVersion: obj.appVersion ? str(obj.appVersion, 64) : null,
    exportedAt: str(obj.exportedAt, 64),
  }
}

/**
 * Read and validate a legacy export's header, or report that it has none.
 *
 * Returns `null` for a file with no `tool` marker at all — an export written
 * before the header existed, where the caller falls back to its own content
 * sniff. A file that *does* carry a marker is validated strictly, so a Balance
 * Viewer export dropped on the Reward History importer is named and refused
 * rather than half-parsed into a plausible-looking wrong result.
 *
 * @throws {ScanImportError} when a header is present but wrong.
 */
export function readLegacyHeader(obj, expectedSchema) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  if (obj.tool === undefined || obj.tool === null) return null
  return validateHeader(obj, expectedSchema)
}
