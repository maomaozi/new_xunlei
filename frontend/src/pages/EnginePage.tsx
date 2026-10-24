import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Input } from 'antd'
import { Cpu, Eraser, Gauge, HardDrive, LogIn, LogOut, Play, RefreshCw, Rocket, RotateCcw, Settings, Square, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import EngineLoginModal from '../components/EngineLoginModal'
import PageHeader from '../components/PageHeader'
import { Badge, Card, IconButton, PillButton, ProgressBar, SectionHeader } from '../components/ui'
import { useEngineStatus } from '../hooks/useEngine'
import { engineApi, errorMessage, type EngineStatus } from '../lib/api'
import { ENGINE_STATE } from '../lib/downloads'
import { formatBytes, formatDuration, formatSpeed, formatTime, percent } from '../lib/format'

function InfoList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="neu-inset divide-y divide-line rounded-3xl px-4 py-1 text-[13px]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4 py-2.5">
          <span className="shrink-0 text-ink-3">{label}</span>
          <span className="min-w-0 text-right break-all text-ink">{value || '--'}</span>
        </div>
      ))}
    </div>
  )
}

function ProcessCard({ status }: { status: EngineStatus }) {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const state = ENGINE_STATE[status.state]
  const alive = status.pid !== null

  // Process actions block each other while one is in flight; stop/restart confirm first and
  // run inside onOk so the dialog button shows progress.
  const run = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(true)
    try {
      queryClient.setQueryData(['engine'], await engineApi[action]())
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const act = (action: 'start' | 'stop' | 'restart') => {
    if (action === 'start') return run(action)
    modal.confirm({
      title: action === 'stop' ? '停止下载引擎？' : '重启下载引擎？',
      content: '进行中的下载会暂停，引擎再次启动后自动继续。',
      okText: action === 'stop' ? '停止' : '重启',
      onOk: () => run(action),
    })
  }

  return (
    <Card className="p-5 md:p-6">
      <SectionHeader
        title="引擎进程"
        extra={<Badge tone={state.tone}>{state.label}</Badge>}
      />
      {status.message && <div className="mb-3 text-[13px] text-ink-3">{status.message}</div>}
      <InfoList
        rows={[
          ['进程 PID', status.pid ?? '--'],
          ['运行时长', alive ? formatDuration(status.uptime_seconds) : '--'],
          ['自动重启次数', status.restarts],
          ['程序', status.binary_path],
          ['程序版本', status.engine_version || status.binary_version],
          ['数据目录', status.home_dir],
          ['本地控制端口', status.control_port],
          ['设备 ID', status.device_id],
          ['任务空间', status.space],
          ['进行中的内核任务', status.running_tasks],
        ]}
      />
      <div className="mt-4 flex flex-wrap gap-2.5">
        {!alive && (
          <PillButton primary icon={Play} disabled={busy || !status.enabled || status.state === 'missing_binary'} onClick={() => act('start')}>
            启动
          </PillButton>
        )}
        {alive && (
          <>
            <PillButton icon={RotateCcw} disabled={busy} onClick={() => act('restart')}>
              重启
            </PillButton>
            <PillButton icon={Square} disabled={busy} onClick={() => act('stop')}>
              停止
            </PillButton>
          </>
        )}
        <PillButton icon={Settings} onClick={() => navigate('/settings/engine')}>
          引擎设置
        </PillButton>
      </div>
    </Card>
  )
}

function AccountCard({ status }: { status: EngineStatus }) {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [login, setLogin] = useState(false)
  const running = status.state === 'running'
  const user = status.user

  const logout = () =>
    modal.confirm({
      title: '退出下载引擎登录？',
      content: '引擎退出后无法执行下载，需重新扫码登录。本站账号不受影响。',
      okText: '退出登录',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await engineApi.logout()
          void queryClient.invalidateQueries({ queryKey: ['engine'] })
        } catch (error) {
          message.error(errorMessage(error))
        }
      },
    })

  return (
    <Card className="p-5 md:p-6">
      <SectionHeader title="引擎账号" extra={status.logged_in ? <Badge tone="success">已登录</Badge> : <Badge>未登录</Badge>} />
      {status.logged_in ? (
        <div className="flex items-center gap-3">
          {user.avatar && <img src={user.avatar} alt="" className="h-12 w-12 rounded-full object-cover" referrerPolicy="no-referrer" />}
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-ink">{user.name || user.id}</div>
            <div className="text-[12px] text-ink-3">
              UID {user.id} · {user.vip_level ? `VIP${user.vip_level}` : '普通用户'}
              {user.vip_expires_at && ` · 会员至 ${formatTime(user.vip_expires_at)}`}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-[13px] leading-relaxed text-ink-3">
          引擎使用独立的迅雷会话（迅雷的 Refresh Token 会轮换，与本站共用会互相挤掉），扫码登录一次后由引擎自动续期。
        </div>
      )}
      {status.user_mismatch && (
        <div className="mt-3 flex gap-2 text-[12px] text-warning">
          <TriangleAlert size={15} className="shrink-0" />
          引擎账号与本站账号不同，下载列表按本站账号查询，请使用同一账号登录。
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2.5">
        <PillButton primary={!status.logged_in} icon={LogIn} disabled={!running} onClick={() => setLogin(true)}>
          {status.logged_in ? '切换账号' : '扫码登录'}
        </PillButton>
        {status.logged_in && (
          <PillButton icon={LogOut} onClick={logout}>
            退出登录
          </PillButton>
        )}
      </div>
      <EngineLoginModal open={login} onClose={() => setLogin(false)} />
    </Card>
  )
}

function DisksCard({ status }: { status: EngineStatus }) {
  const disks = status.disks.filter((d) => !d.is_root)
  if (!disks.length) return null
  return (
    <Card className="p-5 md:p-6">
      <SectionHeader title="下载目录" extra={<HardDrive size={17} className="text-ink-3" />} />
      <div className="space-y-4">
        {disks.map((disk) => (
          <div key={disk.path}>
            <div className="mb-1.5 flex justify-between gap-3 text-[13px]">
              <span className="truncate text-ink">{disk.path}</span>
              <span className="shrink-0 text-ink-3 tabular-nums">
                {formatBytes(disk.total - disk.used)} 可用 / {formatBytes(disk.total)}
              </span>
            </div>
            <ProgressBar value={percent(disk.used, disk.total)} tone={percent(disk.used, disk.total) > 90 ? 'danger' : 'accent'} />
          </div>
        ))}
      </div>
    </Card>
  )
}

/** Super speed trial: usage, start and the engine's debug reset (`try_speed/debug/clean`). */
function TrialCard() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const trial = useQuery({ queryKey: ['engine-trial'], queryFn: engineApi.trial, refetchInterval: 15000, retry: false })
  const data = trial.data
  const left = data ? Math.max(0, data.total - data.used) : 0
  const trying = Boolean(data && data.remaining_seconds > 0)

  const apply = async () => {
    try {
      queryClient.setQueryData(['engine-trial'], await engineApi.applyTrial())
      message.success('已开启超级加速试用')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }
  const clean = () =>
    modal.confirm({
      title: '重置超级加速试用？',
      content: '清除引擎本地记录的试用次数与计时（调试接口 try_speed/debug/clean），不影响会员状态。',
      okText: '重置',
      onOk: async () => {
        try {
          queryClient.setQueryData(['engine-trial'], await engineApi.cleanTrial())
          message.success('试用记录已重置')
        } catch (error) {
          message.error(errorMessage(error))
        }
      },
    })

  return (
    <Card className="p-5 md:p-6">
      <SectionHeader title="超级加速试用" extra={<Gauge size={17} className="text-ink-3" />} />
      {trial.error ? (
        <div className="text-[13px] text-danger">{errorMessage(trial.error)}</div>
      ) : (
        <InfoList
          rows={[
            ['可用次数', data ? `${left} / ${data.total}` : '--'],
            ['本次剩余', trying && data ? formatDuration(data.remaining_seconds) : '未在试用'],
            ['单次时长', data?.timeout_seconds ? formatDuration(data.timeout_seconds) : '--'],
            ['平均速度', data?.average_speed ? formatSpeed(data.average_speed) : '--'],
            ['累计节省', data?.saved_seconds ? formatDuration(data.saved_seconds) : '--'],
            ['结束原因', data?.stop_reason || '--'],
          ]}
        />
      )}
      <div className="mt-4 flex flex-wrap gap-2.5">
        <PillButton primary icon={Rocket} disabled={!data || !left || trying} onClick={() => apply()}>
          开启试用
        </PillButton>
        <PillButton icon={Eraser} onClick={clean}>
          重置试用
        </PillButton>
      </div>
      <div className="mt-3 text-[12px] text-ink-3">开启试用需要至少一个正在下载的任务。</div>
    </Card>
  )
}

function LogsCard() {
  const [lines, setLines] = useState(200)
  const [keyword, setKeyword] = useState('')
  const logs = useQuery({ queryKey: ['engine-logs', lines], queryFn: () => engineApi.logs(lines), refetchInterval: 5000 })
  const shown = (logs.data?.lines ?? []).filter((line) => !keyword || line.toLowerCase().includes(keyword.toLowerCase()))
  return (
    <Card className="p-5 md:p-6">
      <SectionHeader
        title="引擎日志"
        extra={
          <div className="flex gap-2">
            <PillButton className="!py-2" onClick={() => setLines(lines === 200 ? 1000 : 200)}>
              {lines === 200 ? '显示更多' : '最近 200 行'}
            </PillButton>
            <IconButton icon={RefreshCw} label="刷新" size="sm" onClick={() => logs.refetch()} spinning={logs.isFetching} />
          </div>
        }
      />
      <Input allowClear placeholder="过滤，例如 ERROR 或任务名" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="!mb-3" />
      <pre className="neu-inset-sm m-0 max-h-[420px] overflow-auto rounded-2xl p-3 text-[11px] leading-relaxed break-all whitespace-pre-wrap text-ink-2">
        {shown.length ? shown.join('\n') : '暂无日志'}
      </pre>
      {logs.data?.path && <div className="mt-2 text-[11px] text-ink-3">{logs.data.path}</div>}
    </Card>
  )
}

export default function EnginePage() {
  const { data: status, refetch, isFetching } = useEngineStatus(true)
  return (
    <div>
      <PageHeader
        title="下载引擎"
        subtitle="查看下载引擎状态、账号信息与运行日志"
        actions={<IconButton icon={RefreshCw} label="刷新" onClick={() => refetch()} spinning={isFetching} />}
      />
      {!status ? (
        <Card className="flex items-center gap-3 p-6 text-ink-3">
          <Cpu size={18} /> 正在读取引擎状态…
        </Card>
      ) : (
        <div className="space-y-6">
          {status.conflicts.length > 0 && (
            <Card className="p-5 text-[13px]">
              <div className="mb-2 flex items-center gap-2 font-semibold text-warning">
                <TriangleAlert size={17} /> 检测到其他迅雷引擎进程
              </div>
              <div className="mb-2 text-ink-3">相同设备 ID 的多个实例会被服务器互相踢下线，请停止以下进程：</div>
              {status.conflicts.map((c) => (
                <div key={c.pid} className="neu-inset-sm mb-2 rounded-2xl p-2.5 font-mono text-[11px] break-all text-ink-2">
                  PID {c.pid} · {c.home || '未知目录'}
                  <br />
                  {c.command}
                </div>
              ))}
            </Card>
          )}
          <div className="grid gap-6 xl:grid-cols-2">
            <ProcessCard status={status} />
            <div className="space-y-6">
              <AccountCard status={status} />
              <DisksCard status={status} />
            </div>
          </div>
          {status.state === 'running' && status.logged_in && <TrialCard />}
          <LogsCard />
        </div>
      )}
    </div>
  )
}
