import { Copy, ExternalLink, Trash2 } from 'lucide-react'
import { PHASE_META } from '../lib/tasks'
import type { DriveTask } from '../lib/api'
import { formatBytes, formatRelative } from '../lib/format'
import { useLongPress } from '../hooks/useLongPress'
import { cx } from '../lib/cx'
import { Badge, IconButton, IconTile, ProgressBar, SelectCheck } from './ui'

export function TaskRow({
  task,
  selected,
  selecting = false,
  touch = false,
  onSelect,
  onOpen,
  onCopy,
  onDelete,
  onMenu,
  detail,
}: {
  task: DriveTask
  selected: boolean
  selecting?: boolean
  /** Phone layout: tap opens `onMenu`, long-press selects. */
  touch?: boolean
  onSelect: () => void
  onOpen?: () => void
  onCopy: () => void
  onDelete: () => void
  onMenu?: () => void
  detail?: string
}) {
  const meta = PHASE_META[task.phase] ?? PHASE_META.PHASE_TYPE_PENDING
  const running = task.phase === 'PHASE_TYPE_RUNNING' || task.phase === 'PHASE_TYPE_PENDING'
  const press = useLongPress(onSelect)
  return (
    <div
      role="button"
      tabIndex={0}
      {...(touch ? press.handlers : {})}
      className={cx(
        'group tap flex cursor-pointer items-center gap-3 rounded-[20px] px-3 py-3 transition-colors duration-200 select-none md:gap-4 md:px-4',
        selected ? 'bg-accent/10' : 'hover:bg-black/[0.025] dark:hover:bg-white/[0.025]',
      )}
      onClick={() => {
        if (press.fired.current) return
        if (touch && !selecting) onMenu?.()
        else onSelect()
      }}
    >
      {(!touch || selecting) && <SelectCheck checked={selected} onClick={onSelect} />}
      <IconTile icon={meta.icon} tone={meta.tone} size={44}>
        {task.phase === 'PHASE_TYPE_RUNNING' && <span className="absolute inset-0 animate-pulse rounded-[inherit] ring-2 ring-accent/30" />}
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-medium text-ink" title={task.name || task.file_name}>
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
          <div className="mt-2 flex items-center gap-2.5">
            <ProgressBar value={task.progress} animated className="flex-1" />
            <span className="w-10 text-right text-[11px] font-medium text-ink-2 tabular-nums">{task.progress}%</span>
          </div>
        )}
      </div>
      {!touch && (
        <div className="flex shrink-0 gap-2" onClick={(e) => e.stopPropagation()}>
          {onOpen && task.phase === 'PHASE_TYPE_COMPLETE' && <IconButton icon={ExternalLink} label="在云盘中查看" size="sm" onClick={onOpen} />}
          <IconButton icon={Copy} label="复制链接" size="sm" onClick={onCopy} />
          <IconButton icon={Trash2} label="删除任务" size="sm" tone="danger" onClick={onDelete} />
        </div>
      )}
      {touch && !selecting && onOpen && task.phase === 'PHASE_TYPE_COMPLETE' && (
        <IconButton
          icon={ExternalLink}
          label="在云盘中查看"
          size="sm"
          showTooltip={false}
          className="!rounded-full"
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
        />
      )}
    </div>
  )
}
