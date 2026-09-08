// Real TaskList/TaskRow browser regressions, isolated from auth and Supabase.
// npm install --no-save --package-lock=false playwright
// npx playwright install chromium
// node test/run-task-dnd.mjs
// No production exports, test routes, server, or database writes are needed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = await build({
  stdin: {
    contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { MemoryRouter } from 'react-router-dom'
      import { TaskList, useData, useUI, useSelection, taskCollisionDetection } from './src/App'
      window.testState = { useData, useUI, useSelection, taskCollisionDetection }
      function Harness() {
        const tasks = useData(s => s.tasks)
        return <MemoryRouter><main style={{padding: 12, height: "100vh", overflowY: "auto"}}><TaskList tasks={tasks} /></main></MemoryRouter>
      }
      createRoot(document.getElementById('root')).render(<Harness />)
    `,
    resolveDir: root, sourcefile: 'task-dnd-harness.tsx', loader: 'tsx',
  },
  bundle: true, format: 'iife', platform: 'browser', write: false,
  outfile: resolve(root, 'test/.build/task-dnd.js'),
  define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{
    name: 'expose-current-task-components-for-tests',
    setup(builder) {
      builder.onLoad({ filter: /\/src\/App\.tsx$/ }, ({ path }) => ({
        // Match Vite's CommonJS default interop for the unrelated calendar
        // addon; esbuild alone wraps its Babel default in a second default.
        contents: readFileSync(path, 'utf8').replace(
          "import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'",
          "import calendarDnd from 'react-big-calendar/lib/addons/dragAndDrop'; const withDragAndDrop = calendarDnd.default || calendarDnd",
        ) + '\nexport { TaskList, useData, useUI, useSelection, taskCollisionDetection }',
        loader: 'tsx', resolveDir: dirname(path),
      }))
    },
  }],
})
const css = await postcss([tailwind({
  content: [resolve(root, 'src/**/*.{ts,tsx}')],
}), autoprefixer]).process(readFileSync(resolve(root, 'src/index.css'), 'utf8'), {
  from: resolve(root, 'src/index.css'),
})
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const appCss = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text || ''
const browser = await chromium.launch({ args: ['--no-sandbox'] })
let assertions = 0
const check = (condition, message) => { assert.ok(condition, message); assertions++; console.log('PASS', message) }

try {
  for (const { width, compact, touch } of [
    { width: 390, compact: false, touch: true },
    { width: 390, compact: true, touch: true },
    { width: 320, compact: false, touch: true },
    { width: 768, compact: false, touch: true },
    { width: 1280, compact: false, touch: false },
  ]) {
    const label = `${width}px ${compact ? 'compact' : 'spacious'} ${touch ? 'touch' : 'mouse'}`
    const context = await browser.newContext({
      viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch,
    })
    // Fulfill a synthetic origin entirely in memory. No HTTP service and no
    // requests to the live backend: test state remains in the real local store.
    await context.route('**/*', route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/test.js') return route.fulfill({ contentType: 'text/javascript', body: script })
      if (path === '/test.css') return route.fulfill({ contentType: 'text/css', body: css.css + appCss })
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/test.css"></head><body><div id="root"></div><script src="/test.js"></script></body></html>' })
      return route.abort()
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => { errors.push(error.message); console.error(error) })
    await page.goto('http://task-dnd.test/')
    await page.waitForFunction(() => !!window.testState)
    const reset = async () => {
      await page.evaluate(({ compact }) => {
        const { useData, useUI, useSelection } = window.testState
        useSelection.setState({ ids: new Set(), active: false, anchor: null })
        useUI.getState().set({ compactMode: compact, dndEnabled: true, details: false, selected: undefined })
        document.documentElement.classList.toggle('compact-mode', compact)
        const task = (id, parentId, order) => ({
          id, title: id, parentId, order, status: 'not_started', priority: 'medium', category: 'other',
          description: id === 'source' ? 'A taller card grabbed away from its center' : undefined,
          tags: [], checklist: [], comments: [], attachments: [], activity: [],
          createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z',
        })
        useData.getState().hydrate({ projects: [], tags: [], tasks: [
          task('parent', undefined, 0), task('child', 'parent', 1),
          task('grandchild', 'child', 2), task('other-parent', undefined, 3),
          task('source', undefined, 4), task('source-child', 'source', 5),
          ...Array.from({length: 12}, (_, i) => task(`tail-${i}`, undefined, i + 6)),
        ] })
        document.querySelector('main').scrollTop = 0
      }, { compact })
      await page.waitForTimeout(300)
    }
    const row = id => page.locator('.task-row').filter({ has: page.locator('.task-row-title', { hasText: new RegExp(`^${id}$`) }) })
    const cdp = touch ? await context.newCDPSession(page) : null
    const move = async (x, y) => {
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] })
      else await page.mouse.move(x, y)
      await page.waitForTimeout(35)
    }
    const release = async (cancel = false) => {
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] })
      else if (cancel) { await page.keyboard.press('Escape'); await page.mouse.up() }
      else await page.mouse.up()
      await page.waitForTimeout(70)
    }
    const start = async (id = 'source') => {
      const handle = touch ? row(id).locator('.task-drag-handle') : row(id)
      await handle.scrollIntoViewIfNeeded()
      const box = await handle.boundingBox()
      if (touch) {
        check(box.width >= 44 && box.height >= 44, `${label}: ${id} handle is at least 44px`)
        check(box.x >= 0 && box.x + box.width <= width, `${label}: handle reachable without sideways scrolling`)
        const rowBox = await row(id).boundingBox()
        check(box.y >= rowBox.y && box.y + box.height <= rowBox.y + rowBox.height, `${label}: handle stays within its own row`)
        await handle.evaluate(element => { window.originalHandle = element })
      }
      // Grab near the bottom-left edge, not the grip icon's center.
      const x = box.x + (touch ? 3 : box.width / 2)
      const y = box.y + box.height - 3
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
      else { await page.mouse.move(x, y); await page.mouse.down() }
      await move(x + 9, y - 9)
      await page.waitForFunction(() => document.body.classList.contains('is-dnd-dragging'))
      if (touch) check(await page.evaluate(() => window.originalHandle.isConnected), `${label}: original touch target stays mounted`)
    }
    const hover = async (id, zone = 'inside', side = 'middle') => {
      const box = await row(id).boundingBox()
      const x = side === 'left' ? Math.max(2, box.x + 3)
        : side === 'right' ? Math.min(width - 3, box.x + box.width - 3)
          : Math.min(width - 30, box.x + box.width / 2)
      const y = zone === 'above' ? box.y + 3 : zone === 'below' ? box.y + box.height - 3 : box.y + box.height / 2
      await move(x, y)
      if (zone === 'inside') {
        check(await row(id).evaluate(element => element.classList.contains('task-row-nest-target')), `${label}: ${id} highlights at ${side}`)
        check(await page.locator('.task-row-nest-target').count() === 1, `${label}: exactly one nesting target`)
      } else {
        check(await row(id).evaluate((element, zone) => element.parentElement.classList.contains(zone === 'above' ? 'has-line-above' : 'has-line-below'), zone), `${label}: ${id} ${zone} insertion line`)
      }
    }

    await reset()
    await start()
    for (const id of ['parent', 'child', 'grandchild', 'other-parent']) {
      await hover(id, 'inside', 'left')
      await hover(id, 'inside', 'right')
      await hover(id, 'above')
      await hover(id, 'below')
    }
    await hover('grandchild')
    await release()
    check(await page.evaluate(() => window.testState.useData.getState().tasks.find(t => t.id === 'source').parentId === 'grandchild'), `${label}: drop commits the highlighted grandchild`)
    check(await page.evaluate(() => window.testState.useData.getState().tasks.find(t => t.id === 'source-child').parentId === 'source'), `${label}: dragged subtree remains intact`)

    await reset()
    await start('grandchild')
    await hover('other-parent', 'above')
    await release()
    check(await page.evaluate(() => {
      const tasks = window.testState.useData.getState().tasks
      return !tasks.find(t => t.id === 'grandchild').parentId && tasks.find(t => t.id === 'grandchild').order < tasks.find(t => t.id === 'other-parent').order
    }), `${label}: child can reorder out to root level`)

    await reset()
    await start()
    await hover('child')
    await release(true)
    check(await page.evaluate(() => !window.testState.useData.getState().tasks.find(t => t.id === 'source').parentId), `${label}: cancellation preserves original parent`)
    check(await page.locator('.task-row-nest-target').count() === 0 && !await page.evaluate(() => document.body.classList.contains('is-dnd-dragging')), `${label}: cancellation clears highlights and drag lock`)

    await reset()
    await start()
    await hover('child')
    await move(1, 1)
    check(await page.locator('.task-row-nest-target').count() === 0, `${label}: leaving task area clears highlight`)
    await release()
    check(await page.evaluate(() => !window.testState.useData.getState().tasks.find(t => t.id === 'source').parentId), `${label}: dropping outside never uses stale target`)

    if (width === 390 && touch) {
      await reset()
      await page.evaluate(() => window.testState.useSelection.setState({ ids: new Set(['source', 'other-parent']), active: true }))
      await start()
      const selectedBox = await row('other-parent').boundingBox()
      await move(Math.min(width - 30, selectedBox.x + selectedBox.width / 2), selectedBox.y + selectedBox.height / 2)
      check(await page.locator('.task-row-nest-target').count() === 0, `${label}: selected group members cannot be drop targets`)
      await hover('child')
      await release()
      check(await page.evaluate(() => ['source', 'other-parent'].every(id => window.testState.useData.getState().tasks.find(t => t.id === id).parentId === 'child')), `${label}: group drop reparents every selected task`)

      await reset()
      const status = row('parent').locator('.task-row-status button')
      await status.tap()
      check(await page.evaluate(() => window.testState.useData.getState().tasks.find(t => t.id === 'parent').status === 'done' && !window.testState.useUI.getState().details), `${label}: status tap does not drag or open details`)
      await reset()
      const body = await row('other-parent').boundingBox()
      const sx = Math.min(width - 80, body.x + 140)
      const sy = body.y + body.height / 2
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] })
      for (let i = 1; i <= 5; i++) await move(sx, sy - i * 18)
      await release()
      check(!await page.evaluate(() => document.body.classList.contains('is-dnd-dragging')), `${label}: row-body swipe never activates drag`)
      check(await page.evaluate(() => document.querySelector('main').scrollTop > 0), `${label}: row-body swipe preserves vertical scrolling`)

      if (compact) {
        await reset()
        await start()
        const target = await row('child').boundingBox()
        await move(width - 3, target.y + target.height / 2)
        await page.waitForTimeout(400)
        check(await page.locator('.task-table-scroll').evaluate(element => element.scrollLeft > 0), `${label}: drag auto-scrolls horizontally at the table edge`)
        await release(true)
        await page.locator('.task-table-scroll').evaluate(element => { element.scrollLeft = 0 })
      }
      await reset()
      await start()
      await move(width / 2, 890)
      await page.waitForTimeout(400)
      check(await page.evaluate(() => document.querySelector('main').scrollTop > 0), `${label}: drag auto-scrolls vertically at the viewport edge`)
      await release(true)
    }

    check(errors.length === 0, `${label}: no browser errors (${errors.join('; ')})`)
    await context.close()
  }
  console.log(`\nTask drag-and-drop: ${assertions} assertions passed.`)
} finally {
  await browser.close()
}
