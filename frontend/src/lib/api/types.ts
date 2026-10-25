// Mirrors backend Pydantic schemas (see /docs for the OpenAPI contract).

export interface FileLink {
  url: string
  expire: string
  type: string
}

export interface DriveFile {
  kind: 'drive#file' | 'drive#folder' | string
  id: string
  parent_id: string
  name: string
  size: number
  file_extension: string
  mime_type: string
  starred: boolean
  web_content_link: string
  created_time: string
  modified_time: string
  icon_link: string
  thumbnail_link: string
  md5_checksum: string
  hash: string
  links: Record<string, FileLink>
  phase: string
  audit: { status: string; message: string } | null
  trashed: boolean
  delete_time: string
  original_url: string
  params: Record<string, string>
  space: string
  writable: boolean
  folder_type: string
  file_category: string
  source: string
  duration: number
  resolution: string
  parent_name: string
}

export interface FileList {
  files: DriveFile[]
  next_page_token: string
}

export interface Breadcrumb {
  id: string
  name: string
}

export interface FileLinkResponse {
  url: string
  proxy_url: string
  expire: string
  name: string
  size: number
  mime_type: string
}

export interface ReferenceResource {
  kind: string
  id: string
  parent_id: string
  name: string
  size: number
  mime_type: string
  icon_link: string
  thumbnail_link: string
  phase: string
}

export type TaskPhase =
  | 'PHASE_TYPE_PENDING'
  | 'PHASE_TYPE_RUNNING'
  | 'PHASE_TYPE_ERROR'
  | 'PHASE_TYPE_COMPLETE'
  | string

export interface DriveTask {
  kind: string
  id: string
  name: string
  type: string
  file_id: string
  file_name: string
  file_size: number
  message: string
  created_time: string
  updated_time: string
  phase: TaskPhase
  progress: number
  icon_link: string
  params: Record<string, string>
  space: string
  status_size: number
  reference_resource: ReferenceResource | null
}

export interface TaskList {
  tasks: DriveTask[]
  next_page_token: string
}

export interface OfflineCreateResult {
  url: string
  ok: boolean
  task: DriveTask | null
  error: string
}

/** A BT sub-file; `index` is the value sent as `files` when creating tasks. */
export interface SubFile {
  index: number
  path: string
  size: number
}

export interface ResourcePreview {
  name: string
  total_size: number
  files: SubFile[]
}

export interface TorrentPreview extends ResourcePreview {
  info_hash: string
  magnet: string
}

export interface Quota {
  limit: number
  usage: number
  usage_in_trash: number
  is_unlimited: boolean
}

export interface AccountStatus {
  logged_in: boolean
  token_valid: boolean
  user_id: string
  device_id: string
  expires_at: number
  has_refresh_token: boolean
  source: string
  updated_at: string
}

export interface UserProfile {
  id: string
  name: string
  avatar: string
  email: string
  phone: string
  created_at: string
  vip: {
    is_vip: boolean
    level: number
    vas_type: string
    label: string
    expire_at: string
    surplus_days: number
    icon: string
  }
}

export interface AccountOverview {
  status: AccountStatus
  profile: UserProfile | null
  quota: Quota | null
}

export interface QrLoginStart {
  session_id: string
  verification_url: string
  user_code: string
  expires_in: number
  interval: number
}

export interface ShareItem {
  share_id: string
  share_status: string
  share_status_text: string
  title: string
  icon_link: string
  thumbnail_link: string
  pass_code: string
  file_num: number
  restore_limit: number
  restore_count: number
  expiration_days: number
  expiration_at: string
  expiration_left: number
  view_count: number
  create_time: string
  share_url: string
  file_id: string
  file_kind: string
  file_size: number
  share_to: string
  params: Record<string, string>
}

export interface ShareCreated {
  share_id: string
  share_url: string
  pass_code: string
  share_text: string
}

export interface DriveEvent {
  id: string
  type: string
  type_name: string
  device: string
  created_time: string
  updated_time: string
  file_id: string
  file_name: string
  mime_type: string
  icon_url: string
  folder_id: string
  progress: number
  reference_resource: ReferenceResource | null
}

