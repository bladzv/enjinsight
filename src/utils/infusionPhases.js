/**
 * Scan-progress phase derivation for the ENJ Infusion tool.
 *
 * Phase status used to be inferred purely from side-effect state (how many
 * rows had arrived, whether `isLoading` was still set). That cannot tell
 * "the wallet holds no infused tokens" apart from "the scan failed before it
 * read anything" — both land on zero rows — so a failed scan rendered a green
 * "Review complete" card. Terminal states are now recorded explicitly by the
 * caller as a `scanOutcome` and overlaid on top of the live progress here.
 */

export const SINGLE_PROGRESS_PHASES = [
  { key: 'input',  label: 'Validate Token',   total: 1, completed: 0, status: 'pending' },
  { key: 'rpc',    label: 'Read Contract',    total: 1, completed: 0, status: 'pending' },
  { key: 'decode', label: 'Decode Infusion',  total: 1, completed: 0, status: 'pending' },
]

// Labels carry no "Step N:" prefix — PhaseProgressCards already renders
// "PHASE n" above each title, and the prefix pushed the title past its clamp.
export const BULK_PROGRESS_PHASES = [
  { key: 'wallet',    label: 'Fetch Wallet Tokens',     total: 1, completed: 0, status: 'pending' },
  { key: 'infusions', label: 'Read Infusion',           total: 1, completed: 0, status: 'pending' },
  { key: 'metadata',  label: 'Fetch Token Metadata',    total: 1, completed: 0, status: 'pending' },
  { key: 'review',    label: 'Review',                  total: 1, completed: 0, status: 'pending' },
  { key: 'retries',   label: 'Auto Retry Failed Reads', total: 0, completed: 0, status: 'pending' },
]

const REASONS = {
  emptyFound:       'No matching token IDs found',
  emptySkipped:     'Skipped — wallet holds no infused tokens',
  errorSkipped:     'Skipped — scan failed',
  canceledStage:    'Canceled by user',
  canceledSkipped:  'Not started — scan canceled',
}

/**
 * Force a phase that ran to completion before a later stage failed.
 *
 * If the scan died at stage X then every stage before X finished by
 * definition, even though the error handler has since cleared the row state
 * those phases were counting.
 */
function completedBefore(phase) {
  if (phase.status === 'completed') return phase
  const total = Math.max(1, Number(phase.total) || 0)
  return { ...phase, total, completed: total, status: 'completed' }
}

/** The phase the scan actually stopped on. */
function phaseAtStop(phase, outcome) {
  if (outcome.kind === 'empty') {
    return { ...phase, total: 1, completed: 1, status: 'completed', reason: REASONS.emptyFound }
  }
  if (outcome.kind === 'canceled') {
    return { ...phase, status: 'canceled', reason: REASONS.canceledStage }
  }
  return { ...phase, status: 'failed', reason: outcome.message || 'Scan failed' }
}

/**
 * A phase that never got to run. `total: 0` suppresses the "N / M complete"
 * counter so the card shows the reason instead of an invented fraction.
 */
function phaseAfterStop(phase, outcome) {
  if (outcome.kind === 'empty') {
    // Nothing was found, but the scan did run to the end and reported it.
    if (phase.key === 'review') return { ...phase, total: 1, completed: 1, status: 'completed' }
    return { ...phase, total: 0, completed: 0, status: 'skipped', reason: REASONS.emptySkipped }
  }
  if (outcome.kind === 'canceled') {
    return { ...phase, total: 0, completed: 0, status: 'canceled', reason: REASONS.canceledSkipped }
  }
  return { ...phase, total: 0, completed: 0, status: 'skipped', reason: REASONS.errorSkipped }
}

/**
 * Overlay a terminal outcome onto the live phase list.
 *
 * @param {Array}  phases  - live-derived phases, in display order
 * @param {Object} outcome - { kind, stage, message } or null
 */
