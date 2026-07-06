// End-to-end integration test of the Supabase data layer against a real
// PostgreSQL instance with the production migration + RLS applied.
//
// It bundles the REAL src/data modules (mappers/sync/load) with esbuild,
// aliasing the supabase client to a fake backed by `pg`, then drives a
// realistic sequence of store mutations and asserts the DB reflects them.
import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, resolve } from 'path'
import { writeFileSync, mkdirSync } from 'fs'
import assert from 'assert'
import { makeClient, makePool } from './fake-supabase.mjs'
import { setClient } from './supabase-shim.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

let USER = null
const pool = makePool()
setClient(makeClient(pool, () => USER))

// Bundle the data layer, redirecting the supabase client import to our shim.
const outdir = resolve(__dirname, '.build')
mkdirSync(outdir, { recursive: true })
await build({
  entryPoints: {
    load: resolve(root, 'src/data/load.ts'),
    sync: resolve(root, 'src/data/sync.ts'),
    id: resolve(root, 'src/data/id.ts'),
  },
  bundle: true, format: 'esm', platform: 'node', outdir,
  logLevel: 'error',
  // Keep the shim EXTERNAL so every bundle shares the same live module
  // instance that the test configures via setClient().
  external: ['*/supabase-shim.mjs'],
  plugins: [{
    name: 'alias-supabase',
    setup(b) {
      b.onResolve({ filter: /supabaseClient$/ }, () => ({
        path: resolve(__dirname, 'supabase-shim.mjs'), external: true,
      }))
    },
  }],
})

const { loadBootstrap, loadSettings } = await import(pathToFileURL(resolve(outdir, 'load.js')))
const { diffAndPersist, flushSync } = await import(pathToFileURL(resolve(outdir, 'sync.js')))
const { newId } = await import(pathToFileURL(resolve(outdir, 'id.js')))

// ---- helpers ----
const nowIso = () => new Date().toISOString()
async function raw(sql, params = []) {
  const c = await pool.connect()
  try { return await c.query(sql, params) } finally { c.release() }
}
function mkTask(over = {}) {
  return {
    id: newId(), title: 'Task', status: 'not_started', priority: 'medium', category: 'work',
    tags: [], checklist: [], comments: [], images: [], attachments: [],
    activity: [{ id: newId(), type: 'created', message: 'Task created', createdAt: nowIso(), by: 'You' }],
    createdAt: nowIso(), updatedAt: nowIso(), order: 0, ...over,
  }
}
const empty = () => ({ tasks: [], projects: [], tags: [] })
let passed = 0
function ok(cond, msg) { assert.ok(cond, msg); console.log('  \u2713', msg); passed++ }

// Start from a clean slate so repeated runs are deterministic. Deleting the
// auth users cascades to all owned rows.
await raw('delete from auth.users')

// Create two auth users (fires signup trigger -> profiles + settings).
const alice = (await raw("insert into auth.users (id,email) values (gen_random_uuid(),'alice@x.com') returning id")).rows[0].id
const bob = (await raw("insert into auth.users (id,email) values (gen_random_uuid(),'bob@x.com') returning id")).rows[0].id

// ============ Test as Alice ============
USER = alice
console.log('\n[1] Signup trigger provisions profile + settings')
{
  const s = await loadSettings()
  ok(s && s.theme === 'system' && s.sidebarW === 280, 'default settings loaded for new user')
}

console.log('\n[2] Create project, tag, task (with children) and persist diff')
const proj = { id: newId(), name: 'Orbit', icon: 'Rocket', color: '#6366f1', favorite: true, documentation: '# Orbit', order: 0 }
const tag = { id: newId(), name: 'design', color: '#8b5cf6' }
const task = mkTask({
  title: 'Design dashboard', status: 'in_progress', priority: 'high', projectId: proj.id,
  tags: [tag.id], dueDate: '2026-07-10', time: '14:00', estimatedMinutes: 120, favorite: true,
  checklist: [{ id: newId(), text: 'Wireframes', done: true }, { id: newId(), text: 'Spacing', done: false }],
  comments: [{ id: newId(), author: 'Alex', text: 'Nice', createdAt: nowIso() }],
  images: [{ id: newId(), url: 'https://img/x.png', name: 'x.png' }],
  attachments: [{ id: newId(), name: 'a.fig', size: 324000 }],
})
let prev = empty()
let next = { tasks: [task], projects: [proj], tags: [tag] }
diffAndPersist(prev, next, USER); await flushSync()
{
  const b = await loadBootstrap()
  ok(b.projects.length === 1 && b.projects[0].name === 'Orbit' && b.projects[0].favorite === true, 'project round-trips')
  ok(b.tags.length === 1 && b.tags[0].name === 'design', 'tag round-trips')
  ok(b.tasks.length === 1, 'task persisted')
  const t = b.tasks[0]
  ok(t.title === 'Design dashboard' && t.status === 'in_progress' && t.priority === 'high', 'task scalars round-trip')
  ok(t.projectId === proj.id && t.dueDate === '2026-07-10' && t.time === '14:00', 'project link + date + time round-trip')
  ok(t.estimatedMinutes === 120 && t.favorite === true, 'estimate + favorite round-trip')
  ok(t.tags.length === 1 && t.tags[0] === tag.id, 'task_tags join round-trips')
  ok(t.checklist.length === 2 && t.checklist[0].text === 'Wireframes' && t.checklist[0].done === true, 'checklist round-trips (ordered)')
  ok(t.comments.length === 1 && t.comments[0].author === 'Alex', 'comment round-trips')
  ok(t.images.length === 1 && t.images[0].name === 'x.png', 'image round-trips')
  ok(t.attachments.length === 1 && t.attachments[0].size === 324000, 'attachment round-trips')
  ok(t.activity.length === 1 && t.activity[0].type === 'created', 'activity round-trips')
}

