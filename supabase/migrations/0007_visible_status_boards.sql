-- =============================================================================
-- 0007  Status Board visibility preference
-- =============================================================================
-- Adds one column to `user_settings` backing the new
-- "Status boards" App Setting:
--
--   • visible_status_boards — the status boards (kanban columns) rendered on
--                             every project's Status Board, stored as an array
--                             of status keys.
--
-- NULL means "show every board" — the default, and also the value written back
-- whenever the user re-selects all boards. Keeping the all-visible case as NULL
-- (instead of an exhaustive array) means any status added to the product later
-- shows up automatically for users who never customised the setting.
--
-- A CHECK constraint keeps the array free of unknown keys and rejects an empty
-- array, since a project page with zero columns would be an unrecoverable
-- dead end in the UI. The client normalizes as well (defence in depth).
--
-- `add column if not exists` keeps this migration safely idempotent.
-- =============================================================================

alter table public.user_settings
  add column if not exists visible_status_boards text[] default null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_settings_visible_status_boards_valid'
  ) then
    alter table public.user_settings
      add constraint user_settings_visible_status_boards_valid
      check (
        visible_status_boards is null
        or (
          array_length(visible_status_boards, 1) >= 1
          and visible_status_boards <@ array[
            'not_started', 'planned', 'in_progress',
            'waiting', 'blocked', 'done', 'cancelled'
          ]::text[]
        )
      );
  end if;
end $$;

comment on column public.user_settings.visible_status_boards is
  'Status boards visible on project Status Boards. NULL = show every board.';
