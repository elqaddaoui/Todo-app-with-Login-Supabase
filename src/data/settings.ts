/* ============================================================
   Persist per-user UI preferences to the `user_settings` table.

   Writes are debounced so rapid changes (e.g. dragging the sidebar
   resize handle, sliding the undo-toast duration) collapse into a single
   round-trip. `upsert` handles the case where the row hasn't been
   provisioned yet (defensive — the signup trigger normally creates it).
   ============================================================ */
import { supabase } from '../supabaseClient'
import type { UserSettings } from './types'
import { settingsToRow } from './mappers'
import { markWritten } from './echo'

let timer: ReturnType<typeof setTimeout> | null = null
let pending: Partial<UserSettings> = {}
let currentUserId: string | null = null

export function setSettingsUserId(userId: string | null) {
  currentUserId = userId
}

/** Queue a settings patch; flushes ~400ms after the last change. */
export function persistSettings(patch: Partial<UserSettings>) {
  if (!currentUserId) return
  pending = { ...pending, ...patch }
  if (timer) clearTimeout(timer)
  timer = setTimeout(flush, 400)
}

async function flush() {
  timer = null
  if (!currentUserId) return
  const patch = pending
  pending = {}
  if (Object.keys(patch).length === 0) return
  const row = settingsToRow(patch, currentUserId)
  // Suppress the inbound Realtime echo of our own settings write (the
  // user_settings PK is user_id) so it isn't re-applied to the local store.
  markWritten('user_settings', currentUserId)
  const { error } = await supabase
    .from('user_settings')
    .upsert(row, { onConflict: 'user_id' })
  if (error) console.error('[settings] persist failed', error)
}
