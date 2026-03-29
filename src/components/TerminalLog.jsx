import { useRef, useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, Terminal, Waves } from 'lucide-react'

const LEVEL_CLASS = {
  INFO: 'log-info',
  OK: 'log-ok',
  WARN: 'log-warn',
  ERR: 'log-err',
  DONE: 'log-done',
}

export default function TerminalLog({ logs, sticky = false, onExpandChange }) {
  const [expanded, setExpanded] = useState(false)
  const endRef = useRef(null)
  const wrapRef = useRef(null)

  function toggle() {
    setExpanded(prev => {
      const next = !prev
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
    ? 'fixed inset-x-0 bottom-0 z-30 overflow-hidden border-t border-white/8 bg-term/95 font-mono text-xs shadow-[0_-18px_48px_rgba(5,8,18,0.55)] backdrop-blur-xl'
    : 'overflow-hidden rounded-[1.25rem] border border-white/8 bg-term font-mono text-xs'

  // Keep page content visible by adding bottom padding to body equal to
  // the terminal's current height when the terminal is sticky. This prevents
  // the fixed terminal from overlapping page elements.
  useEffect(() => {
    if (!sticky) return
    function updateBodyPadding() {
      try {
        const el = wrapRef.current
        if (!el) return
        const h = el.offsetHeight || 0
        document.body.style.paddingBottom = `${h}px`
      } catch (e) {}
    }
    // initial set
    updateBodyPadding()
    // update on resize
    window.addEventListener('resize', updateBodyPadding)
    return () => {
      window.removeEventListener('resize', updateBodyPadding)
      // restore
      try { document.body.style.paddingBottom = '' } catch (e) {}
    }
  }, [sticky, expanded])

  return (
    <div ref={wrapRef} className={wrapClass}>
      <div
        className="flex cursor-pointer select-none items-center justify-between gap-4 bg-[#05070f] px-4 py-3"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={onHeaderKeyDown}
        aria-expanded={expanded}
        aria-controls="terminal-body"
        aria-label={expanded ? 'Collapse logs drawer' : 'Expand logs drawer'}
      >
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-card text-primary">
              <Terminal size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">LOGS</p>
                <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_10px_rgba(142,255,113,0.45)]" />
              </div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-text-secondary">
                {sticky ? 'Activity Stream' : 'Session activity'}
              </p>
            </div>
          </div>

          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <Waves size={13} className="shrink-0 text-cyan" />
            <span className="truncate text-[11px] text-text-secondary">
              {lastLog
                ? (
                  <>
                    <span className="text-muted">{lastLog.ts}</span>{' '}
                    <span className={LEVEL_CLASS[lastLog.level]}>{lastLog.level}</span>{' '}
                    <span>{lastLog.message}</span>
                  </>
                )
                : 'No output yet.'}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="rounded-full bg-card px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-text-secondary">
            {logs.length} lines
          </span>
          <span className="text-text-secondary" aria-hidden="true">
            {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </span>
        </div>
      </div>

      {expanded && (
        <div
          id="terminal-body"
          className="overflow-y-auto bg-term scrollbar-thin"
          style={{ maxHeight: sticky ? 'min(360px, 48vh)' : '340px' }}
          role="log"
          aria-live="polite"
          aria-label="Logs output"
        >
          {logs.length === 0 ? (
            <p className="px-4 py-4 text-muted italic">No output yet.</p>
          ) : (
            <div className="space-y-1 px-4 py-4">
              {logs.map(entry => {
                const isRetry = typeof entry.message === 'string' && /Retry\s+\d+\/\d+/i.test(entry.message)
                return (
                  <div key={entry.id} className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-4 leading-relaxed">
                    <span className="select-none text-muted">{entry.ts}</span>
                    <span className={`select-none ${LEVEL_CLASS[entry.level]}`}>[{entry.level}]</span>
                    <span className={`break-all text-text ${isRetry ? 'log-retry' : ''}`}>
                      {entry.message}
                    </span>
                  </div>
                )
              })}
              <div ref={endRef} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
