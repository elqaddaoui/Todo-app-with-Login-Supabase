import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  Loader2, Mail, Lock, User, Eye, EyeOff, CheckCircle2, AlertCircle,
  ListChecks, CalendarDays, Sparkles, ShieldCheck,
} from 'lucide-react'
import { supabase } from './supabaseClient'
import { useIsAuthenticated } from './auth'

type Mode = 'signin' | 'signup'

/* ============================================================
   Auth pages
   ------------------------------------------------------------
   A clean, modern two-pane layout: a branded marketing panel on the left
   (hidden on small screens) and the form on the right. Styling reuses the
   app's existing design system (HSL CSS variables, `.panel`, `.input`,
   `.btn`, `.btn-primary`) so the pages stay in the same visual language,
   just more polished and fully responsive.

   Sign-up captures a display name and stores it in `user_metadata` via
   `options.data` — the Supabase-recommended way to seed profile fields at
   registration so the app can render the user's name/avatar without an extra
   profiles table.
   ============================================================ */

const FEATURES = [
  { icon: ListChecks, title: 'Organize everything', desc: 'Tasks, subtasks, projects and tags in one calm workspace.' },
  { icon: CalendarDays, title: 'Plan your time', desc: 'A drag-and-drop calendar that keeps today in focus.' },
  { icon: ShieldCheck, title: 'Private & synced', desc: 'Your data is secured per account and synced across devices.' },
]

