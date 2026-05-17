/**
 * Dashboard — calm landing page (mockup-aligned).
 *
 * Structure (matches reference):
 *   - Top bar: greeting + "Take me home"
 *   - Main panel:
 *       * School-name card with 4 stat chips (timetables / published /
 *         in progress / drafts)
 *       * Schedule state (empty CTA OR thumbnail summary)
 *       * 3 quick-action cards (Guide / Master Data / Configure)
 *   - Footer
 *
 * White-first, lightweight, properly aligned. No dense ERP feel.
 *
 * The previous complex dashboard (substitutions drawer, calendar etc)
 * lives on /timetable — link to it from the schedule card when present.
 */

import { useAuthStore } from '@/store/authStore'
import { useTimetableStore } from '@/store/timetableStore'
import { BhuskuFooter } from '@/components/branding/Logos'
import {
  Sparkles, ArrowRight, BookOpen, Database, Settings,
  Home, Calendar, CheckCircle2, Clock, FileText,
} from 'lucide-react'

const GREETING = () => {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardPage() {
  const { user } = useAuthStore()
  const store = useTimetableStore() as any
  const { classTT, sections, staff, subjects, config } = store
  const timetableStatus: string = (store as any).timetableStatus ?? 'draft'
  const optionalBlocks = (store as any).optionalBlocks ?? []

  if (!user) { window.location.href = '/login'; return null }

  const hasTimetable = Object.keys(classTT ?? {}).length > 0
  const firstName = user.name?.split(' ')[0] ?? 'there'
  const schoolName = user.schoolName ?? 'Your school'
  const ttCount = hasTimetable ? 1 : 0
  const pubCount = hasTimetable && timetableStatus === 'published' ? 1 : 0
  const inProgressCount = hasTimetable && timetableStatus === 'generating' ? 1 : 0
  const draftCount = hasTimetable && timetableStatus !== 'published' && timetableStatus !== 'generating' ? 1 : 0

  return (
    <div style={{
      minHeight: '100vh', background: '#FAFAFE',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Inter', sans-serif",
    }}>

      {/* ── Top bar: greeting + Take me home ─────────── */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #F3F1FF',
        padding: '16px 28px',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: '#8B87AD', marginBottom: 2,
          }}>
            Dashboard
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#13111E', letterSpacing: '-0.4px' }}>
            {GREETING()}, <span style={{ color: '#7C6FE0' }}>{firstName}</span> 👋
          </div>
        </div>
        <a href="/" style={{ textDecoration: 'none' }}>
          <button style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8,
            border: '1px solid #ECEAFB', background: '#fff',
            color: '#4B5275', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
            <Home size={13} /> Take me home
          </button>
        </a>
      </div>

      {/* ── Main content ─────────────────────────────── */}
      <div style={{
        flex: 1, padding: '28px',
        maxWidth: 1100, width: '100%', margin: '0 auto', boxSizing: 'border-box' as const,
      }}>

        {/* SCHOOL CARD */}
        <div style={{
          background: '#fff', border: '1px solid #ECEAFB', borderRadius: 16,
          padding: '20px 24px', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' as const,
        }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8B87AD' }}>
              School
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#13111E', letterSpacing: '-0.4px', marginTop: 2 }}>
              {schoolName}
            </div>
            <div style={{ fontSize: 12, color: '#4B5275', marginTop: 4 }}>
              {sections.length} sections · {staff.length} teachers · {subjects.length} subjects · {optionalBlocks.length} optional blocks
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' as const }}>
            <StatChip value={ttCount}        label="timetables"  color="#7C6FE0" />
            <StatChip value={pubCount}       label="published"   color="#16A34A" />
            <StatChip value={inProgressCount} label="in progress" color="#D4920E" />
            <StatChip value={draftCount}     label="drafts"      color="#D946EF" />
          </div>
        </div>

        {/* SCHEDULE STATE */}
        {hasTimetable ? (
          <ScheduleSummaryCard sectionsCount={sections.length} status={timetableStatus} />
        ) : (
          <EmptyScheduleCard />
        )}

        {/* QUICK ACTIONS */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 14, marginTop: 16,
        }}>
          <ActionCard
            href="/wizard"
            icon={<BookOpen size={20} />}
            title="Guide"
            desc="Setup walkthrough"
            accent="#7C6FE0"
          />
          <ActionCard
            href="/master-data"
            icon={<Database size={20} />}
            title="Master data"
            desc="Classes, teachers, rooms"
            accent="#9B8EF5"
          />
          <ActionCard
            href="/wizard"
            icon={<Settings size={20} />}
            title="Configure"
            desc="Board, shifts, constraints"
            accent="#D4920E"
          />
        </div>

      </div>

      {/* ── Footer ───────────────────────────────────── */}
      <BhuskuFooter compact />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════
// Sub-components
// ═════════════════════════════════════════════════════════════

function StatChip({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{
      minWidth: 84, padding: '10px 14px', borderRadius: 12,
      border: '1px solid #ECEAFB', background: '#FAFAFE',
      display: 'flex', flexDirection: 'column' as const, alignItems: 'center' as const,
    }}>
      <div style={{
        fontSize: 22, fontWeight: 800, color, lineHeight: 1,
        fontFamily: "'DM Mono', monospace",
      }}>
        {value}
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#4B5275', marginTop: 5, letterSpacing: '0.02em' }}>
        {label}
      </div>
    </div>
  )
}

function EmptyScheduleCard() {
  return (
    <div style={{
      background: '#FAFAFE', border: '1px dashed #D8D2FF', borderRadius: 16,
      padding: '40px 28px', textAlign: 'center' as const,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 14,
        background: '#EDE9FF', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', marginBottom: 14,
      }}>
        <Calendar size={26} color="#7C6FE0" />
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#13111E', marginBottom: 4 }}>
        No schedule yet!
      </div>
      <div style={{ fontSize: 12, color: '#4B5275', marginBottom: 18, maxWidth: 380, margin: '0 auto 18px' }}>
        Walk through the 5-step setup and let our AI generate your first conflict-free timetable.
      </div>
      <a href="/wizard" style={{ textDecoration: 'none' }}>
        <button style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '11px 22px', borderRadius: 10,
          border: '1.5px solid #7C6FE0', background: '#fff',
          color: '#7C6FE0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>
          <Sparkles size={14} /> Create timetable <ArrowRight size={13} />
        </button>
      </a>
    </div>
  )
}

function ScheduleSummaryCard({ sectionsCount, status }: { sectionsCount: number; status: string }) {
  const published = status === 'published'
  return (
    <div style={{
      background: '#fff', border: '1px solid #ECEAFB', borderRadius: 16,
      padding: '22px 24px',
      display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' as const,
    }}>
      <div style={{
        width: 52, height: 52, borderRadius: 12, background: '#EDE9FF',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Calendar size={24} color="#7C6FE0" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '2px 9px', borderRadius: 12, fontSize: 9.5, fontWeight: 800,
          background: published ? '#DCFCE7' : '#FEF3C7',
          color: published ? '#15803D' : '#92400E',
          letterSpacing: '0.04em',
          marginBottom: 6,
        }}>
          {published ? <CheckCircle2 size={10} /> : <FileText size={10} />}
          {published ? 'PUBLISHED' : 'DRAFT'}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#13111E', letterSpacing: '-0.3px' }}>
          Your timetable is ready
        </div>
        <div style={{ fontSize: 12, color: '#4B5275', marginTop: 3 }}>
          {sectionsCount} sections scheduled. Open the timetable view to inspect, edit, or substitute.
        </div>
      </div>
      <a href="/timetable" style={{ textDecoration: 'none' }}>
        <button style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '10px 18px', borderRadius: 9,
          border: 'none', background: '#7C6FE0', color: '#fff',
          fontSize: 13, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>
          Open timetable <ArrowRight size={13} />
        </button>
      </a>
    </div>
  )
}

function ActionCard({
  href, icon, title, desc, accent,
}: {
  href: string; icon: React.ReactNode; title: string; desc: string; accent: string;
}) {
  return (
    <a href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        background: '#fff', border: '1px solid #ECEAFB', borderRadius: 14,
        padding: '18px 18px', transition: 'all 0.16s',
        cursor: 'pointer', height: '100%',
      }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = '#D8D2FF';
          (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 18px rgba(124,111,224,0.08)';
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = '#ECEAFB';
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
        }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: '#F5F2FF', color: accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 11,
        }}>
          {icon}
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#13111E', letterSpacing: '-0.2px' }}>
          {title}
        </div>
        <div style={{ fontSize: 11.5, color: '#4B5275', marginTop: 3 }}>
          {desc}
        </div>
      </div>
    </a>
  )
}
