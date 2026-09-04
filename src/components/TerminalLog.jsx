import { useRef, useState, useEffect, useMemo, useCallback, memo } from 'react'
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react'
import { BULK_FLUSH_MAX } from '../constants.js'

const LEVEL_CLASS = {
  INFO: 'log-info',
  OK: 'log-ok',
  WARN: 'log-warn',
  ERR: 'log-err',
  DONE: 'log-done',
}

// Rows above and below the viewport that are still mounted, so a fast scroll
// or a keyboard PageDown lands on rendered content rather than blank space.
const OVERSCAN = 10
// Starting guess for an unmeasured row, replaced by the running average of
// real measurements as soon as any row has rendered. Only affects the
// scrollbar's length before the log has been scrolled through once.
const INITIAL_ROW_HEIGHT = 20
// How long a row may claim the stream-in animation. After this the marker is
// cleared, so a row remounting because it scrolled back into view does not
// replay the animation. Comfortably longer than --m-fast.
const STREAM_IN_TTL_MS = 500

// Logs are uncapped (see usePoolChecker.js and friends) — nothing discards old
// entries, so a very long session keeps every line in memory even though the
// drawer only ever mounts a window of them. Past this many lines the count
// chip also shows the approximate cost, so that growth is visible rather than
// silent. Below the threshold the estimate is noise, not information.
const SIZE_HINT_THRESHOLD = 50_000
// Measured on a real long-running scan: each entry ({id, ts, level, message})
// costs roughly 110 bytes of retained heap. Rough by nature — message length
// varies — so this is a magnitude indicator, not an accounting figure.
const BYTES_PER_LOG_ENTRY = 110

/** "≈11 MB" for a log this long, or '' below the threshold. Exported for tests. */
export function sizeHint(count) {
  if (count < SIZE_HINT_THRESHOLD) return ''
  const mb = (count * BYTES_PER_LOG_ENTRY) / (1024 * 1024)
  return ` (≈${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB)`
}

/**
 * How many entries `next` gained on the end of `prev`.
 *
 * Not a length delta: `logs` is replaced wholesale in several places — a reset
 * empties it, an import swaps a finished scan's lines for a single provenance
 * line — and a delta would report those as a large negative or positive append.
 * Walking from the tail resolves the common case (one line appended) on the
 * second step, and reports the full length when the arrays share no history.
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
 * Index of the last offset that is <= `y`, by binary search.
 *
 * `offsets` is an ascending cumulative row-height array of length n+1. This is
 * called on every scroll frame, so it must not walk the list — an uncapped log
 * can hold tens of thousands of entries.
 */
