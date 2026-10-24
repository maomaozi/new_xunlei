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
