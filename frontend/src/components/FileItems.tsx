import { Dropdown, type MenuProps } from 'antd'
import { Check, MoreHorizontal, Star } from 'lucide-react'
import { useRef, type MouseEvent, type ReactNode } from 'react'
import type { DriveFile } from '../lib/api'
import { isFolder } from '../lib/files'
import { formatBytes, formatTime } from '../lib/format'
import FileIcon from './FileIcon'
import { cx } from '../lib/cx'

export interface ItemHandlers {
  onOpen: (file: DriveFile) => void
  onToggle: (file: DriveFile, event: MouseEvent | null) => void
  onMore: (file: DriveFile, event: MouseEvent) => void
  onContext?: (file: DriveFile, event: MouseEvent) => void
  /** Desktop action menu anchored to the "more" button; without it `onMore` is called. */
  menu?: (file: DriveFile) => MenuProps['items']
}

function MoreButton({ file, handlers, className, size }: { file: DriveFile; handlers: ItemHandlers; className: string; size: number }) {
  const button = (
    <button
      type="button"
      aria-label="更多操作"
      onClick={(event) => {
        event.stopPropagation()
        if (!handlers.menu) handlers.onMore(file, event)
      }}
      className={className}
    >
      <MoreHorizontal size={size} />
    </button>
  )
  if (!handlers.menu) return button
  return (
    <Dropdown menu={{ items: handlers.menu(file) }} trigger={['click']} placement="bottomRight">
      {button}
    </Dropdown>
  )
}

/** Long-press (touch) enters selection mode, mirroring native file managers. */
function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
  }
  return {
    fired,
    handlers: {
      onTouchStart: () => {
        fired.current = false
        timer.current = window.setTimeout(() => {
          fired.current = true
          navigator.vibrate?.(12)
          onLongPress()
        }, 450)
      },
      onTouchEnd: clear,
      onTouchMove: clear,
      onTouchCancel: clear,
    },
  }
}

function SelectBox({ checked, visible, onClick }: { checked: boolean; visible: boolean; onClick: (e: MouseEvent) => void }) {
  return (
    <button
      type="button"
      aria-label={checked ? '取消选择' : '选择'}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      className={cx(
        'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 transition-all duration-200',
        checked ? 'accent-fill' : 'neu-inset-sm text-transparent',
        visible || checked ? 'opacity-100' : 'hidden opacity-0 group-hover:opacity-100 md:flex',
      )}
    >
      <Check size={14} strokeWidth={3} />
    </button>
  )
}

export function FileRow({
  file,
  selected,
  selecting,
  thumbnails,
  compact,
  handlers,
  trailing,
}: {
  file: DriveFile
  selected: boolean
  selecting: boolean
  thumbnails: boolean
  compact: boolean
  handlers: ItemHandlers
  trailing?: ReactNode
}) {
  const press = useLongPress(() => handlers.onToggle(file, null))
  return (
    <div
      role="button"
      tabIndex={0}
      {...press.handlers}
      onClick={(event) => {
        if (press.fired.current) return
        if (selecting || event.metaKey || event.ctrlKey || event.shiftKey) handlers.onToggle(file, event)
        else handlers.onOpen(file)
      }}
      onKeyDown={(event) => event.key === 'Enter' && handlers.onOpen(file)}
      onContextMenu={(event) => {
        if (!handlers.onContext) return
        event.preventDefault()
        handlers.onContext(file, event)
      }}
      className={cx(
        'group mx-1 flex cursor-pointer items-center gap-3 rounded-[20px] px-3 transition-all duration-200 select-none md:gap-4',
        compact ? 'py-2' : 'py-2.5',
        selected ? 'neu-inset-sm' : 'hover:bg-black/[0.025] dark:hover:bg-white/[0.025]',
      )}
    >
      <SelectBox checked={selected} visible={selecting} onClick={(e) => handlers.onToggle(file, e)} />
      <FileIcon file={file} size={compact ? 38 : 44} thumbnails={thumbnails} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-medium text-ink">{file.name}</span>
          {file.starred && <Star size={13} className="shrink-0 text-warning" fill="currentColor" />}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-ink-3 md:hidden">
          {isFolder(file) ? formatTime(file.modified_time) : `${formatBytes(file.size)} · ${formatTime(file.modified_time)}`}
        </div>
      </div>
      {trailing}
      <div className="hidden w-24 shrink-0 text-right text-[13px] text-ink-3 tabular-nums md:block">
        {isFolder(file) ? '—' : formatBytes(file.size)}
      </div>
      <div className="hidden w-32 shrink-0 text-right text-[13px] text-ink-3 tabular-nums lg:block">{formatTime(file.modified_time)}</div>
      <MoreButton
        file={file}
        handlers={handlers}
        size={18}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-ink-3 transition hover:text-ink md:opacity-0 md:group-hover:opacity-100 [&.ant-dropdown-open]:opacity-100"
      />
    </div>
  )
}

export function FileTile({
  file,
  selected,
  selecting,
  thumbnails,
  handlers,
}: {
  file: DriveFile
  selected: boolean
  selecting: boolean
  thumbnails: boolean
  handlers: ItemHandlers
}) {
  const press = useLongPress(() => handlers.onToggle(file, null))
  return (
    <div
      role="button"
      tabIndex={0}
      {...press.handlers}
      onClick={(event) => {
        if (press.fired.current) return
        if (selecting || event.metaKey || event.ctrlKey || event.shiftKey) handlers.onToggle(file, event)
        else handlers.onOpen(file)
      }}
      onContextMenu={(event) => {
        if (!handlers.onContext) return
        event.preventDefault()
        handlers.onContext(file, event)
      }}
      className={cx(
        'group relative flex cursor-pointer flex-col items-center rounded-[24px] p-3 pt-4 text-center transition-all duration-200 select-none',
        selected ? 'neu-inset' : 'neu-raised-sm hover:-translate-y-0.5',
      )}
    >
      <div className="absolute top-2.5 left-2.5">
        <SelectBox checked={selected} visible={selecting} onClick={(e) => handlers.onToggle(file, e)} />
      </div>
      <MoreButton
        file={file}
        handlers={handlers}
        size={16}
        className="absolute top-2 right-2 flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-ink-3 md:opacity-0 md:group-hover:opacity-100 [&.ant-dropdown-open]:opacity-100"
      />
      <FileIcon file={file} size={72} thumbnails={thumbnails} className="!rounded-[22px]" />
      <div className="mt-3 line-clamp-2 min-h-[36px] w-full text-[13px] leading-[18px] font-medium break-all text-ink">{file.name}</div>
      <div className="mt-1 text-[11px] text-ink-3">{isFolder(file) ? formatTime(file.modified_time) : formatBytes(file.size)}</div>
    </div>
  )
}
