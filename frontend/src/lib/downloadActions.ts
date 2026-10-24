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
  if (task.status === 'running' || task.status === 'queued') return { action: 'pause', label: '暂停', icon: Pause }
  if (task.status === 'paused') return { action: 'resume', label: '继续', icon: Play }
  if (task.status === 'error') return { action: 'retry', label: '重试', icon: RotateCw }
  return null
}
