import { describe, it, expect } from 'vitest'
import { toJSON as balanceToJSON } from './balanceExport.js'
import {
  SCAN_TOOL_ID,
  SCAN_SCHEMAS,
  SCAN_SCHEMA_VERSION,
  ScanImportError,
  parseEnvelope,
  peekEnvelope,
  isEncryptedEnvelope,
  defaultScanFilename,
  encryptScanFile,
  decryptScanFile,
  exportValidatorScan,
  importValidatorScan,
  exportPoolScan,
  importPoolScan,
  exportInfusionScan,
  importInfusionScan,
} from './scanExport.js'

// Larger than Number.MAX_SAFE_INTEGER, so any round-trip through a float loses
// digits. Every balance field is checked against a value of this size.
const HUGE = 123456789012345678901234567890n

const validatorState = {
  requestedEraCount: 3,
  validators: [
    {
      address: 'enDr55GTVDWok78KBZgt5N86WNEy55bmMMeC9JsKAaPtiQnct',
      display: 'Validator One',
      commission: 5.25,
      bondedTotal: HUGE,
      countNominators: 42,
      isActive: true,
      fetchStatus: 'done',
      lastError: null,
      nominators: [{ address: 'enNom1', display: 'Nom', bonded: 7n }],
      eraStat: [{
        era: 1170,
        reward: HUGE,
        validatorStake: 1n,
        nominatorStake: 0n,
        startBlock: 100,
        endBlock: 200,
        rewardPoint: 30,
        blocksProduced: 4,
      }],
    },
  ],
}

const poolState = {
  requestedEraCount: 2,
  provisionalEra: 1171,
  completedEras: [1171, 1170],
  latestCompletedEra: 1171,
  pools: [
    {
      poolId: 14,
      metadata: 'Pool, with a comma',
      state: 'Open',
      stashAddress: 'enStash14',
      stashDisplay: '',
      rewardAddress: 'enReward14',
      rewardDisplay: '',
      memberCount: 9,
      totalBonded: HUGE,
      commission: 1.5,
      fetchStatus: 'done',
      nominatedValidators: [
        { address: 'enVal1', display: 'V1', bonded: 5n, isActive: true, fetchStatus: 'done', retryAttempts: 0, lastError: null },
      ],
      eraRewards: [
        { era: 1171, amount: HUGE.toString(), blockTimestamp: 1700000000, eventIndex: '1-2', validatorStash: 'enVal1' },
      ],
      missedEras: [1170],
      eraValidatorBreakdown: new Map([[1171, { rewarded: [], unrewarded: [] }]]),
    },
  ],
}

const infusionState = {
  mode: 'wallet',
  walletAddress: '0xabc',
  tokenId: '',
  amount: '12.0000',
  rawValue: 'Total raw infusion: 12000000000000000000',
  bulkStatus: 'Checked 2 of 2 token IDs.',
  bulkTotal: '12.0000',
  bulkStarted: true,
  bulkExpectedTotal: 2,
  scanOutcome: { kind: 'done', stage: 'bulk', message: 'ok', mode: 'wallet' },
  rows: [
    {
      tokenId: '1',
      amount: '12.0000',
      raw: '12000000000000000000',
      error: false,
      metadata: { name: 'Tok', previewImage: 'https://example.com/a.png', tokenUri: 'ipfs://cid' },
      metadataError: null,
    },
    // A failed row: `raw` is prose, not a number. It must survive verbatim.
    {
      tokenId: '2',
      amount: 'Failed',
      raw: 'See terminal log',
      error: true,
      metadata: null,
      metadataError: null,
      errorMessage: 'boom',
    },
  ],
}

