// Standalone unit test for the Status Board visibility preference.
//
// Covers the two pure pieces that decide what a project's Status Board shows:
//   • normalizeVisibleStatusBoards (src/data/types.ts) — the guard that keeps a
//     stored selection valid, ordered and never empty.
//   • the settings row <-> domain mappers (src/data/mappers.ts) — including the
//     "all boards visible is stored as NULL" convention.
//
// Needs NO database: both modules are pure. Bundled with esbuild the same way
// as run-echo.mjs.
//
//   node test/run-status-boards.mjs
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
  entryPoints: {
    'status-types': resolve(root, 'src/data/types.ts'),
    'status-mappers': resolve(root, 'src/data/mappers.ts'),
  },
  bundle: true, format: 'esm', platform: 'node', outdir: out, logLevel: 'error',
})
const { normalizeVisibleStatusBoards, STATUS_BOARD_ORDER } =
  await import(pathToFileURL(resolve(out, 'status-types.js')))
const { rowToSettings, settingsToRow } =
  await import(pathToFileURL(resolve(out, 'status-mappers.js')))

let n = 0
const ok = (c, m) => { assert.ok(c, m); console.log('  \u2713', m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); console.log('  \u2713', m); n++ }

const ALL = STATUS_BOARD_ORDER

console.log('\n[status-boards] normalizeVisibleStatusBoards')

// Absent / malformed values mean "never customised" -> show every board, so a
// fresh account and a corrupt localStorage entry both land on the full board.
eq(normalizeVisibleStatusBoards(undefined), ALL, 'undefined falls back to all boards')
eq(normalizeVisibleStatusBoards(null), ALL, 'null falls back to all boards')
eq(normalizeVisibleStatusBoards('done'), ALL, 'non-array falls back to all boards')

// An empty selection would leave a project page with zero columns — an
// unrecoverable dead end — so it is treated as "all".
eq(normalizeVisibleStatusBoards([]), ALL, 'empty array falls back to all boards')
eq(normalizeVisibleStatusBoards(['nope', 'bogus']), ALL, 'all-unknown keys fall back to all boards')

// Unknown keys (schema drift, hand-edited rows) are dropped, valid ones kept.
eq(normalizeVisibleStatusBoards(['done', 'nope']), ['done'], 'unknown keys are dropped')

// The result is always in canonical board order regardless of input order, so
// the columns never render left-to-right in whatever order they were clicked.
eq(
  normalizeVisibleStatusBoards(['done', 'not_started', 'in_progress']),
  ['not_started', 'in_progress', 'done'],
  'selection is re-sorted into canonical board order',
)

// Duplicates must not render the same column twice.
eq(normalizeVisibleStatusBoards(['done', 'done', 'planned']), ['planned', 'done'], 'duplicates are removed')

// A single board is a legal selection (it's the *last* one that gets locked in
// the UI, not rejected by the normalizer).
eq(normalizeVisibleStatusBoards(['blocked']), ['blocked'], 'a single board is kept as-is')

console.log('\n[status-boards] settings row mapping')

const baseRow = {
  user_id: 'u1', theme: 'system', sidebar_width: 280, details_width: 380,
  compact_mode: false, dnd_enabled: true, calendar_side_panel: true,
  undo_toast_enabled: true, undo_toast_duration: 2000,
  remember_last_task_options: false, show_project_descriptions: false,
  multi_select_enabled: true, calendar_start_hour: 0, calendar_end_hour: 24,
}

// NULL in the DB means "never customised" -> every board, so users who never
// touch the setting automatically pick up any status added later.
eq(
  rowToSettings({ ...baseRow, visible_status_boards: null }).visibleStatusBoards,
  ALL,
  'NULL column reads back as all boards',
)
eq(
  rowToSettings({ ...baseRow, visible_status_boards: ['done', 'planned'] }).visibleStatusBoards,
  ['planned', 'done'],
  'stored subset reads back ordered',
)
eq(
  rowToSettings({ ...baseRow, visible_status_boards: [] }).visibleStatusBoards,
  ALL,
  'empty column reads back as all boards (never a zero-column board)',
)

// Writing "everything visible" collapses to NULL to preserve that meaning.
ok(
  settingsToRow({ visibleStatusBoards: [...ALL] }, 'u1').visible_status_boards === null,
  'selecting every board persists as NULL',
)
eq(
  settingsToRow({ visibleStatusBoards: ['done', 'planned'] }, 'u1').visible_status_boards,
  ['planned', 'done'],
  'a subset persists as an ordered array',
)

// Round-trip: a subset survives write -> read unchanged.
const roundTripped = rowToSettings({
  ...baseRow,
  visible_status_boards: settingsToRow({ visibleStatusBoards: ['blocked', 'not_started'] }, 'u1').visible_status_boards,
}).visibleStatusBoards
eq(roundTripped, ['not_started', 'blocked'], 'subset survives a write/read round-trip')

// Unrelated settings must not gain a board key just because we touched them.
ok(
  settingsToRow({ compactMode: true }, 'u1').visible_status_boards === undefined,
  'patching another setting leaves visible_status_boards untouched',
)

console.log(`\n\u2705 status-boards: all ${n} assertions passed.`)
