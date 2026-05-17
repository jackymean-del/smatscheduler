/**
 * Step — Constraints (user-facing label)
 *
 * Read-only summary of scope rules authored across entities (Sections,
 * Teachers, Subjects, Rooms). Each row shows whether the entity is
 * "Unscoped" (default — all slots allowed) or how many slots are
 * disabled / locked.
 *
 * To edit a scope, the user opens the relevant entity in Resources
 * (or /master-data) and clicks its Scope button — same authoring UI.
 *
 * This step is purely a confidence check before generation.
 */

import { useMemo } from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import type { ScopeMatrix } from '@/types'
import { Lock, ShieldCheck, Ban, ArrowRight, Info, Sparkles } from 'lucide-react'

function scopeStats(scope?: ScopeMatrix) {
  if (!scope?.cells) return { disabled: 0, locked: 0, total: 0 }
  let disabled = 0, locked = 0, total = 0
  Object.values(scope.cells).forEach(row => {
    Object.values(row ?? {}).forEach(state => {
      total++
      if (state === 'disabled') disabled++
      else if (state === 'locked') locked++
    })
  })
  return { disabled, locked, total }
}

export function StepConstraints() {
  const store = useTimetableStore() as any
  const { sections = [], staff = [], subjects = [], rooms = [] } = store

  const allEntities = useMemo(() => [
    ...sections.map((s: any) => ({ kind: 'Section', name: s.name, scope: s.scope, group: 'Classes' })),
    ...staff.map((s: any)    => ({ kind: 'Teacher', name: s.name, scope: s.scope, group: 'Teachers' })),
    ...subjects.map((s: any) => ({ kind: 'Subject', name: s.name, scope: s.scope, group: 'Subjects' })),
    ...rooms.map((r: any)    => ({ kind: 'Room',    name: r.actualName ?? r.name, scope: r.scope, group: 'Rooms' })),
  ], [sections, staff, subjects, rooms])

  const groups = ['Classes', 'Teachers', 'Subjects', 'Rooms']
  const totalScoped = allEntities.filter(e => e.scope && Object.keys(e.scope.cells ?? {}).length > 0).length
  const totalLocked  = allEntities.reduce((s, e) => s + scopeStats(e.scope).locked, 0)
  const totalDisabled = allEntities.reduce((s, e) => s + scopeStats(e.scope).disabled, 0)

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto', fontFamily: "'Inter', sans-serif" }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: '#EDE9FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Lock size={20} color="#7C6FE0" />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: '#13111E', margin: 0, lineHeight: 1.1 }}>
            Constraints
          </h2>
          <div style={{ fontSize: 12, color: '#4B5275', marginTop: 3 }}>
            Review entity-level scope rules before the AI builds your timetable. <em style={{ color: '#7C6FE0' }}>Edit any scope from Resources / Master Data.</em>
          </div>
        </div>
      </div>

      {/* Summary banner */}
      <div style={{
        background: 'linear-gradient(135deg, #EDE9FF 0%, #F5F2FF 100%)',
        border: '1px solid #D8D2FF', borderRadius: 14,
        padding: '14px 18px', marginBottom: 18,
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' as const,
      }}>
        <Sparkles size={16} color="#7C6FE0" />
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#13111E' }}>
            {totalScoped === 0
              ? 'No scope rules authored — the engine will explore the full search space.'
              : `${totalScoped} entit${totalScoped === 1 ? 'y' : 'ies'} carry scope rules`}
          </div>
          <div style={{ fontSize: 11, color: '#4B5275', marginTop: 3 }}>
            <strong style={{ color: '#DC2626' }}>{totalLocked}</strong> hard-locked · <strong style={{ color: '#92400E' }}>{totalDisabled}</strong> soft-disabled slots
          </div>
        </div>
        <a href="/master-data" style={{ textDecoration: 'none' }}>
          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8,
            border: '1px solid #ECEAFB', background: '#fff', color: '#7C6FE0',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
            Open Master Data <ArrowRight size={12} />
          </button>
        </a>
      </div>

      {/* Per-group lists */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        {groups.map(group => {
          const items = allEntities.filter(e => e.group === group)
          return (
            <div key={group} style={{
              background: '#fff', border: '1px solid #ECEAFB', borderRadius: 12,
              padding: '14px 16px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8B87AD', marginBottom: 10 }}>
                {group} · {items.length}
              </div>
              {items.length === 0 ? (
                <div style={{ fontSize: 11, color: '#B8B4D4', fontStyle: 'italic' as const, padding: '8px 0' }}>
                  No entries yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 5, maxHeight: 220, overflowY: 'auto' as const }}>
                  {items.map(e => {
                    const st = scopeStats(e.scope)
                    const scoped = st.disabled + st.locked > 0
                    return (
                      <div key={`${e.kind}-${e.name}`} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 9px', borderRadius: 6,
                        background: scoped ? '#FAFAFE' : 'transparent',
                        border: '1px solid', borderColor: scoped ? '#ECEAFB' : 'transparent',
                      }}>
                        <div style={{ flex: 1, fontSize: 12, fontWeight: 600, color: '#13111E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                          {e.name}
                        </div>
                        {scoped ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            {st.locked > 0 && (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 10,
                                background: '#FEE2E2', color: '#991B1B',
                              }}>
                                <Lock size={9} /> {st.locked}
                              </span>
                            )}
                            {st.disabled > 0 && (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 3,
                                fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 10,
                                background: '#FEF3C7', color: '#92400E',
                              }}>
                                <Ban size={9} /> {st.disabled}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 3,
                            fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                            background: '#EEFDF3', color: '#15803D',
                          }}>
                            <ShieldCheck size={9} /> Open
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Hint */}
      <div style={{
        marginTop: 18, padding: '12px 14px',
        background: '#F5F2FF', border: '1px solid #ECEAFB', borderRadius: 10,
        display: 'flex', alignItems: 'flex-start', gap: 9,
      }}>
        <Info size={14} color="#7C6FE0" style={{ marginTop: 1, flexShrink: 0 }} />
        <div style={{ fontSize: 11.5, color: '#4B5275', lineHeight: 1.6 }}>
          <strong style={{ color: '#13111E' }}>Hard constraint</strong> (locked) — the AI will never schedule that slot.
          <strong style={{ color: '#13111E' }}> Soft constraint</strong> (disabled) — the AI avoids it but may break it if necessary.
          To author scope, open the entity in Resources or Master Data and click the <strong style={{ color: '#7C6FE0' }}>Scope</strong> button.
        </div>
      </div>
    </div>
  )
}
