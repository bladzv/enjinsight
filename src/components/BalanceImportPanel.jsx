/**
 * BalanceImportPanel — drag-and-drop / file-picker import for JSON / CSV / XML.
 * Handles encrypted files (.enc.json) by prompting for a decryption password.
 *
 * Security:
 *  - File size validated before reading (MAX_IMPORT_MB)
 *  - Extension validated against allowlist before processing
 *  - All file parsing goes through parseImport() which sanitises field values
 *  - No innerHTML anywhere — all alerts and labels use text content
 */
import { useState, useRef, useCallback } from 'react'
import { Upload, FolderOpen } from 'lucide-react'
import { MAX_IMPORT_MB } from '../constants.js'

export default function BalanceImportPanel({ onImport, onImportEncrypted, bare = false }) {
  const [isDragOver, setIsDragOver]     = useState(false)
  const [isPending,  setIsPending]      = useState(false)
  const [encPending, setEncPending]     = useState(null)  // { text, fname, ext }
  const [decPwd,     setDecPwd]         = useState('')
  const [alert,      setAlert]          = useState(null)  // { type, text }
  const fileInputRef = useRef(null)

  function showAlert(type, text, autoDismiss = true) {
    setAlert({ type, text })
    if (autoDismiss) setTimeout(() => setAlert(null), 7000)
  }

  function validateFile(file) {
    if (file.size > MAX_IMPORT_MB * 1024 * 1024) {
      showAlert('err', `File too large (max ${MAX_IMPORT_MB} MB).`)
      return null
    }
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['json', 'csv', 'xml'].includes(ext)) {
      showAlert('err', `Unsupported file type ".${ext}". Accepted: .json, .csv, .xml`)
      return null
    }
    return ext
  }

  const processFile = useCallback((file) => {
    const ext = validateFile(file)
    if (!ext) return

    setIsPending(true)
    setAlert(null)
    setEncPending(null)

    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target.result
      // Check for encrypted JSON first
      if (ext === 'json') {
        try {
          const obj = JSON.parse(text)
          if (obj?.encrypted === true) {
            setEncPending({ text, fname: file.name, ext })
            setIsPending(false)
            return
          }
        } catch { /* fall through to normal import */ }
      }
      onImport(text, ext, file.name)
      setIsPending(false)
    }
    reader.onerror = () => {
      showAlert('err', 'Failed to read file.')
      setIsPending(false)
    }
    reader.readAsText(file)
  }, [onImport])

  async function handleDecrypt() {
    if (!encPending) return
    if (!decPwd) { showAlert('err', 'Enter the decryption password.'); return }
    setIsPending(true)
    await onImportEncrypted(encPending.text, decPwd, encPending.ext, encPending.fname)
    setEncPending(null)
    setDecPwd('')
    setIsPending(false)
  }

  // ── Drag and drop ───────────────────────────────────────────────────────
  function onDragOver(e) { e.preventDefault(); setIsDragOver(true) }
  function onDragLeave()  { setIsDragOver(false) }
  function onDrop(e) {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }
  function onFileChange(e) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    // Reset input so the same file can be re-selected
    e.target.value = ''
  }

  return (
    <div className={bare ? '' : 'card p-4 animate-fade-in'}>
      {!bare && (
        <div className="flex items-center gap-2 mb-4">
          <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
          <h3 className="text-xs font-bold tracking-widest uppercase text-cyan">Import Balance Data</h3>
        </div>
      )}

      {/* Alert */}
      {alert && (
        <div
          role="alert"
          className={`mb-4 px-4 py-2.5 rounded-lg border text-sm font-medium
            ${alert.type === 'ok'
              ? 'bg-success/10 border-success/30 text-success'
              : 'bg-danger/10 border-danger/30 text-danger'}`}
        >
          {alert.text}
        </div>
      )}

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a file or click to browse"
        className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all
                    ${isDragOver
                      ? 'border-cyan bg-cyan/10'
                      : 'border-border hover:border-rim hover:bg-surface/50'}`}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {isPending
          ? (
            <div className="flex flex-col items-center gap-2">
              <span className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              <p className="text-sm text-dim">Reading file…</p>
            </div>
          )
          : (
            <>
              <FolderOpen size={36} className="mx-auto mb-3 text-dim" />
              <p className="font-semibold text-text mb-1">Drop file here or click to browse</p>
              <p className="text-sm text-dim">
                Supports JSON, CSV, XML exports from this app (max {MAX_IMPORT_MB} MB)
              </p>
            </>
          )
        }
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.csv,.xml"
          className="hidden"
          onChange={onFileChange}
          aria-hidden
        />
      </div>

      {/* Decrypt block (shown when encrypted file detected) */}
      {encPending && (
        <div className="mt-4">
          <div className="flex gap-2 px-4 py-3 rounded-lg bg-cyan/10 border border-cyan/30 text-sm text-cyan mb-3">
            🔒 This file is AES-256-GCM encrypted. Enter the password to decrypt.
          </div>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label htmlFor="dec-pwd" className="block text-xs font-bold tracking-widest uppercase text-dim mb-1.5">
                Decryption Password
              </label>
              <input
                id="dec-pwd"
                type="password"
                placeholder="Enter password…"
                maxLength={1024}
                value={decPwd}
                onChange={e => setDecPwd(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleDecrypt()}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-base
                           text-text font-mono placeholder-muted focus:outline-none
                           focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-colors"
              />
            </div>
            <button
              onClick={handleDecrypt}
              disabled={isPending}
              className="btn-primary py-2 px-4 disabled:opacity-40"
            >
              {isPending
                ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                : <Upload size={14} />
              }
              Decrypt &amp; Import
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
