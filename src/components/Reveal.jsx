import { useInView } from '../hooks/useInView.js'

/**
 * Fades and rises a child into view the first time it scrolls into the
 * viewport, staggered by `index`.
 *
 * The stagger delay is expressed in CSS (`calc(min(var(--i), var(--m-stagger-
 * cap)) * var(--m-stagger))`) rather than as an inline style — the cookbook
 * this is drawn from computes delays as inline styles, which the reduced-
 * motion media query in index.css cannot reach. Reading `--i` and the two
 * tokens in CSS means the same block that zeroes --m-stagger also kills every
 * reveal's delay in one place.
 */
export default function Reveal({ index = 0, as: Component = 'div', className = '', children, ...rest }) {
  const [ref, inView] = useInView()

  return (
    <Component
      ref={ref}
      className={`reveal ${inView ? 'reveal-in' : ''} ${className}`}
      style={{ '--i': index }}
      {...rest}
    >
      {children}
    </Component>
  )
}
