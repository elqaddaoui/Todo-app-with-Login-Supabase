import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { SignInPage, SignUpPage } from './AuthPages'
import { useAuthBootstrap, useAuthLoading, useIsAuthenticated } from './auth'

const loadAuthenticatedApp = () => import('./App')
const AuthenticatedApp = lazy(loadAuthenticatedApp)

function LoadingScreen() {
  return <div className='h-full flex items-center justify-center text-sm text-zinc-500'>Loading…</div>
}

/**
 * Lightweight startup boundary. Signed-out users never parse the large task,
 * calendar, animation, form, and drag-and-drop bundle. Once the auth screen is
 * interactive we preload that bundle during browser idle time, overlapping it
 * with the time the user spends entering credentials without delaying login UI.
 */
export default function Root() {
  useAuthBootstrap()
  const authLoading = useAuthLoading()
  const authenticated = useIsAuthenticated()

  useEffect(() => {
    if (authLoading || authenticated) return
    const preload = () => { void loadAuthenticatedApp() }
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(preload, { timeout: 2000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = globalThis.setTimeout(preload, 500)
    return () => globalThis.clearTimeout(id)
  }, [authLoading, authenticated])

  if (authLoading) return <LoadingScreen />

  if (authenticated) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <AuthenticatedApp />
      </Suspense>
    )
  }

  return (
    <Routes>
      <Route path='/signin' element={<SignInPage />} />
      <Route path='/signup' element={<SignUpPage />} />
      <Route path='*' element={<Navigate to='/signin' replace />} />
    </Routes>
  )
}
