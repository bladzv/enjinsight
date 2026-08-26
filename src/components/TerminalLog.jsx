import { useRef, useState, useEffect, memo } from 'react'
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react'
import { BULK_FLUSH_MAX } from '../constants.js'

const LEVEL_CLASS = {
  INFO: 'log-info',
  OK: 'log-ok',
  WARN: 'log-warn',
  ERR: 'log-err',
  DONE: 'log-done',
}

/**
 * How many entries `next` gained on the end of `prev`.
 *
 * Walks from the tail so the common case (one line appended) resolves on the
 * second step, and — unlike a plain length delta — it stays correct once the
 * 500-entry cap starts rotating older lines out, where the array length stops
 * growing even though lines are still arriving.
 */
export function countAppended(prev, next) {
  if (!prev.length) return next.length
  const lastPrevId = prev[prev.length - 1].id
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].id === lastPrevId) return next.length - 1 - i
  }
  return next.length
}

/**
 * A single log line, memoized so appending a new entry does not re-render (and
 * re-run the retry regex on) every existing row — the previous inline map ran
 * this work for all up to 500 entries on every append.
 */
const LogRow = memo(function LogRow({ entry, streamIn = false }) {
  // Captured once at mount and never re-read. The parent flips this to false
  // on the previously-newest row the moment another line lands; honouring that
  // would strip the class off a row that is still mid-fade and snap it.
  const [animate] = useState(streamIn)
  const isRetry = typeof entry.message === 'string' && /Retry\s+\d+\/\d+/i.test(entry.message)
  return (
    <div className={`grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-2 gap-y-1 leading-relaxed sm:gap-x-3 ${animate ? 'log-row-in' : ''}`}>
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
  const bodyRef = useRef(null)
  // Tracks whether the user is scrolled to (or near) the bottom, so streamed
  // output follows along by default but a deliberate scroll-up to read
  // earlier lines is never yanked back down by the next appended entry.
  const stickToBottomRef = useRef(true)

  // Which entry, if any, gets the stream-in animation. Only ever the newest
  // one, and only when it arrived in a small batch: InfusionChecker flushes
  // dozens of lines in a single commit, and animating all of them at once is
  // exactly the jank this phase exists to avoid. Derived during render rather
  // than in an effect so a row's class is right on its very first paint —
  // deciding a frame later would mean animating from an already-visible state.
  const [prevLogs, setPrevLogs] = useState(logs)
  const [streamInId, setStreamInId] = useState(null)
  if (prevLogs !== logs) {
    const added = countAppended(prevLogs, logs)
    setPrevLogs(logs)
    setStreamInId(added > 0 && added <= BULK_FLUSH_MAX ? logs[logs.length - 1].id : null)
  }

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
      } catch {}
    }
    updateBodyPadding()
    window.addEventListener('resize', updateBodyPadding)
    return () => {
      window.removeEventListener('resize', updateBodyPadding)
      try { document.body.style.paddingBottom = prevPaddingBottom } catch {}
    }
  }, [sticky, expanded])

  // Follow streamed output, but only while already scrolled to the bottom.
  // endRef was previously declared and attached with nothing ever calling
  // scrollIntoView on it, so the drawer never actually followed a live scan.
  useEffect(() => {
    if (!expanded || !stickToBottomRef.current) return
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [logs, expanded])

  function onBodyScroll() {
    const el = bodyRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

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
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/40 bg-card text-primary">
            <Terminal size={13} />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
              {sticky ? 'logs' : 'session'}
            </span>
            <span className={`h-1 w-1 rounded-full ${logs.length ? 'bg-success animate-pulse' : 'bg-muted'}`} />
          </div>

          <div className="hidden min-w-0 flex-1 items-center gap-2 lg:flex">
            <span className="min-w-0 flex-1 font-mono text-[11px] leading-4 text-text-secondary whitespace-nowrap overflow-hidden text-ellipsis">
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
          ref={bodyRef}
          id="terminal-body"
          className="overflow-y-auto bg-term scrollbar-thin"
          style={{ maxHeight: sticky ? 'min(320px, 42dvh)' : '340px' }}
          role="log"
          aria-live="off"
          aria-label="Logs output"
          onScroll={onBodyScroll}
        >
          {logs.length === 0 ? (
            <p className="px-4 py-4 text-muted italic">// no output yet</p>
          ) : (
            <div className="space-y-0.5 px-4 py-3">
              {logs.map(entry => (
                <LogRow key={entry.id} entry={entry} streamIn={entry.id === streamInId} />
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
      )}
      {/* A live region over the full 500-entry log would announce every appended
          line during a scan. Mirror only the newest entry instead — enough for a
          screen-reader user to follow progress without a wall of announcements. */}
      <div className="sr-only" role="status" aria-live="polite">
        {lastLog ? `${lastLog.level}: ${lastLog.message}` : ''}
      </div>
    </div>
  )
}
