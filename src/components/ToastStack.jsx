/**
 * Renders the app-wide toast stack. Two persistent live regions — not one —
 * because a toast can be either a status update or an error, and ARIA
 * live-region behavior is only reliable when the region already exists in
 * the DOM before content is inserted into it; a single region can't carry
 * two different urgency levels for two toasts visible at once. Both regions
 * sit in the same stack position, so sighted users still see one list.
 *
 * pointer-events-none throughout, matching the toast this replaces: these are
 * ambient notifications that fade on their own, not something to click.
 */
export default function ToastStack({ toasts }) {
  const statusToasts = toasts.filter(t => t.type !== 'error')
  const errorToasts = toasts.filter(t => t.type === 'error')

  return (
    <div className="pointer-events-none fixed top-6 left-1/2 z-[120] flex w-[min(92vw,44rem)] -translate-x-1/2 flex-col gap-2">
      <div role="status" aria-live="polite">
        {statusToasts.map(t => <ToastCard key={t.id} toast={t} />)}
      </div>
      <div role="alert" aria-live="assertive">
        {errorToasts.map(t => <ToastCard key={t.id} toast={t} />)}
      </div>
    </div>
  )
}

function ToastCard({ toast }) {
  const isError = toast.type === 'error'
  return (
    <div
      className={`toast-card rounded-sm border px-4 py-3 shadow-ambient backdrop-blur-sm ${
        isError ? 'border-danger/40 bg-card/95' : 'border-warning/40 bg-card/95'
      }`}
    >
      <p className={`text-sm font-medium ${isError ? 'text-danger' : 'text-warning'}`}>
        {toast.message}
      </p>
      {toast.detail && (
        <p className="text-xs text-text-secondary">{toast.detail}</p>
      )}
    </div>
  )
}
