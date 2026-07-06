/* ============================================================
   Diff-based Supabase sync engine.

   The app's Zustand store (`useData`) stays fully synchronous and
   optimistic — every action mutates local state immediately, exactly as
   before, so the UI, undo/redo, status propagation and performance are
   unchanged. This module observes state transitions and persists the
   MINIMAL set of changes to Supabase in the background.

   How it works
   ------------
   `diffAndPersist(prev, next, userId)` compares the previous and next
   { tasks, projects, tags } snapshots and:
     • upserts inserted/changed rows
     • deletes removed rows
     • for each changed task, reconciles its child collections
       (tags / checklist / comments / images / attachments / activity)
       with per-collection upsert + delete.

   Writes are queued and run sequentially so overlapping bursts (e.g. a
   drag reorder followed immediately by an edit) apply in order. Errors are
   surfaced via an onError callback but never block the UI.
   ============================================================ */
import { supabase } from '../supabaseClient'
import type { Task, Project, Tag } from './types'
import {
  projectToRow, tagToRow, taskToBaseRow,
  checklistToRows, commentsToRows, imagesToRows, attachmentsToRows, activityToRows,
} from './mappers'

export type Snapshot = { tasks: Task[]; projects: Project[]; tags: Tag[] }

// A write op returns anything awaitable that resolves to a Supabase result
// (`{ error }`). We accept the loose builder type since Supabase query
// builders are thenables rather than real Promises.
type WriteOp = () => PromiseLike<{ error: unknown } | null | void>

let queue: Promise<void> = Promise.resolve()
let onErrorCb: ((e: unknown) => void) | null = null

export function setSyncErrorHandler(cb: (e: unknown) => void) {
  onErrorCb = cb
}

/** Enqueue a batch of write ops to run sequentially after the current queue. */
function enqueue(ops: WriteOp[]) {
  if (ops.length === 0) return
  queue = queue.then(async () => {
    for (const op of ops) {
      try {
        const res = await op()
        if (res && typeof res === 'object' && 'error' in res && res.error) onErrorCb?.(res.error)
      } catch (e) {
        onErrorCb?.(e)
      }
    }
  })
}

/** Await all queued writes (used by tests / before sign-out). */
export function flushSync(): Promise<void> {
  return queue
}

/* Index helpers ------------------------------------------------------- */
const byId = <T extends { id: string }>(arr: T[]) => new Map(arr.map(x => [x.id, x]))

/* Shallow structural comparison via JSON. Rows are small; this is simpler
   and safer than hand-written field diffs and avoids missed-field bugs. */
const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b)

/* ---- Child-collection reconciliation for a single task ---- */
type ChildRow = { id: string }
function reconcileChildren<R extends ChildRow>(
  table: string,
  prevRows: R[],
  nextRows: R[],
  ops: WriteOp[],
) {
  const prevMap = byId(prevRows)
  const nextMap = byId(nextRows)

  const toUpsert = nextRows.filter(r => {
    const prev = prevMap.get(r.id)
    return !prev || changed(prev, r)
  })
  const toDelete = prevRows.filter(r => !nextMap.has(r.id)).map(r => r.id)

  if (toUpsert.length) ops.push(() => supabase.from(table).upsert(toUpsert as any))
  if (toDelete.length) ops.push(() => supabase.from(table).delete().in('id', toDelete))
}

/* Reconcile the task_tags join for a single task. */
function reconcileTaskTags(
  taskId: string, userId: string,
  prevTagIds: string[], nextTagIds: string[], ops: WriteOp[],
) {
  const prevSet = new Set(prevTagIds)
  const nextSet = new Set(nextTagIds)
  const toAdd = nextTagIds.filter(t => !prevSet.has(t))
  const toRemove = prevTagIds.filter(t => !nextSet.has(t))
  if (toAdd.length) {
    ops.push(() => supabase.from('task_tags').upsert(
      toAdd.map(tag_id => ({ task_id: taskId, tag_id, user_id: userId })),
      { onConflict: 'task_id,tag_id' },
    ))
  }
  if (toRemove.length) {
    ops.push(() => supabase.from('task_tags').delete().eq('task_id', taskId).in('tag_id', toRemove))
  }
}

/**
 * Compute the difference between two snapshots and persist it. Safe to call
 * on every store transition; a no-op when nothing changed.
 */
