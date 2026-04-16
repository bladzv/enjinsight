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
    <div className="flex flex-col gap-3 h-full rounded-[1.35rem] bg-surface px-4 py-4 sm:px-5" role="tablist" aria-label="Scan mode">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-headline text-xl font-bold tracking-tight text-text sm:text-[1.6rem]">Scan Mode</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-text-secondary">
            Switch between validator diagnostics and nomination pool diagnostics.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
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
              className={`flex w-full items-start gap-3.5 rounded-[1.15rem] border px-4 py-3.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                isActive
                  ? 'border-primary/30 bg-primary/10 shadow-primary-glow'
                  : 'border-white/8 bg-card hover:border-cyan/20 hover:bg-surface-bright'
              }`}
            >
              <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl ${
                isActive ? 'bg-primary text-on-primary' : 'bg-surface text-text-secondary'
              }`}>
                <Icon size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className={`font-headline text-base font-bold ${isActive ? 'text-text' : 'text-text-secondary'}`}>{label}</span>
                  {isActive && <span className="mini-chip text-primary">Selected</span>}
                </div>
                <p className="mt-1.5 text-sm leading-6 text-text-secondary">{description}</p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
