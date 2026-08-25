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

/**
 * Convert a hex string (with or without 0x prefix) to a Uint8Array.
 *
 * Validates strictly. The previous version ran parseInt over arbitrary text, so
 * `fromHex('zz')` produced NaN and stored it as 0, and an odd-length string
 * silently dropped its trailing nibble — corrupt input became plausible-looking
 * zero balances rather than an error.
 */
export const fromHex = h => {
  if (typeof h !== 'string') throw new Error('Hex value must be a string.')
  const s = h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h
  if (s.length % 2 !== 0) throw new Error('Hex string has an odd number of digits.')
  if (s.length && !/^[0-9a-fA-F]+$/.test(s)) throw new Error('Hex string contains non-hex characters.')
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16)
  return out
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

// SS58 checksum domain separator, per the Substrate address specification.
const SS58_PREFIX_BYTES = new TextEncoder().encode('SS58PRE')

/**
 * Decode the network prefix from the leading SS58 bytes.
 * Returns { prefix, length } where length is 1 or 2 bytes.
 */
function decodeSs58Prefix(d) {
  if (d[0] < 64) return { prefix: d[0], length: 1 }
  if (d[0] < 128) {
    // Two-byte prefix: 6 low bits of byte0 and 2 high bits of byte1 form the
    // lower byte; the remaining 6 bits of byte1 form the upper byte.
    const lower = ((d[0] & 0b0011_1111) << 2) | (d[1] >> 6)
    const upper = d[1] & 0b0011_1111
    return { prefix: lower | (upper << 8), length: 2 }
  }
  throw new Error('Invalid SS58 address (unsupported network prefix).')
}

/**
 * Decode an SS58-encoded address to its raw 32-byte public key.
 *
 * Verifies the two-byte blake2b checksum. Without it, a single mistyped
 * character usually still decoded to a structurally valid but *different*
 * public key, so the app queried the wrong account and confidently reported a
 * zero balance instead of rejecting the address.
 *
 * @param {string} addr              SS58 address
 * @param {number|null} [expectedPrefix]  Network prefix to enforce, when known.
 * @returns {Uint8Array} 32-byte public key
 */
export function ss58Decode(addr, expectedPrefix = null) {
  if (!addr || typeof addr !== 'string' || addr.length < 25 || addr.length > 50)
    throw new Error('Address length out of range (expected 25–50 characters).')

  const d = base58Decode(addr)
  const { prefix, length: pfxLen } = decodeSs58Prefix(d)

  // Layout: prefix bytes | 32-byte public key | 2-byte checksum
  if (d.length !== pfxLen + 32 + 2)
    throw new Error('Invalid SS58 address (unexpected length).')

  const body     = d.slice(0, pfxLen + 32)
  const checksum = d.slice(pfxLen + 32)
  const expected = blake2b(
    new Uint8Array([...SS58_PREFIX_BYTES, ...body]),
    { dkLen: 64 },
  )
  if (checksum[0] !== expected[0] || checksum[1] !== expected[1])
    throw new Error('Invalid SS58 address (checksum mismatch — check for typos).')

  if (expectedPrefix != null && prefix !== expectedPrefix)
    throw new Error(`Address belongs to network prefix ${prefix}, but ${expectedPrefix} is selected.`)

  return d.slice(pfxLen, pfxLen + 32)
}

/**
 * Build the full System.Account storage key for a given SS58 address.
 * Layout: SYS_ACCT_PREFIX + blake2b_128(pubkey) + pubkey (transparent hash)
 */
export function buildStorageKey(addr, expectedPrefix = null) {
  const pub = ss58Decode(addr, expectedPrefix)
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
  // Readers bounds-check before consuming. Without this a truncated storage
  // value threw a raw `TypeError: Cannot convert undefined to a BigInt`, which
  // callers reported as a generic network error — masking a decoder problem as
  // a connectivity one.
  const need = (n, what) => {
    if (o + n > b.length) {
      throw new Error(`Malformed AccountInfo: need ${n} bytes for ${what} at offset ${o}, have ${b.length - o}.`)
    }
  }
  // Little-endian u32 reader
  const u32 = (what = 'u32') => {
    need(4, what)
    const v = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    o += 4
    return v
  }
  // Little-endian u128 reader
  const u128 = (what = 'u128') => {
    need(16, what)
    let v = 0n
    for (let i = 15; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i])
    o += 16
    return v
  }
  const nonce = u32('nonce')
  u32('consumers')
  u32('sufficients')
  if (b.length >= 80) u32('providers') // new format has an extra u32
  const free     = u128('free')
  const reserved = u128('reserved')
  const field3   = u128('field3')
  const field4   = u128('field4')
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
 * Build the NominationPools.BondedPools storage key prefix (32 bytes).
 * Used with state_getKeysPaged to enumerate all bonded nomination pool IDs.
 * Each full key is prefix (32 bytes) + Twox64Concat(pool_id: u32) (12 bytes).
 */
