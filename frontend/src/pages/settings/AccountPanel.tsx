import { useQueryClient } from '@tanstack/react-query'
import { App } from 'antd'
import { Cpu, LogOut, QrCode, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import EngineLoginModal from '../../components/EngineLoginModal'
import { Badge, Card, PillButton, SectionHeader } from '../../components/ui'
import { useAccountOverview, useAccountStatus } from '../../hooks/useAccount'
import { useEngineStatus } from '../../hooks/useEngine'
import { accountApi, engineApi, errorMessage } from '../../lib/api'
import { formatTime } from '../../lib/format'

export default function AccountPanel() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [login, setLogin] = useState(false)
  const [busy, setBusy] = useState(false)
  const overview = useAccountOverview()
  const status = useAccountStatus()
  const engine = useEngineStatus(true)
  const info = status.data
  const profile = info?.logged_in ? overview.data?.profile : null
  const running = engine.data?.state === 'running'

  const startLogin = async () => {
    setBusy(true)
    try {
      if (!running) await engineApi.start()
      void queryClient.invalidateQueries({ queryKey: ['engine'] })
      setLogin(true)
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const refresh = async () => {
    try {
      await accountApi.refresh()
      void queryClient.invalidateQueries()
      message.success('登录状态已同步')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const logout = () => modal.confirm({
    title: '退出迅雷登录？',
    content: '退出后云盘和下载引擎都需要重新扫码登录。已有下载任务会保留。',
    okText: '退出登录',
    okButtonProps: { danger: true },
    onOk: async () => {
      await accountApi.logout()
      await queryClient.invalidateQueries()
    },
  })

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader title="迅雷账号" extra={<Badge tone={info?.logged_in ? 'success' : 'muted'}>{info?.logged_in ? '已登录' : '未登录'}</Badge>} />
        <p className="text-[13px] leading-relaxed text-ink-3">云盘与下载共用引擎账号，扫码登录一次即可使用，由引擎自动续期。</p>
        {(status.error || engine.error) && <p className="text-[13px] text-danger">{errorMessage(status.error || engine.error)}</p>}
        {info?.logged_in && (
          <div className="space-y-4">
            {profile && (
              <div className="flex items-center gap-3">
                {profile.avatar && <img src={profile.avatar} alt="" referrerPolicy="no-referrer" className="h-12 w-12 rounded-full object-cover" />}
                <div>
                  <div className="font-semibold text-ink">{profile.name}</div>
                  <div className="text-xs text-ink-3">{profile.vip.label} · {profile.email || profile.phone}</div>
                </div>
              </div>
            )}
            <div className="neu-inset space-y-2 rounded-3xl p-4 text-[13px]">
              <div className="flex justify-between gap-3"><span className="text-ink-3">用户 ID</span><span className="break-all font-mono text-ink">{info.user_id}</span></div>
              <div className="flex justify-between gap-3"><span className="text-ink-3">设备 ID</span><span className="min-w-0 break-all font-mono text-ink">{info.device_id}</span></div>
              <div className="flex justify-between gap-3"><span className="text-ink-3">会话到期</span><span className="text-ink">{formatTime(info.expires_at)}</span></div>
            </div>
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-2.5">
          {!info?.logged_in && <PillButton primary icon={QrCode} disabled={busy} onClick={() => void startLogin()}>扫码登录</PillButton>}
          {info?.logged_in && <>
            <PillButton icon={RefreshCw} onClick={() => void refresh()}>同步登录状态</PillButton>
            <PillButton icon={LogOut} className="!text-danger" onClick={logout}>退出登录 / 切换账号</PillButton>
          </>}
          <PillButton icon={Cpu} onClick={() => navigate('/engine')}>查看下载引擎</PillButton>
        </div>
      </Card>
      <EngineLoginModal open={login} onClose={() => setLogin(false)} />
    </div>
  )
}
