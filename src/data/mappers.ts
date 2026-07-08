/* ============================================================
   Row <-> domain mappers.

   The database stores tasks in normalized tables (tasks + task_tags +
   task_checklist_items + task_comments + task_images + task_attachments +
   task_activity). The app works with a single nested `Task` object. These
   helpers translate between the two representations in both directions.
   ============================================================ */
import type {
  Task, Project, Tag, UserSettings,
  ChecklistItem, Comment, Attachment, Activity, TaskImage,
} from './types'

/* ---------- DB row shapes (only the columns we read/write) ---------- */
export type ProjectRow = {
  id: string; user_id: string; name: string; icon: string; color: string;
  favorite: boolean; parent_id: string | null; description: string | null;
  documentation: string; order: number; archived: boolean;
  created_at: string; updated_at: string
}
export type TagRow = {
  id: string; user_id: string; name: string; color: string;
  created_at: string; updated_at: string
}
export type TaskRow = {
  id: string; user_id: string; title: string; description: string | null;
  status: Task['status']; priority: Task['priority']; category: Task['category'];
  project_id: string | null; parent_id: string | null;
  due_date: string | null; start_date: string | null; time_of_day: string | null;
  estimated_minutes: number | null; favorite: boolean; archived: boolean;
  order: number; completed_at: string | null; created_at: string; updated_at: string
}
export type TaskTagRow = { task_id: string; tag_id: string; user_id: string }
export type ChecklistRow = {
  id: string; task_id: string; user_id: string; text: string; done: boolean;
  order: number; created_at: string; updated_at: string
}
export type CommentRow = {
  id: string; task_id: string; user_id: string; author_id: string | null;
  author_name: string; text: string; created_at: string; updated_at: string
}
export type ImageRow = {
  id: string; task_id: string; user_id: string; url: string; name: string | null;
  storage_path: string | null; order: number; created_at: string; updated_at: string
}
export type AttachmentRow = {
  id: string; task_id: string; user_id: string; name: string; size_bytes: number;
  storage_path: string | null; mime_type: string | null; created_at: string; updated_at: string
}
export type ActivityRow = {
  id: string; task_id: string; user_id: string; type: string; message: string;
  actor_id: string | null; actor_name: string; created_at: string
}
export type SettingsRow = {
  user_id: string; theme: 'light' | 'dark' | 'system';
  sidebar_width: number; details_width: number; compact_mode: boolean;
  dnd_enabled: boolean; calendar_side_panel: boolean;
  undo_toast_enabled: boolean; undo_toast_duration: number
  remember_last_task_options: boolean; show_project_descriptions: boolean
  multi_select_enabled: boolean; calendar_start_hour: number; calendar_end_hour: number
}

/* Normalize a DB `time` value ("14:00:00") to the app's "HH:mm". */
const trimTime = (t: string | null): string | undefined =>
  t ? t.slice(0, 5) : undefined

/* ---------------- DB -> domain ---------------- */
export function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id, name: r.name, icon: r.icon, color: r.color,
    favorite: r.favorite, parentId: r.parent_id ?? undefined,
    description: r.description ?? undefined, documentation: r.documentation,
    order: r.order,
  }
}

export function rowToTag(r: TagRow): Tag {
  return { id: r.id, name: r.name, color: r.color }
}

/* Assemble a nested Task from its base row plus its related child rows. */
export function assembleTask(
  base: TaskRow,
  tagIds: string[],
  checklist: ChecklistRow[],
  comments: CommentRow[],
  images: ImageRow[],
  attachments: AttachmentRow[],
  activity: ActivityRow[],
): Task {
  return {
    id: base.id,
    title: base.title,
    description: base.description ?? undefined,
    status: base.status,
    priority: base.priority,
    category: base.category,
    projectId: base.project_id ?? undefined,
    parentId: base.parent_id ?? undefined,
    tags: tagIds,
    dueDate: base.due_date ?? undefined,
    startDate: base.start_date ?? undefined,
    time: trimTime(base.time_of_day),
    estimatedMinutes: base.estimated_minutes ?? undefined,
    favorite: base.favorite,
    archived: base.archived,
    order: base.order,
    completedAt: base.completed_at ?? undefined,
    createdAt: base.created_at,
    updatedAt: base.updated_at,
    checklist: checklist
      .slice()
      .sort((a, b) => a.order - b.order)
      .map<ChecklistItem>(c => ({ id: c.id, text: c.text, done: c.done })),
    comments: comments
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map<Comment>(c => ({ id: c.id, author: c.author_name, text: c.text, createdAt: c.created_at })),
    images: images
      .slice()
      .sort((a, b) => a.order - b.order)
      .map<TaskImage>(i => ({ id: i.id, url: i.url, name: i.name ?? undefined })),
    attachments: attachments.map<Attachment>(a => ({ id: a.id, name: a.name, size: a.size_bytes })),
    activity: activity
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map<Activity>(a => ({ id: a.id, type: a.type, message: a.message, createdAt: a.created_at, by: a.actor_name })),
  }
}

