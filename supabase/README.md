# Supabase Migration — Orbit (Todo + Calendar)

This directory contains the **complete PostgreSQL schema** that migrates the
Orbit app's data layer from browser-only storage (Zustand + `localStorage`) to
Supabase.

- `migrations/0001_initial_schema.sql` — the full, idempotent migration.

Apply it with either:

```bash
# Supabase CLI (recommended)
supabase db push

# …or paste the file into the Supabase Studio → SQL Editor and run it.
```

The migration was validated end-to-end against **PostgreSQL 17**: it applies
cleanly, the signup trigger auto-provisions profiles/settings, all CHECK/UNIQUE
constraints fire, cascade + `SET NULL` deletes behave correctly, and RLS fully
isolates one user's data from another (verified under a non-superuser
`authenticated` role, forged cross-user inserts rejected).

---

## 1. What the app looks like today

Orbit is a React 19 + TypeScript + Vite SPA. Key findings from the codebase:

| Area | Where | Notes |
|------|-------|-------|
| **Auth** | `src/auth.tsx`, `src/AuthPages.tsx`, `src/supabaseClient.ts` | Already uses **Supabase Auth** (email/password). Session guarded by `RequireAuth`. |
| **Data** | `src/App.tsx` (`useData` Zustand store, `persist` key `orbit-data`) | ALL task/project/tag data lives **client-side** in `localStorage`. Seeded from an in-memory `boot` object. This is what we migrate. |
| **Preferences** | `src/App.tsx` (`useUI` Zustand store, `persist` key `orbit-ui`) | Theme, panel widths, compact mode, DnD toggle, undo-toast prefs. Migrated to `user_settings`. |
| **Undo/Redo** | `useHistory` store | Pure in-memory snapshots — **not** persisted, so intentionally **not** modeled in the DB. |

### The client data model (from `src/App.tsx`)

```ts
type Status   = 'not_started'|'planned'|'in_progress'|'waiting'|'blocked'|'done'|'cancelled'
type Priority = 'low'|'medium'|'high'|'urgent'
type Category = 'work'|'personal'|'errands'|'health'|'learning'|'finance'|'social'|'other'

type Tag     = { id; name; color }
type Project = { id; name; icon; color; favorite?; parentId?; documentation; description?; order }
type Task    = {
  id; title; description?; status; priority; category;
  projectId?; parentId?; tags: string[]; dueDate?; startDate?; time?;
  estimatedMinutes?; favorite?;
  checklist:   { id; text; done }[];
  comments:    { id; author; text; createdAt }[];
  images?:     { id; url; name? }[];
  attachments: { id; name; size }[];
  activity:    { id; type; message; createdAt; by }[];
  archived?; createdAt; updatedAt; completedAt?; order
}
```

---

## 2. Data that must live in Supabase

Every field above maps to a column or table. Nothing is dropped.

| Client concept | Postgres table |
|----------------|----------------|
| `Task` (scalars) | `tasks` |
| `Task.tags: string[]` | `task_tags` (M:N join → `tags`) |
| `Task.checklist[]` | `task_checklist_items` |
| `Task.comments[]` | `task_comments` |
| `Task.images[]` | `task_images` |
| `Task.attachments[]` | `task_attachments` |
| `Task.activity[]` | `task_activity` (append-only) |
| `Project` | `projects` |
| `Tag` | `tags` |
| `useUI` prefs | `user_settings` |
| comment `author` / activity `by` | `profiles` (+ per-user auth) |

**Deliberately NOT stored** (ephemeral or derived client state): open/closed
panels, current selection, command-palette state, the undo/redo history stack,
and the natural-language quick-add parser (`parseNL`).

---

## 3. Schema design (11 tables)

```
auth.users ──1:1── profiles
     │
     ├───< projects (self-nesting via parent_id)
     ├───< tags
     ├───< user_settings (1:1)
     └───< tasks (self-nesting via parent_id, project_id → projects)
                ├───< task_tags >─── tags
                ├───< task_checklist_items
                ├───< task_comments
                ├───< task_images
                ├───< task_attachments
                └───< task_activity  (append-only)
```

### Key decisions

1. **UUID primary keys everywhere** (`gen_random_uuid()`). The client currently
   uses `Date.now()` strings; UUIDs are collision-free across devices and are
   the Supabase convention.

2. **`user_id` ownership on every table.** Even join/child tables carry a
   denormalized `user_id`. This lets each RLS policy be a single indexed
   equality (`auth.uid() = user_id`) instead of a correlated subquery up the
   parent chain — dramatically cheaper at scale and simpler to reason about.

3. **Normalized child collections.** The embedded JSON arrays become real
   tables with FKs, `ON DELETE CASCADE`, their own `order`, timestamps and
   indexes. This makes them independently queryable/paginated and avoids
   rewriting a whole task row to toggle one checklist item.

4. **Native ENUM types** for `status` / `priority` / `category` mirror the TS
   union types exactly, so the database rejects invalid values. `ALTER TYPE …
   ADD VALUE` keeps them extensible.

5. **Correct column types.** `dueDate`/`startDate` → `date` (client stores
   `yyyy-MM-dd`); `time` → `time`; `attachment.size` → `bigint size_bytes`;
   `documentation`/`description` → `text`.

6. **`created_at` + `updated_at` on every mutable table**, with `updated_at`
   auto-maintained by the shared `set_updated_at()` trigger. Append-only tables
   (`task_tags`, `task_activity`) only have `created_at`.

