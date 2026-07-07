// Standalone unit test for the echo-suppression registry (src/data/echo.ts).
//
// Unlike run-integration.mjs this needs NO database — echo.ts is a pure,
// dependency-free module. We bundle it with esbuild (dev-only, same as the
// integration test) and assert the dedup semantics that keep inbound Realtime
// events from re-applying our own outbound writes (no loops / conflicts).
//
//   node test/run-echo.mjs
import { build } from 'esbuild'
import { pathToFileURL } from 'url'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync } from 'fs'
import assert from 'assert'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const out = resolve(__dirname, '.build')
mkdirSync(out, { recursive: true })

await build({
  entryPoints: { echo: resolve(root, 'src/data/echo.ts') },
  bundle: true, format: 'esm', platform: 'node', outdir: out, logLevel: 'error',
})
const { markWritten, markWrittenMany, isEcho, echoKey, resetEcho } =
  await import(pathToFileURL(resolve(out, 'echo.js')))

let n = 0
const ok = (c, m) => { assert.ok(c, m); console.log('  \u2713', m); n++ }

console.log('\n[echo] dedup / echo-suppression semantics')

// A key we never wrote is a genuine remote change → must apply.
ok(isEcho('tasks', 'x') === false, 'unknown key is not an echo')

// A key we just wrote is our own echo — but only once. The entry is consumed
// on the first hit so a genuinely-remote edit to the same row later applies.
markWritten('tasks', 'a')
ok(isEcho('tasks', 'a') === true, 'our recent write is recognised as an echo')
ok(isEcho('tasks', 'a') === false, 'echo consumed after one hit (later remote change passes)')

// Composite keys (task_tags: task_id.tag_id) and batch registration.
markWrittenMany('task_tags', ['t1.g1', 't1.g2'])
ok(isEcho('task_tags', 't1.g1') === true, 'batch-marked composite key #1 suppressed')
ok(isEcho('task_tags', 't1.g2') === true, 'batch-marked composite key #2 suppressed')
ok(isEcho('task_tags', 't1.g3') === false, 'unmarked composite key not suppressed')

// Keys are scoped per-table so identical ids on different tables don't collide.
markWritten('projects', 'shared')
ok(isEcho('tags', 'shared') === false, 'same pk on a different table is not an echo')
ok(isEcho('projects', 'shared') === true, 'echo matched on the correct table')

ok(echoKey('tasks', 'z') === 'tasks:z', 'echoKey composes table:pk')

// Sign-out clears everything so no state leaks across accounts.
markWritten('tasks', 'keep')
resetEcho()
ok(isEcho('tasks', 'keep') === false, 'resetEcho clears all recorded writes')

console.log(`\n\u2705 echo: all ${n} assertions passed.`)
process.exit(0)
