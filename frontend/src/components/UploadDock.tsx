import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ChevronUp, CloudUpload, RotateCw, X, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useBrowserUploads } from '../hooks/useBrowserUploads'
import { useIsMobile } from '../hooks/useMediaQuery'
import { formatBytes, percent } from '../lib/format'
import { useAppSettings } from '../lib/settingsContext'
import { uploadStore } from '../lib/uploads'
import { cx } from '../lib/cx'
import { IconButton, ProgressBar } from './ui'

/** Floating progress panel for browser → server uploads (the first upload leg). */
export default function UploadDock() {
  const items = useBrowserUploads()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const { settings } = useAppSettings()
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    uploadStore.configure({
      concurrency: settings?.upload.max_concurrent ?? 2,
      onServerQueued: () => void queryClient.invalidateQueries({ queryKey: ['transfers'] }),
    })
  }, [settings?.upload.max_concurrent, queryClient])

  if (items.length === 0) return null
  const active = items.filter((item) => item.status === 'uploading' || item.status === 'queued')
  const failed = items.filter((item) => item.status === 'error')
  const total = items.reduce((sum, item) => sum + item.size, 0)
  const loaded = items.reduce((sum, item) => sum + (item.status === 'done' ? item.size : item.loaded), 0)

  return (
    <div
      className={cx(
        'glass-card fixed z-50 overflow-hidden rounded-[24px]',
        isMobile ? 'inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+84px)]' : 'right-6 bottom-6 w-[380px]',
      )}
    >
      <div className="flex items-center gap-3 p-3.5">
        <div className="tint flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-accent">
          {active.length > 0 ? <CloudUpload size={19} /> : failed.length ? <XCircle size={19} className="text-danger" /> : <CheckCircle2 size={19} className="text-success" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">
            {active.length > 0 ? `正在传到服务器 · ${active.length} 项` : failed.length ? `${failed.length} 项失败` : '已全部交给服务器上传'}
          </div>
          <div className="mt-1.5">
            <ProgressBar value={percent(loaded, total)} animated={active.length > 0} />
          </div>
          <div className="mt-1 text-[11px] text-ink-3 tabular-nums">
            {formatBytes(loaded)} / {formatBytes(total)}
          </div>
        </div>
        <IconButton icon={expanded ? ChevronDown : ChevronUp} label={expanded ? '收起' : '展开'} size="sm" onClick={() => setExpanded(!expanded)} />
        {active.length === 0 && <IconButton icon={X} label="关闭" size="sm" onClick={() => uploadStore.clearFinished()} />}
      </div>
      {expanded && (
        <div className="max-h-72 space-y-2 overflow-y-auto border-t border-line p-3">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2.5 text-[12px]">
              <div className="min-w-0 flex-1">
                <div className="truncate text-ink">{item.relativeDir ? `${item.relativeDir}/` : ''}{item.name}</div>
                <div className={cx('truncate', item.status === 'error' ? 'text-danger' : 'text-ink-3')}>
                  {item.status === 'error'
                    ? item.error
                    : item.status === 'done'
                      ? '已进入服务器传输队列'
                      : item.status === 'canceled'
                        ? '已取消'
                        : `${formatBytes(item.loaded)} / ${formatBytes(item.size)}`}
                </div>
              </div>
              {(item.status === 'uploading' || item.status === 'queued') && (
                <IconButton icon={X} label="取消" size="sm" showTooltip={false} onClick={() => uploadStore.cancel(item.id)} />
              )}
              {(item.status === 'error' || item.status === 'canceled') && (
                <IconButton icon={RotateCw} label="重试" size="sm" showTooltip={false} onClick={() => uploadStore.retry(item.id)} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
