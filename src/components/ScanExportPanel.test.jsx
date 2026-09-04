// @vitest-environment jsdom
/**
 * The export panel's download path.
 *
 * This is the one part of export/import that unit tests could not reach: the
 * serialisers are covered in scanExport.test.js, but nothing exercised the
 * click that actually produces a file. Rather than mock `downloadFile`, this
 * runs the real one and intercepts `URL.createObjectURL` — so `safeFilename`,
 * the Blob's MIME type, and the exact bytes are all asserted on the production
 * path rather than at a mock boundary.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import ScanExportPanel from './ScanExportPanel.jsx'
import { SCAN_SCHEMAS, SCAN_TOOL_ID, isEncryptedEnvelope, decryptScanFile } from '../utils/scanExport.js'

/** Every download attempted during a test: { blob, mime, filename, href }. */
let downloads = []
let realClick

beforeEach(() => {
  downloads = []
  // jsdom implements neither of these.
  URL.createObjectURL = vi.fn(blob => {
    downloads.push({ blob, mime: blob.type, filename: null, href: null })
    return 'blob:mock-url'
  })
  URL.revokeObjectURL = vi.fn()
  // downloadFile sets `download`/`href` on an anchor and clicks it. jsdom's
  // click is a no-op, so record what the anchor was carrying at that moment.
  realClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function click() {
    const last = downloads[downloads.length - 1]
    if (last) { last.filename = this.download; last.href = this.getAttribute('href') }
  }
})

afterEach(() => {
  HTMLAnchorElement.prototype.click = realClick
  cleanup()
  vi.restoreAllMocks()
})

const PLAIN = JSON.stringify({
  tool: SCAN_TOOL_ID, schema: SCAN_SCHEMAS.VALIDATOR, schemaVersion: 1,
  exportedAt: '2026-09-01T10:30:00.000Z',
  meta: { requestedEraCount: 4 },
  data: { validators: [{ address: 'enX', bondedTotal: '5' }] },
})

function renderPanel(props = {}) {
  return render(
    <ScanExportPanel
      schema={SCAN_SCHEMAS.VALIDATOR}
      buildContent={() => PLAIN}
      {...props}
    />,
  )
}

const exportButton = () => screen.getByRole('button', { name: /^Export$/i })

describe('ScanExportPanel — plaintext download', () => {
  it('writes the exact serialised content as application/json', async () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Filename'), { target: { value: 'my-scan' } })
    fireEvent.click(exportButton())

    await waitFor(() => expect(downloads).toHaveLength(1))
    const [dl] = downloads
    expect(dl.mime).toBe('application/json')
    expect(dl.filename).toBe('my-scan.json')
    await expect(dl.blob.text()).resolves.toBe(PLAIN)
  })

  it('confirms the saved filename back to the user', async () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Filename'), { target: { value: 'my-scan' } })
    fireEvent.click(exportButton())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('File saved: my-scan.json'))
  })

  // safeFilename is applied inside downloadFile, so an unsafe name must not
  // reach the anchor's download attribute.
  it('sanitises an unsafe filename before it reaches the anchor', async () => {
    renderPanel()
    fireEvent.change(screen.getByLabelText('Filename'), { target: { value: '../../etc/pa sswd' } })
    fireEvent.click(exportButton())

    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0].filename).not.toContain('/')
    expect(downloads[0].filename).toBe('.._.._etc_pa_sswd.json')
  })

  it('falls back to the schema default filename when the field is left empty', async () => {
    renderPanel()
    fireEvent.click(exportButton())
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0].filename).toMatch(/^enjin_staking_validator_\d+\.json$/)
  })

  it('revokes the blob URL rather than leaking it', async () => {
    vi.useFakeTimers()
    try {
      renderPanel()
      fireEvent.click(exportButton())
      // handleExport is async; flush its microtasks before advancing timers.
      await vi.waitFor(() => expect(downloads).toHaveLength(1))
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      vi.advanceTimersByTime(60_000)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a failure from buildContent instead of downloading', async () => {
    renderPanel({ buildContent: () => { throw new Error('serialiser blew up') } })
    fireEvent.click(exportButton())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Export failed: serialiser blew up'))
    expect(downloads).toHaveLength(0)
  })

  it('does not export while disabled', () => {
    renderPanel({ disabled: true })
    expect(exportButton().disabled).toBe(true)
    fireEvent.click(exportButton())
    expect(downloads).toHaveLength(0)
  })
})

describe('ScanExportPanel — encryption', () => {
  it('offers no encryption toggle unless allowEncryption is set', () => {
    renderPanel()
    expect(screen.queryByLabelText(/Toggle AES-256-GCM encryption/i)).toBeNull()
  })

  it('refuses to export with encryption on and no password', async () => {
    renderPanel({ allowEncryption: true })
    fireEvent.click(screen.getByLabelText(/Toggle AES-256-GCM encryption/i))
    fireEvent.click(exportButton())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Enter an encryption password.'))
    expect(downloads).toHaveLength(0)
  })

  it('writes a .enc.json whose payload decrypts back to the original', async () => {
    renderPanel({ allowEncryption: true })
    fireEvent.change(screen.getByLabelText('Filename'), { target: { value: 'secret-scan' } })
    fireEvent.click(screen.getByLabelText(/Toggle AES-256-GCM encryption/i))
    fireEvent.change(screen.getByLabelText('Encryption Password'), { target: { value: 'correct horse' } })
    fireEvent.click(exportButton())

    // Real PBKDF2 at 600k iterations — allow well beyond the default timeout.
    await waitFor(() => expect(downloads).toHaveLength(1), { timeout: 15_000 })
    const [dl] = downloads
    expect(dl.filename).toBe('secret-scan.enc.json')

    const written = JSON.parse(await dl.blob.text())
    // The ciphertext must stay nested under `payload` — a top-level
    // `encrypted: true` is what makes the Balance Viewer's importer claim it.
    expect(written.encrypted).toBeUndefined()
    expect(isEncryptedEnvelope(written)).toBe(true)
    expect(written.schema).toBe(SCAN_SCHEMAS.VALIDATOR)

    await expect(decryptScanFile(await dl.blob.text(), 'correct horse')).resolves.toBe(PLAIN)
  }, 20_000)
})
