import { describe, expect, it } from 'vitest'
import type { DownloadTask } from './api'
import { accelerations, linkName, parseLinks } from './downloads'

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
