/**
 * The shared header on the two legacy export formats.
 *
 * The point of adding it is provenance: before, a Balance Viewer and a Reward
 * History export were told apart only by guessing at their shape, and their
 * encrypted forms were indistinguishable. The point of adding it *this* way —
 * spread across the existing flat payload rather than wrapping it — is that a
 * build predating the header still reads a new file. Both halves are asserted
 * here, in both directions.
 */
import { describe, it, expect } from 'vitest'
import {
  toJSON, toCSV, toXML, parseImport,
  aesEncrypt, aesEncryptLabelled, aesDecrypt,
} from './balanceExport.js'
import {
  SCAN_TOOL_ID, SCAN_SCHEMAS, SCAN_SCHEMA_VERSION,
  ScanImportError, readLegacyHeader,
} from './scanEnvelope.js'
import { parseRewardImport } from '../components/RewardHistoryViewer.jsx'

const RECORDS = [
  { block: 100, blockHash: `0x${'a'.repeat(64)}`, free: 1_000_000_000_000_000_000n, reserved: 0n, miscFrozen: 0n, feeFrozen: 0n, nonce: 1, newFormat: true },
  { block: 200, blockHash: `0x${'b'.repeat(64)}`, free: 2_000_000_000_000_000_000n, reserved: 0n, miscFrozen: 0n, feeFrozen: 0n, nonce: 2, newFormat: true },
]
const RPC_META = { endpoint: 'wss://archive', address: 'enBalanceAddr', exportedAt: '2026-09-03T12:00:00.000Z' }

const REWARD_HEADER = 'era,pool_id,pool_label,era_start_block,era_date_utc,member_senj,pool_supply_senj,reinvested_enj,reward_enj,cumulative_enj,apy_pct,rolling_apy_pct'

describe('balance JSON', () => {
  it('carries the header without moving records or _rpcConfig', () => {
    const file = JSON.parse(toJSON(RECORDS, RPC_META))
    expect(file).toMatchObject({
      tool: SCAN_TOOL_ID,
      schema: SCAN_SCHEMAS.BALANCE,
      schemaVersion: SCAN_SCHEMA_VERSION,
    })
    expect(typeof file.appVersion).toBe('string')
    // The whole forward-compatibility argument: an older build reads these two
    // keys at the root, and they are still at the root.
    expect(Array.isArray(file.records)).toBe(true)
    expect(file.records).toHaveLength(2)
    expect(file._rpcConfig).toEqual(RPC_META)
  })

  it('round-trips, reporting the header it read', () => {
    const { records, rpcConfig, header } = parseImport(toJSON(RECORDS, RPC_META), 'json')
    expect(records).toHaveLength(2)
    expect(records[0].free).toBe(1_000_000_000_000_000_000n)
    expect(rpcConfig).toEqual(RPC_META)
    expect(header).toMatchObject({ schema: SCAN_SCHEMAS.BALANCE, schemaVersion: 1 })
  })

  // The reason the fallback exists. This is the shape written before the
  // header, and it must keep importing.
  it('still imports a headerless legacy file', () => {
    const legacy = JSON.stringify({
      _rpcConfig: RPC_META,
      records: [{ block: 1, blockHash: `0x${'c'.repeat(64)}`, free: '5', reserved: '0', miscFrozen: '0', feeFrozen: '0', nonce: 0 }],
    })
    const { records, header } = parseImport(legacy, 'json')
    expect(records).toHaveLength(1)
    expect(records[0].free).toBe(5n)
    expect(header).toBeNull()   // no header → caller's own sniff decided
  })

  it('still imports a bare records array', () => {
    const bare = JSON.stringify([
      { block: 1, blockHash: `0x${'d'.repeat(64)}`, free: '7', reserved: '0', miscFrozen: '0', feeFrozen: '0', nonce: 0 },
    ])
    expect(parseImport(bare, 'json').records[0].free).toBe(7n)
  })

  it('refuses a Reward History file by name', () => {
    const rewardFile = JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.REWARD, schemaVersion: 1,
      _meta: { address: 'en1' }, records: [{ era: 1170, pool_id: 14 }],
    })
    expect(() => parseImport(rewardFile, 'json')).toThrow(ScanImportError)
    expect(() => parseImport(rewardFile, 'json'))
      .toThrow(/This is a Reward History export\. Import it from that tool, not Balance Viewer/)
  })

  it('refuses a scan export by name', () => {
    const scanFile = JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.POOL, schemaVersion: 1, meta: {}, data: { pools: [] },
    })
    expect(() => parseImport(scanFile, 'json'))
      .toThrow(/Staking Cadence \(pool mode\) export/)
  })

  it('refuses a newer schema version', () => {
    const future = JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.BALANCE,
      schemaVersion: SCAN_SCHEMA_VERSION + 1, _rpcConfig: RPC_META, records: [],
    })
    expect(() => parseImport(future, 'json')).toThrow(/schema version 2/)
  })
})

