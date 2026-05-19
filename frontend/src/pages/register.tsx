/**
 * Sign-up page — matches Page 2 mockup
 *
 * Left panel  : brand sidebar with 4 feature bullets + trust line
 * Right panel : registration form
 *   First name / Last name · Work email · School name
 *   Board / School type · Password
 *   → Create account (dark)  |  Continue with Google
 */

import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { Loader2 } from 'lucide-react'
import { AppFooter } from '@/components/AppFooter'

// ── Google "G" mark ───────────────────────────────────────────
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908C16.658 14.233 17.64 11.925 17.64 9.2z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

// ── Sidebar feature icons (inline SVG, no deps) ───────────────
const FEATURES = [
  {
    color: '#0EA5E9',
    bg: '#E0F2FE',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
      </svg>
    ),
    title: 'AI-generated allocations',
    desc: 'No manual tables — AI suggests everything from scratch.',
  },
  {
    color: '#3B82F6',
    bg: '#DBEAFE',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
      </svg>
    ),
    title: 'Spreadsheet-native editing',
    desc: 'Inline editing, drag-fill, copy-paste from Excel.',
  },
  {
    color: '#F97316',
    bg: '#FFEDD5',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
    title: 'Conflict-free guarantee',
    desc: 'Hard constraints enforced. AI flags soft ones.',
  },
  {
    color: '#8B5CF6',
    bg: '#EDE9FF',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
      </svg>
    ),
    title: 'Export anywhere',
    desc: 'PDF, Excel, print — class, teacher, or room view.',
  },
]

const BOARDS = [
  'CBSE', 'ICSE', 'IB (MYP / DP)', 'Cambridge IGCSE',
  'Common Core', 'GCSE / A-Level', 'State Board', 'Custom / Other',
]
const SCHOOL_TYPES = [
  'Day school', 'Boarding school', 'University', 'College',
  'Coaching institute', 'Training centre', 'Online', 'Other',
]

const FAKE_GOOGLE_USERS = [
  { name: 'Alex Johnson',  email: 'alex.johnson@gmail.com',  school: 'Greenwood Academy' },
  { name: 'Maria Garcia',  email: 'maria.garcia@gmail.com',  school: 'St. Mary\'s College' },
  { name: 'James Wilson',  email: 'james.wilson@gmail.com',  school: 'Lincoln High School' },
]

