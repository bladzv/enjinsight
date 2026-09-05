/**
 * ScanExportPanel — export a Staking Cadence or Infusion Checker scan to a
 * single JSON file, with optional AES-256-GCM encryption.
 *
 * Unlike BalanceExportPanel there is no format choice: these scans are
 * nested (per-validator/per-pool era arrays), so CSV or XML would either
 * flatten lossily or need a bespoke parser. A single JSON label is shown
 * instead of a one-option select.
 */
import { useState, useMemo } from 'react'
import { Download, Info, Lock, Unlock } from 'lucide-react'
import { downloadFile, safeFilename } from '../utils/balanceExport.js'
import { defaultScanFilename, encryptScanFile } from '../utils/scanExport.js'
import Spinner from './Spinner.jsx'
import Field from './Field.jsx'

/**
 * @param {object} props
 * @param {string} props.schema - one of SCAN_SCHEMAS, used only for the default filename.
 * @param {() => string} props.buildContent - returns the plaintext JSON export for the current scan.
 * @param {boolean} [props.allowEncryption] - show the encrypt toggle. Off by default: the two
 *   Staking Cadence exports are plaintext; only the Infusion Checker offers encryption.
 * @param {boolean} [props.disabled] - e.g. while a scan is running, or for imported data.
 * @param {string} [props.notice] - standing caveat about what is being written, shown
 *   above the controls. Used to say that a filter narrowed the scan, since the file
 *   itself is structurally identical to an unfiltered one.
 */
export default function ScanExportPanel({ schema, buildContent, allowEncryption = false, disabled = false, notice = null }) {
  const [filename, setFilename] = useState('')
  const [encOn,    setEncOn]    = useState(false)
  const [password, setPassword] = useState('')
  const [busy,     setBusy]     = useState(false)
  const [message,  setMessage]  = useState(null) // { type:'ok'|'err', text }

  // Frozen per mount (not recomputed on every render) so the placeholder
  // shown below is byte-identical to the name actually saved.
  const defaultName = useMemo(() => defaultScanFilename(schema), [schema])

  async function handleExport() {
    if (encOn && !password) { setMessage({ type: 'err', text: 'Enter an encryption password.' }); return }
    setBusy(true)
    setMessage(null)
    try {
      const fname = filename.trim() || defaultName
      const plain = buildContent()
      if (encOn) {
        const content = await encryptScanFile(plain, password)
        downloadFile(content, `${fname}.enc.json`, 'application/json')
        setMessage({ type: 'ok', text: `Encrypted file saved: ${safeFilename(fname)}.enc.json` })
      } else {
        downloadFile(plain, `${fname}.json`, 'application/json')
        setMessage({ type: 'ok', text: `File saved: ${safeFilename(fname)}.json` })
      }
    } catch (e) {
      setMessage({ type: 'err', text: `Export failed: ${e.message}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="animate-fade-in data-panel">
      <div className="mb-3">
        <p className="section-label">Export</p>
        <h3 className="mt-1 font-headline text-base font-bold text-text sm:text-lg">Save scan</h3>
      </div>

      {notice && (
        <div className="mb-3 flex items-start gap-2 rounded-sm border border-cyan/30 bg-cyan/10 px-3 py-2 text-xs text-cyan">
          <Info size={13} className="mt-0.5 flex-shrink-0" />
          <p className="min-w-0 flex-1">{notice}</p>
        </div>
      )}

      {message && (
        <div
          role="alert"
          className={`mb-3 rounded-sm border px-3 py-2 text-xs font-medium ${
            message.type === 'ok'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-danger/30 bg-danger/10 text-danger'
          }`}
        >
          {message.text}
        </div>
      )}

      {allowEncryption && (
        <>
          {/* Encrypt toggle — entire row is clickable */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => { setEncOn(v => { if (v) setPassword(''); return !v }) }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEncOn(v => { if (v) setPassword(''); return !v }) } }}
            className="mb-4 flex w-fit cursor-pointer select-none items-center gap-3"
            aria-label="Toggle AES-256-GCM encryption"
          >
            <div
              role="switch"
              aria-checked={encOn}
              className={`relative w-9 h-5 rounded-full transition-all flex-shrink-0
                          ${encOn ? 'bg-cyan' : 'bg-card'}`}
            >
              <span
                className={`absolute top-0.5 left-0 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform
                            ${encOn ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
              />
            </div>
            <span className="text-sm font-semibold text-text-secondary flex items-center gap-1.5">
              {encOn ? <Lock size={13} className="text-cyan" /> : <Unlock size={13} />}
              Encrypt Output (AES-256-GCM)
            </span>
          </div>

          {encOn && (
            <div className="mb-4 max-w-sm">
              <Field
                label="Encryption Password"
                id="scan-enc-pwd"
                type="password"
                placeholder="Enter password…"
                maxLength={1024}
                value={password}
                onChange={e => setPassword(e.target.value)}
                controlClassName="font-mono"
              />
            </div>
          )}
        </>
      )}

      {/* Filename + format label + export button */}
      <div className="grid gap-3 sm:grid-cols-[1fr_80px_auto] items-end">
        <div>
          <Field
            label="Filename"
            id="scan-exp-fname"
            type="text"
            maxLength={200}
            autoComplete="off"
            spellCheck="false"
            placeholder={defaultName}
            value={filename}
            onChange={e => setFilename(e.target.value)}
            controlClassName="font-mono"
            disabled={disabled}
          />
        </div>

        <div>
          <span className="block text-xs font-bold tracking-widest uppercase text-muted mb-1.5">
            Format
          </span>
          <div className="select-field flex items-center text-text-secondary">
            JSON
          </div>
        </div>

        <button
          onClick={handleExport}
          disabled={busy || disabled}
          className="btn-primary py-2 px-5 disabled:opacity-40 disabled:cursor-not-allowed self-end"
        >
          {busy
            ? <Spinner size={16} tone="on-primary" />
            : <Download size={14} />
          }
          Export
        </button>
      </div>
    </div>
  )
}
