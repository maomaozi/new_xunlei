import {
  Activity,
  ArrowDownUp,
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  Download,
  HardDrive,
  LayoutDashboard,
  Magnet,
  Menu,
  Moon,
  Settings,
  Share2,
  Sun,
  SunMoon,
  Trash2,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAccountOverview, useAccountStatus } from '../hooks/useAccount'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useDownloads } from '../hooks/useEngine'
import { useTransfers } from '../hooks/useTransfers'
import { formatBytes, formatSpeed, percent } from '../lib/format'
import { useAppSettings } from '../lib/settingsContext'
import BottomSheet, { SheetAction } from './BottomSheet'
import UploadDock from './UploadDock'
import { cx } from '../lib/cx'
import { ProgressBar } from './ui'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const NAV: NavItem[] = [
  { to: '/', label: '概览', icon: LayoutDashboard },
  { to: '/downloads', label: '下载', icon: Download },
  { to: '/drive', label: '云盘', icon: HardDrive },
  { to: '/offline', label: '云添加', icon: Magnet },
  { to: '/transfers', label: '传输', icon: ArrowDownUp },
  { to: '/engine', label: '下载引擎', icon: Cpu },
  { to: '/shares', label: '分享', icon: Share2 },
  { to: '/events', label: '动态', icon: Activity },
  { to: '/trash', label: '回收站', icon: Trash2 },
  { to: '/settings', label: '设置', icon: Settings },
]

const MOBILE_TABS: NavItem[] = [
  { to: '/downloads', label: '下载', icon: Download },
  { to: '/drive', label: '云盘', icon: HardDrive },
  { to: '/offline', label: '云添加', icon: Magnet },
  { to: '/', label: '我的', icon: LayoutDashboard },
]

function isActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

