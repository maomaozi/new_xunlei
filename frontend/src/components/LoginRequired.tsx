import { KeyRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, PillButton } from './ui'

export default function LoginRequired({ description }: { description?: string }) {
  const navigate = useNavigate()
  return (
    <EmptyState
      icon={KeyRound}
      title="尚未登录迅雷账号"
      description={description ?? '使用手机迅雷 App 扫码登录，云盘与下载共用一个账号。'}
      action={
        <PillButton primary onClick={() => navigate('/settings/account')}>
          前往登录
        </PillButton>
      }
    />
  )
}
