import { useQueryClient } from '@tanstack/react-query'
import { App, Input } from 'antd'
import { FileUp, FolderOpen, Magnet, Send, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { errorMessage, offlineApi, type Breadcrumb, type TorrentPreview } from '../lib/api'
import { formatBytes } from '../lib/format'
import { useAppSettings } from '../lib/settingsContext'
import FolderPickerModal from './FolderPickerModal'
import SubFileSelect from './SubFileSelect'
import { selectedIndexes, type SubFileSelection, type SubFileTarget } from '../lib/subfiles'
import { cx } from '../lib/cx'
import { PillButton } from './ui'

/** Submit magnet/http/ftp/ed2k links or a .torrent file as cloud add tasks. */
export default function OfflineCreatePanel({
  initialFolder,
  onCreated,
  compact = false,
}: {
  initialFolder?: Breadcrumb
  onCreated?: () => void
  compact?: boolean
}) {
  const { message } = App.useApp()
  const { settings } = useAppSettings()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [torrent, setTorrent] = useState<{ file: File; preview: TorrentPreview } | null>(null)
  const [folder, setFolder] = useState<Breadcrumb | null>(initialFolder ?? null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [selection, setSelection] = useState<SubFileSelection | null>(null)

  const target = folder ?? {
    id: settings?.offline.default_parent_id ?? '',
    name: settings?.offline.default_parent_name || '根目录',
  }

  const urls = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  // Sub-files can be picked for a loaded torrent, or for a single magnet link.
  let subTarget: SubFileTarget | null = null
  if (torrent) {
    const preview = torrent.preview
    subTarget = { key: `torrent:${preview.info_hash}`, load: async () => preview }
  } else if (urls.length === 1 && urls[0].startsWith('magnet:')) {
    const url = urls[0]
    subTarget = { key: url, load: () => offlineApi.resources(url) }
  }
  const files = selectedIndexes(subTarget, selection)

  const loadTorrent = async (file: File) => {
    try {
      const preview = await offlineApi.parseTorrent(file)
      setTorrent({ file, preview })
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file?.name.toLowerCase().endsWith('.torrent')) void loadTorrent(file)
    else {
      const dropped = event.dataTransfer.getData('text')
      if (dropped) setText((value) => (value ? `${value}\n${dropped}` : dropped))
    }
  }

  const submit = async () => {
    if (!urls.length && !torrent) {
      message.warning('请粘贴链接或选择种子文件')
      return
    }
    setBusy(true)
    try {
      const results: { url: string; ok: boolean; error: string }[] = []
      const urlFiles = torrent ? undefined : files
      if (urls.length) results.push(...(await offlineApi.create(urls, target.id, undefined, urlFiles)).results)
      if (torrent) results.push(...(await offlineApi.createFromTorrent(torrent.file, target.id, files)).results)
      const failed = results.filter((r) => !r.ok)
      const ok = results.length - failed.length
      if (ok) message.success(`已提交 ${ok} 个云添加任务`)
      failed.forEach((r) => message.error(`${r.url.slice(0, 48)}… ${r.error}`))
      if (!failed.length) {
        setText('')
        setTorrent(null)
        setSelection(null)
      }
      void queryClient.invalidateQueries({ queryKey: ['offline'] })
      if (ok) onCreated?.()
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cx('rounded-[24px] transition', dragging && 'ring-2 ring-accent/50')}
    >
      <Input.TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoSize={{ minRows: compact ? 3 : 4, maxRows: 10 }}
        placeholder={'粘贴磁力链接、HTTP/HTTPS、FTP 或 ed2k 链接，每行一个\n也可以把 .torrent 种子文件拖到这里'}
        className="!rounded-[20px] !p-4 !text-[14px]"
      />
      {torrent && (
        <div className="neu-inset-sm mt-3 flex items-center gap-3 rounded-2xl p-3">
          <Magnet size={18} className="shrink-0 text-success" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-ink">{torrent.preview.name}</div>
            <div className="text-xs text-ink-3">
              {torrent.preview.files.length} 个文件 · {formatBytes(torrent.preview.total_size)}
            </div>
          </div>
          <button type="button" className="cursor-pointer border-0 bg-transparent text-ink-3" onClick={() => setTorrent(null)} aria-label="移除种子">
            <X size={16} />
          </button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <PillButton icon={FileUp} onClick={() => inputRef.current?.click()}>
          种子文件
        </PillButton>
        <SubFileSelect target={subTarget} value={selection} onChange={setSelection} />
        <PillButton icon={FolderOpen} onClick={() => setPicking(true)} className="max-w-[260px]">
          <span className="truncate">保存到：{target.name}</span>
        </PillButton>
        <div className="flex-1" />
        <PillButton primary icon={Send} disabled={busy} onClick={() => submit()}>
          {busy ? '提交中…' : '开始云添加'}
        </PillButton>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".torrent,application/x-bittorrent"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void loadTorrent(file)
          e.target.value = ''
        }}
      />
      <FolderPickerModal
        open={picking}
        title="选择保存位置"
        onCancel={() => setPicking(false)}
        onPick={(picked) => {
          setFolder(picked)
          setPicking(false)
        }}
      />
    </div>
  )
}
