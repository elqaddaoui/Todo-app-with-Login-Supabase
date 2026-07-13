/* ============================================================
   Inbound Realtime sync engine.

   This is the mirror image of the outbound diff-based sync in sync.ts.
   Where sync.ts pushes local optimistic edits UP to Supabase, this module
   streams remote changes DOWN into the same Zustand store so that a change
   made in ANY session (another tab, another device) appears live in every
   other active session of the same user — no refresh required.

   Design goals (and how they're met)
   ----------------------------------
   • Reuse the existing architecture: we subscribe to Postgres changes on the
     SAME tables the outbound layer writes and feed them into the SAME store
     via small, purpose-built apply callbacks. No parallel data model, no
     duplicate fetching logic (we reuse loadBootstrap / the mappers).

   • Update only affected data: every event carries a single changed row. For
     top-level entities (projects / tags / settings) we apply that one row.
     For tasks — whose nested child collections live across several tables — a
     change to task X (or any of its children) marks ONLY X dirty; a debounced
     pass re-reads just those task rows + their children and patches only those
     tasks in the store. No full reload on steady-state edits.

   • No duplicate events / loops / conflicts: our own writes are fingerprinted
     by the outbound layer (see echo.ts) and dropped here, so a local edit is
     never echoed back on top of itself. Applies go through store helpers that
     do NOT re-trigger the outbound sync (they update the baseline snapshot in
     lockstep — see App.tsx), breaking any feedback loop.

   • Optimistic UI preserved: local edits still mutate the store instantly via
     the existing actions. Remote applies only touch rows the local user isn't
     the origin of.

   • Auto-reconnect + resync: Supabase's socket auto-reconnects; on each
     (re)subscribe we run a full, diff-based resync against loadBootstrap so any
     events missed while offline are reconciled — again touching only the rows
     that actually differ.
   ============================================================ */
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../supabaseClient'
import { loadBootstrap, loadSettings, loadTaskDetails } from './load'
import { assembleTask, rowToProject, rowToSettings, rowToTag } from './mappers'
import type {
  ProjectRow, TagRow, TaskRow, TaskTagRow, ChecklistRow, CommentRow,
  ImageRow, AttachmentRow, ActivityRow,
} from './mappers'
import type { Bootstrap, Project, Tag, Task, TaskDetails, UserSettings } from './types'
import { isEcho } from './echo'

/* ---- Store bridge --------------------------------------------------------
   The store lives in App.tsx. Rather than import it here (which would create
   a cycle: App -> data/* -> App), App.tsx registers a small set of callbacks
   that let this engine apply remote changes and read what it needs. Every
   apply helper is expected to update the store AND the outbound sync baseline
   together so applied remote rows are never mistaken for local edits. */
export type RealtimeBridge = {
  /** Upsert/patch specific fully assembled tasks by id. */
  applyTasks: (tasks: Task[]) => void
  /** Apply scalar task rows while preserving already-loaded child collections. */
  applyTaskBases: (tasks: Task[]) => void
  /** Replace child collections after a deferred/reconnect detail load. */
  applyTaskDetails: (details: TaskDetails[]) => void
  /** Remove tasks by id (already gone from DB). */
  removeTasks: (ids: string[]) => void
  /** Upsert a single project. */
  applyProject: (p: Project) => void
  removeProject: (id: string) => void
  /** Upsert a single tag. */
  applyTag: (t: Tag) => void
  removeTag: (id: string) => void
  /** Apply loaded user settings (theme, widths, …) to the UI store. */
  applySettings: (s: UserSettings) => void
  /** Reconcile the whole dataset after a (re)connect (diff-based). */
  reconcileAll: (b: Bootstrap) => void
}

let bridge: RealtimeBridge | null = null
export function setRealtimeBridge(b: RealtimeBridge | null) { bridge = b }

/* ---- Which table an event came from, and how to route it ---- */
const TASK_CHILD_TABLES = new Set([
  'task_tags', 'task_checklist_items', 'task_comments',
  'task_images', 'task_attachments', 'task_activity',
])

