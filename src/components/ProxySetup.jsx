import { useState } from 'react'
import { Shield, ExternalLink, CheckCircle2, AlertTriangle, X } from 'lucide-react'
import { probeProxy } from '../utils/probeProxy.js'

export default function ProxySetup({ proxyUrl, onSave, onDismiss }) {
  const [input, setInput] = useState(proxyUrl || '')
  const [error, setError]  = useState('')
  const [saved, setSaved]  = useState(false)

  function handleSave() {
    setError('')
    if (!input.trim()) {
      // Saving empty = clear proxy (direct mode, CORS will likely fail)
      onSave('')
      setSaved(true)
      return
    }
    const ok = onSave(input.trim())
    if (!ok) {
      setError('Please enter a valid HTTPS URL (e.g. https://your-worker.workers.dev)')
      return
    }
    setSaved(true)
    // probe the proxy to give immediate actionable feedback
    ;(async () => {
      try {
        const ok = await probeProxy(input.trim())
        if (!ok) setError('Proxy check failed — ensure ALLOWED_ORIGIN in the worker matches your app origin.')
      } catch (e) {
        setError('Proxy check error — see browser console for details.')
      }
    })()
  }

  return (
    <div className="card p-5 sm:p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center flex-shrink-0">
            <Shield size={16} className="text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text">CORS Proxy Configuration</h2>
            <p className="text-xs text-dim mt-0.5">Required for browser-based API access</p>
          </div>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="btn-icon !min-w-[32px] !min-h-[32px]" aria-label="Dismiss proxy setup">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Explanation */}
      <div className="bg-surface rounded-lg border border-border p-3 mb-4 text-xs text-dim space-y-1.5">
        <p>
          The Subscan API restricts cross-origin requests. This tool needs a lightweight
          CORS proxy to forward requests from your browser.
        </p>
        <p>
          Deploy a Cloudflare Worker (free tier) using the code in{' '}
          <code className="font-mono text-text-secondary bg-border px-1 py-0.5 rounded">PROXY.md</code>
          {' '}in the repository, then paste its URL here.
        </p>
        <a
          href="https://developers.cloudflare.com/workers/get-started/guide/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-cyan hover:underline"
        >
          Cloudflare Workers guide <ExternalLink size={10} />
        </a>
      </div>

      {/* Input */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1">
          <label htmlFor="proxy-url" className="sr-only">Proxy URL</label>
          <input
            id="proxy-url"
            type="url"
            value={input}
            onChange={e => { setInput(e.target.value); setSaved(false); setError('') }}
            placeholder="https://your-proxy.workers.dev"
            className="w-full px-3 py-2.5 rounded-lg bg-surface border border-border
                       text-text text-sm font-mono placeholder-muted
                       focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary
                       transition-colors"
            autoComplete="off"
            spellCheck={false}
          />
          {error && (
            <p className="mt-1.5 text-xs text-danger flex items-center gap-1">
              <AlertTriangle size={11} /> {error}
            </p>
          )}
        </div>
        <button
          onClick={handleSave}
          className="btn-primary flex-shrink-0 h-10"
        >
          {saved ? <><CheckCircle2 size={14} /> Saved</> : 'Save Proxy'}
        </button>
      </div>

      {saved && (
        <p className="mt-2 text-xs text-success flex items-center gap-1 animate-fade-in">
          <CheckCircle2 size={11} /> Proxy URL saved to your browser.
        </p>
      )}

      {/* Skip option */}
      <p className="mt-3 text-xs text-muted">
        Leave blank to attempt direct requests — this will fail on most browsers due to CORS.
      </p>
    </div>
  )
}
