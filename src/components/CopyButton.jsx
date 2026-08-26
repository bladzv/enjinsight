import { useState } from 'react'
import { Copy, CheckCircle2 } from 'lucide-react'
import { useToast } from '../hooks/useToast.jsx'

/**
 * Shared copy-to-clipboard icon button. Replaces five near-identical
 * copy/copied-state implementations (ValidatorCard, PoolCard,
 * NominatorsTable, PoolValidatorsTable, EraBlockExplorer) with one that
 * morphs the icon via CSS instead of an abrupt swap, and announces the
 * result through the toast stack — copying was previously silent to a
 * screen-reader user.
 */
export default function CopyButton({ value, label, className = 'btn-icon', size = 14, onClick }) {
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  async function handleClick(event) {
    onClick?.(event)
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.push('Copied to clipboard.', { duration: 2000, key: 'copy' })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access denied.
    }
  }

  return (
    <button type="button" onClick={handleClick} className={className} aria-label={label}>
      <span className={`copy-icon-swap ${copied ? 'is-copied' : ''}`}>
        <Copy size={size} className="copy-icon copy-icon-idle" aria-hidden="true" />
        <CheckCircle2 size={size} className="copy-icon copy-icon-done text-success" aria-hidden="true" />
      </span>
    </button>
  )
}
