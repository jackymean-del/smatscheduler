/**
 * Dashboard — Page 4
 *
 * Sidebar sections:
 *   WORKSPACE      — Dashboard · Schedules · Calendar · Insights
 *   ADMINISTRATION — Users · Resources · Settings
 *   HELP & SUPPORT — Support Center · Documentation · Book a Demo
 *
 * Collapses to 56 px (icons + tooltip) / expands to 220 px (icon + label + section headers).
 * Bottom strip: user avatar · name · email · plan badge + Upgrade.
 */

import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { useTimetableStore } from '@/store/timetableStore'
import {
  Home, CalendarDays, Calendar, BarChart2,
  Users, Database, Settings,
  LifeBuoy, BookOpen, Video,
  Bell, Plus, Sparkles, MoreHorizontal,
  ChevronRight, ArrowRight, ChevronLeft,
  Zap,
} from 'lucide-react'

// ── helpers ────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ── types ──────────────────────────────────────────────────────
type NavTab     = 'dashboard' | 'timetables' | 'resources' | 'reports'
type SideNavKey =
  | 'dashboard' | 'schedules' | 'calendar' | 'insights'
  | 'users' | 'resources' | 'settings'
  | 'support' | 'docs' | 'demo'

// ── Sidebar structure ──────────────────────────────────────────
interface SideItem {
  key: SideNavKey
  icon: React.ElementType
  label: string
  href: string
  external?: boolean
}
interface SideSection {
  heading: string
  items: SideItem[]
}

const SIDE_SECTIONS: SideSection[] = [
  {
    heading: 'WORKSPACE',
    items: [
      { key: 'dashboard', icon: Home,         label: 'Dashboard',  href: '/dashboard' },
      { key: 'schedules', icon: CalendarDays, label: 'Schedules',  href: '/wizard'    },
      { key: 'calendar',  icon: Calendar,     label: 'Calendar',   href: '#'          },
      { key: 'insights',  icon: BarChart2,    label: 'Insights',   href: '#'          },
    ],
  },
  {
    heading: 'ADMINISTRATION',
    items: [
      { key: 'users',     icon: Users,    label: 'Users',     href: '#'           },
      { key: 'resources', icon: Database, label: 'Resources', href: '/master-data' },
      { key: 'settings',  icon: Settings, label: 'Settings',  href: '#'           },
    ],
  },
  {
    heading: 'HELP & SUPPORT',
    items: [
      { key: 'support', icon: LifeBuoy, label: 'Support Center',  href: '#',                        },
      { key: 'docs',    icon: BookOpen, label: 'Documentation',   href: '#', external: true         },
      { key: 'demo',    icon: Video,    label: 'Book a Demo',     href: '#', external: true         },
    ],
  },
]

// ── Demo timetable rows ────────────────────────────────────────
const DEMO_TT = [
  {
    id: 'tt1', name: 'AY 2025–26 · Main',
    meta: '52 classes · 84 teachers · Generated 3 days ago',
    status: 'active' as const,
  },
  {
    id: 'tt2', name: 'AY 2025–26 · Revised (Post-annual)',
    meta: '52 classes · 84 teachers · In wizard · Step 3',
    status: 'draft' as const,
  },
  {
    id: 'tt3', name: 'AY 2024–25 · Archive',
    meta: '49 classes · 80 teachers · Archived',
    status: 'archived' as const,
  },
]

