/**
 * ImportDropPanel — the shared shell behind every "load an exported file" pane.
 *
 * Three panels (Balance Viewer, Reward History, Staking/Infusion scans) each
 * reimplemented the same drop zone, size check, extension check, file-status
 * card and decrypt block. They differed only in which extensions they accept,
 * how they recognise their own files, and what they do with the contents — so
 * those three things are props and everything else lives here.
 *
 * Security posture, unchanged from the panels this replaces:
 *  - size checked before the file is read, not after;
 *  - extension checked against an explicit allowlist;
 *  - contents never trusted until `inspect` says they are ours;
 *  - all parsing happens in the caller's `onFile` / `onDecrypt`, which sanitise
 *    field values;
 *  - no innerHTML anywhere — every message is text.
 *
 * A throw from `onFile` or `onDecrypt` is caught and shown against the file.
 * None of the three panels did this uniformly: the scan and reward panels
 * caught and surfaced their own parse errors, while the balance panel called
 * its callback bare — safe only because `useBalanceExplorer.importData`
 * happens to catch internally and log. Handling it here means a consumer whose
 * parse *does* throw gets a visible message rather than an unhandled rejection
 * inside a FileReader callback.
 */
import { useState, useRef, useCallback } from 'react'
import { Upload, FolderOpen, XCircle, CheckCircle } from 'lucide-react'
import Spinner from './Spinner.jsx'
import Field from './Field.jsx'

/** "json" → "JSON"; ["json","csv","xml"] → "JSON, CSV, XML". */
function extLabel(extensions) {
  return extensions.map(e => e.toUpperCase()).join(', ')
}

/** ".json, .csv or .xml" — for the rejection message. */
function extPhrase(extensions) {
  const dotted = extensions.map(e => `.${e}`)
  if (dotted.length === 1) return dotted[0]
  return `${dotted.slice(0, -1).join(', ')} or ${dotted[dotted.length - 1]}`
}

/**
 * @param {object} props
 * @param {string} [props.heading] - panel heading. Omit to render bare, for a
 *   caller that already provides its own section chrome.
 * @param {string[]} props.extensions - accepted lowercase extensions, e.g. ['json'].
 * @param {number} props.maxMb - size cap in megabytes.
 * @param {string} [props.hint] - overrides the default "JSON — max N MB" sub-label.
 * @param {string} [props.sourceLabel] - named in the wrong-extension message,
 *   e.g. "EnjinSight's Balance Viewer".
 * @param {(text: string, ext: string) => {ok: boolean, reason?: string, encrypted?: boolean}} props.inspect
 *   Decides whether the contents are ours, and whether they are encrypted.
 *   Must not throw; return `{ok: false, reason}` to reject with a message.
 * @param {(text: string, ext: string, fileName: string) => void|Promise<void>} props.onFile
 *   Parses and applies a plaintext file. May throw; the message is shown.
 * @param {(text: string, password: string, ext: string, fileName: string) => Promise<void>} [props.onDecrypt]
 *   Decrypts and applies an encrypted file. Omit to refuse encrypted files.
 * @param {boolean} [props.disabled]
 * @param {string} [props.passwordFieldId] - must be unique if two panels are mounted at once.
 */