describe('balance CSV and XML', () => {
  it('keeps the original marker line first in CSV', () => {
    const csv = toCSV(RECORDS, RPC_META)
    expect(csv.split('\r\n')[0]).toBe('# enjin_balance_export')
    expect(csv).toContain(`# tool: ${SCAN_TOOL_ID}`)
    expect(csv).toContain(`# schema: ${SCAN_SCHEMAS.BALANCE}`)
  })

  it('round-trips CSV and reads its header from the comments', () => {
    const { records, rpcConfig, header } = parseImport(toCSV(RECORDS, RPC_META), 'csv')
    expect(records).toHaveLength(2)
    expect(records[1].free).toBe(2_000_000_000_000_000_000n)
    expect(rpcConfig.address).toBe('enBalanceAddr')
    expect(header).toMatchObject({ schema: SCAN_SCHEMAS.BALANCE })
  })

  it('still imports a CSV with no header comments', () => {
    const legacy = [
      '# enjin_balance_export',
      '# address: enOld',
      'block,blockHash,free,reserved,miscFrozen,feeFrozen,nonce',
      `1,0x${'e'.repeat(64)},9,0,0,0,0`,
    ].join('\r\n')
    const { records, header } = parseImport(legacy, 'csv')
    expect(records[0].free).toBe(9n)
    expect(header).toBeNull()
  })

  it('refuses a CSV whose header names another tool', () => {
    const wrong = [
      '# enjin_balance_export',
      `# tool: ${SCAN_TOOL_ID}`,
      `# schema: ${SCAN_SCHEMAS.REWARD}`,
      '# schemaVersion: 1',
      'block,free,reserved',
      '1,5,0',
    ].join('\r\n')
    expect(() => parseImport(wrong, 'csv')).toThrow(/Reward History export/)
  })

  it('puts the header inside <rpcConfig> in XML', () => {
    const xml = toXML(RECORDS, RPC_META)
    expect(xml).toContain(`<tool>${SCAN_TOOL_ID}</tool>`)
    expect(xml).toContain(`<schema>${SCAN_SCHEMAS.BALANCE}</schema>`)
    expect(xml).toContain('<enjinBalanceHistory>')
  })
})

describe('reward history', () => {
  const results = [{
    era: 1170, poolId: 14, poolLabel: 'Pool 14, Reserve', eraStartBlock: 100,
    eraStartDateUtc: '2026-01-01', memberBalance: 0n, poolSupply: 0n,
    reinvested: 0n, reward: 1_000_000_000_000_000_000n, accumulated: 0n,
    apy: 5.5, rollingApy: undefined,
  }]

  it('still imports a headerless legacy JSON file', () => {
    const legacy = JSON.stringify({
      _meta: { address: 'en1', exportedAt: 'now' },
      records: [{ era: 1170, pool_id: 14, reward_enj: '5' }],
    })
    const { results: rows, header } = parseRewardImport(legacy, 'json')
    expect(rows[0].reward).toBe(5n)
    expect(header).toBeNull()
  })

  it('reads the header from a current JSON file', () => {
    const current = JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.REWARD, schemaVersion: 1, appVersion: '1.0.0',
      _meta: { address: 'en1' }, records: [{ era: 1170, pool_id: 14, reward_enj: '5' }],
    })
    expect(parseRewardImport(current, 'json').header)
      .toMatchObject({ schema: SCAN_SCHEMAS.REWARD, appVersion: '1.0.0' })
  })

  it('refuses a Balance Viewer file by name', () => {
    const balanceFile = toJSON(RECORDS, RPC_META)
    expect(() => parseRewardImport(balanceFile, 'json')).toThrow(ScanImportError)
    expect(() => parseRewardImport(balanceFile, 'json'))
      .toThrow(/This is a Balance Viewer export\. Import it from that tool, not Reward History/)
  })

  it('still imports a headerless legacy CSV', () => {
    const legacy = [
      '# enjin_reward_history_export',
      '# address: en1',
      REWARD_HEADER,
      '1170,14,"Pool 14",100,2026-01-01,0,0,0,1000000000000000000,0,5.5,',
    ].join('\r\n')
    const { results: rows, header } = parseRewardImport(legacy, 'csv')
    expect(rows[0].reward).toBe(1_000_000_000_000_000_000n)
    expect(header).toBeNull()
  })

  it('refuses a CSV whose header names another tool', () => {
    const wrong = [
      '# enjin_reward_history_export',
      `# tool: ${SCAN_TOOL_ID}`,
      `# schema: ${SCAN_SCHEMAS.BALANCE}`,
      '# schemaVersion: 1',
      REWARD_HEADER,
      '1170,14,"Pool 14",100,2026-01-01,0,0,0,1000000000000000000,0,5.5,',
    ].join('\r\n')
    expect(() => parseRewardImport(wrong, 'csv')).toThrow(/Balance Viewer export/)
  })

  it('exposes the poolLabel comma round-trip alongside the header', () => {
    // Not a header test as such, but the two changes touch the same writer.
    const { results: rows } = parseRewardImport(
      JSON.stringify({
        tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.REWARD, schemaVersion: 1,
        _meta: { address: 'en1' },
        records: [{ era: 1170, pool_id: 14, pool_label: results[0].poolLabel, reward_enj: '5' }],
      }), 'json')
    expect(rows[0].poolLabel).toBe('Pool 14, Reserve')
  })
})