export function rowToSettings(r: SettingsRow): UserSettings {
  return {
    theme: r.theme,
    sidebarW: r.sidebar_width,
    detailsW: r.details_width,
    compactMode: r.compact_mode,
    dndEnabled: r.dnd_enabled,
    calendarSidePanel: r.calendar_side_panel,
    undoToastEnabled: r.undo_toast_enabled,
    undoToastDuration: r.undo_toast_duration,
    rememberLastTaskOptions: r.remember_last_task_options ?? false,
    showProjectDescriptions: r.show_project_descriptions ?? false,
    multiSelectEnabled: r.multi_select_enabled ?? true,
    calendarStartHour: r.calendar_start_hour ?? 0,
    calendarEndHour: r.calendar_end_hour ?? 24,
  }
}

/* ---------------- domain -> DB (for writes) ---------------- */
const KNOWN_ACTIVITY_TYPES = new Set([
  'created', 'updated', 'completed', 'reopened', 'archived', 'unarchived',
  'moved', 'reparented', 'commented', 'status_changed', 'priority_changed',
  'due_changed', 'other',
])
const safeActivityType = (t: string) => (KNOWN_ACTIVITY_TYPES.has(t) ? t : 'other')

/* Base task columns (excludes child collections). */
export function projectToRow(p: Project, userId: string): ProjectRow {
  return {
    id: p.id, user_id: userId, name: p.name, icon: p.icon, color: p.color,
    favorite: p.favorite ?? false, parent_id: p.parentId ?? null,
    description: p.description ?? null, documentation: p.documentation ?? '',
    order: p.order ?? 0, archived: false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
}

export function tagToRow(t: Tag, userId: string): TagRow {
  return {
    id: t.id, user_id: userId, name: t.name, color: t.color,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
}

export function taskToBaseRow(t: Task, userId: string): TaskRow {
  return {
    id: t.id, user_id: userId, title: t.title, description: t.description ?? null,
    status: t.status, priority: t.priority, category: t.category,
    project_id: t.projectId ?? null, parent_id: t.parentId ?? null,
    due_date: t.dueDate ?? null, start_date: t.startDate ?? null,
    time_of_day: t.time ?? null,
    estimated_minutes: t.estimatedMinutes ?? null,
    favorite: t.favorite ?? false, archived: t.archived ?? false,
    order: t.order ?? 0, completed_at: t.completedAt ?? null,
    created_at: t.createdAt, updated_at: t.updatedAt,
  }
}

export function checklistToRows(t: Task, userId: string): ChecklistRow[] {
  return (t.checklist ?? []).map((c, i) => ({
    id: c.id, task_id: t.id, user_id: userId, text: c.text, done: c.done,
    order: i, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }))
}

export function commentsToRows(t: Task, userId: string): CommentRow[] {
  return (t.comments ?? []).map(c => ({
    id: c.id, task_id: t.id, user_id: userId, author_id: null,
    author_name: c.author, text: c.text, created_at: c.createdAt,
    updated_at: c.createdAt,
  }))
}

export function imagesToRows(t: Task, userId: string): ImageRow[] {
  return (t.images ?? []).map((im, i) => ({
    id: im.id, task_id: t.id, user_id: userId, url: im.url, name: im.name ?? null,
    storage_path: null, order: i, created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }))
}

export function attachmentsToRows(t: Task, userId: string): AttachmentRow[] {
  return (t.attachments ?? []).map(a => ({
    id: a.id, task_id: t.id, user_id: userId, name: a.name, size_bytes: a.size,
    storage_path: null, mime_type: null, created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }))
}

export function activityToRows(t: Task, userId: string): ActivityRow[] {
  return (t.activity ?? []).map(a => ({
    id: a.id, task_id: t.id, user_id: userId, type: safeActivityType(a.type),
    message: a.message, actor_id: null, actor_name: a.by, created_at: a.createdAt,
  }))
}

export function settingsToRow(s: Partial<UserSettings>, userId: string): Partial<SettingsRow> {
  const row: Partial<SettingsRow> = { user_id: userId }
  if (s.theme !== undefined) row.theme = s.theme
  if (s.sidebarW !== undefined) row.sidebar_width = s.sidebarW
  if (s.detailsW !== undefined) row.details_width = s.detailsW
  if (s.compactMode !== undefined) row.compact_mode = s.compactMode
  if (s.dndEnabled !== undefined) row.dnd_enabled = s.dndEnabled
  if (s.calendarSidePanel !== undefined) row.calendar_side_panel = s.calendarSidePanel
  if (s.undoToastEnabled !== undefined) row.undo_toast_enabled = s.undoToastEnabled
  if (s.undoToastDuration !== undefined) row.undo_toast_duration = s.undoToastDuration
  if (s.rememberLastTaskOptions !== undefined) row.remember_last_task_options = s.rememberLastTaskOptions
  if (s.showProjectDescriptions !== undefined) row.show_project_descriptions = s.showProjectDescriptions
  if (s.multiSelectEnabled !== undefined) row.multi_select_enabled = s.multiSelectEnabled
  if (s.calendarStartHour !== undefined) row.calendar_start_hour = s.calendarStartHour
  if (s.calendarEndHour !== undefined) row.calendar_end_hour = s.calendarEndHour
  return row
}
