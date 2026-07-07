/* ============================================================
   Echo-suppression registry.

   The outbound sync engine (src/data/sync.ts) writes the local optimistic
   state to Supabase. Those very writes come straight back to us over the
   Realtime channel as postgres_changes events. If we blindly applied them
   to the store we'd create an update loop and clobber newer local edits.

   To break the loop we record a fingerprint for every row we write, keyed
   by `table:primaryKey`. When an inbound Realtime event arrives, the
   realtime layer asks `isEcho(table, pk, payload)` whether this change was
   caused by our own write and, if so, drops it.

   Matching is intentionally forgiving:
     • Any event for a key we wrote within ECHO_TTL_MS is treated as an echo
       (covers the common case where the DB round-trips our exact write).
     • Entries auto-expire so a genuine remote change to the same row that
       arrives later is NOT swallowed.

   This module holds no Supabase or store references, so both the outbound
   (sync) and inbound (realtime) layers can import it with zero cycles.
   ============================================================ */

/* How long a recorded write stays "ours". Comfortably covers the DB
   round-trip + Realtime fan-out (typically < 1s) while staying short enough
   that a real remote edit to the same row moments later still applies. */
const ECHO_TTL_MS = 6000

/* key (`table:pk`) -> expiry timestamp (ms). */
const recent = new Map<string, number>()

/* Periodically drop expired entries so the map can't grow unbounded during
   long sessions. Interval is unref'd where supported so it never keeps a
   process alive (harmless in the browser). */
let sweeper: ReturnType<typeof setInterval> | null = null
function ensureSweeper() {
  if (sweeper) return
  sweeper = setInterval(() => {
    const now = Date.now()
    for (const [k, exp] of recent) if (exp <= now) recent.delete(k)
    if (recent.size === 0 && sweeper) { clearInterval(sweeper); sweeper = null }
  }, ECHO_TTL_MS)
  ;(sweeper as unknown as { unref?: () => void }).unref?.()
}

/** Build the canonical `table:pk` key. `pk` may be a composite string. */
export function echoKey(table: string, pk: string): string {
  return `${table}:${pk}`
}

/** Record that WE just wrote this row, so the inbound echo can be ignored. */
export function markWritten(table: string, pk: string): void {
  recent.set(echoKey(table, pk), Date.now() + ECHO_TTL_MS)
  ensureSweeper()
}

/** Record a batch of primary keys for one table in a single call. */
export function markWrittenMany(table: string, pks: string[]): void {
  if (pks.length === 0) return
  const exp = Date.now() + ECHO_TTL_MS
  for (const pk of pks) recent.set(echoKey(table, pk), exp)
  ensureSweeper()
}

/**
 * True when an inbound change for `table:pk` was (very likely) caused by our
 * own recent write and should therefore be dropped. Consumes the entry on a
 * hit so a later, genuinely-remote change to the same row is still applied.
 */
export function isEcho(table: string, pk: string): boolean {
  const key = echoKey(table, pk)
  const exp = recent.get(key)
  if (exp === undefined) return false
  if (exp <= Date.now()) { recent.delete(key); return false }
  // One write => one echo. Remove so subsequent remote edits pass through.
  recent.delete(key)
  return true
}

/** Clear everything (used on sign-out so no state leaks across accounts). */
export function resetEcho(): void {
  recent.clear()
  if (sweeper) { clearInterval(sweeper); sweeper = null }
}