const STATUS_META = {
  active:   { label: 'Active',   bg: '#DCFCE7', fg: '#15803D', border: '#BBF7D0' },
  draft:    { label: 'Draft',    bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
  archived: { label: 'Archived', bg: '#F3F4F6', fg: '#6B7280', border: '#E5E7EB' },
}

// ── Widths ─────────────────────────────────────────────────────
const W_COLLAPSED = 56
const W_EXPANDED  = 220
const TRANSITION  = 'width 0.22s cubic-bezier(0.4,0,0.2,1)'

// ── Component ──────────────────────────────────────────────────
export function DashboardPage() {
  const { user, logout } = useAuthStore()
  const store = useTimetableStore() as any
  const { sections, staff } = store

  const [activeTab,      setActiveTab]      = useState<NavTab>('dashboard')
  const [activeSideKey,  setActiveSideKey]  = useState<SideNavKey>('dashboard')
  const [sidebarOpen,    setSidebarOpen]    = useState(false)

  if (!user) { window.location.href = '/login'; return null }

  const firstName  = user.name?.split(' ')[0] ?? 'there'
  const schoolName = user.schoolName ?? 'Your School'
  const hasTT      = Object.keys(store.classTT ?? {}).length > 0
  const conflicts  = (store.conflicts ?? []).length

  const stats = [
    {
      label: 'Timetables',
      value: hasTT ? 1 : 3,
      sub: hasTT ? '1 active' : '2 active · 1 draft',
      red: false,
    },
    {
      label: 'Total classes',
      value: sections.length || 52,
      sub: sections.length ? `${sections.length} sections` : 'Across I–XII',
      red: false,
    },
    {
      label: 'Teachers',
      value: staff.length || 84,
      sub: staff.length ? `${staff.length} staff` : '78 allocated',
      red: false,
    },
    {
      label: 'Conflicts',
      value: conflicts || 2,
      sub: 'Needs attention',
      red: true,
    },
  ]

  const SW = sidebarOpen ? W_EXPANDED : W_COLLAPSED

  // Avatar initials (up to 2 chars)
  const initials = (user.name ?? 'U')
    .split(' ')
    .slice(0, 2)
    .map((w: string) => w[0])
    .join('')
    .toUpperCase()

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: '100vh',
      fontFamily: "'Inter', -apple-system, sans-serif",
      background: '#F5F4F0', color: '#13111E',
    }}>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .db-tab      { transition: background 0.13s, color 0.13s; }
        .db-tab:hover { background: #F5F4F0 !important; }
        .db-icon-btn { transition: background 0.13s; border-radius: 9px; }
        .db-icon-btn:hover { background: #EDE9FF !important; }
        .sb-item     { transition: background 0.13s, color 0.13s; text-decoration: none; }
        .sb-item:hover { background: #F0EDFF !important; }
        .db-tt-row   { transition: box-shadow 0.14s, border-color 0.14s; }
        .db-tt-row:hover { border-color: #D1D5DB !important; box-shadow: 0 2px 10px rgba(0,0,0,0.06); }
        .db-qa-card  { transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s; }
        .db-qa-card:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,0.07); border-color: #D1D5DB !important; }
        .db-act-btn  { transition: background 0.13s; }
        .db-act-btn:hover { background: #F3F4F6 !important; }
        .sb-label    { white-space: nowrap; overflow: hidden; pointer-events: none; }
        .sb-upgrade  { transition: background 0.14s; }
        .sb-upgrade:hover { background: #6655CC !important; }
      `}</style>

      {/* ══ TOP NAV ══════════════════════════════════════════ */}
      <header style={{
        height: 52, background: '#fff',
        borderBottom: '1px solid #E5E7EB',
        display: 'flex', alignItems: 'center',
        padding: '0 16px 0 0',
        flexShrink: 0, zIndex: 100,
        position: 'sticky', top: 0,
      }}>
        {/* Logo / toggle block */}
        <div style={{
          width: SW, height: 52, flexShrink: 0,
          display: 'flex', alignItems: 'center',
          borderRight: '1px solid #F0EDFF',
          overflow: 'hidden',
          transition: TRANSITION,
          paddingLeft: sidebarOpen ? 14 : 0,
          justifyContent: sidebarOpen ? 'flex-start' : 'center',
          gap: 8,
        }}>
          <button
            onClick={() => setSidebarOpen(o => !o)}
            title={sidebarOpen ? 'Collapse' : 'Expand'}
            style={{
              width: 28, height: 28, borderRadius: 7, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280',
              transition: 'background 0.13s',
            }}
          >
            {sidebarOpen ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
          </button>

          {sidebarOpen && (
            <a href="/" style={{ textDecoration: 'none', lineHeight: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-0.3px', color: '#13111E' }}>
                sched<span style={{
                  color: '#7C6FE0',
                  fontFamily: "'DM Serif Display', Georgia, serif",
                  fontStyle: 'italic',
                }}>U</span>
              </span>
            </a>
          )}
        </div>

        {/* Tabs */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 16px', flex: 1 }}>
          {([
            { key: 'dashboard',  label: 'Dashboard'  },
            { key: 'timetables', label: 'Timetables' },
            { key: 'resources',  label: 'Resources'  },
            { key: 'reports',    label: 'Reports'    },
          ] as { key: NavTab; label: string }[]).map(t => (
            <button key={t.key} className="db-tab"
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: '5px 14px', borderRadius: 7, border: 'none',
                background: activeTab === t.key ? '#F0EDFF' : 'transparent',
                color: activeTab === t.key ? '#7C3AED' : '#6B7280',
                fontSize: 13, fontWeight: activeTab === t.key ? 600 : 500,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {t.label}
            </button>
          ))}
        </nav>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>{schoolName}</span>

          <button className="db-icon-btn" style={{
            width: 32, height: 32, display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'none', border: 'none',
            cursor: 'pointer', position: 'relative',
          }}>
            <Bell size={17} color="#6B7280" />
            <span style={{
              position: 'absolute', top: 5, right: 6,
              width: 7, height: 7, borderRadius: '50%',
              background: '#EF4444', border: '1.5px solid #fff',
            }} />
          </button>

          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: '#7C6FE0', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
          }}>
            {initials}
          </div>

          <button onClick={() => { logout(); window.location.href = '/login' }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 4, color: '#6B7280',
              display: 'flex', alignItems: 'center',
            }}>
            <MoreHorizontal size={18} />
          </button>
        </div>
      </header>

      {/* ══ BODY ══════════════════════════════════════════════ */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Sidebar ── */}
        <aside style={{
          width: SW,
          flexShrink: 0,
          background: '#fff',
          borderRight: '1px solid #E5E7EB',
          display: 'flex',
          flexDirection: 'column',
          transition: TRANSITION,
          overflow: 'hidden',
        }}>
          {/* Scrollable nav area */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '10px 8px 0' }}>
            {SIDE_SECTIONS.map((section, si) => (
              <div key={section.heading} style={{ marginBottom: si < SIDE_SECTIONS.length - 1 ? 8 : 0 }}>

                {/* Section heading — only when expanded */}
                {sidebarOpen && (
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                    color: '#9CA3AF', padding: '10px 10px 4px',
                    userSelect: 'none',
                  }}>
                    {section.heading}
                  </div>
                )}

                {/* Divider line when collapsed */}
                {!sidebarOpen && si > 0 && (
                  <div style={{
                    height: 1, background: '#F3F4F6',
                    margin: '6px 10px',
                  }} />
                )}

                {section.items.map(item => {
                  const isActive = activeSideKey === item.key
                  const Icon = item.icon
                  return (
                    <a
                      key={item.key}
                      href={item.href === '#' ? undefined : item.href}
                      onClick={e => {
                        if (item.href === '#') e.preventDefault()
                        setActiveSideKey(item.key)
                      }}
                      className="sb-item"
                      title={!sidebarOpen ? item.label : undefined}
                      target={item.external ? '_blank' : undefined}
                      rel={item.external ? 'noopener noreferrer' : undefined}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: sidebarOpen ? 10 : 0,
                        justifyContent: sidebarOpen ? 'flex-start' : 'center',
                        padding: sidebarOpen ? '8px 10px' : '9px 0',
                        borderRadius: 8,
                        background: isActive ? '#EDE9FF' : 'none',
                        color: isActive ? '#7C3AED' : '#4B5563',
                        cursor: 'pointer',
                        marginBottom: 1,
                        overflow: 'hidden',
                        minWidth: 0,
                      }}
                    >
                      <Icon
                        size={17}
                        style={{ flexShrink: 0, color: isActive ? '#7C3AED' : '#6B7280' }}
                      />

                      <span
                        className="sb-label"
                        style={{
                          fontSize: 13,
                          fontWeight: isActive ? 600 : 400,
                          opacity: sidebarOpen ? 1 : 0,
                          maxWidth: sidebarOpen ? 160 : 0,
                          transition: 'opacity 0.15s, max-width 0.22s',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          flex: 1,
                        }}
                      >
                        {item.label}
                        {item.external && sidebarOpen && (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.45, flexShrink: 0 }}>
                            <path d="M1 9L9 1M9 1H3M9 1V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </span>
                    </a>
                  )
                })}
              </div>
            ))}
          </div>

          {/* ── User + Plan strip ── */}
          <div style={{
            borderTop: '1px solid #F3F4F6',
            padding: sidebarOpen ? '10px 12px' : '10px 8px',
            flexShrink: 0,
            overflow: 'hidden',
          }}>
            {/* User row */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: sidebarOpen ? 10 : 0,
              justifyContent: sidebarOpen ? 'flex-start' : 'center',
              marginBottom: sidebarOpen ? 8 : 0,
              overflow: 'hidden',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: '#7C6FE0', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, flexShrink: 0,
              }}>
                {initials}
              </div>
              {sidebarOpen && (
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: '#13111E',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {user.name ?? 'User'}
                  </div>
                  <div style={{
                    fontSize: 11, color: '#9CA3AF',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {user.email ?? ''}
                  </div>
                </div>
              )}
            </div>

            {/* Plan badge + Upgrade — only when expanded */}
            {sidebarOpen && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#F9F8FF', borderRadius: 8,
                border: '1px solid #EDE9FF', padding: '7px 10px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Zap size={13} color="#7C6FE0" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#7C6FE0' }}>Free Plan</span>
                </div>
                <button className="sb-upgrade" style={{
                  padding: '4px 12px', borderRadius: 6, border: 'none',
                  background: '#7C6FE0', color: '#fff',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}>
                  Upgrade
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* ── Main content ── */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>

          {/* Greeting row */}
          <div style={{
            display: 'flex', alignItems: 'flex-start',
            justifyContent: 'space-between', marginBottom: 20,
          }}>
            <div>
              <h1 style={{
                fontSize: 20, fontWeight: 700, color: '#13111E',
                marginBottom: 4, letterSpacing: '-0.3px',
              }}>
                {greeting()}, {firstName}
              </h1>
              <p style={{ fontSize: 13, color: '#6B7280' }}>
                {schoolName} · AY 2025–26 · {(store.config as any)?.boardName ?? 'CBSE'}
              </p>
            </div>
            <a href="/wizard" style={{ textDecoration: 'none' }}>
              <button style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '8px 16px', borderRadius: 8,
                border: '1px solid #D1D5DB', background: '#fff',
                fontSize: 13, fontWeight: 600, color: '#13111E',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <Plus size={14} /> New timetable
              </button>
            </a>
          </div>

          {/* Stats row */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12, marginBottom: 16,
          }}>
            {stats.map(s => (
              <div key={s.label} style={{
                background: '#fff', borderRadius: 10,
                border: '1px solid #E5E7EB', padding: '14px 16px',
              }}>
                <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>{s.label}</div>
                <div style={{
                  fontSize: 28, fontWeight: 800, lineHeight: 1,
                  color: s.red ? '#EF4444' : '#13111E',
                  fontFamily: "'DM Mono', monospace",
                  marginBottom: 5,
                }}>
                  {s.value}
                </div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* AI insight banner */}
          <div style={{
            background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 10,
            padding: '12px 16px', marginBottom: 20,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <Sparkles size={16} color="#15803D" style={{ flexShrink: 0 }} />
            <p style={{ flex: 1, fontSize: 13, color: '#166534', lineHeight: 1.55 }}>
              <strong>AI insight:</strong> Mr. Sharma is overloaded by 6 periods in the AY 2025–26 draft.
              Reassigning Chemistry XI to Ms. Nair would balance both workloads within capacity.
            </p>
            <button style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '6px 14px', borderRadius: 7, border: 'none',
              background: '#16A34A', color: '#fff',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'inherit', flexShrink: 0,
            }}>
              Fix <ChevronRight size={12} />
            </button>
          </div>

          {/* Your timetables */}
          <div style={{ marginBottom: 24 }}>
            <div style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', marginBottom: 12,
            }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#13111E' }}>Your timetables</h2>
              <a href="#" style={{ fontSize: 13, color: '#7C6FE0', fontWeight: 500, textDecoration: 'none' }}>
                View all
              </a>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {DEMO_TT.map(tt => {
                const sm = STATUS_META[tt.status]
                return (
                  <div key={tt.id} className="db-tt-row" style={{
                    background: '#fff', borderRadius: 10,
                    border: '1px solid #E5E7EB', padding: '14px 16px',
                    display: 'flex', alignItems: 'center', gap: 14,
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: '#F5F4F0', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <CalendarDays size={17} color="#6B7280" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#13111E', marginBottom: 2 }}>
                        {tt.name}
                      </div>
                      <div style={{ fontSize: 12, color: '#9CA3AF' }}>{tt.meta}</div>
                    </div>
                    <span style={{
                      padding: '3px 10px', borderRadius: 20,
                      background: sm.bg, color: sm.fg, border: `1px solid ${sm.border}`,
                      fontSize: 12, fontWeight: 600, flexShrink: 0,
                    }}>
                      {sm.label}
                    </span>
                    {tt.status === 'active' && (
                      <>
                        <TtBtn onClick={() => { window.location.href = '/timetable' }}>Edit</TtBtn>
                        <TtBtn onClick={() => {}}>Export</TtBtn>
                      </>
                    )}
                    {tt.status === 'draft' && (
                      <TtBtn primary onClick={() => { window.location.href = '/wizard' }}>
                        Continue <ArrowRight size={12} />
                      </TtBtn>
                    )}
                    {tt.status === 'archived' && (
                      <TtBtn onClick={() => { window.location.href = '/timetable' }}>View</TtBtn>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Quick actions */}
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: '#13111E', marginBottom: 12 }}>
              Quick actions
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                {
                  icon: <Users size={22} color="#6B7280" />,
                  title: 'Manage teachers',
                  desc: 'Update staff, subjects, and workload limits',
                  href: '/master-data',
                },
                {
                  icon: <Database size={22} color="#6B7280" />,
                  title: 'Manage resources',
                  desc: 'Add venues, set capacity, configure availability',
                  href: '/master-data',
                },
                {
                  icon: <BarChart2 size={22} color="#6B7280" />,
                  title: 'View reports',
                  desc: 'Workload analysis, room usage, conflict log',
                  href: '/timetable',
                },
              ].map(qa => (
                <a key={qa.title} href={qa.href} style={{ textDecoration: 'none' }}>
                  <div className="db-qa-card" style={{
                    background: '#fff', borderRadius: 10,
                    border: '1px solid #E5E7EB', padding: '18px 16px', cursor: 'pointer',
                  }}>
                    <div style={{ marginBottom: 12 }}>{qa.icon}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#13111E', marginBottom: 4 }}>
                      {qa.title}
                    </div>
                    <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.55 }}>{qa.desc}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>

        </main>
      </div>
    </div>
  )
}

// ── Timetable action button ─────────────────────────────────────
function TtBtn({ children, onClick, primary }: {
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button onClick={onClick} className="db-act-btn" style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '6px 14px', borderRadius: 7, cursor: 'pointer',
      border: primary ? 'none' : '1px solid #E5E7EB',
      background: primary ? '#13111E' : '#fff',
      color: primary ? '#fff' : '#374151',
      fontSize: 13, fontWeight: 600, flexShrink: 0,
      fontFamily: 'inherit',
    }}>
      {children}
    </button>
  )
}
