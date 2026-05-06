export default function Tooltip({ label, children, className = '' }) {
  return (
    <span className={`ui-tooltip ${className}`} data-tooltip={label}>
      {children}
    </span>
  )
}