describe('envelope', () => {
  it('stamps tool, schema and version on every export', () => {
    for (const [state, exporter, schema] of [
      [validatorState, exportValidatorScan, SCAN_SCHEMAS.VALIDATOR],
      [poolState, exportPoolScan, SCAN_SCHEMAS.POOL],
      [infusionState, exportInfusionScan, SCAN_SCHEMAS.INFUSION],
    ]) {
      const env = JSON.parse(exporter(state))
      expect(env.tool).toBe(SCAN_TOOL_ID)
      expect(env.schema).toBe(schema)
      expect(env.schemaVersion).toBe(SCAN_SCHEMA_VERSION)
      expect(env.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      // Injected by vite.config.js's `define` from package.json — additive
      // and informational, so it must not gate anything a reader checks.
      expect(typeof env.appVersion).toBe('string')
      expect(env.appVersion.length).toBeGreaterThan(0)
    }
  })

  it('carries appVersion through import without gating on it', () => {
    const back = importValidatorScan(exportValidatorScan(validatorState))
    expect(back.appVersion).toBe(JSON.parse(exportValidatorScan(validatorState)).appVersion)

    // A file with no appVersion at all (e.g. a hand-edited or older file)
    // must still import — it is informational only.
    const noVersion = JSON.parse(exportValidatorScan(validatorState))
    delete noVersion.appVersion
    expect(() => importValidatorScan(JSON.stringify(noVersion))).not.toThrow()
    expect(importValidatorScan(JSON.stringify(noVersion)).appVersion).toBeNull()
  })

  it('names the schema in the default filename', () => {
    expect(defaultScanFilename(SCAN_SCHEMAS.VALIDATOR)).toMatch(/^enjin_staking_validator_\d+$/)
    expect(defaultScanFilename(SCAN_SCHEMAS.POOL)).toMatch(/^enjin_staking_pool_\d+$/)
    expect(defaultScanFilename(SCAN_SCHEMAS.INFUSION)).toMatch(/^enjin_infusion_\d+$/)
  })

  it('peeks the header without validating the payload', () => {
    const peek = peekEnvelope(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.POOL, schemaVersion: 1, exportedAt: 'x',
    }))
    expect(peek).toMatchObject({ schema: SCAN_SCHEMAS.POOL, schemaVersion: 1, encrypted: false })
  })
})

describe('import rejection', () => {
  const reject = (text, schema, match) => {
    expect(() => parseEnvelope(text, schema)).toThrow(ScanImportError)
    expect(() => parseEnvelope(text, schema)).toThrow(match)
  }

  it('rejects text that is not JSON', () => {
    reject('not json at all', SCAN_SCHEMAS.POOL, /not valid JSON/)
  })

  it('rejects a JSON array at the root', () => {
    reject('[]', SCAN_SCHEMAS.POOL, /not an EnjinSight scan export/)
  })

  it('rejects a file from another tool', () => {
    reject(JSON.stringify({ tool: 'something-else', schema: SCAN_SCHEMAS.POOL }),
      SCAN_SCHEMAS.POOL, /not an EnjinSight scan export/)
  })

  // A current Balance Viewer export carries the shared header, so it is
  // refused *by name* rather than with the generic "not ours" message.
  it('rejects a Balance Viewer export, naming it', () => {
    const balanceFile = balanceToJSON(
      [{ block: 1, blockHash: '0x00', free: 1n, reserved: 0n, miscFrozen: 0n, feeFrozen: 0n, nonce: 0 }],
      { endpoint: 'wss://x', address: 'en1', exportedAt: 'now' },
    )
    reject(balanceFile, SCAN_SCHEMAS.POOL,
      /This is a Balance Viewer export\. Import it from that tool, not Staking Cadence \(pool mode\)/)
    expect(() => importValidatorScan(balanceFile)).toThrow(ScanImportError)
    expect(() => importInfusionScan(balanceFile)).toThrow(ScanImportError)
  })

  // An export predating the shared header has no `tool` marker, so it can only
  // be refused generically. This is the case the legacy sniff fallback exists
  // for on the Balance/Reward side.
  it('rejects a headerless legacy export generically', () => {
    const legacyFile = JSON.stringify({
      _meta: { address: 'en1', exportedAt: 'now' },
      records: [{ era: 1170, pool_id: 14, amount: '5' }],
    })
    reject(legacyFile, SCAN_SCHEMAS.POOL, /not an EnjinSight scan export/)
  })

  it('rejects the right tool but the wrong scan, naming both', () => {
    reject(exportPoolScan(poolState), SCAN_SCHEMAS.VALIDATOR,
      /Staking Cadence \(pool mode\) export.*not Staking Cadence \(validator mode\)/)
  })

  it('rejects an unrecognised schema', () => {
    reject(JSON.stringify({ tool: SCAN_TOOL_ID, schema: 'future-tool', schemaVersion: 1 }),
      SCAN_SCHEMAS.POOL, /Unrecognised export type "future-tool"/)
  })

  it('rejects a newer schema version', () => {
    reject(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.POOL,
      schemaVersion: SCAN_SCHEMA_VERSION + 1, data: { pools: [] },
    }), SCAN_SCHEMAS.POOL, /schema version 2.*understands up to 1/)
  })

  it('rejects a missing or invalid schema version', () => {
    reject(JSON.stringify({ tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.POOL, data: { pools: [] } }),
      SCAN_SCHEMAS.POOL, /missing a valid schema version/)
  })

  it('rejects a missing data section', () => {
    reject(JSON.stringify({ tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.POOL, schemaVersion: 1 }),
      SCAN_SCHEMAS.POOL, /no data section/)
  })

  it('rejects a data section with the wrong array', () => {
    expect(() => importPoolScan(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.POOL, schemaVersion: 1, data: { validators: [] },
    }))).toThrow(/no pool list/)
  })

  it('tells the user an encrypted file needs a password', () => {
    reject(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.INFUSION, schemaVersion: 1,
      encryption: 'aes-256-gcm', payload: { encrypted: true, data: 'x' },
    }), SCAN_SCHEMAS.INFUSION, /encrypted.*password/)
  })
})