function useThemeCycle() {
  const { settings, update } = useAppSettings()
  const mode = settings?.ui.theme ?? 'auto'
  const next = mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto'
  return {
    Icon: mode === 'auto' ? SunMoon : mode === 'light' ? Sun : Moon,
    label: { auto: '跟随系统', light: '浅色', dark: '深色' }[mode],
    cycle: () => void update('ui', { theme: next }),
  }
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

/** Active task counts per nav entry: engine downloads and host transfers. */
function useActiveDownloads() {
  const { data: account } = useAccountStatus()
  return useDownloads('active', Boolean(account?.logged_in))
}

function useActiveCounts(): Record<string, number> {
  const { data: transfers } = useTransfers()
  const { data: downloads } = useActiveDownloads()
  return {
    '/transfers': (transfers?.summary.running ?? 0) + (transfers?.summary.queued ?? 0),
    '/downloads': downloads?.summary.active ?? 0,
  }
}

function SpeedIndicator() {
  const { data } = useTransfers()
  const { data: downloads } = useActiveDownloads()
  const navigate = useNavigate()
  const summary = data?.summary
  const engineSpeed = downloads?.summary.speed ?? 0
  const busy = (summary ? summary.running + summary.queued : 0) + (downloads?.summary.active ?? 0)
  if (!summary || busy === 0) return null
  return (
    <button
      type="button"
      onClick={() => navigate(downloads?.summary.active ? '/downloads' : '/transfers')}
      className="neu-press flex w-full cursor-pointer items-center gap-2 rounded-2xl border-0 px-3.5 py-2.5 text-xs text-ink-2 tabular-nums"
    >
      <span className="pulse-dot h-2 w-2 rounded-full bg-accent" />
      <span>↓ {formatSpeed(summary.download_speed + engineSpeed)}</span>
      <span>↑ {formatSpeed(summary.upload_speed)}</span>
    </button>
  )
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { pathname } = useLocation()
  const { data } = useAccountOverview()
  const counts = useActiveCounts()
  const profile = data?.profile
  const quota = data?.quota

  return (
    <aside
      className={cx(
        'neu-raised sticky top-4 m-4 mr-0 flex h-[calc(100vh-2rem)] shrink-0 flex-col rounded-[30px] p-3 transition-[width] duration-300',
        collapsed ? 'w-[84px]' : 'w-[248px]',
      )}
    >
      <div className={cx('flex items-center gap-3 px-2 pt-2 pb-5', collapsed && 'justify-center px-0')}>
        <div className="accent-fill flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
          <Zap size={22} fill="currentColor" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-[16px] font-bold tracking-tight text-ink">迅雷云盘</div>
            <div className="text-[11px] text-ink-3">Xunlei Web</div>
          </div>
        )}
      </div>

      <nav className="scrollbar-none flex-1 space-y-2 overflow-y-auto px-1 py-1">
        {NAV.map((item) => {
          const on = isActive(pathname, item.to)
          return (
            <NavLink
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
              data-active={on ? 'true' : undefined}
              className={cx(
                'flex items-center gap-3 rounded-2xl px-3.5 py-3 text-[14px] font-medium no-underline transition-all duration-200',
                on ? 'neu-inset-sm text-accent' : 'text-ink-2 hover:text-ink',
                collapsed && 'justify-center px-0',
              )}
            >
              <span className="relative flex">
                <item.icon size={19} strokeWidth={on ? 2.4 : 2} />
                {(counts[item.to] ?? 0) > 0 && (
                  <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                    {counts[item.to]}
                  </span>
                )}
              </span>
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          )
        })}
      </nav>

      <div className="mt-2 space-y-3 px-1 pt-3">
        {!collapsed && <SpeedIndicator />}
        {profile && !collapsed && (
          <NavLink to="/" className="neu-inset-sm block rounded-2xl p-3 no-underline">
            <div className="flex items-center gap-2.5">
              <img src={profile.avatar} alt="" className="h-9 w-9 rounded-full object-cover" referrerPolicy="no-referrer" />
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
  const [moreOpen, setMoreOpen] = useState(false)
  const theme = useThemeCycle()
  const counts = useActiveCounts()
  const tabActive = MOBILE_TABS.some((tab) => isActive(pathname, tab.to))
  const extra = NAV.filter((item) => !MOBILE_TABS.some((tab) => tab.to === item.to))

  return (
    <>
      <nav className="glass safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line">
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pt-1.5 pb-1">
          {[...MOBILE_TABS, { to: '#more', label: '更多', icon: Menu }].map((tab) => {
            const on = tab.to === '#more' ? !tabActive || moreOpen : isActive(pathname, tab.to)
            return (
              <button
                key={tab.to}
                type="button"
                onClick={() => (tab.to === '#more' ? setMoreOpen(true) : navigate(tab.to))}
                className={cx(
                  'flex flex-1 cursor-pointer flex-col items-center gap-1 border-0 bg-transparent py-1.5 text-[11px] font-medium transition-colors',
                  on ? 'text-accent' : 'text-ink-3',
                )}
              >
                <span
                  className={cx(
                    'relative flex h-8 w-12 items-center justify-center rounded-2xl transition-all duration-200',
                    on && 'neu-inset-sm',
                  )}
                >
                  <tab.icon size={20} strokeWidth={on ? 2.4 : 2} />
                  {(counts[tab.to] ?? 0) > 0 && (
                    <span className="absolute -top-0.5 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                      {counts[tab.to]}
                    </span>
                  )}
                </span>
                {tab.label}
              </button>
            )
          })}
        </div>
      </nav>
      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="更多">
        <div className="grid grid-cols-3 gap-3 pb-2">
          {extra.map((item) => (
            <button
              key={item.to}
              type="button"
              onClick={() => {
                setMoreOpen(false)
                navigate(item.to)
              }}
              className={cx(
                'neu-press flex cursor-pointer flex-col items-center gap-2 rounded-3xl border-0 py-4 text-[13px]',
                isActive(pathname, item.to) ? 'text-accent' : 'text-ink-2',
              )}
            >
              <item.icon size={22} />
              {item.label}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <SheetAction icon={<theme.Icon size={18} />} label={`主题：${theme.label}（点击切换）`} onClick={theme.cycle} />
        </div>
      </BottomSheet>
    </>
  )
}

export default function AppLayout() {
  const isMobile = useIsMobile()
  const location = useLocation()
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
    <div className="flex min-h-full bg-page">
      {!isMobile && <Sidebar collapsed={collapsed} onToggle={toggle} />}
      <div className="min-w-0 flex-1">
        <main
          key={location.pathname.split('/')[1]}
          className={cx(
            'page-enter mx-auto w-full max-w-[1400px] px-4 md:px-8',
            isMobile ? 'pb-28' : 'pt-8 pb-10',
          )}
        >
          <Outlet />
        </main>
      </div>
      {isMobile && <MobileTabBar />}
      <UploadDock />
    </div>
  )
}

