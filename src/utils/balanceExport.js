/**
 * Balance data export, import, and AES-256-GCM encryption utilities.
 *
 * Security:
 * - Export filenames are sanitised (safeFilename) before use in download links.
 * - All import paths validate and sanitise field values before consuming them.
 * - AES-256-GCM with PBKDF2-SHA-256 (100,000 iterations) is used for encryption.
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

/** Safely parse a numeric-ish string into a BigInt. Returns 0n on failure. */
export function parseBigInt(v) {
  try {
    return BigInt(String(v || 0).replace(/[^0-9]/g, '') || '0')
  } catch {
    return 0n
  }
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

/** Normalise a raw data object from any import format into a typed record. */
function normaliseRecord(d) {
  return {
    block:      Number(d.block),
    blockHash:  isValidBlockHash(String(d.blockHash || '')) ? String(d.blockHash) : '',
    free:       parseBigInt(d.free),
    reserved:   parseBigInt(d.reserved),
    miscFrozen: parseBigInt(d.miscFrozen ?? d.misc_frozen ?? 0),
    feeFrozen:  parseBigInt(d.feeFrozen ?? d.fee_frozen ?? 0),
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

    const headers = dataLines[0].replace(/"/g, '').split(',')
    const idx = k => headers.indexOf(k)
    const records = dataLines.slice(1).map(row => {
      const c = row.replace(/"/g, '').split(',')
      return normaliseRecord({
        block:      c[idx('block')],
        blockHash:  c[idx('blockHash')],
        free:       c[idx('free')],
        reserved:   c[idx('reserved')],
        miscFrozen: c[idx('miscFrozen')] ?? c[idx('misc_frozen')],
        feeFrozen:  c[idx('feeFrozen')]  ?? c[idx('fee_frozen')],
        nonce:      c[idx('nonce')],
        newFormat:  false,
      })
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

/**
 * Encrypt a UTF-8 string with AES-256-GCM (PBKDF2-SHA-256, 100k iterations).
 * Returns a JSON string containing the encrypted payload encoded as base64.
 */
export async function aesEncrypt(plain, password) {
  const enc  = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv   = crypto.getRandomValues(new Uint8Array(12))
  const km   = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key  = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  )
  const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain))
  const out = new Uint8Array(salt.length + iv.length + buf.byteLength)
  out.set(salt, 0); out.set(iv, 16); out.set(new Uint8Array(buf), 28)
  return JSON.stringify({
    encrypted: true, algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256-100000',
    data: btoa(String.fromCharCode(...out)),
  }, null, 2)
}

/**
 * Decrypt an AES-256-GCM-encrypted JSON string.
 * Throws on wrong password or malformed payload.
 */
export async function aesDecrypt(encJson, password) {
  const obj = JSON.parse(encJson)
  if (!obj.encrypted || !obj.data) throw new Error('Not a valid encrypted file.')
  const raw  = Uint8Array.from(atob(obj.data), c => c.charCodeAt(0))
  const salt = raw.slice(0, 16), iv = raw.slice(16, 28), ct = raw.slice(28)
  const enc  = new TextEncoder()
  const km   = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  const key  = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct))
}
