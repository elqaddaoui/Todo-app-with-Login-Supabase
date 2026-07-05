-- =============================================================================
-- Orbit — Todo + Calendar :: Supabase / PostgreSQL initial schema
-- =============================================================================
-- This migration models the ENTIRE application state that currently lives in
-- the browser (Zustand + localStorage `orbit-data` / `orbit-ui` stores) as a
-- production-ready, multi-tenant PostgreSQL schema.
--
-- Ownership model
--   Every user-facing row is owned by exactly one auth user (`user_id`
--   referencing `auth.users`). Row Level Security (RLS) enforces that a user
--   can only ever read or write their own rows.
--
-- Conventions
--   * UUID v4 primary keys (`gen_random_uuid()`).
--   * `created_at` / `updated_at` timestamptz on every table; `updated_at`
--     maintained by a trigger.
--   * Enumerated domains (status/priority/category) modelled as native
--     PostgreSQL ENUM types so the DB validates them exactly like the TS union
--     types in the client.
--   * Child collections that were embedded arrays in the client
--     (checklist items, comments, activity, images, attachments) are promoted
--     to first-class, indexed, cascade-deleted tables so they scale and can be
--     queried/filtered server-side.
-- =============================================================================

-- Required extensions -------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";     -- trigram indexes for search


-- =============================================================================
-- 1. Enumerated types  (mirror the TypeScript union types 1:1)
-- =============================================================================
-- Status  : type Status   = 'not_started' | 'planned' | 'in_progress' | 'waiting' | 'blocked' | 'done' | 'cancelled'
-- Priority: type Priority = 'low' | 'medium' | 'high' | 'urgent'
-- Category: type Category = 'work' | 'personal' | 'errands' | 'health' | 'learning' | 'finance' | 'social' | 'other'

