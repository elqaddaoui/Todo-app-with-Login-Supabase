import { useEffect, useMemo } from 'react'
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

/* ============================================================
   User profile
   ------------------------------------------------------------
   Supabase surfaces user data on `session.user`. Following Supabase Auth
   best practices we read identity fields from `user.user_metadata` (populated
   at sign-up via `options.data`, or by OAuth providers) with sensible
   fallbacks, rather than persisting a duplicate profile row we then have to
   keep in sync. The essentials — display name, email and an avatar/initials —
   are all derivable from the session alone.
   ============================================================ */
export type UserProfile = {
  id: string | null
  email: string
  /** Best available human-friendly name (metadata → email local-part → 'You'). */
  displayName: string
  /** Avatar image URL if the provider/metadata supplied one, else null. */
  avatarUrl: string | null
  /** 1–2 uppercase letters derived from the display name for fallback avatars. */
  initials: string
}

/** Derive initials (max 2 chars) from a name or email-like string. */
export function initialsFrom(nameOrEmail: string): string {
  const s = (nameOrEmail || '').trim()
  if (!s) return 'U'
  // Prefer word-based initials for real names ("Ada Lovelace" → "AL").
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return (words[0][0] + words[words.length - 1][0]).toUpperCase()
  }
  // Single token (or an email): take the leading alphanumerics.
  const base = s.includes('@') ? s.split('@')[0] : s
  const letters = base.replace(/[^a-zA-Z0-9]/g, '')
  return (letters.slice(0, 2) || base.slice(0, 2) || 'U').toUpperCase()
}

/**
 * Build a normalized profile object from a Supabase session. Kept pure so it
 * can be unit-tested and reused outside of React (e.g. when stamping the
 * comment author on the data layer).
 */
export function profileFromSession(session: Session | null): UserProfile {
  const user = session?.user ?? null
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const email = (user?.email ?? (typeof meta.email === 'string' ? meta.email : '')) || ''

  const metaName =
    (typeof meta.display_name === 'string' && meta.display_name) ||
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    ''
  const emailLocal = email ? email.split('@')[0] : ''
  const displayName = (metaName || emailLocal || 'You').trim()

  const avatarUrl =
    (typeof meta.avatar_url === 'string' && meta.avatar_url) ||
    (typeof meta.picture === 'string' && meta.picture) ||
    null

  return {
    id: user?.id ?? null,
    email,
    displayName,
    avatarUrl,
    initials: initialsFrom(metaName || email || displayName),
  }
}

/** React hook exposing the current user's profile, recomputed when the session changes. */
export function useProfile(): UserProfile {
  // Select the raw session (a stable reference between changes) and derive the
  // profile via useMemo, so we don't return a fresh object on every render
  // (which would trip React's cached-snapshot check / cause extra renders).
  const session = useAuthStore((s) => s.session)
  return useMemo(() => profileFromSession(session), [session])
}

/** Non-reactive accessor for the current profile (for use outside React render). */
export function getProfile(): UserProfile {
  return profileFromSession(useAuthStore.getState().session)
}

/** Signs the current user out. Auth state updates flow through the subscription. */
export async function signOut() {
  await supabase.auth.signOut()
}
