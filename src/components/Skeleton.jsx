/**
 * Skeleton primitives over the .skeleton* classes already in index.css,
 * plus the crossfade that swaps a skeleton for the real thing.
 *
 * Sizes are props rather than one-off Tailwind classes at each call site so
 * a skeleton row can be made to match its real row exactly — a mismatch of
 * a few pixels is what makes a table visibly jump as rows resolve.
 */

function Base({ className = '', width, height, style, ...rest }) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton block ${className}`}
      style={{ width, height, ...style }}
      {...rest}
    />
  )
}

function Line({ width = '100%', ...rest }) {
  return <Base className="skeleton-line" width={width} {...rest} />
}

function Pill({ width, ...rest }) {
  return <Base className="skeleton-pill" width={width} {...rest} />
}

function Value({ width, ...rest }) {
  return <Base className="skeleton-value" width={width} {...rest} />
}

function Block({ width = '100%', height = '4rem', ...rest }) {
  return <Base width={width} height={height} {...rest} />
}

/**
 * Repeats a row-shaped skeleton. Capped because a 500-era scan would
 * otherwise render 500 shimmering rows before the first result lands —
 * expensive, and it misrepresents how much is still outstanding.
 */
function Rows({ count = 5, max = 8, height = '2.25rem', className = '' }) {
  const n = Math.max(1, Math.min(count, max))
  return (
    <div className={`space-y-1.5 ${className}`}>
      {Array.from({ length: n }, (_, i) => (
        <Base key={i} height={height} />
      ))}
    </div>
  )
}

const Skeleton = { Line, Pill, Value, Block, Rows }
export default Skeleton

/**
 * Crossfades a skeleton into real content.
 *
 * Both layers stay mounted and share a single CSS grid cell, so the
 * container is sized by the taller of the two and nothing reflows at the
 * swap. The skeleton branch is aria-hidden (it is decorative, and would
 * otherwise be read alongside the real content); the wrapper carries
 * aria-busy so assistive tech knows the region is still filling in.
 */
export function SkeletonSwap({ loading, skeleton, children, className = '' }) {
  return (
    <div
      className={`skel-swap ${className}`}
      data-loading={loading ? 'true' : 'false'}
      aria-busy={loading || undefined}
    >
      <div className="skel-swap__skeleton" aria-hidden="true">
        {skeleton}
      </div>
      {/* `inert` (not `hidden`) while loading: the content must keep
          occupying the grid cell for the crossfade to work, but must not
          be tabbable or readable while it is invisible behind the
          skeleton. React 18 forwards the empty-string form verbatim. */}
      <div
        className="skel-swap__content"
        inert={loading ? '' : undefined}
        aria-hidden={loading || undefined}
      >
        {children}
      </div>
    </div>
  )
}
