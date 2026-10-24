import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Input, QRCode, Segmented } from 'antd'
import { CheckCircle2, FileJson, KeyRound, LogOut, QrCode, RefreshCw, Save, Smartphone, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Card, PillButton, SectionHeader } from '../../components/ui'
import { useAccountOverview } from '../../hooks/useAccount'
import { accountApi, errorMessage, type QrLoginStart } from '../../lib/api'
import { formatRelative, formatTime } from '../../lib/format'

type Method = 'qr' | 'import' | 'password'

function QrLogin({ onSuccess }: { onSuccess: () => void }) {
  const { message } = App.useApp()
  const [session, setSession] = useState<QrLoginStart | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'pending' | 'expired' | 'denied' | 'success'>('idle')
  const [remaining, setRemaining] = useState(0)
  const timer = useRef<number | null>(null)

  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
  }

  const start = async () => {
    stop()
    setState('loading')
    try {
      const created = await accountApi.startQr()
      setSession(created)
      setRemaining(created.expires_in)
      setState('pending')
    } catch (error) {
      setState('idle')
      message.error(errorMessage(error))
    }
  }

  useEffect(() => {
    if (state !== 'pending' || !session) return
    const poll = async () => {
      try {
        const { status } = await accountApi.pollQr(session.session_id)
        if (status === 'pending') {
          timer.current = window.setTimeout(() => void poll(), Math.max(session.interval, 2) * 1000)
          return
        }
        setState(status)
        if (status === 'success') {
          message.success('登录成功')
          onSuccess()
        }
      } catch (error) {
        setState('expired')
        message.error(errorMessage(error))
      }
    }
    timer.current = window.setTimeout(() => void poll(), 1500)
    return stop
  }, [state, session, message, onSuccess])

  useEffect(() => {
    if (state !== 'pending') return
    const id = window.setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000)
    return () => window.clearInterval(id)
  }, [state])

  return (
    <div className="flex flex-col items-center gap-5 py-2 sm:flex-row sm:items-start">
      <div className="neu-inset relative flex h-[220px] w-[220px] shrink-0 items-center justify-center rounded-[28px] p-4">
        {session && state !== 'idle' ? (
          <QRCode
            value={session.verification_url}
            size={180}
            bordered={false}
            bgColor="#ffffff"
            color="#1f2533"
            status={state === 'expired' || state === 'denied' ? 'expired' : state === 'success' ? 'scanned' : 'active'}
            onRefresh={() => void start()}
            className="!rounded-2xl !bg-white !p-1"
          />
        ) : (
          <button type="button" onClick={() => void start()} className="neu-press flex h-full w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-[22px] border-0 text-ink-2">
            <QrCode size={40} className="text-accent" />
            <span className="text-sm">{state === 'loading' ? '正在获取…' : '获取登录二维码'}</span>
          </button>
        )}
      </div>
      <div className="space-y-3 text-[14px] text-ink-2">
        <div className="flex items-center gap-2 font-semibold text-ink">
          <Smartphone size={17} className="text-accent" /> 使用「手机迅雷」App 扫码
        </div>
        <ol className="m-0 space-y-1.5 pl-5 text-[13px] text-ink-3">
          <li>打开手机迅雷 App，点击右上角扫一扫</li>
          <li>扫描左侧二维码并在手机上确认授权</li>
          <li>授权完成后页面会自动登录</li>
        </ol>
        {session && state === 'pending' && (
          <div className="space-y-1 text-[13px]">
            <div>
              验证码：<b className="font-mono tracking-widest text-accent">{session.user_code}</b>
            </div>
            <div className="text-ink-3">二维码 {remaining}s 后过期</div>
            <a href={session.verification_url} target="_blank" rel="noreferrer" className="text-accent">
              在手机浏览器中打开授权链接
            </a>
          </div>
        )}
        {state === 'success' && (
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 size={16} /> 登录成功
          </div>
        )}
        {(state === 'expired' || state === 'denied') && (
          <PillButton icon={RefreshCw} onClick={() => void start()}>
            {state === 'denied' ? '已拒绝，重新获取' : '已过期，重新获取'}
          </PillButton>
        )}
      </div>
    </div>
  )
}