/* All tables we listen to (matches the supabase_realtime publication and the
   set the outbound layer writes). */
const WATCHED_TABLES = [
  'tasks', 'projects', 'tags', 'user_settings', ...TASK_CHILD_TABLES,
]

/* ---- Engine state ---- */
let channel: RealtimeChannel | null = null
let activeUserId: string | null = null
let everSubscribed = false          // to distinguish first subscribe from reconnect
let dirtyTaskIds = new Set<string>() // task ids needing a re-read
let flushTimer: ReturnType<typeof setTimeout> | null = null
let resyncTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false

/* Debounce windows. Task child edits arrive as a burst (one edit fans out to
   several tables); coalescing them into one targeted read keeps requests and
   re-renders minimal without a perceptible delay. */
const FLUSH_MS = 120

/* ------------------------------------------------------------------ */
/* Primary-key extraction per table                                    */
/* ------------------------------------------------------------------ */
type AnyRow = Record<string, unknown>
function pkFor(table: string, row: AnyRow | undefined): string | null {
  if (!row) return null
  if (table === 'task_tags') {
    const t = row.task_id, g = row.tag_id
    return t != null && g != null ? `${t}.${g}` : null
  }
  if (table === 'user_settings') {
    return row.user_id != null ? String(row.user_id) : null
  }
  return row.id != null ? String(row.id) : null
}

/* The task id a (child) event pertains to, if any. */
function taskIdFor(table: string, row: AnyRow | undefined): string | null {
  if (!row) return null
  if (table === 'tasks') return row.id != null ? String(row.id) : null
  if (TASK_CHILD_TABLES.has(table)) return row.task_id != null ? String(row.task_id) : null
  return null
}

/* ------------------------------------------------------------------ */
/* Targeted re-read of specific tasks (+ their children)               */
/* ------------------------------------------------------------------ */
/**
 * Re-assemble the given task ids from the DB and push them into the store.
 * Only these rows are queried (filtered server-side), so traffic scales with
 * the number of changed tasks, not the dataset size. Task ids that no longer
 * exist in the DB are reported as removals.
 */
async function reloadTasks(ids: string[]): Promise<void> {
  if (ids.length === 0 || !bridge) return
  const inList = ids

  const [
    tasksRes, taskTagsRes, checklistRes, commentsRes,
    imagesRes, attachmentsRes, activityRes,
  ] = await Promise.all([
    supabase.from('tasks').select('*').in('id', inList),
    supabase.from('task_tags').select('task_id, tag_id, user_id').in('task_id', inList),
    supabase.from('task_checklist_items').select('*').in('task_id', inList),
    supabase.from('task_comments').select('*').in('task_id', inList),
    supabase.from('task_images').select('*').in('task_id', inList),
    supabase.from('task_attachments').select('*').in('task_id', inList),
    supabase.from('task_activity').select('*').in('task_id', inList),
  ])

  const err = tasksRes.error || taskTagsRes.error || checklistRes.error ||
    commentsRes.error || imagesRes.error || attachmentsRes.error || activityRes.error
  if (err) { console.error('[realtime] task reload failed', err); return }

  const taskRows = (tasksRes.data ?? []) as TaskRow[]
  const present = new Set(taskRows.map(r => r.id))
  const removed = inList.filter(id => !present.has(id))

  const group = <T extends { task_id: string }>(rows: T[] | null) => {
    const m = new Map<string, T[]>()
    for (const r of rows ?? []) {
      const arr = m.get(r.task_id); if (arr) arr.push(r); else m.set(r.task_id, [r])
    }
    return m
  }
  const tagsBy = group(taskTagsRes.data as TaskTagRow[])
  const clBy = group(checklistRes.data as ChecklistRow[])
  const cmBy = group(commentsRes.data as CommentRow[])
  const imBy = group(imagesRes.data as ImageRow[])
  const atBy = group(attachmentsRes.data as AttachmentRow[])
  const acBy = group(activityRes.data as ActivityRow[])

  const tasks = taskRows.map(base => assembleTask(
    base,
    (tagsBy.get(base.id) ?? []).map(r => r.tag_id),
    clBy.get(base.id) ?? [],
    cmBy.get(base.id) ?? [],
    imBy.get(base.id) ?? [],
    atBy.get(base.id) ?? [],
    acBy.get(base.id) ?? [],
  ))

  if (tasks.length) bridge.applyTasks(tasks)
  if (removed.length) bridge.removeTasks(removed)
}

