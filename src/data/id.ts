/* ============================================================
   ID generation.

   The database uses UUID primary keys. Previously the app minted IDs with
   `Date.now()` strings, which are not valid UUIDs and would be rejected by
   the `uuid` columns. All client-side ID creation now routes through
   `newId()` so inserted rows carry DB-compatible UUIDs.
   ============================================================ */

export function newId(): string {
  // crypto.randomUUID is available in all modern browsers and Node 19+.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // RFC4122-ish fallback for very old environments.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
