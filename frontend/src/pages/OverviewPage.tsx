import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronRight,
  Cpu,
  Crown,
  Download,
  HardDrive,
  Magnet,
  QrCode,
  Server,
  Settings,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import FileIcon from '../components/FileIcon'
import PageHeader from '../components/PageHeader'
import { PHASE_META } from '../lib/tasks'
import { cx } from '../lib/cx'
import { Badge, Card, EmptyState, IconButton, IconTile, ListGroup, ListItem, PillButton, ProgressBar, SectionHeader, Skeleton } from '../components/ui'
import { useThemeCycle } from '../hooks/useThemeCycle'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useCreate } from '../lib/createContext'
import { useAccountOverview } from '../hooks/useAccount'
import { useEngineStatus, useLiveDownloads } from '../hooks/useEngine'
import { useTransfers } from '../hooks/useTransfers'
import { ENGINE_STATE } from '../lib/downloads'
import { errorMessage, eventsApi, offlineApi, systemApi } from '../lib/api'
import { formatBytes, formatRelative, formatSpeed, formatTime, percent } from '../lib/format'

function greeting() {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

function Onboarding() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-3xl py-6 md:py-14">
      <div className="mb-10 text-center">
        <div className="accent-fill mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[28px]">
          <HardDrive size={36} />
        </div>
        <h2 className="m-0 text-2xl font-bold text-ink md:text-3xl">欢迎使用迅雷下载</h2>
        <p className="mt-3 text-[15px] text-ink-3">登录迅雷账号后即可在本机高速下载链接、种子与云盘文件，并管理云盘、云添加与分享。</p>
      </div>
      <div className="flex justify-center">
        <PillButton primary icon={QrCode} onClick={() => navigate('/settings/account')}>扫码登录迅雷账号</PillButton>
      </div>
    </div>
  )
}

