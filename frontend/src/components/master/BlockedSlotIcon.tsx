/**
 * BlockedSlotIcon — small info icon for empty timetable cells that
 * carry blocked-reason telemetry from the solver.
 *
 * Usage:
 *   const reasons = blockedMap.get(`${section}|${day}|${periodId}`)
 *   {reasons && <BlockedSlotIcon reasons={reasons} />}
 *
 * The map is built once per render via buildBlockedMap() below.
 */

import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import {
  blockedCategoryLabel, blockedRemedy,
  type BlockedSlot, type BlockedReason, type BlockedReasonCategory,
} from '@/lib/schedulingEngine'

/** Build a Map keyed by "section|day|periodId" for O(1) cell lookup. */
export function buildBlockedMap(slots: BlockedSlot[]): Map<string, BlockedReason[]> {
  const m = new Map<string, BlockedReason[]>()
  slots.forEach(s => m.set(`${s.section}|${s.day}|${s.periodId}`, s.reasons))
  return m
}

export function BlockedSlotIcon({ reasons }: { reasons: BlockedReason[] }) {
  const [open, setOpen] = useState(false)
  if (!reasons || reasons.length === 0) return null
  const primary = reasons[0]

  return (
    <span style={{ position: 'relative' as const, display: 'inline-flex' }}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        title="Why is this slot empty?"
        style={{
          background: 'transparent', border: 'none', padding: 0,
          cursor: 'pointer', color: '#D4920E', display: 'inline-flex',
          alignItems: 'center', opacity: 0.7,
          transition: 'opacity 0.12s, transform 0.12s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.opacity = '1'
          ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.15)'
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'
          ;(e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
        }}
      >
        <HelpCircle size={11} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute' as const,
              left: '50%', top: '100%',
              transform: 'translateX(-50%)',
              marginTop: 6,
              zIndex: 9999,
              minWidth: 280, maxWidth: 340,
              background: '#fff',
              border: '1px solid #FDE68A',
              borderRadius: 10,
              boxShadow: '0 14px 38px rgba(19,17,30,0.18)',
              padding: 0,
              fontFamily: "'Inter', sans-serif",
              textAlign: 'left' as const,
            }}>
            {/* Header */}
            <div style={{
              padding: '10px 12px', borderBottom: '1px solid #FEF3C7',
              background: 'linear-gradient(135deg, #FEF3C7 0%, #FFFBEB 100%)',
              borderRadius: '10px 10px 0 0',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <HelpCircle size={14} color="#D4920E" />
              <div>
                <div style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.14em',
                  textTransform: 'uppercase' as const, color: '#92400E',
                }}>
                  Why this slot is empty
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: '#13111E', marginTop: 2 }}>
                  {blockedCategoryLabel(primary.category as BlockedReasonCategory)}
                </div>
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 11.5, color: '#13111E', lineHeight: 1.5 }}>
                {primary.detail}
              </div>
              <div style={{
                fontSize: 11, color: '#4B5275', marginTop: 8,
                padding: '6px 9px', background: '#FAFAFE',
                border: '1px solid #ECEAFB', borderRadius: 6,
                lineHeight: 1.5,
              }}>
                <strong style={{ color: '#7C6FE0' }}>💡 Try:</strong>{' '}
                {blockedRemedy(primary.category as BlockedReasonCategory)}
              </div>

              {reasons.length > 1 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
                    textTransform: 'uppercase' as const, color: '#8B87AD', marginBottom: 5,
                  }}>
                    Additional reasons ({reasons.length - 1})
                  </div>
                  {reasons.slice(1).map((r, i) => (
                    <div key={i} style={{
                      fontSize: 10.5, color: '#4B5275',
                      padding: '4px 7px', marginBottom: 3,
                      background: '#FFFBEB', border: '1px solid #FEF3C7',
                      borderRadius: 5,
                    }}>
                      <strong style={{ color: '#92400E' }}>
                        {blockedCategoryLabel(r.category as BlockedReasonCategory)}:
                      </strong>{' '}
                      {r.detail}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </span>
  )
}
