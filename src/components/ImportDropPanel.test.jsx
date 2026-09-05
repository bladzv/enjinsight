// @vitest-environment jsdom
/**
 * The shared import shell.
 *
 * Three panels previously reimplemented this; these tests pin the behaviour
 * they collectively had, so a future change to one consumer cannot quietly
 * weaken it for the others. The size and extension checks in particular are
 * the cheap guards that run *before* a file is read.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import ImportDropPanel from './ImportDropPanel.jsx'

const fileInput = () => document.querySelector('input[type=file]')

/**
 * A FileList stand-in. jsdom implements neither `DataTransfer` nor a
 * constructible `FileList`, and the component only ever reads `files[0]`.
 */
const fileList = file => ({ 0: file, length: 1, item: i => (i === 0 ? file : null) })

/** Feed a file through the hidden input the way a picker would. */
function drop(contents, name = 'export.json', size) {
  const file = new File([contents], name, { type: 'application/json' })
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size })
  Object.defineProperty(fileInput(), 'files', { value: fileList(file), configurable: true })
  fireEvent.change(fileInput())
}

const okInspect = () => ({ ok: true })

function renderPanel(props = {}) {
  return render(
    <ImportDropPanel
      extensions={['json']}
      maxMb={10}
      inspect={okInspect}
      onFile={vi.fn()}
      {...props}
    />,
  )
}

afterEach(cleanup)

