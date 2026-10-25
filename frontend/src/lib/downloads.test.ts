import { describe, expect, it } from 'vitest'
import type { DownloadList, DownloadTask, LiveDownloads } from './api'
import { accelerations, formatProgress, linkName, liveSignature, mergeLive, parseLinks } from './downloads'

describe('parseLinks', () => {
  it('accepts supported schemes, splits joined links and reports the rest', () => {
    const text = [
      'magnet:?xt=urn:btih:abc&dn=A',
      '  https://a.example/x.iso https://a.example/y.iso',
      'ed2k://|file|My File.mkv|100|HASH|/',
      'not a link',
      'magnet:?xt=urn:btih:abc&dn=A',
    ].join('\n')
    const { links, invalid } = parseLinks(text)
    expect(links).toEqual([
      'magnet:?xt=urn:btih:abc&dn=A',
      'https://a.example/x.iso',
      'https://a.example/y.iso',
      'ed2k://|file|My File.mkv|100|HASH|/',
    ])
    expect(invalid).toEqual(['not a link'])
  })
})

describe('linkName', () => {
  it('extracts names from magnet, ed2k and http links', () => {
    expect(linkName('magnet:?xt=urn:btih:abc&dn=Big+Buck%20Bunny')).toBe('Big Buck Bunny')
    expect(linkName('ed2k://|file|%E6%B5%8B.mkv|1|H|/')).toBe('测.mkv')
    expect(linkName('https://a.example/dir/file%201.zip?x=1')).toBe('file 1.zip')
    expect(linkName('::bad')).toBe('')
  })
})

describe('accelerations', () => {
  const task = (status: DownloadTask['status'], speedup: DownloadTask['speedup']) => ({ status, speedup }) as DownloadTask
  it('lists active channels of running tasks only', () => {
    expect(accelerations(task('running', { p2p: 'started', vip: 'close', super: 'running' }))).toEqual(['P2P 加速', '超级加速'])
    expect(accelerations(task('paused', { p2p: 'started', vip: 'started', super: '' }))).toEqual([])
  })
})

describe('mergeLive', () => {
  const cloud = {
    tasks: [
      { id: 'a', status: 'running', progress: 0, speed: 0, speedup_speed: 0, size: 100, done_bytes: 0, local_path: '' },
      { id: 'b', status: 'complete', progress: 100, speed: 0, speedup_speed: 0, size: 5, done_bytes: 5, local_path: '/x' },
    ],
    summary: { total: 2, active: 1, paused: 0, complete: 1, error: 0, speed: 0 },
    next_page_token: '',
  } as unknown as DownloadList
  const live: LiveDownloads = {
    running: 1,
    speed: 2048,
    tasks: [{ id: 'a', name: 'a', status: 'running', running: true, progress: 42.5, size: 100, done_bytes: 42, speed: 2048, speedup_speed: 0, local_path: '/d/a' }],
  }

  it('replaces stale cloud progress with live values and keeps other tasks', () => {
    const merged = mergeLive(cloud, live)!
    expect(merged.tasks[0]).toMatchObject({ progress: 42.5, speed: 2048, done_bytes: 42, local_path: '/d/a' })
    expect(merged.tasks[1]).toBe(cloud.tasks[1])
    expect(merged.summary.speed).toBe(2048)
    expect(mergeLive(cloud, { tasks: [], running: 0, speed: 0 })).toBe(cloud)
  })

  it('signature changes only when the set or status of live tasks changes', () => {
    const moved = { ...live, tasks: [{ ...live.tasks[0], progress: 50 }] }
    expect(liveSignature(moved)).toBe(liveSignature(live))
    expect(liveSignature({ ...live, tasks: [{ ...live.tasks[0], status: 'complete' }] })).not.toBe(liveSignature(live))
    expect(formatProgress(42.456)).toBe('42.5%')
    expect(formatProgress(100)).toBe('100%')
  })
})

describe('shared observations and action results', () => {
  const snapshot = {
    version: 12,
    tasks: [
      { id: 'a', status: 'running', speed: 30 },
      { id: 'b', status: 'complete', speed: 0 },
    ],
    summary: { total: 2, active: 1, paused: 0, complete: 1, error: 0, speed: 30 },
    next_page_token: '',
  } as DownloadList

  it('immediately moves a confirmed paused task out of active and updates every count', async () => {
    const { applyActionResults, filterDownloads } = await import('./downloads')
    const result = applyActionResults(snapshot, { ok: true, version: 13, results: [
      { task_id: 'a', action: 'pause', status: 'confirmed', message: '', task: { ...snapshot.tasks[0], status: 'paused', speed: 0 } },
    ] })!
    expect(filterDownloads(result, 'active')?.tasks).toHaveLength(0)
    expect(filterDownloads(result, 'paused')?.tasks.map((task) => task.id)).toEqual(['a'])
    expect(result.summary).toEqual({ total: 2, active: 0, paused: 1, complete: 1, error: 0, speed: 0 })
    expect(snapshot.tasks[0].status).toBe('running')
  })

  it('retains partially deleted tasks and suppresses older action and query responses', async () => {
    const { applyActionResults, latestDownloadSnapshot } = await import('./downloads')
    const result = applyActionResults(snapshot, { ok: false, version: 13, results: [
      { task_id: 'a', action: 'delete', status: 'partial', message: '文件清理失败' },
      { task_id: 'b', action: 'delete', status: 'confirmed', message: '' },
    ] })!
    expect(result.tasks.map((task) => task.id)).toEqual(['a'])
    expect(result.tasks[0].operation?.message).toBe('文件清理失败')
    expect(latestDownloadSnapshot(result, snapshot)).toBe(result)
    expect(applyActionResults(result, { ok: true, version: 11, results: [] })).toBe(result)
  })

  it('uses the complete shared live inventory so local-only tasks and removals are visible', () => {
    const live = { version: 13, tasks: [], running: 0, speed: 0, downloads: [{ id: 'new', status: 'queued', speed: 0 }] } as unknown as LiveDownloads
    const merged = mergeLive(snapshot, live)!
    expect(merged.tasks.map((task) => task.id)).toEqual(['new'])
    expect(merged.summary.total).toBe(1)
    expect(merged.summary.active).toBe(1)
    expect(mergeLive(merged, { ...live, version: 12, downloads: [] })).toBe(merged)
  })
})

describe('server lifetime and instance changes', () => {
  const old = { epoch: 'previous-service', version: 1000, tasks: [], summary: { total: 0, active: 0, paused: 0, complete: 0, error: 0, speed: 0 }, next_page_token: '' } as DownloadList

  it('accepts a lower version from a new epoch after a backend restart or instance switch', async () => {
    const { latestDownloadSnapshot } = await import('./downloads')
    const restarted = { ...old, epoch: 'new-service', version: 1 }
    expect(latestDownloadSnapshot(old, restarted)).toBe(restarted)
    expect(latestDownloadSnapshot(restarted, { ...restarted, version: 0 })).toBe(restarted)
  })

  it('rejects a delayed action from another instance even if its version is larger', async () => {
    const { applyActionResults } = await import('./downloads')
    const current = { ...old, epoch: 'new-instance', version: 1 }
    expect(applyActionResults(current, { ok: true, epoch: 'previous-service', version: 1001, results: [] })).toBe(current)
    expect(mergeLive(old, { epoch: 'new-service', version: 1, downloads: [], tasks: [], running: 0, speed: 0 })?.epoch).toBe('new-service')
  })
})
