import { useRef, useState } from 'react'
import { Terminal, ChevronDown, ChevronUp } from 'lucide-react'

const LEVEL_CLASS = {
  INFO: 'log-info',
  OK:   'log-ok',
  WARN: 'log-warn',
  ERR:  'log-err',
  DONE: 'log-done',
}

export default function TerminalLog({ logs, sticky = false, onExpandChange }) {
  const [expanded, setExpanded] = useState(false)
  const endRef = useRef(null)

  function toggle() {
    setExpanded(e => {
      const next = !e
      onExpandChange?.(next)
      return next
    })
  }

  function onHeaderKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
  }

  const lastLog = logs[logs.length - 1]

  const wrapClass = sticky
    ? 'fixed bottom-0 left-0 right-0 z-20 bg-term overflow-hidden font-mono text-xs shadow-[0_-4px_24px_rgba(182,160,255,0.06)]'
    : 'bg-term rounded-xl overflow-hidden font-mono text-xs'

  return (
    <div className={wrapClass}>
      {/* Terminal tab header bar */}
      <div
        className="flex items-center bg-ink cursor-pointer select-none"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={onHeaderKeyDown}
        aria-expanded={expanded}
        aria-controls="terminal-body"
        aria-label={expanded ? 'Collapse logs drawer' : 'Expand logs drawer'}
      >
        <div
          className={`flex items-center gap-2 px-6 py-2 h-full text-[10px] uppercase font-bold tracking-widest transition-colors
            ${expanded
              ? 'text-primary border-t-2 border-primary bg-card'
              : 'text-text-secondary hover:bg-surface-high'
            }`}
        >
          <Terminal size={12} className="flex-shrink-0" />
          Logs
        </div>

        {/* Log count + last message preview */}
        <div className="flex-1 flex items-center gap-2 px-4 min-w-0">
          <span className="text-[10px] text-muted truncate hidden sm:block">
            {lastLog
              ? <><span className="text-muted">{lastLog.ts}</span> <span className={LEVEL_CLASS[lastLog.level]}>[{lastLog.level}]</span> <span className="text-text-secondary">{lastLog.message}</span></>
              : <span className="italic text-muted">Ready</span>
            }
          </span>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-3 px-4">
          <span className="text-[10px] text-muted tabular-nums">{logs.length}</span>
          <span className="text-text-secondary p-1" aria-hidden="true">
            {expanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </span>
        </div>
      </div>

      {/* Log body */}
      {expanded && (
        <div
          id="terminal-body"
          className="bg-term overflow-y-auto scrollbar-thin"
          style={{ maxHeight: 'min(300px, 40vh)' }}
          role="log"
          aria-live="polite"
          aria-label="Logs output"
        >
          {logs.length === 0 ? (
            <p className="px-4 py-4 text-muted italic">No output yet.</p>
          ) : (
            <div className="px-4 py-3 space-y-1">
              {logs.map(entry => (
                <div key={entry.id} className="flex gap-4 items-start leading-relaxed">
                  <span className="text-muted flex-shrink-0 select-none">{entry.ts}</span>
                  <span className={`flex-shrink-0 select-none ${LEVEL_CLASS[entry.level]}`}>
                    [{entry.level}]
                  </span>
                  {/* Entry message is plain text — never HTML — safe to render as string */}
                  {(() => {
                    const isRetry = typeof entry.message === 'string' && /Retry\s+\d+\/\d+/i.test(entry.message)
                    return (
                      <span className={`text-text break-all ${isRetry ? 'log-retry' : ''}`}>
                        {entry.message}
                      </span>
                    )
                  })()}
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
