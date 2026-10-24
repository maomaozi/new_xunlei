import { Checkbox } from 'antd'
import { CheckCircle2, CircleAlert, Clock3, Cloud, Info, Link2, Magnet, Pause, Play, RotateCw, Trash2 } from 'lucide-react'
import type { DownloadTask } from '../lib/api'
import { cx } from '../lib/cx'
import { DOWNLOAD_STATUS, accelerations, formatProgress, remainingBytes } from '../lib/downloads'
import { formatBytes, formatEta, formatRelative, formatSpeed } from '../lib/format'
import { Badge, IconButton, ProgressBar } from './ui'

export type DownloadAction = 'pause' | 'resume' | 'retry' | 'delete' | 'detail'

function TaskIcon({ task }: { task: DownloadTask }) {
  if (task.status === 'complete') return <CheckCircle2 size={20} />
  if (task.status === 'error') return <CircleAlert size={20} />
  if (task.status === 'queued') return <Clock3 size={20} />
  if (task.source === 'cloud') return <Cloud size={20} />
  return task.url.startsWith('magnet:') ? <Magnet size={20} /> : <Link2 size={20} />
}

const TONE_CLASS = {
  accent: 'text-accent',
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
  muted: 'text-ink-3',
}

/** One engine download with progress, speed, acceleration channels and actions. */
export default function DownloadRow({
  task,
  selected,
  onToggle,
  onAction,
}: {
  task: DownloadTask
  selected: boolean
  onToggle: () => void
  onAction: (action: DownloadAction) => unknown
}) {
  const status = DOWNLOAD_STATUS[task.status]
  const running = task.status === 'running'
  const boosts = accelerations(task)
  return (
    <div
      className={cx(
        'flex items-start gap-3 rounded-[22px] p-3.5 transition md:items-center md:gap-4 md:p-4',
        selected ? 'neu-inset-sm' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]',
      )}
    >
      <Checkbox checked={selected} onChange={onToggle} className="mt-3 md:mt-0" aria-label="选择任务" />
      <div className={cx('neu-raised-xs flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', TONE_CLASS[status.tone])}>
        <TaskIcon task={task} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium text-ink" title={task.local_path || task.name}>
            {task.name}
          </span>
          {task.source === 'cloud' && <Badge tone="accent">云盘取回</Badge>}
          {task.sub_files && <Badge>部分文件</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3 tabular-nums">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span>
            {task.status === 'complete' ? formatBytes(task.size) : `${formatBytes(task.done_bytes)} / ${task.size ? formatBytes(task.size) : '--'}`}
          </span>
          {running && task.speed > 0 && <span className="text-accent">{formatSpeed(task.speed)}</span>}
          {running && task.speed > 0 && <span>剩余 {formatEta(remainingBytes(task), task.speed)}</span>}
          {boosts.map((label) => (
            <Badge key={label} tone="success">
              {label}
            </Badge>
          ))}
          <span>{formatRelative(task.created_at)}</span>
        </div>
        {task.status === 'error' && task.error && <div className="mt-1 text-[12px] break-all text-danger">{task.error}</div>}
        {task.status !== 'complete' && task.status !== 'error' && (
          <div className="mt-2.5 flex items-center gap-3">
            <ProgressBar value={task.progress} animated={running} tone={task.status === 'paused' ? 'warning' : 'accent'} className="flex-1" />
            <span className="w-12 text-right text-xs text-ink-2 tabular-nums">{formatProgress(task.progress)}</span>
          </div>
        )}
        {task.local_path && <div className="mt-1 hidden truncate text-[11px] text-ink-3 md:block">{task.local_path}</div>}
      </div>
      <div className="flex shrink-0 gap-2">
        {(running || task.status === 'queued') && <IconButton icon={Pause} label="暂停" size="sm" onClick={() => onAction('pause')} />}
        {task.status === 'paused' && <IconButton icon={Play} label="继续" size="sm" tone="accent" onClick={() => onAction('resume')} />}
        {task.status === 'error' && <IconButton icon={RotateCw} label="重试" size="sm" tone="accent" onClick={() => onAction('retry')} />}
        <IconButton icon={Info} label="详情" size="sm" onClick={() => onAction('detail')} className="hidden md:inline-flex" />
        <IconButton icon={Trash2} label="删除" size="sm" tone="danger" onClick={() => onAction('delete')} />
      </div>
    </div>
  )
}