export type TransferKind = 'download' | 'upload'
export type TransferStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'canceled'

export interface TransferItem {
  id: string
  kind: TransferKind
  status: TransferStatus
  name: string
  file_id: string
  parent_id: string
  local_path: string
  size: number
  done_bytes: number
  speed: number
  phase: string
  error: string
  group_id: string
  group_name: string
  instant: boolean
  connections: number
  created_at: string
  updated_at: string
  finished_at: string
}

export interface TransferSummary {
  active: number
  queued: number
  running: number
  paused: number
  failed: number
  completed: number
  download_speed: number
  upload_speed: number
}

export interface TransferList {
  items: TransferItem[]
  summary: TransferSummary
}

export interface SystemInfo {
  version: string
  data_dir: string
  download_disk: { path: string; total: number; used: number; free: number } | null
  python: string
  platform: string
}

export interface FsEntry {
  name: string
  path: string
  kind: 'dir' | 'file'
  size: number
  modified: number
}

export interface FsListing {
  path: string
  parent: string | null
  roots: string[]
  entries: FsEntry[]
}

export type Category = 'video' | 'image' | 'audio' | 'document' | 'archive' | 'app'

export interface AppSettings {
  account: {
    client_id: string
    client_secret: string
    scope: string
    client_version: string
    package_name: string
    auto_refresh: boolean
    refresh_ahead_seconds: number
  }
  network: {
    auth_host: string
    pan_host: string
    host_overrides: Record<string, string>
    connect_timeout: number
    request_timeout: number
    max_retries: number
    retry_backoff: number
    proxy: string
    verify_tls: boolean
    api_user_agent: string
    cdn_user_agent: string
  }
  drive: {
    page_size: number
    default_view: 'list' | 'grid'
    sort_by: 'name' | 'modified_time' | 'size' | 'created_time'
    sort_order: 'asc' | 'desc'
    folders_first: boolean
    show_thumbnails: boolean
    delete_mode: 'trash' | 'permanent'
    confirm_delete: boolean
  }
  download: {
    directory: string
    max_concurrent: number
    connections_per_file: number
    min_segment_mb: number
    chunk_kb: number
    speed_limit_kbps: number
    retry_count: number
    conflict: 'rename' | 'overwrite' | 'skip'
    preserve_tree: boolean
    auto_resume: boolean
    proxy_browser_downloads: boolean
    cloud_engine: 'engine' | 'builtin'
  }
  upload: {
    temp_dir: string
    max_concurrent: number
    multipart_threshold_mb: number
    part_size_mb: number
    part_concurrency: number
    instant_only: boolean
    delete_temp_after: boolean
    retry_count: number
  }
  offline: {
    default_parent_id: string
    default_parent_name: string
    refresh_interval_seconds: number
    delete_files_with_task: boolean
  }
  engine: EngineSettings
  share: {
    expiration_days: number
    use_pass_code: boolean
    restore_limit: number
    title: string
  }
  player: {
    external_player: 'none' | 'potplayer' | 'vlc' | 'iina' | 'infuse' | 'nplayer' | 'mpv'
    autoplay: boolean
    remember_volume: boolean
  }
  ui: {
    theme: 'auto' | 'light' | 'dark'
    accent: string
    density: 'comfortable' | 'compact'
    animations: boolean
    transfer_poll_ms: number
    show_hidden_tasks: boolean
  }
  system: {
    browse_roots: string[]
  }
}

export interface EngineSettings {
  enabled: boolean
  binary_path: string
  home_dir: string
  platform: 'qnap' | 'synology' | 'docker'
  nas_id: string
  control_port: number
  public_port: number
  launcher_port: number
  download_dir: string
  extra_download_dirs: string[]
  torrent_dir: string
  device_name: string
  speed_limit_kbps: number
  max_running_tasks: number
  single_task_max_mb: number
  single_task_reserve_mb: number
  overall_share_max_mb: number
  auto_restart: boolean
  stop_with_app: boolean
  log_max_mb: number
  task_poll_seconds: number
  live_progress: boolean
  live_poll_ms: number
  control_timeout_seconds: number
  local_control_fallback: boolean
  delete_cloud_sync: boolean
  delete_files_with_task: boolean
}