describe('validator scan round-trip', () => {
  it('restores every field, with BigInts exact', () => {
    const back = importValidatorScan(exportValidatorScan(validatorState))
    expect(back.requestedEraCount).toBe(3)
    const v = back.validators[0]
    expect(v).toMatchObject({
      address: validatorState.validators[0].address,
      display: 'Validator One',
      commission: 5.25,
      countNominators: 42,
      isActive: true,
      fetchStatus: 'done',
    })
    expect(v.bondedTotal).toBe(HUGE)
    expect(v.nominators[0].bonded).toBe(7n)
    expect(v.eraStat[0].reward).toBe(HUGE)
    expect(v.eraStat[0]).toMatchObject({ era: 1170, startBlock: 100, endBlock: 200, rewardPoint: 30, blocksProduced: 4 })
  })

  // missedEras is recomputed by enrichValidators from eraStat + requestedEraCount.
  it('does not persist missedEras', () => {
    const file = JSON.parse(exportValidatorScan({
      ...validatorState,
      validators: [{ ...validatorState.validators[0], missedEras: [1169, 1168] }],
    }))
    expect(file.data.validators[0]).not.toHaveProperty('missedEras')
    expect(importValidatorScan(JSON.stringify(file)).validators[0].missedEras).toEqual([])
  })

  it('preserves a null nominators / eraStat distinction', () => {
    const back = importValidatorScan(exportValidatorScan({
      requestedEraCount: 1,
      validators: [{ address: 'enX', nominators: null, eraStat: null, bondedTotal: 0n }],
    }))
    expect(back.validators[0].nominators).toBeNull()
    expect(back.validators[0].eraStat).toBeNull()
  })

  it('drops rows with no address', () => {
    const back = importValidatorScan(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.VALIDATOR, schemaVersion: 1,
      meta: { requestedEraCount: 1 },
      data: { validators: [{ address: '' }, { address: 'enOk' }] },
    }))
    expect(back.validators.map(v => v.address)).toEqual(['enOk'])
  })
})