export function findRowAt(offsets, y) {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * A single log line, memoized so appending a new entry does not re-render (and
 * re-run the retry regex on) every mounted row.
 *
 * Carries its own bottom gap rather than relying on a parent `space-y-*`: only
 * a slice of the list is mounted, so an "all but the first child" margin rule
 * would drop the gap above whichever row happened to start the window, and the
 * measured height would then not match the laid-out height.
 */
const LogRow = memo(function LogRow({ entry, streamIn = false, measureRef }) {
  // Captured once at mount and never re-read. The parent clears the marker the
  // moment another line lands; honouring that would strip the class off a row
  // that is still mid-fade and snap it.
  const [animate] = useState(streamIn)
  const isRetry = typeof entry.message === 'string' && /Retry\s+\d+\/\d+/i.test(entry.message)
  return (
    <div
      ref={measureRef}
      className={`grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-2 pb-0.5 leading-relaxed sm:gap-x-3 ${animate ? 'log-row-in' : ''}`}
    >
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
  const wrapRef = useRef(null)
  const bodyRef = useRef(null)
  // Tracks whether the user is scrolled to (or near) the bottom, so streamed
  // output follows along by default but a deliberate scroll-up to read
  // earlier lines is never yanked back down by the next appended entry.
  const stickToBottomRef = useRef(true)

  // ── Row measurement ─────────────────────────────────────────────────────
  // Real heights, keyed by entry id. Rows wrap (`break-all` on a long message),
  // so they are not uniform and their height cannot be assumed. A fixed row
  // height would have meant truncating messages to a single line, which is the
  // part of a log people actually need to read.
  const heightsRef = useRef(new Map())
  const pendingBumpRef = useRef(false)
  const [heightsVersion, setHeightsVersion] = useState(0)
  const [avgRowHeight, setAvgRowHeight] = useState(INITIAL_ROW_HEIGHT)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  /**
   * Record a row's laid-out height.
   *
   * Bumping `heightsVersion` rebuilds the offsets, which is O(n), so it only
   * happens when a height is new or has actually changed. Once the first
   * screenful is measured the average settles and further scrolling measures
   * almost nothing, which is what keeps scrolling O(log n).
   */
  const measure = useCallback((id, el) => {
    if (!el) return
    // A row measured at zero width is not a row height: every message wraps to
    // one character per line, so it comes back many times too tall and poisons
    // the average for the whole list. Happens whenever the drawer is laid out
    // while collapsed or detached. Skip it and measure again when it is real.
    if (!el.offsetWidth) return
    const h = el.offsetHeight
    if (!h) return
    if (heightsRef.current.get(id) === h) return
    heightsRef.current.set(id, h)

    // Coalesce the version bump. Every row's ref callback runs in the same
    // commit, and each bump costs an O(n) offsets rebuild — bumping per row
    // made one scroll into a hundred thousand-entry log rebuild the offsets
    // once per newly measured row. A microtask fires after the whole commit,
    // so a screenful of measurements costs one rebuild. Deliberately not
    // requestAnimationFrame: that is never delivered to a page the browser is
    // not rendering, which would strand the measurements indefinitely.
    if (pendingBumpRef.current) return
    pendingBumpRef.current = true
    queueMicrotask(() => {
      pendingBumpRef.current = false
      setHeightsVersion(v => v + 1)
    })
  }, [])

  // Wrapping depends on the drawer's width, so every measured height is stale
  // after a horizontal resize. Dropping the cache and re-measuring the visible
  // rows is cheaper and far more predictable than trying to adjust them.
  //
  // Watched two ways on purpose. ResizeObserver is the correct mechanism — it
  // catches a width change with no window resize behind it, such as a sidebar
  // collapsing — but its callbacks are delivered as part of the rendering
  // lifecycle, so a backgrounded or non-rendering page never receives them. The
  // window listener is the fallback that covers the ordinary case regardless.
  useEffect(() => {
    const el = bodyRef.current
    if (!expanded || !el) return
    let lastWidth = el.clientWidth

    function sync() {
      const node = bodyRef.current
      if (!node) return
      setViewportHeight(node.clientHeight)
      if (node.clientWidth === lastWidth) return
      lastWidth = node.clientWidth
      heightsRef.current.clear()
      setHeightsVersion(v => v + 1)
    }

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    ro?.observe(el)
    window.addEventListener('resize', sync)
    setViewportHeight(el.clientHeight)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [expanded])

  // Cumulative offsets, rebuilt only when the list or a measurement changes.
  const offsets = useMemo(() => {
    const out = new Float64Array(logs.length + 1)
    const heights = heightsRef.current
    let measured = 0
    let sum = 0
    for (let i = 0; i < logs.length; i++) {
      const h = heights.get(logs[i].id)
      if (h != null) { measured++; sum += h }
      out[i + 1] = out[i] + (h ?? avgRowHeight)
    }
    // Feed the measured average back as the estimate for rows not yet seen.
    // Guarded so it cannot chase its own tail: only a shift worth another
    // offsets rebuild is applied.
    if (measured > 0) {
      const next = sum / measured
      if (Math.abs(next - avgRowHeight) > 0.5) setAvgRowHeight(next)
    }
    return out
  }, [logs, heightsVersion, avgRowHeight])

  const totalHeight = offsets[logs.length] ?? 0

  const [startIndex, endIndex] = useMemo(() => {
    if (!logs.length) return [0, 0]
    const first = Math.max(0, findRowAt(offsets, scrollTop) - OVERSCAN)
    const last = Math.min(
      logs.length,
      findRowAt(offsets, scrollTop + (viewportHeight || 340)) + 1 + OVERSCAN,
    )
    return [first, last]
  }, [offsets, scrollTop, viewportHeight, logs.length])

  const visibleRows = useMemo(
    () => logs.slice(startIndex, endIndex),
    [logs, startIndex, endIndex],
  )

  // ── Stream-in marker ────────────────────────────────────────────────────
  // Which entry, if any, gets the stream-in animation. Only ever the newest
  // one, and only when it arrived in a small batch: InfusionChecker flushes
  // dozens of lines in a single commit, and animating all of them at once is
  // exactly the jank this avoids. Derived during render rather than in an
  // effect so a row's class is right on its very first paint.
  const [prevLogs, setPrevLogs] = useState(logs)
  const [streamInId, setStreamInId] = useState(null)
  if (prevLogs !== logs) {
    const added = countAppended(prevLogs, logs)
    setPrevLogs(logs)
    setStreamInId(added > 0 && added <= BULK_FLUSH_MAX ? logs[logs.length - 1].id : null)
  }

  // Expire the marker. Without this, a row that unmounted on scroll-up and
  // remounts on the way back down would replay its animation, because the
  // animate flag is captured at mount.
  useEffect(() => {
    if (streamInId == null) return
    const timer = window.setTimeout(() => setStreamInId(null), STREAM_IN_TTL_MS)
    return () => window.clearTimeout(timer)
  }, [streamInId])

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
  // Assigns scrollTop against the virtual scroll height rather than calling
  // scrollIntoView on a sentinel: with only a window of rows mounted, the
  // newest entry usually has no element to scroll to.
  useEffect(() => {
    const el = bodyRef.current
    if (!expanded || !el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
    setScrollTop(el.scrollTop)
  }, [logs, expanded, totalHeight])

  // On open, start at the newest line and read the viewport height.
  useEffect(() => {
    const el = bodyRef.current
    if (!expanded || !el) return
    stickToBottomRef.current = true
    setViewportHeight(el.clientHeight)
    el.scrollTop = el.scrollHeight
    setScrollTop(el.scrollTop)
  }, [expanded])

  function onBodyScroll() {
    const el = bodyRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    setScrollTop(el.scrollTop)
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
            {logs.length.toLocaleString()} {logs.length === 1 ? 'line' : 'lines'}{sizeHint(logs.length)}
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
            /* Only `visibleRows` is mounted. The outer box carries the full
               height so the scrollbar stays honest, and the window is placed
               by translating it to its own first row's offset. */
            <div className="relative px-4 py-3" style={{ height: totalHeight }}>
              <div
                className="absolute left-4 right-4 top-3"
                style={{ transform: `translateY(${offsets[startIndex] ?? 0}px)` }}
              >
                {visibleRows.map(entry => (
                  <LogRow
                    key={entry.id}
                    entry={entry}
                    streamIn={entry.id === streamInId}
                    measureRef={el => measure(entry.id, el)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {/* A live region over the whole log would announce every appended line
          during a scan — and the log is now unbounded. Mirror only the newest
          entry instead: enough for a screen-reader user to follow progress
          without a wall of announcements. */}
      <div className="sr-only" role="status" aria-live="polite">
        {lastLog ? `${lastLog.level}: ${lastLog.message}` : ''}
      </div>
    </div>
  )
}