export default function ImportDropPanel({
  heading,
  extensions,
  maxMb,
  hint,
  sourceLabel = 'this tool',
  inspect,
  onFile,
  onDecrypt,
  disabled = false,
  passwordFieldId = 'import-dec-pwd',
}) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [isPending,  setIsPending]  = useState(false)
  const [encPending, setEncPending] = useState(null)  // { text, ext, fileName }
  const [decPwd,     setDecPwd]     = useState('')
  const [alert,      setAlert]      = useState(null)  // { type, text }
  const [fileStatus, setFileStatus] = useState(null)  // { name, ext?, sizeKb, rejected, reason? }
  const fileInputRef = useRef(null)

  function showAlert(type, text, autoDismiss = true) {
    setAlert({ type, text })
    if (autoDismiss) setTimeout(() => setAlert(null), 7000)
  }

  /**
   * Hand the contents to the caller, showing any throw against the file.
   *
   * A parse failure is a fact about the *file*, so it belongs on the file card
   * rather than in the transient alert — it should not disappear after seven
   * seconds while the user is still reading it.
   */
  const applyFile = useCallback(async (text, ext, fileName, sizeKb) => {
    try {
      await onFile(text, ext, fileName)
      setFileStatus(null)
    } catch (e) {
      setFileStatus({ name: fileName, ext, sizeKb, rejected: true, reason: e.message })
    }
  }, [onFile])

  const processFile = useCallback((file) => {
    setFileStatus(null)
    setAlert(null)
    setEncPending(null)

    const sizeKb = (file.size / 1024).toFixed(1)

    // Size first: the point is to avoid reading a huge file into memory at all.
    if (file.size > maxMb * 1024 * 1024) {
      setFileStatus({
        name: file.name, sizeKb, rejected: true,
        reason: `File too large — max ${maxMb} MB allowed.`,
      })
      return
    }

    const ext = file.name.split('.').pop().toLowerCase()
    if (!extensions.includes(ext)) {
      setFileStatus({
        name: file.name, ext, sizeKb, rejected: true,
        reason: `".${ext}" is not a supported file type. Only ${extPhrase(extensions)} exports from ${sourceLabel} can be imported.`,
      })
      return
    }

    setIsPending(true)

    const reader = new FileReader()
    reader.onload = async ev => {
      const text = ev.target.result

      const verdict = inspect(text, ext) ?? { ok: false }
      if (!verdict.ok) {
        setFileStatus({
          name: file.name, ext, sizeKb, rejected: true,
          reason: verdict.reason
            ?? `This file doesn't appear to be an export from ${sourceLabel}.`,
        })
        setIsPending(false)
        return
      }

      if (verdict.encrypted) {
        if (!onDecrypt) {
          setFileStatus({
            name: file.name, ext, sizeKb, rejected: true,
            reason: 'This import does not accept encrypted files.',
          })
          setIsPending(false)
          return
        }
        setFileStatus({ name: file.name, ext, sizeKb, rejected: false })
        setEncPending({ text, ext, fileName: file.name })
        setIsPending(false)
        return
      }

      setFileStatus({ name: file.name, ext, sizeKb, rejected: false })
      await applyFile(text, ext, file.name, sizeKb)
      setIsPending(false)
    }
    reader.onerror = () => {
      setFileStatus({ name: file.name, sizeKb, rejected: true, reason: 'Failed to read the file.' })
      setIsPending(false)
    }
    reader.readAsText(file)
  }, [extensions, maxMb, sourceLabel, inspect, onDecrypt, applyFile])

  async function handleDecrypt() {
    if (!encPending) return
    if (!decPwd) { showAlert('err', 'Enter the decryption password.'); return }
    setIsPending(true)
    try {
      await onDecrypt(encPending.text, decPwd, encPending.ext, encPending.fileName)
      setEncPending(null)
      setDecPwd('')
      setFileStatus(null)
    } catch (e) {
      // A wrong password is a fact about the *attempt*, not the file, so it
      // belongs in the dismissible alert and the file stays queued for retry.
      showAlert('err', e.message)
    } finally {
      setIsPending(false)
    }
  }

  function onDragOver(e) { e.preventDefault(); if (!disabled) setIsDragOver(true) }
  function onDragLeave() { setIsDragOver(false) }
  function onDrop(e) {
    e.preventDefault()
    setIsDragOver(false)
    if (disabled) return
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }
  function onFileChange(e) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  const accept = extensions.map(e => `.${e}`).join(',')

  return (
    <div className={heading ? 'animate-fade-in data-panel' : 'space-y-3'}>
      {heading && (
        <div className="mb-3">
          <p className="section-label">Import</p>
          <h3 className="mt-1 font-headline text-base font-bold text-text sm:text-lg">{heading}</h3>
        </div>
      )}

      {fileStatus && (
        <div className={`mb-3 flex items-start gap-2 rounded-sm border px-3 py-2 text-[11px] leading-snug ${
          fileStatus.rejected
            ? 'border-danger/30 bg-danger/10'
            : 'border-success/30 bg-success/10'
        }`}>
          {fileStatus.rejected
            ? <XCircle size={13} className="text-danger flex-shrink-0 mt-0.5" />
            : <CheckCircle size={13} className="text-success flex-shrink-0 mt-0.5" />}
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="max-w-full break-all font-mono text-text/80">{fileStatus.name}</span>
              {fileStatus.ext && (
                <span className={`rounded-sm px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest flex-shrink-0 ${
                  fileStatus.rejected ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'
                }`}>
                  .{fileStatus.ext}
                </span>
              )}
              {fileStatus.sizeKb && <span className="text-muted">{fileStatus.sizeKb} KB</span>}
            </div>
            {fileStatus.rejected
              ? <p className="text-danger">{fileStatus.reason}</p>
              : <p className="text-success">File recognized — processing…</p>}
          </div>
        </div>
      )}

      {alert && (
        <div role="alert" className={`mb-3 rounded-sm border px-3 py-2 text-xs font-medium ${
          alert.type === 'ok'
            ? 'border-success/30 bg-success/10 text-success'
            : 'border-danger/30 bg-danger/10 text-danger'
        }`}>
          {alert.text}
        </div>
      )}

      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="Drop a file or click to browse"
        className={`rounded-sm border border-dashed p-6 text-center transition-colors sm:p-10 ${
          disabled
            ? 'cursor-not-allowed border-[var(--hairline)] bg-card opacity-50'
            : isDragOver
              ? 'cursor-pointer border-cyan bg-cyan/10'
              : 'cursor-pointer border-[var(--hairline)] bg-card hover:bg-surface-high'
        }`}
        onClick={() => { if (!disabled) fileInputRef.current?.click() }}
        onKeyDown={e => { if (!disabled && e.key === 'Enter') fileInputRef.current?.click() }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {isPending ? (
          <div className="flex flex-col items-center gap-2">
            <Spinner size={28} />
            <p className="text-sm text-text-secondary">Reading file…</p>
          </div>
        ) : (
          <>
            <FolderOpen size={28} className="mx-auto mb-2 text-text-secondary" />
            <p className="text-sm font-semibold text-text">Drop file here or click to browse</p>
            <p className="mt-1 text-xs text-text-secondary">
              {hint ?? `${extLabel(extensions)} — max ${maxMb} MB`}
            </p>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={onFileChange}
          disabled={disabled}
          aria-hidden
        />
      </div>

      {encPending && (
        <div className="mt-4">
          <div className="mb-3 flex gap-2 rounded-sm border border-cyan/30 bg-cyan/10 px-3 py-2 text-xs text-cyan">
            🔒 This file is AES-256-GCM encrypted. Enter the password to decrypt.
          </div>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Field
                label="Decryption Password"
                id={passwordFieldId}
                type="password"
                placeholder="Enter password…"
                maxLength={1024}
                value={decPwd}
                onChange={e => setDecPwd(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleDecrypt()}
                controlClassName="font-mono"
              />
            </div>
            <button
              onClick={handleDecrypt}
              disabled={isPending}
              className="btn-primary py-2 px-4 disabled:opacity-40"
            >
              {isPending
                ? <Spinner size={16} tone="on-primary" />
                : <Upload size={14} />}
              Decrypt &amp; Import
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