function applyOutcome(phases, outcome) {
  if (!outcome || outcome.kind === 'done') return phases

  const stageIndex = phases.findIndex(phase => phase.key === outcome.stage)
  const stopIndex = stageIndex < 0 ? 0 : stageIndex

  return phases.map((phase, index) => {
    if (index < stopIndex) return completedBefore(phase)
    if (index === stopIndex) return phaseAtStop(phase, outcome)
    return phaseAfterStop(phase, outcome)
  })
}

function deriveSinglePhases({ singleStarted, isLoading, singleSucceeded }) {
  const [input, rpc, decode] = SINGLE_PROGRESS_PHASES
  if (!singleStarted) return SINGLE_PROGRESS_PHASES.map(phase => ({ ...phase }))

  if (isLoading) {
    return [
      { ...input, completed: 1, status: 'completed' },
      { ...rpc, completed: 0, status: 'in_progress' },
      { ...decode },
    ]
  }

  // Terminal renders come from the outcome overlay; this is the in-between
  // frame after a run settles but before its outcome lands.
  return [
    { ...input, completed: 1, status: 'completed' },
    { ...rpc, completed: singleSucceeded ? 1 : 0, status: singleSucceeded ? 'completed' : 'pending' },
    { ...decode, completed: singleSucceeded ? 1 : 0, status: singleSucceeded ? 'completed' : 'pending' },
  ]
}

function deriveBulkPhases({ bulkStarted, isLoading, bulkExpectedTotal, rowCount, metadataProgress, retryProgress }) {
  const [wallet, infusions, metadata, review, retries] = BULK_PROGRESS_PHASES

  // The retry card only earns a slot once a retry pass actually exists.
  if (!bulkStarted) return [wallet, infusions, metadata, review].map(phase => ({ ...phase }))

  const checked = Math.max(0, Number(rowCount) || 0)
  const total = Math.max(1, bulkExpectedTotal)
  const metadataTotal = Math.max(1, metadataProgress.total || bulkExpectedTotal || 1)
  const metadataDone = Math.min(metadataProgress.completed, metadataTotal)
  const finished = bulkExpectedTotal > 0 && checked >= bulkExpectedTotal
  const reviewDone = !isLoading && checked > 0

  const walletStatus = bulkExpectedTotal > 0
    ? 'completed'
    : isLoading
      ? 'in_progress'
      : 'pending'

  const infusionStatus = finished
    ? 'completed'
    : checked > 0 || isLoading
      ? 'in_progress'
      : 'pending'

  const metadataStatus = metadataDone >= metadataTotal && metadataProgress.total > 0
    ? 'completed'
    : metadataDone > 0
      ? 'in_progress'
      : 'pending'

  const retryTotal = Math.max(0, retryProgress.total)
  const retryDone = Math.min(retryProgress.completed, retryTotal)
  const retryStatus = retryProgress.active
    ? 'in_progress'
    : retryTotal > 0 && retryDone >= retryTotal
      ? 'completed'
      : 'pending'

  return [
    { ...wallet, completed: bulkExpectedTotal > 0 ? 1 : 0, status: walletStatus },
    { ...infusions, total, completed: Math.min(checked, total), status: infusionStatus },
    { ...metadata, total: metadataTotal, completed: metadataDone, status: metadataStatus },
    { ...review, completed: reviewDone ? 1 : 0, status: reviewDone ? 'completed' : 'pending' },
    ...(retryTotal > 0
      ? [{ ...retries, total: retryTotal, completed: retryDone, status: retryStatus }]
      : []),
  ]
}

/**
 * Build the Scan Progress cards for the current mode.
 *
 * @param {Object} state
 * @param {'single'|'wallet'} state.mode
 * @param {Object|null} state.outcome - terminal outcome { kind, stage, message, mode }.
 *                                      Ignored unless it was recorded for `mode`, so a
 *                                      settled single-mode run cannot bleed into the
 *                                      wallet cards after a tab switch.
 * @returns {Array} phases ready for <PhaseProgressCards />
 */
export function derivePhases(state) {
  const phases = state.mode === 'single' ? deriveSinglePhases(state) : deriveBulkPhases(state)
  const outcome = state.outcome && state.outcome.mode === state.mode ? state.outcome : null
  return applyOutcome(phases, outcome)
}