do $$ begin
  create type task_status as enum
    ('not_started', 'planned', 'in_progress', 'waiting', 'blocked', 'done', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_category as enum
    ('work', 'personal', 'errands', 'health', 'learning', 'finance', 'social', 'other');
exception when duplicate_object then null; end $$;

-- Activity log entry types observed in the client ("created", "completed", …).
-- Kept as an enum but with a permissive set so future activity kinds are easy
-- to add via ALTER TYPE ... ADD VALUE.
do $$ begin
  create type task_activity_type as enum
    ('created', 'updated', 'completed', 'reopened', 'archived', 'unarchived',
     'moved', 'reparented', 'commented', 'status_changed', 'priority_changed',
     'due_changed', 'other');
exception when duplicate_object then null; end $$;


-- =============================================================================
-- 2. Shared trigger function: keep `updated_at` fresh on every UPDATE
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- =============================================================================
-- 3. profiles  — 1:1 extension of auth.users
-- =============================================================================
-- The client stamps comments with an `author` string and activity with a `by`
-- string (currently the literal "You" / "Alex"). To support real display names
-- and future collaboration, each auth user gets a profile row. The comment
-- author label is derived from this rather than hard-coded on the client.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text        not null default 'You',
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Per-user profile extending auth.users. display_name is used as the author/by label on comments and activity.';

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 4. projects
-- =============================================================================
-- TS: type Project = { id; name; icon; color; favorite?; parentId?;
--                      documentation; description?; order }
-- Projects can nest (parentId -> self). `order` is the user-defined manual
-- sort position within their project list (client `reorderProjects`).
create table if not exists public.projects (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  name          text        not null check (char_length(name) between 1 and 200),
  icon          text        not null default 'FolderKanban',
  color         text        not null default '#6366f1'
                            check (color ~* '^#[0-9a-f]{6}$'),
  favorite      boolean     not null default false,
  parent_id     uuid        references public.projects (id) on delete set null,
  description   text,
  documentation text        not null default '',
  -- Manual sort position within the owner's project list.
  "order"       integer     not null default 0,
  archived      boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- A project cannot be its own parent (deeper cycles are prevented in app
  -- logic; a CHECK cannot express arbitrary-depth cycle detection).
  constraint projects_no_self_parent check (parent_id is null or parent_id <> id)
);

comment on table public.projects is 'User projects/workspaces that group tasks. Supports nesting via parent_id.';

create index if not exists idx_projects_user_id      on public.projects (user_id);
create index if not exists idx_projects_user_order   on public.projects (user_id, "order");
create index if not exists idx_projects_parent_id    on public.projects (parent_id);
create index if not exists idx_projects_user_favorite on public.projects (user_id) where favorite;

create trigger trg_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 5. tags
-- =============================================================================
-- TS: type Tag = { id; name; color }
-- Tags are per-user. Name is unique per user (case-insensitive) so the tag
-- picker never produces duplicates.
create table if not exists public.tags (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  name       text        not null check (char_length(name) between 1 and 60),
  color      text        not null default '#6366f1'
                         check (color ~* '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tags_unique_name_per_user unique (user_id, name)
);

comment on table public.tags is 'User-defined labels applied to tasks (many-to-many via task_tags).';

create index if not exists idx_tags_user_id on public.tags (user_id);

create trigger trg_tags_updated_at
  before update on public.tags
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 6. tasks
-- =============================================================================
-- TS: type Task = { id; title; description?; status; priority; category;
--   projectId?; parentId?; tags[]; dueDate?; startDate?; time?;
--   estimatedMinutes?; favorite?; checklist[]; comments[]; images?[];
--   attachments[]; activity[]; archived?; createdAt; updatedAt; completedAt?; order }
--
-- Scalar columns live here. The embedded arrays (tags/checklist/comments/
-- images/attachments/activity) are normalized into their own tables below.
create table if not exists public.tasks (
  id                uuid          primary key default gen_random_uuid(),
  user_id           uuid          not null references auth.users (id) on delete cascade,

  title             text          not null check (char_length(title) between 1 and 500),
  description       text,

  status            task_status   not null default 'not_started',
  priority          task_priority not null default 'medium',
  category          task_category not null default 'work',

  -- Owning project (nullable: tasks can be unfiled/inbox). On project delete
  -- the client detaches tasks (projectId -> undefined), so SET NULL matches.
  project_id        uuid          references public.projects (id) on delete set null,

  -- Parent task for subtasks. Deleting a parent cascades to its children,
  -- mirroring the client's deleteTask (which removes t.id and its direct
  -- children `t.parentId === id`).
  parent_id         uuid          references public.tasks (id) on delete cascade,

  -- Scheduling. dueDate/startDate are calendar days (client stores 'yyyy-MM-dd')
  -- so `date` is the correct type. `time` is an optional wall-clock 'HH:mm'.
  due_date          date,
  start_date        date,
  time_of_day       time,

  estimated_minutes integer       check (estimated_minutes is null or estimated_minutes >= 0),
  favorite          boolean       not null default false,
  archived          boolean       not null default false,

  -- Manual sort position within the owner's task list (client `reorder`).
  "order"           integer       not null default 0,

  completed_at      timestamptz,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),

  constraint tasks_no_self_parent check (parent_id is null or parent_id <> id),
  -- Keep completed_at consistent with a 'done' status.
  constraint tasks_completed_at_requires_done
    check (completed_at is null or status = 'done')
);

comment on table public.tasks is 'Core task entity. Embedded client arrays are normalized into task_* child tables.';
comment on column public.tasks.time_of_day is 'Optional wall-clock time (client `time`, "HH:mm").';
comment on column public.tasks."order" is 'User-defined manual sort position (client `reorder`).';

