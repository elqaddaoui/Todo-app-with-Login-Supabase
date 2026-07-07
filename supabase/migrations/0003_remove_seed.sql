-- =============================================================================
-- Orbit — Todo + Calendar :: 0003 remove first-run demo seeding
-- =============================================================================
-- Why this migration exists
-- -------------------------
-- Earlier the client seeded a small set of DEMO tasks/projects/tags into a
-- brand-new account on first launch, gated by an atomic server-side claim
-- (`claim_initial_seed()` / `profiles.seeded_at`, added in migration 0002).
--
-- That behaviour is now REMOVED entirely: a production account must never
-- receive demo tasks, demo projects, demo tags or any sample content. Every
-- account — new or returning — now starts with only the minimum per-user
-- records (profile + settings, created by the `handle_new_user()` signup
-- trigger from migration 0001). All application data stays empty until the
-- user creates it.
--
-- This migration retires the seed-claim mechanism so nothing on the server
-- can be mistaken for a live seeding hook. It is idempotent and safe to run on
-- databases that never had 0002 applied.
-- =============================================================================

-- 1. Drop the one-time seed-claim RPC (no longer called by the client) -------
drop function if exists public.claim_initial_seed();

-- 2. Retire the seed-claim bookkeeping column --------------------------------
-- `profiles.seeded_at` only ever tracked the (now-removed) demo seed. It is no
-- longer read or written by any code path, so drop it to avoid confusion.
alter table public.profiles
  drop column if exists seeded_at;

-- =============================================================================
-- End of migration
-- =============================================================================
