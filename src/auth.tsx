import { useEffect } from 'react'
import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import { useMemo } from 'react'

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

/* ============================================================
   Derived user profile
   ------------------------------------------------------------
   A single, memoized view of the identity fields the UI needs — derived
   purely from the Supabase `Session` so it stays in perfect sync with the
   auth store (no extra network round-trips). Display name / avatar are read
   from `user_metadata`, which is where `updateProfile` writes them, so a
   rename is reflected everywhere the instant `onAuthStateChange` fires.
   ============================================================ */
export type UserProfile = {
  /** Supabase auth user id (null while signed out). */
  id: string | null
  /** Primary email address, or empty string when unknown. */
  email: string
  /** Best available human-friendly name (metadata name, else email local-part). */
  displayName: string
  /** Optional avatar image URL from metadata (avatar_url / picture). */
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
export function initialsFrom(source: string): string {
  const cleaned = source.trim()
  if (!cleaned) return 'U'
  // Prefer the part before "@" for emails so "jane.doe@x.com" → "JD".
  const base = cleaned.includes('@') ? cleaned.split('@')[0] : cleaned
  const parts = base.split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return base.slice(0, 1).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Build a `UserProfile` from a Supabase session (pure; safe with null). */
export function profileFromSession(session: Session | null): UserProfile {
  const user = session?.user
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>
  const email = user?.email ?? ''

  const metaName =
    (typeof meta.display_name === 'string' && meta.display_name) ||
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    ''
  const displayName = metaName || (email ? email.split('@')[0] : 'You')

  const avatarUrl =
    (typeof meta.avatar_url === 'string' && meta.avatar_url) ||
    (typeof meta.picture === 'string' && meta.picture) ||
    null

  // Identity/provider info. Supabase exposes the linked identities on the user
  // object; app_metadata.provider is the primary sign-in method.
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
    emailConfirmed: Boolean(user?.email_confirmed_at ?? (user as { confirmed_at?: string } | undefined)?.confirmed_at),
    createdAt: user?.created_at ?? null,
    lastSignInAt: user?.last_sign_in_at ?? null,
    provider,
    hasPassword,
  }
}

/** React hook: the derived profile for the current session (memoized). */
export function useProfile(): UserProfile {
  const session = useSession()
  return useMemo(() => profileFromSession(session), [session])
}

/** Non-hook accessor for the current profile (e.g. inside event handlers). */
export function getProfile(): UserProfile {
  return profileFromSession(useAuthStore.getState().session)
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
