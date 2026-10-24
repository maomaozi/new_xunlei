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
  KeyRound,
  Magnet,
  QrCode,
  Server,
  Share2,
  Upload,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import FileIcon from '../components/FileIcon'
import PageHeader from '../components/PageHeader'
import { PHASE_META } from '../lib/tasks'
import { cx } from '../lib/cx'
import { Badge, Card, EmptyState, PillButton, ProgressBar, Ring, SectionHeader, Skeleton, Stat } from '../components/ui'
import { useAccountOverview } from '../hooks/useAccount'
import { useDownloads, useEngineStatus } from '../hooks/useEngine'
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
  const options = [
    { icon: QrCode, title: '扫码登录', text: '使用手机迅雷 App 扫码授权', to: '/settings/account?method=qr' },
    { icon: KeyRound, title: '导入凭据', text: '导入 credentials.json 或 Token', to: '/settings/account?method=import' },
    { icon: Server, title: '账号密码', text: '手机号 / 邮箱 + 密码登录', to: '/settings/account?method=password' },
  ]
  return (
    <div className="mx-auto max-w-3xl py-6 md:py-14">
      <div className="mb-10 text-center">
        <div className="accent-fill mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[28px]">
          <HardDrive size={36} />
        </div>
        <h2 className="m-0 text-2xl font-bold text-ink md:text-3xl">欢迎使用迅雷下载</h2>
        <p className="mt-3 text-[15px] text-ink-3">登录迅雷账号后即可在本机高速下载链接、种子与云盘文件，并管理云盘、云添加与分享。</p>
      </div>
      <div className="stagger grid gap-5 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.title}
            type="button"
            onClick={() => navigate(option.to)}
            className="neu-press flex cursor-pointer flex-col items-center rounded-[28px] border-0 p-6 text-center"
          >
            <div className="neu-inset mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-accent">
              <option.icon size={24} />
            </div>
            <div className="text-[15px] font-semibold text-ink">{option.title}</div>
            <div className="mt-1.5 text-[12px] text-ink-3">{option.text}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function OverviewPage() {
  const navigate = useNavigate()
  const overview = useAccountOverview()
  const transfers = useTransfers()
  const engine = useEngineStatus()
  const loggedIn = overview.data?.status.logged_in
  const downloads = useDownloads('active', Boolean(loggedIn))
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
  if (!loggedIn) return <Onboarding />

  const profile = overview.data?.profile
  const quota = overview.data?.quota
  const summary = transfers.data?.summary
  const used = quota ? percent(quota.usage, quota.limit) : 0
  const disk = system.data?.download_disk
  const recentTasks = tasks.data?.tasks.slice(0, 5) ?? []
  const recentEvents = events.data?.events.slice(0, 6) ?? []

  return (
    <div>
      <PageHeader title={`${greeting()}，${profile?.name ?? ''}`} subtitle="今天也高速下载吧" />

      <div className="stagger grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card className="relative overflow-hidden p-6 md:p-7">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            <Ring value={used} size={164}>
              <div className="text-[26px] font-bold text-ink tabular-nums">{used.toFixed(1)}%</div>
              <div className="text-[11px] text-ink-3">已用空间</div>
            </Ring>
            <div className="w-full min-w-0 flex-1">
              <div className="flex items-center gap-3">
                {profile?.avatar && <img src={profile.avatar} alt="" referrerPolicy="no-referrer" className="neu-raised-sm h-12 w-12 rounded-full object-cover p-0.5" />}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[18px] font-bold text-ink">{profile?.name}</span>
                    {profile?.vip.icon ? (
                      <img src={profile.vip.icon} alt={profile.vip.label} className="h-5" referrerPolicy="no-referrer" />
                    ) : null}
                  </div>
                  <div className="text-[12px] text-ink-3">ID {profile?.id}</div>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-[13px]">
                <div className="neu-inset-sm rounded-2xl p-3">
                  <div className="text-ink-3">已用 / 总量</div>
                  <div className="mt-1 font-semibold text-ink tabular-nums">
                    {formatBytes(quota?.usage ?? 0)} / {quota?.is_unlimited ? '不限' : formatBytes(quota?.limit ?? 0)}
                  </div>
                </div>
                <div className="neu-inset-sm rounded-2xl p-3">
                  <div className="flex items-center gap-1 text-ink-3">
                    <Crown size={13} className="text-warning" /> {profile?.vip.label}
                  </div>
                  <div className="mt-1 font-semibold text-ink">
                    {profile?.vip.is_vip ? `LV${profile.vip.level} · 剩 ${profile.vip.surplus_days} 天` : '未开通'}
                  </div>
                </div>
              </div>
              {profile?.vip.expire_at && <div className="mt-3 text-[12px] text-ink-3">会员到期：{formatTime(profile.vip.expire_at)}</div>}
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <SectionHeader title="快捷操作" />
          <div className="grid grid-cols-3 gap-3.5">
            {[
              { icon: Download, label: '新建下载', to: '/downloads' },
              { icon: Magnet, label: '云添加', to: '/offline' },
              { icon: Upload, label: '上传', to: '/drive' },
              { icon: HardDrive, label: '云盘', to: '/drive' },
              { icon: ArrowDownUp, label: '传输', to: '/transfers' },
              { icon: Cpu, label: '下载引擎', to: '/engine' },
              { icon: Share2, label: '分享', to: '/shares' },
            ].map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => navigate(action.to)}
                className="neu-press flex cursor-pointer flex-col items-center gap-2 rounded-[22px] border-0 py-4 text-[13px] text-ink-2"
              >
                <action.icon size={21} className="text-accent" />
                {action.label}
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="stagger mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          icon={ArrowDown}
          label="引擎下载"
          value={formatSpeed((downloads.data?.summary.speed ?? 0) + (summary?.download_speed ?? 0))}
          hint={engine.data ? `${ENGINE_STATE[engine.data.state].label} · ${downloads.data?.summary.active ?? 0} 进行中` : undefined}
        />
        <Stat icon={ArrowUp} label="本机上传" value={formatSpeed(summary?.upload_speed ?? 0)} hint={`${summary?.running ?? 0} 进行中 · ${summary?.queued ?? 0} 排队`} tone="success" />
        <Stat
          icon={Magnet}
          label="云添加"
          value={tasks.data?.tasks.filter((t) => t.phase === 'PHASE_TYPE_RUNNING' || t.phase === 'PHASE_TYPE_PENDING').length ?? 0}
          hint="进行中的任务"
          tone="warning"
        />
        <Stat
          icon={Server}
          label="服务器磁盘"
          value={disk ? formatBytes(disk.free) : '--'}
          hint={disk ? `可用 · 共 ${formatBytes(disk.total)}` : '下载目录'}
          tone="danger"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
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
            <div className="space-y-3">
              {recentTasks.map((task) => {
                const meta = PHASE_META[task.phase] ?? PHASE_META.PHASE_TYPE_PENDING
                return (
                  <div key={task.id} className="neu-inset-sm rounded-2xl p-3">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{task.name || task.file_name}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <ProgressBar value={task.progress} tone={task.phase === 'PHASE_TYPE_ERROR' ? 'danger' : task.phase === 'PHASE_TYPE_COMPLETE' ? 'success' : 'accent'} className="flex-1" />
                      <span className="text-[11px] text-ink-3 tabular-nums">{formatBytes(task.file_size)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
        <Card>
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
            <div className="space-y-2">
              {recentEvents.map((event) => (
                <div key={event.id} className={cx('flex items-center gap-3 rounded-2xl p-2')}>
                  <FileIcon
                    file={{
                      kind: event.reference_resource?.kind ?? 'drive#file',
                      name: event.file_name,
                      mime_type: event.mime_type,
                      thumbnail_link: event.reference_resource?.thumbnail_link ?? '',
                    }}
                    size={38}
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
    </div>
  )
}
