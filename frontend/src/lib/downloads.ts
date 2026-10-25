import type { DownloadFilter, DownloadList, DownloadStatus, DownloadTask, EngineState, LiveDownloads } from './api'

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

/**
 * Overlay the engine's in-memory progress on the cloud task list. The cloud copy of a running
 * task is patched about once a minute, the live values every second.
 */
export function mergeLive(list: DownloadList | undefined, live: LiveDownloads | undefined): DownloadList | undefined {
  if (live?.downloads && (!list || live.epoch !== list.epoch || (live.version ?? 0) >= (list.version ?? 0))) {
    const tasks = live.downloads
    return { ...list, tasks, next_page_token: '', version: live.version, epoch: live.epoch, observed_at: live.observed_at,
      stale: live.stale, source_errors: live.source_errors,
      summary: { total: tasks.length, active: tasks.filter((t) => t.status === 'queued' || t.status === 'running').length,
        paused: tasks.filter((t) => t.status === 'paused').length, complete: tasks.filter((t) => t.status === 'complete').length,
        error: tasks.filter((t) => t.status === 'error').length, speed: live.speed } }
  }
  if (!list || !live?.tasks.length || (live.epoch === list.epoch && (live.version ?? 0) < (list.version ?? 0))) return list
  const byId = new Map(live.tasks.map((task) => [task.id, task]))
  const tasks = list.tasks.map((task) => {
    const current = byId.get(task.id)
    if (!current) return task
    return {
      ...task,
      status: current.status,
      progress: current.progress,
      speed: current.speed,
      speedup_speed: current.speedup_speed,
      size: current.size || task.size,
      done_bytes: current.size ? current.done_bytes : task.done_bytes,
      local_path: task.local_path || current.local_path,
    }
  })
  return { ...list, tasks, summary: { ...list.summary, speed: live.speed } }
}

/** Ids and statuses of live tasks; a change means the cloud list should be refetched. */
export function liveSignature(live: LiveDownloads | undefined): string {
  return (live?.tasks ?? []).map((task) => `${task.id}:${task.status}`).sort().join(',')
}

export function formatProgress(value: number): string {
  return value >= 100 || value <= 0 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`
}

/** Filters apply after observation, keeping counts and rows on the same version. */
export function filterDownloads(list: DownloadList | undefined, filter: DownloadFilter): DownloadList | undefined {
  if (!list || filter === 'all') return list
  return { ...list, tasks: list.tasks.filter((task) => filter === 'active'
    ? task.status === 'queued' || task.status === 'running' : task.status === filter) }
}

/** Action feedback is another observation of the same inventory, including partial results. */
export function applyActionResults(list: DownloadList | undefined, response: import('./api').DownloadActionResponse): DownloadList | undefined {
  if (!list || response.epoch !== list.epoch || response.version < (list.version ?? 0)) return list
  const outcomes = new Map(response.results.map((result) => [result.task_id, result]))
  const tasks = list.tasks.flatMap((task) => {
    const result = outcomes.get(task.id)
    if (!result) return [task]
    if (result.action === 'delete' && result.status === 'confirmed') return []
    return [{ ...(result.task ?? task), operation: result }]
  })
  return { ...list, tasks, version: response.version, summary: {
    total: tasks.length, active: tasks.filter((t) => t.status === 'running' || t.status === 'queued').length,
    paused: tasks.filter((t) => t.status === 'paused').length, complete: tasks.filter((t) => t.status === 'complete').length,
    error: tasks.filter((t) => t.status === 'error').length, speed: tasks.reduce((total, task) => total + task.speed, 0),
  } }
}

export function markActionsPending(list: DownloadList | undefined, ids: Set<string>, action: string): DownloadList | undefined {
  return list && { ...list, tasks: list.tasks.map((task) => ids.has(task.id)
    ? { ...task, operation: { action, status: 'pending', message: '' } } : task) }
}

/** A delayed response must not roll back an action that was already observed. */
export function latestDownloadSnapshot(previous: unknown, value: unknown): DownloadList {
  const incoming = value as DownloadList
  const existing = previous as DownloadList | undefined
  return existing && existing.epoch === incoming.epoch && (existing.version ?? 0) > (incoming.version ?? 0) ? existing : incoming
}
