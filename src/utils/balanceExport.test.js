import { describe, it, expect } from 'vitest'
import { parseBigInt, aesEncrypt, aesDecrypt, parseImport, defaultRewardFilename } from './balanceExport.js'

describe('defaultRewardFilename', () => {
  it('uses the first 10 characters of the address', () => {
    const name = defaultRewardFilename('enDr55GTVDWok78KBZgt5N86WNEy55bmMMeC9JsKAaPtiQnct')
    expect(name.startsWith('reward-history-enDr55GTVD-')).toBe(true)
  })

  it('falls back to "enjin" when no address is given', () => {
    expect(defaultRewardFilename('')).toMatch(/^reward-history-enjin-\d+$/)
    expect(defaultRewardFilename(undefined)).toMatch(/^reward-history-enjin-\d+$/)
  })

  it('embeds a millisecond timestamp, matching the format the export used before this fix', () => {
    // Before this fix, the export used Date.now() (ms) but the placeholder
    // shown to the user was missing the timestamp entirely — the two must
    // now be the exact same string.
    const name = defaultRewardFilename('short')
    const ts = Number(name.split('-').pop())
    expect(ts).toBeGreaterThan(1_700_000_000_000) // sanity: looks like ms, not seconds
  })
})

describe('parseBigInt', () => {
  it('parses non-negative integers', () => {
    expect(parseBigInt('0')).toBe(0n)
    expect(parseBigInt('1000000000000000000')).toBe(1000000000000000000n)
    expect(parseBigInt('')).toBe(0n)
    expect(parseBigInt(null)).toBe(0n)
  })

  // The regression: stripping non-digits silently changed values instead of
  // rejecting them, inflating decimal figures by 10^k on import.
  it('rejects negatives instead of dropping the sign', () => {
    expect(() => parseBigInt('-5')).toThrow(/not a non-negative integer/)
  })
  it('rejects decimals instead of removing the point', () => {
    expect(() => parseBigInt('1.234')).toThrow(/not a non-negative integer/)
  })
  it('rejects mixed alphanumerics instead of extracting digits', () => {
    expect(() => parseBigInt('12abc34')).toThrow(/not a non-negative integer/)
  })
  it('names the offending field', () => {
    expect(() => parseBigInt('1.5', { field: 'free' })).toThrow(/Invalid free/)
  })
})

describe('CSV import', () => {
  const header = 'block,blockHash,free,reserved,miscFrozen,feeFrozen,nonce'
  const hash = '0x' + 'ab'.repeat(32)

  it('imports a well-formed file', () => {
    const csv = `${header}\n100,${hash},500,10,0,0,1`
    const { records } = parseImport(csv, 'csv')
    expect(records).toHaveLength(1)
    expect(records[0].free).toBe(500n)
    expect(records[0].block).toBe(100)
  })

  // The regression: a missing column produced index -1 -> undefined -> 0n, so a
  // header mismatch yielded N all-zero records rather than an error.
  it('rejects a header mismatch instead of zeroing every balance', () => {
    const csv = 'blk,hash,amount\n100,0xabc,500'
    expect(() => parseImport(csv, 'csv')).toThrow(/missing required column/i)
  })

  it('reports the offending row number for a bad value', () => {
    const csv = `${header}\n100,${hash},500,10,0,0,1\n101,${hash},1.5,10,0,0,1`
    expect(() => parseImport(csv, 'csv')).toThrow(/row 3/)
  })

  // The regression: quotes were stripped before splitting on commas, so a
  // quoted field containing a comma corrupted the whole row.
  it('honours quoted fields containing commas', () => {
    const csv = `${header},note\n100,${hash},500,10,0,0,1,"a,b,c"`
    const { records } = parseImport(csv, 'csv')
    expect(records[0].free).toBe(500n)
    expect(records[0].nonce).toBe(1)
  })
})

describe('AES-256-GCM round trip', () => {
  it('round-trips a small payload', async () => {
    const enc = await aesEncrypt('hello world', 'pw')
    expect(await aesDecrypt(enc, 'pw')).toBe('hello world')
  })

  it('fails on the wrong password', async () => {
    const enc = await aesEncrypt('secret', 'right')
    await expect(aesDecrypt(enc, 'wrong')).rejects.toBeTruthy()
  })

  it('records the current iteration count', async () => {
    const enc = await aesEncrypt('x', 'pw')
    expect(JSON.parse(enc).kdf).toBe('PBKDF2-SHA256-600000')
    expect(JSON.parse(enc).v).toBe(2)
  })

  // The regression: btoa(String.fromCharCode(...bytes)) threw RangeError above
  // ~100k elements, so encryption failed on exactly the large exports that most
  // warrant it. A 2,000-block export is roughly 500 KB.
  it('round-trips a 500 KB payload without RangeError', async () => {
    const big = JSON.stringify({ rows: Array.from({ length: 12000 }, (_, i) => ({ block: i, free: '1'.repeat(19) })) })
    expect(big.length).toBeGreaterThan(400_000)
    const enc = await aesEncrypt(big, 'pw')
    expect(await aesDecrypt(enc, 'pw')).toBe(big)
  })

  // Header binding: tampering with the recorded metadata must fail the GCM tag.
  it('detects tampering with the authenticated header', async () => {
    const obj = JSON.parse(await aesEncrypt('payload', 'pw'))
    obj.kdf = 'PBKDF2-SHA256-1000'   // claim a far weaker KDF
    await expect(aesDecrypt(JSON.stringify(obj), 'pw')).rejects.toBeTruthy()
  })
})
