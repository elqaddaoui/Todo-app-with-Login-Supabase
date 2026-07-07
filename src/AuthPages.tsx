import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  Loader2, Mail, Lock, CheckCircle2, AlertCircle, Eye, EyeOff,
  CalendarDays, ListChecks, Sparkles, ShieldCheck,
} from 'lucide-react'
import { supabase } from './supabaseClient'
import { useIsAuthenticated } from './auth'

type Mode = 'signin' | 'signup'

/* ============================================================
   Brand / value panel shown on the left of the auth pages (desktop).
   Purely decorative — communicates what Orbit is while the form lives
   on the right. Hidden below 900px where the form takes the full width
   and a compact brand mark appears above the form instead.
   ============================================================ */
function AuthAside() {
  return (
    <aside className='auth-aside'>
      <div className='auth-brand'>
        <span className='auth-brand-badge'>O</span>
        <span className='leading-tight'>
          <span className='auth-brand-title block'>Orbit</span>
          <span className='auth-brand-sub'>Tasks &amp; Calendar</span>
        </span>
      </div>

      <div className='auth-hero'>
        <h2>Your day, in perfect orbit.</h2>
        <p>
          A calm command center for everything you have to do — tasks, projects
          and your calendar, beautifully in sync across every device.
        </p>
        <ul className='auth-feature-list'>
          <li className='auth-feature'>
            <span className='auth-feature-icon'><ListChecks className='h-4 w-4' /></span>
            Organize tasks, subtasks and projects effortlessly
          </li>
          <li className='auth-feature'>
            <span className='auth-feature-icon'><CalendarDays className='h-4 w-4' /></span>
            Plan with a drag-and-drop calendar
          </li>
          <li className='auth-feature'>
            <span className='auth-feature-icon'><Sparkles className='h-4 w-4' /></span>
            Premium, distraction-free experience
          </li>
        </ul>
      </div>

      <div className='auth-aside-foot'>
        Secured by Supabase Auth · Your data stays yours
      </div>
    </aside>
  )
}

/**
 * Shared authentication form used by both the Sign In and Sign Up pages.
 *
 * The Supabase auth flow (signUp / signInWithPassword + email-confirmation
 * handling + post-auth navigation) is intentionally UNCHANGED — only the
 * presentation is redesigned. Styling uses the new `.auth-*` design-system
 * classes (see index.css) so the pages match the rest of the app and look
 * premium in dark mode.
 */
function AuthForm({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const authenticated = useIsAuthenticated()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const isSignup = mode === 'signup'
  const title = isSignup ? 'Create your account' : 'Welcome back'
  const subtitle = isSignup
    ? 'Start organizing your day in minutes.'
    : 'Sign in to continue to Orbit.'
  const submitLabel = isSignup ? 'Create account' : 'Sign in'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    // Prevent duplicate submissions while a request is pending.
    if (loading) return
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) {
          setError(error.message)
          return
        }
        // When email confirmation is required, no session is returned yet.
        if (data.session) {
          navigate('/')
        } else {
          setNotice('Check your email to confirm your account, then sign in.')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          setError(error.message)
          return
        }
        navigate('/')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Already signed in? Never show the auth form — send them into the app.
  if (authenticated) return <Navigate to='/' replace />

  return (
    <div className='auth-shell'>
      <AuthAside />

      <main className='auth-main'>
        <div className='auth-card'>
          <div className='auth-card-head'>
            {/* Compact brand mark for small screens (the aside is hidden). */}
            <div className='auth-card-brand'>
              <span className='auth-brand-badge'>O</span>
              <span className='text-base font-bold tracking-tight'>Orbit</span>
            </div>
            <h1 className='auth-card-title'>{title}</h1>
            <p className='auth-card-sub'>{subtitle}</p>
          </div>

          <form onSubmit={onSubmit} className='space-y-4' noValidate>
            <div>
              <label htmlFor='email' className='field-label'>Email</label>
              <div className='auth-field'>
                <Mail className='auth-field-icon' />
                <input
                  id='email'
                  type='email'
                  autoComplete='email'
                  required
                  placeholder='you@example.com'
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            <div>
              <div className='auth-row-between'>
                <label htmlFor='password' className='field-label !mb-0'>Password</label>
                {!isSignup && (
                  <Link
                    to='/signup'
                    className='text-xs font-medium text-[hsl(var(--text-muted))] hover:text-[hsl(var(--focus))]'
                    tabIndex={-1}
                  >
                    New here?
                  </Link>
                )}
              </div>
              <div className='auth-field mt-1.5'>
                <Lock className='auth-field-icon' />
                <input
                  id='password'
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                  placeholder={isSignup ? 'At least 6 characters' : '••••••••'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
                <button
                  type='button'
                  className='auth-field-trailing'
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                </button>
              </div>
            </div>

            {error && (
              <div className='form-note is-error' role='alert'>
                <AlertCircle className='h-4 w-4' />
                <span>{error}</span>
              </div>
            )}

            {notice && (
              <div className='form-note is-success'>
                <CheckCircle2 className='h-4 w-4' />
                <span>{notice}</span>
              </div>
            )}

            <button
              type='submit'
              className='btn btn-primary auth-btn'
              disabled={loading}
            >
              {loading && <Loader2 className='h-4 w-4 animate-spin' />}
              {loading ? 'Please wait…' : submitLabel}
            </button>
          </form>

          <div className='auth-divider'>
            <ShieldCheck className='h-3.5 w-3.5' />
            <span>Protected by Supabase Auth</span>
          </div>

          <div className='auth-switch'>
            {isSignup ? (
              <>Already have an account? <Link to='/signin'>Sign in</Link></>
            ) : (
              <>Don&apos;t have an account? <Link to='/signup'>Create one</Link></>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

// Kept as a typed helper alias in case future variants need custom children.
export type AuthLayoutProps = { children?: ReactNode }

export function SignInPage() {
  return <AuthForm mode='signin' />
}

export function SignUpPage() {
  return <AuthForm mode='signup' />
}