export function buildBondedPoolsPrefix() {
  return '0x' + _twox128('NominationPools') + _twox128('BondedPools')
}

/**
 * Extract the pool ID (u32) from a full NominationPools.BondedPools storage key.
 * Key layout: 16 bytes (twox128 pallet) + 16 bytes (twox128 item) +
 *             8 bytes (twox64 hash of pool_id) + 4 bytes (pool_id u32 LE)
 * Total = 44 bytes = 88 hex chars + 2 for "0x" prefix.
 */
export function poolIdFromBondedPoolsKey(keyHex) {
  const s = keyHex.startsWith('0x') ? keyHex.slice(2) : keyHex
  if (s.length < 88) return null
  // Last 4 bytes = pool_id as u32 little-endian
  const b0 = parseInt(s.slice(80, 82), 16)
  const b1 = parseInt(s.slice(82, 84), 16)
  const b2 = parseInt(s.slice(84, 86), 16)
  const b3 = parseInt(s.slice(86, 88), 16)
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0
}

/** "modl" — Substrate's module-account prefix. */
const MOD_PREFIX = new Uint8Array([0x6d, 0x6f, 0x64, 0x6c])

/**
 * The `NominationPools.PalletId` runtime constant on the Enjin relaychain:
 * 0x70792f6e6f706c73 = b"py/nopls". Verified by querying the constant directly.
 */
const NOMINATION_POOLS_PALLET_ID = new Uint8Array([0x70, 0x79, 0x2f, 0x6e, 0x6f, 0x70, 0x6c, 0x73])

/** Pool sub-account indices, matching pallet-nomination-pools. */
export const POOL_ACCOUNT_BONDED = 1   // holds the actively staked ENJ (Staking.Ledger key)
export const POOL_ACCOUNT_REWARD = 2   // landing zone for validator payouts

/**
 * Derive a nomination-pool sub-account (AccountId32) for a given pool ID.
 *
 * Mirrors Substrate's `PalletId::into_sub_account`, which builds the account from
 * `TrailingZeroInput` — the seed bytes are written into a 32-byte buffer and the remainder is
 * zero-padded. There is NO hashing step.
 *
 *   b"modl"      = 4 bytes  (module prefix)
 *   b"py/nopls"  = 8 bytes  (NominationPools.PalletId)
 *   index (u8)   = 1 byte   (1 = Bonded, 2 = Reward)
 *   pool_id(u32) = 4 bytes  little-endian
 *   zero padding = 15 bytes
 *
 * Previously this function blake2b-hashed a 17-byte seed, used the wrong PalletId
 * (b"py/nopo\0"), and used index 0. All three were wrong, so `Staking.Ledger` lookups silently
 * returned empty and `activeStake` was always 0n — see
 * docs/nomination_pool_reward_accounting_fix.md.
 *
 * Returns the raw 32-byte account ID as a hex string (no 0x prefix).
 */
export function computePoolBondedAccountId(poolId, index = POOL_ACCOUNT_BONDED) {
  // Substrate's PalletId::into_sub_account uses TrailingZeroInput: the seed bytes are written
  // into a 32-byte buffer and the remainder is ZERO-PADDED. It is NOT hashed.
  const out = new Uint8Array(32)
  out.set(MOD_PREFIX, 0)                       // "modl"                     (4 bytes)
  out.set(NOMINATION_POOLS_PALLET_ID, 4)       // "py/nopls"                 (8 bytes)
  out[12] = index & 0xff                       // sub-account index          (1 byte)
  const id = Number(poolId) >>> 0              // pool_id as u32 LE          (4 bytes)
  out[13] = id & 0xff
  out[14] = (id >>> 8) & 0xff
  out[15] = (id >>> 16) & 0xff
  out[16] = (id >>> 24) & 0xff
  // bytes 17..31 remain zero
  return toHex(out)
}

/**
 * Decode the first u128 field from a SCALE-encoded storage value (little-endian).
 * Works for ValueQuery storage where the raw bytes start with the value directly.
 */
export function decodeU128First(hex) {
  if (!hex || hex === '0x' || hex === null) return 0n
  const b = fromHex(hex)
  if (b.length < 16) return 0n
  let v = 0n
  for (let i = 15; i >= 0; i--) v = (v << 8n) | BigInt(b[i])
  return v
}