export default function OverviewPage() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const create = useCreate()
  const overview = useAccountOverview()
  const transfers = useTransfers()
  const engine = useEngineStatus()
  const loggedIn = overview.data?.status.logged_in
  const live = useLiveDownloads(Boolean(loggedIn))
  const activeDownloads = live.data?.tasks.filter((t) => t.status === 'queued' || t.status === 'running').length ?? 0
  const tasks = useQuery({ queryKey: ['offline', 'running-preview'], queryFn: () => offlineApi.list('all'), enabled: Boolean(loggedIn), refetchInterval: 10_000 })
  const events = useQuery({ queryKey: ['events', 'preview'], queryFn: () => eventsApi.list(), enabled: Boolean(loggedIn) })
  const system = useQuery({ queryKey: ['system'], queryFn: systemApi.info, staleTime: 60_000 })

  if (overview.isLoading) {
    return (
      <div className="space-y-6 pt-4">
        <Skeleton className="h-10 w-60" />
        <Skeleton className="h-52 w-full rounded-[28px]" />
      </div>
    )
  }
  if (overview.error) {
    return <EmptyState icon={HardDrive} title="无法连接迅雷" description={errorMessage(overview.error)} action={<PillButton onClick={() => overview.refetch()}>重试</PillButton>} />
  }
  if (!loggedIn)
    return (
      <>
        {isMobile && <PageHeader title="我的" actions={<MobileHeaderActions />} />}
        <Onboarding />
      </>
    )

  const profile = overview.data?.profile
  const quota = overview.data?.quota
  const summary = transfers.data?.summary
  const used = quota ? percent(quota.usage, quota.limit) : 0
  const disk = system.data?.download_disk
  const recentTasks = tasks.data?.tasks.slice(0, 5) ?? []
  const recentEvents = events.data?.events.slice(0, 6) ?? []
  const runningCloud = tasks.data?.tasks.filter((t) => t.phase === 'PHASE_TYPE_RUNNING' || t.phase === 'PHASE_TYPE_PENDING').length ?? 0
  const activeTransfers = (summary?.running ?? 0) + (summary?.queued ?? 0)
  const engineState = engine.data ? ENGINE_STATE[engine.data.state] : null

  const stats = [
    {
      icon: ArrowDown,
      label: '引擎下载',
      value: formatSpeed((live.data?.speed ?? 0) + (summary?.download_speed ?? 0)),
      hint: engineState ? `${engineState.label} · ${activeDownloads} 进行中` : undefined,
      tone: 'accent' as const,
      to: '/downloads',
    },
    { icon: ArrowUp, label: '本机上传', value: formatSpeed(summary?.upload_speed ?? 0), hint: `${summary?.running ?? 0} 进行中 · ${summary?.queued ?? 0} 排队`, tone: 'success' as const, to: '/transfers' },
    { icon: Magnet, label: '云添加', value: runningCloud, hint: '进行中的任务', tone: 'violet' as const, to: '/offline' },
    { icon: Server, label: '服务器磁盘', value: disk ? formatBytes(disk.free) : '--', hint: disk ? `可用 · 共 ${formatBytes(disk.total)}` : '下载目录', tone: 'warning' as const, to: '/settings/system' },
  ]

  const hero = (
    <div className="hero-gradient relative overflow-hidden rounded-[28px] p-5 md:p-7">
      <div className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
      <div className="relative flex items-center gap-5">
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => navigate('/settings/account')} className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left text-white">
            {profile?.avatar && <img src={profile.avatar} alt="" referrerPolicy="no-referrer" className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-white/70" />}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-[19px] font-bold">{profile?.name}</span>
                {profile?.vip.icon ? <img src={profile.vip.icon} alt={profile.vip.label} className="h-5" referrerPolicy="no-referrer" /> : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-white/85">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 font-semibold">
                  <Crown size={12} /> {profile?.vip.label}
                  {profile?.vip.is_vip ? ` · LV${profile.vip.level}` : ''}
                </span>
                <span>ID {profile?.id}</span>
              </div>
            </div>
            <ChevronRight size={18} className="ml-auto shrink-0 text-white/70 md:hidden" />
          </button>
          <div className="mt-5">
            <div className="mb-1.5 flex items-end justify-between text-[12px] text-white/85">
              <span>云盘空间</span>
              <span className="tabular-nums">
                <b className="text-[15px] text-white">{formatBytes(quota?.usage ?? 0)}</b> / {quota?.is_unlimited ? '不限' : formatBytes(quota?.limit ?? 0)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.7)] transition-[width] duration-700" style={{ width: `${Math.max(used, used > 0 ? 2 : 0)}%` }} />
            </div>
            <div className="mt-2 text-[11px] text-white/75">
              {profile?.vip.is_vip ? `会员剩余 ${profile.vip.surplus_days} 天` : '未开通会员'}
              {profile?.vip.expire_at && ` · 到期 ${formatTime(profile.vip.expire_at)}`}
            </div>
          </div>
        </div>
        <div className="hidden shrink-0 sm:block">
          <div className="relative flex h-[132px] w-[132px] items-center justify-center rounded-full bg-white/12 ring-1 ring-white/30 backdrop-blur">
            <svg width="132" height="132" className="absolute inset-0 -rotate-90">
              <circle cx="66" cy="66" r="54" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="10" />
              <circle
                cx="66"
                cy="66"
                r="54"
                fill="none"
                stroke="white"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 54}
                strokeDashoffset={2 * Math.PI * 54 * (1 - Math.min(100, used) / 100)}
                style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(.2,.8,.2,1)' }}
              />
            </svg>
            <div className="text-center">
              <div className="text-[24px] font-bold tabular-nums">{used.toFixed(1)}%</div>
              <div className="text-[11px] text-white/80">已用空间</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const statTiles = (
    <div className="stagger grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      {stats.map((stat) => (
        <button
          key={stat.label}
          type="button"
          onClick={() => navigate(stat.to)}
          className="glass-card tap flex cursor-pointer items-center gap-3 rounded-[22px] p-3.5 text-left md:gap-4 md:p-4"
        >
          <IconTile icon={stat.icon} tone={stat.tone} size={isMobile ? 38 : 46} />
          <div className="min-w-0">
            <div className="text-[11px] text-ink-3 md:text-xs">{stat.label}</div>
            <div className="truncate text-[16px] font-bold text-ink tabular-nums md:text-lg">{stat.value}</div>
            {stat.hint && <div className="truncate text-[11px] text-ink-3 md:text-xs">{stat.hint}</div>}
          </div>
        </button>
      ))}
    </div>
  )

  const recent = (
    <div className="mt-5 grid gap-5 md:mt-6 md:gap-6 lg:grid-cols-2">
      <Card className="min-w-0 p-4 md:p-5">
        <SectionHeader
          title="最近云添加"
          extra={
            <button type="button" onClick={() => navigate('/offline')} className="flex cursor-pointer items-center border-0 bg-transparent text-[13px] text-accent">
              全部 <ChevronRight size={14} />
            </button>
          }
        />
        {recentTasks.length === 0 ? (
          <div className="py-8 text-center text-sm text-ink-3">暂无任务</div>
        ) : (
          <div className="space-y-2.5">
            {recentTasks.map((task) => {
              const meta = PHASE_META[task.phase] ?? PHASE_META.PHASE_TYPE_PENDING
              return (
                <div key={task.id} className="flex items-center gap-3 rounded-2xl p-1.5">
                  <IconTile icon={meta.icon} tone={meta.tone} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{task.name || task.file_name}</span>
                      <span className="text-[11px] text-ink-3 tabular-nums">{formatBytes(task.file_size)}</span>
                    </div>
                    <ProgressBar
                      value={task.progress}
                      tone={task.phase === 'PHASE_TYPE_ERROR' ? 'danger' : task.phase === 'PHASE_TYPE_COMPLETE' ? 'success' : 'accent'}
                      className="mt-2"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
      <Card className="min-w-0 p-4 md:p-5">
        <SectionHeader
          title="最近动态"
          extra={
            <button type="button" onClick={() => navigate('/events')} className="flex cursor-pointer items-center border-0 bg-transparent text-[13px] text-accent">
              全部 <ChevronRight size={14} />
            </button>
          }
        />
        {recentEvents.length === 0 ? (
          <div className="py-8 text-center text-sm text-ink-3">
            <Activity size={18} className="mb-2" />
            <div>暂无动态</div>
          </div>
        ) : (
          <div className="space-y-1">
            {recentEvents.map((event) => (
              <div key={event.id} className={cx('flex items-center gap-3 rounded-2xl p-1.5')}>
                <FileIcon
                  file={{
                    kind: event.reference_resource?.kind ?? 'drive#file',
                    name: event.file_name,
                    mime_type: event.mime_type,
                    thumbnail_link: event.reference_resource?.thumbnail_link ?? '',
                  }}
                  size={36}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{event.file_name}</div>
                  <div className="text-[11px] text-ink-3">
                    {event.type_name} · {formatRelative(event.created_time)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )

  if (isMobile) {
    return (
      <div>
        <PageHeader title="我的" subtitle={`${greeting()}，今天也高速下载吧`} actions={<MobileHeaderActions />} />
        {hero}
        <div className="mt-4">{statTiles}</div>
        <ListGroup title="传输与下载" className="mt-5">
          <ListItem icon={ArrowDownUp} tone="success" title="传输" subtitle="上传队列与内置 HTTP 下载" extra={activeTransfers > 0 && <Badge tone="accent">{activeTransfers} 进行中</Badge>} onClick={() => navigate('/transfers')} />
          <ListItem icon={Cpu} tone="accent" title="下载引擎" subtitle="进程、账号、试用与日志" extra={engineState && <Badge tone={engineState.tone}>{engineState.label}</Badge>} onClick={() => navigate('/engine')} />
        </ListGroup>
        <ListGroup title="云盘" className="mt-5">
          <ListItem icon={Share2} tone="violet" title="我的分享" onClick={() => navigate('/shares')} />
          <ListItem icon={Activity} tone="warning" title="动态" onClick={() => navigate('/events')} />
          <ListItem icon={Trash2} tone="danger" title="回收站" onClick={() => navigate('/trash')} />
        </ListGroup>
        <ListGroup className="mt-5">
          <ListItem icon={Settings} tone="muted" title="设置" onClick={() => navigate('/settings')} />
        </ListGroup>
        {recent}
      </div>
    )
  }

  return (
    <div>
      <PageHeader title={`${greeting()}，${profile?.name ?? ''}`} subtitle="今天也高速下载吧" />

      <div className="stagger grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] [&>*]:min-w-0">
        {hero}
        <Card className="p-6">
          <SectionHeader title="快捷操作" />
          <div className="grid grid-cols-4 gap-3">
            {[
              { icon: Download, label: '新建下载', tone: 'accent' as const, onClick: create.download },
              { icon: Magnet, label: '云添加', tone: 'violet' as const, onClick: create.offline },
              { icon: Upload, label: '上传', tone: 'success' as const, onClick: () => create.upload() },
              { icon: HardDrive, label: '云盘', tone: 'warning' as const, onClick: () => navigate('/drive') },
              { icon: ArrowDownUp, label: '传输', tone: 'success' as const, onClick: () => navigate('/transfers') },
              { icon: Cpu, label: '下载引擎', tone: 'accent' as const, onClick: () => navigate('/engine') },
              { icon: Share2, label: '分享', tone: 'violet' as const, onClick: () => navigate('/shares') },
              { icon: Trash2, label: '回收站', tone: 'danger' as const, onClick: () => navigate('/trash') },
            ].map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                className="tap flex cursor-pointer flex-col items-center gap-2 rounded-[20px] border-0 bg-transparent py-3 text-[12.5px] text-ink-2 transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
              >
                <IconTile icon={action.icon} tone={action.tone} size={46} />
                {action.label}
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6">{statTiles}</div>
      {recent}
    </div>
  )
}

function MobileHeaderActions() {
  const navigate = useNavigate()
  const theme = useThemeCycle()
  return (
    <>
      <IconButton icon={theme.Icon} label={`主题：${theme.label}`} size="sm" showTooltip={false} onClick={theme.cycle} />
      <IconButton icon={Settings} label="设置" size="sm" showTooltip={false} onClick={() => navigate('/settings')} />
    </>
  )
}
