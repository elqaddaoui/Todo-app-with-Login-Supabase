// Test-only replacement for src/supabaseClient. The test injects a fake
// client (backed by real PostgreSQL) via setClient() before exercising the
// data layer. Exported `supabase` is a proxy that forwards to it.
let impl = null
export function setClient(c) { impl = c }
export const supabase = new Proxy({}, {
  get(_t, prop) {
    if (!impl) throw new Error('supabase client not set in test')
    return impl[prop]
  },
})
