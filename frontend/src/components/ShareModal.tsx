import { useQueryClient } from '@tanstack/react-query'
import { App, Input, InputNumber, Modal, Segmented, Switch } from 'antd'
import { Check, Copy, Link2 } from 'lucide-react'
import { useState } from 'react'
import { errorMessage, sharesApi, type ShareCreated } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { useAppSettings } from '../lib/settingsContext'
import { PillButton } from './ui'

const DAY_OPTIONS = [
  { label: '1 天', value: 1 },
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '永久', value: -1 },
]

export default function ShareModal({
  open,
  fileIds,
  title,
  onClose,
}: {
  open: boolean
  fileIds: string[]
  title: string
  onClose: () => void
}) {
  const { message } = App.useApp()
  const { settings } = useAppSettings()
  const queryClient = useQueryClient()
  const [days, setDays] = useState(7)
  const [usePass, setUsePass] = useState(true)
  const [code, setCode] = useState('')
  const [limit, setLimit] = useState(-1)
  const [result, setResult] = useState<ShareCreated | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const resetForm = (visible: boolean) => {
    if (!visible || !settings) return
    setDays(settings.share.expiration_days)
    setUsePass(settings.share.use_pass_code)
    setLimit(settings.share.restore_limit)
    setCode('')
    setResult(null)
    setCopied(false)
  }

  const create = async () => {
    setBusy(true)
    try {
      const created = await sharesApi.create({
        file_ids: fileIds,
        expiration_days: days,
        use_pass_code: usePass,
        pass_code: code,
        restore_limit: limit,
        title,
      })
      setResult(created)
      void queryClient.invalidateQueries({ queryKey: ['shares'] })
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!result) return
    const text = result.pass_code ? `${result.share_url} 提取码：${result.pass_code}` : result.share_url
    if (await copyText(text)) {
      setCopied(true)
      message.success('分享链接已复制')
    }
  }

  return (
    <Modal
      open={open}
      title={result ? '分享已创建' : '创建分享'}
      onCancel={onClose}
      footer={null}
      width={460}
      destroyOnHidden
      afterOpenChange={resetForm}
    >
      <div className="mb-4 truncate text-sm text-ink-3">{title}</div>
      {result ? (
        <div className="space-y-4">
          <div className="neu-inset space-y-3 rounded-3xl p-4">
            <div className="flex items-center gap-2 text-[13px] text-ink-3">
              <Link2 size={14} /> 链接
            </div>
            <div className="text-[14px] break-all text-ink select-all">{result.share_url}</div>
            {result.pass_code && (
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-ink-3">提取码</span>
                <span className="font-mono text-lg font-bold tracking-[0.3em] text-accent">{result.pass_code}</span>
              </div>
            )}
          </div>
          <PillButton primary icon={copied ? Check : Copy} className="w-full justify-center" onClick={() => void copy()}>
            {copied ? '已复制' : '复制链接与提取码'}
          </PillButton>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-[13px] text-ink-2">有效期</div>
            <Segmented block value={days} options={DAY_OPTIONS} onChange={(value) => setDays(Number(value))} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[14px] text-ink">提取码</div>
              <div className="text-xs text-ink-3">留空则由迅雷随机生成</div>
            </div>
            <Switch checked={usePass} onChange={setUsePass} />
          </div>
          {usePass && (
            <Input
              value={code}
              maxLength={8}
              placeholder="自定义提取码（可选，4-8 位字母数字）"
              onChange={(e) => setCode(e.target.value.replace(/[^0-9a-zA-Z]/g, ''))}
            />
          )}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[14px] text-ink">转存次数上限</div>
              <div className="text-xs text-ink-3">-1 表示不限</div>
            </div>
            <InputNumber min={-1} value={limit} onChange={(value) => setLimit(value ?? -1)} />
          </div>
          <PillButton primary className="w-full justify-center" disabled={busy} onClick={() => void create()}>
            {busy ? '正在创建…' : '生成分享链接'}
          </PillButton>
        </div>
      )}
    </Modal>
  )
}
