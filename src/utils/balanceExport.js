/**
 * Balance data export, import, and AES-256-GCM encryption utilities.
 *
 * Security:
 * - Export filenames are sanitised (safeFilename) before use in download links.
 * - All import paths validate and sanitise field values before consuming them.
 * - AES-256-GCM with PBKDF2-SHA-256 (600,000 iterations) is used for encryption.
 *   Older files recording 100,000 iterations remain readable.
 * - No innerHTML — XML serialisation uses manual entity escaping.
 * - Blob URLs are revoked after 60 s to avoid memory leaks.
 */
import { isValidBlockHash } from './substrate.js'

// ── Helpers ────────────────────────────────────────────────────────────────

/** Sanitise a user-provided filename. Replaces unsafe chars with underscores. */
export function safeFilename(s) {
  return String(s).replace(/[^a-zA-Z0-9_\-.]/g, '_').slice(0, 160)
    || `enjin_balance_${Math.floor(Date.now() / 1000)}`
}

export function defaultFilename() {
  return `enjin_balance_${Math.floor(Date.now() / 1000)}`
}

/**
 * Convert a Planck BigInt to a float (for export / chart display).
 * Uses BigInt division to avoid IEEE 754 precision loss.
 */
export function planckToFloat(p) {
  if (typeof p !== 'bigint') p = BigInt(p)
  return Number(p / 10n ** 18n) + Number(p % 10n ** 18n) / 1e18
}

/** Format a Planck BigInt as a human-readable ENJ string with 4–8 decimals. */
export function fmtENJ(v) {
  const f = typeof v === 'bigint' ? planckToFloat(v) : v
  if (f === 0) return '0.0000'
  return f.toLocaleString('en', { minimumFractionDigits: 4, maximumFractionDigits: 8 })
}

/**
 * Parse a non-negative integer string into a BigInt.
 *
 * Strict by design. The previous implementation stripped every non-digit, which
 * silently changed the value rather than rejecting it: '-5' became 5n and
 * '1.234' became 1234n, so importing a hand-edited or third-party file could
 * inflate a decimal ENJ figure by a factor of 10^k with no warning.
 *
 * @param {*} v
 * @param {{ field?: string }} [opts]  Field name, used in the error message.
 * @returns {bigint}
 * @throws {Error} when the value is not a non-negative integer.
 */
export function parseBigInt(v, { field = 'value' } = {}) {
  if (v === null || v === undefined || v === '') return 0n
  const s = String(v).trim()
  if (s === '') return 0n
  if (!/^\+?\d+$/.test(s)) {
    throw new Error(`Invalid ${field}: "${s}" is not a non-negative integer (Planck units).`)
  }
  return BigInt(s)
}

// ── Row normalisation ──────────────────────────────────────────────────────

/** Convert a data record to a plain object for serialisation (no BigInt). */
function rowToObj(d) {
  return {
    block:         d.block,
    blockHash:     d.blockHash,
    free:          d.free.toString(),
    reserved:      d.reserved.toString(),
    miscFrozen:    d.miscFrozen.toString(),
    feeFrozen:     d.feeFrozen.toString(),
    nonce:         d.nonce,
    newFormat:     d.newFormat || false,
    free_enj:      planckToFloat(d.free),
    reserved_enj:  planckToFloat(d.reserved),
    miscFrozen_enj:planckToFloat(d.miscFrozen),
    feeFrozen_enj: planckToFloat(d.feeFrozen),
  }
}

// ── Export serialisers ─────────────────────────────────────────────────────

export function toJSON(data, rpcMeta) {
  return JSON.stringify({ _rpcConfig: rpcMeta, records: data.map(rowToObj) }, null, 2)
}

export function toCSV(data, rpcMeta) {
  const H = [
    'block','blockHash','free','reserved','miscFrozen','feeFrozen',
    'nonce','newFormat','free_enj','reserved_enj','miscFrozen_enj','feeFrozen_enj',
  ]
  const esc = v => `"${String(v).replace(/"/g, '""')}"`
  const comments = [
    `# enjin_balance_export`,
    `# endpoint: ${rpcMeta.endpoint}`,
    `# address: ${rpcMeta.address}`,
    `# exportedAt: ${rpcMeta.exportedAt}`,
  ]
  return [
    ...comments,
    H.join(','),
    ...data.map(d => { const o = rowToObj(d); return H.map(k => esc(o[k])).join(',') }),
  ].join('\r\n')
}