function BrandPanel({ isSignup }: { isSignup: boolean }) {
  return (
    <div className='relative hidden lg:flex flex-col justify-between overflow-hidden p-10 xl:p-12 text-white'>
      {/* Gradient backdrop */}
      <div
        aria-hidden
        className='absolute inset-0 -z-10'
        style={{
          background:
            'radial-gradient(1200px 600px at 20% -10%, rgba(99,102,241,.55), transparent 60%),' +
            'radial-gradient(900px 500px at 90% 110%, rgba(14,165,233,.45), transparent 55%),' +
            'linear-gradient(135deg, #1e1b4b 0%, #0f172a 55%, #020617 100%)',
        }}
      />
      <div
        aria-hidden
        className='absolute inset-0 -z-10 opacity-[0.06]'
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      <div className='flex items-center gap-3'>
        <div className='h-10 w-10 rounded-2xl bg-white text-slate-900 flex items-center justify-center font-black text-lg shadow-lg'>O</div>
        <div>
          <div className='text-base font-semibold tracking-tight'>Orbit</div>
          <div className='text-xs text-white/60'>Tasks &amp; Calendar</div>
        </div>
      </div>

      <div className='max-w-md'>
        <div className='inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 ring-1 ring-white/15 backdrop-blur'>
          <Sparkles className='h-3.5 w-3.5' />
          {isSignup ? 'Start free — no credit card' : 'Welcome back to your workspace'}
        </div>
        <h2 className='mt-5 text-3xl xl:text-4xl font-bold leading-tight tracking-tight'>
          Your calm command center for getting things done.
        </h2>
        <p className='mt-3 text-sm xl:text-base text-white/70 leading-relaxed'>
          Capture tasks, plan your week, and keep every project on track — beautifully simple, fast, and always in sync.
        </p>

        <ul className='mt-8 space-y-4'>
          {FEATURES.map((f) => (
            <li key={f.title} className='flex items-start gap-3'>
              <span className='mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15'>
                <f.icon className='h-4 w-4' />
              </span>
              <div>
                <div className='text-sm font-semibold'>{f.title}</div>
                <div className='text-xs text-white/60'>{f.desc}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className='text-xs text-white/45'>© {new Date().getFullYear()} Orbit. Crafted for focus.</div>
    </div>
  )
}

function AuthForm({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const authenticated = useIsAuthenticated()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const isSignup = mode === 'signup'
  const title = isSignup ? 'Create your account' : 'Welcome back'
  const subtitle = isSignup
    ? 'Sign up to start organizing your day.'
    : 'Sign in to continue to Orbit.'
  const submitLabel = isSignup ? 'Create account' : 'Sign in'

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      if (isSignup) {
        const trimmedName = name.trim()
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            // Seed profile fields into user_metadata — the Supabase-recommended
            // place for lightweight identity data available on every session.
            data: trimmedName ? { display_name: trimmedName, full_name: trimmedName } : undefined,
          },
        })
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
    <div className='min-h-full w-full bg-[hsl(var(--background))] text-[hsl(var(--foreground))]'>
      <div className='grid min-h-screen lg:grid-cols-2'>
        <BrandPanel isSignup={isSignup} />

        <div className='flex items-center justify-center p-5 sm:p-8'>
          <div className='w-full max-w-md'>
            {/* Compact brand — shown only when the marketing panel is hidden */}
            <div className='mb-8 flex items-center gap-3 lg:hidden'>
              <div className='h-10 w-10 rounded-2xl bg-black text-white dark:bg-white dark:text-black flex items-center justify-center font-black text-lg'>O</div>
              <div>
                <div className='text-sm font-semibold tracking-tight'>Orbit</div>
                <div className='text-[11px] text-zinc-500'>Tasks &amp; Calendar</div>
              </div>
            </div>

            <div className='mb-7'>
              <h1 className='text-2xl font-bold tracking-tight'>{title}</h1>
              <p className='mt-1.5 text-sm text-zinc-500'>{subtitle}</p>
            </div>

            <form onSubmit={onSubmit} className='space-y-4' noValidate>
              {isSignup && (
                <div className='space-y-1.5'>
                  <label htmlFor='name' className='text-xs font-medium text-zinc-500'>Full name</label>
                  <div className='relative'>
                    <User className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400' />
                    <input
                      id='name'
                      type='text'
                      autoComplete='name'
                      className='input pl-9'
                      placeholder='Ada Lovelace'
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                </div>
              )}

              <div className='space-y-1.5'>
                <label htmlFor='email' className='text-xs font-medium text-zinc-500'>Email</label>
                <div className='relative'>
                  <Mail className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400' />
                  <input
                    id='email'
                    type='email'
                    autoComplete='email'
                    required
                    className='input pl-9'
                    placeholder='you@example.com'
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className='space-y-1.5'>
                <div className='flex items-center justify-between'>
                  <label htmlFor='password' className='text-xs font-medium text-zinc-500'>Password</label>
                  {isSignup && <span className='text-[11px] text-zinc-400'>At least 6 characters</span>}
                </div>
                <div className='relative'>
                  <Lock className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400' />
                  <input
                    id='password'
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    required
                    minLength={6}
                    className='input pl-9 pr-10'
                    placeholder='••••••••'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                  <button
                    type='button'
                    onClick={() => setShowPassword((v) => !v)}
                    className='absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-zinc-400 transition hover:bg-[hsl(var(--muted))] hover:text-zinc-600 dark:hover:text-zinc-300'
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                  </button>
                </div>
              </div>

              {error && (
                <div className='flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-600 dark:text-red-400'>
                  <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' />
                  <span>{error}</span>
                </div>
              )}

              {notice && (
                <div className='flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-600 dark:text-emerald-400'>
                  <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0' />
                  <span>{notice}</span>
                </div>
              )}

              <button
                type='submit'
                className='btn btn-primary h-11 w-full justify-center text-sm'
                disabled={loading}
              >
                {loading && <Loader2 className='h-4 w-4 animate-spin' />}
                {loading ? 'Please wait…' : submitLabel}
              </button>
            </form>

            <div className='mt-6 text-center text-sm text-zinc-500'>
              {isSignup ? (
                <>
                  Already have an account?{' '}
                  <Link to='/signin' className='font-semibold text-[hsl(var(--foreground))] underline-offset-4 hover:underline'>
                    Sign in
                  </Link>
                </>
              ) : (
                <>
                  Don&apos;t have an account?{' '}
                  <Link to='/signup' className='font-semibold text-[hsl(var(--foreground))] underline-offset-4 hover:underline'>
                    Sign up
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SignInPage() {
  return <AuthForm mode='signin' />
}

export function SignUpPage() {
  return <AuthForm mode='signup' />
}
