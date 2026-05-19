/**
 * Sign-in page — matches Page 3 mockup
 *
 * Centred card on warm-cream background:
 *   schedU logo + tagline
 *   "Welcome back" heading
 *   Work email · Password
 *   "Keep me signed in for 30 days" + "Forgot password?"
 *   Sign in (outlined) | or | Sign in with Google (outlined)
 *   "No account yet? Sign up free"
 *   SSO enterprise banner
 */

import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { Loader2, Info } from 'lucide-react'
import { AppFooter } from '@/components/AppFooter'

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

const FAKE_GOOGLE_USERS = [
  { name: 'Alex Johnson', email: 'alex.johnson@gmail.com', school: 'Greenwood Academy' },
  { name: 'Maria Garcia', email: 'maria.garcia@gmail.com', school: "St. Mary's College" },
  { name: 'James Wilson', email: 'james.wilson@gmail.com', school: 'Lincoln High School' },
]

export function LoginPage() {
  const { login, register } = useAuthStore()
  const [email,         setEmail]         = useState('')
  const [password,      setPassword]      = useState('')
  const [rememberMe,    setRememberMe]     = useState(true)
  const [loading,       setLoading]       = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error,         setError]         = useState('')

  const busy = loading || googleLoading

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) { setError('Enter your email and password'); return }
    setError(''); setLoading(true)
    try {
      await login(email, password)
      window.location.href = '/dashboard'
    } catch {
      setError('Invalid credentials. Please try again.')
    } finally { setLoading(false) }
  }

  const handleGoogle = async () => {
    setGoogleLoading(true); setError('')
    await new Promise(r => setTimeout(r, 1100))
    try {
      const u = FAKE_GOOGLE_USERS[Math.floor(Math.random() * FAKE_GOOGLE_USERS.length)]
      await register(u.name, u.email, 'google-oauth-token', u.school)
      window.location.href = '/dashboard'
    } catch {
      setError('Google sign-in failed. Please try again.')
      setGoogleLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F5F4F0',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
    <div style={{
      flex: 1,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '32px 16px',
    }}>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin { to { transform: rotate(360deg) } }
        .si-input {
          width: 100%; padding: 10px 12px;
          border: 1px solid #D1D5DB; border-radius: 6px;
          font-size: 14px; outline: none; background: #fff;
          color: #13111E; font-family: inherit;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .si-input:focus {
          border-color: #7C6FE0;
          box-shadow: 0 0 0 3px rgba(124,111,224,0.10);
        }
        .si-btn-outline {
          transition: background 0.15s, border-color 0.15s;
        }
        .si-btn-outline:hover:not(:disabled) {
          background: #F9FAFB !important;
          border-color: #9CA3AF !important;
        }
      `}</style>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 400,
        background: '#fff', borderRadius: 14,
        border: '1px solid #E5E7EB',
        boxShadow: '0 4px 24px rgba(0,0,0,0.07)',
        padding: '36px 32px 28px',
      }}>

        {/* Logo + tagline */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <a href="/" style={{ textDecoration: 'none', display: 'inline-block', marginBottom: 6 }}>
            <span style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 20, fontWeight: 900, letterSpacing: '-0.4px', color: '#13111E',
            }}>
              sched<span style={{
                color: '#7C6FE0',
                fontFamily: "'DM Serif Display', Georgia, serif",
                fontStyle: 'italic',
              }}>U</span>
            </span>
          </a>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>
            AI-native academic scheduling
          </p>
        </div>

        {/* Heading */}
        <h1 style={{
          fontSize: 22, fontWeight: 700, color: '#13111E',
          marginBottom: 20, letterSpacing: '-0.3px',
        }}>
          Welcome back
        </h1>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Work email */}
          <div>
            <label style={lbl}>Work email</label>
            <input className="si-input" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@school.edu" autoFocus />
          </div>

          {/* Password */}
          <div>
            <label style={lbl}>Password</label>
            <input className="si-input" type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" />
          </div>

          {/* Remember me + Forgot password */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 13, color: '#374151', cursor: 'pointer',
              userSelect: 'none',
            }}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                style={{ accentColor: '#7C6FE0', width: 15, height: 15, cursor: 'pointer' }}
              />
              Keep me signed in for 30 days
            </label>
            <a href="#" style={{ fontSize: 13, color: '#7C6FE0', textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}>
              Forgot password?
            </a>
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

          {/* Sign in button — outlined style */}
          <button type="submit" disabled={busy}
            className="si-btn-outline"
            style={{
              width: '100%', padding: '11px',
              borderRadius: 6, border: '1.5px solid #D1D5DB',
              background: '#fff', color: '#13111E',
              fontSize: 15, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontFamily: 'inherit', marginTop: 2,
            }}>
            {loading
              ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Signing in…</>
              : 'Sign in'}
          </button>
        </form>

        {/* OR divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0' }}>
          <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
          <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 500 }}>or</span>
          <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
        </div>

        {/* Google */}
        <button onClick={handleGoogle} disabled={busy} type="button"
          className="si-btn-outline"
          style={{
            width: '100%', padding: '11px',
            borderRadius: 6, border: '1.5px solid #D1D5DB',
            background: '#fff', fontSize: 14, fontWeight: 500,
            color: '#374151', cursor: busy ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            fontFamily: 'inherit',
          }}>
          {googleLoading
            ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Connecting…</>
            : <><GoogleMark /> Sign in with Google</>
          }
        </button>

        {/* Sign up link */}
        <p style={{ textAlign: 'center', fontSize: 13, color: '#6B7280', marginTop: 20 }}>
          No account yet?{' '}
          <a href="/register" style={{ color: '#7C6FE0', fontWeight: 600, textDecoration: 'none' }}>
            Sign up free
          </a>
        </p>

        {/* SSO banner */}
        <div style={{
          marginTop: 16,
          padding: '10px 14px', borderRadius: 8,
          background: '#F8F7FF', border: '1px solid #E8E4FF',
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 12, color: '#6B7280',
        }}>
          <Info size={14} color="#8B87AD" style={{ flexShrink: 0 }} />
          <span>
            SSO available for Enterprise plans.{' '}
            <a href="#" style={{ color: '#7C6FE0', fontWeight: 600, textDecoration: 'none' }}>
              Configure SSO →
            </a>
          </span>
        </div>

      </div>
    </div>
    <AppFooter />
    </div>
  )
}

const lbl: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 500,
  color: '#374151', marginBottom: 5,
}
