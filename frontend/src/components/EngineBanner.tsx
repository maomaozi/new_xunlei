import { useQueryClient } from '@tanstack/react-query'
import { App } from 'antd'
import { AlertTriangle, Cpu, LogIn, Play } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { engineApi, errorMessage, type EngineStatus } from '../lib/api'
import { formatDuration } from '../lib/format'
import EngineLoginModal from './EngineLoginModal'
import { Card, IconTile, PillButton } from './ui'

/** Explains why the engine cannot download yet and offers the fix (start / login / settings). */
export default function EngineBanner({ status }: { status: EngineStatus | undefined }) {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [login, setLogin] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!status) return null

  const start = async () => {
    setBusy(true)
    try {
      queryClient.setQueryData(['engine'], await engineApi.start())
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  let title = ''
  let detail: ReactNode = ''
  let action: ReactNode = null
  if (status.state === 'missing_binary' || status.state === 'disabled') {
    title = status.state === 'disabled' ? '下载引擎已停用' : '未找到下载引擎程序'
    detail = status.message
    action = (
      <PillButton icon={Cpu} onClick={() => navigate('/settings/engine')}>
        引擎设置
      </PillButton>
    )
  } else if (status.state === 'stopped' || status.state === 'crashed') {
    title = status.state === 'crashed' ? '下载引擎异常退出' : '下载引擎未运行'
    detail = status.message || '启动后即可在本机下载链接、种子与云盘文件。'
    action = (
      <PillButton primary icon={Play} disabled={busy} onClick={() => start()}>
        启动引擎
      </PillButton>
    )
  } else if (status.state === 'starting') {
    title = status.message && status.message !== '下载引擎正在启动…'
      ? '下载引擎接口尚未就绪' : '下载引擎正在启动…'
    detail = `${status.message || '正在等待本地接口响应。'}${status.pid !== null ? ` PID ${status.pid} · 已运行 ${formatDuration(status.uptime_seconds)}` : ''}`
    action = (
      <PillButton icon={Cpu} onClick={() => navigate('/engine')}>
        查看引擎与日志
      </PillButton>
    )
  } else if (status.state === 'running' && (
    status.login_status_known === false || (status.message && status.logged_in && !status.user_mismatch)
  )) {
    title = '下载引擎已运行，部分状态不可用'
    detail = status.message || '本地接口正常响应，当前平台无法提供登录状态与账号信息。'
    action = (
      <PillButton icon={Cpu} onClick={() => navigate('/engine')}>
        查看详情
      </PillButton>
    )
  } else if (!status.logged_in) {
    title = '下载引擎尚未登录'
    detail = '引擎使用独立的迅雷会话，扫码登录一次后会自动续期。'
    action = (
      <PillButton primary icon={LogIn} onClick={() => setLogin(true)}>
        扫码登录
      </PillButton>
    )
  } else if (status.user_mismatch) {
    title = '引擎登录的账号与本站账号不同'
    detail = `引擎账号：${status.user.name || status.user.id}。下载任务按本站账号查询，请让两者使用同一账号。`
    action = (
      <PillButton icon={LogIn} onClick={() => setLogin(true)}>
        重新登录引擎
      </PillButton>
    )
  } else if (status.conflicts.length) {
    title = '检测到其他迅雷引擎进程'
    detail = `PID ${status.conflicts.map((c) => c.pid).join('、')} 使用了相同设备身份时会互相踢下线，请停止其他实例。`
    action = (
      <PillButton icon={Cpu} onClick={() => navigate('/engine')}>
        查看详情
      </PillButton>
    )
  } else return null

  return (
    <Card glass className="mb-4 flex flex-wrap items-center gap-3 !rounded-[22px] p-3.5 sm:flex-nowrap">
      <IconTile icon={AlertTriangle} tone="warning" size={42} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-ink">{title}</div>
        {detail && <div className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{detail}</div>}
      </div>
      {action && <div className="w-full sm:w-auto [&>button]:w-full [&>button]:justify-center">{action}</div>}
      <EngineLoginModal open={login} onClose={() => setLogin(false)} />
    </Card>
  )
}
