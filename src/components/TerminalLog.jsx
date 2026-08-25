import { useRef, useState, useEffect, memo } from 'react'
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react'

const LEVEL_CLASS = {
  INFO: 'log-info',
  OK: 'log-ok',
  WARN: 'log-warn',
  ERR: 'log-err',
  DONE: 'log-done',
}

/**
 * A single log line, memoized so appending a new entry does not re-render (and
 * re-run the retry regex on) every existing row — the previous inline map ran
 * this work for all up to 500 entries on every append.
 */
const LogRow = memo(function LogRow({ entry }) {
  const isRetry = typeof entry.message === 'string' && /Retry\s+\d+\/\d+/i.test(entry.message)
  return (
    <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-2 gap-y-1 leading-relaxed sm:gap-x-3">
      <span className="select-none text-muted">{entry.ts}</span>
      <span className={`select-none ${LEVEL_CLASS[entry.level]}`}>[{entry.level}]</span>
      <span className={`break-all text-text ${isRetry ? 'log-retry' : ''}`}>
        {entry.message}
      </span>
    </div>
  )
})

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
    ? 'terminal-sticky fixed bottom-0 z-30 overflow-hidden border-t border-border/40 bg-term/95 font-mono text-xs backdrop-blur-md'
    : 'overflow-hidden rounded-sm border border-border/40 bg-term font-mono text-xs'

  // Reflect terminal drawer height in body padding so fixed dock never
  // overlaps page content.
  useEffect(() => {
    if (!sticky) return
    // Save and restore the prior value on cleanup rather than hardcoding it back
    // to '', matching how the modals handle body.style.overflow — an unconditional
    // reset would clobber anything else that had set padding-bottom in the meantime.
    const prevPaddingBottom = document.body.style.paddingBottom
    function updateBodyPadding() {
      try {
        const el = wrapRef.current
        if (!el) return
        const h = el.offsetHeight || 0
        document.body.style.paddingBottom = `${h}px`
      } catch (e) {}
    }
    updateBodyPadding()
    window.addEventListener('resize', updateBodyPadding)
    return () => {
      window.removeEventListener('resize', updateBodyPadding)
      try { document.body.style.paddingBottom = prevPaddingBottom } catch (e) {}
    }
  }, [sticky, expanded])

  return (
    <div ref={wrapRef} className={wrapClass}>
      <div
        className="flex cursor-pointer select-none items-center justify-between gap-4 border-t border-border/30 bg-surface-high px-4 py-2.5"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={onHeaderKeyDown}
        aria-expanded={expanded}
        aria-controls="terminal-body"
        aria-label={expanded ? 'Collapse logs drawer' : 'Expand logs drawer'}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/40 bg-card text-primary">
            <Terminal size={13} />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
              {sticky ? 'logs' : 'session'}
            </span>
            <span className={`h-1 w-1 rounded-full ${logs.length ? 'bg-success animate-pulse' : 'bg-muted'}`} />
          </div>

          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <span className="font-mono text-[11px] leading-4 text-text-secondary whitespace-nowrap overflow-hidden text-ellipsis max-w-[60ch]">
              {lastLog
                ? (
                  <>
                    <span className="text-muted">{lastLog.ts}</span>{' '}
                    <span className={LEVEL_CLASS[lastLog.level]}>{lastLog.level}</span>{' '}
                    <span>{lastLog.message}</span>
                  </>
                )
                : '(no output)'}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="rounded-sm border border-border/40 bg-card/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-text-secondary">
            {logs.length} ln
          </span>
          <span className="text-text-secondary" aria-hidden="true">
            {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </span>
        </div>
      </div>

      {expanded && (
        <div
          id="terminal-body"
          className="overflow-y-auto bg-term scrollbar-thin"
          style={{ maxHeight: sticky ? 'min(320px, 42dvh)' : '340px' }}
          role="log"
          aria-live="polite"
          aria-label="Logs output"
        >
          {logs.length === 0 ? (
            <p className="px-4 py-4 text-muted italic">// no output yet</p>
          ) : (
            <div className="space-y-0.5 px-4 py-3">
              {logs.map(entry => <LogRow key={entry.id} entry={entry} />)}
              <div ref={endRef} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
