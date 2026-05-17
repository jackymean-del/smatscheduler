/**
 * CandidateComparisonModal — side-by-side teacher ranking for one slot.
 *
 * "Who should teach VI-A Maths?" — shows every staff member ranked by
 * the AI scorer, with their top factors, current/projected load, and
 * a one-click Assign button. Lets users override the engine's
 * automatic choice with full visibility into why.
 *
 * Spec: schedU Doc Part 2 — "AI Explanation System" (compare mode).
 */

import { useMemo } from 'react'
import { useTimetableStore } from '@/store/timetableStore'
import type { Section, Subject } from '@/types'
import { rankCandidates, type RankedCandidate } from '@/lib/candidateRanking'
import { ExplanationCard } from './ExplanationPopover'
import { X, Trophy, ArrowRight, Users, BookOpen, Sparkles } from 'lucide-react'

interface Props {
  section: Section
  subject: Subject
  onClose: () => void
  /** Optional: callback after assigning. */
  onAssigned?: (teacherName: string, periods: number) => void
}

export function CandidateComparisonModal({ section, subject, onClose, onAssigned }: Props) {
  const store = useTimetableStore() as any
  const { staff, teacherAllocations, subjectAllocations } = store

  const ranked = useMemo(() => rankCandidates({
    section, subject, staff,
    teacherAllocations: teacherAllocations ?? {},
    subjectAllocations: subjectAllocations ?? {},
  }), [section, subject, staff, teacherAllocations, subjectAllocations])

  const handleAssign = (cand: RankedCandidate, periods: number) => {
    if (periods <= 0) return
    const existing = teacherAllocations[cand.teacher.name]?.[section.name]?.[subject.name] ?? 0
    store.setTeacherAllocationCell?.(cand.teacher.name, section.name, subject.name, existing + periods)
    onAssigned?.(cand.teacher.name, periods)
    onClose()
  }

  const top = ranked[0]
  const others = ranked.slice(1)

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(19,17,30,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: 20, backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 16, width: '100%', maxWidth: 880,
        maxHeight: '92vh', display: 'flex', flexDirection: 'column' as const,
        boxShadow: '0 24px 60px rgba(19,17,30,0.35)',
        fontFamily: "'Inter', sans-serif",
      }}>

        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #ECEAFB',
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'linear-gradient(135deg, #EDE9FF 0%, #FAFAFE 100%)',
          borderRadius: '16px 16px 0 0',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9, background: '#7C6FE0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Trophy size={16} color="#fff" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase' as const, color: '#7C6FE0' }}>
              Compare Candidates
            </div>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#13111E', letterSpacing: '-0.3px', marginTop: 2 }}>
              Who should teach <span style={{ color: '#7C6FE0' }}>{section.name} · {subject.name}</span>?
            </div>
            <div style={{ fontSize: 11, color: '#4B5275', marginTop: 3 }}>
              {ranked.length} teacher{ranked.length !== 1 ? 's' : ''} ranked by AI score. Click <strong style={{ color: '#13111E' }}>Assign</strong> to override.
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#8B87AD', display: 'flex',
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto' as const, padding: '16px 20px', background: '#FAFAFE' }}>

          {ranked.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: '#8B87AD' }}>
              No teachers available.
            </div>
          )}

          {/* Top candidate — highlighted */}
          {top && (
            <CandidateRow cand={top} isTop onAssign={p => handleAssign(top, p)} />
          )}

          {others.length > 0 && (
            <div style={{
              fontSize: 9, fontWeight: 800, letterSpacing: '0.14em',
              textTransform: 'uppercase' as const, color: '#8B87AD',
              margin: '18px 0 8px',
            }}>
              Other candidates ({others.length})
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
            {others.map(c => (
              <CandidateRow key={c.teacher.id} cand={c} onAssign={p => handleAssign(c, p)} />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid #ECEAFB',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div style={{ fontSize: 11, color: '#8B87AD' }}>
            Engine ranks by: <strong style={{ color: '#13111E' }}>Expertise + Continuity + Load fairness</strong>
          </div>
          <button onClick={onClose} style={{
            padding: '7px 14px', borderRadius: 7, border: '1px solid #ECEAFB',
            background: '#fff', color: '#4B5275', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ─── Row ────────────────────────────────────────────────────
function CandidateRow({
  cand, isTop = false, onAssign,
}: {
  cand: RankedCandidate
  isTop?: boolean
  onAssign: (periods: number) => void
}) {
  const score = cand.explanation.score
  const tone =
    score >= 80 ? '#16A34A' :
    score >= 40 ? '#7C6FE0' :
    score >= 0  ? '#D4920E' : '#DC2626'

  const loadColor =
    cand.loadStatus === 'overload'    ? '#DC2626' :
    cand.loadStatus === 'over-target' ? '#D4920E' :
    cand.loadStatus === 'near-target' ? '#16A34A' : '#7C6FE0'

  const max = (cand.teacher as any).maxPeriodsPerWeek ?? 40
  const canTake = cand.projectedDelta > 0

  // Top 2 factors (positive) for summary
  const topFactors = cand.explanation.factors
    .filter(f => f.positive)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)

  return (
    <div style={{
      background: '#fff',
      border: `1.5px solid ${isTop ? tone : '#ECEAFB'}`,
      borderRadius: 12,
      padding: isTop ? '14px 16px' : '10px 14px',
      boxShadow: isTop ? `0 4px 16px ${tone}22` : 'none',
      position: 'relative' as const,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>

        {/* Trophy / rank */}
        <div style={{
          flexShrink: 0,
          width: isTop ? 36 : 28, height: isTop ? 36 : 28, borderRadius: '50%',
          background: isTop ? tone : '#F5F2FF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: isTop ? '#fff' : '#8B87AD',
          marginTop: isTop ? 2 : 0,
        }}>
          {isTop ? <Trophy size={16} /> : <Users size={14} />}
        </div>

        {/* Teacher info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: isTop ? 15 : 13, fontWeight: 900, color: '#13111E',
              letterSpacing: '-0.2px',
            }}>
              {cand.teacher.name}
            </span>
            {isTop && (
              <span style={{
                padding: '2px 8px', borderRadius: 10,
                fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                background: tone, color: '#fff',
              }}>
                AI PICK
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{
              padding: '3px 10px', borderRadius: 10,
              background: `${tone}1A`, color: tone, border: `1px solid ${tone}33`,
              fontSize: 10.5, fontWeight: 800, fontFamily: "'DM Mono', monospace",
            }}>
              score {score > 0 ? '+' : ''}{score}
            </span>
          </div>

          {/* Top reasons */}
          <div style={{ fontSize: 11, color: '#4B5275', marginTop: 6, lineHeight: 1.55 }}>
            {topFactors.length > 0
              ? topFactors.map((f, i) => (
                  <span key={i}>
                    {i > 0 && <span style={{ color: '#D8D2FF', margin: '0 6px' }}>·</span>}
                    {f.reason}
                  </span>
                ))
              : <em style={{ color: '#8B87AD' }}>{cand.explanation.summary}</em>}
          </div>

          {/* Load bar + numbers */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <div style={{ flex: 1, height: 6, background: '#F5F2FF', borderRadius: 3, overflow: 'hidden', position: 'relative' as const }}>
              {/* Current load */}
              <div style={{
                position: 'absolute' as const,
                height: '100%', width: `${Math.min(100, (cand.currentLoad / max) * 100)}%`,
                background: '#9B8EF5', opacity: 0.5,
              }} />
              {/* Projected load (overlay) */}
              <div style={{
                position: 'absolute' as const,
                height: '100%', width: `${Math.min(100, (cand.projectedLoad / max) * 100)}%`,
                background: loadColor,
              }} />
            </div>
            <span style={{ fontSize: 10.5, color: '#4B5275', fontFamily: "'DM Mono', monospace", minWidth: 100, textAlign: 'right' as const }}>
              <span style={{ color: '#8B87AD' }}>{cand.currentLoad}</span>
              {' → '}
              <strong style={{ color: loadColor }}>{cand.projectedLoad}</strong>
              <span style={{ color: '#8B87AD' }}> / {max}</span>
            </span>
          </div>

          {/* Action */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            {canTake ? (
              <button onClick={() => onAssign(cand.projectedDelta)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', borderRadius: 8, border: 'none',
                  background: isTop ? tone : '#7C6FE0',
                  color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                <Sparkles size={11} /> Assign {cand.projectedDelta} period{cand.projectedDelta !== 1 ? 's' : ''}
                <ArrowRight size={11} />
              </button>
            ) : (
              <span style={{
                fontSize: 10.5, padding: '4px 10px', borderRadius: 8,
                background: '#FEF3C7', color: '#92400E', fontWeight: 700,
                border: '1px solid #FDE68A',
              }}>
                Slot filled or no headroom
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Inline factors (collapsed when not top, expanded when top) */}
      {isTop && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed #ECEAFB' }}>
          <ExplanationCard explanation={cand.explanation} compact />
        </div>
      )}
    </div>
  )
}
