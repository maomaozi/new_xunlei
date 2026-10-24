import { buildUrl, http, streamUpload, type UploadProgress } from './client'
import type {
  AccountOverview,
  AccountStatus,
  AppSettings,
  Breadcrumb,
  Category,
  DriveFile,
  DriveTask,
  FileLinkResponse,
  FileList,
  FsListing,
  OfflineCreateResult,
  QrLoginStart,
  SettingsSection,
  ShareCreated,
  ShareItem,
  SystemInfo,
  TaskList,
  ResourcePreview,
  TorrentPreview,
  DownloadCreateResult,
  DownloadFilter,
  DownloadList,
  DownloadTask,
  EngineFolder,
  EngineStatus,
  TrialInfo,
  TransferItem,
  TransferKind,
  TransferList,
  DriveEvent,
} from './types'

export * from './types'
export { ApiError, errorMessage, isAuthError } from './errors'
export type { UploadProgress }

type Ok = { ok: true }
type TaskRef = { task_id: string }
export type PhaseFilter = 'all' | 'running' | 'complete' | 'error'

export const accountApi = {
  status: () => http.get<AccountStatus>('/account'),
  overview: () => http.get<AccountOverview>('/account/overview'),
  importJson: (body: Record<string, unknown>) => http.post<AccountStatus>('/account/import', body),
  importFile: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return http.form<AccountStatus>('/account/import/file', form)
  },
  refresh: () => http.post<AccountStatus>('/account/refresh'),
  logout: () => http.post<Ok>('/account/logout'),
  setDevice: (device_id: string) => http.put<AccountStatus>('/account/device', { device_id }),
  startQr: () => http.post<QrLoginStart>('/account/qrcode'),
  pollQr: (sessionId: string) =>
    http.get<{ status: 'pending' | 'success' | 'expired' | 'denied' }>(`/account/qrcode/${sessionId}`),
  password: (username: string, password: string) =>
    http.post<AccountStatus>('/account/password', { username, password }),
}

export const filesApi = {
  list: (params: { parent_id?: string; page_token?: string; category?: Category; starred?: boolean }) =>
    http.get<FileList>('/files', params),
  get: (id: string) => http.get<DriveFile>(`/files/${id}`),
  path: (id: string) => http.get<Breadcrumb[]>(`/files/${id}/path`),
  link: (id: string) => http.get<FileLinkResponse>(`/files/${id}/link`),
  streamUrl: (id: string, download = false) => buildUrl(`/files/${id}/stream`, { download: download || undefined }),
  createFolder: (name: string, parent_id: string) => http.post<DriveFile>('/files/folders', { name, parent_id }),
  rename: (id: string, name: string) => http.patch<DriveFile>(`/files/${id}`, { name }),
  move: (ids: string[], parent_id: string) => http.post<TaskRef>('/files/move', { ids, parent_id }),
  copy: (ids: string[], parent_id: string) => http.post<TaskRef>('/files/copy', { ids, parent_id }),
  trash: (ids: string[]) => http.post<TaskRef>('/files/trash', { ids }),
  remove: (ids: string[]) => http.post<TaskRef>('/files/delete', { ids }),
  star: (ids: string[], starred: boolean) => http.post<Ok>('/files/star', { ids, starred }),
}

export const trashApi = {
  list: (page_token?: string) => http.get<FileList>('/trash', { page_token }),
  restore: (ids: string[]) => http.post<TaskRef>('/trash/restore', { ids }),
  remove: (ids: string[]) => http.post<TaskRef>('/trash/delete', { ids }),
  empty: () => http.post<TaskRef>('/trash/empty'),
}

export const offlineApi = {
  list: (phase: PhaseFilter, page_token?: string) => http.get<TaskList>('/offline/tasks', { phase, page_token }),
  create: (urls: string[], parent_id?: string, name?: string, files?: number[]) =>
    http.post<{ results: OfflineCreateResult[] }>('/offline/tasks', { urls, parent_id, name, files }),
  resources: (url: string) => http.post<ResourcePreview>('/offline/resources', { url }),
  parseTorrent: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return http.form<TorrentPreview>('/offline/torrent/parse', form)
  },
  createFromTorrent: (file: File, parent_id?: string, files?: number[]) => {
    const form = new FormData()
    form.append('file', file)
    if (parent_id !== undefined) form.append('parent_id', parent_id)
    if (files) form.append('files', files.join(','))
    return http.form<{ results: OfflineCreateResult[] }>('/offline/torrent', form)
  },
  get: (id: string) => http.get<DriveTask>(`/offline/tasks/${id}`),
  remove: (ids: string[], delete_files?: boolean) => http.post<Ok>('/offline/tasks/delete', { ids, delete_files }),
}