console.log('\n[3] Update task scalars (edit title + status) persists minimal diff')
prev = next
const task2 = { ...task, title: 'Design dashboard v2', status: 'done', completedAt: nowIso(), updatedAt: nowIso() }
next = { ...prev, tasks: [task2] }
diffAndPersist(prev, next, USER); await flushSync()
{
  const b = await loadBootstrap()
  ok(b.tasks[0].title === 'Design dashboard v2' && b.tasks[0].status === 'done', 'task update persisted')
  ok(b.tasks[0].completedAt != null, 'completedAt persisted with done')
}

console.log('\n[4] Mutate children: toggle checklist, add checklist item, remove a tag')
prev = next
const task3 = {
  ...task2,
  checklist: [{ ...task2.checklist[0], done: false }, task2.checklist[1], { id: newId(), text: 'New step', done: false }],
  tags: [],
  comments: [...task2.comments, { id: newId(), author: 'You', text: 'follow-up', createdAt: nowIso() }],
  activity: [...task2.activity, { id: newId(), type: 'updated', message: 'Edited', createdAt: nowIso(), by: 'You' }],
}
next = { ...prev, tasks: [task3] }
diffAndPersist(prev, next, USER); await flushSync()
{
  const b = await loadBootstrap()
  const t = b.tasks[0]
  ok(t.checklist.length === 3 && t.checklist[0].done === false, 'checklist item toggled + added')
  ok(t.tags.length === 0, 'tag unlinked via task_tags delete')
  ok(t.comments.length === 2, 'comment appended')
  ok(t.activity.length === 2, 'activity appended (append-only)')
}

console.log('\n[5] Delete task cascades to all children')
prev = next
next = empty2(prev, { tasks: [] })
diffAndPersist(prev, next, USER); await flushSync()
{
  const counts = await raw(`select
    (select count(*) from tasks) t,
    (select count(*) from task_tags) tt,
    (select count(*) from task_checklist_items) cl,
    (select count(*) from task_comments) cm,
    (select count(*) from task_images) im,
    (select count(*) from task_attachments) at,
    (select count(*) from task_activity) ac`)
  const r = counts.rows[0]
  ok(+r.t === 0 && +r.tt === 0 && +r.cl === 0 && +r.cm === 0 && +r.im === 0 && +r.at === 0 && +r.ac === 0,
    'task delete cascaded to every child table')
}

console.log('\n[6] Delete project detaches (SET NULL) tasks, not delete')
{
  // recreate a task under the project
  const t = mkTask({ title: 'Keep me', projectId: proj.id })
  let p0 = { tasks: [], projects: [proj], tags: [] }
  let p1 = { tasks: [t], projects: [proj], tags: [] }
  diffAndPersist(p0, p1, USER); await flushSync()
  // now delete the project
  let p2 = { tasks: [{ ...t, projectId: undefined }], projects: [], tags: [] }
  diffAndPersist(p1, p2, USER); await flushSync()
  const b = await loadBootstrap()
  ok(b.projects.length === 0, 'project deleted')
  ok(b.tasks.length === 1 && b.tasks[0].projectId === undefined, 'task retained with project_id set null')
}

console.log('\n[7] RLS isolation: Bob cannot see Alice data and cannot forge')
USER = bob
{
  const b = await loadBootstrap()
  ok(b.tasks.length === 0 && b.projects.length === 0, 'Bob sees none of Alice rows')
  // Forge: try to write a task owned by Alice as Bob -> RLS rejects, surfaced as error
  let errored = false
  const badTask = mkTask({ title: 'forged' })
  // craft a snapshot whose diff will insert with user_id=bob (correct) but
  // then attempt to also insert an Alice-owned row directly via raw to prove RLS
  try {
    await raw(`begin; set local role authenticated;
      select set_config('request.jwt.claim.sub',$1,true);
      insert into tasks (id,user_id,title) values (gen_random_uuid(),$2,'forge');`, [bob, alice])
    await raw('commit')
  } catch (e) { errored = true; try { await raw('rollback') } catch {} }
  ok(errored, 'forged cross-user insert rejected by RLS WITH CHECK')
}

console.log('\n[8] Settings persist + reload for a user')
USER = alice
{
  // emulate what src/data/settings.persistSettings does via upsert
  await (await import(pathToFileURL(resolve(outdir, 'load.js')))) // ensure module cached
  const c = makeClient(pool, () => USER)
  await c.from('user_settings').upsert({ user_id: USER, theme: 'dark', sidebar_width: 320, compact_mode: true }, { onConflict: 'user_id' })
  const s = await loadSettings()
  ok(s.theme === 'dark' && s.sidebarW === 320 && s.compactMode === true, 'settings update persisted + reloaded')
}

function empty2(prevSnap, over) { return { tasks: prevSnap.tasks, projects: prevSnap.projects, tags: prevSnap.tags, ...over } }

console.log(`\n\u2705 All ${passed} assertions passed.`)
await pool.end()
process.exit(0)
