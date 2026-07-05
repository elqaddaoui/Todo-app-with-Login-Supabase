import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Loader2, Mail, Lock, CheckCircle2 } from 'lucide-react'
import { supabase } from './supabaseClient'
import { useIsAuthenticated } from './auth'

type Mode = 'signin' | 'signup'

/**
 * Shared authentication form used by both the Sign In and Sign Up pages.
 * Styling reuses the existing design system (`.panel`, `.input`, `.btn`,
 * `.btn-primary`) and HSL CSS variables so the pages match the rest of the app.
 */
function AuthForm({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const authenticated = useIsAuthenticated()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const isSignup = mode === 'signup'
  const title = isSignup ? 'Create your account' : 'Welcome back'
  const subtitle = isSignup
    ? 'Sign up to start organizing your day.'
    : 'Sign in to continue to Orbit.'
  const submitLabel = isSignup ? 'Sign up' : 'Sign in'

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
    <div className='h-full w-full flex items-center justify-center p-4 bg-[hsl(var(--background))] text-[hsl(var(--foreground))]'>
      <div className='panel w-full max-w-md p-6 sm:p-8'>
        <div className='mb-6 text-center'>
          <h1 className='text-xl font-bold tracking-tight'>{title}</h1>
          <p className='mt-1 text-sm text-zinc-500'>{subtitle}</p>
        </div>

        <form onSubmit={onSubmit} className='space-y-4' noValidate>
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
            <label htmlFor='password' className='text-xs font-medium text-zinc-500'>Password</label>
            <div className='relative'>
              <Lock className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400' />
              <input
                id='password'
                type='password'
                autoComplete={isSignup ? 'new-password' : 'current-password'}
                required
                minLength={6}
                className='input pl-9'
                placeholder='••••••••'
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {error && (
            <div className='rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400'>
              {error}
            </div>
          )}

          {notice && (
            <div className='flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400'>
              <CheckCircle2 className='mt-0.5 h-4 w-4 shrink-0' />
              <span>{notice}</span>
            </div>
          )}

          <button
            type='submit'
            className='btn btn-primary w-full justify-center'
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
              <Link to='/signin' className='font-medium text-[hsl(var(--foreground))] underline-offset-4 hover:underline'>
                Sign in
              </Link>
            </>
          ) : (
            <>
              Don&apos;t have an account?{' '}
              <Link to='/signup' className='font-medium text-[hsl(var(--foreground))] underline-offset-4 hover:underline'>
                Sign up
              </Link>
            </>
          )}
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
