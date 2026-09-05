// @vitest-environment jsdom
/**
 * The shared Query|Import strip.
 *
 * Two tools had a byte-for-byte copy of this markup and two had no strip at
 * all. These tests pin the parts that make the four consistent: two items in a
 * fixed order, the Query label varying per tool, and the tab semantics the
 * copied versions lacked.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ToolModeStrip, { modeTabs } from './ToolModeStrip.jsx'

afterEach(cleanup)

const renderStrip = (props = {}) => render(
  <ToolModeStrip
    queryLabel="Query Node"
    value="query"
    onChange={vi.fn()}
    idPrefix="test"
    {...props}
  />,
)

describe('modeTabs', () => {
  it('puts Query first and Import second', () => {
    expect(modeTabs('Scan').map(t => t.key)).toEqual(['query', 'import'])
  })

  it('takes the Query label from the caller and fixes the Import one', () => {
    expect(modeTabs('Compute Rewards').map(t => t.label)).toEqual(['Compute Rewards', 'Import Data'])
  })
})

describe('ToolModeStrip', () => {
  it('renders exactly two tabs in a labelled tablist', () => {
    renderStrip()
    const list = screen.getByRole('tablist', { name: 'Data source' })
    expect(list).toBeTruthy()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  // The copied versions were plain buttons, so a screen reader announced four
  // unrelated controls rather than a two-item tablist with one selected.
  it('marks only the active tab as selected', () => {
    renderStrip({ value: 'import' })
    const [query, imp] = screen.getAllByRole('tab')
    expect(query.getAttribute('aria-selected')).toBe('false')
    expect(imp.getAttribute('aria-selected')).toBe('true')
  })

  it('points each tab at its panel', () => {
    renderStrip({ idPrefix: 'staking' })
    const [query, imp] = screen.getAllByRole('tab')
    expect(query.id).toBe('staking-tab-query')
    expect(query.getAttribute('aria-controls')).toBe('staking-panel-query')
    expect(imp.id).toBe('staking-tab-import')
    expect(imp.getAttribute('aria-controls')).toBe('staking-panel-import')
  })

  it('reports the key that was clicked', () => {
    const onChange = vi.fn()
    renderStrip({ onChange })
    fireEvent.click(screen.getByRole('tab', { name: /Import Data/i }))
    expect(onChange).toHaveBeenCalledWith('import')
  })

  it('still reports a click on the already-active tab', () => {
    const onChange = vi.fn()
    renderStrip({ onChange, value: 'query' })
    fireEvent.click(screen.getByRole('tab', { name: /Query Node/i }))
    expect(onChange).toHaveBeenCalledWith('query')
  })

  it('shows the per-tool Query label', () => {
    renderStrip({ queryLabel: 'Compute Rewards' })
    expect(screen.getByRole('tab', { name: /Compute Rewards/i })).toBeTruthy()
  })
})
