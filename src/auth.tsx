import { useEffect } from 'react'
import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'

/**
 * Central authentication store.
 *
 * Mirrors the app's existing Zustand pattern (see `useUI` / `useData` in
 * App.tsx) so there is a single source of truth for the Supabase session
 * rather than parallel auth logic scattered across components.
 *
 * - `loading` is true until the very first `getSession()` call resolves. The
 *   app shows its normal boot screen while this is true so we never flash the
 *   sign-in page for an already-authenticated user on refresh.
 * - `session` is kept in sync with Supabase via `onAuthStateChange`, which
 *   fires on sign-in, sign-out, token refresh and cross-tab changes, so the UI
 *   reacts automatically to every auth state change.
 *
 * Supabase's JS client persists the session in localStorage by default and
 * auto-refreshes tokens, so the session survives browser refreshes for free.
 */
type AuthState = {
  session: Session | null
  loading: boolean
  set: (partial: Partial<AuthState>) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  loading: true,
  set: (partial) => set(partial),
}))

/**
 * Bootstraps the auth store. Must be mounted exactly once, high in the tree
 * (alongside the app's other bootstrap logic). Reads the current session, then
 * subscribes to future auth-state changes and tears the subscription down on
 * unmount.
 */
export function useAuthBootstrap() {
  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      useAuthStore.getState().set({ session: data.session, loading: false })
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      useAuthStore.getState().set({ session, loading: false })
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])
}

/** Convenience selectors so components don't reach into the store shape. */
export const useSession = () => useAuthStore((s) => s.session)
export const useAuthLoading = () => useAuthStore((s) => s.loading)
export const useIsAuthenticated = () => useAuthStore((s) => s.session != null)

/** Signs the current user out. Auth state updates flow through the subscription. */
export async function signOut() {
  await supabase.auth.signOut()
}
