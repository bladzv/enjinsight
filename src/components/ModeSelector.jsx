import { Shield, Users } from 'lucide-react'

const MODES = [
  { key: 'validators', label: 'Validators', icon: Shield },
  { key: 'pools', label: 'Nomination Pools', icon: Users },
]

export default function ModeSelector({ mode, onModeChange, disabled }) {
  return (
    <div className="flex flex-col gap-3 rounded-[1.5rem] bg-surface px-4 py-4 sm:px-5" role="tablist" aria-label="Scan mode">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-headline text-2xl font-bold tracking-tight text-text">Scan Mode</h2>
          <p className="max-w-xl text-sm leading-6 text-text-secondary mt-1">
            Switch between validator diagnostics and nomination pool diagnostics. Then, set how many recent eras to check.
          </p>
        </div>
      </div>

      <div className="inline-flex w-full flex-wrap gap-2 rounded-full bg-card p-2">
        {MODES.map(({ key, label, icon: Icon }) => {
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
              className={`tool-tab flex-1 min-w-[180px] disabled:opacity-50 disabled:cursor-not-allowed ${isActive ? 'tool-tab-active' : 'text-text-secondary hover:bg-surface-bright hover:text-text'}`}
            >
              <Icon size={15} />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
