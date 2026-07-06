// Minimal Supabase-client emulation backed by a real PostgreSQL connection.
// Implements only the query-builder surface used by the data layer:
//   from(table).select(cols).order(col,{ascending}) -> await -> {data,error}
//   from(table).select(cols).maybeSingle()          -> await -> {data,error}
//   from(table).upsert(rows,{onConflict})            -> await -> {error}
//   from(table).insert(rows)                         -> await -> {error}
//   from(table).delete().in(col, vals)               -> await -> {error}
//   from(table).delete().eq(col, val).in(col, vals)  -> await -> {error}
//
// Every statement runs inside a transaction that sets the `authenticated`
// role and the JWT sub claim, so Postgres RLS is enforced exactly as in
// production.
import pg from 'pg'

// Match Supabase REST (PostgREST) wire format, which returns date/time and
// timestamp columns as strings rather than JS Date objects.
pg.types.setTypeParser(1082, (v) => v)  // date  -> 'YYYY-MM-DD'
pg.types.setTypeParser(1083, (v) => v)  // time  -> 'HH:MM:SS'
pg.types.setTypeParser(1114, (v) => v)  // timestamp
pg.types.setTypeParser(1184, (v) => v)  // timestamptz
pg.types.setTypeParser(20, (v) => parseInt(v, 10)) // bigint -> number (size_bytes)

const camelCols = new Set(['order']) // reserved words needing quotes

function q(col) {
  return camelCols.has(col) ? `"${col}"` : col
}

export function makeClient(pool, getUserId) {
  async function run(text, values) {
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query("set local role authenticated")
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [getUserId()])
      const res = await client.query(text, values)
      await client.query('commit')
      return res
    } catch (e) {
      try { await client.query('rollback') } catch {}
      throw e
    } finally {
      client.release()
    }
  }

  function builder(table) {
    const state = { op: 'select', cols: '*', order: null, filters: [], rows: null, single: false }

    const thenable = {
      select(cols = '*') { state.op = 'select'; state.cols = cols; return thenable },
      order(col, opts = {}) { state.order = { col, asc: opts.ascending !== false }; return thenable },
      maybeSingle() { state.single = true; return thenable },
      upsert(rows) { state.op = 'upsert'; state.rows = Array.isArray(rows) ? rows : [rows]; return thenable },
      insert(rows) { state.op = 'insert'; state.rows = Array.isArray(rows) ? rows : [rows]; return thenable },
      delete() { state.op = 'delete'; return thenable },
      eq(col, val) { state.filters.push({ kind: 'eq', col, val }); return thenable },
      in(col, vals) { state.filters.push({ kind: 'in', col, vals }); return thenable },
      then(resolve, reject) { execute().then(resolve, reject) },
    }

    async function execute() {
      try {
        if (state.op === 'select') {
          let text = `select ${state.cols} from ${table}`
          if (state.order) text += ` order by ${q(state.order.col)} ${state.order.asc ? 'asc' : 'desc'}`
          const res = await run(text, [])
          if (state.single) return { data: res.rows[0] ?? null, error: null }
          return { data: res.rows, error: null }
        }
        if (state.op === 'upsert' || state.op === 'insert') {
          if (!state.rows.length) return { data: null, error: null }
          const cols = Object.keys(state.rows[0])
          const colList = cols.map(q).join(', ')
          const valuesSql = []
          const params = []
          let i = 1
          for (const row of state.rows) {
            const ph = cols.map(() => `$${i++}`)
            valuesSql.push(`(${ph.join(', ')})`)
            for (const c of cols) params.push(row[c] === undefined ? null : row[c])
          }
          let text = `insert into ${table} (${colList}) values ${valuesSql.join(', ')}`
          if (state.op === 'upsert') {
            // Conflict target: pk. For task_tags it's (task_id,tag_id); default 'id'.
            const conflict = table === 'task_tags' ? '(task_id, tag_id)'
              : table === 'user_settings' ? '(user_id)' : '(id)'
            const updates = cols.filter(c => !['id','task_id','tag_id','user_id'].includes(c))
              .map(c => `${q(c)} = excluded.${q(c)}`)
            text += updates.length
              ? ` on conflict ${conflict} do update set ${updates.join(', ')}`
              : ` on conflict ${conflict} do nothing`
          }
          await run(text, params)
          return { data: null, error: null }
        }
        if (state.op === 'delete') {
          let text = `delete from ${table}`
          const clauses = []
          const params = []
          let i = 1
          for (const f of state.filters) {
            if (f.kind === 'eq') { clauses.push(`${q(f.col)} = $${i++}`); params.push(f.val) }
            else if (f.kind === 'in') {
              if (!f.vals.length) { clauses.push('false'); continue }
              const ph = f.vals.map(() => `$${i++}`)
              clauses.push(`${q(f.col)} in (${ph.join(', ')})`)
              params.push(...f.vals)
            }
          }
          if (clauses.length) text += ` where ${clauses.join(' and ')}`
          await run(text, params)
          return { data: null, error: null }
        }
        return { data: null, error: null }
      } catch (e) {
        return { data: null, error: e }
      }
    }

    return thenable
  }

  return { from: (table) => builder(table) }
}

export function makePool() {
  return new pg.Pool({ host: '127.0.0.1', port: 5433, user: 'postgres', database: 'postgres' })
}
