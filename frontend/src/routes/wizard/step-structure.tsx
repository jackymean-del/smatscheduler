/**
 * Step — Structure (user-facing label)
 *
 * Composes the two internal "structural" pieces — School setup and Bell
 * schedule — into a single wizard step shown under one calm header.
 *
 * Internally still uses Step1Org + StepBell unchanged, so all downstream
 * data flow / engine behaviour stays identical.
 */

import { useState } from 'react'
import { Step1Org }   from './step1-org'
import { StepBell }   from './step-bell'
import { School, Clock } from 'lucide-react'

type Sub = 'school' | 'schedule'

export function StepStructure() {
  const [sub, setSub] = useState<Sub>('school')
  return (
    <div style={{ padding: '20px 24px 0', maxWidth: 1280, margin: '0 auto' }}>
      {/* Sub-tabs */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 14,
        background: '#F8F7FF', padding: 4, borderRadius: 10, width: 'fit-content',
      }}>
        <SubTab active={sub === 'school'}   onClick={() => setSub('school')}   icon={<School size={13} />} label="School & Board" />
        <SubTab active={sub === 'schedule'} onClick={() => setSub('schedule')} icon={<Clock  size={13} />} label="Bell Schedule" />
      </div>
      {sub === 'school'   && <Step1Org />}
      {sub === 'schedule' && <StepBell />}
    </div>
  )
}

function SubTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick}
      style={{
        padding: '7px 14px', borderRadius: 7, border: 'none',
        background: active ? '#fff' : 'transparent',
        color: active ? '#13111E' : '#4B5275',
        fontSize: 12, fontWeight: 700, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        boxShadow: active ? '0 1px 3px rgba(124,111,224,0.15)' : 'none',
        fontFamily: 'inherit',
      }}>
      <span style={{ color: active ? '#7C6FE0' : '#8B87AD' }}>{icon}</span>
      {label}
    </button>
  )
}
