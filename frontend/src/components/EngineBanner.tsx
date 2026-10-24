import { useQueryClient } from '@tanstack/react-query'
import { App } from 'antd'
import { AlertTriangle, Cpu, LogIn, Play } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { engineApi, errorMessage, type EngineStatus } from '../lib/api'
import EngineLoginModal from './EngineLoginModal'
import { Card, PillButton } from './ui'

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
      <PillButton primary icon={Play} disabled={busy} onClick={() => void start()}>
        启动引擎
      </PillButton>
    )
  } else if (status.state === 'starting') {
    title = '下载引擎正在启动…'
    detail = '通常需要 10～20 秒完成初始化与上线。'
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
    detail = `PID ${status.conflicts.map((c) => c.pid).join('、')} 使用了相同设备身份时会互相踢下线，请停止其他实例（如 Docker 迅雷）。`
    action = (
      <PillButton icon={Cpu} onClick={() => navigate('/engine')}>
        查看详情
      </PillButton>
    )
  } else return null

  return (
    <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="neu-inset flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-warning">
        <AlertTriangle size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-ink">{title}</div>
        {detail && <div className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{detail}</div>}
      </div>
      {action}
      <EngineLoginModal open={login} onClose={() => setLogin(false)} />
    </Card>
  )
}
