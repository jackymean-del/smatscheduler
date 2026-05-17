import { useTimetableStore } from "@/store/timetableStore"

export const WIZARD_STEPS = [
  { n: 1, label: 'Structure' },
  { n: 2, label: 'Resources' },
  { n: 3, label: 'Allocations' },
  { n: 4, label: 'Constraints' },
  { n: 5, label: 'Generate' },
]

interface Props {
  currentStep: number
  onStepClick: (n: number) => void
}

export function WizardSidebar({ currentStep, onStepClick }: Props) {
  return (
    <aside style={{
      width: 220, minWidth: 220, background: '#fff',
      borderRight: '1px solid #e8e5de', padding: '20px 14px',
      position: 'sticky', top: 52, height: 'calc(100vh - 52px)',
      overflowY: 'auto', display: 'flex', flexDirection: 'column',
    }}>
      <p style={{
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: '#a8a59e', marginBottom: 14, paddingLeft: 4,
      }}>
        Setup Steps
      </p>

      {WIZARD_STEPS.map((step, i) => {
        const done   = step.n < currentStep
        const active = step.n === currentStep
        const future = step.n > currentStep

        return (
          <div key={step.n}>
            <button
              onClick={() => !future && onStepClick(step.n)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '9px 10px', borderRadius: 8,
                border: 'none', cursor: future ? 'default' : 'pointer',
                background: active ? '#eaecf8' : 'transparent',
                transition: 'background 0.15s', textAlign: 'left',
              }}
              onMouseEnter={e => { if (!active && !future) (e.currentTarget as HTMLElement).style.background = '#f9fafb'; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = active ? '#eaecf8' : 'transparent'; }}
            >
              {/* Step number circle */}
              <div style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700,
                background: done ? '#7C6FE0' : active ? '#7C6FE0' : 'transparent',
                border: done ? '1.5px solid #7C6FE0' : active ? '1.5px solid #7C6FE0' : '1.5px solid #d4d1c8',
                color: done || active ? '#fff' : '#a8a59e',
              }}>
                {done ? '✓' : step.n}
              </div>

              {/* Label */}
              <span style={{
                fontSize: 12, fontWeight: active ? 600 : 500,
                color: active ? '#3730a3' : done ? '#7C6FE0' : future ? '#c8c5bc' : '#6a6860',
                lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {step.label}
              </span>
            </button>

            {/* Connector line */}
            {i < WIZARD_STEPS.length - 1 && (
              <div style={{
                width: 1.5, height: 10, marginLeft: 21, marginTop: 1, marginBottom: 1,
                background: done ? '#7C6FE0' : '#e8e5de',
              }} />
            )}
          </div>
        )
      })}
    </aside>
  )
}
