// @vitest-environment jsdom
/**
 * The shared import-provenance banner.
 *
 * Four tools had a near-identical copy of this as a run-on sentence. These
 * tests pin what the shared version has to keep doing: render every field as
 * a labelled row, degrade to an em-dash rather than dropping a row when an
 * older export omits a field, pluralise the record noun, and surface a
 * filtered export as something other than a complete scan.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import ImportProvenance from './ImportProvenance.jsx'

afterEach(cleanup)

const FULL = {
  fileName: 'enjin_staking_pool_1788651750.json',
  exportedAt: '2026-09-05T23:48:24.000Z',
  appVersion: '1.0.0',
  typeLabel: 'Staking Cadence (pool mode)',
  count: 131,
  noun: 'pool',
  note: 'Nothing was fetched.',
}

const renderBanner = (props = {}) =>
  render(<ImportProvenance {...FULL} onClear={vi.fn()} {...props} />)

/** The <dd> paired with a given <dt>, so a row is asserted as a pair. */
function valueFor(label) {
  const dt = screen.getByText(label)
  return dt.nextElementSibling
}

describe('ImportProvenance', () => {
  it('renders every provenance field as a labelled row', () => {
    renderBanner()
    expect(valueFor('File').textContent).toContain('enjin_staking_pool_1788651750.json')
    expect(valueFor('Exported').textContent).toContain('2026-09-05 23:48:24 UTC')
    expect(valueFor('Tool').textContent).toContain('EnjinSight')
    expect(valueFor('Version').textContent).toContain('v1.0.0')
    expect(valueFor('Type').textContent).toContain('Staking Cadence (pool mode)')
    expect(valueFor('Records').textContent).toContain('131 pools')
  })

  it('states what did not happen', () => {
    renderBanner()
    expect(screen.getByText(/Nothing was fetched\./)).toBeTruthy()
  })

  it('keeps the row and shows an em-dash for fields a legacy export omits', () => {
    // An export written before the shared header carries no version, and the
    // legacy sniff path supplies no schema. A missing row would read as though
    // the field had never been part of the record.
    renderBanner({ appVersion: null, typeLabel: '', fileName: '', exportedAt: '' })
    expect(valueFor('Version').textContent).toContain('—')
    expect(valueFor('Type').textContent).toContain('—')
    expect(valueFor('File').textContent).toContain('—')
    expect(valueFor('Exported').textContent).toContain('—')
  })

  it('singularises the record noun for a one-record file', () => {
    renderBanner({ count: 1, noun: 'token row' })
    expect(valueFor('Records').textContent).toContain('1 token row')
  })

  it('pluralises a multi-word record noun', () => {
    renderBanner({ count: 4, noun: 'token row' })
    expect(valueFor('Records').textContent).toContain('4 token rows')
  })

  it('groups thousands so a large record count stays readable', () => {
    renderBanner({ count: 12345, noun: 'record' })
    expect(valueFor('Records').textContent).toContain('12,345 records')
  })

  it('omits the filtered row entirely for a complete scan', () => {
    renderBanner({ filter: null })
    expect(screen.queryByText('Filtered')).toBeNull()
  })

  it('reports a filtered export as not the complete scan', () => {
    renderBanner({ filter: { exportedRecords: 12, totalRecords: 131 } })
    const row = valueFor('Filtered')
    expect(row.textContent).toContain('12')
    expect(row.textContent).toContain('131')
    expect(row.textContent).toMatch(/not the complete scan/)
  })

  it('still flags a filtered export when the total was not recorded', () => {
    renderBanner({ filter: { exportedRecords: 12, totalRecords: 0 } })
    expect(valueFor('Filtered').textContent).toMatch(/not the complete scan/)
  })

  it('calls onClear from the Clear button', () => {
    const onClear = vi.fn()
    renderBanner({ onClear })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('renders extra notices passed as children inside the same panel', () => {
    // The Infusion Checker hangs its "preview images are not loaded" notice
    // off the bottom of this panel.
    renderBanner({ children: <p>1 token preview image is not loaded.</p> })
    expect(screen.getByText('1 token preview image is not loaded.')).toBeTruthy()
  })
})
