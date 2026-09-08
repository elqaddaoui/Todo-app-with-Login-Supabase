// Real Chromium touch-input regression tests against the production TaskList.
// No account or database is used: test-only exports are appended while bundling.
// Setup: npm install --prefix test/.build playwright
//        PLAYWRIGHT_BROWSERS_PATH=$PWD/test/.build/browsers node test/.build/node_modules/playwright/cli.js install chromium
// Run with Vite on port 5173: node test/run-task-dnd.mjs
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = resolve(root, 'test/.build')
await mkdir(out, { recursive: true })
process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve(out, 'browsers')
const { chromium } = await import('./.build/node_modules/playwright/index.mjs')
await build({
  stdin: {
    resolveDir: root, loader: 'tsx',
    contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { MemoryRouter } from 'react-router-dom'
      import { TaskList, useData, useUI, useSelection } from './src/App'
      const root = createRoot(document.getElementById('root'))
      let version = 0
      const task = (id, parentId, order) => ({
        id, title: id, parentId, order, status: 'not_started', priority: 'medium',
        category: 'work', tags: [], checklist: [], comments: [], images: [],
        attachments: [], activity: [], createdAt: '2026-09-08T00:00:00Z',
        updatedAt: '2026-09-08T00:00:00Z', description: 'A task with details',
      })
      function Fixture() {
        const tasks = useData(s => s.tasks)
        return <MemoryRouter><main style={{padding: 12, maxWidth: 900}}>
          <TaskList tasks={tasks} />
        </main></MemoryRouter>
      }
      function reset(compact = false) {
        window.scrollTo(0, 0)
        document.documentElement.classList.toggle('compact-mode', compact)
        useUI.setState({ compactMode: compact, dndEnabled: true, details: false, multiSelectEnabled: true })
        useSelection.setState({ ids: new Set(), active: false, anchor: null })
        useData.setState({ tasks: [task('Source', undefined, 0), task('Source child', 'Source', 0),
          task('Parent', undefined, 1), task('Child', 'Parent', 0),
          task('Grandchild', 'Child', 0), task('Sibling', 'Parent', 1),
          task('Target', undefined, 2)], projects: [], tags: [] })
        root.render(<Fixture key={++version} />)
      }
      window.fixture = { reset, useData, useUI, useSelection, unmount: () => root.unmount() }
      reset()
    `,
  },
  bundle: true, format: 'esm', platform: 'browser', outfile: resolve(out, 'task-dnd.js'),
  loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'test-only-exports', setup(b) {
    b.onLoad({ filter: /\/src\/App\.tsx$/ }, async ({ path }) => ({
      contents: await readFile(path, 'utf8') + '\nexport { TaskList, useData, useUI, useSelection }',
      loader: 'tsx', resolveDir: resolve(root, 'src'),
    }))
  }}],
  logLevel: 'error',
})
await writeFile(resolve(out, 'task-dnd.html'), `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/src/index.css"></head><body><div id="root"></div>
<script type="module" src="./task-dnd.js"></script></body></html>`)

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], downloadsPath: out })
let checks = 0
const ok = (condition, label) => { assert.ok(condition, label); checks++; console.log('PASS', label) }
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  // Never allow fixtures to communicate with the real Supabase backend.
  await context.route('**/*.supabase.co/**', route => route.abort())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`${process.env.DND_TEST_URL || 'http://localhost:5173'}/test/.build/task-dnd.html`)
  await page.waitForFunction(() => window.fixture)
  const cdp = await context.newCDPSession(page)
  const row = title => page.locator('.task-row').filter({ has: page.locator('.task-row-title', { hasText: new RegExp(`^${title}$`) }) })
  const touch = (type, point) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: point ? [{ x: point.x, y: point.y, id: 1, radiusX: 3, radiusY: 3 }] : [],
  })
  const reset = async compact => {
    await page.evaluate(compact => window.fixture.reset(compact), compact)
    await page.waitForTimeout(300)
  }
  const begin = async (title, fx = .5, fy = .5) => {
    const handle = row(title).locator('.task-drag-handle')
    const rect = await handle.boundingBox()
    ok(rect && rect.width >= 44 && rect.height >= 44, `${title}: handle is at least 44 by 44`)
    await handle.evaluate(node => { window.sourceHandle = node })
    const point = { x: rect.x + rect.width * fx, y: rect.y + rect.height * fy }
    await touch('touchStart', point)
    await touch('touchMove', { x: point.x - 8, y: point.y })
    await page.waitForSelector('body.is-dnd-dragging', { timeout: 1500 })
    ok(await page.evaluate(() => window.sourceHandle.isConnected), 'touch activator stays connected after lift')
    await page.waitForTimeout(60)
  }
  const moveTo = async (title, mode = 'inside') => {
    const rect = await row(title).boundingBox()
    const point = { x: Math.max(50, Math.min(300, rect.x + rect.width / 2)),
      y: mode === 'above' ? rect.y + 8 : mode === 'below' ? rect.y + rect.height - 8 : rect.y + rect.height / 2 }
    await touch('touchMove', point)
    const selector = mode === 'inside' ? '.task-row-nest-target' : `.task-drop-line-${mode === 'above' ? 'top' : 'bottom'}`
    await page.waitForSelector(selector, { timeout: 1500 })
    ok(await row(title).evaluate((node, mode) => mode === 'inside'
      ? node.classList.contains('task-row-nest-target')
      : node.parentElement.classList.contains(mode === 'above' ? 'has-line-above' : 'has-line-below'), mode),
    `${title}: ${mode} indicator follows finger`)
    ok(await page.locator('.task-row-nest-target, .task-drop-line').count() === 1, 'exactly one drop indicator')
  }
  const released = async (cancel = false) => {
    await touch(cancel ? 'touchCancel' : 'touchEnd')
    await page.waitForFunction(() => !document.body.classList.contains('is-dnd-dragging'))
    ok(await page.locator('.task-row-nest-target, .task-drop-line, .task-drag-preview').count() === 0, 'drag visuals clear on release/cancel')
  }
  for (const compact of [false, true]) {
    console.log('\nDensity:', compact ? 'compact' : 'spacious')
    for (const source of ['Source', 'Source child']) {
      await reset(compact)
      await begin(source, .15, .85)
      for (const target of ['Parent', 'Child', 'Grandchild']) await moveTo(target)
      await released()
      ok(await page.evaluate(source => window.fixture.useData.getState().tasks.find(t => t.id === source).parentId === 'Grandchild', source),
        `${source}: drops into a grandchild`)
    }
    for (const mode of ['above', 'below']) {
      await reset(compact)
      await begin('Source child', .85, .15)
      await moveTo('Child', mode)
      await released()
      const siblings = await page.evaluate(() => window.fixture.useData.getState().tasks
        .filter(t => t.parentId === 'Parent').sort((a, b) => a.order - b.order).map(t => t.id))
      ok(siblings.indexOf('Source child') === siblings.indexOf('Child') + (mode === 'above' ? -1 : 1),
        `${mode}: release reorders at the indicated child position`)
    }
    await reset(compact)
    await begin('Source')
    await moveTo('Child')
    await touch('touchMove', { x: 2, y: 2 })
    await page.waitForFunction(() => !document.querySelector('.task-row-nest-target, .task-drop-line'))
    await released()
    ok(await page.evaluate(() => !window.fixture.useData.getState().tasks.find(t => t.id === 'Source').parentId), 'outside drop makes no change')
    await reset(compact)
    await begin('Source child')
    await moveTo('Grandchild')
    await released(true)
    ok(await page.evaluate(() => window.fixture.useData.getState().tasks.find(t => t.id === 'Source child').parentId === 'Source'), 'touch cancellation preserves hierarchy')
  }
  ok(errors.length === 0, `no browser exceptions: ${errors.join('; ')}`)
  console.log(`\n${checks} mobile drag checks passed`)
} finally {
  await browser.close()
}