/* Flush the pending set of dirty task ids as a single targeted read. */
function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(runFlush, FLUSH_MS)
}
async function runFlush() {
  flushTimer = null
  if (flushing) { scheduleFlush(); return }  // a flush is in-flight; retry after it
  const ids = Array.from(dirtyTaskIds)
  dirtyTaskIds = new Set()
  if (ids.length === 0) return
  flushing = true
  try {
    await reloadTasks(ids)
  } finally {
    flushing = false
    // If more ids arrived while we were reading, flush them too.
    if (dirtyTaskIds.size) scheduleFlush()
  }
}

/* ------------------------------------------------------------------ */
/* Event handling                                                      */
/* ------------------------------------------------------------------ */
function handleEvent(payload: RealtimePostgresChangesPayload<AnyRow>) {
  if (!bridge) return
  const table = (payload.table as string) || ''
  const type = payload.eventType // 'INSERT' | 'UPDATE' | 'DELETE'
  const newRow = payload.new as AnyRow | undefined
  const oldRow = payload.old as AnyRow | undefined
  const row = type === 'DELETE' ? oldRow : newRow

  // Ownership guard. Listeners are unfiltered (see startRealtime: DELETE events
  // can't be server-filtered), and RLS already limits INSERT/UPDATE payloads to
  // our own rows — but as defence-in-depth we drop any INSERT/UPDATE whose
  // user_id is present and NOT ours. DELETE payloads carry only the PK (no
  // user_id) so they fall through; the store helpers no-op on ids we don't hold.
  if (type !== 'DELETE' && activeUserId && row && row.user_id != null && String(row.user_id) !== activeUserId) return

  // Drop our own writes: they are already reflected optimistically.
  const pk = pkFor(table, row)
  if (pk && isEcho(table, pk)) return

  /* ---- Task + task children: mark the owning task dirty ---- */
  if (table === 'tasks' || TASK_CHILD_TABLES.has(table)) {
    if (table === 'tasks') {
      if (type === 'DELETE') {
        // Base task gone → remove immediately (children cascade in DB).
        const id = oldRow?.id != null ? String(oldRow.id) : null
        if (id) { dirtyTaskIds.delete(id); bridge.removeTasks([id]) }
      } else if (newRow) {
        // The event already contains the full base row. Applying it directly
        // avoids seven redundant SELECTs for ordinary title/status/date edits.
        bridge.applyTaskBases([
          assembleTask(newRow as unknown as TaskRow, [], [], [], [], [], []),
        ])
      }
      return
    }
    const tid = taskIdFor(table, row)
    // A child DELETE only carries task_id when the table has REPLICA IDENTITY
    // FULL (migration 0004). If it's missing (older DB) we can't route the
    // event; the reconnect/visibility resync reconciles it shortly, so this
    // degrades gracefully rather than breaking. For INSERT/UPDATE task_id is
    // always present.
    if (!tid) return
    // Re-read the owning task so the added/changed/removed child is reflected.
    dirtyTaskIds.add(tid)
    scheduleFlush()
    return
  }

  /* ---- Projects ---- */
  if (table === 'projects') {
    if (type === 'DELETE') { if (oldRow?.id) bridge.removeProject(String(oldRow.id)) }
    else if (newRow) bridge.applyProject(rowToProject(newRow as unknown as ProjectRow))
    return
  }

  /* ---- Tags ---- */
  if (table === 'tags') {
    if (type === 'DELETE') { if (oldRow?.id) bridge.removeTag(String(oldRow.id)) }
    else if (newRow) bridge.applyTag(rowToTag(newRow as unknown as TagRow))
    return
  }

  /* ---- User settings: the realtime payload is already the canonical row ---- */
  if (table === 'user_settings' && newRow) {
    bridge.applySettings(rowToSettings(newRow as unknown as Parameters<typeof rowToSettings>[0]))
    return
  }
}

