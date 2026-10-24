import { CheckCircle2, CircleAlert, Clock3, Loader2 } from 'lucide-react'

export const PHASE_META: Record<string, { label: string; tone: 'accent' | 'success' | 'danger' | 'muted'; icon: typeof Clock3 }> = {
  PHASE_TYPE_PENDING: { label: '等待中', tone: 'muted', icon: Clock3 },
  PHASE_TYPE_RUNNING: { label: '下载中', tone: 'accent', icon: Loader2 },
  PHASE_TYPE_COMPLETE: { label: '已完成', tone: 'success', icon: CheckCircle2 },
  PHASE_TYPE_ERROR: { label: '失败', tone: 'danger', icon: CircleAlert },
}
