import { describe, it, expect } from 'vitest'
import { SUBSCAN_PATH_ALLOWLIST } from './[...proxy].js'
import { ENDPOINTS } from '../src/constants.js'

// The serverless proxy cannot import src/constants.js: that module reads
// `import.meta.env.PROD`, which is a Vite construct and throws in the Node
// runtime the function actually executes in. The proxy therefore keeps its own
// copy of the path list, and this test is what stops the two from drifting.
describe('Subscan proxy path allowlist', () => {
  it('matches ENDPOINTS in src/constants.js exactly', () => {
    const fromConstants = [...new Set(Object.values(ENDPOINTS))].sort()
    const fromProxy = [...SUBSCAN_PATH_ALLOWLIST].sort()
    expect(fromProxy).toEqual(fromConstants)
  })

  it('contains only absolute /api paths with no traversal', () => {
    for (const path of SUBSCAN_PATH_ALLOWLIST) {
      expect(path.startsWith('/api/')).toBe(true)
      expect(path).not.toContain('..')
    }
  })
})
