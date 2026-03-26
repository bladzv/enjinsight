import { describe, it, expect } from 'vitest'
import { decodeCompactFirst, decodeU128First } from './substrate.js'

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