create index if not exists idx_tasks_user_id        on public.tasks (user_id);
create index if not exists idx_tasks_user_order     on public.tasks (user_id, "order");
create index if not exists idx_tasks_project_id     on public.tasks (project_id);
create index if not exists idx_tasks_parent_id      on public.tasks (parent_id);
create index if not exists idx_tasks_user_status    on public.tasks (user_id, status);
create index if not exists idx_tasks_user_priority  on public.tasks (user_id, priority);
create index if not exists idx_tasks_user_category  on public.tasks (user_id, category);
create index if not exists idx_tasks_user_due_date  on public.tasks (user_id, due_date);
-- Partial indexes power the app's core views (Today / Upcoming / Favorites /
-- Completed / Archive) without scanning archived rows.
create index if not exists idx_tasks_user_favorite  on public.tasks (user_id) where favorite;
create index if not exists idx_tasks_user_archived  on public.tasks (user_id) where archived;
create index if not exists idx_tasks_active_due
  on public.tasks (user_id, due_date) where not archived and status <> 'done';
-- Trigram index for the free-text search box (search over title).
create index if not exists idx_tasks_title_trgm
  on public.tasks using gin (title gin_trgm_ops);

create trigger trg_tasks_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 7. task_tags  — many-to-many join (Task.tags: string[] -> tags.id)
-- =============================================================================
create table if not exists public.task_tags (
  task_id    uuid        not null references public.tasks (id) on delete cascade,
  tag_id     uuid        not null references public.tags  (id) on delete cascade,
  -- Denormalized owner so RLS can be enforced with a single, index-friendly
  -- predicate instead of a subquery on every row.
  user_id    uuid        not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, tag_id)
);

comment on table public.task_tags is 'Join table linking tasks to tags (client Task.tags array).';

create index if not exists idx_task_tags_tag_id  on public.task_tags (tag_id);
create index if not exists idx_task_tags_user_id on public.task_tags (user_id);


