import { Moon, Sun } from 'lucide-react'

/**
 * Dark/light toggle — a single icon button in the rail header.
 *
 * Replaces the two-option PillSwitch that used to sit in the rail's own
 * "Theme" section. That switch was visually identical to the Mode switch
 * directly beneath it, so two unrelated settings read as one control group,
 * and it was asymmetric anyway — only "Dark" ever carried an icon.
 *
 * role="switch" rather than a plain button: this is a persistent on/off
 * state a screen reader should be able to read back, which aria-checked
 * carries. The icon shows the theme that is *currently* active; the label
 * says what pressing it will do.
 */
export default function ThemeToggle({ theme = 'dark', onChange, className = '' }) {
  const isLight = theme === 'light'
  const action = `Switch to ${isLight ? 'dark' : 'light'} theme`

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isLight}
      aria-label={action}
      title={action}
      onClick={() => onChange?.(isLight ? 'dark' : 'light')}
      className={`btn-icon theme-toggle ${className}`}
    >
      {/* Both icons stay mounted and share one grid cell so the swap can
          cross-fade. Rendering only the active one would unmount the
          outgoing icon before it had a frame to animate out. */}
      <span className="theme-toggle__icons" aria-hidden="true">
        <span className="theme-toggle__icon" data-visible={!isLight}>
          <Moon size={17} strokeWidth={2} />
        </span>
        <span className="theme-toggle__icon" data-visible={isLight}>
          <Sun size={17} strokeWidth={2} />
        </span>
      </span>
    </button>
  )
}
