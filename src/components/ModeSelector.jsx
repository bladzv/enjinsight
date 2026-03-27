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
    <div
      role="tablist"
      aria-label="Scan mode"
      className="flex bg-card rounded-t-xl overflow-hidden p-1"
    >
      {MODES.map(({ key, label, icon: Icon }) => {
        const isActive = mode === key
        const panelId = key === 'validators' ? 'validators-panel' : 'pools-panel'
        const tabId = `mode-tab-${key}`
        return (
          <button
            key={key}
            id={tabId}
            role="tab"
            onClick={() => onModeChange(key)}
            disabled={disabled}
            aria-selected={isActive}
            aria-controls={panelId}
            tabIndex={isActive ? 0 : -1}
            className={`flex items-center justify-center gap-1.5 flex-1 px-6 py-2
                        text-xs font-bold uppercase tracking-wider rounded transition-all
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${isActive
                          ? 'bg-surface-bright text-cyan shadow-lg'
                          : 'text-muted hover:text-text'}`}
          >
            <Icon size={14} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
