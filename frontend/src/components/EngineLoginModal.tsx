import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Modal } from 'antd'
import { CheckCircle2, Copy, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { engineApi, errorMessage } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { PillButton } from './ui'

/**
 * QR login of the download engine itself. The engine keeps its own token chain, so it stays
 * signed in independently of this site's account session.
 */
export default function EngineLoginModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [nonce, setNonce] = useState(() => Date.now())
  const [imageError, setImageError] = useState(false)

  const status = useQuery({
    queryKey: ['engine-login', nonce],
    queryFn: engineApi.loginStatus,
    enabled: open,
    refetchInterval: (query) => (query.state.data?.logged_in ? false : 2000),
  })
  const done = Boolean(status.data?.logged_in)

  useEffect(() => {
    if (!done) return
    void queryClient.invalidateQueries({ queryKey: ['engine'] })
    void queryClient.invalidateQueries({ queryKey: ['downloads'] })
    message.success('下载引擎已登录')
  }, [done, message, queryClient])

  const copyLink = async () => {
    try {
      const { url } = await engineApi.loginLink()
      if (await copyText(url)) message.success('登录链接已复制，可在已登录迅雷的设备上打开确认')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  return (
    <Modal open={open} title="登录下载引擎" footer={null} onCancel={onClose} destroyOnHidden width={420}>
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        {done ? (
          <>
            <CheckCircle2 size={64} className="text-success" />
            <div className="text-[15px] font-semibold text-ink">登录成功</div>
            <PillButton primary onClick={onClose}>
              完成
            </PillButton>
          </>
        ) : (
          <>
            <div className="text-[13px] leading-relaxed text-ink-3">
              使用手机迅雷 App 扫描二维码并确认，下载引擎将以独立会话登录，与本站账号互不影响。
            </div>
            <div className="neu-inset flex h-[232px] w-[232px] items-center justify-center rounded-[28px] bg-white p-3">
              {imageError ? (
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
              <PillButton icon={Copy} onClick={() => void copyLink()}>
                复制登录链接
              </PillButton>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