export function diffAndPersist(prev: Snapshot, next: Snapshot, userId: string) {
  const ops: WriteOp[] = []

  /* ---------------- Tags ---------------- */
  {
    const prevMap = byId(prev.tags)
    const nextMap = byId(next.tags)
    const upserts = next.tags
      .filter(t => { const p = prevMap.get(t.id); return !p || changed(p, t) })
      .map(t => tagToRow(t, userId))
    const deletes = prev.tags.filter(t => !nextMap.has(t.id)).map(t => t.id)
    if (upserts.length) ops.push(() => supabase.from('tags').upsert(upserts))
    if (deletes.length) ops.push(() => supabase.from('tags').delete().in('id', deletes))
  }

  /* ---------------- Projects ---------------- */
  {
    const prevMap = byId(prev.projects)
    const nextMap = byId(next.projects)
    const upserts = next.projects
      .filter(p => { const prevP = prevMap.get(p.id); return !prevP || changed(prevP, p) })
      .map(p => projectToRow(p, userId))
    const deletes = prev.projects.filter(p => !nextMap.has(p.id)).map(p => p.id)
    if (upserts.length) ops.push(() => supabase.from('projects').upsert(upserts))
    if (deletes.length) ops.push(() => supabase.from('projects').delete().in('id', deletes))
  }

  /* ---------------- Tasks (base + children) ---------------- */
  {
    const prevMap = byId(prev.tasks)
    const nextMap = byId(next.tasks)

    // Base-row upserts: task exists in next and its scalar columns changed.
    const baseUpserts = next.tasks
      .filter(t => {
        const p = prevMap.get(t.id)
        if (!p) return true
        return changed(baseTaskShape(p), baseTaskShape(t))
      })
      .map(t => taskToBaseRow(t, userId))
    if (baseUpserts.length) ops.push(() => supabase.from('tasks').upsert(baseUpserts))

    // Per-task child reconciliation for new or changed tasks.
    for (const t of next.tasks) {
      const p = prevMap.get(t.id)
      if (p) {
        if (changed(p.tags, t.tags)) reconcileTaskTags(t.id, userId, p.tags, t.tags, ops)
        if (changed(p.checklist, t.checklist))
          reconcileChildren('task_checklist_items', checklistToRows(p, userId), checklistToRows(t, userId), ops)
        if (changed(p.comments, t.comments))
          reconcileChildren('task_comments', commentsToRows(p, userId), commentsToRows(t, userId), ops)
        if (changed(p.images ?? [], t.images ?? []))
          reconcileChildren('task_images', imagesToRows(p, userId), imagesToRows(t, userId), ops)
        if (changed(p.attachments, t.attachments))
          reconcileChildren('task_attachments', attachmentsToRows(p, userId), attachmentsToRows(t, userId), ops)
        if (changed(p.activity, t.activity)) {
          // Activity is append-only (no update/delete policy): insert new rows only.
          const prevIds = new Set(p.activity.map(a => a.id))
          const newActivity = activityToRows(t, userId).filter(a => !prevIds.has(a.id))
          if (newActivity.length) ops.push(() => supabase.from('task_activity').insert(newActivity))
        }
      } else {
        // Brand-new task: insert all its children.
        if (t.tags.length) reconcileTaskTags(t.id, userId, [], t.tags, ops)
        const cl = checklistToRows(t, userId); if (cl.length) ops.push(() => supabase.from('task_checklist_items').upsert(cl))
        const cm = commentsToRows(t, userId); if (cm.length) ops.push(() => supabase.from('task_comments').upsert(cm))
        const im = imagesToRows(t, userId); if (im.length) ops.push(() => supabase.from('task_images').upsert(im))
        const at = attachmentsToRows(t, userId); if (at.length) ops.push(() => supabase.from('task_attachments').upsert(at))
        const ac = activityToRows(t, userId); if (ac.length) ops.push(() => supabase.from('task_activity').insert(ac))
      }
    }

    // Deleted tasks: deleting the base row cascades to all child tables.
    const deletes = prev.tasks.filter(t => !nextMap.has(t.id)).map(t => t.id)
    if (deletes.length) ops.push(() => supabase.from('tasks').delete().in('id', deletes))
  }

  enqueue(ops)
}

/* Scalar-only projection of a task for base-row change detection (excludes
   the child collections, which are diffed separately). */
function baseTaskShape(t: Task) {
  return {
    title: t.title, description: t.description, status: t.status, priority: t.priority,
    category: t.category, projectId: t.projectId, parentId: t.parentId,
    dueDate: t.dueDate, startDate: t.startDate, time: t.time,
    estimatedMinutes: t.estimatedMinutes, favorite: t.favorite, archived: t.archived,
    order: t.order, completedAt: t.completedAt, createdAt: t.createdAt, updatedAt: t.updatedAt,
  }
}
