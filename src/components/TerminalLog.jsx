import { useEffect, useRef, useState } from 'react'
import { Terminal, ChevronDown, ChevronUp, X } from 'lucide-react'

const LEVEL_CLASS = {
  INFO: 'log-info',
  OK:   'log-ok',
  WARN: 'log-warn',
  ERR:  'log-err',
  DONE: 'log-done',
}

export default function TerminalLog({ logs }) {
  const [expanded, setExpanded] = useState(false)
  const endRef = useRef(null)

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (expanded && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, expanded])

  // Auto-expand on first log
  useEffect(() => {
    if (logs.length === 1) setExpanded(true)
  }, [logs.length])

  const lastLog = logs[logs.length - 1]

  return (
    <div className="card overflow-hidden font-mono text-xs">
      {/* Toggle bar — always visible */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-term hover:bg-surface/80
                   transition-colors text-left"
        aria-expanded={expanded}
        aria-controls="terminal-body"
        aria-label={expanded ? 'Collapse terminal log' : 'Expand terminal log'}
      >
        <Terminal size={13} className="text-primary flex-shrink-0" />
        <span className="text-dim text-[11px] font-semibold uppercase tracking-widest">Logs</span>
        <span className="flex-1 truncate text-dim ml-2">
          {lastLog
            ? <><span className="log-ts">{lastLog.ts}</span> <span className={LEVEL_CLASS[lastLog.level]}>[{lastLog.level}]</span> {lastLog.message}</>
            : <span className="text-muted italic">Ready — waiting for CHECK…</span>
          }
        </span>
        <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-border text-dim">
          {logs.length}
        </span>
        {expanded ? <ChevronUp size={13} className="text-dim flex-shrink-0" /> : <ChevronDown size={13} className="text-dim flex-shrink-0" />}
      </button>

      {/* Log body */}
      {expanded && (
        <div
          id="terminal-body"
          className="bg-term overflow-y-auto scrollbar-thin"
          style={{ maxHeight: 'min(300px, 40vh)' }}
          role="log"
          aria-live="polite"
          aria-label="Terminal log output"
        >
          {logs.length === 0 ? (
            <p className="px-4 py-4 text-muted italic">No output yet.</p>
          ) : (
            <div className="px-4 py-3 space-y-0.5">
              {logs.map(entry => (
                <div key={entry.id} className="flex gap-2 items-start leading-relaxed">
                  <span className="log-ts flex-shrink-0 select-none">{entry.ts}</span>
                  <span className={`flex-shrink-0 select-none ${LEVEL_CLASS[entry.level]}`}>
                    [{entry.level}]
                  </span>
                  {/* Entry message is plain text — never HTML — safe to render as string */}
                  <span className="text-[#C8C8E8] break-all">{entry.message}</span>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