function ImportLogin({ onSuccess }: { onSuccess: () => void }) {
  const { message } = App.useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    setBusy(true)
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      await accountApi.importJson(parsed)
      message.success('凭据已导入')
      setText('')
      onSuccess()
    } catch (error) {
      message.error(error instanceof SyntaxError ? 'JSON 格式不正确' : errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const upload = async (file: File) => {
    try {
      await accountApi.importFile(file)
      message.success('凭据文件已导入')
      onSuccess()
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-[13px] leading-relaxed text-ink-3">
        支持项目根目录 <code>credentials.json</code> 格式（access_token、refresh_token、expires_at、user_id、device_id），也支持 OAuth
        Token 响应（expires_in）。若凭据来自其他迅雷客户端，请一并填写签发它的 <code>device_id</code>。
      </div>
      <Input.TextArea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoSize={{ minRows: 6, maxRows: 12 }}
        placeholder={'{\n  "access_token": "eyJhbGciOi...",\n  "refresh_token": "a1.xxxx",\n  "expires_at": 1792795177,\n  "user_id": "123456789",\n  "device_id": "0123456789abcdef0123456789abcdef"\n}'}
        className="!rounded-[20px] !p-4 !font-mono !text-[12px]"
      />
      <div className="flex flex-wrap gap-2.5">
        <PillButton primary icon={KeyRound} disabled={busy || !text.trim()} onClick={() => void submit()}>
          导入 JSON
        </PillButton>
        <PillButton icon={Upload} onClick={() => fileRef.current?.click()}>
          选择凭据文件
        </PillButton>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function PasswordLogin({ onSuccess }: { onSuccess: () => void }) {
  const { message } = App.useApp()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await accountApi.password(username.trim(), password)
      message.success('登录成功')
      setPassword('')
      onSuccess()
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="max-w-md space-y-3.5">
      <Input size="large" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="手机号 / 邮箱 / 用户名" autoComplete="username" />
      <Input.Password size="large" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码" autoComplete="current-password" onPressEnter={() => void submit()} />
      <PillButton primary icon={KeyRound} disabled={busy || !username || !password} onClick={() => void submit()}>
        {busy ? '登录中…' : '登录'}
      </PillButton>
      <div className="text-xs text-ink-3">若迅雷要求滑块/短信等人机验证，请改用扫码登录或导入凭据。</div>
    </div>
  )
}

function DeviceIdCard({ current, onSaved }: { current: string; onSaved: () => void }) {
  const { message } = App.useApp()
  const [deviceId, setDeviceId] = useState(current)
  const save = async () => {
    try {
      await accountApi.setDevice(deviceId.trim())
      message.success('设备 ID 已更新')
      onSaved()
    } catch (error) {
      message.error(errorMessage(error))
    }
  }
  return (
    <Card>
      <SectionHeader title="设备 ID（X-Device-Id）" />
      <div className="mb-3 text-[13px] text-ink-3">
        本站访问迅雷 API 时携带的设备标识（导入的 Token 应与签发它的设备 ID 一致），同时也是内置下载引擎的设备身份：下载任务下发到 device_id#该 ID 空间。修改后引擎会自动以新设备身份重启，原设备空间中的任务记录将不再显示；同一设备 ID 只能有一个引擎在线。
      </div>
      <div className="flex gap-2">
        <Input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="!font-mono" />
        <PillButton icon={Save} disabled={!deviceId.trim() || deviceId === current} onClick={() => void save()}>
          保存
        </PillButton>
      </div>
    </Card>
  )
}

export default function AccountPanel() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [method, setMethod] = useState<Method>((params.get('method') as Method | null) ?? 'qr')
  const overview = useAccountOverview()
  const status = useQuery({ queryKey: ['account', 'status'], queryFn: accountApi.status })
  const info = status.data
  const profile = overview.data?.profile

  const refreshAll = () => void queryClient.invalidateQueries()

  const refreshToken = async () => {
    try {
      await accountApi.refresh()
      message.success('Token 已刷新')
      refreshAll()
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const logout = () =>
    modal.confirm({
      title: '退出登录？',
      content: '将删除本服务保存的迅雷 Token（设备 ID 保留）。',
      okText: '退出',
      okButtonProps: { danger: true },
      onOk: async () => {
        await accountApi.logout()
        refreshAll()
      },
    })

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader
          title="当前账号"
          extra={
            info?.logged_in ? (
              <Badge tone={info.token_valid ? 'success' : 'warning'}>{info.token_valid ? '已登录' : 'Token 已过期'}</Badge>
            ) : (
              <Badge>未登录</Badge>
            )
          }
        />
        {info?.logged_in ? (
          <div className="space-y-4">
            {profile && (
              <div className="flex items-center gap-3">
                <img src={profile.avatar} alt="" referrerPolicy="no-referrer" className="h-12 w-12 rounded-full object-cover" />
                <div>
                  <div className="font-semibold text-ink">{profile.name}</div>
                  <div className="text-xs text-ink-3">
                    {profile.vip.label} · {profile.email || profile.phone}
                  </div>
                </div>
              </div>
            )}
            <div className="neu-inset grid gap-x-6 gap-y-2.5 rounded-3xl p-4 text-[13px] sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <span className="text-ink-3">用户 ID</span>
                <span className="font-mono text-ink">{info.user_id}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-ink-3">凭据来源</span>
                <span className="text-ink">{{ import: '导入', 'import-file': '导入文件', qrcode: '扫码', password: '密码', refresh: '刷新' }[info.source] ?? info.source}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-ink-3">Access Token 到期</span>
                <span className="text-ink" title={formatTime(info.expires_at)}>
                  {info.token_valid ? formatRelative(info.expires_at) : '已过期'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-ink-3">Refresh Token</span>
                <span className="text-ink">{info.has_refresh_token ? '已保存（自动续期）' : '无'}</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <PillButton icon={RefreshCw} onClick={() => void refreshToken()} disabled={!info.has_refresh_token}>
                立即刷新 Token
              </PillButton>
              <PillButton icon={LogOut} className="!text-danger" onClick={logout}>
                退出登录
              </PillButton>
            </div>
          </div>
        ) : (
          <div className="text-[13px] text-ink-3">请使用下方任一方式登录迅雷账号。</div>
        )}
      </Card>

      <Card>
        <SectionHeader title={info?.logged_in ? '切换账号 / 重新登录' : '登录迅雷账号'} />
        <Segmented
          value={method}
          onChange={(v) => setMethod(v as Method)}
          options={[
            { value: 'qr', label: '扫码登录', icon: <QrCode size={14} /> },
            { value: 'import', label: '导入凭据', icon: <FileJson size={14} /> },
            { value: 'password', label: '账号密码', icon: <KeyRound size={14} /> },
          ]}
          className="mb-5"
        />
        {method === 'qr' && <QrLogin onSuccess={refreshAll} />}
        {method === 'import' && <ImportLogin onSuccess={refreshAll} />}
        {method === 'password' && <PasswordLogin onSuccess={refreshAll} />}
      </Card>

      {info && <DeviceIdCard key={info.device_id} current={info.device_id} onSaved={refreshAll} />}
    </div>
  )
}
