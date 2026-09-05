// @vitest-environment jsdom
/**
 * The scan importer's schema routing.
 *
 * Accepting a list of schemas is what lets Staking Cadence have one import
 * pane for both its modes: the envelope names the file's own schema, so the
 * panel picks the parser and tells the caller which mode to switch to. These
 * tests cover that routing and the rejection messages around it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import ScanImportPanel from './ScanImportPanel.jsx'
import { SCAN_SCHEMAS, SCAN_TOOL_ID } from '../utils/scanExport.js'

afterEach(cleanup)

const fileInput = () => document.querySelector('input[type=file]')
const fileList = f => ({ 0: f, length: 1, item: i => (i === 0 ? f : null) })

function drop(contents, name = 'scan.json') {
  const file = new File([contents], name, { type: 'application/json' })
  Object.defineProperty(fileInput(), 'files', { value: fileList(file), configurable: true })
  fireEvent.change(fileInput())
}

const envelope = (schema, data) => JSON.stringify({
  tool: SCAN_TOOL_ID, schema, schemaVersion: 1, appVersion: '1.0.0',
  exportedAt: '2026-09-04T10:00:00.000Z', meta: {}, data,
})

const VALIDATOR_FILE = envelope(SCAN_SCHEMAS.VALIDATOR, { validators: [{ address: 'enX' }] })
const POOL_FILE = envelope(SCAN_SCHEMAS.POOL, { pools: [{ poolId: 1, stashAddress: 'enS' }] })

/** Both staking schemas, as App.jsx passes them. */
function bothStaking(onImport) {
  const importValidator = vi.fn(() => ({ kind: 'validator' }))
  const importPool = vi.fn(() => ({ kind: 'pool' }))
  render(
    <ScanImportPanel
      accept={[
        { schema: SCAN_SCHEMAS.VALIDATOR, importFn: importValidator },
        { schema: SCAN_SCHEMAS.POOL, importFn: importPool },
      ]}
      heading="Load a Staking Cadence scan"
      onImport={onImport}
    />,
  )
  return { importValidator, importPool }
}

describe('multi-schema routing', () => {
  it('routes a validator file to the validator parser', async () => {
    const onImport = vi.fn()
    const { importValidator, importPool } = bothStaking(onImport)
    drop(VALIDATOR_FILE, 'v.json')

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(importValidator).toHaveBeenCalledTimes(1)
    expect(importPool).not.toHaveBeenCalled()
    // The schema is handed back so the caller can switch mode.
    expect(onImport).toHaveBeenCalledWith({ kind: 'validator' }, 'v.json', SCAN_SCHEMAS.VALIDATOR)
  })

  // The friction this removes: previously the panel accepted one schema, so a
  // pool export dropped while Validators was selected was refused outright.
  it('routes a pool file to the pool parser regardless of any selected mode', async () => {
    const onImport = vi.fn()
    const { importValidator, importPool } = bothStaking(onImport)
    drop(POOL_FILE, 'p.json')

    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
    expect(importPool).toHaveBeenCalledTimes(1)
    expect(importValidator).not.toHaveBeenCalled()
    expect(onImport).toHaveBeenCalledWith({ kind: 'pool' }, 'p.json', SCAN_SCHEMAS.POOL)
  })

  it('names both accepted schemas when refusing a third', async () => {
    bothStaking(vi.fn())
    drop(envelope(SCAN_SCHEMAS.INFUSION, { rows: [] }))
    await waitFor(() => expect(
      screen.getByText(/This is a ENJ Infusion Checker export\. Import it from that tool, not Staking Cadence \(validator mode\) or Staking Cadence \(pool mode\)/),
    ).toBeTruthy())
  })

  it('uses the caller\'s heading when given one', () => {
    bothStaking(vi.fn())
    expect(screen.getByRole('heading', { name: 'Load a Staking Cadence scan' })).toBeTruthy()
  })
})

describe('single-schema use', () => {
  const renderOne = (onImport, importFn = vi.fn(() => ({ ok: true }))) => {
    render(
      <ScanImportPanel
        accept={[{ schema: SCAN_SCHEMAS.INFUSION, importFn }]}
        onImport={onImport}
      />,
    )
    return importFn
  }

  it('defaults its heading to the schema name', () => {
    renderOne(vi.fn())
    expect(screen.getByRole('heading', { name: 'Load ENJ Infusion Checker scan' })).toBeTruthy()
  })

  it('accepts its own schema', async () => {
    const onImport = vi.fn()
    renderOne(onImport)
    drop(envelope(SCAN_SCHEMAS.INFUSION, { rows: [] }), 'i.json')
    await waitFor(() => expect(onImport)
      .toHaveBeenCalledWith({ ok: true }, 'i.json', SCAN_SCHEMAS.INFUSION))
  })

  it('refuses another schema by name', async () => {
    renderOne(vi.fn())
    drop(POOL_FILE)
    await waitFor(() => expect(
      screen.getByText(/This is a Staking Cadence \(pool mode\) export\. Import it from that tool, not ENJ Infusion Checker/),
    ).toBeTruthy())
  })

  it('refuses a file from another application entirely', async () => {
    renderOne(vi.fn())
    drop(JSON.stringify({ tool: 'something-else', schema: 'whatever' }))
    await waitFor(() => expect(
      screen.getByText(/not an EnjinSight scan export/),
    ).toBeTruthy())
  })

  it('surfaces a parser throw against the file', async () => {
    renderOne(vi.fn(), () => { throw new Error('This export has no token rows.') })
    drop(envelope(SCAN_SCHEMAS.INFUSION, { notRows: [] }))
    await waitFor(() => expect(screen.getByText('This export has no token rows.')).toBeTruthy())
  })

  it('advertises JSON only and the scan cap', () => {
    renderOne(vi.fn())
    expect(screen.getByText(/JSON only — max 64 MB/)).toBeTruthy()
    expect(fileInput().getAttribute('accept')).toBe('.json')
  })

  it('refuses an encrypted file unless encryption is allowed', async () => {
    render(
      <ScanImportPanel
        accept={[{ schema: SCAN_SCHEMAS.INFUSION, importFn: vi.fn() }]}
        onImport={vi.fn()}
      />,
    )
    drop(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.INFUSION, schemaVersion: 1,
      encryption: 'aes-256-gcm', payload: { encrypted: true, data: 'x' },
    }))
    await waitFor(() => expect(
      screen.getByText('This import does not accept encrypted files.'),
    ).toBeTruthy())
  })

  it('prompts for a password when encryption is allowed', async () => {
    render(
      <ScanImportPanel
        accept={[{ schema: SCAN_SCHEMAS.INFUSION, importFn: vi.fn() }]}
        onImport={vi.fn()}
        allowEncryption
      />,
    )
    drop(JSON.stringify({
      tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.INFUSION, schemaVersion: 1,
      encryption: 'aes-256-gcm', payload: { encrypted: true, data: 'x' },
    }))
    await waitFor(() => expect(screen.getByLabelText('Decryption Password')).toBeTruthy())
  })
})
