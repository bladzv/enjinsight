import { Shield, Users } from 'lucide-react'

const MODES = [
  { key: 'validators', label: 'Validators',       icon: Shield },
  { key: 'pools',      label: 'Nomination Pools',  icon: Users  },
]

/**
 * Top-level tab bar for switching between Validator and Pool scanning modes.
 * Disabled while a scan is in progress to prevent mid-scan switching.
 */
export default function ModeSelector({ mode, onModeChange, disabled }) {
  return (
    <div className="flex border-b border-border bg-card rounded-t-xl overflow-hidden">
      {MODES.map(({ key, label, icon: Icon }) => {
        const isActive = mode === key
        return (
          <button
            key={key}
            onClick={() => onModeChange(key)}
            disabled={disabled}
            aria-selected={isActive}
            className={`flex items-center justify-center gap-1.5 flex-1 px-4 py-3
                        text-xs sm:text-sm font-medium border-b-2 transition-colors
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${isActive
                          ? 'border-primary text-text'
                          : 'border-transparent text-dim hover:text-text'}`}
          >
            <Icon size={14} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
