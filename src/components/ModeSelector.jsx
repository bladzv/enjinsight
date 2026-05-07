import { Shield, Users } from 'lucide-react'

const MODES = [
  {
    key: 'validators',
    label: 'Validators',
    icon: Shield,
    description: 'Scan active validators, nominators, and era reward gaps.',
  },
  {
    key: 'pools',
    label: 'Nomination Pools',
    icon: Users,
    description: 'Scan pool payouts, validator participation, and missed eras.',
  },
]

export default function ModeSelector({ mode, onModeChange, disabled }) {
  return (
    <div className="data-panel flex h-full flex-col gap-3" role="tablist" aria-label="Scan mode">
      <div>
        <h2 className="font-headline text-lg font-bold tracking-tight text-text sm:text-xl">Scan Mode</h2>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {MODES.map(({ key, label, icon: Icon, description }) => {
          const isActive = mode === key
          const panelId = key === 'validators' ? 'validators-panel' : 'pools-panel'
          const tabId = `mode-tab-${key}`
          return (
            <button
              key={key}
              id={tabId}
              role="tab"
              type="button"
              onClick={() => onModeChange(key)}
              disabled={disabled}
              aria-selected={isActive}
              aria-controls={panelId}
              tabIndex={isActive ? 0 : -1}
              className={`range-mode-option ${isActive ? 'range-mode-option-active' : 'range-mode-option-idle'}`}
            >
              <div className="range-mode-badge">
                <Icon size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-headline text-sm font-bold sm:text-base ${isActive ? 'text-text' : 'text-text-secondary'}`}>{label}</span>
                  {isActive && <span className="mini-chip text-primary">Selected</span>}
                </div>
                <p className="mt-1 text-xs leading-snug text-text-secondary sm:text-sm sm:leading-6">{description}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
