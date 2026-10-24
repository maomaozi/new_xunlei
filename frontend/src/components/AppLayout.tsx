import { App, Dropdown, Modal } from 'antd'
import {
  Activity,
  ArrowDownUp,
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  Download,
  FolderUp,
  HardDrive,
  LayoutDashboard,
  Magnet,
  Plus,
  Settings,
  Share2,
  Trash2,
  Upload,
  UserRound,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAccountOverview, useAccountStatus } from '../hooks/useAccount'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useLiveDownloads } from '../hooks/useEngine'
import { useThemeCycle } from '../hooks/useThemeCycle'
import { useTransfers } from '../hooks/useTransfers'
import { CreateContext, useCreate, type CreateActions } from '../lib/createContext'
import { formatBytes, formatSpeed, percent } from '../lib/format'
import { uploadStore } from '../lib/uploads'
import AddDownloadModal from './AddDownloadModal'
import ZoomHint from './ZoomHint'
import BottomSheet, { SheetAction, SheetGroup } from './BottomSheet'
import OfflineCreatePanel from './OfflineCreatePanel'
import UploadDock from './UploadDock'
import { cx } from '../lib/cx'
import { TAB_ROOTS } from '../lib/nav'
import { IconTile, ProgressBar } from './ui'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const NAV_GROUPS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: '/', label: '概览', icon: LayoutDashboard },
      { to: '/downloads', label: '下载', icon: Download },
      { to: '/drive', label: '云盘', icon: HardDrive },
      { to: '/offline', label: '云添加', icon: Magnet },
    ],
  },
  {
    title: '管理',
    items: [
      { to: '/transfers', label: '传输', icon: ArrowDownUp },
      { to: '/engine', label: '下载引擎', icon: Cpu },
      { to: '/shares', label: '分享', icon: Share2 },
      { to: '/events', label: '动态', icon: Activity },
      { to: '/trash', label: '回收站', icon: Trash2 },
      { to: '/settings', label: '设置', icon: Settings },
    ],
  },
]

const MOBILE_TABS: NavItem[] = [
  { to: '/downloads', label: '下载', icon: Download },
  { to: '/drive', label: '云盘', icon: HardDrive },
  { to: '#create', label: '新建', icon: Plus },
  { to: '/offline', label: '云添加', icon: Magnet },
  { to: '/', label: '我的', icon: UserRound },
]

function isActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

function ThemeToggle({ compact }: { compact?: boolean }) {
  const { Icon, label, cycle } = useThemeCycle()
  return (
    <button
      type="button"
      onClick={cycle}
      className={cx(
        'neu-press flex cursor-pointer items-center gap-2 rounded-2xl border-0 text-ink-2',
        compact ? 'h-11 w-11 justify-center' : 'px-3.5 py-2.5 text-sm',
      )}
      aria-label={`主题：${label}`}
      title={`主题：${label}`}
    >
      <Icon size={17} />
      {!compact && <span>{label}</span>}
    </button>
  )
}

/** Engine tasks in progress, read locally from the engine every second. */
function useActiveDownloads() {
  const { data: account } = useAccountStatus()
  const { data } = useLiveDownloads(Boolean(account?.logged_in))
  const active = data?.tasks.filter((t) => t.status === 'queued' || t.status === 'running').length ?? 0
  return { active, speed: data?.speed ?? 0 }
}

/** Active task counts per nav entry: engine downloads and host transfers. */
function useActiveCounts(): Record<string, number> {
  const { data: transfers } = useTransfers()
  const downloads = useActiveDownloads()
  const running = (transfers?.summary.running ?? 0) + (transfers?.summary.queued ?? 0)
  return { '/transfers': running, '/downloads': downloads.active, '/': running }
}

