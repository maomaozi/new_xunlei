import { CheckCircle2, CircleAlert, Clock3, Cloud, Link2, Magnet, Pause, Play, RotateCw } from 'lucide-react'
import type { DownloadTask } from './api'

export type DownloadAction = 'pause' | 'resume' | 'retry' | 'delete' | 'detail'

export function taskIcon(task: DownloadTask) {
  if (task.status === 'complete') return CheckCircle2
  if (task.status === 'error') return CircleAlert
  if (task.status === 'queued') return Clock3
  if (task.source === 'cloud') return Cloud
  return task.url.startsWith('magnet:') ? Magnet : Link2
}

/** The one state-changing action that fits the task right now (pause, resume or retry). */
export function primaryAction(task: DownloadTask): { action: DownloadAction; label: string; icon: typeof Pause } | null {
  if (task.operation?.status === 'pending') return null
  if ((task.status === 'running' || task.status === 'queued') && task.capabilities?.pause !== false) return { action: 'pause', label: '暂停', icon: Pause }
  if (task.status === 'paused' && task.capabilities?.resume !== false) return { action: 'resume', label: '继续', icon: Play }
  if (task.status === 'error' && task.capabilities?.retry !== false) return { action: 'retry', label: '重试', icon: RotateCw }
  return null
}

export function actionFeedback(result: import('./api').DownloadActionResponse): { kind: 'success' | 'warning' | 'error'; text: string } {
  const confirmed = result.results.filter((item) => item.status === 'confirmed').length
  const remaining = result.results.filter((item) => item.status !== 'confirmed')
  if (!remaining.length) return { kind: 'success', text: '操作已完成' }
  const messages = [...new Set(remaining.map((item) => item.message || '操作未能确认，请刷新后查看'))]
  return { kind: confirmed ? 'warning' : 'error', text: `${confirmed ? `${confirmed} 项已完成，` : ''}${messages.join('；')}` }
}
