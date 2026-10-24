import { useQueryClient } from '@tanstack/react-query'
import { App, Checkbox, Segmented } from 'antd'
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Brush,
  CheckCircle2,
  CircleAlert,
  Pause,
  Play,
  Download,
  RotateCw,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import { cx } from '../lib/cx'
import { Badge, Card, EmptyState, IconButton, ListSkeleton, PillButton, ProgressBar, Stat } from '../components/ui'
import { useBrowserUploads } from '../hooks/useBrowserUploads'
import { useTransfers } from '../hooks/useTransfers'
import { errorMessage, transfersApi, type TransferItem } from '../lib/api'
import { formatBytes, formatEta, formatSpeed, formatTime, percent } from '../lib/format'

type Filter = 'all' | 'download' | 'upload' | 'active' | 'finished'

type Action = 'pause' | 'resume' | 'cancel' | 'delete'

const PHASES: Record<string, string> = {
  resolving: '准备中',
  downloading: '下载中',
  finalizing: '整理文件',
  hashing: '计算 GCID',
  creating: '秒传检测',
  uploading: '上传中',
  instant: '秒传成功',
  skipped: '已存在，跳过',
  done: '完成',
}

const STATUS: Record<TransferItem['status'], { label: string; tone: 'accent' | 'success' | 'danger' | 'muted' | 'warning' }> = {
  queued: { label: '排队中', tone: 'muted' },
  running: { label: '进行中', tone: 'accent' },
  paused: { label: '已暂停', tone: 'warning' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  canceled: { label: '已取消', tone: 'muted' },
}

function RowActions({ item, onAction }: { item: TransferItem; onAction: (action: Action) => unknown }) {
  return (
    <div className="flex shrink-0 gap-2">
      {(item.status === 'running' || item.status === 'queued') && <IconButton icon={Pause} label="暂停" size="sm" onClick={() => onAction('pause')} />}
      {item.status === 'paused' && <IconButton icon={Play} label="继续" size="sm" tone="accent" onClick={() => onAction('resume')} />}
      {(item.status === 'failed' || item.status === 'canceled') && <IconButton icon={RotateCw} label="重试" size="sm" tone="accent" onClick={() => onAction('resume')} />}
      {(item.status === 'running' || item.status === 'queued' || item.status === 'paused') && (
        <IconButton icon={X} label="取消" size="sm" onClick={() => onAction('cancel')} className="hidden md:inline-flex" />
      )}
      <IconButton icon={Trash2} label="删除记录" size="sm" tone="danger" onClick={() => onAction('delete')} />
    </div>
  )
}

function TransferRow({ item, onAction }: { item: TransferItem; onAction: (action: Action) => unknown }) {
  const status = STATUS[item.status]
  const value = item.status === 'completed' ? 100 : percent(item.done_bytes, item.size)
  const active = item.status === 'running'
  const Icon = item.kind === 'download' ? ArrowDown : ArrowUp
  const phase = PHASES[item.phase] ?? item.phase
  return (
    <div className="flex items-start gap-3 rounded-[22px] p-3.5 md:items-center md:gap-4 md:p-4">
      <div
        className={cx(
          'neu-raised-xs flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
          item.status === 'failed' ? 'text-danger' : item.status === 'completed' ? 'text-success' : 'text-accent',
        )}
      >
        {item.status === 'completed' ? <CheckCircle2 size={20} /> : item.status === 'failed' ? <CircleAlert size={20} /> : <Icon size={20} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium text-ink" title={item.local_path}>
            {item.name}
          </span>
          {item.instant && (
            <Badge tone="success">
              <Zap size={10} fill="currentColor" /> 秒传
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3 tabular-nums">
          <Badge tone={status.tone}>{active && phase ? phase : status.label}</Badge>
          <span>
            {formatBytes(item.status === 'completed' ? item.size : item.done_bytes)} / {formatBytes(item.size)}
          </span>
          {active && item.speed > 0 && <span className="text-accent">{formatSpeed(item.speed)}</span>}
          {active && item.speed > 0 && <span>剩余 {formatEta(item.size - item.done_bytes, item.speed)}</span>}
          {active && item.connections > 1 && <span>{item.connections} 线程</span>}
          {item.group_name && <span className="truncate">· {item.group_name}</span>}
          {item.finished_at && !active && <span>{formatTime(item.finished_at)}</span>}
        </div>
        {item.error && <div className="mt-1 text-[12px] break-all text-danger">{item.error}</div>}
        {item.status !== 'completed' && (
          <div className="mt-2.5 flex items-center gap-3">
            <ProgressBar
              value={value}
              animated={active}
              tone={item.status === 'failed' ? 'danger' : item.status === 'paused' ? 'warning' : 'accent'}
              className="flex-1"
            />
            <span className="w-12 text-right text-xs text-ink-2 tabular-nums">{value.toFixed(1)}%</span>
          </div>
        )}
        <div className="mt-1 hidden truncate text-[11px] text-ink-3 md:block">{item.local_path}</div>
      </div>
      <RowActions item={item} onAction={onAction} />
    </div>
  )
}

export default function TransfersPage() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const { data, isLoading } = useTransfers()
  const browserUploads = useBrowserUploads()
  const [filter, setFilter] = useState<Filter>('all')
  const navigate = useNavigate()
  const summary = data?.summary

  const items = useMemo(() => {
    const all = data?.items ?? []
    switch (filter) {
      case 'download':
        return all.filter((i) => i.kind !== 'upload')
      case 'upload':
        return all.filter((i) => i.kind === filter)
      case 'active':
        return all.filter((i) => ['queued', 'running', 'paused'].includes(i.status))
      case 'finished':
        return all.filter((i) => ['completed', 'failed', 'canceled'].includes(i.status))
      default:
        return all
    }
  }, [data, filter])

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['transfers'] })

  const confirmDelete = (item: TransferItem) => {
    let deleteFiles = false
    // The API call runs inside onOk so the dialog's button shows progress and blocks repeats.
    modal.confirm({
          title: '删除传输记录？',
          content:
            item.kind !== 'upload' && item.status === 'completed' ? (
              <div className="pt-2">
                <Checkbox onChange={(e) => (deleteFiles = e.target.checked)}>同时删除已下载到服务器的文件</Checkbox>
              </div>
            ) : (
              '未完成的临时文件会一并清理。'
            ),
          okText: '删除',
          okButtonProps: { danger: true },
          onOk: async () => {
            try {
              await transfersApi.remove([item.id], deleteFiles)
              refresh()
            } catch (error) {
              message.error(errorMessage(error))
            }
          },
        })
  }

  const act = async (item: TransferItem, action: Action) => {
    if (action === 'delete') return confirmDelete(item)
    try {
      await transfersApi.control(item.id, action)
      refresh()
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const bulk = async (action: 'pause-all' | 'resume-all' | 'clear-finished') => {
    try {
      await transfersApi.bulk(action)
      refresh()
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const uploadingInBrowser = browserUploads.filter((u) => u.status === 'uploading' || u.status === 'queued').length

  return (
    <div>
      <PageHeader
        title="传输"
        subtitle="上传队列与内置 HTTP 下载器（多线程分段、断点续传）"
        actions={
          <PillButton icon={Download} onClick={() => navigate('/downloads')}>
            迅雷引擎下载
          </PillButton>
        }
      />
      <div className="stagger mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={ArrowDown} label="下载速度" value={formatSpeed(summary?.download_speed ?? 0)} />
        <Stat icon={ArrowUp} label="上传速度" value={formatSpeed(summary?.upload_speed ?? 0)} tone="success" />
        <Stat icon={ArrowDownUp} label="进行中 / 排队" value={`${summary?.running ?? 0} / ${summary?.queued ?? 0}`} hint={uploadingInBrowser ? `浏览器正在传输 ${uploadingInBrowser} 项` : undefined} tone="warning" />
        <Stat icon={CircleAlert} label="失败" value={summary?.failed ?? 0} hint={`已完成 ${summary?.completed ?? 0}`} tone="danger" />
      </div>
      <Card className="p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-3 px-2 pt-1 pb-3">
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            options={[
              { label: '全部', value: 'all' },
              { label: '下载', value: 'download' },
              { label: '上传', value: 'upload' },
              { label: '进行中', value: 'active' },
              { label: '已结束', value: 'finished' },
            ]}
          />
          <div className="flex-1" />
          <div className="flex gap-2">
            <PillButton icon={Pause} onClick={() => bulk('pause-all')} className="!px-3">
              <span className="hidden sm:inline">全部暂停</span>
            </PillButton>
            <PillButton icon={Play} onClick={() => bulk('resume-all')} className="!px-3">
              <span className="hidden sm:inline">全部继续</span>
            </PillButton>
            <PillButton icon={Brush} onClick={() => bulk('clear-finished')} className="!px-3">
              <span className="hidden sm:inline">清除已完成</span>
            </PillButton>
          </div>
        </div>
        {isLoading ? (
          <ListSkeleton rows={5} />
        ) : items.length === 0 ? (
          <EmptyState icon={ArrowDownUp} title="没有传输任务" description="链接与种子请在「下载」页由迅雷引擎下载；云盘文件可在设置中选择使用内置 HTTP 下载器" />
        ) : (
          <div className="space-y-1">
            {items.map((item) => (
              <TransferRow key={item.id} item={item} onAction={(action) => act(item, action)} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