type Created = { results: DownloadCreateResult[] }

export const engineApi = {
  status: () => http.get<EngineStatus>('/engine'),
  start: () => http.post<EngineStatus>('/engine/start'),
  stop: () => http.post<EngineStatus>('/engine/stop'),
  restart: () => http.post<EngineStatus>('/engine/restart'),
  logs: (lines = 300) => http.get<{ path: string; lines: string[] }>('/engine/logs', { lines }),
  qrUrl: (nonce: number) => buildUrl('/engine/login/qrcode', { t: nonce }),
  loginStatus: () => http.get<{ status: string; logged_in: boolean }>('/engine/login/status'),
  loginLink: () => http.get<{ url: string }>('/engine/login/link'),
  logout: () => http.post<Ok>('/engine/logout'),
  trial: () => http.get<TrialInfo>('/engine/trial'),
  applyTrial: () => http.post<TrialInfo>('/engine/trial'),
  folders: (parent_id = '') => http.get<{ folders: EngineFolder[] }>('/engine/folders', { parent_id }),
}

export const downloadsApi = {
  list: (status: DownloadFilter) => http.get<DownloadList>('/downloads', { status }),
  get: (id: string) => http.get<DownloadTask>(`/downloads/${id}`),
  create: (body: { urls: string[]; files?: number[]; name?: string; folder_id?: string }) => http.post<Created>('/downloads', body),
  createFromTorrent: (file: File, options: { files?: number[]; folder_id?: string; name?: string }) => {
    const form = new FormData()
    form.append('file', file)
    if (options.files) form.append('files', options.files.join(','))
    if (options.folder_id) form.append('folder_id', options.folder_id)
    if (options.name) form.append('name', options.name)
    return http.form<Created>('/downloads/torrent', form)
  },
  cloud: (file_ids: string[], folder_id = '') => http.post<Created>('/downloads/cloud', { file_ids, folder_id }),
  pause: (ids: string[]) => http.post<Ok>('/downloads/pause', { ids }),
  resume: (ids: string[]) => http.post<Ok>('/downloads/resume', { ids }),
  retry: (ids: string[]) => http.post<Created>('/downloads/retry', { ids }),
  remove: (ids: string[], delete_files?: boolean) => http.post<Ok>('/downloads/delete', { ids, delete_files }),
}

export const sharesApi = {
  list: (page_token?: string) => http.get<{ data: ShareItem[]; next_page_token: string }>('/shares', { page_token }),
  create: (body: {
    file_ids: string[]
    expiration_days?: number
    use_pass_code?: boolean
    pass_code?: string
    restore_limit?: number
    title?: string
  }) => http.post<ShareCreated>('/shares', body),
  remove: (ids: string[]) => http.post<Ok>('/shares/delete', { ids }),
}

export const eventsApi = {
  list: (page_token?: string) =>
    http.get<{ events: DriveEvent[]; next_page_token: string }>('/events', { page_token }),
}

export const transfersApi = {
  list: (kind?: TransferKind) => http.get<TransferList>('/transfers', { kind }),
  download: (file_ids: string[], directory?: string) =>
    http.post<{ count: number }>('/transfers/downloads', { file_ids, directory: directory || undefined }),
  uploadLocal: (path: string, parent_id: string) =>
    http.post<{ count: number }>('/transfers/uploads/local', { path, parent_id }),
  uploadBrowser: (
    file: File,
    query: { name: string; parent_id: string; relative_dir?: string; group?: string },
    onProgress: (p: UploadProgress) => void,
    signal?: AbortSignal,
  ) => streamUpload<TransferItem>('/transfers/uploads/stream', query, file, onProgress, signal),
  control: (id: string, action: 'pause' | 'resume' | 'cancel') => http.post<Ok>(`/transfers/${id}/${action}`),
  remove: (ids: string[], delete_files = false) => http.post<Ok>('/transfers/delete', { ids, delete_files }),
  bulk: (action: 'pause-all' | 'resume-all' | 'clear-finished') => http.post<Ok>(`/transfers/bulk/${action}`),
}

export const settingsApi = {
  get: () => http.get<AppSettings>('/settings'),
  defaults: () => http.get<AppSettings>('/settings/defaults'),
  save: (settings: AppSettings) => http.put<AppSettings>('/settings', settings),
  reset: (section: SettingsSection) => http.post<AppSettings>(`/settings/${section}/reset`),
}

export const systemApi = {
  info: () => http.get<SystemInfo>('/system/info'),
  fs: (path?: string, include_files = true) => http.get<FsListing>('/system/fs', { path, include_files }),
}
