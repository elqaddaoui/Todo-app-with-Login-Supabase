/* ============================================================
   Initial load: fetch the signed-in user's entire dataset from Supabase
   and assemble it into the app's nested Bootstrap shape.

   RLS guarantees each query only returns the current user's rows, so we
   never filter by user_id on the client — we just select everything.
   ============================================================ */
import { supabase } from '../supabaseClient'
import type { Bootstrap, UserSettings } from './types'
import {
  rowToProject, rowToTag, rowToSettings, assembleTask,
  type TaskRow, type TaskTagRow, type ChecklistRow, type CommentRow,
  type ImageRow, type AttachmentRow, type ActivityRow, type ProjectRow,
  type TagRow, type SettingsRow,
} from './mappers'

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const arr = m.get(k)
    if (arr) arr.push(r)
    else m.set(k, [r])
  }
  return m
}

/**
 * Load the full dataset for the authenticated user. Issues one query per
 * table (8 total) in parallel, then stitches child rows onto their tasks in
 * memory. This keeps the round-trips flat and fast even for large datasets.
 */
export async function loadBootstrap(): Promise<Bootstrap> {
  const [
    projectsRes, tagsRes, tasksRes, taskTagsRes,
    checklistRes, commentsRes, imagesRes, attachmentsRes, activityRes,
  ] = await Promise.all([
    supabase.from('projects').select('*').order('order', { ascending: true }),
    supabase.from('tags').select('*').order('created_at', { ascending: true }),
    supabase.from('tasks').select('*').order('order', { ascending: true }),
    supabase.from('task_tags').select('task_id, tag_id, user_id'),
    supabase.from('task_checklist_items').select('*'),
    supabase.from('task_comments').select('*'),
    supabase.from('task_images').select('*'),
    supabase.from('task_attachments').select('*'),
    supabase.from('task_activity').select('*'),
  ])

  const firstError =
    projectsRes.error || tagsRes.error || tasksRes.error || taskTagsRes.error ||
    checklistRes.error || commentsRes.error || imagesRes.error ||
    attachmentsRes.error || activityRes.error
  if (firstError) throw firstError

  const projects = (projectsRes.data as ProjectRow[]).map(rowToProject)
  const tags = (tagsRes.data as TagRow[]).map(rowToTag)

  const taskRows = tasksRes.data as TaskRow[]
  const tagsByTask = groupBy(taskTagsRes.data as TaskTagRow[], r => r.task_id)
  const checklistByTask = groupBy(checklistRes.data as ChecklistRow[], r => r.task_id)
  const commentsByTask = groupBy(commentsRes.data as CommentRow[], r => r.task_id)
  const imagesByTask = groupBy(imagesRes.data as ImageRow[], r => r.task_id)
  const attachmentsByTask = groupBy(attachmentsRes.data as AttachmentRow[], r => r.task_id)
  const activityByTask = groupBy(activityRes.data as ActivityRow[], r => r.task_id)

  const tasks = taskRows.map(base =>
    assembleTask(
      base,
      (tagsByTask.get(base.id) ?? []).map(r => r.tag_id),
      checklistByTask.get(base.id) ?? [],
      commentsByTask.get(base.id) ?? [],
      imagesByTask.get(base.id) ?? [],
      attachmentsByTask.get(base.id) ?? [],
      activityByTask.get(base.id) ?? [],
    ),
  )

  return { tasks, projects, tags }
}

/** Load per-user settings, or null if the row hasn't been provisioned yet. */
export async function loadSettings(): Promise<UserSettings | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return rowToSettings(data as SettingsRow)
}

/**
 * Atomically claim the one-time first-run seed for the current user.
 *
 * Returns `true` to EXACTLY ONE caller — the first one to flip the account's
 * `profiles.seeded_at` from NULL to now() (see migration 0002). Every later
 * call (a React Query refetch, a StrictMode double-effect, another tab, or
 * another device) returns `false`, so the client seeds demo content at most
 * once per account and can never duplicate an existing user's data.
 *
 * If the RPC is unavailable (e.g. the migration hasn't been applied yet), we
 * fall back to `false` — meaning "do NOT seed". Refusing to seed on error is
 * the safe default: it can never create duplicates, at worst a brand-new
 * account starts empty until the migration lands.
 */
export async function claimInitialSeed(): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_initial_seed')
  if (error) {
    console.error('[seed] claim_initial_seed RPC failed', error)
    return false
  }
  return data === true
}
