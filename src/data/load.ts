/* ============================================================
   Initial load: fetch the signed-in user's entire dataset from Supabase
   and assemble it into the app's nested Bootstrap shape.

   RLS guarantees each query only returns the current user's rows, so we
   never filter by user_id on the client — we just select everything.
   ============================================================ */
import { supabase } from '../supabaseClient'
import type { Bootstrap, TaskDetails, UserSettings } from './types'
import {
  rowToProject, rowToTag, rowToSettings, assembleTask,
  type TaskRow, type TaskTagRow, type ChecklistRow, type CommentRow,
  type ImageRow, type AttachmentRow, type ActivityRow, type ProjectRow,
  type TagRow, type SettingsRow,
} from './mappers'

const PROJECT_COLUMNS = 'id,user_id,name,icon,color,favorite,parent_id,description,documentation,order,archived,created_at,updated_at'
const TAG_COLUMNS = 'id,user_id,name,color,created_at,updated_at'
const TASK_COLUMNS = 'id,user_id,title,description,status,priority,category,project_id,parent_id,due_date,start_date,time_of_day,estimated_minutes,favorite,archived,order,completed_at,created_at,updated_at'
const SETTINGS_COLUMNS = 'user_id,theme,sidebar_width,details_width,compact_mode,dnd_enabled,calendar_side_panel,undo_toast_enabled,undo_toast_duration,remember_last_task_options,show_project_descriptions,multi_select_enabled,calendar_start_hour,calendar_end_hour'

/**
 * Load only the rows required to render the application shell and task lists.
 * Child collections are intentionally excluded: fetching them used to account
 * for six of the nine blocking startup requests, including potentially large
 * activity and base64-image payloads that no initial screen renders.
 */
export async function loadBootstrap(): Promise<Bootstrap> {
  const [projectsRes, tagsRes, tasksRes] = await Promise.all([
    supabase.from('projects').select(PROJECT_COLUMNS).order('order', { ascending: true }),
    supabase.from('tags').select(TAG_COLUMNS).order('created_at', { ascending: true }),
    supabase.from('tasks').select(TASK_COLUMNS).order('order', { ascending: true }),
  ])

  const firstError = projectsRes.error || tagsRes.error || tasksRes.error
  if (firstError) throw firstError

  return {
    projects: (projectsRes.data as unknown as ProjectRow[]).map(rowToProject),
    tags: (tagsRes.data as unknown as TagRow[]).map(rowToTag),
    tasks: (tasksRes.data as unknown as TaskRow[]).map(base =>
      assembleTask(base, [], [], [], [], [], []),
    ),
  }
}

/**
 * Load normalized task child collections after first paint. The result only
 * contains detail fields, allowing callers to merge it into the latest scalar
 * task state without clobbering an optimistic edit made during the request.
 */
export async function loadTaskDetails(taskIds: string[]): Promise<TaskDetails[]> {
  // A brand-new/empty workspace needs no detail requests at all.
  if (taskIds.length === 0) return []

  // PostgREST embeds all six relationships in one response. This preserves the
  // normalized schema while replacing six HTTP round-trips with one.
  const { data, error } = await supabase.from('tasks').select(`
    id,
    task_tags(tag_id),
    task_checklist_items(id,text,done,order,created_at,updated_at),
    task_comments(id,author_id,author_name,text,created_at,updated_at),
    task_images(id,url,name,storage_path,order,created_at,updated_at),
    task_attachments(id,name,size_bytes,storage_path,mime_type,created_at,updated_at),
    task_activity(id,type,message,actor_id,actor_name,created_at)
  `)
  if (error) throw error

  type DetailRow = {
    id: string
    task_tags: Pick<TaskTagRow, 'tag_id'>[]
    task_checklist_items: Omit<ChecklistRow, 'task_id' | 'user_id'>[]
    task_comments: Omit<CommentRow, 'task_id' | 'user_id'>[]
    task_images: Omit<ImageRow, 'task_id' | 'user_id'>[]
    task_attachments: Omit<AttachmentRow, 'task_id' | 'user_id'>[]
    task_activity: Omit<ActivityRow, 'task_id' | 'user_id'>[]
  }
  const byId = new Map((data as unknown as DetailRow[]).map(row => [row.id, row]))

  return taskIds.map(id => {
    const row = byId.get(id)
    return {
      id,
      tags: (row?.task_tags ?? []).map(tag => tag.tag_id),
      checklist: (row?.task_checklist_items ?? [])
        .slice().sort((a, b) => a.order - b.order)
        .map(item => ({ id: item.id, text: item.text, done: item.done })),
      comments: (row?.task_comments ?? [])
        .slice().sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(comment => ({ id: comment.id, author: comment.author_name, text: comment.text, createdAt: comment.created_at })),
      images: (row?.task_images ?? [])
        .slice().sort((a, b) => a.order - b.order)
        .map(image => ({ id: image.id, url: image.url, name: image.name ?? undefined })),
      attachments: (row?.task_attachments ?? [])
        .map(attachment => ({ id: attachment.id, name: attachment.name, size: attachment.size_bytes })),
      activity: (row?.task_activity ?? [])
        .slice().sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(item => ({ id: item.id, type: item.type, message: item.message, createdAt: item.created_at, by: item.actor_name })),
    }
  })
}

/** Load per-user settings, or null if the row hasn't been provisioned yet. */
export async function loadSettings(): Promise<UserSettings | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select(SETTINGS_COLUMNS)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return rowToSettings(data as unknown as SettingsRow)
}
