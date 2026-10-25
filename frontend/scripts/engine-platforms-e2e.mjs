/** Platform UI checks against the isolated browser_runner_app harness. Run with Bun. */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright-core')
const baseURL = process.env.RUNNER_E2E_URL || 'http://127.0.0.1:8019'
const output = process.env.PLATFORM_E2E_OUTPUT || '/tmp/xunlei-platforms-e2e'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath() })
const evidence = []

function capabilities(platform) {
  const local = ['qnap', 'linux'].includes(platform)
  return { platform, launcher: ['qnap', 'synology'].includes(platform), local_config: local, detailed_status: local, touch_tasks: local, storage: true, device_spaces: platform === 'linux', remote_devices: platform === 'linux', webhook: platform === 'linux' }
}

try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ baseURL, viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 960 }, hasTouch: mobile, isMobile: mobile, colorScheme: mobile ? 'dark' : 'light' })
    const response = await context.request.get('/__test__/state')
    assert.equal(response.status(), 200, 'An isolated browser harness is required')
    const settings = await (await context.request.get('/api/v1/settings')).json()
    settings.engine.platform = 'synology'
    settings.engine.remote_devices = []
    settings.engine.device_space = ''
    settings.engine.webhook_url = ''
    settings.engine.webhook_modules = {}
    settings.ui.theme = mobile ? 'dark' : 'light'
    let mounts = []
    let phase = 'PHASE_TYPE_RUNNING'
    const writes = []
    const types = [{ type: 'webdav', name: 'WebDAV', config_templates: [
      { key: 'server', title: '主机', type: 'text', required: true, value: '', max_length: 100 },
      { key: 'password', title: '密码', type: 'password', value: '', max_length: 100 },
      { key: 'is_tls', title: '加密', type: 'switch', value: 'false', max_length: 100 },
    ] }]
    await context.route('**/api/v1/**', async (route) => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/v1', '')
      const fulfill = (json) => route.fulfill({ json })
      if (path === '/settings') {
        if (request.method() === 'PUT') Object.assign(settings, request.postDataJSON())
        return fulfill(settings)
      }
      if (path === '/engine/capabilities') return fulfill(capabilities(url.searchParams.get('platform') || settings.engine.platform))
      if (path === '/engine') {
        const original = await (await route.fetch()).json()
        return fulfill({ ...original, capabilities: capabilities(settings.engine.platform), user: { id: 'test-user', name: '测试账号', vip_level: 6 } })
      }
      if (path === '/engine/storage/types') return fulfill({ types })
      if (path === '/engine/storage') {
        if (request.method() === 'POST') {
          const body = request.postDataJSON(); writes.push({ path, body })
          mounts = [{ id: 'mount-test', name: body.config.server, type: body.type, file_id: 'folder-test', config: { server: body.config.server, is_tls: body.config.is_tls } }]
          return fulfill({ ok: true })
        }
        return fulfill({ mounts, next_page_token: '' })
      }
      if (path === '/engine/storage/mount-test') {
        writes.push({ path, body: request.postDataJSON() })
        return fulfill({ ok: true })
      }
      if (path.startsWith('/engine/devices/')) {
        const device = path.split('/')[3]
        if (request.method() === 'POST') {
          const body = request.postDataJSON(); writes.push({ path, body })
          phase = body.action === 'pause' ? 'PHASE_TYPE_PAUSED' : 'PHASE_TYPE_RUNNING'
          return fulfill({ confirmed: true, tasks: [] })
        }
        return fulfill({ tasks: [{ id: 'remote-task', type: 'user#download-url', name: `测试下载 ${device}`, phase, space: `device_id#${device}` }], next_page_token: '' })
      }
      return route.continue()
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/settings/engine')
    await page.locator('#max_running_tasks').waitFor()
    await page.waitForFunction(() => document.querySelector('#max_running_tasks')?.disabled === true)
    const advanced = page.locator('.neu-raised').filter({ has: page.getByText('进程与运行环境（高级）', { exact: true }) })
    if (mobile) {
      await advanced.getByRole('button', { name: /群晖 Synology/ }).click()
      await page.getByRole('button', { name: 'Linux', exact: true }).click()
    } else {
      await advanced.locator('.ant-select').click()
      await page.locator('.ant-select-dropdown').getByText('Linux', { exact: true }).click()
    }
    await advanced.getByRole('button', { name: '保存', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#max_running_tasks')?.disabled === false)
    assert.equal(await page.locator('#launcher_port').count(), 0)
    const connections = page.locator('#devices')
    await connections.locator('#device_space').fill('isolated-space')
    await connections.getByRole('button', { name: '添加设备', exact: true }).click()
    await connections.getByPlaceholder('设备名称').fill('测试 NAS')
    await connections.getByPlaceholder('设备 ID', { exact: true }).fill('remote-test')
    await connections.locator('#webhook_url').fill('http://127.0.0.1:12345/rpc')
    await connections.getByRole('button', { name: '添加模块', exact: true }).click()
    await connections.getByPlaceholder('模块', { exact: true }).fill('device')
    await connections.getByPlaceholder('方法，逗号分隔').fill('info, status')
    await connections.getByRole('button', { name: '保存', exact: true }).click()
    await page.waitForTimeout(150)
    assert.equal(settings.engine.device_space, 'device_id#isolated-space')
    assert.deepEqual(settings.engine.webhook_modules, { device: ['info', 'status'] })
    await page.screenshot({ path: `${output}/${mobile ? 'mobile-dark' : 'desktop-light'}-settings.png`, fullPage: true })
    await page.goto('/engine')
    await page.getByRole('button', { name: '添加存储', exact: true }).first().click()
    let dialog = page.getByRole('dialog').last()
    await dialog.getByLabel('主机', { exact: true }).fill('storage.invalid')
    await dialog.getByLabel('密码', { exact: true }).fill('new-secret')
    await dialog.getByRole('switch').click()
    await dialog.getByRole('button', { name: /保\s*存/ }).click()
    await page.getByText('storage.invalid', { exact: true }).waitFor()
    assert.deepEqual(writes.find((write) => write.path === '/engine/storage').body, { type: 'webdav', config: { server: 'storage.invalid', password: 'new-secret', is_tls: 'true' } })
    await page.getByRole('button', { name: '编辑存储', exact: true }).click()
    dialog = page.getByRole('dialog').last()
    assert.equal(await dialog.getByLabel('密码', { exact: true }).inputValue(), '')
    await dialog.getByRole('button', { name: /保\s*存/ }).click()
    await page.getByRole('button', { name: '暂停远程任务', exact: true }).click()
    await page.getByText('已暂停', { exact: true }).waitFor()
    assert(writes.some((write) => write.path === '/engine/devices/remote-test/tasks/remote-task' && write.body.action === 'pause'))
    assert(writes.some((write) => write.path === '/engine/storage/mount-test' && write.body.config.password === ''))
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    assert.equal(overflow, false)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `${output}/${mobile ? 'mobile-dark' : 'desktop-light'}-engine.png`, fullPage: true })
    evidence.push({ mobile, settings: true, storage: true, remoteControl: true, overflow })
    await context.close()
  }
  console.log(JSON.stringify({ passed: evidence, output }, null, 2))
} finally { await browser.close() }