export function RegisterPage() {
  const { register } = useAuthStore()

  const [firstName,   setFirstName]   = useState('')
  const [lastName,    setLastName]    = useState('')
  const [email,       setEmail]       = useState('')
  const [school,      setSchool]      = useState('')
  const [state,       setState]       = useState('')
  const [country,     setCountry]     = useState('')
  const [phone,       setPhone]       = useState('')
  const [board,       setBoard]       = useState('')
  const [schoolType,  setSchoolType]  = useState('')
  const [password,    setPassword]    = useState('')
  const [loading,     setLoading]     = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error,       setError]       = useState('')

  const busy = loading || googleLoading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!firstName || !email || !password) { setError('First name, email and password are required'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setError(''); setLoading(true)
    try {
      const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
      await register(fullName, email, password, school || undefined)
      window.location.href = '/wizard'
    } catch {
      setError('Registration failed. Please try again.')
    } finally { setLoading(false) }
  }

  const handleGoogle = async () => {
    setGoogleLoading(true); setError('')
    await new Promise(r => setTimeout(r, 1100))
    try {
      const u = FAKE_GOOGLE_USERS[Math.floor(Math.random() * FAKE_GOOGLE_USERS.length)]
      await register(u.name, u.email, 'google-oauth-token', u.school)
      window.location.href = '/wizard'
    } catch {
      setError('Google sign-in failed. Please try again.')
      setGoogleLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minHeight: '100vh',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
    <div style={{ display: 'flex', flex: 1 }}>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin { to { transform: rotate(360deg) } }
        .reg-input {
          width: 100%; padding: 10px 12px;
          border: 1px solid #D1D5DB; border-radius: 6px;
          font-size: 14px; outline: none; background: #fff;
          color: #13111E; font-family: inherit;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .reg-input:focus {
          border-color: #7C6FE0;
          box-shadow: 0 0 0 3px rgba(124,111,224,0.10);
        }
        .reg-select {
          width: 100%; padding: 10px 12px;
          border: 1px solid #D1D5DB; border-radius: 6px;
          font-size: 14px; outline: none; background: #fff;
          color: #13111E; font-family: inherit; cursor: pointer;
          appearance: auto;
          transition: border-color 0.15s;
        }
        .reg-select:focus { border-color: #7C6FE0; }
        .reg-google:hover {
          border-color: #9CA3AF !important;
          background: #F9FAFB !important;
        }
      `}</style>

      {/* ════════════════════════════════
          LEFT SIDEBAR
      ════════════════════════════════ */}
      <aside style={{
        width: 260, flexShrink: 0,
        background: '#F5F4F0',
        display: 'flex', flexDirection: 'column',
        padding: '40px 28px',
      }}>
        {/* Logo */}
        <div style={{ marginBottom: 40 }}>
          <a href="/" style={{ textDecoration: 'none' }}>
            <span style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 20, fontWeight: 900,
              letterSpacing: '-0.5px', color: '#13111E',
            }}>
              sched<span style={{ color: '#7C6FE0', fontFamily: "'DM Serif Display',Georgia,serif", fontStyle: 'italic' }}>U</span>
            </span>
          </a>
        </div>

        {/* Feature bullets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, flex: 1 }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{
                width: 28, height: 28, borderRadius: 7,
                background: f.bg, color: f.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, marginTop: 1,
              }}>
                {f.icon}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#13111E', marginBottom: 3, lineHeight: 1.3 }}>
                  {f.title}
                </div>
                <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.55 }}>
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Trust line */}
        <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5, marginTop: 32 }}>
          Trusted by <strong style={{ color: '#13111E' }}>1,200+</strong> schools worldwide
        </div>
      </aside>

      {/* ════════════════════════════════
          RIGHT — FORM PANEL
      ════════════════════════════════ */}
      <main style={{
        flex: 1, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '52px 40px',
        overflowY: 'auto',
      }}>
        <div style={{ width: '100%', maxWidth: 440 }}>

          {/* Heading */}
          <h1 style={{
            fontSize: 26, fontWeight: 700, color: '#13111E',
            marginBottom: 6, letterSpacing: '-0.3px',
          }}>
            Create your account
          </h1>
          <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 28 }}>
            Set up your institution in under 2 minutes.
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* First / Last name */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={lbl}>First name</label>
                <input className="reg-input" value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  placeholder="Aarav" autoFocus />
              </div>
              <div>
                <label style={lbl}>Last name</label>
                <input className="reg-input" value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  placeholder="Sharma" />
              </div>
            </div>

            {/* Work email */}
            <div>
              <label style={lbl}>Work email</label>
              <input className="reg-input" type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="principal@yourschool.edu" />
            </div>

            {/* School name */}
            <div>
              <label style={lbl}>School name</label>
              <input className="reg-input" value={school}
                onChange={e => setSchool(e.target.value)}
                placeholder="e.g. Lincoln International School" />
            </div>

            {/* State / Country */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={lbl}>State / Province</label>
                <input className="reg-input" value={state}
                  onChange={e => setState(e.target.value)}
                  placeholder="e.g. California" />
              </div>
              <div>
                <label style={lbl}>Country</label>
                <input className="reg-input" value={country}
                  onChange={e => setCountry(e.target.value)}
                  placeholder="e.g. United States" />
              </div>
            </div>

            {/* Contact number */}
            <div>
              <label style={lbl}>Contact number</label>
              <input className="reg-input" type="tel" value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="e.g. +1 415 555 0123" />
            </div>

            {/* Board / Institution type */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={lbl}>Board</label>
                <select className="reg-select" value={board}
                  onChange={e => setBoard(e.target.value)}>
                  <option value="">Select board</option>
                  {BOARDS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Institution type</label>
                <select className="reg-select" value={schoolType}
                  onChange={e => setSchoolType(e.target.value)}>
                  <option value="">Select type</option>
                  {SCHOOL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* Password */}
            <div>
              <label style={lbl}>Password</label>
              <input className="reg-input" type="password" value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters" />
            </div>

            {/* Error */}
            {error && (
              <div style={{
                padding: '9px 12px', borderRadius: 6, fontSize: 13,
                background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626',
              }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={busy} style={{
              width: '100%', padding: '11px',
              borderRadius: 6, border: 'none',
              background: busy ? '#374151' : '#111827',
              color: '#fff', fontSize: 15, fontWeight: 600,
              cursor: busy ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginTop: 2, fontFamily: 'inherit',
              transition: 'background 0.15s',
            }}>
              {loading
                ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Creating account…</>
                : 'Create account'}
            </button>
          </form>

          {/* Terms */}
          <p style={{ fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginTop: 14, lineHeight: 1.6 }}>
            By signing up you agree to the{' '}
            <a href="#" style={{ color: '#6B7280', textDecoration: 'underline' }}>Terms of Service</a>
            {' '}and{' '}
            <a href="#" style={{ color: '#6B7280', textDecoration: 'underline' }}>Privacy Policy</a>.
          </p>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
            <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
            <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 500 }}>or</span>
            <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
          </div>

          {/* Google */}
          <button onClick={handleGoogle} disabled={busy} type="button"
            className="reg-google"
            style={{
              width: '100%', padding: '11px',
              borderRadius: 6, border: '1px solid #D1D5DB',
              background: '#fff', fontSize: 14, fontWeight: 500,
              color: '#374151', cursor: busy ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              fontFamily: 'inherit', transition: 'background 0.15s, border-color 0.15s',
            }}>
            {googleLoading
              ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Connecting…</>
              : <><GoogleMark /> Continue with Google</>
            }
          </button>

          {/* Sign in link */}
          <p style={{ textAlign: 'center', fontSize: 13, color: '#6B7280', marginTop: 20 }}>
            Already have an account?{' '}
            <a href="/login" style={{ color: '#7C6FE0', fontWeight: 600, textDecoration: 'none' }}>
              Sign in
            </a>
          </p>

        </div>
      </main>
    </div>
    <AppFooter />
    </div>
  )
}

// ── Shared label style ────────────────────────────────────────
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 500,
  color: '#374151', marginBottom: 5,
}
