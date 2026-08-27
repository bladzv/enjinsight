import { describe, it, expect } from 'vitest'
import { isFilled } from './Field.jsx'

// isFilled backs the data-filled attribute, which is the fallback for
// controls whose :placeholder-shown state the browser does not report
// usefully. Getting it wrong leaves a label sitting on top of a value.
describe('isFilled', () => {
  it('leaves ordinary text inputs to :placeholder-shown', () => {
    // CSS handles these, so the attribute must not force the lifted state —
    // otherwise an empty field shows a lifted label over nothing.
    expect(isFilled({ as: 'input', type: 'text', value: '' })).toBe(false)
    expect(isFilled({ as: 'input', type: 'text', value: 'abc' })).toBe(false)
  })

  it('reports a filled date input, which never matches :placeholder-shown', () => {
    expect(isFilled({ as: 'input', type: 'date', value: '2026-08-27' })).toBe(true)
  })

  it('reports an empty date input as unfilled', () => {
    expect(isFilled({ as: 'input', type: 'date', value: '' })).toBe(false)
  })

  it('handles a number input whose spinner suppresses the placeholder', () => {
    expect(isFilled({ as: 'input', type: 'number', value: 0 })).toBe(true)
    expect(isFilled({ as: 'input', type: 'number', value: undefined })).toBe(false)
  })

  it('always lifts a select label', () => {
    // A <select> shows its first option immediately; a label overlapping it
    // would be unreadable regardless of value.
    expect(isFilled({ as: 'select', type: 'text', value: '' })).toBe(true)
  })
})
