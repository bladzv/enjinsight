// @vitest-environment jsdom
/**
 * The virtualized drawer's DOM behaviour.
 *
 * `TerminalLog.test.js` covers the pure helpers (`countAppended`, `findRowAt`)
 * in the node environment. This file covers what only a DOM can show:
 *
 *  - that a large log mounts only a window of rows, not all of them;
 *  - that a width change drops the measured-height cache and rebuilds the
 *    offsets. That path is driven by ResizeObserver, whose callbacks are
 *    delivered as part of the rendering lifecycle — which is why it could not
 *    be verified in a hidden browser pane, and why it is stubbed here.
 *
 * jsdom reports every element as 0×0, so heights are stubbed on
 * HTMLElement.prototype rather than measured. That is enough for these
 * assertions: they are about *which* rows are mounted and *whether* the cache
 * is invalidated, not about pixel-accurate layout.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import TerminalLog from './TerminalLog.jsx'

const SHORT_ROW_H = 20
const WRAPPED_ROW_H = 60
// Width below which the stub pretends messages wrap onto three lines.
const NARROW = 500

/** Observers created during a test, so a test can fire them by hand. */
let observers = []
/** Current pretend width of every element. */
let currentWidth = 1000
let descriptors = {}

function stubBox() {
  descriptors = {
    offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
    clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
    clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
  }
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { configurable: true, get() { return currentWidth } },
    clientWidth: { configurable: true, get() { return currentWidth } },
    clientHeight: { configurable: true, get() { return 340 } },
    offsetHeight: {
      configurable: true,
      get() {
        // Only log rows matter; anything else can report the viewport height.
        if (!this.className?.includes?.('grid-cols-[auto_auto_minmax(0,1fr)]')) return 340
        const long = this.textContent.includes('LONG')
        return long && currentWidth < NARROW ? WRAPPED_ROW_H : SHORT_ROW_H
      },
    },
  })
}

function restoreBox() {
  for (const [key, d] of Object.entries(descriptors)) {
    if (d) Object.defineProperty(HTMLElement.prototype, key, d)
  }
}

beforeEach(() => {
  observers = []
  currentWidth = 1000
  stubBox()
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb) { this.cb = cb; observers.push(this) }
    observe() {}
    disconnect() {}
    /** Deliver a callback the way the browser's rendering lifecycle would. */
    fire() { this.cb([], this) }
  })
})

afterEach(() => {
  cleanup()
  restoreBox()
  vi.unstubAllGlobals()
})

const makeLogs = n => Array.from({ length: n }, (_, i) => ({
  id: i,
  ts: '19:30:00',
  level: 'INFO',
  // Every 10th line is the one that wraps once the drawer narrows.
  message: i % 10 === 0 ? `[${i}] LONG message that wraps when narrow` : `[${i}] short`,
}))

const rowNodes = () =>
  [...document.querySelectorAll('.grid-cols-\\[auto_auto_minmax\\(0\\,1fr\\)\\]')]

const spacer = () => document.querySelector('#terminal-body .relative')

function openDrawer() {
  act(() => { screen.getByRole('button', { name: /Expand logs drawer/i }).click() })
}

/**
 * Deliver a ResizeObserver callback and let the invalidation settle.
 *
 * Invalidation is two-step: the callback clears the height cache and rebuilds
 * the offsets from the *old* average, then the re-rendered rows re-measure and
 * schedule a single coalesced version bump on a microtask. A synchronous act()
 * only sees the first step, so the spacer would still read its old total.
 */
async function fireResize() {
  await act(async () => { observers[0].fire() })
}

describe('TerminalLog — virtualization', () => {
  it('mounts only a window of rows for a large log', () => {
    render(<TerminalLog logs={makeLogs(5000)} />)
    openDrawer()
    const mounted = rowNodes().length
    expect(mounted).toBeGreaterThan(0)
    // A viewport of 340px over 20px rows is ~17 rows, plus overscan either side.
    expect(mounted).toBeLessThan(60)
  })

  it('sizes the scroll spacer from the whole log, not the mounted window', () => {
    render(<TerminalLog logs={makeLogs(5000)} />)
    openDrawer()
    // 5000 rows at the stubbed 20px each.
    expect(spacer().style.height).toBe(`${5000 * SHORT_ROW_H}px`)
  })

  it('renders the count with a thousands separator', () => {
    render(<TerminalLog logs={makeLogs(5000)} />)
    expect(screen.getByRole('button', { name: /Expand logs drawer/i }).textContent)
      .toContain('5,000 lines')
  })

  it('says "line" in the singular', () => {
    render(<TerminalLog logs={makeLogs(1)} />)
    expect(screen.getByRole('button', { name: /Expand logs drawer/i }).textContent)
      .toContain('1 line')
  })

  it('shows a placeholder rather than a spacer for an empty log', () => {
    render(<TerminalLog logs={[]} />)
    openDrawer()
    expect(screen.getByText('// no output yet')).toBeTruthy()
    expect(spacer()).toBeNull()
  })
})

describe('TerminalLog — width invalidation', () => {
  it('observes the drawer body once expanded', () => {
    render(<TerminalLog logs={makeLogs(100)} />)
    expect(observers).toHaveLength(0)
    openDrawer()
    expect(observers).toHaveLength(1)
  })

  // The load-bearing case. Measured heights depend on wrap, so they are stale
  // after a width change; the cache must be dropped and the offsets rebuilt.
  it('drops the height cache and regrows the spacer when the drawer narrows', async () => {
    render(<TerminalLog logs={makeLogs(1000)} />)
    openDrawer()

    const wide = spacer().style.height
    expect(wide).toBe(`${1000 * SHORT_ROW_H}px`)

    // Narrow the drawer, then deliver the callback the browser would.
    currentWidth = 400
    await fireResize()

    const narrow = spacer().style.height
    expect(narrow).not.toBe(wide)
    // Every 10th row now measures 60px instead of 20px, so the total must grow.
    expect(parseFloat(narrow)).toBeGreaterThan(parseFloat(wide))
  })

  it('restores the original total when the width comes back', async () => {
    render(<TerminalLog logs={makeLogs(1000)} />)
    openDrawer()
    const wide = spacer().style.height

    currentWidth = 400
    await fireResize()
    expect(spacer().style.height).not.toBe(wide)

    currentWidth = 1000
    await fireResize()
    expect(spacer().style.height).toBe(wide)
  })

  it('does not invalidate when the callback fires at an unchanged width', async () => {
    render(<TerminalLog logs={makeLogs(1000)} />)
    openDrawer()
    const before = spacer().style.height
    await fireResize()
    expect(spacer().style.height).toBe(before)
  })

  // The window listener is the fallback for environments that never deliver
  // ResizeObserver callbacks at all.
  it('also invalidates on a window resize event', async () => {
    render(<TerminalLog logs={makeLogs(1000)} />)
    openDrawer()
    const wide = spacer().style.height

    currentWidth = 400
    await act(async () => { window.dispatchEvent(new Event('resize')) })

    expect(spacer().style.height).not.toBe(wide)
  })

  it('survives an environment with no ResizeObserver at all', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    render(<TerminalLog logs={makeLogs(1000)} />)
    expect(() => openDrawer()).not.toThrow()
    expect(spacer().style.height).toBe(`${1000 * SHORT_ROW_H}px`)
  })
})
