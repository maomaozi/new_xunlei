import { File, FileArchive, FileCode, FileText, Film, Folder, Image as ImageIcon, Magnet, Music, Package } from 'lucide-react'
import { useState } from 'react'
import type { DriveFile } from '../lib/api'
import { fileType, TYPE_COLORS, type FileType } from '../lib/files'
import { cx } from '../lib/cx'

const ICONS: Record<FileType, typeof File> = {
  folder: Folder,
  video: Film,
  image: ImageIcon,
  audio: Music,
  archive: FileArchive,
  document: FileText,
  torrent: Magnet,
  app: Package,
  code: FileCode,
  other: File,
}

export default function FileIcon({
  file,
  size = 44,
  thumbnails = true,
  className,
}: {
  file: Pick<DriveFile, 'kind' | 'name' | 'mime_type' | 'thumbnail_link'>
  size?: number
  thumbnails?: boolean
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const type = fileType(file)
  const Icon = ICONS[type]
  const color = TYPE_COLORS[type]
  if (thumbnails && file.thumbnail_link && !broken) {
    return (
      <div className={cx('neu-raised-xs shrink-0 overflow-hidden rounded-2xl', className)} style={{ width: size, height: size }}>
        <img
          src={file.thumbnail_link}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      </div>
    )
  }
  return (
    <div
      className={cx('flex shrink-0 items-center justify-center rounded-2xl', className)}
      style={{ width: size, height: size, color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
    >
      <Icon size={Math.round(size * 0.46)} strokeWidth={1.9} fill={type === 'folder' ? `color-mix(in srgb, ${color} 35%, transparent)` : 'none'} />
    </div>
  )
}