export function toXML(data, rpcMeta) {
  // Manual XML entity escaping — never use innerHTML here
  const ex = v =>
    String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  const rpcXml = [
    '  <rpcConfig>',
    `    <endpoint>${ex(rpcMeta.endpoint)}</endpoint>`,
    `    <address>${ex(rpcMeta.address)}</address>`,
    `    <exportedAt>${ex(rpcMeta.exportedAt)}</exportedAt>`,
    '  </rpcConfig>',
  ].join('\n')
  const rows = data.map(d => {
    const o = rowToObj(d)
    return '  <record>\n' +
      Object.entries(o).map(([k, v]) => `    <${k}>${ex(v)}</${k}>`).join('\n') +
      '\n  </record>'
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<enjinBalanceHistory>\n${rpcXml}\n${rows}\n</enjinBalanceHistory>`
}

// ── Import parsers ─────────────────────────────────────────────────────────

/**
 * Split a single CSV row into fields, honouring double-quoted values.
 *
 * The previous parser stripped every quote and *then* split on commas, so any
 * quoted field containing a comma silently corrupted the whole row.
 */
function splitCsvRow(row) {
  const out = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < row.length; i++) {
    const ch = row[i]
    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') { field += '"'; i++ }   // escaped quote
        else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(field.trim())
      field = ''
    } else field += ch
  }
  out.push(field.trim())
  return out
}

/** Normalise a raw data object from any import format into a typed record. */
function normaliseRecord(d) {
  return {
    block:      Number(d.block),
    blockHash:  isValidBlockHash(String(d.blockHash || '')) ? String(d.blockHash) : '',
    free:       parseBigInt(d.free,       { field: 'free' }),
    reserved:   parseBigInt(d.reserved,   { field: 'reserved' }),
    miscFrozen: parseBigInt(d.miscFrozen ?? d.misc_frozen ?? 0, { field: 'miscFrozen' }),
    feeFrozen:  parseBigInt(d.feeFrozen  ?? d.fee_frozen  ?? 0, { field: 'feeFrozen' }),
    nonce:      Number(d.nonce || 0),
    newFormat:  !!(d.newFormat),
  }
}

/**
 * Parse imported file text into an array of typed records.
 * Returns { records, rpcConfig } where rpcConfig may be null.
 *
 * @param {string} text  Raw file content
 * @param {'json'|'csv'|'xml'} ext  Detected file extension
 */
export function parseImport(text, ext) {
  if (ext === 'json') {
    let parsed
    try { parsed = JSON.parse(text) } catch { throw new Error('JSON parse failed.') }
    const arr = Array.isArray(parsed) ? parsed : parsed?.records
    if (!Array.isArray(arr)) throw new Error('Expected a JSON array or {records:[]} object at root.')
    return {
      records: arr.map(normaliseRecord),
      rpcConfig: parsed?._rpcConfig ?? null,
    }
  }

  if (ext === 'csv') {
    const allLines = text.trim().split(/\r?\n/)
    const comments = allLines.filter(l => l.startsWith('#'))
    const dataLines = allLines.filter(l => !l.startsWith('#'))
    if (dataLines.length < 2) throw new Error('CSV has no data rows.')

    // Extract RPC config from comments
    let endpoint = '', address = ''
    comments.forEach(c => {
      const epM = c.match(/^# endpoint:\s*(.+)/)
      const adM = c.match(/^# address:\s*(.+)/)
      if (epM) endpoint = epM[1].trim().slice(0, 256)
      if (adM) address  = adM[1].trim()
    })

    const headers = splitCsvRow(dataLines[0])
    const idx = k => headers.indexOf(k)

    // A missing column used to yield index -1, then undefined, then 0n — so a
    // header mismatch produced N records of all-zero balances instead of an
    // error. Require the columns we actually read.
    const required = ['block', 'free', 'reserved']
    const missing = required.filter(k => idx(k) === -1)
    if (missing.length) {
      throw new Error(
        `CSV is missing required column(s): ${missing.join(', ')}. Found: ${headers.join(', ') || '(none)'}.`,
      )
    }

    const pick = (c, ...keys) => {
      for (const k of keys) {
        const i = idx(k)
        if (i !== -1 && c[i] !== undefined) return c[i]
      }
      return undefined
    }

    const records = dataLines.slice(1).map((row, i) => {
      const c = splitCsvRow(row)
      try {
        return normaliseRecord({
          block:      pick(c, 'block'),
          blockHash:  pick(c, 'blockHash'),
          free:       pick(c, 'free'),
          reserved:   pick(c, 'reserved'),
          miscFrozen: pick(c, 'miscFrozen', 'misc_frozen'),
          feeFrozen:  pick(c, 'feeFrozen', 'fee_frozen'),
          nonce:      pick(c, 'nonce'),
          newFormat:  false,
        })
      } catch (e) {
        // +2: one for the header row, one for 1-based line numbering.
        throw new Error(`CSV row ${i + 2}: ${e.message}`)
      }
    })
    return { records, rpcConfig: (endpoint || address) ? { endpoint, address } : null }
  }

  if (ext === 'xml') {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (doc.querySelector('parsererror')) throw new Error('XML parse error.')
    const rpcEl = doc.querySelector('rpcConfig')
    const rpcConfig = rpcEl ? {
      endpoint: rpcEl.querySelector('endpoint')?.textContent?.trim() ?? '',
      address:  rpcEl.querySelector('address')?.textContent?.trim()  ?? '',
    } : null
    const records = Array.from(doc.querySelectorAll('record')).map(r => {
      const t = s => r.querySelector(s)?.textContent || ''
      return normaliseRecord({
        block:      t('block'),      blockHash:  t('blockHash'),
        free:       t('free'),       reserved:   t('reserved'),
        miscFrozen: t('miscFrozen'), feeFrozen:  t('feeFrozen'),
        nonce:      t('nonce'),      newFormat:  t('newFormat') === 'true',
      })
    })
    return { records, rpcConfig }
  }

  throw new Error('Unsupported file format.')
}

// ── File download ─────────────────────────────────────────────────────────

/** Trigger a file download using a short-lived Blob URL. */
export function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = safeFilename(filename)
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke after 60 s to prevent memory leak
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// ── AES-256-GCM encryption / decryption ───────────────────────────────────

// OWASP's current floor for PBKDF2-HMAC-SHA256. Files written before this
// change recorded their own count in the `kdf` field and are still readable.
const PBKDF2_ITERATIONS = 600_000
const LEGACY_PBKDF2_ITERATIONS = 100_000
// Format version. v2 authenticates the header via AES-GCM additional data;
// v1 (absent) did not, which left the `kdf` field decorative.
const ENCRYPTED_FORMAT_VERSION = 2

/**
 * Base64-encode bytes in chunks.
 *
 * `btoa(String.fromCharCode(...bytes))` throws RangeError once the spread
 * exceeds the argument limit (~100k elements), so encryption used to fail on
 * exactly the large exports that most warrant it — a 2,000-block export is
 * roughly 500 KB.
 */
function bytesToBase64(bytes) {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64ToBytes(b64) {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function deriveAesKey(password, salt, iterations, usage) {
  const km = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

/** Canonical additional-authenticated-data for a v2 payload header. */
function headerAad(algorithm, kdf) {
  return new TextEncoder().encode(`${algorithm}|${kdf}`)
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM (PBKDF2-SHA-256).
 * Returns a JSON string containing the encrypted payload encoded as base64.
 */
export async function aesEncrypt(plain, password) {
  if (!password) throw new Error('A password is required to encrypt.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv   = crypto.getRandomValues(new Uint8Array(12))
  const algorithm = 'AES-256-GCM'
  const kdf = `PBKDF2-SHA256-${PBKDF2_ITERATIONS}`

  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS, 'encrypt')
  const buf = await crypto.subtle.encrypt(
    // Binding the header as AAD makes the recorded algorithm/kdf tamper-evident
    // instead of decorative metadata.
    { name: 'AES-GCM', iv, additionalData: headerAad(algorithm, kdf) },
    key,
    new TextEncoder().encode(plain),
  )

  const out = new Uint8Array(salt.length + iv.length + buf.byteLength)
  out.set(salt, 0); out.set(iv, 16); out.set(new Uint8Array(buf), 28)
  return JSON.stringify({
    encrypted: true, v: ENCRYPTED_FORMAT_VERSION, algorithm, kdf,
    data: bytesToBase64(out),
  }, null, 2)
}

/**
 * Decrypt an AES-256-GCM-encrypted JSON string.
 * Reads v1 files (100k iterations, no AAD) as well as current v2 files.
 * Throws on wrong password or malformed payload.
 */
export async function aesDecrypt(encJson, password) {
  let obj
  try { obj = JSON.parse(encJson) } catch { throw new Error('Not a valid encrypted file.') }
  if (!obj?.encrypted || !obj?.data) throw new Error('Not a valid encrypted file.')

  const raw = base64ToBytes(obj.data)
  if (raw.length <= 28) throw new Error('Encrypted payload is truncated.')
  const salt = raw.slice(0, 16), iv = raw.slice(16, 28), ct = raw.slice(28)

  // Trust the file's own recorded iteration count so older exports still open.
  const declared = /PBKDF2-SHA256-(\d+)/.exec(String(obj.kdf || ''))
  const iterations = declared ? Number(declared[1]) : LEGACY_PBKDF2_ITERATIONS

  const key = await deriveAesKey(password, salt, iterations, 'decrypt')
  const params = { name: 'AES-GCM', iv }
  // v1 payloads were encrypted without additional data.
  if (Number(obj.v) >= 2) {
    params.additionalData = headerAad(obj.algorithm || 'AES-256-GCM', obj.kdf || '')
  }

  return new TextDecoder().decode(await crypto.subtle.decrypt(params, key, ct))
}
