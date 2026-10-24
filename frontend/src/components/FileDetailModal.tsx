import { useQuery } from '@tanstack/react-query'
import { App, Modal } from 'antd'
import { Copy, Download, ExternalLink, HardDriveDownload, Play, Share2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { errorMessage, filesApi, type DriveFile } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { isFolder, playable } from '../lib/files'
import { formatBytes, formatDuration, formatTime } from '../lib/format'
import { externalPlayerUrl, PLAYERS } from '../lib/players'
import { useAppSettings } from '../lib/settingsContext'
import FileIcon from './FileIcon'
import MediaPlayer from './MediaPlayer'
import { Badge, PillButton } from './ui'

const SOURCES: Record<string, string> = {
  SOURCE_OFFLINE: '云添加',
  SOURCE_UPLOAD: '上传',
  SOURCE_RESTORE: '转存',
  SOURCE_UNKNOWN: '未知',
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-[13px]">
      <span className="shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 text-right break-all text-ink">{children}</span>
    </div>
  )
}

export default function FileDetailModal({
  file,
  autoPlay = false,
  onClose,
  onDownloadToHost,
  onShare,
}: {
  file: DriveFile | null
  autoPlay?: boolean
  onClose: () => void
  onDownloadToHost: (file: DriveFile) => void
  onShare: (file: DriveFile) => void
}) {
  const { message } = App.useApp()
  const { settings } = useAppSettings()
  const [playing, setPlaying] = useState(autoPlay)
  const id = file?.id ?? ''
  const folder = file ? isFolder(file) : false
  const detail = useQuery({ queryKey: ['file', id], queryFn: () => filesApi.get(id), enabled: Boolean(file) })
  const link = useQuery({ queryKey: ['link', id], queryFn: () => filesApi.link(id), enabled: Boolean(file) && !folder, retry: false })
  const info = detail.data ?? file
  const media = info ? playable(info) : null
  const viaProxy = settings?.download.proxy_browser_downloads ?? false
  const streamUrl = file ? filesApi.streamUrl(file.id) : ''
  const playUrl = viaProxy || !link.data ? streamUrl : link.data.url
  const player = settings?.player.external_player ?? 'none'
  const externalUrl = link.data ? externalPlayerUrl(player, viaProxy ? new URL(streamUrl, location.href).href : link.data.url) : null

  const copyLink = async () => {
    if (!link.data) return
    const ok = await copyText(link.data.url)
    if (ok) message.success('直链已复制（与服务器公网 IP 绑定）')
  }

  return (
    <Modal
      open={Boolean(file)}
      onCancel={onClose}
      footer={null}
      width={media && playing ? 960 : 560}
      title={null}
      destroyOnHidden
      afterOpenChange={(visible) => setPlaying(visible && autoPlay)}
    >
      {info && (
        <div>
          {media && playing ? (
            <div className="-mx-1 mb-5">
              <MediaPlayer src={playUrl} kind={media} />
            </div>
          ) : (
            <div className="mb-5 flex items-center gap-4 pr-8">
              <FileIcon file={info} size={64} thumbnails={settings?.drive.show_thumbnails ?? true} />
              <div className="min-w-0">
                <div className="text-[16px] font-semibold break-all text-ink">{info.name}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {!folder && <Badge>{formatBytes(info.size)}</Badge>}
                  {info.resolution && <Badge tone="accent">{info.resolution}</Badge>}
                  {info.duration > 0 && <Badge>{formatDuration(info.duration)}</Badge>}
                  {info.starred && <Badge tone="warning">已收藏</Badge>}
                  {info.audit && info.audit.status !== 'STATUS_OK' && <Badge tone="danger">{info.audit.message}</Badge>}
                </div>
              </div>
            </div>
          )}

          {!folder && (
            <div className="mb-5 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap [&>button]:justify-center">
              {media && !playing && (
                <PillButton primary icon={Play} onClick={() => setPlaying(true)}>
                  在线播放
                </PillButton>
              )}
              <PillButton icon={HardDriveDownload} onClick={() => onDownloadToHost(info)}>
                下载到服务器
              </PillButton>
              <PillButton
                icon={Download}
                disabled={!link.data}
                onClick={() => window.open(viaProxy ? filesApi.streamUrl(info.id, true) : link.data?.url, '_blank')}
              >
                浏览器下载
              </PillButton>
              <PillButton icon={Copy} disabled={!link.data} onClick={() => copyLink()}>
                复制直链
              </PillButton>
              {externalUrl && (
                <PillButton icon={ExternalLink} onClick={() => (window.location.href = externalUrl)}>
                  {PLAYERS.find((p) => p.value === player)?.label} 播放
                </PillButton>
              )}
              <PillButton icon={Share2} onClick={() => onShare(info)}>
                分享
              </PillButton>
            </div>
          )}
          {folder && (
            <div className="mb-5 grid grid-cols-1 gap-2.5 sm:flex sm:flex-wrap [&>button]:justify-center">
              <PillButton primary icon={HardDriveDownload} onClick={() => onDownloadToHost(info)}>
                整个文件夹下载到服务器
              </PillButton>
              <PillButton icon={Share2} onClick={() => onShare(info)}>
                分享
              </PillButton>
            </div>
          )}

          {link.error && !folder && <div className="mb-3 text-[13px] text-warning">{errorMessage(link.error)}</div>}

          <div className="divide-y divide-line rounded-[20px] bg-black/[0.03] px-4 py-1 dark:bg-white/[0.035]">
            {playing && <Row label="名称">{info.name}</Row>}
            <Row label="类型">{folder ? '文件夹' : info.mime_type || info.file_extension || '--'}</Row>
            <Row label="创建时间">{formatTime(info.created_time)}</Row>
            <Row label="修改时间">{formatTime(info.modified_time)}</Row>
            {!folder && <Row label="来源">{SOURCES[info.source] ?? info.source ?? '--'}</Row>}
            {info.hash && (
              <Row label="GCID">
                <span className="font-mono text-[12px]">{info.hash}</span>
              </Row>
            )}
            {info.md5_checksum && (
              <Row label="MD5">
                <span className="font-mono text-[12px]">{info.md5_checksum}</span>
              </Row>
            )}
            {info.params.width && (
              <Row label="分辨率">
                {info.params.width} × {info.params.height}
              </Row>
            )}
            {link.data?.expire && <Row label="直链有效期">{formatTime(link.data.expire)}</Row>}
            <Row label="文件 ID">
              <span className="font-mono text-[12px]">{info.id}</span>
            </Row>
          </div>
          {media && playing && (
            <div className="mt-3 text-xs text-ink-3">
              浏览器仅支持部分编码（如 H.264/AAC），HEVC/杜比等格式请使用外部播放器或下载后观看。
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
