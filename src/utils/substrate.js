/**
 * Substrate / Enjin Matrixchain utilities
 *
 * Provides SS58 address decoding, storage key construction, and
 * SCALE-decoding of AccountInfo — all the low-level primitives needed
 * by the Historical Balance Viewer without any network calls.
 *
 * Security: all address inputs are validated before use.
 * No user-supplied data reaches any network call or eval path.
 */
import { blake2b } from '@noble/hashes/blake2b'
import { SYS_ACCT_PREFIX, IS_NEW_LOGIC_BIT } from '../constants.js'

// ── Base58 alphabet ────────────────────────────────────────────────────────
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

// ── Block hash regex (0x + 64 hex chars) ─────────────────────────────────
export const BLOCK_HASH_RE = /^0x[0-9a-fA-F]{64}$/

/** Convert a Uint8Array to a lowercase hex string. */
export const toHex = b =>
  Array.from(b)
    .map(x => x.toString(16).padStart(2, '0'))
    .join('')

/** Convert a hex string (with or without 0x prefix) to a Uint8Array. */
export const fromHex = h => {
  const s = h.startsWith('0x') ? h.slice(2) : h
  return new Uint8Array((s.match(/.{2}/g) || []).map(x => parseInt(x, 16)))
}

/**
 * Decode a base58-encoded string to a Uint8Array.
 * Throws on invalid characters.
 */
export function base58Decode(str) {
  let n = 0n
  for (const c of str) {
    const i = B58_ALPHABET.indexOf(c)
    if (i < 0) throw new Error(`Invalid base58 character: '${c}'`)
    n = n * 58n + BigInt(i)
  }
  let hex = n.toString(16)
  if (hex.length % 2) hex = '0' + hex
  const bytes = new Uint8Array((hex.match(/.{2}/g) || []).map(x => parseInt(x, 16)))
  const lead = (str.match(/^1*/)[0] || '').length
  if (!lead) return bytes
  const out = new Uint8Array(lead + bytes.length)
  out.set(bytes, lead)
  return out
}

/**
 * Decode an SS58-encoded address to its raw 32-byte public key.
 * Validates address length and public key length. Throws on invalid input.
 */
export function ss58Decode(addr) {
  if (!addr || addr.length < 25 || addr.length > 50)
    throw new Error('Address length out of range (expected 25–50 characters).')
  const d = base58Decode(addr)
  const pfxLen = (d[0] & 0x40) !== 0 ? 2 : 1
  const pub = d.slice(pfxLen, pfxLen + 32)
  if (pub.length !== 32)
    throw new Error('Invalid SS58 address (wrong public key length).')
  return pub
}

/**
 * Build the full System.Account storage key for a given SS58 address.
 * Layout: SYS_ACCT_PREFIX + blake2b_128(pubkey) + pubkey (transparent hash)
 */
export function buildStorageKey(addr) {
  const pub = ss58Decode(addr)
  const h16 = blake2b(pub, { dkLen: 16 })
  return '0x' + SYS_ACCT_PREFIX + toHex(h16) + toHex(pub)
}

/**
 * SCALE-decode a raw hex AccountInfo value returned by state_getStorageAt.
 * Handles both the legacy format (misc+fee frozen) and the new frozen-flags format.
 *
 * Returns: { nonce, free, reserved, miscFrozen, feeFrozen, newFormat }
 * All balance values are BigInt (Planck units).
 */
export function decodeAccountInfo(hex) {
  if (!hex || hex === '0x' || hex === null) {
    return { nonce: 0, free: 0n, reserved: 0n, miscFrozen: 0n, feeFrozen: 0n, newFormat: false }
  }
  const b = fromHex(hex)
  let o = 0
  // Little-endian u32 reader
  const u32 = () => {
    const v = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    o += 4
    return v
  }
  // Little-endian u128 reader
  const u128 = () => {
    let v = 0n
    for (let i = 15; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i])
    o += 16
    return v
  }
  const nonce = u32()
  u32() // consumers
  u32() // sufficients
  if (b.length >= 80) u32() // providers (new format has an extra u32)
  const free     = u128()
  const reserved = u128()
  const field3   = u128()
  const field4   = u128()
  // The new format flags the field4 high bit to signal that field4 is NOT feeFrozen
  const newFormat = (field4 & IS_NEW_LOGIC_BIT) !== 0n
  return newFormat
    ? { nonce, free, reserved, miscFrozen: field3, feeFrozen: 0n, newFormat: true }
    : { nonce, free, reserved, miscFrozen: field3, feeFrozen: field4, newFormat: false }
}

/**
 * Strict WebSocket URL validation — prevents SSRF via non-WS protocols.
 * Only wss:// (and ws:// in dev) are accepted.
 */
export function validateWsEndpoint(ep) {
  let url
  try { url = new URL(ep) } catch { throw new Error('Endpoint is not a valid URL.') }
  if (!['wss:', 'ws:'].includes(url.protocol))
    throw new Error(`Endpoint must use wss:// or ws://. Got "${url.protocol}"`)
  if (!url.hostname) throw new Error('Endpoint has no hostname.')
  return url.href
}

/** Clamp and coerce a numeric value to a safe integer within [min, max]. */
export function clampInt(v, min, max) {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n)) throw new Error('Not a valid integer')
  return Math.min(max, Math.max(min, n))
}

/** Validate that a string matches the block hash pattern (0x + 64 hex chars). */
export const isValidBlockHash = h => BLOCK_HASH_RE.test(h)