-- =============================================================================
-- 8. task_checklist_items  (Task.checklist: { id; text; done }[])
-- =============================================================================
create table if not exists public.task_checklist_items (
  id         uuid        primary key default gen_random_uuid(),
  task_id    uuid        not null references public.tasks (id) on delete cascade,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  text       text        not null check (char_length(text) between 1 and 1000),
  done       boolean     not null default false,
  "order"    integer     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.task_checklist_items is 'Sub-steps within a task (client Task.checklist).';

create index if not exists idx_checklist_task_id on public.task_checklist_items (task_id, "order");
create index if not exists idx_checklist_user_id on public.task_checklist_items (user_id);

create trigger trg_checklist_updated_at
  before update on public.task_checklist_items
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 9. task_comments  (Task.comments: { id; author; text; createdAt }[])
-- =============================================================================
-- `author_id` links to the profile that wrote the comment (real ownership),
-- while `author_name` snapshots the display label at write time so historical
-- comments keep their author string even if a profile is renamed/removed.
create table if not exists public.task_comments (
  id          uuid        primary key default gen_random_uuid(),
  task_id     uuid        not null references public.tasks (id) on delete cascade,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  author_id   uuid        references public.profiles (id) on delete set null,
  author_name text        not null default 'You',
  text        text        not null check (char_length(text) between 1 and 5000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.task_comments is 'Free-text comments on a task (client Task.comments).';

create index if not exists idx_comments_task_id on public.task_comments (task_id, created_at);
create index if not exists idx_comments_user_id on public.task_comments (user_id);

create trigger trg_comments_updated_at
  before update on public.task_comments
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 10. task_images  (Task.images?: { id; url; name? }[])
-- =============================================================================
-- The client currently stores images either as pasted URLs or as base64 data
-- URLs (readFileAsDataUrl). `url` therefore accepts both; for production the
-- app should migrate uploads to Supabase Storage and store the object path in
-- `storage_path` while keeping `url` for external links.
create table if not exists public.task_images (
  id           uuid        primary key default gen_random_uuid(),
  task_id      uuid        not null references public.tasks (id) on delete cascade,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  url          text        not null,
  name         text,
  storage_path text,        -- optional Supabase Storage object path
  "order"      integer     not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.task_images is 'Images attached to a task (client Task.images). url may be an external URL or a data URL; storage_path for Supabase Storage uploads.';

create index if not exists idx_images_task_id on public.task_images (task_id, "order");
create index if not exists idx_images_user_id on public.task_images (user_id);

create trigger trg_images_updated_at
  before update on public.task_images
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 11. task_attachments  (Task.attachments: { id; name; size }[])
-- =============================================================================
create table if not exists public.task_attachments (
  id           uuid        primary key default gen_random_uuid(),
  task_id      uuid        not null references public.tasks (id) on delete cascade,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  name         text        not null check (char_length(name) between 1 and 500),
  size_bytes   bigint      not null default 0 check (size_bytes >= 0),
  storage_path text,        -- optional Supabase Storage object path
  mime_type    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.task_attachments is 'File attachments metadata for a task (client Task.attachments). size stored as size_bytes.';

create index if not exists idx_attachments_task_id on public.task_attachments (task_id);
create index if not exists idx_attachments_user_id on public.task_attachments (user_id);

create trigger trg_attachments_updated_at
  before update on public.task_attachments
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 12. task_activity  (Task.activity: { id; type; message; createdAt; by }[])
-- =============================================================================
-- Append-only audit trail. `actor_id`/`actor_name` mirror the client's `by`.
create table if not exists public.task_activity (
  id         uuid                primary key default gen_random_uuid(),
  task_id    uuid                not null references public.tasks (id) on delete cascade,
  user_id    uuid                not null references auth.users (id) on delete cascade,
  type       task_activity_type  not null default 'other',
  message    text                not null,
  actor_id   uuid                references public.profiles (id) on delete set null,
  actor_name text                not null default 'You',
  created_at timestamptz         not null default now()
);

comment on table public.task_activity is 'Append-only activity/audit log for a task (client Task.activity).';

create index if not exists idx_activity_task_id on public.task_activity (task_id, created_at);
create index if not exists idx_activity_user_id on public.task_activity (user_id);


-- =============================================================================
-- 13. user_settings  — the `orbit-ui` store (per-user app preferences)
-- =============================================================================
-- Mirrors the persisted UI/preferences store so settings follow the user
-- across devices instead of living only in localStorage. Ephemeral UI flags
-- (open/closed panels, current selection) are intentionally NOT persisted.
create table if not exists public.user_settings (
  user_id            uuid        primary key references auth.users (id) on delete cascade,
  theme              text        not null default 'system'
                                 check (theme in ('light', 'dark', 'system')),
  sidebar_width      integer     not null default 280 check (sidebar_width between 0 and 1000),
  details_width      integer     not null default 380 check (details_width between 0 and 1000),
  compact_mode       boolean     not null default false,
  dnd_enabled        boolean     not null default true,
  calendar_side_panel boolean    not null default true,
  undo_toast_enabled boolean     not null default true,
  undo_toast_duration integer    not null default 2000 check (undo_toast_duration between 0 and 60000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.user_settings is 'Per-user application preferences (mirrors the persisted orbit-ui store).';

create trigger trg_user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 14. Auto-provision profile + settings on signup
-- =============================================================================
-- When a new auth user is created, seed their profile and default settings so
-- the client never has to special-case a "missing profile" state.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''),
             split_part(new.email, '@', 1),
             'You')
  )
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================================
-- 15. Row Level Security
-- =============================================================================
-- Enable RLS on every table and add owner-scoped policies. Every table carries
-- a `user_id` (or, for profiles/settings, an id equal to the user) so each
-- policy reduces to a single indexed equality against auth.uid().

alter table public.profiles              enable row level security;
alter table public.projects              enable row level security;
alter table public.tags                  enable row level security;
alter table public.tasks                 enable row level security;
alter table public.task_tags             enable row level security;
alter table public.task_checklist_items  enable row level security;
alter table public.task_comments         enable row level security;
alter table public.task_images           enable row level security;
alter table public.task_attachments      enable row level security;
alter table public.task_activity         enable row level security;
alter table public.user_settings         enable row level security;

-- ---- profiles -------------------------------------------------------------
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles_delete_own" on public.profiles
  for delete using (auth.uid() = id);

-- ---- user_settings --------------------------------------------------------
create policy "settings_select_own" on public.user_settings
  for select using (auth.uid() = user_id);
create policy "settings_insert_own" on public.user_settings
  for insert with check (auth.uid() = user_id);
create policy "settings_update_own" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "settings_delete_own" on public.user_settings
  for delete using (auth.uid() = user_id);

-- ---- projects -------------------------------------------------------------
create policy "projects_select_own" on public.projects
  for select using (auth.uid() = user_id);
create policy "projects_insert_own" on public.projects
  for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects_delete_own" on public.projects
  for delete using (auth.uid() = user_id);

-- ---- tags -----------------------------------------------------------------
create policy "tags_select_own" on public.tags
  for select using (auth.uid() = user_id);
create policy "tags_insert_own" on public.tags
  for insert with check (auth.uid() = user_id);
create policy "tags_update_own" on public.tags
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tags_delete_own" on public.tags
  for delete using (auth.uid() = user_id);

-- ---- tasks ----------------------------------------------------------------
create policy "tasks_select_own" on public.tasks
  for select using (auth.uid() = user_id);
create policy "tasks_insert_own" on public.tasks
  for insert with check (auth.uid() = user_id);
create policy "tasks_update_own" on public.tasks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks_delete_own" on public.tasks
  for delete using (auth.uid() = user_id);

-- ---- task_tags ------------------------------------------------------------
create policy "task_tags_select_own" on public.task_tags
  for select using (auth.uid() = user_id);
create policy "task_tags_insert_own" on public.task_tags
  for insert with check (auth.uid() = user_id);
create policy "task_tags_update_own" on public.task_tags
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "task_tags_delete_own" on public.task_tags
  for delete using (auth.uid() = user_id);

-- ---- task_checklist_items -------------------------------------------------
create policy "checklist_select_own" on public.task_checklist_items
  for select using (auth.uid() = user_id);
create policy "checklist_insert_own" on public.task_checklist_items
  for insert with check (auth.uid() = user_id);
create policy "checklist_update_own" on public.task_checklist_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "checklist_delete_own" on public.task_checklist_items
  for delete using (auth.uid() = user_id);

-- ---- task_comments --------------------------------------------------------
create policy "comments_select_own" on public.task_comments
  for select using (auth.uid() = user_id);
create policy "comments_insert_own" on public.task_comments
  for insert with check (auth.uid() = user_id);
create policy "comments_update_own" on public.task_comments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "comments_delete_own" on public.task_comments
  for delete using (auth.uid() = user_id);

-- ---- task_images ----------------------------------------------------------
create policy "images_select_own" on public.task_images
  for select using (auth.uid() = user_id);
create policy "images_insert_own" on public.task_images
  for insert with check (auth.uid() = user_id);
create policy "images_update_own" on public.task_images
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "images_delete_own" on public.task_images
  for delete using (auth.uid() = user_id);

-- ---- task_attachments -----------------------------------------------------
create policy "attachments_select_own" on public.task_attachments
  for select using (auth.uid() = user_id);
create policy "attachments_insert_own" on public.task_attachments
  for insert with check (auth.uid() = user_id);
create policy "attachments_update_own" on public.task_attachments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "attachments_delete_own" on public.task_attachments
  for delete using (auth.uid() = user_id);

-- ---- task_activity --------------------------------------------------------
-- Activity is an append-only audit trail: allow select + insert only.
create policy "activity_select_own" on public.task_activity
  for select using (auth.uid() = user_id);
create policy "activity_insert_own" on public.task_activity
  for insert with check (auth.uid() = user_id);


-- =============================================================================
-- 16. Realtime (optional, but recommended for cross-device sync)
-- =============================================================================
-- Add the mutable tables to the supabase_realtime publication so the client
-- can subscribe to live changes. Guarded so re-running the migration is safe.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.projects, public.tags, public.tasks, public.task_tags,
      public.task_checklist_items, public.task_comments, public.task_images,
      public.task_attachments, public.task_activity, public.user_settings,
      public.profiles;
  end if;
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- End of migration
-- =============================================================================
