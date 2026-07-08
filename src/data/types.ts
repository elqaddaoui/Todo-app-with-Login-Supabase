/* ============================================================
   Shared domain types for the Supabase data layer.

   These mirror the app's in-memory types used across App.tsx. They are
   defined here (instead of imported from App.tsx) to avoid a circular
   dependency: App.tsx imports the data layer, not the other way around.
   The shapes MUST stay in sync with the `Task` / `Project` / `Tag` types
   declared in App.tsx.
   ============================================================ */

export type Status =
  | 'not_started' | 'planned' | 'in_progress' | 'waiting' | 'blocked' | 'done' | 'cancelled'
export type Priority = 'low' | 'medium' | 'high' | 'urgent'
export type Category =
  | 'work' | 'personal' | 'errands' | 'health' | 'learning' | 'finance' | 'social' | 'other'

export type Tag = { id: string; name: string; color: string }

export type Project = {
  id: string; name: string; icon: string; color: string; favorite?: boolean;
  parentId?: string; documentation: string; description?: string; order: number
}

export type TaskImage = { id: string; url: string; name?: string }
export type ChecklistItem = { id: string; text: string; done: boolean }
export type Comment = { id: string; author: string; text: string; createdAt: string }
export type Attachment = { id: string; name: string; size: number }
export type Activity = { id: string; type: string; message: string; createdAt: string; by: string }

export type Task = {
  id: string; title: string; description?: string; status: Status; priority: Priority; category: Category;
  projectId?: string; parentId?: string; tags: string[]; dueDate?: string; startDate?: string; time?: string;
  estimatedMinutes?: number; favorite?: boolean;
  checklist: ChecklistItem[];
  comments: Comment[];
  images?: TaskImage[];
  attachments: Attachment[];
  activity: Activity[];
  archived?: boolean; createdAt: string; updatedAt: string; completedAt?: string; order: number
}

export type Bootstrap = { tasks: Task[]; projects: Project[]; tags: Tag[] }

/* Per-user preferences that live in the `user_settings` table. Mirrors the
   persisted slice of the `useUI` store. */
export type UserSettings = {
  theme: 'light' | 'dark' | 'system'
  sidebarW: number
  detailsW: number
  compactMode: boolean
  dndEnabled: boolean
  calendarSidePanel: boolean
  undoToastEnabled: boolean
  undoToastDuration: number
  /** When true, new tasks reuse the last selected creation options. */
  rememberLastTaskOptions: boolean
  /** When true, project cards show the project description. */
  showProjectDescriptions: boolean
  /** Master switch for Multi-Select mode (hover checkbox, long-press, shortcuts). */
  multiSelectEnabled: boolean
  /** First visible hour (0-23) in the Day/Week calendar views. */
  calendarStartHour: number
  /** Last visible hour (1-24) in the Day/Week calendar views. */
  calendarEndHour: number
}
