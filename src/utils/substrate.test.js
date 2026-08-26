import { describe, it, expect } from 'vitest'
import {
  decodeCompactFirst, decodeU128First, computePoolBondedAccountId,
  POOL_ACCOUNT_BONDED, POOL_ACCOUNT_REWARD,
  fromHex, toHex, ss58Decode, buildStorageKey,
  decodeAccountInfo, decodeCompactAt, decodeStakingLedgerActive,
} from './substrate.js'

// ── decodeCompactFirst ─────────────────────────────────────────────────────
// Tests use raw hex values observed from the archive node (era 1000).

describe('decodeCompactFirst', () => {
  it('returns 0n for null/empty/zero inputs', () => {
    expect(decodeCompactFirst(null)).toBe(0n)
    expect(decodeCompactFirst('0x')).toBe(0n)
    expect(decodeCompactFirst('')).toBe(0n)
    expect(decodeCompactFirst('0x00')).toBe(0n)
  })

  it('decodes mode-0 (single byte) compact integers', () => {
    expect(decodeCompactFirst('0x00')).toBe(0n)   // 0: byte=0x00
    expect(decodeCompactFirst('0x04')).toBe(1n)   // 1: byte=0x04
    expect(decodeCompactFirst('0xfc')).toBe(63n)  // 63: byte=0xfc
  })

  it('decodes mode-1 (two byte) compact integers', () => {
    // 64: encoded as LE u16 = 64<<2|1 = 257 = 0x0101
    expect(decodeCompactFirst('0x0101')).toBe(64n)
    // 255: encoded as 255<<2|1 = 1021 = 0x03fd
    expect(decodeCompactFirst('0xfd03')).toBe(255n)
  })

  it('decodes mode-2 (four byte) compact integers', () => {
    // 16384: encoded as 16384<<2|2 = 65538 = LE [0x02,0x00,0x01,0x00]
    expect(decodeCompactFirst('0x02000100')).toBe(16384n)
  })

  it('decodes mode-3 (big integer) compact integers — Pool 14 member balance at era 1000', () => {
    // Raw TokenAccounts bytes for pool 14: header 0x13 (n=8), then 8 LE bytes of balance
    // Python-decoded balance: 3824093834278634699
    const raw14 = '0x13cb84f0d314e91135000000000000000005'
    expect(decodeCompactFirst(raw14)).toBe(3824093834278634699n)
  })

  it('decodes mode-3 (big integer) compact integers — Pool 18 member balance at era 1000', () => {
    // Raw TokenAccounts bytes for pool 18: header 0x17 (n=9), then 9 LE bytes of balance
    // Python-decoded balance: 2800220594351952451904
    const raw18 = '0x17405955c95b02decc97000000000000000005'
    expect(decodeCompactFirst(raw18)).toBe(2800220594351952451904n)
  })

  it('ignores trailing bytes (only decodes the first compact integer)', () => {
    // Only the first compact value matters; trailing bytes are struct fields
    expect(decodeCompactFirst('0x04ff')).toBe(1n)  // value=1, trailing 0xff ignored
  })
})

// ── decodeU128First ────────────────────────────────────────────────────────
describe('decodeU128First', () => {
  it('returns 0n for null/empty inputs', () => {
    expect(decodeU128First(null)).toBe(0n)
    expect(decodeU128First('0x')).toBe(0n)
  })

  it('decodes a 16-byte little-endian u128', () => {
    // 1n stored as u128 LE: [0x01, 0x00, ..., 0x00]
    const hex = '0x' + '01' + '00'.repeat(15)
    expect(decodeU128First(hex)).toBe(1n)
  })
})

// ── computePoolBondedAccountId ──────────────────────────────────────────────
// Substrate PalletId::into_sub_account = "modl" + PalletId + index + poolId(u32 LE),
// zero-padded to 32 bytes. NOT hashed. PalletId is b"py/nopls" (runtime constant
// NominationPools.PalletId = 0x70792f6e6f706c73), and the bonded sub-account is index 1.
describe('computePoolBondedAccountId', () => {
  const MODL = '6d6f646c'
  const PID  = '70792f6e6f706c73'   // "py/nopls"
  const PAD  = '00'.repeat(15)

  it('derives the bonded account by zero-padding, not hashing', () => {
    // pool 14 -> 0x0e000000 little-endian, index 1
    expect(computePoolBondedAccountId(14)).toBe(`${MODL}${PID}01${'0e000000'}${PAD}`)
  })

  it('returns a 32-byte account id (64 hex chars, no 0x prefix)', () => {
    const hex = computePoolBondedAccountId(14)
    expect(hex).toHaveLength(64)
    expect(hex.startsWith('0x')).toBe(false)
  })

  it('encodes pool_id as u32 little-endian', () => {
    // 258 = 0x00000102 -> LE bytes 02 01 00 00
    expect(computePoolBondedAccountId(258)).toBe(`${MODL}${PID}01${'02010000'}${PAD}`)
  })

  it('defaults to the bonded index (1) and supports the reward index (2)', () => {
    expect(computePoolBondedAccountId(14)).toBe(computePoolBondedAccountId(14, POOL_ACCOUNT_BONDED))
    expect(POOL_ACCOUNT_BONDED).toBe(1)
    expect(POOL_ACCOUNT_REWARD).toBe(2)
    expect(computePoolBondedAccountId(14, POOL_ACCOUNT_REWARD))
      .toBe(`${MODL}${PID}02${'0e000000'}${PAD}`)
  })

  it('does not regress to the old blake2b derivation', () => {
    // The old implementation hashed a 17-byte seed with the wrong PalletId and index 0.
    // Its output began with neither "modl" nor the PalletId.
    const hex = computePoolBondedAccountId(14)
    expect(hex.startsWith(MODL)).toBe(true)
    expect(hex.slice(8, 24)).toBe(PID)
  })
})

