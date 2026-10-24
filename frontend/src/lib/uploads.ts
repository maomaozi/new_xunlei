import { transfersApi, errorMessage } from './api'

export type BrowserUploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled'

export interface BrowserUpload {
  id: string
  name: string
  size: number
  loaded: number
  status: BrowserUploadStatus
  error: string
  parentId: string
  relativeDir: string
  file: File
  group: string
  startedAt: number
}

type Listener = () => void

let items: BrowserUpload[] = []
const listeners = new Set<Listener>()
const controllers = new Map<string, AbortController>()
let concurrency = 2
let onServerQueued: (() => void) | null = null

function emit() {
  items = [...items]
  listeners.forEach((listener) => listener())
}

function patch(id: string, change: Partial<BrowserUpload>) {
  items = items.map((item) => (item.id === id ? { ...item, ...change } : item))
  listeners.forEach((listener) => listener())
}

export const uploadStore = {
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  snapshot: () => items,
  configure(options: { concurrency: number; onServerQueued: () => void }) {
    concurrency = Math.max(1, options.concurrency)
    onServerQueued = options.onServerQueued
  },
  /** Queue browser files; `relativePath` (from folder pickers) recreates folders in the cloud. */
  add(files: { file: File; relativePath?: string }[], parentId: string) {
    const group = files.length > 1 ? Math.random().toString(36).slice(2, 12) : ''
    const added = files.map(({ file, relativePath }) => {
      const parts = (relativePath || '').split('/').filter(Boolean)
      parts.pop()
      return {
        id: Math.random().toString(36).slice(2),
        name: file.name,
        size: file.size,
        loaded: 0,
        status: 'queued' as const,
        error: '',
        parentId,
        relativeDir: parts.join('/'),
        file,
        group,
        startedAt: 0,
      }
    })
    items = [...items, ...added]
    emit()
    pump()
  },
  cancel(id: string) {
    controllers.get(id)?.abort()
    const item = items.find((entry) => entry.id === id)
    if (item && item.status === 'queued') patch(id, { status: 'canceled' })
  },
  retry(id: string) {
    patch(id, { status: 'queued', loaded: 0, error: '' })
    pump()
  },
  clearFinished() {
    items = items.filter((item) => item.status === 'queued' || item.status === 'uploading')
    emit()
  },
}

function pump() {
  const running = items.filter((item) => item.status === 'uploading').length
  const next = items.filter((item) => item.status === 'queued').slice(0, Math.max(0, concurrency - running))
  next.forEach((item) => void run(item))
}

async function run(item: BrowserUpload) {
  const controller = new AbortController()
  controllers.set(item.id, controller)
  patch(item.id, { status: 'uploading', startedAt: Date.now() })
  try {
    await transfersApi.uploadBrowser(
      item.file,
      { name: item.name, parent_id: item.parentId, relative_dir: item.relativeDir || undefined, group: item.group || undefined },
      ({ loaded }) => patch(item.id, { loaded }),
      controller.signal,
    )
    patch(item.id, { status: 'done', loaded: item.size })
    onServerQueued?.()
  } catch (error) {
    const canceled = controller.signal.aborted
    patch(item.id, { status: canceled ? 'canceled' : 'error', error: canceled ? '' : errorMessage(error) })
  } finally {
    controllers.delete(item.id)
    pump()
  }
}
