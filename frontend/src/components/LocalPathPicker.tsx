import { useQuery } from '@tanstack/react-query'
import { App, Input, Modal } from 'antd'
import { ArrowUp, File, Folder, HardDrive, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { ApiError, errorMessage, systemApi } from '../lib/api'
import { useAppSettings } from '../lib/settingsContext'
import { formatBytes } from '../lib/format'
import { cx } from '../lib/cx'
import { ListSkeleton, PillButton } from './ui'

/** Browse directories on the host running the backend (limited to configured roots). */
export default function LocalPathPicker({
  open,
  title,
  mode,
  initialPath,
  onCancel,
  onPick,
}: {
  open: boolean
  title: string
  mode: 'dir' | 'any'
  initialPath?: string
  onCancel: () => void
  onPick: (path: string) => void
}) {
  const { message } = App.useApp()
  const { settings, update } = useAppSettings()
  const [path, setPath] = useState<string | undefined>(initialPath)
  const [selected, setSelected] = useState<string | null>(null)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fs', path, mode],
    queryFn: () => systemApi.fs(path, mode === 'any'),
    enabled: open,
    retry: false,
  })
  const target = selected ?? data?.path ?? ''
  const blocked = error instanceof ApiError && error.code === 'path_not_allowed' && path?.startsWith('/') ? path.replace(/\/+$/, '') || '/' : ''

  // The site has no login, so host access stays limited to roots the user allows explicitly.
  const allow = async () => {
    const roots = settings?.system.browse_roots ?? []
    try {
      await update('system', { browse_roots: roots.includes(blocked) ? roots : [...roots, blocked] })
      message.success(`已允许访问 ${blocked}`)
      void refetch()
    } catch (err) {
      message.error(errorMessage(err))
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      onOk={() => target && onPick(target)}
      okText={mode === 'dir' ? '使用此目录' : '选择'}
      okButtonProps={{ disabled: !target }}
      width={560}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (visible) setPath(initialPath)
        setSelected(null)
      }}
    >
      <div className="mb-3 flex gap-2">
        <PillButton icon={ArrowUp} disabled={!data?.parent} onClick={() => data?.parent && (setPath(data.parent), setSelected(null))}>
          上一级
        </PillButton>
        <Input
          value={path ?? data?.path ?? ''}
          onChange={(e) => setPath(e.target.value)}
          onPressEnter={(e) => setPath((e.target as HTMLInputElement).value)}
          prefix={<HardDrive size={14} className="text-ink-3" />}
        />
      </div>
      {data && data.roots.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {data.roots.map((root) => (
            <PillButton key={root} active={data.path.startsWith(root)} onClick={() => setPath(root)} className="!px-3 !py-1.5 !text-xs">
              {root}
            </PillButton>
          ))}
        </div>
      )}
      <div className="neu-inset h-[44vh] max-h-[400px] overflow-y-auto rounded-3xl p-2">
        {isLoading ? (
          <ListSkeleton rows={6} />
        ) : error ? (
          <div className="flex flex-col items-center gap-4 py-14 text-center text-sm">
            <span className="text-danger">{errorMessage(error)}</span>
            {blocked && (
              <>
                <PillButton icon={ShieldCheck} onClick={() => void allow()}>
                  允许访问 {blocked}
                </PillButton>
                <span className="max-w-sm text-xs text-ink-3">会加入「设置 → 系统 → 本机访问范围」。本站没有独立登录，能访问本站的人都可以浏览这些目录。</span>
              </>
            )}
          </div>
        ) : data?.entries.length === 0 ? (
          <div className="py-16 text-center text-sm text-ink-3">空目录</div>
        ) : (
          data?.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => (entry.kind === 'dir' ? (setPath(entry.path), setSelected(null)) : setSelected(entry.path))}
              onDoubleClick={() => mode === 'any' && onPick(entry.path)}
              className={cx(
                'flex w-full cursor-pointer items-center gap-3 rounded-2xl border-0 bg-transparent p-2.5 text-left',
                selected === entry.path ? 'neu-inset-sm text-accent' : 'text-ink',
              )}
            >
              {entry.kind === 'dir' ? <Folder size={18} className="text-[#f2b544]" /> : <File size={18} className="text-ink-3" />}
              <span className="min-w-0 flex-1 truncate text-[14px]">{entry.name}</span>
              {entry.kind === 'file' && <span className="text-xs text-ink-3">{formatBytes(entry.size)}</span>}
            </button>
          ))
        )}
      </div>
      <div className="mt-3 truncate text-xs text-ink-3">已选择：{target || '--'}</div>
    </Modal>
  )
}
