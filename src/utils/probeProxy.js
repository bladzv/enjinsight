import { fetchValidators } from './api.js'

/**
 * Probe the provided proxy by making a lightweight validators request.
 * Returns true if probe succeeded, false otherwise.
 */
export async function probeProxy(proxyUrl) {
  try {
    // Use a short-lived probe; rely on subscanPost timeout for timing
    const list = await fetchValidators(proxyUrl)
    return Array.isArray(list)
  } catch (err) {
    return false
  }
}