/* ------------------------------------------------------------------ */
/* Reconnect resync                                                    */
/* ------------------------------------------------------------------ */
/**
 * After a (re)connect, reconcile the full dataset so any events missed while
 * the socket was down are applied. This is diff-based on the store side
 * (reconcileAll only patches rows that actually differ), so it costs one
 * bootstrap read and touches only changed rows in the UI. Debounced so a
 * flurry of reconnect events collapses into one resync.
 */
function scheduleResync() {
  if (resyncTimer) clearTimeout(resyncTimer)
  resyncTimer = setTimeout(async () => {
    resyncTimer = null
    if (!bridge) return
    try {
      const data = await loadBootstrap()
      const [details, settings] = await Promise.all([
        loadTaskDetails(data.tasks.map(task => task.id)),
        loadSettings(),
      ])
      if (!bridge) return
      bridge.reconcileAll(data)
      bridge.applyTaskDetails(details)
      if (settings) bridge.applySettings(settings)
    } catch (e) {
      console.error('[realtime] resync failed', e)
    }
  }, 300)
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */
/**
 * Start (or restart) the realtime subscription for `userId`. Idempotent: a
 * repeat call for the same user is a no-op; a call for a different user tears
 * down the previous channel first. One channel, many table listeners — no
 * redundant subscriptions.
 */
export function startRealtime(userId: string) {
  if (channel && activeUserId === userId) return
  stopRealtime()
  activeUserId = userId
  everSubscribed = false

  let ch = supabase.channel(`orbit-sync:${userId}`)
  for (const table of WATCHED_TABLES) {
    // NOTE: intentionally NO `filter: user_id=eq.…` here. Postgres Changes
    // cannot filter DELETE events (the delete payload only carries the row's
    // primary key, so a user_id filter would silently drop every delete —
    // https://supabase.com/docs/guides/realtime/postgres-changes). RLS already
    // scopes the INSERT/UPDATE rows we receive to our own data; for DELETEs we
    // only get the PK, and applying a removal for an id we don't hold locally
    // is a harmless no-op (the store helpers all early-return on a miss). This
    // keeps deletes syncing live while still being safe and minimal.
    ch = ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      handleEvent,
    )
  }

  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      // First subscribe: the bootstrap load already gave us fresh data, so no
      // resync needed. Every SUBSEQUENT subscribe is a reconnect → resync to
      // pull anything missed while the socket was down.
      if (everSubscribed) scheduleResync()
      everSubscribed = true
    }
    // CHANNEL_ERROR / TIMED_OUT / CLOSED are handled by the client's own
    // auto-reconnect; when it succeeds we get another SUBSCRIBED above.
  })

  channel = ch

  // Belt-and-braces: also resync when the tab regains focus/visibility or the
  // browser reports it came back online, in case the socket silently stalled.
  addNetworkListeners()
}

/** Tear down the subscription and reset all engine state. */
export function stopRealtime() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (resyncTimer) { clearTimeout(resyncTimer); resyncTimer = null }
  dirtyTaskIds = new Set()
  flushing = false
  everSubscribed = false
  activeUserId = null
  removeNetworkListeners()
  if (channel) {
    const ch = channel
    channel = null
    void supabase.removeChannel(ch)
  }
}

/* ---- Network / visibility awareness -------------------------------------- */
let netListenersOn = false
function onOnline() { scheduleResync() }
function onVisible() { if (document.visibilityState === 'visible') scheduleResync() }
function addNetworkListeners() {
  if (netListenersOn || typeof window === 'undefined') return
  netListenersOn = true
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
}
function removeNetworkListeners() {
  if (!netListenersOn || typeof window === 'undefined') return
  netListenersOn = false
  window.removeEventListener('online', onOnline)
  document.removeEventListener('visibilitychange', onVisible)
}
