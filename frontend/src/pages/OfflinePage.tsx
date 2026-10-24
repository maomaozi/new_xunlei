import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { App, Checkbox, Segmented } from 'antd'
import { Magnet, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LoginRequired from '../components/LoginRequired'
import OfflineCreatePanel from '../components/OfflineCreatePanel'
import PageHeader from '../components/PageHeader'
import { TaskRow } from '../components/TaskList'
import { Card, EmptyState, IconButton, ListSkeleton, PillButton, SectionHeader } from '../components/ui'
import { errorMessage, isAuthError, offlineApi, type DriveTask, type PhaseFilter } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { useAppSettings } from '../lib/settingsContext'

const FILTERS: { label: string; value: PhaseFilter }[] = [
  { label: '全部', value: 'all' },
  { label: '进行中', value: 'running' },
  { label: '已完成', value: 'complete' },
  { label: '失败', value: 'error' },
]

export default function OfflinePage() {
  const { message, modal } = App.useApp()
  const { settings } = useAppSettings()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<PhaseFilter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const interval = (settings?.offline.refresh_interval_seconds ?? 5) * 1000

  const query = useInfiniteQuery({
    queryKey: ['offline', phase],
    queryFn: ({ pageParam }) => offlineApi.list(phase, pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_page_token || undefined,
    refetchInterval: (q) => {
      const tasks = q.state.data?.pages.flatMap((p) => p.tasks) ?? []
      return tasks.some((t) => t.phase === 'PHASE_TYPE_RUNNING' || t.phase === 'PHASE_TYPE_PENDING') ? interval : interval * 4
    },
  })
  const tasks = useMemo(() => query.data?.pages.flatMap((p) => p.tasks) ?? [], [query.data])

  const remove = (targets: DriveTask[]) => {
    let deleteFiles = settings?.offline.delete_files_with_task ?? false
    modal.confirm({
      title: targets.length === 1 ? '删除该云添加任务？' : `删除 ${targets.length} 个云添加任务？`,
      content: (
        <div className="pt-2">
          <Checkbox defaultChecked={deleteFiles} onChange={(e) => (deleteFiles = e.target.checked)}>
            同时删除已保存到云盘的文件
          </Checkbox>
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await offlineApi.remove(targets.map((t) => t.id), deleteFiles)
          message.success('任务已删除')
          setSelected(new Set())
          void queryClient.invalidateQueries({ queryKey: ['offline'] })
        } catch (error) {
          message.error(errorMessage(error))
        }
      },
    })
  }

  const openTask = (task: DriveTask) => {
    const ref = task.reference_resource
    if (ref?.kind === 'drive#folder') navigate(`/drive/${ref.id}`)
    else navigate(ref?.parent_id ? `/drive/${ref.parent_id}` : '/drive')
  }

  if (query.error && isAuthError(query.error)) {
    return (
      <>
        <PageHeader title="云添加" />
        <LoginRequired />
      </>
    )
  }

  const running = tasks.filter((t) => t.phase === 'PHASE_TYPE_RUNNING' || t.phase === 'PHASE_TYPE_PENDING').length

  return (
    <div>
      <PageHeader
        title="云添加"
        subtitle="磁力 / BT 种子 / HTTP / FTP / ed2k 资源由迅雷服务器离线下载并保存到云盘"
        actions={<IconButton icon={RefreshCw} label="刷新" onClick={() => void query.refetch()} spinning={query.isFetching} />}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <Card className="h-fit p-5 md:p-6">
          <SectionHeader title="新建任务" />
          <OfflineCreatePanel onCreated={() => setPhase('all')} />
        </Card>
        <Card className="p-3 md:p-4">
          <div className="flex flex-wrap items-center gap-3 px-2 pt-1 pb-3">
            <Segmented value={phase} options={FILTERS} onChange={(v) => (setPhase(v as PhaseFilter), setSelected(new Set()))} />
            {running > 0 && <span className="text-xs text-ink-3">{running} 个进行中 · 每 {interval / 1000}s 自动刷新</span>}
            <div className="flex-1" />
            {selected.size > 0 && (
              <PillButton icon={Trash2} className="!text-danger" onClick={() => remove(tasks.filter((t) => selected.has(t.id)))}>
                删除 {selected.size} 项
              </PillButton>
            )}
          </div>
          {query.isLoading ? (
            <ListSkeleton rows={6} />
          ) : query.error ? (
            <EmptyState icon={Magnet} title="加载失败" description={errorMessage(query.error)} />
          ) : tasks.length === 0 ? (
            <EmptyState icon={Magnet} title="暂无任务" description="在左侧粘贴链接即可开始云添加" />
          ) : (
            <div className="stagger space-y-1">
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={selected.has(task.id)}
                  onSelect={() =>
                    setSelected((s) => {
                      const next = new Set(s)
                      if (next.has(task.id)) next.delete(task.id)
                      else next.add(task.id)
                      return next
                    })
                  }
                  onOpen={() => openTask(task)}
                  onCopy={() => void copyText(task.params.url ?? '').then((ok) => ok && message.success('链接已复制'))}
                  onDelete={() => remove([task])}
                />
              ))}
              {query.hasNextPage && (
                <div className="pt-3 text-center">
                  <PillButton onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
                    {query.isFetchingNextPage ? '加载中…' : '加载更多'}
                  </PillButton>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
