import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Modal } from 'antd'
import { CheckCircle2, Copy, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { engineApi, errorMessage } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { PillButton } from './ui'

/**
 * One engine session is shared by the cloud drive and downloads.
 */
export default function EngineLoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [nonce, setNonce] = useState(() => Date.now())
  const [imageError, setImageError] = useState(false)

  const engine = useQuery({
    queryKey: ['engine'],
    queryFn: engineApi.status,
    enabled: open,
    refetchInterval: open ? 2000 : false,
  })
  const running = engine.data?.state === 'running'
  const status = useQuery({
    queryKey: ['engine-login', nonce],
    queryFn: engineApi.loginStatus,
    enabled: open && running,
    refetchInterval: (query) => (query.state.data?.logged_in ? false : 2000),
  })
  const done = Boolean(status.data?.logged_in)

  useEffect(() => {
    if (!done || !open) return
    void queryClient.invalidateQueries()
    message.success('迅雷账号已登录')
  }, [done, open, message, queryClient])

  const close = () => {
    setNonce(Date.now())
    setImageError(false)
    onClose()
  }

  const copyLink = async () => {
    try {
      const { url } = await engineApi.loginLink()
      if (await copyText(url)) message.success('登录链接已复制，可在已登录迅雷的设备上打开确认')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  return (
    <Modal open={open} title="登录迅雷账号" footer={null} onCancel={close} destroyOnHidden width={420}>
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        {done ? (
          <>
            <CheckCircle2 size={64} className="text-success" />
            <div className="text-[15px] font-semibold text-ink">登录成功</div>
            <PillButton primary onClick={close}>
              完成
            </PillButton>
          </>
        ) : (
          <>
            <div className="text-[13px] leading-relaxed text-ink-3">
              使用手机迅雷 App 扫描二维码并确认，云盘与下载将使用同一个账号。
            </div>
            <div className="neu-inset flex h-[232px] w-[232px] items-center justify-center rounded-[28px] bg-white p-3">
              {!running ? (
                <span className="text-[13px] text-ink-3">引擎正在启动，请稍候…</span>
              ) : imageError ? (
                <span className="text-[13px] text-danger">二维码获取失败，请确认引擎正在运行</span>
              ) : (
                <img
                  src={engineApi.qrUrl(nonce)}
                  alt="下载引擎登录二维码"
                  className="h-full w-full"
                  onError={() => setImageError(true)}
                />
              )}
            </div>
            {(engine.error || status.error) && <div className="text-[12px] text-danger">{errorMessage(engine.error || status.error)}</div>}
            <div className="text-[12px] text-ink-3">{status.data?.status === 'pending' ? '等待扫码确认…' : '正在获取登录状态…'}</div>
            <div className="flex gap-2.5">
              <PillButton
                icon={RefreshCw}
                onClick={() => {
                  setImageError(false)
                  setNonce(Date.now())
                }}
              >
                刷新二维码
              </PillButton>
              <PillButton icon={Copy} onClick={() => copyLink()}>
                复制登录链接
              </PillButton>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