describe('filter metadata', () => {
  const sampleFilter = {
    search: 'dragons',
    status: 'missed',
    missedMin: 1,
    missedMax: 5,
    sortKey: 'bonded',
    sortDir: 'asc',
    totalRecords: 27,
    exportedRecords: 1,
  }

  it('omits meta.filter entirely when nothing is filtered', () => {
    const file = JSON.parse(exportValidatorScan(validatorState))
    expect(file.meta).not.toHaveProperty('filter')
    // The schema version is not bumped for this field: an older build must
    // still be able to open its own unfiltered export exactly as before.
    expect(file.schemaVersion).toBe(SCAN_SCHEMA_VERSION)
  })

  it('omits meta.filter when filter is explicitly null', () => {
    const file = JSON.parse(exportValidatorScan({ ...validatorState, filter: null }))
    expect(file.meta).not.toHaveProperty('filter')
  })

  it('records and round-trips a filter on a validator export', () => {
    const file = JSON.parse(exportValidatorScan({ ...validatorState, filter: sampleFilter }))
    expect(file.meta.filter).toEqual(sampleFilter)

    const back = importValidatorScan(JSON.stringify(file))
    expect(back.filter).toEqual(sampleFilter)
  })

  it('records and round-trips a filter on a pool export', () => {
    const file = JSON.parse(exportPoolScan({ ...poolState, filter: sampleFilter }))
    expect(file.meta.filter).toEqual(sampleFilter)

    const back = importPoolScan(JSON.stringify(file))
    expect(back.filter).toEqual(sampleFilter)
  })

  it('sanitises an untrusted filter block on import (caps, allowlist, coercion)', () => {
    const file = JSON.parse(exportValidatorScan(validatorState))
    file.meta.filter = {
      search: 'x'.repeat(10_000),
      status: 'missed',
      missedMin: '3',
      missedMax: 'not-a-number',
      sortKey: 'bonded',
      sortDir: 'sideways', // not in the allowlist
      totalRecords: '27',
      exportedRecords: 1,
    }
    const back = importValidatorScan(JSON.stringify(file))
    expect(back.filter.search.length).toBeLessThanOrEqual(512)
    expect(back.filter.missedMin).toBe(3)
    expect(back.filter.missedMax).toBe(0) // int() falls back to 0 for a non-numeric string
    expect(back.filter.sortDir).toBe('desc') // rejected, falls back to the default
    expect(back.filter.totalRecords).toBe(27)
  })

  it('reads a file with no meta.filter (a pre-existing export) as unfiltered, not an error', () => {
    // Exactly what a file written before this field existed looks like: a
    // valid envelope whose meta simply lacks the key. Must not throw, and
    // must not be confused with a filter that legitimately narrowed nothing.
    const file = JSON.parse(exportValidatorScan(validatorState))
    expect(file.meta.filter).toBeUndefined()
    const back = importValidatorScan(JSON.stringify(file))
    expect(back.filter).toBeNull()
  })

  it('treats a malformed meta.filter (wrong type) as absent rather than throwing', () => {
    const file = JSON.parse(exportValidatorScan(validatorState))
    file.meta.filter = 'not-an-object'
    expect(() => importValidatorScan(JSON.stringify(file))).not.toThrow()
    expect(importValidatorScan(JSON.stringify(file)).filter).toBeNull()

    file.meta.filter = ['array', 'not', 'object']
    expect(importValidatorScan(JSON.stringify(file)).filter).toBeNull()
  })
})