function CountBadge({ count, className }: { count?: number; className?: string }) {
  if (!count) return null
  return (
    <span
      className={cx(
        'absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-[var(--bg)]',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function SpeedIndicator() {
  const { data } = useTransfers()
  const downloads = useActiveDownloads()
  const navigate = useNavigate()
  const summary = data?.summary
  const busy = (summary ? summary.running + summary.queued : 0) + downloads.active
  if (!summary || busy === 0) return null
  return (
    <button
      type="button"
      onClick={() => navigate(downloads.active ? '/downloads' : '/transfers')}
      className="glass-card flex w-full cursor-pointer items-center gap-2 rounded-2xl px-3.5 py-2.5 text-xs text-ink-2 tabular-nums"
    >
      <span className="pulse-dot h-2 w-2 rounded-full bg-accent" />
      <span className="text-accent">↓ {formatSpeed(summary.download_speed + downloads.speed)}</span>
      <span className="text-success">↑ {formatSpeed(summary.upload_speed)}</span>
    </button>
  )
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { pathname } = useLocation()
  const { data } = useAccountOverview()
  const counts = useActiveCounts()
  const create = useCreate()
  const profile = data?.profile
  const quota = data?.quota

  const createMenu = [
    { key: 'download', icon: <Download size={15} />, label: '新建下载', onClick: create.download },
    { key: 'offline', icon: <Magnet size={15} />, label: '云添加', onClick: create.offline },
    { type: 'divider' as const },
    { key: 'upload', icon: <Upload size={15} />, label: '上传文件到云盘', onClick: () => create.upload() },
    { key: 'folder', icon: <FolderUp size={15} />, label: '上传文件夹到云盘', onClick: () => create.upload(true) },
  ]

  return (
    <aside
      className={cx(
        'neu-raised sticky top-4 m-4 mr-0 flex h-[calc(100vh-2rem)] shrink-0 flex-col rounded-[30px] p-3 transition-[width] duration-300',
        collapsed ? 'w-[84px]' : 'w-[248px]',
      )}
    >
      <div className={cx('flex items-center gap-3 px-2 pt-2 pb-4', collapsed && 'justify-center px-0')}>
        <div className="accent-fill flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
          <Zap size={22} fill="currentColor" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-[16px] font-bold tracking-tight text-ink">迅雷下载</div>
            <div className="text-[11px] text-ink-3">本机下载 · 云盘</div>
          </div>
        )}
      </div>

      <div className={cx('px-1 pb-3', collapsed && 'flex justify-center')}>
        <Dropdown menu={{ items: createMenu }} trigger={['click']} placement="bottomLeft">
          <button
            type="button"
            className={cx(
              'accent-fill flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-0 text-[14px] font-semibold transition hover:brightness-105 active:brightness-95',
              collapsed ? 'h-11 w-11' : 'h-11 w-full',
            )}
            aria-label="新建"
          >
            <Plus size={18} strokeWidth={2.4} />
            {!collapsed && '新建'}
          </button>
        </Dropdown>
      </div>

      <nav className="scrollbar-none flex-1 overflow-y-auto px-1 py-1">
        {NAV_GROUPS.map((group, index) => (
          <div key={index} className={cx(index > 0 && 'mt-4')}>
            {group.title && !collapsed && <div className="mb-1.5 px-3.5 text-[11px] font-medium tracking-wider text-ink-3">{group.title}</div>}
            {group.title && collapsed && <div className="mx-auto mb-3 h-px w-8 bg-line" />}
            <div className="space-y-1">
              {group.items.map((item) => {
                const on = isActive(pathname, item.to)
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    title={collapsed ? item.label : undefined}
                    className={cx(
                      'relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[14px] font-medium no-underline transition-all duration-200',
                      on ? 'neu-inset-sm text-accent' : 'text-ink-2 hover:bg-black/[0.03] hover:text-ink dark:hover:bg-white/[0.03]',
                      collapsed && 'justify-center px-0',
                    )}
                  >
                    {on && !collapsed && <span className="absolute top-1/2 left-1 h-5 w-1 -translate-y-1/2 rounded-full bg-accent" />}
                    <span className="relative flex">
                      <item.icon size={19} strokeWidth={on ? 2.4 : 2} />
                      <CountBadge count={item.to === '/' ? 0 : counts[item.to]} className="-top-1.5 -right-2" />
                    </span>
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-2 space-y-3 px-1 pt-3">
        {!collapsed && <SpeedIndicator />}
        {profile && !collapsed && (
          <NavLink to="/" className="glass-card block rounded-2xl p-3 no-underline">
            <div className="flex items-center gap-2.5">
              <img src={profile.avatar} alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-white/60" referrerPolicy="no-referrer" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink">{profile.name}</div>
                <div className="truncate text-[11px] text-ink-3">
                  {profile.vip.label} · LV{profile.vip.level}
                </div>
              </div>
            </div>
            {quota && !quota.is_unlimited && (
              <div className="mt-3">
                <ProgressBar value={percent(quota.usage, quota.limit)} />
                <div className="mt-1.5 flex justify-between text-[11px] text-ink-3 tabular-nums">
                  <span>{formatBytes(quota.usage)}</span>
                  <span>{formatBytes(quota.limit)}</span>
                </div>
              </div>
            )}
          </NavLink>
        )}
        <div className={cx('flex gap-2', collapsed ? 'flex-col items-center' : 'items-center justify-between')}>
          <ThemeToggle compact={collapsed} />
          <button
            type="button"
            onClick={onToggle}
            className="neu-press flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl border-0 text-ink-2"
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
          </button>
        </div>
      </div>
    </aside>
  )
}

function MobileTabBar() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const counts = useActiveCounts()
  const create = useCreate()
  // Secondary pages (transfers, shares, settings…) are reached from 我的, so it stays highlighted.
  const secondary = !TAB_ROOTS.some((root) => isActive(pathname, root))

  return (
    <nav className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-2">
      <div className="glass-card pointer-events-auto mx-auto flex h-16 max-w-md items-center justify-around rounded-[26px] px-1.5">
        {MOBILE_TABS.map((tab) => {
          if (tab.to === '#create') {
            return (
              <button
                key={tab.to}
                type="button"
                aria-label="新建"
                onClick={create.sheet}
                className="tap flex flex-1 cursor-pointer justify-center border-0 bg-transparent"
              >
                <span className="accent-fill -mt-7 flex h-14 w-14 items-center justify-center rounded-[20px] ring-4 ring-[var(--bg)]">
                  <Plus size={26} strokeWidth={2.6} />
                </span>
              </button>
            )
          }
          const on = isActive(pathname, tab.to) || (tab.to === '/' && secondary)
          return (
            <button
              key={tab.to}
              type="button"
              onClick={() => navigate(tab.to)}
              className={cx(
                'tap flex flex-1 cursor-pointer flex-col items-center gap-0.5 border-0 bg-transparent py-1 text-[10.5px] font-semibold transition-colors',
                on ? 'text-accent' : 'text-ink-3',
              )}
            >
              <span className={cx('relative flex h-8 w-12 items-center justify-center rounded-full transition-all duration-200', on && 'tint')}>
                <tab.icon size={21} strokeWidth={on ? 2.4 : 2} />
                <CountBadge count={counts[tab.to]} className="-top-0.5 right-1" />
              </span>
              {tab.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/** Global create dialogs and the phone create sheet. */
function useCreateActions() {
  const { pathname } = useLocation()
  const { message } = App.useApp()
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [offlineOpen, setOfflineOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null)
  const [folderInput, setFolderInput] = useState<HTMLInputElement | null>(null)
  // Uploads started while a cloud folder is open go into that folder.
  const folderId = pathname.match(/^\/drive\/([^/]+)/)?.[1] ?? ''

  const actions = useMemo<CreateActions>(
    () => ({
      download: () => setDownloadOpen(true),
      offline: () => setOfflineOpen(true),
      upload: (folder = false) => (folder ? folderInput : fileInput)?.click(),
      sheet: () => setSheetOpen(true),
    }),
    [fileInput, folderInput],
  )

  const pick = (list: FileList | null, folderMode: boolean) => {
    if (!list?.length) return
    const entries = Array.from(list).map((file) => ({
      file,
      relativePath: folderMode ? (file as File & { webkitRelativePath: string }).webkitRelativePath : undefined,
    }))
    uploadStore.add(entries, folderId)
    message.info(`已加入上传队列：${entries.length} 个文件`)
  }

  const run = (action: () => void) => {
    setSheetOpen(false)
    action()
  }

  const elements = (
    <>
      <AddDownloadModal open={downloadOpen} onClose={() => setDownloadOpen(false)} />
      <Modal open={offlineOpen} title="云添加" footer={null} onCancel={() => setOfflineOpen(false)} width={620} destroyOnHidden>
        <div className="pt-2">
          <OfflineCreatePanel compact onCreated={() => setOfflineOpen(false)} />
        </div>
      </Modal>
      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="新建">
        <div className="mb-3 grid grid-cols-2 gap-3">
          {[
            { icon: Download, label: '新建下载', hint: '链接 / 磁力 / 种子', tone: 'accent' as const, onClick: actions.download },
            { icon: Magnet, label: '云添加', hint: '离线保存到云盘', tone: 'violet' as const, onClick: actions.offline },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => run(item.onClick)}
              className="tap flex cursor-pointer flex-col items-start gap-3 rounded-[22px] border-0 group-fill p-4 text-left"
            >
              <IconTile icon={item.icon} tone={item.tone} size={42} />
              <div>
                <div className="text-[15px] font-semibold text-ink">{item.label}</div>
                <div className="mt-0.5 text-[12px] text-ink-3">{item.hint}</div>
              </div>
            </button>
          ))}
        </div>
        <SheetGroup>
          <SheetAction icon={<Upload size={18} />} label={folderId ? '上传文件到当前文件夹' : '上传文件到云盘'} onClick={() => run(() => actions.upload())} />
          <SheetAction icon={<FolderUp size={18} />} label={folderId ? '上传文件夹到当前文件夹' : '上传文件夹到云盘'} onClick={() => run(() => actions.upload(true))} />
        </SheetGroup>
      </BottomSheet>
      <input
        ref={setFileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          pick(e.target.files, false)
          e.target.value = ''
        }}
      />
      <input
        ref={setFolderInput}
        type="file"
        hidden
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          pick(e.target.files, true)
          e.target.value = ''
        }}
      />
    </>
  )
  return { actions, elements }
}

export default function AppLayout() {
  const isMobile = useIsMobile()
  const location = useLocation()
  const create = useCreateActions()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('xl-sidebar') === 'collapsed'
    } catch {
      return false
    }
  })

  const toggle = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem('xl-sidebar', value ? 'open' : 'collapsed')
      } catch {
        // Remembering the sidebar state is a convenience only.
      }
      return !value
    })
  }

  return (
    <CreateContext.Provider value={create.actions}>
      <div className="flex min-h-dvh">
        {!isMobile && <Sidebar collapsed={collapsed} onToggle={toggle} />}
        <div className="min-w-0 flex-1">
          <main
            key={location.pathname.split('/')[1]}
            className={cx(
              'page-enter mx-auto w-full max-w-[1400px] px-4 md:px-8',
              isMobile ? 'pb-[calc(env(safe-area-inset-bottom)+104px)]' : 'pt-8 pb-10',
            )}
          >
            <ZoomHint />
            <Outlet />
          </main>
        </div>
        {isMobile && <MobileTabBar />}
        <UploadDock />
        {create.elements}
      </div>
    </CreateContext.Provider>
  )
}
