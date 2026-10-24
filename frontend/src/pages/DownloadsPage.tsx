import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Checkbox, Input, Segmented } from 'antd'
import { ArrowDown, CheckCircle2, CircleAlert, Download, Gauge, Pause, Play, Plus, RefreshCw, RotateCw, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import AddDownloadModal from '../components/AddDownloadModal'
import DownloadDetailModal from '../components/DownloadDetailModal'
import DownloadRow, { type DownloadAction } from '../components/DownloadRow'
import EngineBanner from '../components/EngineBanner'
import LoginRequired from '../components/LoginRequired'
import PageHeader from '../components/PageHeader'
import { Badge, Card, EmptyState, IconButton, ListSkeleton, PillButton, Stat } from '../components/ui'
import { useDownloads, useEngineStatus, useLiveDownloads } from '../hooks/useEngine'
import { downloadsApi, engineApi, errorMessage, isAuthError, type DownloadFilter, type DownloadTask } from '../lib/api'
import { formatDuration, formatSpeed } from '../lib/format'
import { liveSignature, mergeLive } from '../lib/downloads'
import { useAppSettings } from '../lib/settingsContext'

const FILTERS: { value: DownloadFilter; label: string }[] = [
  { value: 'active', label: '下载中' },
  { value: 'paused', label: '已暂停' },
  { value: 'complete', label: '已完成' },
  { value: 'error', label: '失败' },
  { value: 'all', label: '全部' },
]

/** Super speed trial offered by the engine for running downloads. */
function TrialStrip({ active }: { active: number }) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const trial = useQuery({ queryKey: ['engine-trial'], queryFn: engineApi.trial, refetchInterval: 30000, retry: false })
  const data = trial.data
  if (!data || data.total <= 0) return null
  const left = Math.max(0, data.total - data.used)
  const trying = data.remaining_seconds > 0
  const apply = async () => {
    try {
      queryClient.setQueryData(['engine-trial'], await engineApi.applyTrial())
      message.success('已开启超级加速试用')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }
  return (
    <Card className="mb-5 flex flex-wrap items-center gap-3 p-4">
      <Gauge size={20} className="text-accent" />
      <div className="min-w-0 flex-1 text-[13px] text-ink-2">
        超级加速试用：剩余 {left} / {data.total} 次{trying ? `，本次还剩 ${formatDuration(data.remaining_seconds)}` : ''}
        {data.saved_seconds > 0 && `，累计节省 ${formatDuration(data.saved_seconds)}`}
      </div>
      <PillButton primary disabled={!left || !active || trying} onClick={() => apply()}>
        {trying ? '试用中' : '开启试用'}
      </PillButton>
    </Card>
  )
}

export default function DownloadsPage() {
  const { message, modal } = App.useApp()
  const { settings } = useAppSettings()
  const queryClient = useQueryClient()
  const engine = useEngineStatus(true)
  const [filter, setFilter] = useState<DownloadFilter>('active')
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [detail, setDetail] = useState<DownloadTask | null>(null)
  const query = useDownloads(filter)
  const live = useLiveDownloads(engine.data?.state === 'running')
  const data = useMemo(() => mergeLive(query.data, live.data), [query.data, live.data])
  const summary = data?.summary

  // The cloud list lags the engine; refetch it when a task appears, finishes or changes state.
  const signature = liveSignature(live.data)
  const lastSignature = useRef(signature)
  useEffect(() => {
    if (signature === lastSignature.current) return
    lastSignature.current = signature
    void queryClient.invalidateQueries({ queryKey: ['downloads'] })
  }, [signature, queryClient])

  const tasks = useMemo(() => {
    const all = data?.tasks ?? []
    const word = keyword.trim().toLowerCase()
    return word ? all.filter((t) => t.name.toLowerCase().includes(word) || t.local_path.toLowerCase().includes(word)) : all
  }, [data, keyword])
  const chosen = tasks.filter((t) => selected.has(t.id))

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['downloads'] })
    void queryClient.invalidateQueries({ queryKey: ['engine'] })
  }

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // The API call runs inside onOk so the dialog's button shows progress and blocks repeats.
  const confirmDelete = (items: DownloadTask[]) => {
    let withFiles = settings?.engine.delete_files_with_task ?? false
    modal.confirm({
      title: items.length > 1 ? `删除 ${items.length} 个下载任务？` : '删除下载任务？',
      content: (
        <div className="pt-2">
          <Checkbox defaultChecked={withFiles} onChange={(e) => (withFiles = e.target.checked)}>
            同时删除已下载到本机的文件
          </Checkbox>
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await downloadsApi.remove(items.map((t) => t.id), withFiles)
          message.success('已删除')
          setSelected(new Set())
          refresh()
        } catch (error) {
          message.error(errorMessage(error))
        }
      },
    })
  }

  const run = async (items: DownloadTask[], action: DownloadAction) => {
    if (!items.length) return
    try {
      const ids = items.map((t) => t.id)
      if (action === 'detail') return setDetail(items[0])
      if (action === 'delete') return confirmDelete(items)
      if (action === 'pause') await downloadsApi.pause(ids)
      if (action === 'resume') await downloadsApi.resume(ids)
      if (action === 'retry') {
        const { results } = await downloadsApi.retry(ids)
        results.filter((r) => !r.ok).forEach((r) => message.error(r.error))
      }
      setSelected(new Set())
      refresh()
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  if (query.error && isAuthError(query.error)) {
    return (
      <>
        <PageHeader title="下载" />
        <LoginRequired />
      </>
    )
  }

  const counts: Record<DownloadFilter, number | undefined> = {
    active: summary?.active,
    paused: summary?.paused,
    complete: summary?.complete,
    error: summary?.error,
    all: summary?.total,
  }

  return (
    <div>
      <PageHeader
        title="下载"
        subtitle="由本机迅雷下载引擎执行：链接、磁力、种子与云盘文件"
        actions={
          <>
            <IconButton icon={RefreshCw} label="刷新" onClick={refresh} spinning={query.isFetching} />
            <PillButton primary icon={Plus} onClick={() => setAdding(true)}>
              新建下载
            </PillButton>
          </>
        }
      />
      <EngineBanner status={engine.data} />
      <div className="stagger mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={ArrowDown} label="下载速度" value={formatSpeed(summary?.speed ?? 0)} hint={engine.data?.logged_in ? `${engine.data.user.name} · VIP${engine.data.user.vip_level}` : undefined} />
        <Stat icon={Download} label="下载中" value={summary?.active ?? 0} hint={`已暂停 ${summary?.paused ?? 0}`} tone="warning" />
        <Stat icon={CheckCircle2} label="已完成" value={summary?.complete ?? 0} tone="success" />
        <Stat icon={CircleAlert} label="失败" value={summary?.error ?? 0} tone="danger" />
      </div>
      {live.error && settings?.engine.live_progress && (
        <div className="mb-4 text-[12px] text-ink-3">
          <Badge tone="warning">实时进度不可用</Badge> {errorMessage(live.error)}，进度改为按云端记录显示（约每分钟更新）。
        </div>
      )}
      {engine.data?.state === 'running' && engine.data.logged_in && <TrialStrip active={summary?.active ?? 0} />}
      <Card className="p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-3 px-2 pt-1 pb-3">
          <Segmented
            value={filter}
            onChange={(value) => {
              setFilter(value as DownloadFilter)
              setSelected(new Set())
            }}
            options={FILTERS.map((f) => ({ value: f.value, label: counts[f.value] === undefined ? f.label : `${f.label} ${counts[f.value]}` }))}
          />
          <Input
            allowClear
            prefix={<Search size={15} className="text-ink-3" />}
            placeholder="搜索名称或路径"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="!w-full sm:!w-56"
          />
          <div className="flex-1" />
          {tasks.length > 0 && (
            <Checkbox
              checked={chosen.length > 0 && chosen.length === tasks.length}
              indeterminate={chosen.length > 0 && chosen.length < tasks.length}
              onChange={(e) => setSelected(e.target.checked ? new Set(tasks.map((t) => t.id)) : new Set())}
            >
              全选
            </Checkbox>
          )}
          {chosen.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <PillButton icon={Pause} onClick={() => run(chosen, 'pause')} className="!px-3">
                暂停
              </PillButton>
              <PillButton icon={Play} onClick={() => run(chosen, 'resume')} className="!px-3">
                继续
              </PillButton>
              <PillButton icon={RotateCw} onClick={() => run(chosen.filter((t) => t.status === 'error'), 'retry')} className="!px-3">
                重试
              </PillButton>
              <PillButton icon={Trash2} onClick={() => run(chosen, 'delete')} className="!px-3 !text-danger">
                删除 {chosen.length}
              </PillButton>
            </div>
          )}
        </div>
        {query.isLoading ? (
          <ListSkeleton rows={5} />
        ) : query.error ? (
          <EmptyState icon={CircleAlert} title="加载失败" description={errorMessage(query.error)} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={Download}
            title={keyword ? '没有匹配的任务' : '没有下载任务'}
            description="点击“新建下载”添加链接或种子，或在云盘中选择文件下载到本机"
            action={
              <PillButton primary icon={Plus} onClick={() => setAdding(true)}>
                新建下载
              </PillButton>
            }
          />
        ) : (
          <div className="space-y-1">
            {tasks.map((task) => (
              <DownloadRow key={task.id} task={task} selected={selected.has(task.id)} onToggle={() => toggle(task.id)} onAction={(action) => run([task], action)} />
            ))}
          </div>
        )}
      </Card>
      <AddDownloadModal open={adding} onClose={() => setAdding(false)} />
      <DownloadDetailModal task={detail} onClose={() => setDetail(null)} />
    </div>
  )
}