/**
 * Decode the first SCALE compact-encoded integer from a raw storage value.
 *
 * pallet-multi-tokens stores both TokenAccounts.balance and Tokens.supply as
 * SCALE compact integers (not fixed-width u128).  The raw bytes returned by
 * state_getStorage therefore start with the compact-encoding header at byte 0:
 *
 *   mode 0b00 (single byte):  value = byte0 >> 2           (0 – 63)
 *   mode 0b01 (two bytes LE): value = u16_le(b[0..1]) >> 2 (64 – 16383)
 *   mode 0b10 (four bytes LE):value = u32_le(b[0..3]) >> 2 (up to ~1 billion)
 *   mode 0b11 (big integer):  byte0 = (n-4)<<2|3, n bytes LE follow (n ≥ 4)
 *
 * Returns the decoded value as BigInt (Planck units).
 */
export function decodeCompactFirst(hex) {
  if (!hex || hex === '0x' || hex === null) return 0n
  const b = fromHex(hex)
  if (!b.length) return 0n
  const mode = b[0] & 0b11
  // Each mode declares how many bytes follow; a truncated value must be an
  // explicit error rather than a TypeError from reading past the end.
  const need = n => {
    if (b.length < n) throw new Error(`Malformed compact integer: mode ${mode} needs ${n} bytes, have ${b.length}.`)
  }
  switch (mode) {
    case 0: return BigInt(b[0] >> 2)
    case 1: need(2); return BigInt(((b[0] | (b[1] << 8)) >>> 0) >> 2)
    case 2: need(4); return BigInt(((b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0) >>> 2)
    default: {  // big integer: header = (n-4)<<2|3, n bytes LE follow
      const n = (b[0] >> 2) + 4
      need(n + 1)
      let v = 0n
      for (let i = n; i >= 1; i--) v = (v << 8n) | BigInt(b[i])
      return v
    }
  }
}

/**
 * Decode a SCALE compact-encoded integer from a Uint8Array at a given byte offset.
 * Returns { value: BigInt, nextOffset: number }.
 * Used to parse variable-offset fields such as StakingLedger.active.
 */
export function decodeCompactAt(bytes, offset) {
  if (offset < 0 || offset >= bytes.length) {
    throw new Error(`Malformed compact integer: offset ${offset} is outside a ${bytes.length}-byte value.`)
  }
  const mode = bytes[offset] & 0b11
  const need = n => {
    if (offset + n > bytes.length) {
      throw new Error(`Malformed compact integer: mode ${mode} needs ${n} bytes at offset ${offset}, have ${bytes.length - offset}.`)
    }
  }
  switch (mode) {
    case 0: return { value: BigInt(bytes[offset] >> 2), nextOffset: offset + 1 }
    case 1: need(2); return { value: BigInt(((bytes[offset] | (bytes[offset + 1] << 8)) >>> 0) >> 2), nextOffset: offset + 2 }
    case 2: need(4); return { value: BigInt(((bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0) >>> 2), nextOffset: offset + 4 }
    default: {  // big integer
      const n = (bytes[offset] >> 2) + 4
      need(n + 1)
      let v = 0n
      for (let i = n; i >= 1; i--) v = (v << 8n) | BigInt(bytes[offset + i])
      return { value: v, nextOffset: offset + 1 + n }
    }
  }
}

/**
 * Build the Staking.Ledger storage key for a given AccountId32 (bonded pool stash).
 *
 * Key layout: twox128("Staking") + twox128("Ledger") + Blake2_128Concat(accountId)
 *
 * @param {string} accountIdHex - 32-byte account ID as a hex string (no 0x prefix)
 * @returns {string} storage key with 0x prefix
 */
export function buildStakingLedgerKey(accountIdHex) {
  const id     = fromHex(accountIdHex)
  const hashed = _b128concat(id)
  const out    = new Uint8Array(32 + hashed.length)
  let off = 0
  out.set(_hexToBytes(_twox128('Staking')), off); off += 16
  out.set(_hexToBytes(_twox128('Ledger')),  off); off += 16
  out.set(hashed, off)
  return '0x' + toHex(out)
}

/**
 * Decode Staking.Ledger raw SCALE bytes to extract the `active` field (actual ENJ staked).
 *
 * StakingLedger layout:
 *   stash:            AccountId32 (32 bytes fixed)
 *   total:            Compact<u128>
 *   active:           Compact<u128>
 *   unlocking + claimedRewards (not decoded)
 *
 * Returns 0n if the raw value is missing or unparseable.
 */
export function decodeStakingLedgerActive(hex) {
  if (!hex || hex === '0x' || hex === null) return 0n
  try {
    // fromHex is inside the try so this function keeps its documented
    // never-throws contract now that malformed hex is rejected rather than
    // silently coerced to zero bytes.
    const bytes = fromHex(hex)
    if (bytes.length < 34) return 0n
    const { nextOffset } = decodeCompactAt(bytes, 32)  // skip stash (32), decode total
    const { value }      = decodeCompactAt(bytes, nextOffset)  // decode active
    return value
  } catch {
    return 0n
  }
}