// ── Phase 3: input validation and decoder bounds ───────────────────────────
// The decoder values above are ground truth verified against substrate-interface;
// the bounds checks added below must not change any of them.

const RELAY_ADDR = 'enDr55GTVDWok78KBZgt5N86WNEy55bmMMeC9JsKAaPtiQnct'
const RELAY_PUB  = '8c0a46dcb2070c915054d17f97bd06f3cba46d292d4a8dc2592e335108967827'
const RELAY_PREFIX = 2135   // Enjin Relaychain

describe('fromHex validation', () => {
  it('decodes valid hex with and without 0x', () => {
    expect(toHex(fromHex('0xdeadbeef'))).toBe('deadbeef')
    expect(toHex(fromHex('deadbeef'))).toBe('deadbeef')
    expect(fromHex('0x')).toHaveLength(0)
  })
  // Regression: parseInt over arbitrary text yielded NaN, stored as 0, so
  // corrupt input became plausible-looking zero balances instead of an error.
  it('rejects non-hex characters instead of yielding zeros', () => {
    expect(() => fromHex('zz')).toThrow(/non-hex/)
  })
  it('rejects odd-length input instead of dropping a nibble', () => {
    expect(() => fromHex('abc')).toThrow(/odd number/)
  })
})

describe('ss58Decode', () => {
  it('decodes a valid address to its public key', () => {
    expect(toHex(ss58Decode(RELAY_ADDR))).toBe(RELAY_PUB)
  })

  // Regression: without checksum verification a single mistyped character still
  // decoded to a structurally valid but DIFFERENT public key, so the app queried
  // the wrong account and reported a confident zero balance.
  it('rejects a single-character typo', () => {
    const i = 20
    const typo = RELAY_ADDR.slice(0, i) + (RELAY_ADDR[i] === 'A' ? 'B' : 'A') + RELAY_ADDR.slice(i + 1)
    expect(typo).not.toBe(RELAY_ADDR)
    expect(() => ss58Decode(typo)).toThrow(/checksum/i)
  })

  it('enforces the network prefix when one is supplied', () => {
    expect(toHex(ss58Decode(RELAY_ADDR, RELAY_PREFIX))).toBe(RELAY_PUB)
    // 1110 is Enjin Matrixchain — a relaychain address must not pass as one.
    expect(() => ss58Decode(RELAY_ADDR, 1110)).toThrow(/network prefix/)
  })

  it('rejects malformed input', () => {
    expect(() => ss58Decode('')).toThrow()
    expect(() => ss58Decode('too-short')).toThrow()
    expect(() => ss58Decode(RELAY_ADDR + 'xx')).toThrow()
  })

  it('is enforced through buildStorageKey', () => {
    expect(buildStorageKey(RELAY_ADDR)).toMatch(/^0x[0-9a-f]+$/)
    expect(() => buildStorageKey(RELAY_ADDR.slice(0, -2) + 'AA')).toThrow(/checksum/i)
  })
})

describe('compact decoder bounds', () => {
  // Regression: reading past the end threw a raw TypeError that callers reported
  // as a generic network error, masking a decoder bug as a connectivity problem.
  it('raises a diagnostic error on a truncated big-integer value', () => {
    expect(() => decodeCompactFirst('0x13ffff')).toThrow(/Malformed compact integer/)
  })
  it('raises a diagnostic error on a truncated two-byte value', () => {
    expect(() => decodeCompactFirst('0x15')).toThrow(/Malformed compact integer/)
  })
  it('reports the next offset and rejects out-of-range offsets', () => {
    expect(decodeCompactAt(fromHex('0x04'), 0)).toEqual({ value: 1n, nextOffset: 1 })
    expect(() => decodeCompactAt(fromHex('0x04'), 5)).toThrow(/outside a/)
  })
})

describe('decodeAccountInfo', () => {
  it('returns zeros for empty storage', () => {
    expect(decodeAccountInfo('0x').free).toBe(0n)
    expect(decodeAccountInfo(null).free).toBe(0n)
  })
  // Regression: threw `Cannot convert undefined to a BigInt`.
  it('raises a diagnostic error on truncated storage', () => {
    expect(() => decodeAccountInfo('0x' + '00'.repeat(8))).toThrow(/Malformed AccountInfo/)
  })
})

describe('decodeStakingLedgerActive', () => {
  // Documented contract: never throws, returns 0n when unparseable.
  it('returns 0n rather than throwing on malformed input', () => {
    expect(decodeStakingLedgerActive('0x')).toBe(0n)
    expect(decodeStakingLedgerActive('0xzz')).toBe(0n)
    expect(decodeStakingLedgerActive('0x' + '00'.repeat(10))).toBe(0n)
  })
})