describe('encrypted files', () => {
  const PW = 'correct horse'

  it('labels the ciphertext without moving the fields aesDecrypt reads', async () => {
    const enc = JSON.parse(await aesEncryptLabelled('{"hello":1}', PW, SCAN_SCHEMAS.BALANCE))
    expect(enc).toMatchObject({
      tool: SCAN_TOOL_ID,
      schema: SCAN_SCHEMAS.BALANCE,
      encrypted: true,
      algorithm: 'AES-256-GCM',
    })
    expect(enc.kdf).toMatch(/^PBKDF2-SHA256-\d+$/)
    expect(typeof enc.data).toBe('string')
  })

  it('decrypts with the unchanged aesDecrypt', async () => {
    const enc = await aesEncryptLabelled('{"hello":1}', PW, SCAN_SCHEMAS.BALANCE)
    await expect(aesDecrypt(enc, PW)).resolves.toBe('{"hello":1}')
  })

  it('still decrypts an unlabelled legacy ciphertext', async () => {
    const legacy = await aesEncrypt('{"legacy":true}', PW)
    expect(JSON.parse(legacy).tool).toBeUndefined()
    await expect(aesDecrypt(legacy, PW)).resolves.toBe('{"legacy":true}')
  })

  // The cross-tool confusion this fixes: previously every tool's .enc.json was
  // identical, so the wrong importer prompted for a password and only failed
  // after a successful decrypt.
  it('lets an importer refuse another tool\'s encrypted file before prompting', async () => {
    const rewardEnc = JSON.parse(await aesEncryptLabelled('{}', PW, SCAN_SCHEMAS.REWARD))
    expect(() => readLegacyHeader(rewardEnc, SCAN_SCHEMAS.BALANCE))
      .toThrow(/Reward History export/)
    // And its own importer accepts it.
    expect(readLegacyHeader(rewardEnc, SCAN_SCHEMAS.REWARD))
      .toMatchObject({ schema: SCAN_SCHEMAS.REWARD })
  })

  it('leaves an unlabelled legacy ciphertext for the sniff to handle', async () => {
    const legacy = JSON.parse(await aesEncrypt('{}', PW))
    // No header at all, so no verdict either way — this is the residual case
    // the content sniff still covers.
    expect(readLegacyHeader(legacy, SCAN_SCHEMAS.BALANCE)).toBeNull()
  })

  it('carries the authoritative header inside the plaintext', async () => {
    const enc = await aesEncryptLabelled(toJSON(RECORDS, RPC_META), PW, SCAN_SCHEMAS.BALANCE)
    // The outer label is a routing hint outside the AEAD; the plaintext's own
    // header is what parseImport validates.
    const plain = await aesDecrypt(enc, PW)
    expect(parseImport(plain, 'json').header).toMatchObject({ schema: SCAN_SCHEMAS.BALANCE })
  })
})