describe('pool scan round-trip', () => {
  it('restores every field, with BigInts exact', () => {
    const back = importPoolScan(exportPoolScan(poolState))
    expect(back).toMatchObject({
      requestedEraCount: 2,
      provisionalEra: 1171,
      completedEras: [1171, 1170],
      latestCompletedEra: 1171,
    })
    const p = back.pools[0]
    expect(p.totalBonded).toBe(HUGE)
    expect(p.nominatedValidators[0].bonded).toBe(5n)
    expect(p.eraRewards[0].amount).toBe(HUGE.toString())
    // A comma in pool metadata is a non-event in JSON — it is the reason this
    // export is JSON-only rather than reusing the CSV path.
    expect(p.metadata).toBe('Pool, with a comma')
  })

  // Pool missedEras is reducer state, not derived, so unlike the validator side
  // it must survive the round-trip.
  it('persists missedEras', () => {
    expect(importPoolScan(exportPoolScan(poolState)).pools[0].missedEras).toEqual([1170])
  })

  // The Map of BigInts is re-derived by the hook from eraRewards +
  // nominatedValidators + completedEras, never serialised.
  it('omits eraValidatorBreakdown and returns null for it', () => {
    const file = JSON.parse(exportPoolScan(poolState))
    expect(file.data.pools[0]).not.toHaveProperty('eraValidatorBreakdown')
    expect(importPoolScan(exportPoolScan(poolState)).pools[0].eraValidatorBreakdown).toBeNull()
  })

  it('falls back to the newest completed era when latestCompletedEra is absent', () => {
    const back = importPoolScan(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.POOL, schemaVersion: 1,
      meta: { completedEras: [1171, 1170] },
      data: { pools: [] },
    }))
    expect(back.latestCompletedEra).toBe(1171)
  })

  it('keeps a null provisionalEra null rather than coercing it to 0', () => {
    const back = importPoolScan(exportPoolScan({ ...poolState, provisionalEra: null }))
    expect(back.provisionalEra).toBeNull()
  })

  it('carries a manual-retry eraStat through untouched', () => {
    const withStat = {
      ...poolState,
      pools: [{
        ...poolState.pools[0],
        nominatedValidators: [{ ...poolState.pools[0].nominatedValidators[0], eraStat: [{ era: 1171, foo: 'raw' }] }],
      }],
    }
    const back = importPoolScan(exportPoolScan(withStat))
    expect(back.pools[0].nominatedValidators[0].eraStat).toEqual([{ era: 1171, foo: 'raw' }])
  })
})

describe('infusion scan round-trip', () => {
  it('restores rows and meta', () => {
    const back = importInfusionScan(exportInfusionScan(infusionState))
    expect(back).toMatchObject({
      mode: 'wallet',
      walletAddress: '0xabc',
      amount: '12.0000',
      bulkTotal: '12.0000',
      bulkStarted: true,
      bulkExpectedTotal: 2,
    })
    expect(back.scanOutcome).toEqual({ kind: 'done', stage: 'bulk', message: 'ok', mode: 'wallet' })
    expect(back.rows).toHaveLength(2)
  })

  // `raw` is a display string on failed rows. Running it through parseBigInt
  // would reject the whole file for a row that is legitimately non-numeric.
  it('keeps a failed row\'s prose raw value verbatim', () => {
    const back = importInfusionScan(exportInfusionScan(infusionState))
    expect(back.rows[1]).toMatchObject({
      tokenId: '2', amount: 'Failed', raw: 'See terminal log', error: true, errorMessage: 'boom',
    })
  })

  // Regression guard: the component's modes are 'single' | 'wallet'. An earlier
  // allowlist had 'bulk', which silently rewrote every wallet scan's mode and
  // left the imported results table unrendered.
  it("preserves the 'wallet' mode verbatim", () => {
    const back = importInfusionScan(exportInfusionScan(infusionState))
    expect(back.mode).toBe('wallet')
    expect(back.scanOutcome.mode).toBe('wallet')
  })

  it('drops rows with no token id', () => {
    const back = importInfusionScan(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.INFUSION, schemaVersion: 1,
      meta: {}, data: { rows: [{ tokenId: '' }, { tokenId: '9' }] },
    }))
    expect(back.rows.map(r => r.tokenId)).toEqual(['9'])
  })

  it('normalises an unknown scanOutcome kind rather than trusting it', () => {
    const back = importInfusionScan(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.INFUSION, schemaVersion: 1,
      meta: {}, data: { rows: [], scanOutcome: { kind: 'weird', mode: 'nonsense' } },
    }))
    expect(back.scanOutcome).toMatchObject({ kind: 'done', mode: 'wallet' })
  })

  describe('previewImage sanitation', () => {
    const importWithPreview = previewImage => importInfusionScan(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.INFUSION, schemaVersion: 1,
      meta: {},
      data: { rows: [{ tokenId: '1', metadata: { previewImage } }] },
    })).rows[0].metadata.previewImage

    it('keeps an https URL', () => {
      expect(importWithPreview('https://example.com/a.png')).toBe('https://example.com/a.png')
    })

    it.each([
      ['javascript:alert(1)'],
      ['data:image/svg+xml;base64,AAAA'],
      ['http://example.com/a.png'],
      ['ipfs://cid'],
      ['/relative.png'],
      ['not a url'],
    ])('drops %s', bad => {
      expect(importWithPreview(bad)).toBe('')
    })

    // Text-only fields (DetailField, never an href) are kept as written.
    it('leaves tokenUri alone', () => {
      const back = importInfusionScan(exportInfusionScan(infusionState))
      expect(back.rows[0].metadata.tokenUri).toBe('ipfs://cid')
    })
  })
})

