import { KeyRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, PillButton } from './ui'

export default function LoginRequired({ description }: { description?: string }) {
  const navigate = useNavigate()
  return (
    <EmptyState
      icon={KeyRound}
      title="尚未登录迅雷账号"
      description={description ?? '扫码登录、账号密码登录或导入已有凭据后即可使用全部功能。'}
      action={
        <PillButton primary onClick={() => navigate('/settings/account')}>
          前往登录
        </PillButton>
      }
    />
  )
}
