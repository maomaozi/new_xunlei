import { useQueryClient } from '@tanstack/react-query'
import { App, Input, Modal } from 'antd'
import { Download, FileUp, Magnet, X } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { downloadsApi, errorMessage, offlineApi, type DownloadCreateResult, type TorrentPreview } from '../lib/api'
import { cx } from '../lib/cx'
import { linkName, parseLinks } from '../lib/downloads'
import { formatBytes } from '../lib/format'
import { selectedIndexes, type SubFileSelection, type SubFileTarget } from '../lib/subfiles'
import EngineFolderSelect from './EngineFolderSelect'
import SubFileSelect from './SubFileSelect'
import { PillButton } from './ui'

/** New engine download: links (magnet/HTTP/FTP/ed2k/thunder) or a .torrent file. */
export default function AddDownloadModal({
  open,
  onClose,
  initialText = '',
}: {
  open: boolean
  onClose: () => void
  initialText?: string
}) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(initialText)
  const [torrent, setTorrent] = useState<{ file: File; preview: TorrentPreview } | null>(null)
  const [selection, setSelection] = useState<SubFileSelection | null>(null)
  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const { links, invalid } = parseLinks(text)
  let subTarget: SubFileTarget | null = null
  if (torrent) {
    const preview = torrent.preview
    subTarget = { key: `torrent:${preview.info_hash}`, load: async () => preview }
  } else if (links.length === 1 && links[0].startsWith('magnet:')) {
    const url = links[0]
    subTarget = { key: url, load: () => offlineApi.resources(url) }
  }
  const files = selectedIndexes(subTarget, selection)
  const single = torrent ? !links.length : links.length === 1
  const defaultName = torrent ? torrent.preview.name : links.length === 1 ? linkName(links[0]) : ''

  const loadTorrent = async (file: File) => {
    try {
      setTorrent({ file, preview: await offlineApi.parseTorrent(file) })
      setSelection(null)
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

  const reset = () => {
    setText('')
    setTorrent(null)
    setSelection(null)
    setName('')
  }

  const submit = async () => {
    if (!links.length && !torrent) {
      message.warning('请粘贴下载链接或选择种子文件')
      return
    }
    setBusy(true)
    try {
      const results: DownloadCreateResult[] = []
      const title = single ? name.trim() : ''
      if (links.length) {
        const body = { urls: links, files: torrent ? undefined : files, name: title || undefined, folder_id: folder || undefined }
        results.push(...(await downloadsApi.create(body)).results)
      }
      if (torrent) {
        const options = { files, folder_id: folder || undefined, name: title || undefined }
        results.push(...(await downloadsApi.createFromTorrent(torrent.file, options)).results)
      }
      const failed = results.filter((r) => !r.ok)
      const ok = results.length - failed.length
      if (ok) message.success(`已添加 ${ok} 个下载任务`)
      failed.forEach((r) => message.error(`${r.source.slice(0, 48)}… ${r.error}`))
      void queryClient.invalidateQueries({ queryKey: ['downloads'] })
      if (!failed.length) {
        reset()
        onClose()
      }
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="新建下载" footer={null} width={680} onCancel={onClose} destroyOnHidden={false}>
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
          autoSize={{ minRows: 4, maxRows: 10 }}
          placeholder={'粘贴磁力、HTTP/HTTPS、FTP、ed2k 或 thunder 链接，每行一个\n也可以把 .torrent 种子文件拖到这里'}
          className="!rounded-[20px] !p-4 !text-[14px]"
        />
        {invalid.length > 0 && (
          <div className="mt-2 text-[12px] text-warning">已忽略 {invalid.length} 行无法识别的内容</div>
        )}
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
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[12px] text-ink-3">任务名称{single ? '' : '（仅单个任务可改）'}</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName || '自动识别'} disabled={!single} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] text-ink-3">保存到</span>
          <EngineFolderSelect value={folder} onChange={setFolder} disabled={!open} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <PillButton icon={FileUp} onClick={() => inputRef.current?.click()}>
          种子文件
        </PillButton>
        <SubFileSelect target={subTarget} value={selection} onChange={setSelection} />
        <div className="flex-1" />
        <span className="text-[12px] text-ink-3">{links.length + (torrent ? 1 : 0)} 个任务</span>
        <PillButton primary icon={Download} disabled={busy} onClick={() => submit()}>
          {busy ? '提交中…' : '立即下载'}
        </PillButton>
      </div>
      <div className="mt-3 text-[12px] leading-relaxed text-ink-3">
        由本机迅雷下载引擎（xldownloadlib）执行，支持 P2SP / BT / 磁力 / ed2k，会员自动启用加速；磁力和种子可先选择要下载的文件。
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
    </Modal>
  )
}
