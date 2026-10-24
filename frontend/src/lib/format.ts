import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** exponent
  return `${value >= 100 || exponent === 0 ? value.toFixed(0) : value.toFixed(digits)} ${UNITS[exponent]}`
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--'
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function formatEta(remaining: number, speed: number): string {
  if (speed <= 0 || remaining <= 0) return '--'
  const seconds = remaining / speed
  if (seconds > 86400 * 3) return '> 3 天'
  return formatDuration(seconds)
}

export function formatTime(value: string | number | undefined): string {
  if (!value) return '--'
  const date = typeof value === 'number' ? dayjs.unix(value) : dayjs(value)
  if (!date.isValid()) return '--'
  return date.year() === dayjs().year() ? date.format('MM-DD HH:mm') : date.format('YYYY-MM-DD HH:mm')
}

export function formatRelative(value: string | number | undefined): string {
  if (!value) return '--'
  const date = typeof value === 'number' ? dayjs.unix(value) : dayjs(value)
  return date.isValid() ? date.fromNow() : '--'
}

export function percent(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (done / total) * 100))
}
