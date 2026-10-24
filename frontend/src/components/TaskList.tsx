import { Copy, ExternalLink, Trash2 } from 'lucide-react'
import { PHASE_META } from '../lib/tasks'
import type { DriveTask } from '../lib/api'
import { formatBytes, formatRelative } from '../lib/format'
import { cx } from '../lib/cx'
import { Badge, IconButton, ProgressBar } from './ui'


export function TaskRow({
  task,
  selected,
  onSelect,
  onOpen,
  onCopy,
  onDelete,
  detail,
}: {
  task: DriveTask
  selected: boolean
  onSelect: () => void
  onOpen?: () => void
  onCopy: () => void
  onDelete: () => void
  detail?: string
}) {
  const meta = PHASE_META[task.phase] ?? PHASE_META.PHASE_TYPE_PENDING
  const running = task.phase === 'PHASE_TYPE_RUNNING' || task.phase === 'PHASE_TYPE_PENDING'
  const Icon = meta.icon
  return (
    <div
      className={cx(
        'group flex items-start gap-3 rounded-[22px] p-3.5 transition-all duration-200 md:items-center md:gap-4 md:p-4',
        selected ? 'neu-inset-sm' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.02]',
      )}
      onClick={onSelect}
    >
      <div
        className={cx(
          'neu-raised-xs flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
          { accent: 'text-accent', success: 'text-success', danger: 'text-danger', muted: 'text-ink-3' }[meta.tone],
        )}
      >
        <Icon size={20} className={task.phase === 'PHASE_TYPE_RUNNING' ? 'animate-spin [animation-duration:2.4s]' : ''} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-ink" title={task.name || task.file_name}>
          {task.name || task.file_name || task.params.url}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {task.file_size > 0 && <span>{formatBytes(task.file_size)}</span>}
          <span>{formatRelative(task.created_time)}</span>
          {task.message && task.phase !== 'PHASE_TYPE_COMPLETE' && <span className="truncate">{task.message}</span>}
          {detail && <span className="truncate">{detail}</span>}
        </div>
        {running && (
          <div className="mt-2.5 flex items-center gap-3">
            <ProgressBar value={task.progress} animated className="flex-1" />
            <span className="w-10 text-right text-xs text-ink-2 tabular-nums">{task.progress}%</span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-2" onClick={(e) => e.stopPropagation()}>
        {onOpen && task.phase === 'PHASE_TYPE_COMPLETE' && <IconButton icon={ExternalLink} label="在云盘中查看" size="sm" onClick={onOpen} />}
        <IconButton icon={Copy} label="复制链接" size="sm" onClick={onCopy} className="hidden md:inline-flex" />
        <IconButton icon={Trash2} label="删除任务" size="sm" tone="danger" onClick={onDelete} />
      </div>
    </div>
  )
}
