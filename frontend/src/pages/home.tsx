/**
 * Landing page — schedU global marketing home
 *
 * Layout identical to product screenshot (nav · hero · demo card ·
 * features · stats · boards · steps · CTA · footer).
 * Copy is worldwide-neutral — no region lock.
 */

const BOARDS = [
  'IB (MYP / DP)', 'Cambridge IGCSE', 'Common Core', 'GCSE / A-Level',
  'CBSE', 'ICSE', 'AP Courses', 'French Baccalaureate',
  'Australian ATAR', 'NCEA', 'Matric / NSC', 'O-Level / WAEC',
  'Korean CSAT', 'Japanese Gakuryoku', '…and any custom curriculum',
]

export function HomePage() {
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#fff', color: '#13111E', minHeight: '100vh' }}>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow-x: hidden; }

        @keyframes floatCard {
          0%, 100% { transform: translateY(0px);   }
          50%       { transform: translateY(-8px);  }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0);    }
        }

        .lp-nav-link {
          font-size: 14px; color: #4B5275; text-decoration: none;
          font-weight: 500; transition: color 0.15s; white-space: nowrap;
        }
        .lp-nav-link:hover { color: #7C6FE0; }

        .lp-ghost { transition: border-color 0.15s, color 0.15s; }
        .lp-ghost:hover { border-color: #7C6FE0 !important; color: #7C6FE0 !important; }

        .lp-feat {
          transition: transform 0.18s, box-shadow 0.18s, border-color 0.18s;
        }
        .lp-feat:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 24px rgba(124,111,224,0.10);
          border-color: #D8D2FF !important;
        }

        .lp-step {
          transition: transform 0.18s, box-shadow 0.18s, border-color 0.18s;
        }
        .lp-step:hover {
          transform: translateY(-3px);
          box-shadow: 0 8px 24px rgba(124,111,224,0.10);
          border-color: #D8D2FF !important;
        }

        .lp-board-tag {
          display: inline-block;
          padding: 5px 12px; border-radius: 20px;
          border: 1px solid #E8E4FF; background: #FAFAFE;
          font-size: 12px; font-weight: 500; color: #4B5275;
          white-space: nowrap; transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .lp-board-tag:hover {
          background: #EDE9FF; border-color: #C4B5FD; color: #7C3AED;
        }

        .lp-hero-animate { animation: fadeUp 0.55s ease both; }
      `}</style>


      {/* ════════════════════════════════════════════════════
          STICKY NAV
      ════════════════════════════════════════════════════ */}
      <nav style={{
        height: 58, background: '#fff',
        borderBottom: '1px solid #F0EDFF',
        display: 'flex', alignItems: 'center',
        padding: '0 48px', gap: 0,
        position: 'sticky', top: 0, zIndex: 200,
      }}>

        {/* Logo — left */}
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', flexShrink: 0 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: '#7C6FE0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="19" height="19" viewBox="0 0 52 52" fill="none">
              <rect x="12" y="9" width="8" height="33" rx="4" fill="white"/>
              <path d="M 20 22 C 23 14 40 15 40 30 C 40 45 23 46 20 42"
                    stroke="white" strokeWidth="8" fill="none" strokeLinecap="round"/>
              <circle cx="39" cy="10" r="4.5" fill="#D4920E"/>
            </svg>
          </div>
          <span style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 17, fontWeight: 900, letterSpacing: '-0.4px', color: '#13111E',
          }}>
            sched<span style={{
              color: '#7C6FE0',
              fontFamily: "'DM Serif Display', Georgia, serif",
              fontStyle: 'italic',
            }}>U</span>
          </span>
        </a>

        {/* Spacer pushes everything right */}
        <div style={{ flex: 1 }} />

        {/* Nav links — right of centre, before auth */}
        <div style={{ display: 'flex', gap: 28, alignItems: 'center', marginRight: 32 }}>
          {['Features', 'Pricing', 'Docs', 'Contact'].map(l => (
            <a key={l} href="#" className="lp-nav-link">{l}</a>
          ))}
        </div>

        {/* Auth buttons */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <a href="/login" style={{ textDecoration: 'none' }}>
            <button className="lp-ghost" style={{
              padding: '7px 18px', borderRadius: 7,
              border: '1px solid #E8E4FF', background: '#fff',
              fontSize: 13, fontWeight: 600, color: '#4B5275', cursor: 'pointer',
              fontFamily: 'inherit',
            }}>Sign in</button>
          </a>
          <a href="/wizard" style={{ textDecoration: 'none' }}>
            <button style={{
              padding: '8px 18px', borderRadius: 7,
              background: '#13111E', color: '#fff', border: 'none',
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}>Get started</button>
          </a>
        </div>
      </nav>


      {/* ════════════════════════════════════════════════════
          HERO
      ════════════════════════════════════════════════════ */}
      <section style={{
        background: 'linear-gradient(180deg, #F8F7FF 0%, #ffffff 100%)',
        padding: '72px 24px 60px',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', textAlign: 'center',
      }}>

        {/* Badge */}
        <div className="lp-hero-animate" style={{
          animationDelay: '0s',
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '5px 16px', borderRadius: 20,
          background: '#F0FDF4', border: '1px solid #86EFAC',
          fontSize: 12, fontWeight: 600, color: '#15803D',
          marginBottom: 28,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%',
            background: '#22C55E', display: 'inline-block',
            flexShrink: 0,
          }} />
          AI-native timetable engine
        </div>

        {/* Headline */}
        <h1 className="lp-hero-animate" style={{
          animationDelay: '0.08s',
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: 'clamp(34px, 6.5vw, 56px)',
          lineHeight: 1.1, fontWeight: 400, letterSpacing: '-1.5px',
          color: '#13111E', maxWidth: 720, marginBottom: 18,
        }}>
          Schedule with schedU,<br />
          <span style={{ color: '#7C6FE0', fontStyle: 'italic' }}>at the speed of light.</span>
        </h1>

        {/* Sub-copy */}
        <p className="lp-hero-animate" style={{
          animationDelay: '0.16s',
          fontSize: 16, color: '#4B5275', maxWidth: 560,
          lineHeight: 1.8, marginBottom: 36, fontWeight: 400,
        }}>
          schedU intelligently allocates resources — slots, courses, educators, and locations —
          and builds conflict-free timetables in minutes. Designed for schools, colleges,
          universities, coaching institutes, training centres, and academic organizations
          of every scale. Works with any board, any curriculum, anywhere in the world.
        </p>

        {/* CTAs */}
        <div className="lp-hero-animate" style={{
          animationDelay: '0.22s',
          display: 'flex', gap: 12, flexWrap: 'wrap',
          justifyContent: 'center', marginBottom: 52,
        }}>
          <a href="/wizard" style={{ textDecoration: 'none' }}>
            <button style={{
              padding: '13px 30px', borderRadius: 9, border: 'none',
              background: '#7C6FE0', color: '#fff',
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 4px 18px rgba(124,111,224,0.38)',
              fontFamily: 'inherit',
            }}>
              Start free — no credit card
            </button>
          </a>
          <a href="/demo" style={{ textDecoration: 'none' }}>
            <button className="lp-ghost" style={{
              padding: '13px 28px', borderRadius: 9,
              border: '1.5px solid #E8E4FF', background: '#fff',
              fontSize: 14, fontWeight: 600, color: '#4B5275', cursor: 'pointer',
              fontFamily: 'inherit',
            }}>
              See a demo
            </button>
          </a>
        </div>

        {/* Floating demo card */}
        <div className="lp-hero-animate" style={{
          animationDelay: '0.3s',
          width: '100%', maxWidth: 540,
          background: '#fff', borderRadius: 14,
          border: '1px solid #E8E4FF',
          boxShadow: '0 16px 48px rgba(124,111,224,0.14)',
          overflow: 'hidden',
          animation: 'floatCard 6s ease-in-out 0.6s infinite',
        }}>
          {/* Chrome bar */}
          <div style={{
            background: '#F8F7FF', padding: '10px 16px',
            borderBottom: '1px solid #E8E4FF',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
              {['#FC6058','#FDBC2C','#34C749'].map(c => (
                <div key={c} style={{
                  width: 10, height: 10, borderRadius: '50%', background: c,
                }} />
              ))}
            </div>
            <span style={{
              fontSize: 11, color: '#8B87AD', fontWeight: 500,
              fontFamily: "'DM Mono', monospace",
            }}>
              schedU — AI Period Allocation — Grade 8A
            </span>
          </div>

          {/* Allocation grid */}
          <div style={{ padding: '16px 18px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[
                { label: 'Mathematics', value: '7',   hi: false },
                { label: 'Science',     value: '5+1', hi: false },
                { label: 'English',     value: '6',   hi: false },
                { label: 'History',     value: '4',   hi: false },
                { label: 'Geography',   value: '3',   hi: false },
                { label: 'Languages',   value: '3',   hi: false },
                { label: 'PE / Arts',   value: '2',   hi: false },
                { label: 'Capacity',    value: '34',  hi: true  },
              ].map(({ label, value, hi }) => (
                <div key={label} style={{
                  padding: '10px 10px', borderRadius: 9, textAlign: 'center',
                  background: hi ? '#EDE9FF' : '#FAFAFE',
                  border: `1px solid ${hi ? '#C4B5FD' : '#E8E4FF'}`,
                }}>
                  <div style={{
                    fontSize: 10.5, fontWeight: 600, marginBottom: 5,
                    color: hi ? '#7C3AED' : '#8B87AD',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{label}</div>
                  <div style={{
                    fontSize: 20, fontWeight: 800, lineHeight: 1,
                    fontFamily: "'DM Mono', monospace",
                    color: hi ? '#7C3AED' : '#13111E',
                  }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>


      {/* ════════════════════════════════════════════════════
          3 FEATURE COLUMNS
      ════════════════════════════════════════════════════ */}
      <section style={{
        background: '#fff', padding: '64px 24px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: 20, maxWidth: 920, width: '100%',
        }}>
          {[
            {
              icon: '🧠',
              title: 'AI period allocation',
              desc: 'AI suggests balanced period distributions per class and board — no manual tables needed.',
            },
            {
              icon: '👨‍🏫',
              title: 'Smart teacher allocation',
              desc: 'Workload-balanced, expertise-matched teacher assignments with vertical continuity rules.',
            },
            {
              icon: '👥',
              title: 'Dynamic cross-class groups',
              desc: 'Elective and activity groups auto-created across sections — no manual group setup.',
            },
          ].map(f => (
            <div key={f.title} className="lp-feat" style={{
              padding: '26px 22px', borderRadius: 12,
              border: '1px solid #E8E4FF', background: '#FAFAFE',
            }}>
              <div style={{ fontSize: 30, marginBottom: 14, lineHeight: 1 }}>{f.icon}</div>
              <h3 style={{
                fontSize: 15, fontWeight: 700, color: '#13111E',
                marginBottom: 8, fontFamily: 'inherit',
              }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: '#4B5275', lineHeight: 1.7 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>


      {/* ════════════════════════════════════════════════════
          STATS BAND
      ════════════════════════════════════════════════════ */}
      <section style={{
        background: '#F8F7FF',
        borderTop: '1px solid #F0EDFF', borderBottom: '1px solid #F0EDFF',
        padding: '44px 24px',
        display: 'flex', justifyContent: 'center',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 0, maxWidth: 860, width: '100%',
        }}>
          {[
            { value: '1,200+',   label: 'Schools using schedU' },
            { value: '4.8 min',  label: 'Avg. timetable generation time' },
            { value: '98%',      label: 'Conflict-free first generation' },
            { value: '180+',     label: 'Countries & territories' },
          ].map((s, i, arr) => (
            <div key={s.label} style={{
              textAlign: 'center', padding: '16px 12px',
              borderRight: i < arr.length - 1 ? '1px solid #E8E4FF' : 'none',
            }}>
              <div style={{
                fontFamily: "'DM Serif Display', Georgia, serif",
                fontSize: 30, fontWeight: 400, color: '#13111E',
                lineHeight: 1, marginBottom: 7,
              }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#8B87AD', lineHeight: 1.5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>


      {/* ════════════════════════════════════════════════════
          GLOBAL BOARD SUPPORT
      ════════════════════════════════════════════════════ */}
      <section style={{
        background: '#fff', padding: '56px 24px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      }}>
        <p style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: '#8B87AD', marginBottom: 20,
        }}>
          Works with every curriculum worldwide
        </p>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center',
          maxWidth: 820,
        }}>
          {BOARDS.map(b => (
            <span key={b} className="lp-board-tag">{b}</span>
          ))}
        </div>
        <p style={{ fontSize: 13, color: '#8B87AD', marginTop: 20, lineHeight: 1.6, maxWidth: 480 }}>
          No built-in board restrictions. Enter your own period counts, subject names,
          and grading labels — schedU adapts to you.
        </p>
      </section>


      {/* ════════════════════════════════════════════════════
          4-STEP HOW IT WORKS
      ════════════════════════════════════════════════════ */}
      <section style={{
        background: '#F8F7FF',
        borderTop: '1px solid #F0EDFF',
        padding: '64px 24px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        <p style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: '#8B87AD', marginBottom: 28,
        }}>How it works</p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 16, maxWidth: 900, width: '100%',
        }}>
          {[
            {
              n: 1, title: 'Enter basics',
              desc: 'Name, board, class range, teachers, rooms.',
            },
            {
              n: 2, title: 'AI generates',
              desc: 'Allocations, groups, and constraints auto-built.',
            },
            {
              n: 3, title: 'Review & refine',
              desc: 'AI inlines like a spreadsheet. AI explains every choice.',
            },
            {
              n: 4, title: 'Export & publish',
              desc: 'PDF, Excel, print — class-wise, teacher-wise, room-wise.',
            },
          ].map(s => (
            <div key={s.n} className="lp-step" style={{
              padding: '22px 20px', borderRadius: 12,
              border: '1px solid #E8E4FF', background: '#fff',
            }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                padding: '3px 10px', borderRadius: 20,
                background: '#EDE9FF', marginBottom: 14,
                fontSize: 10, fontWeight: 800, color: '#7C6FE0', letterSpacing: '0.04em',
              }}>
                Step {s.n}
              </div>
              <h4 style={{
                fontSize: 14, fontWeight: 700, color: '#13111E',
                marginBottom: 7, fontFamily: 'inherit',
              }}>{s.title}</h4>
              <p style={{ fontSize: 12.5, color: '#4B5275', lineHeight: 1.65 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>


      {/* ════════════════════════════════════════════════════
          BOTTOM CTA
      ════════════════════════════════════════════════════ */}
      <section style={{
        background: '#fff', borderTop: '1px solid #F0EDFF',
        padding: '72px 24px',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', textAlign: 'center',
      }}>
        <h2 style={{
          fontFamily: "'DM Serif Display', Georgia, serif",
          fontSize: 32, fontWeight: 400, color: '#13111E', marginBottom: 10,
          lineHeight: 1.2,
        }}>
          Ready to build your timetable?
        </h2>
        <p style={{
          fontSize: 15, color: '#8B87AD', marginBottom: 32,
          lineHeight: 1.6, maxWidth: 380,
        }}>
          Start free. No setup. No training required.
        </p>
        <a href="/wizard" style={{ textDecoration: 'none' }}>
          <button style={{
            padding: '14px 36px', borderRadius: 9, border: 'none',
            background: '#7C6FE0', color: '#fff',
            fontSize: 15, fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 4px 18px rgba(124,111,224,0.38)',
            fontFamily: 'inherit',
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            Create your first timetable →
          </button>
        </a>
      </section>


      {/* ════════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════════ */}
      <footer style={{
        borderTop: '1px solid #F0EDFF',
        padding: '20px 48px',
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', gap: 24 }}>
          {['Privacy', 'Terms', 'Support', 'Status'].map(l => (
            <a key={l} href="#" style={{
              color: '#8B87AD', textDecoration: 'none',
              fontSize: 12, fontWeight: 500,
              transition: 'color 0.15s',
            }}
              onMouseOver={e => (e.currentTarget.style.color = '#7C6FE0')}
              onMouseOut={e  => (e.currentTarget.style.color = '#8B87AD')}
            >{l}</a>
          ))}
        </div>
        <span style={{ fontSize: 12, color: '#8B87AD' }}>© 2025 schedU</span>
      </footer>

    </div>
  )
}
