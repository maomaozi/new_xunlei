/**
 * Browser -> real FastAPI -> RunnerTasks -> EngineClient fake transport E2E.
 * Start backend/tests/browser_runner_app.py first. No real account/engine is used.
 * Uses the pinned playwright-core dev dependency and its Chromium cache, or
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE. Run with Bun.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')
const baseURL = process.env.RUNNER_E2E_URL || 'http://127.0.0.1:8019'
const output = resolve(process.env.RUNNER_E2E_OUTPUT || '/tmp/xunlei-runner-browser-e2e')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath(),
  args: ['--no-sandbox'],
})
const evidence = []
let activePage
let activeName

async function visible(locator) { await locator.waitFor({ state: 'visible', timeout: 10000 }) }
async function absent(locator) { await locator.waitFor({ state: 'hidden', timeout: 10000 }) }
function row(page, name = '浏览器测试下载') {
  return page.getByRole('button', { name: `下载任务：${name}`, exact: true })
}
async function reset(context, mode = 'normal') {
  const response = await context.request.post(`/__test__/reset?mode=${mode}`)
  assert.equal(response.status(), 200)
}

try {
  for (const mobile of [false, true]) {
    for (const theme of ['light', 'dark']) {
      const name = `${mobile ? 'phone-390' : 'desktop'}-${theme}`
      const context = await browser.newContext({
        baseURL, colorScheme: theme, viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1,
      })
      await reset(context)
      process.stdout.write(`Starting ${name}\n`)
      const page = await context.newPage()
      activePage = page
      activeName = name
      page.setDefaultTimeout(10000)
      const errors = []
      const downloadsRequests = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => {
        if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${response.url()}`)
      })
      page.on('request', (request) => {
        if (/\/api\/v1\/downloads(?:\?|$|\/live)/.test(request.url()) && request.method() === 'GET') downloadsRequests.push(request.url())
      })
      await page.goto('/downloads')
      await visible(row(page))
      await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${name}: horizontal overflow`)
      assert.equal(await row(page, '不可控制的测试下载').getByRole('button', { name: '暂停', exact: true }).count(), 0)
      assert.equal(await row(page, '不可控制的测试下载').getByRole('button', { name: '删除', exact: true }).isDisabled().catch(() => true), true)
      await page.screenshot({ path: `${output}/${name}-initial.png`, fullPage: true })

      // A real delayed HTTP action exposes immediate pending feedback and disables repeats.
      await row(page).getByRole('button', { name: '暂停', exact: true }).click()
      await visible(row(page).getByText('正在处理…', { exact: true }))
      assert.equal(await row(page).getByRole('button', { name: '暂停', exact: true }).count(), 0)
      await absent(row(page))
      await visible(page.getByText('操作已完成', { exact: true }))
      await page.getByRole('tab', { name: /^已暂停/ }).click()
      await visible(row(page))
      assert.equal((await page.getByRole('tab', { name: /^已暂停/ }).innerText()).replace(/\s+/g, ''), '已暂停2')
      await row(page).getByRole('button', { name: '继续', exact: true }).click()
      await absent(row(page))
      await page.getByRole('tab', { name: /^下载中/ }).click()
      await visible(row(page))
      await visible(row(page).getByText('等待中', { exact: true }))

      if (mobile) {
        // Tap opens the existing BottomSheet; the detail modal reads the shared snapshot.
        await row(page).tap({ position: { x: 35, y: 20 } })
        await visible(page.getByRole('button', { name: '任务详情', exact: true }))
        await page.getByRole('button', { name: '任务详情', exact: true }).click()
        await visible(page.getByRole('dialog').getByText('浏览器测试下载', { exact: true }))
        await visible(page.getByRole('dialog').getByText('等待中', { exact: true }))
        await page.locator('.ant-modal-close').click()
        await absent(page.getByRole('dialog'))

        // A physical touch held for >450ms enters selection and exposes ActionBar.
        const bounds = await row(page).boundingBox()
        assert.ok(bounds)
        const cdp = await context.newCDPSession(page)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + 35, y: bounds.y + 20 }] })
        await page.waitForTimeout(550)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await visible(page.getByText('已选 1 项', { exact: true }))
        await page.getByRole('button', { name: '暂停', exact: true }).last().click()
        await absent(row(page))
        await page.screenshot({ path: `${output}/${name}-after-selection.png`, fullPage: true })
      } else {
        await row(page).getByRole('button', { name: '详情', exact: true }).click()
        await visible(page.getByRole('dialog').getByText('等待中', { exact: true }))
        await page.locator('.ant-modal-close').click()
        await page.getByRole('button', { name: '新建下载', exact: true }).click()
        await page.getByPlaceholder(/^粘贴磁力/).fill('https://example.invalid/browser-created.bin')
        await page.getByRole('button', { name: '立即下载', exact: true }).click()
        await visible(row(page, 'browser-created.bin'))
      }
      assert.ok(downloadsRequests.every((url) => new URL(url).searchParams.get('status') === 'all'), 'all screens must share one complete query')
      assert.ok(!downloadsRequests.some((url) => url.includes('/live')), 'no separate browser live poll')
      assert.deepEqual(errors, [], `${name}: browser runtime errors`)
      evidence.push({ name, result: 'passed', requests: downloadsRequests.length, errors })
      process.stdout.write(`Passed ${name}\n`)
      await context.close()
    }
  }

  // Deletion sync failure remains visible, and a refused/timeout action never claims success.
  for (const mode of ['partial_delete', 'timeout', 'degraded']) {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } })
    await reset(context, mode)
    process.stdout.write(`Starting ${mode}\n`)
    const page = await context.newPage()
    activePage = page
    activeName = mode
    page.setDefaultTimeout(10000)
    await page.goto('/downloads')
    await visible(row(page))
    if (mode === 'partial_delete') {
      await row(page).getByRole('button', { name: '删除', exact: true }).click()
      await page.locator('.ant-modal-confirm').getByRole('button', { name: /^删\s*除$/ }).click()
      await page.getByRole('tab', { name: /^全部/ }).click()
      await visible(row(page))
      await visible(row(page).getByText('本地任务已移除，云端同步失败，请重试删除。', { exact: true }))
    } else if (mode === 'timeout') {
      await row(page).getByRole('button', { name: '暂停', exact: true }).click()
      await visible(row(page).getByText('正在处理…', { exact: true }))
      await visible(row(page).getByText('操作尚未完全确认，请稍后查看任务状态。', { exact: true }))
      await visible(row(page).getByText('下载中', { exact: true }))
      assert.equal(await page.getByText('操作已完成', { exact: true }).count(), 0)
    } else {
      // Live memory remains useful even when persisted records are unavailable.
      await visible(row(page).getByText('25.0%', { exact: true }))
    }
    await page.screenshot({ path: `${output}/${mode}.png`, fullPage: true })
    evidence.push({ name: mode, result: 'passed' })
    process.stdout.write(`Passed ${mode}\n`)
    await context.close()
  }
  {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } })
    await reset(context)
    const page = await context.newPage()
    activePage = page
    activeName = 'new-epoch'
    page.setDefaultTimeout(10000)
    await page.goto('/downloads')
    await visible(row(page))
    const before = await (await context.request.get('/api/v1/downloads')).json()
    await context.request.post('/__test__/restart')
    const after = await (await context.request.get('/api/v1/downloads')).json()
    assert.notEqual(after.epoch, before.epoch)
    assert.ok(after.version < before.version, 'the restart must exercise a lower observation version')
    await visible(row(page, '重启后出现的任务'))
    await page.screenshot({ path: `${output}/new-epoch.png`, fullPage: true })
    evidence.push({ name: 'new-epoch', result: 'passed', before: { epoch: before.epoch, version: before.version }, after: { epoch: after.epoch, version: after.version } })
    process.stdout.write('Passed new-epoch\n')
    await context.close()
  }
  const response = await fetch(`${baseURL}/__test__/evidence`)
  evidence.push({ transport: await response.json() })
  await writeFile(`${output}/results.json`, JSON.stringify(evidence, null, 2))
  process.stdout.write(`${JSON.stringify({ result: 'passed', scenarios: evidence.length - 1, output })}\n`)
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${output}/${activeName}-failure.png`, fullPage: true })
    await writeFile(`${output}/${activeName}-failure.html`, await activePage.content())
  }
  throw error
} finally {
  await browser.close()
}
