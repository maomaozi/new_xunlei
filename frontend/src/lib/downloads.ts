import type { DownloadStatus, DownloadTask, EngineState } from './api'

type Tone = 'accent' | 'success' | 'danger' | 'warning' | 'muted'

export const DOWNLOAD_STATUS: Record<DownloadStatus, { label: string; tone: Tone }> = {
  queued: { label: '等待中', tone: 'muted' },
  running: { label: '下载中', tone: 'accent' },
  paused: { label: '已暂停', tone: 'warning' },
  complete: { label: '已完成', tone: 'success' },
  error: { label: '失败', tone: 'danger' },
}

export const ENGINE_STATE: Record<EngineState, { label: string; tone: Tone }> = {
  disabled: { label: '已停用', tone: 'muted' },
  missing_binary: { label: '未安装', tone: 'danger' },
  stopped: { label: '已停止', tone: 'muted' },
  starting: { label: '启动中', tone: 'warning' },
  running: { label: '运行中', tone: 'success' },
  crashed: { label: '异常退出', tone: 'danger' },
}

const SCHEMES = ['magnet:?', 'http://', 'https://', 'ftp://', 'ed2k://', 'thunder://']

/** Split pasted text into download links (one per line or whitespace separated). */
export function parseLinks(text: string): { links: string[]; invalid: string[] } {
  const links: string[] = []
  const invalid: string[] = []
  for (const line of text.split(/\n+/)) {
    const value = line.trim()
    if (!value) continue
    // ed2k links may contain spaces inside |name|; split only lines that hold several URLs.
    const parts = value.startsWith('ed2k://') ? [value] : value.split(/\s+(?=[a-z0-9]+:)/i)
    for (const part of parts) {
      const link = part.trim()
      if (!link) continue
      if (SCHEMES.some((scheme) => link.toLowerCase().startsWith(scheme))) {
        if (!links.includes(link)) links.push(link)
      } else invalid.push(link)
    }
  }
  return { links, invalid }
}

/** A speedup channel is active unless the engine reports it closed or failed. */
export function channelActive(state: string): boolean {
  return Boolean(state) && !['close', 'closed', 'stop', 'stopped', 'failed', 'fail'].includes(state)
}

export function accelerations(task: DownloadTask): string[] {
  if (task.status !== 'running') return []
  const labels: string[] = []
  if (channelActive(task.speedup.p2p)) labels.push('P2P 加速')
  if (channelActive(task.speedup.vip)) labels.push('会员加速')
  if (channelActive(task.speedup.super)) labels.push('超级加速')
  return labels
}

export function remainingBytes(task: DownloadTask): number {
  return Math.max(0, task.size - task.done_bytes)
}

/** Display name of a link: magnet `dn`, ed2k file name or the last URL path segment. */
export function linkName(url: string): string {
  try {
    if (url.startsWith('magnet:')) return new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('dn') ?? ''
    if (url.startsWith('ed2k://')) return decodeURIComponent(url.split('|')[2] ?? '')
    const path = new URL(url).pathname.replace(/\/+$/, '')
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1))
  } catch {
    return ''
  }
}
