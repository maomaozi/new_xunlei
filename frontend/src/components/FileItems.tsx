import { Dropdown, type MenuProps } from 'antd'
import { MoreHorizontal, Star } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import type { DriveFile } from '../lib/api'
import { isFolder } from '../lib/files'
import { formatBytes, formatTime } from '../lib/format'
import { useLongPress } from '../hooks/useLongPress'
import FileIcon from './FileIcon'
import { cx } from '../lib/cx'
import { SelectCheck } from './ui'

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

function useItemPress(file: DriveFile, selecting: boolean, handlers: ItemHandlers) {
  const press = useLongPress(() => handlers.onToggle(file, null))
  return {
    ...press.handlers,
    onClick: (event: MouseEvent) => {
      if (press.fired.current) return
      if (selecting || event.metaKey || event.ctrlKey || event.shiftKey) handlers.onToggle(file, event)
      else handlers.onOpen(file)
    },
    onContextMenu: (event: MouseEvent) => {
      if (!handlers.onContext) return
      event.preventDefault()
      handlers.onContext(file, event)
    },
  }
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
  const press = useItemPress(file, selecting, handlers)
  return (
    <div
      role="button"
      tabIndex={0}
      {...press}
      onKeyDown={(event) => event.key === 'Enter' && handlers.onOpen(file)}
      className={cx(
        'group tap mx-1 flex cursor-pointer items-center gap-3 rounded-[18px] px-3 transition-colors duration-200 select-none md:gap-4',
        compact ? 'py-2' : 'py-2.5',
        selected ? 'bg-accent/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]',
      )}
    >
      <SelectCheck
        checked={selected}
        onClick={(e) => handlers.onToggle(file, e)}
        className={cx(!selecting && !selected && 'hidden opacity-0 group-hover:opacity-100 md:flex')}
      />
      <FileIcon file={file} size={compact ? 38 : 44} thumbnails={thumbnails} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14.5px] font-medium text-ink">{file.name}</span>
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
      {!selecting && (
        <MoreButton
          file={file}
          handlers={handlers}
          size={18}
          className="-mr-1 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-ink-3 transition hover:bg-black/[0.05] hover:text-ink md:opacity-0 md:group-hover:opacity-100 dark:hover:bg-white/[0.06] [&.ant-dropdown-open]:opacity-100"
        />
      )}
      {selecting && <span className="w-1 md:w-9" />}
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
  const press = useItemPress(file, selecting, handlers)
  return (
    <div
      role="button"
      tabIndex={0}
      {...press}
      className={cx(
        'group tap relative flex cursor-pointer flex-col items-center rounded-[24px] p-3 pt-4 text-center transition-all duration-200 select-none',
        selected ? 'neu-inset ring-2 ring-accent/40' : 'neu-raised-sm hover:-translate-y-0.5',
      )}
    >
      <div className="absolute top-2.5 left-2.5">
        <SelectCheck
          checked={selected}
          onClick={(e) => handlers.onToggle(file, e)}
          className={cx(!selecting && !selected && 'hidden opacity-0 group-hover:opacity-100 md:flex')}
        />
      </div>
      {!selecting && (
        <MoreButton
          file={file}
          handlers={handlers}
          size={16}
          className="absolute top-2 right-2 flex h-8 w-8 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-ink-3 md:opacity-0 md:group-hover:opacity-100 [&.ant-dropdown-open]:opacity-100"
        />
      )}
      <FileIcon file={file} size={72} thumbnails={thumbnails} className="!rounded-[22px]" />
      <div className="mt-3 line-clamp-2 min-h-[36px] w-full text-[13px] leading-[18px] font-medium break-all text-ink">{file.name}</div>
      <div className="mt-1 text-[11px] text-ink-3">{isFolder(file) ? formatTime(file.modified_time) : formatBytes(file.size)}</div>
    </div>
  )
}
