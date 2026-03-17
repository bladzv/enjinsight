/**
 * BalanceExportPanel — export balance records to JSON / CSV / XML,
 * with optional AES-256-GCM encryption.
 *
 * Only rendered when dataSource === 'query' (not for imported data).
 */
import { useState } from 'react'
import { Download, Lock, Unlock } from 'lucide-react'
import {
  toJSON, toCSV, toXML,
  aesEncrypt, downloadFile,
  safeFilename, defaultFilename,
} from '../utils/balanceExport.js'

const MIME = { json: 'application/json', csv: 'text/csv', xml: 'application/xml' }

export default function BalanceExportPanel({ records, rpcMeta }) {
  const [filename, setFilename]     = useState('')
  const [format,   setFormat]       = useState('json')
  const [encOn,    setEncOn]        = useState(false)
  const [password, setPassword]     = useState('')
  const [busy,     setBusy]         = useState(false)
  const [message,  setMessage]      = useState(null) // { type:'ok'|'err', text }

  async function handleExport() {
    if (!records.length) { setMessage({ type: 'err', text: 'No data to export.' }); return }
    if (encOn && !password)  { setMessage({ type: 'err', text: 'Enter an encryption password.' }); return }
    setBusy(true)
    setMessage(null)
    try {
      const fname = filename.trim() || defaultFilename()
      const meta  = { ...rpcMeta, exportedAt: new Date().toISOString() }
      let content = format === 'json' ? toJSON(records, meta)
                  : format === 'csv'  ? toCSV(records, meta)
                  : toXML(records, meta)
      if (encOn) {
        content = await aesEncrypt(content, password)
        downloadFile(content, `${fname}.enc.json`, 'application/json')
        setMessage({ type: 'ok', text: `Encrypted file saved: ${safeFilename(fname)}.enc.json` })
      } else {
        downloadFile(content, `${fname}.${format}`, MIME[format])
        setMessage({ type: 'ok', text: `File saved: ${safeFilename(fname)}.${format}` })
      }
    } catch (e) {
      setMessage({ type: 'err', text: `Export failed: ${e.message}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4 animate-fade-in">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-0.5 h-3.5 bg-cyan rounded-sm" />
        <h3 className="text-xs font-bold tracking-widest uppercase text-cyan">Export Data</h3>
      </div>

      {message && (
        <div
          role="alert"
          className={`mb-4 px-4 py-2.5 rounded-lg border text-sm font-medium
            ${message.type === 'ok'
              ? 'bg-success/10 border-success/30 text-success'
              : 'bg-danger/10 border-danger/30 text-danger'}`}
        >
          {message.text}
        </div>
      )}

      {/* Encrypt toggle — entire row is clickable */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => { setEncOn(v => { if (v) setPassword(''); return !v }) }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEncOn(v => { if (v) setPassword(''); return !v }) } }}
        className="flex items-center gap-3 mb-4 cursor-pointer select-none w-fit"
        aria-label="Toggle AES-256-GCM encryption"
      >
        <div
          role="switch"
          aria-checked={encOn}
          className={`relative w-9 h-5 rounded-full border transition-all flex-shrink-0
                      ${encOn ? 'bg-cyan border-cyan' : 'bg-surface border-border'}`}
        >
          <span
            className={`absolute top-0.5 left-0 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform
                        ${encOn ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
          />
        </div>
        <span className="text-sm font-semibold text-dim flex items-center gap-1.5">
          {encOn ? <Lock size={13} className="text-cyan" /> : <Unlock size={13} />}
          Encrypt Output (AES-256-GCM)
        </span>
      </div>

      {/* Password field (visible when encrypt on) */}
      {encOn && (
        <div className="mb-4 max-w-sm">
          <label htmlFor="enc-pwd" className="block text-xs font-bold tracking-widest uppercase text-dim mb-1.5">
            Encryption Password
          </label>
          <input
            id="enc-pwd"
            type="password"
            placeholder="Enter password…"
            maxLength={1024}
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-base
                       text-text font-mono placeholder-muted focus:outline-none
                       focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-colors"
          />
        </div>
      )}

      {/* Filename + format + export button */}
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto] items-end">
        <div>
          <label htmlFor="exp-fname" className="block text-xs font-bold tracking-widest uppercase text-dim mb-1.5">
            Filename
          </label>
          <input
            id="exp-fname"
            type="text"
            maxLength={200}
            autoComplete="off"
            spellCheck="false"
            placeholder={defaultFilename()}
            value={filename}
            onChange={e => setFilename(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-base
                       text-text font-mono placeholder-muted focus:outline-none
                       focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-colors"
          />
        </div>

        <div>
          <label htmlFor="exp-fmt" className="block text-xs font-bold tracking-widest uppercase text-dim mb-1.5">
            Format
          </label>
          <select
            id="exp-fmt"
            value={format}
            onChange={e => setFormat(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-base
                       text-text focus:outline-none focus:border-primary/50 transition-colors"
          >
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
            <option value="xml">XML</option>
          </select>
        </div>

        <button
          onClick={handleExport}
          disabled={busy || !records.length}
          className="btn-primary py-2 px-5 disabled:opacity-40 disabled:cursor-not-allowed self-end"
        >
          {busy
            ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
            : <Download size={14} />
          }
          Export
        </button>
      </div>
    </div>
  )
}