export type SettingsSection = keyof AppSettings

/* ------------------------------------------------------------------ engine */

export type EngineState = 'disabled' | 'missing_binary' | 'stopped' | 'starting' | 'running' | 'crashed'

export interface EngineUser {
  id: string
  name: string
  avatar: string
  vip_level: number
  vip_expires_at: string
}

export interface EngineDisk {
  path: string
  used: number
  total: number
  is_root: boolean
}

export interface EngineStatus {
  enabled: boolean
  state: EngineState
  message: string
  pid: number | null
  uptime_seconds: number
  restarts: number
  last_exit_code: number | null
  binary_path: string
  binary_version: string
  engine_version: string
  home_dir: string
  control_port: number
  device_id: string
  space: string
  login_status: string
  login_status_known: boolean
  logged_in: boolean
  user: EngineUser
  user_mismatch: boolean
  runner_status: string
  runner_message: string
  running_tasks: number
  disks: EngineDisk[]
  conflicts: { pid: number; command: string; home: string }[]
}

export interface TrialInfo {
  supported: boolean
  status: number
  total: number
  used: number
  remaining_seconds: number
  timeout_seconds: number
  average_speed: number
  saved_seconds: number
  stop_reason: string
}

export interface EngineFolder {
  id: string
  name: string
  path: string
  writable: boolean
}

export type DownloadStatus = 'queued' | 'running' | 'paused' | 'complete' | 'error'
export type DownloadFilter = 'all' | 'active' | 'paused' | 'complete' | 'error'

export interface DownloadOperation {
  action: string
  status: 'pending' | 'confirmed' | 'submitted' | 'not_found' | 'unsupported' | 'timeout' | 'failed' | 'partial'
  message: string
  cleanup_errors?: string[]
  transport?: 'touch' | 'runner_proxy' | ''
  locally_removed?: boolean
  cloud_synced?: boolean
  local_history_retained?: boolean
  delete_files_requested?: boolean
}

export interface DownloadActionResponse {
  ok: boolean
  results: (DownloadOperation & { task_id: string; task?: DownloadTask })[]
  version: number
  epoch?: string
}

export interface DownloadTask {
  id: string
  name: string
  source: 'link' | 'cloud'
  phase: string
  status: DownloadStatus
  message: string
  error: string
  progress: number
  size: number
  done_bytes: number
  speed: number
  speedup_speed: number
  speedup: { p2p: string; vip: string; super: string }
  url: string
  cloud_file_id: string
  sub_files: string
  local_path: string
  folder_id: string
  hash: string
  icon: string
  created_at: string
  updated_at: string
  params: Record<string, string>
  capabilities?: { pause: boolean; resume: boolean; retry: boolean; delete: boolean }
  operation?: DownloadOperation | null
  stale?: boolean
  observed_at?: string
  version?: number
  paths?: string[]
}

export interface LiveTask {
  id: string
  name: string
  status: DownloadStatus
  running: boolean
  progress: number
  size: number
  done_bytes: number
  speed: number
  speedup_speed: number
  local_path: string
}

/** In-memory engine state: only tasks the engine is processing, refreshed every second. */
export interface LiveDownloads {
  tasks: LiveTask[]
  running: number
  speed: number
  version?: number
  epoch?: string
  observed_at?: string
  stale?: boolean
  source_errors?: Record<string, string>
  downloads?: DownloadTask[]
}

export interface DownloadSummary {
  total: number
  active: number
  paused: number
  complete: number
  error: number
  speed: number
}

export interface DownloadList {
  tasks: DownloadTask[]
  summary: DownloadSummary
  next_page_token: string
  version?: number
  epoch?: string
  observed_at?: string
  stale?: boolean
  source_errors?: Record<string, string>
}

export interface DownloadCreateResult {
  source: string
  ok: boolean
  task_id: string
  error: string
}
