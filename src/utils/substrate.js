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

// ── MultiTokens storage key utilities ─────────────────────────────────────
// xxHash64 for twox128 pallet/item prefixes (Substrate SCALE storage keys)
function _xxh64(data, seed) {
  const P1=11400714785074694791n,P2=14029467366897019727n,
        P3=1609587929392839161n, P4=9650029242287828579n,
        P5=2870177450012600261n, M=(1n<<64n)-1n
  const lo=x=>x&M, mul=(a,b)=>lo(a*b), add=(a,b)=>lo(a+b)
  const rotl=(x,r)=>lo((x<<r)|(x>>(64n-r)))
  const round=(acc,inp)=>mul(rotl(add(acc,mul(inp,P2)),31n),P1)
  const merge=(acc,val)=>add(mul(lo(acc^round(0n,val)),P1),P4)
  const s=BigInt(seed), dv=new DataView(data.buffer,data.byteOffset,data.byteLength), n=data.length
  let p=0, h
  if(n>=32){
    let v1=add(add(s,P1),P2),v2=add(s,P2),v3=s,v4=lo(s-P1)
    while(p<=n-32){v1=round(v1,dv.getBigUint64(p,true));p+=8;v2=round(v2,dv.getBigUint64(p,true));p+=8;v3=round(v3,dv.getBigUint64(p,true));p+=8;v4=round(v4,dv.getBigUint64(p,true));p+=8}
    h=add(add(add(rotl(v1,1n),rotl(v2,7n)),rotl(v3,12n)),rotl(v4,18n))
    h=merge(merge(merge(merge(h,v1),v2),v3),v4)
  } else { h=add(s,P5) }
  h=add(h,BigInt(n))
  while(p<=n-8){h=add(mul(rotl(lo(h^round(0n,dv.getBigUint64(p,true))),27n),P1),P4);p+=8}
  if(p<=n-4){h=add(mul(rotl(lo(h^mul(BigInt(dv.getUint32(p,true)),P1)),23n),P2),P3);p+=4}
  while(p<n){h=mul(rotl(lo(h^mul(BigInt(data[p]),P5)),11n),P1);p++}
  h=mul(lo(h^(h>>33n)),P2);h=mul(lo(h^(h>>29n)),P3);return lo(h^(h>>32n))
}
function _twox128(text) {
  const b=new TextEncoder().encode(text)
  const leHex=h=>{let s='';for(let i=0;i<8;i++)s+=Number((h>>(8n*BigInt(i)))&0xFFn).toString(16).padStart(2,'0');return s}
  return leHex(_xxh64(b,0))+leHex(_xxh64(b,1))
}

/** Encode n as u128 little-endian (16 bytes). */
function _u128le(n) {
  const b = new Uint8Array(16)
  let v = BigInt(n)
  for (let i = 0; i < 16; i++) { b[i] = Number(v & 0xffn); v >>= 8n }
  return b
}

/** Blake2_128Concat: blake2b-128(key) ++ key */
function _b128concat(keyBytes) {
  const h = blake2b(keyBytes, { dkLen: 16 })
  const out = new Uint8Array(h.length + keyBytes.length)
  out.set(h); out.set(keyBytes, h.length)
  return out
}

/** Decode a hex twox128 result into bytes. */
function _hexToBytes(h) {
  return new Uint8Array((h.match(/.{2}/g) || []).map(x => parseInt(x, 16)))
}

/**
 * Build the MultiTokens.TokenAccounts storage key for
 *   MultiTokens.TokenAccounts(collectionId: u128, tokenId: u128, account: AccountId)
 * using Blake2_128Concat hashers (as used by Enjin's multi-token pallet).
 *
 * In Enjin's nomination pools, sENJ pool shares are tracked in:
 *   collection 1, token_id = pool_id
 */
export function buildTokenAccountKey(collectionId, tokenId, addr) {
  const pub = ss58Decode(addr)
  const k1  = _b128concat(_u128le(collectionId))
  const k2  = _b128concat(_u128le(tokenId))
  const k3  = _b128concat(pub)
  const out = new Uint8Array(32 + k1.length + k2.length + k3.length)
  let off = 0
  out.set(_hexToBytes(_twox128('MultiTokens')),    off); off += 16
  out.set(_hexToBytes(_twox128('TokenAccounts')),  off); off += 16
  out.set(k1, off); off += k1.length
  out.set(k2, off); off += k2.length
  out.set(k3, off)
  return '0x' + toHex(out)
}

/**
 * Build the MultiTokens.Tokens storage key for
 *   MultiTokens.Tokens(collectionId: u128, tokenId: u128)
 * using Blake2_128Concat hashers.
 */
export function buildTokenKey(collectionId, tokenId) {
  const k1  = _b128concat(_u128le(collectionId))
  const k2  = _b128concat(_u128le(tokenId))
  const out = new Uint8Array(32 + k1.length + k2.length)
  let off = 0
  out.set(_hexToBytes(_twox128('MultiTokens')), off); off += 16
  out.set(_hexToBytes(_twox128('Tokens')),      off); off += 16
  out.set(k1, off); off += k1.length
  out.set(k2, off)
  return '0x' + toHex(out)
}

/**
 * Decode the first u128 field from a SCALE-encoded storage value (little-endian).
 * Works for both TokenAccount.balance and Token.supply (both are the first field).
 */
export function decodeU128First(hex) {
  if (!hex || hex === '0x' || hex === null) return 0n
  const b = fromHex(hex)
  if (b.length < 16) return 0n
  let v = 0n
  for (let i = 15; i >= 0; i--) v = (v << 8n) | BigInt(b[i])
  return v
}