describe('BigInt strictness', () => {
  const poolFileWith = totalBonded => JSON.stringify({
    tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.POOL, schemaVersion: 1,
    meta: {}, data: { pools: [{ poolId: 1, stashAddress: 'enX', totalBonded }] },
  })

  it.each([['-5'], ['1.234'], ['1e18'], ['0x10'], ['abc']])(
    'rejects %s as a Planck amount', bad => {
      expect(() => importPoolScan(poolFileWith(bad))).toThrow(/Invalid pool 1 totalBonded/)
    })

  it('names the offending field precisely', () => {
    expect(() => importValidatorScan(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.VALIDATOR, schemaVersion: 1,
      meta: {},
      data: { validators: [{ address: 'enX', eraStat: [{ era: 1, reward: '-1' }] }] },
    }))).toThrow(/validator 1 reward/)
  })

  it('rejects a malformed reward amount instead of silently summing to zero', () => {
    expect(() => importPoolScan(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.POOL, schemaVersion: 1,
      meta: {},
      data: { pools: [{ poolId: 7, stashAddress: 'enX', eraRewards: [{ era: 1, amount: '12.5' }] }] },
    }))).toThrow(/pool 7 reward amount/)
  })

  it('treats an absent amount as zero rather than throwing', () => {
    const back = importPoolScan(poolFileWith(undefined))
    expect(back.pools[0].totalBonded).toBe(0n)
  })
})

describe('encryption', () => {
  it('round-trips an encrypted infusion scan', async () => {
    const plain = exportInfusionScan(infusionState)
    const enc = await encryptScanFile(plain, 'correct horse')
    const back = importInfusionScan(await decryptScanFile(enc, 'correct horse'))
    expect(back.rows).toHaveLength(2)
    expect(back.walletAddress).toBe('0xabc')
  })

  it('fails on the wrong password', async () => {
    const enc = await encryptScanFile(exportInfusionScan(infusionState), 'right')
    await expect(decryptScanFile(enc, 'wrong')).rejects.toThrow(/Check the password/)
  })

  // Nesting the ciphertext under `payload` is what keeps this file out of the
  // Balance Viewer importer, whose sniff accepts any top-level {encrypted:true}.
  it('does not expose `encrypted` at the top level', async () => {
    const enc = JSON.parse(await encryptScanFile(exportInfusionScan(infusionState), 'pw'))
    expect(enc.encrypted).toBeUndefined()
    expect(enc.payload.encrypted).toBe(true)
    expect(enc.tool).toBe(SCAN_TOOL_ID)
    expect(enc.schema).toBe(SCAN_SCHEMAS.INFUSION)
    expect(isEncryptedEnvelope(enc)).toBe(true)
  })

  it('refuses to decrypt a plaintext file', async () => {
    await expect(decryptScanFile(exportInfusionScan(infusionState), 'pw'))
      .rejects.toThrow(/not an encrypted EnjinSight scan export/)
  })

  it('still enforces the schema check after decryption', async () => {
    const enc = await encryptScanFile(exportPoolScan(poolState), 'pw')
    const plain = await decryptScanFile(enc, 'pw')
    expect(() => importInfusionScan(plain)).toThrow(/Staking Cadence \(pool mode\) export/)
  })
})