describe('gate checks', () => {
  it('rejects an oversized file without reading it', () => {
    const onFile = vi.fn()
    const inspect = vi.fn(okInspect)
    renderPanel({ onFile, inspect, maxMb: 1 })
    drop('{}', 'big.json', 2 * 1024 * 1024)

    expect(screen.getByText(/File too large — max 1 MB allowed/)).toBeTruthy()
    expect(inspect).not.toHaveBeenCalled()
    expect(onFile).not.toHaveBeenCalled()
  })

  it('rejects an extension outside the allowlist, naming the source', () => {
    const onFile = vi.fn()
    renderPanel({ onFile, extensions: ['json', 'csv'], sourceLabel: 'the Balance Viewer' })
    drop('{}', 'notes.txt')

    expect(screen.getByText(/"\.txt" is not a supported file type/)).toBeTruthy()
    expect(screen.getByText(/\.json or \.csv exports from the Balance Viewer/)).toBeTruthy()
    expect(onFile).not.toHaveBeenCalled()
  })

  it('rejects content that inspect does not recognise, with its reason', async () => {
    const onFile = vi.fn()
    renderPanel({ onFile, inspect: () => ({ ok: false, reason: 'Not ours at all.' }) })
    drop('{}')

    await waitFor(() => expect(screen.getByText('Not ours at all.')).toBeTruthy())
    expect(onFile).not.toHaveBeenCalled()
  })

  it('falls back to a generic reason when inspect gives none', async () => {
    renderPanel({ inspect: () => ({ ok: false }), sourceLabel: 'this tool' })
    drop('{}')
    await waitFor(() =>
      expect(screen.getByText(/doesn't appear to be an export from this tool/)).toBeTruthy())
  })

  it('advertises the accepted extensions and the cap', () => {
    renderPanel({ extensions: ['json', 'csv', 'xml'], maxMb: 64 })
    expect(screen.getByText('JSON, CSV, XML — max 64 MB')).toBeTruthy()
    expect(fileInput().getAttribute('accept')).toBe('.json,.csv,.xml')
  })
})

describe('plaintext handoff', () => {
  it('passes the text, extension and filename through', async () => {
    const onFile = vi.fn()
    renderPanel({ onFile, extensions: ['json', 'csv'] })
    drop('era,pool_id\n1,2', 'rewards.csv')

    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1))
    expect(onFile).toHaveBeenCalledWith('era,pool_id\n1,2', 'csv', 'rewards.csv')
  })

  // Uniform error surfacing. The scan and reward panels each caught their own
  // parse errors; the balance panel called its callback bare, relying on
  // useBalanceExplorer.importData catching internally. Doing it here means a
  // consumer whose parse throws cannot produce an unhandled rejection inside
  // a FileReader callback.
  it('shows a throw from onFile instead of swallowing it', async () => {
    renderPanel({
      onFile: () => { throw new Error('CSV is missing required column(s): free.') },
    })
    drop('{}')
    await waitFor(() =>
      expect(screen.getByText('CSV is missing required column(s): free.')).toBeTruthy())
  })

  it('shows a rejected promise from onFile too', async () => {
    renderPanel({ onFile: async () => { throw new Error('async parse failed') } })
    drop('{}')
    await waitFor(() => expect(screen.getByText('async parse failed')).toBeTruthy())
  })
})

describe('encryption', () => {
  const encInspect = () => ({ ok: true, encrypted: true })

  it('refuses an encrypted file when no onDecrypt is given', async () => {
    renderPanel({ inspect: encInspect })
    drop('{"encrypted":true}')
    await waitFor(() =>
      expect(screen.getByText('This import does not accept encrypted files.')).toBeTruthy())
    expect(screen.queryByLabelText('Decryption Password')).toBeNull()
  })

  it('prompts for a password instead of parsing', async () => {
    const onFile = vi.fn()
    renderPanel({ inspect: encInspect, onFile, onDecrypt: vi.fn() })
    drop('{"encrypted":true}')

    await waitFor(() => expect(screen.getByLabelText('Decryption Password')).toBeTruthy())
    expect(onFile).not.toHaveBeenCalled()
  })

  it('will not attempt a decrypt with an empty password', async () => {
    const onDecrypt = vi.fn()
    renderPanel({ inspect: encInspect, onDecrypt })
    drop('{"encrypted":true}')
    await waitFor(() => expect(screen.getByLabelText('Decryption Password')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Decrypt & Import/i }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Enter the decryption password.'))
    expect(onDecrypt).not.toHaveBeenCalled()
  })

  it('passes the password, extension and filename to onDecrypt', async () => {
    const onDecrypt = vi.fn()
    renderPanel({ inspect: encInspect, onDecrypt })
    drop('{"encrypted":true}', 'secret.json')
    await waitFor(() => expect(screen.getByLabelText('Decryption Password')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Decryption Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: /Decrypt & Import/i }))

    await waitFor(() => expect(onDecrypt).toHaveBeenCalledWith('{"encrypted":true}', 'pw', 'json', 'secret.json'))
  })

  // A wrong password is a fact about the attempt, not the file, so the prompt
  // must stay up for a retry rather than the file being discarded.
  it('keeps the prompt open and reports a wrong password', async () => {
    renderPanel({
      inspect: encInspect,
      onDecrypt: async () => { throw new Error('Could not decrypt this file. Check the password.') },
    })
    drop('{"encrypted":true}')
    await waitFor(() => expect(screen.getByLabelText('Decryption Password')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Decryption Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /Decrypt & Import/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Check the password'))
    expect(screen.getByLabelText('Decryption Password')).toBeTruthy()
  })

  it('clears the prompt after a successful decrypt', async () => {
    renderPanel({ inspect: encInspect, onDecrypt: vi.fn() })
    drop('{"encrypted":true}')
    await waitFor(() => expect(screen.getByLabelText('Decryption Password')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Decryption Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: /Decrypt & Import/i }))

    await waitFor(() => expect(screen.queryByLabelText('Decryption Password')).toBeNull())
  })
})

describe('chrome and disabled state', () => {
  it('renders a heading when given one', () => {
    renderPanel({ heading: 'Load exported balance data' })
    expect(screen.getByRole('heading', { name: 'Load exported balance data' })).toBeTruthy()
  })

  it('renders bare when no heading is given', () => {
    renderPanel()
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('takes no file while disabled', () => {
    const onFile = vi.fn()
    renderPanel({ onFile, disabled: true })
    const zone = screen.getByRole('button', { name: /Drop a file or click to browse/i })
    expect(zone.getAttribute('aria-disabled')).toBe('true')
    expect(zone.getAttribute('tabindex')).toBe('-1')
    expect(fileInput().disabled).toBe(true)

    fireEvent.drop(zone, { dataTransfer: { files: [new File(['{}'], 'x.json')] } })
    expect(onFile).not.toHaveBeenCalled()
  })

  it('accepts a dragged-and-dropped file', async () => {
    const onFile = vi.fn()
    renderPanel({ onFile })
    const zone = screen.getByRole('button', { name: /Drop a file or click to browse/i })
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['{"a":1}'], 'dropped.json')] } })

    await waitFor(() => expect(onFile).toHaveBeenCalledWith('{"a":1}', 'json', 'dropped.json'))
  })
})
