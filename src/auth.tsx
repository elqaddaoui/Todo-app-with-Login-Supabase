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
  /** True once the user's email address has been verified/confirmed. */
  emailConfirmed: boolean
  /** ISO timestamp the account was created, if known. */
  createdAt: string | null
  /** ISO timestamp of the most recent sign-in, if known. */
  lastSignInAt: string | null
  /** Primary auth provider label ('email', 'google', …) for display. */
  provider: string
  /** True when the account signs in with a password (vs. OAuth only). */
  hasPassword: boolean
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

  // Identity/provider info. Supabase exposes the linked identities on the user
  // object; the app_metadata.provider is the primary sign-in method.
  const appMeta = (user?.app_metadata ?? {}) as Record<string, unknown>
  const identities = Array.isArray(user?.identities) ? user!.identities! : []
  const providers = identities
    .map((i) => (i && typeof i.provider === 'string' ? i.provider : ''))
    .filter(Boolean)
  const provider =
    (typeof appMeta.provider === 'string' && appMeta.provider) ||
    providers[0] ||
    'email'
  const hasPassword = providers.includes('email') || provider === 'email'

  return {
    id: user?.id ?? null,
    email,
    displayName,
    avatarUrl,
    initials: initialsFrom(metaName || email || displayName),
    emailConfirmed: Boolean(user?.email_confirmed_at ?? user?.confirmed_at),
    createdAt: user?.created_at ?? null,
    lastSignInAt: user?.last_sign_in_at ?? null,
    provider,
    hasPassword,
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

/* ============================================================
   Account mutations (Supabase Auth)
   ------------------------------------------------------------
   Thin, typed wrappers over the Supabase Auth API used by the Account
   Settings page. Each returns a normalized `{ error }` result so the UI can
   render inline feedback without importing Supabase error types.

   `updateProfile` writes identity fields to `user_metadata` (the canonical,
   session-embedded location the rest of the app reads via `profileFromSession`)
   AND mirrors the display name into the `profiles` row, which is what stamps
   the author label on comments/activity. Keeping both in sync means a rename
   is reflected everywhere immediately after `onAuthStateChange` fires.
   ============================================================ */
export type MutationResult = { error: string | null }

const toResult = (error: { message: string } | null): MutationResult => ({
  error: error ? error.message : null,
})

/** Update the signed-in user's display name and/or avatar URL. */
export async function updateProfile(input: {
  displayName?: string
  avatarUrl?: string | null
}): Promise<MutationResult> {
  const data: Record<string, unknown> = {}
  if (input.displayName !== undefined) {
    const name = input.displayName.trim()
    data.display_name = name
    data.full_name = name
    data.name = name
  }
  if (input.avatarUrl !== undefined) {
    data.avatar_url = input.avatarUrl || null
  }

  const { data: updated, error } = await supabase.auth.updateUser({ data })
  if (error) return toResult(error)

  // Mirror the display name into the profiles table so historical author
  // labels resolve to the new name. Best-effort: never block the UI on it.
  const userId = updated.user?.id
  if (userId && input.displayName !== undefined) {
    await supabase
      .from('profiles')
      .update({ display_name: input.displayName.trim() || 'You' })
      .eq('id', userId)
  }
  return { error: null }
}

/**
 * Change the account password. When `currentPassword` is provided we first
 * re-authenticate to verify the user actually knows it (Supabase's updateUser
 * does not require the old password, so we enforce it here for good UX/safety).
 */
export async function updatePassword(input: {
  newPassword: string
  currentPassword?: string
  email?: string
}): Promise<MutationResult> {
  if (input.currentPassword && input.email) {
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.currentPassword,
    })
    if (reauthError) return { error: 'Current password is incorrect.' }
  }
  const { error } = await supabase.auth.updateUser({ password: input.newPassword })
  return toResult(error)
}

/**
 * Change the account email. Supabase sends a confirmation link to the NEW
 * address (and, when "Secure email change" is on, the old one too); the change
 * only takes effect once confirmed, so the UI should tell the user to check
 * their inbox.
 */
export async function updateEmail(newEmail: string): Promise<MutationResult> {
  const { error } = await supabase.auth.updateUser(
    { email: newEmail.trim() },
    { emailRedirectTo: `${window.location.origin}/account` },
  )
  return toResult(error)
}

/** Send a password-reset email (used when the user has no current password). */
export async function sendPasswordReset(email: string): Promise<MutationResult> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/account`,
  })
  return toResult(error)
}
