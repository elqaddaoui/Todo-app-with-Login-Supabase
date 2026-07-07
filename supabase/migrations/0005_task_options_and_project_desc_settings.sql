-- =============================================================================
-- 0005  New per-user preferences
-- =============================================================================
-- Adds two new columns to `user_settings` that back new App Settings toggles:
--
--   • remember_last_task_options  — when ON, new tasks reuse the last selected
--                                   creation options (priority, project, tags…)
--                                   instead of resetting to defaults each time.
--   • show_project_descriptions   — when ON, project cards on the Projects page
--                                   display the project description.
--
-- Both default to false so existing behaviour is unchanged until the user opts
-- in. `add column if not exists` keeps this migration safely idempotent.
-- =============================================================================

alter table public.user_settings
  add column if not exists remember_last_task_options boolean not null default false;

alter table public.user_settings
  add column if not exists show_project_descriptions boolean not null default false;

comment on column public.user_settings.remember_last_task_options is
  'When true, new tasks reuse the last selected creation options.';
comment on column public.user_settings.show_project_descriptions is
  'When true, project cards show the project description.';
