-- =============================================================================
-- Orbit — Todo + Calendar :: 0004 full replica identity for live cross-session sync
-- =============================================================================
-- Why this migration exists
-- -------------------------
-- The client now subscribes to Postgres Changes (Supabase Realtime) so a change
-- made in ANY session of a user appears live in every other session
-- (see src/data/realtime.ts).
--
-- By default a table's REPLICA IDENTITY is `DEFAULT`, which means DELETE (and
-- the "old" image of UPDATE) events only carry the row's PRIMARY KEY columns.
-- That is a problem for the normalized child tables: a deleted
-- `task_checklist_items` / `task_comments` / `task_images` /
-- `task_attachments` / `task_activity` row would arrive carrying only its own
-- `id`, with no `task_id`, so the client couldn't tell which task to refresh
-- and the removal wouldn't reflect live (only on the next reconnect resync).
--
-- Setting REPLICA IDENTITY FULL makes Postgres include the COMPLETE old row in
-- change events, so DELETE payloads carry `task_id` (to route the update) and
-- `user_id` (for the client's ownership guard). The rows are small and these
-- tables are already indexed on their PKs, so the WAL overhead is negligible.
--
-- Idempotent: `SET REPLICA IDENTITY FULL` is safe to run repeatedly.
-- =============================================================================

alter table public.tasks                 replica identity full;
alter table public.projects              replica identity full;
alter table public.tags                  replica identity full;
alter table public.task_tags             replica identity full;
alter table public.task_checklist_items  replica identity full;
alter table public.task_comments         replica identity full;
alter table public.task_images           replica identity full;
alter table public.task_attachments      replica identity full;
alter table public.task_activity         replica identity full;
alter table public.user_settings         replica identity full;

-- Ensure every mutable table is in the Realtime publication (0001 already adds
-- them; this is a safe no-op re-assert in case an older DB missed any).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.projects, public.tags, public.tasks, public.task_tags,
      public.task_checklist_items, public.task_comments, public.task_images,
      public.task_attachments, public.task_activity, public.user_settings;
  end if;
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- End of migration
-- =============================================================================
