-- =============================================================================
-- Orbit — Todo + Calendar :: 0002 one-time first-run seed claim
-- =============================================================================
-- Problem this migration solves
-- -----------------------------
-- New accounts get a small set of demo tasks/projects/tags seeded by the
-- client on first launch so the app is never empty. The previous client-only
-- heuristic ("if the user has zero rows, seed") could re-run and DUPLICATE the
-- demo content when:
--   * React re-mounts / React Query refetches the bootstrap query, or
--   * a StrictMode double-effect fires, or
--   * a transient read returns empty before the first seed's writes propagate.
--
-- Fix: give every user exactly ONE atomic, server-side seed claim. We add a
-- `seeded_at` timestamp to the guaranteed-per-user `profiles` row and expose a
-- `claim_initial_seed()` function that flips it from NULL → now() exactly once.
-- The function returns TRUE only to the single caller that won the race; every
-- subsequent call (refetch, another device, another tab) returns FALSE, so the
-- client seeds at most once per account — forever. Existing users already have
-- data; we back-fill their `seeded_at` so they are never re-seeded.
-- =============================================================================

-- 1. Add the claim column (idempotent) --------------------------------------
alter table public.profiles
  add column if not exists seeded_at timestamptz;

comment on column public.profiles.seeded_at is
  'Timestamp of the one-time first-run demo-content seed. NULL means the account has never been seeded; set exactly once via claim_initial_seed().';

-- 2. Back-fill EXISTING accounts so they are never seeded again --------------
-- Any profile that already owns at least one project/tag/task predates this
-- claim mechanism; mark it as already seeded so the client never touches it.
update public.profiles p
   set seeded_at = coalesce(p.seeded_at, now())
 where p.seeded_at is null
   and (
     exists (select 1 from public.projects t where t.user_id = p.id) or
     exists (select 1 from public.tags     t where t.user_id = p.id) or
     exists (select 1 from public.tasks    t where t.user_id = p.id)
   );

-- 3. Atomic claim function ---------------------------------------------------
-- Returns TRUE only for the caller that first flips seeded_at from NULL.
-- `security definer` so the single-statement UPDATE runs even though the
-- profiles UPDATE policy is owner-scoped (the WHERE still restricts to the
-- authenticated user, so it can never touch another account's row).
create or replace function public.claim_initial_seed()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed boolean;
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Defensive: ensure a profile row exists for this user (the signup trigger
  -- normally creates it, but a user created before the trigger existed might
  -- be missing one).
  insert into public.profiles (id, display_name)
  values (auth.uid(), 'You')
  on conflict (id) do nothing;

  -- Single atomic UPDATE: only the row whose seeded_at IS NULL is updated, and
  -- only for the current user. Postgres row locking guarantees exactly one
  -- concurrent caller can win.
  update public.profiles
     set seeded_at = now()
   where id = auth.uid()
     and seeded_at is null;

  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

comment on function public.claim_initial_seed() is
  'Atomically claims the one-time first-run seed for the current user. Returns TRUE exactly once (to the first caller); FALSE thereafter.';

-- Allow authenticated clients to call it.
grant execute on function public.claim_initial_seed() to authenticated;

-- =============================================================================
-- End of migration
-- =============================================================================
