-- =============================================================================
-- 0006  Multi-Select toggle + calendar visible time-range preferences
-- =============================================================================
-- Adds three new columns to `user_settings` backing new App Settings:
--
--   • multi_select_enabled   — master switch for Multi-Select mode. When OFF,
--                              the hover selection checkbox is hidden, the
--                              mobile long-press gesture never enters selection
--                              mode, and Ctrl/Cmd click / Ctrl+A are inert.
--   • calendar_start_hour     — first visible hour (0–23) in the Day/Week
--                              calendar views.
--   • calendar_end_hour       — last visible hour (1–24) in the Day/Week
--                              calendar views. 24 means "up to midnight".
--
-- Defaults preserve prior behaviour: multi-select enabled, 0:00–24:00 range.
-- `add column if not exists` keeps this migration safely idempotent.
-- =============================================================================

alter table public.user_settings
  add column if not exists multi_select_enabled boolean not null default true;

alter table public.user_settings
  add column if not exists calendar_start_hour integer not null default 0;

alter table public.user_settings
  add column if not exists calendar_end_hour integer not null default 24;

comment on column public.user_settings.multi_select_enabled is
  'Master switch for Multi-Select mode (hover checkbox, long-press, shortcuts).';
comment on column public.user_settings.calendar_start_hour is
  'First visible hour (0-23) in the Day/Week calendar views.';
comment on column public.user_settings.calendar_end_hour is
  'Last visible hour (1-24) in the Day/Week calendar views.';
