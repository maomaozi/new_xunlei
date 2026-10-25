import { Info, Trash2 } from 'lucide-react'
import type { DownloadTask } from '../lib/api'
import { cx } from '../lib/cx'
import { DOWNLOAD_STATUS, accelerations, formatProgress, remainingBytes } from '../lib/downloads'
import { formatBytes, formatEta, formatRelative, formatSpeed } from '../lib/format'
import { useLongPress } from '../hooks/useLongPress'
import { Badge, IconButton, IconTile, ProgressBar, SelectCheck } from './ui'

import { primaryAction, taskIcon, type DownloadAction } from '../lib/downloadActions'

export type { DownloadAction }

/** One engine download with progress, speed, acceleration channels and actions. */
export default function DownloadRow({
  task,
  selected,
  selecting,
  touch,
  onToggle,
  onAction,
  onOpen,
}: {
  task: DownloadTask
  selected: boolean
  selecting: boolean
  /** Phone layout: tap opens the action sheet, long-press selects. */
  touch: boolean
  onToggle: () => void
  onAction: (action: DownloadAction) => unknown
  onOpen: () => void
}) {
  const status = DOWNLOAD_STATUS[task.status]
  const running = task.status === 'running'
  const boosts = accelerations(task)
  const primary = primaryAction(task)
  const press = useLongPress(onToggle)
  const showProgress = task.status !== 'complete' && task.status !== 'error'

  return (
    <div
      role="button"
      aria-label={`下载任务：${task.name}`}
      tabIndex={0}
      {...(touch ? press.handlers : {})}
      onClick={() => {
        if (press.fired.current) return
        if (selecting) onToggle()
        else if (touch) onOpen()
      }}
      onKeyDown={(event) => event.key === 'Enter' && (selecting ? onToggle() : onAction('detail'))}
      className={cx(
        'group flex items-center gap-3 rounded-[20px] px-3 py-3 transition select-none md:gap-4 md:px-4',
        touch ? 'tap cursor-pointer' : 'cursor-default',
        selected ? 'bg-accent/10' : 'hover:bg-black/[0.025] dark:hover:bg-white/[0.025]',
      )}
    >
      {(!touch || selecting) && <SelectCheck checked={selected} onClick={onToggle} />}
      <IconTile icon={taskIcon(task)} tone={status.tone} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14.5px] font-medium text-ink" title={task.local_path || task.name}>
            {task.name}
          </span>
          {task.source === 'cloud' && <Badge tone="violet">云盘</Badge>}
          {task.sub_files && <Badge>部分</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3 tabular-nums">
          <Badge tone={status.tone}>{status.label}</Badge>
          {task.operation?.status === 'pending' && <span role="status">正在处理…</span>}
          {task.stale && <span>状态待更新</span>}
          <span>
            {task.status === 'complete' ? formatBytes(task.size) : `${formatBytes(task.done_bytes)} / ${task.size ? formatBytes(task.size) : '--'}`}
          </span>
          {running && task.speed > 0 && <span className="font-medium text-accent">{formatSpeed(task.speed)}</span>}
          {running && task.speed > 0 && <span>剩余 {formatEta(remainingBytes(task), task.speed)}</span>}
          {boosts.map((label) => (
            <Badge key={label} tone="success">
              {label}
            </Badge>
          ))}
          {!running && <span>{formatRelative(task.created_at)}</span>}
        </div>
        {task.operation?.message && task.operation.status !== 'confirmed' && <div role="status" className="mt-1 text-[12px] text-warning">{task.operation.message}</div>}
        {task.status === 'error' && task.error && <div className="mt-1 line-clamp-2 text-[12px] break-all text-danger">{task.error}</div>}
        {showProgress && (
          <div className="mt-2 flex items-center gap-2.5">
            <ProgressBar value={task.progress} animated={running} tone={task.status === 'paused' ? 'warning' : 'accent'} className="flex-1" />
            <span className="w-11 text-right text-[11px] font-medium text-ink-2 tabular-nums">{formatProgress(task.progress)}</span>
          </div>
        )}
        {task.local_path && !touch && <div className="mt-1 truncate text-[11px] text-ink-3">{task.local_path}</div>}
      </div>
      {touch ? (
        !selecting &&
        primary && (
          <IconButton
            icon={primary.icon}
            label={primary.label}
            size="sm"
            showTooltip={false}
            tone={primary.action === 'pause' ? 'default' : 'accent'}
            onClick={(event) => {
              event.stopPropagation()
              return onAction(primary.action)
            }}
            className="!rounded-full"
          />
        )
      ) : (
        <div className="flex shrink-0 gap-2">
          {primary && (
            <IconButton icon={primary.icon} label={primary.label} size="sm" tone={primary.action === 'pause' ? 'default' : 'accent'} onClick={() => onAction(primary.action)} />
          )}
          <IconButton icon={Info} label="详情" size="sm" onClick={() => onAction('detail')} />
          <IconButton disabled={task.capabilities?.delete === false || task.operation?.status === 'pending'} icon={Trash2} label="删除" size="sm" tone="danger" onClick={() => onAction('delete')} />
        </div>
      )}
    </div>
  )
}
