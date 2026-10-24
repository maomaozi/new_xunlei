import type { DriveFile } from './api'

export type FileType = 'folder' | 'video' | 'image' | 'audio' | 'archive' | 'document' | 'torrent' | 'app' | 'code' | 'other'

const EXT: Record<string, FileType> = {}
const add = (type: FileType, list: string) => list.split(' ').forEach((ext) => (EXT[ext] = type))
add('video', 'mp4 mkv avi mov wmv flv webm m4v ts m2ts rmvb rm 3gp mpg mpeg iso vob')
add('image', 'jpg jpeg png gif webp bmp heic heif svg avif tif tiff raw dng')
add('audio', 'mp3 flac wav aac m4a ogg ape wma alac opus dsf dff')
add('archive', 'zip rar 7z tar gz bz2 xz zst tgz')
add('document', 'pdf doc docx xls xlsx ppt pptx txt md epub mobi csv rtf srt ass')
add('torrent', 'torrent')
add('app', 'exe msi apk ipa dmg pkg deb rpm appimage bin')
add('code', 'js ts py go rs java c cpp h json yaml yml xml html css sh')

export function extension(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index + 1).toLowerCase() : ''
}

export function fileType(file: Pick<DriveFile, 'kind' | 'name' | 'mime_type'>): FileType {
  if (file.kind === 'drive#folder') return 'folder'
  const byExt = EXT[extension(file.name)]
  if (byExt) return byExt
  const mime = file.mime_type || ''
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  return 'other'
}

export const TYPE_COLORS: Record<FileType, string> = {
  folder: '#f2b544',
  video: '#7a6cf6',
  image: '#2fb6a5',
  audio: '#f0739a',
  archive: '#a77c55',
  document: '#4f8ff0',
  torrent: '#3fb06d',
  app: '#6e7890',
  code: '#e0884a',
  other: '#8f99ab',
}

const BROWSER_VIDEO = new Set(['mp4', 'webm', 'm4v', 'mov', 'ogv'])
const BROWSER_AUDIO = new Set(['mp3', 'aac', 'm4a', 'ogg', 'wav', 'flac', 'opus'])

/** Whether the browser can usually play the file natively (codec support still varies). */
export function playable(file: DriveFile): 'video' | 'audio' | null {
  const ext = extension(file.name)
  if (BROWSER_VIDEO.has(ext)) return 'video'
  if (BROWSER_AUDIO.has(ext)) return 'audio'
  return null
}

export function isFolder(file: Pick<DriveFile, 'kind'>): boolean {
  return file.kind === 'drive#folder'
}
