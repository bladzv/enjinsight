/**
 * Contract test: scripts/enjinsight_cli.py writes the web app's import envelope.
 *
 * The CLI is a standalone tool that reimplements the cadence scan, so it cannot
 * import anything from src/. This test is the one-way, data-only link that keeps
 * the two honest: it reads fixtures the CLI actually produced and runs them
 * through the real importers. If the schema, a field name or a coercion rule
 * moves, this fails and names the CLI as what needs updating.
 *
 * Regenerate the fixtures with:
 *   python3 scripts/enjinsight_cli.py --non-interactive --mode both \
 *     --eras 1 --limit 3 --export json --dry-run --out scripts/fixtures
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  SCAN_TOOL_ID, SCAN_SCHEMAS, SCAN_SCHEMA_VERSION,
  importValidatorScan, importPoolScan,
} from './scanExport.js'

const read = name =>
  readFileSync(fileURLToPath(new URL(`../../scripts/fixtures/${name}`, import.meta.url)), 'utf8')

describe('enjinsight_cli.py scan exports', () => {
  it('validator export imports and keeps its Planck values', () => {
    const raw = read('cli-validator-scan.json')
    const header = JSON.parse(raw)
    expect(header.tool).toBe(SCAN_TOOL_ID)
    expect(header.schema).toBe(SCAN_SCHEMAS.VALIDATOR)
    expect(header.schemaVersion).toBe(SCAN_SCHEMA_VERSION)
    expect(header.appVersion).toMatch(/^enjinsight-cli@/)
    // An unfiltered export must not carry a filter key at all.
    expect(header.meta).not.toHaveProperty('filter')

    const result = importValidatorScan(raw)
    expect(result.validators.length).toBe(header.meta.validatorCount)
    expect(result.requestedEraCount).toBe(header.meta.requestedEraCount)

    const v = result.validators[0]
    expect(typeof v.bondedTotal).toBe('bigint')
    // The field-capture work: a missing bondedTotal would silently import as 0n.
    expect(v.bondedTotal).toBeGreaterThan(0n)
    expect(v.countNominators).toBeGreaterThan(0)
    expect(Array.isArray(v.eraStat)).toBe(true)
    expect(typeof v.eraStat[0].reward).toBe('bigint')
    expect(typeof v.eraStat[0].validatorStake).toBe('bigint')
  })

  it('pool export imports with its era window intact', () => {
    const raw = read('cli-pool-scan.json')
    const header = JSON.parse(raw)
    expect(header.schema).toBe(SCAN_SCHEMAS.POOL)
    expect(header.meta).not.toHaveProperty('filter')

    const result = importPoolScan(raw)
    expect(result.pools.length).toBe(header.meta.poolCount)
    expect(result.completedEras.length).toBeGreaterThan(0)
    // Newest-first, de-duplicated (intArray in scanExport.js).
    expect([...result.completedEras].sort((a, b) => b - a)).toEqual(result.completedEras)
    expect(result.latestCompletedEra).toBe(result.completedEras[0])

    const p = result.pools[0]
    expect(typeof p.totalBonded).toBe('bigint')
    expect(p.totalBonded).toBeGreaterThan(0n)
    expect(p.stashAddress.length).toBeGreaterThan(0)
    expect(p.state.length).toBeGreaterThan(0)
    expect(Array.isArray(p.eraRewards)).toBe(true)
    expect(Array.isArray(p.nominatedValidators)).toBe(true)
    expect(typeof p.nominatedValidators[0].bonded).toBe('bigint')
  })

  it('carries the provisional era so the app agrees on which era is final', () => {
    const raw = read('cli-pool-scan.json')
    const { provisionalEra, completedEras } = importPoolScan(raw)
    // Either absent, or it is the newest completed era — never anything else.
    if (provisionalEra !== null) {
      expect(provisionalEra).toBe(completedEras[0])
    }
  })
})