7. **Referential-integrity choices mirror the app's behavior:**
   - `tasks.project_id → projects ON DELETE SET NULL` — the client's
     `deleteProject` detaches tasks (`projectId = undefined`) rather than
     deleting them.
   - `tasks.parent_id → tasks ON DELETE CASCADE` — `deleteTask` removes a task
     and its direct children.
   - `projects.parent_id → projects ON DELETE SET NULL` — a deleted parent
     project shouldn't delete its sub-projects.
   - All `user_id` FKs are `ON DELETE CASCADE` so removing an auth user wipes
     their data cleanly.

8. **Constraints that encode invariants** discovered in the store logic:
   - `tasks_completed_at_requires_done` — `completedAt` is only set when a task
     is `done` (see `toggleDone`).
   - `*_no_self_parent` — a row can't be its own parent (the app also prevents
     deeper cycles in `setParent`, which a single CHECK can't express).
   - Hex-color CHECKs, length CHECKs, `unique (user_id, name)` on tags.

9. **Indexing for the actual views.** Orbit's pages (Today, Upcoming,
   Calendar, Favorites, Completed, Archive, per-project, per-tag, search)
   drove the index set: composite `(user_id, …)` btrees, partial indexes for
   `favorite`/`archived`/active-with-due-date, and a **GIN trigram** index on
   `tasks.title` for the free-text search box.

10. **Profiles + auto-provisioning.** A `handle_new_user()` trigger on
    `auth.users` seeds a `profiles` row and default `user_settings` on signup,
    so the client never faces a "missing profile/settings" state. Comment
    `author` / activity `by` become real `author_id`/`actor_id` references plus
    a snapshotted display name.

11. **Realtime enabled.** All mutable tables are added to the
    `supabase_realtime` publication so the app can subscribe to live changes
    for cross-device/cross-tab sync (the client already relies on multi-tab
    auth sync).

---

## 4. Row Level Security

RLS is **enabled on all 11 tables** with owner-scoped policies:

- `profiles` / `user_settings`: `auth.uid() = id` / `= user_id`.
- Everything else: `auth.uid() = user_id` for `select/insert/update/delete`.
- `task_activity` is **append-only** — it exposes only `select` + `insert`
  (no update/delete) since it's an audit trail.

Every mutating policy uses both `USING` (row visibility) and `WITH CHECK`
(prevents writing rows owned by someone else), which the validation suite
confirmed by rejecting a forged cross-user insert.

---

## 5. Assumptions

- **Single-user ownership (no sharing yet).** Nothing in the current UI shares
  tasks/projects between users, so the model is strictly per-owner. The
  `profiles` + `author_id`/`actor_id` columns lay the groundwork for future
  collaboration without a schema rewrite.
- **`author` "Alex"/"You" and `by` "You"** are UI placeholders; they map to the
  authenticated user's profile going forward.
- **Images/attachments**: today the client stores base64 data URLs and simple
  metadata. `url` accepts external URLs *and* data URLs; `storage_path` +
  `mime_type` columns are provided so uploads can move to **Supabase Storage**
  later without another migration.
- **Manual `order`** is preserved as an `integer` per user list, matching the
  client's `reorder` / `reorderProjects` semantics.
- **Undo/redo history and transient UI flags are not persisted** by the app, so
  they are intentionally excluded from the database.

---

## 6. Application wiring (completed)

The React app now uses Supabase as its datastore (localStorage is no longer the
source of truth for tasks/projects/tags/settings). The integration lives in
`src/data/`:

| File | Role |
|------|------|
| `src/data/types.ts` | Domain types shared by the data layer |
| `src/data/id.ts` | UUID id generation (`newId()`) — replaces `Date.now()` ids |
| `src/data/mappers.ts` | Row ↔ nested-`Task`/`Project`/`Tag` translation |
| `src/data/load.ts` | `loadBootstrap()` / `loadSettings()` — initial per-user fetch |
| `src/data/sync.ts` | Diff-based background sync engine (`diffAndPersist`) |
| `src/data/settings.ts` | Debounced `user_settings` persistence |

**Architecture preserved.** The `useData` Zustand store keeps its exact
synchronous, optimistic API and all logic (status propagation, undo/redo,
reordering). A store **subscriber** computes the minimal diff between the
previous and next `{tasks, projects, tags}` snapshots and pushes just those
inserts/updates/deletes to Supabase — so the UI, UX and performance are
unchanged, and undo/redo restores persist too. First-time users are seeded
with the demo dataset (re-keyed with fresh UUIDs). `useUI` preferences sync to
`user_settings` and follow the user across devices.

### Applying the schema (one-time, requires project owner)

The client uses the anon/publishable key, which cannot run DDL. Apply the
migration once with elevated access:

```bash
# Option A — Supabase CLI
supabase link --project-ref whjdybmttuyuhxshulva
supabase db push

# Option B — Supabase Studio → SQL Editor
# Paste the contents of supabase/migrations/0001_initial_schema.sql and Run.
```

After it runs, the app is fully functional: sign up creates a profile +
default settings automatically, and all data reads/writes go to Supabase.

### Testing

`test/run-integration.mjs` bundles the real data layer and runs it against a
local PostgreSQL with this exact migration + RLS applied. It asserts full
field round-trips, minimal-diff updates, child mutations, cascade deletes,
project detach (SET NULL), cross-user RLS isolation, forged-insert rejection,
and settings persistence — **25 assertions, all passing**.

```bash
# Requires a local Postgres 17 with the migration + shim + `authenticated`
# role applied on 127.0.0.1:5433 (see test/ for the harness).
node test/run-integration.mjs
```
