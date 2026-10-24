import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { App, Checkbox } from 'antd'
import { CheckCheck, Copy, ExternalLink, Magnet, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BottomSheet, { SheetAction, SheetGroup } from '../components/BottomSheet'
import LoginRequired from '../components/LoginRequired'
import OfflineCreatePanel from '../components/OfflineCreatePanel'
import PageHeader from '../components/PageHeader'
import { TaskRow } from '../components/TaskList'
import { ActionBar, Badge, Card, Chips, EmptyState, IconButton, IconTile, ListSkeleton, PillButton, SectionHeader, SelectionControls } from '../components/ui'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useSelection } from '../hooks/useSelection'
import { errorMessage, isAuthError, offlineApi, type DriveTask, type PhaseFilter } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { useCreate } from '../lib/createContext'
import { formatBytes } from '../lib/format'
import { useAppSettings } from '../lib/settingsContext'
import { PHASE_META } from '../lib/tasks'

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
  const isMobile = useIsMobile()
  const create = useCreate()
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<PhaseFilter>('all')
  const selection = useSelection()
  const [sheetTask, setSheetTask] = useState<DriveTask | null>(null)
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
  const chosen = tasks.filter((t) => selection.has(t.id))

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
          selection.clear()
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

  const copyLink = (task: DriveTask) => void copyText(task.params.url ?? '').then((ok) => ok && message.success('链接已复制'))

  if (query.error && isAuthError(query.error)) {
    return (
      <>
        <PageHeader title="云添加" />
        <LoginRequired />
      </>
    )
  }

  const running = tasks.filter((t) => t.phase === 'PHASE_TYPE_RUNNING' || t.phase === 'PHASE_TYPE_PENDING').length
  const touchSelecting = isMobile && selection.selecting
  const allSelected = chosen.length > 0 && chosen.length === tasks.length

  const list = (
    <>
      {query.isLoading ? (
        <ListSkeleton rows={6} />
      ) : query.error ? (
        <EmptyState icon={Magnet} title="加载失败" description={errorMessage(query.error)} action={<PillButton onClick={() => query.refetch()}>重试</PillButton>} />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={Magnet}
          title="暂无任务"
          description={isMobile ? '粘贴磁力、种子或网盘外链，由迅雷服务器离线下载到云盘' : '在左侧粘贴链接即可开始云添加'}
          action={
            isMobile ? (
              <PillButton primary icon={Plus} onClick={create.offline}>
                新建云添加
              </PillButton>
            ) : undefined
          }
        />
      ) : (
        <div className="divide-y divide-line/70">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              touch={isMobile}
              selecting={selection.selecting}
              selected={selection.has(task.id)}
              onSelect={() => selection.toggle(task.id)}
              onMenu={() => setSheetTask(task)}
              onOpen={() => openTask(task)}
              onCopy={() => copyLink(task)}
              onDelete={() => remove([task])}
            />
          ))}
        </div>
      )}
      {query.hasNextPage && (
        <div className="pt-3 pb-2 text-center">
          <PillButton onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? '加载中…' : '加载更多'}
          </PillButton>
        </div>
      )}
    </>
  )

  return (
    <div>
      <PageHeader
        title={touchSelecting ? `已选 ${chosen.length} 项` : '云添加'}
        subtitle={
          touchSelecting
            ? undefined
            : isMobile
              ? running > 0
                ? `${running} 个进行中 · 每 ${interval / 1000}s 自动刷新`
                : '离线下载到云盘'
              : '磁力 / BT 种子 / HTTP / FTP / ed2k 资源由迅雷服务器离线下载并保存到云盘'
        }
        actions={
          touchSelecting ? (
            <SelectionControls allSelected={allSelected} onAll={() => (allSelected ? selection.clear() : selection.selectAll(tasks.map((t) => t.id)))} onDone={selection.clear} />
          ) : isMobile ? (
            <>
              <IconButton icon={RefreshCw} label="刷新" size="sm" onClick={() => query.refetch()} spinning={query.isFetching} />
              <IconButton icon={Plus} label="新建云添加" size="sm" tone="accent" onClick={create.offline} />
            </>
          ) : (
            <IconButton icon={RefreshCw} label="刷新" onClick={() => query.refetch()} spinning={query.isFetching} />
          )
        }
      />
      {isMobile ? (
        <>
          <Chips value={phase} options={FILTERS} onChange={(v) => (setPhase(v), selection.clear())} className="-mx-4 mb-3 px-4 py-1" />
          <Card className="!rounded-[26px] p-1.5">{list}</Card>
        </>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <Card className="h-fit p-5 md:p-6">
            <SectionHeader title="新建任务" />
            <OfflineCreatePanel onCreated={() => setPhase('all')} />
          </Card>
          <Card className="p-3 md:p-4">
            <div className="flex flex-wrap items-center gap-3 px-2 pt-1 pb-3">
              <Chips value={phase} options={FILTERS} onChange={(v) => (setPhase(v), selection.clear())} className="py-1" />
              {running > 0 && <span className="text-xs text-ink-3">{running} 个进行中 · 每 {interval / 1000}s 自动刷新</span>}
              <div className="flex-1" />
              {selection.selecting && (
                <>
                  <PillButton onClick={selection.clear} className="!py-2">
                    取消
                  </PillButton>
                  <PillButton icon={Trash2} className="!py-2 !text-danger" onClick={() => remove(chosen)}>
                    删除 {chosen.length} 项
                  </PillButton>
                </>
              )}
            </div>
            {list}
          </Card>
        </div>
      )}

      {touchSelecting && <ActionBar actions={[{ key: 'delete', icon: Trash2, label: `删除 ${chosen.length} 项`, danger: true, onClick: () => remove(chosen) }]} />}

      <BottomSheet
        open={Boolean(sheetTask)}
        onClose={() => setSheetTask(null)}
        header={
          sheetTask && (
            <div className="mb-4 flex items-center gap-3 px-1">
              <IconTile icon={(PHASE_META[sheetTask.phase] ?? PHASE_META.PHASE_TYPE_PENDING).icon} tone={(PHASE_META[sheetTask.phase] ?? PHASE_META.PHASE_TYPE_PENDING).tone} size={46} />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[15px] font-semibold break-all text-ink">{sheetTask.name || sheetTask.file_name || sheetTask.params.url}</div>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                  <Badge tone={(PHASE_META[sheetTask.phase] ?? PHASE_META.PHASE_TYPE_PENDING).tone}>{(PHASE_META[sheetTask.phase] ?? PHASE_META.PHASE_TYPE_PENDING).label}</Badge>
                  {sheetTask.file_size > 0 && formatBytes(sheetTask.file_size)}
                </div>
              </div>
            </div>
          )
        }
      >
        {sheetTask && (
          <>
            <SheetGroup>
              {sheetTask.phase === 'PHASE_TYPE_COMPLETE' && (
                <SheetAction
                  icon={<ExternalLink size={18} />}
                  label="在云盘中查看"
                  onClick={() => {
                    setSheetTask(null)
                    openTask(sheetTask)
                  }}
                />
              )}
              <SheetAction
                icon={<Copy size={18} />}
                label="复制链接"
                onClick={() => {
                  setSheetTask(null)
                  copyLink(sheetTask)
                }}
              />
              <SheetAction
                icon={<CheckCheck size={18} />}
                label="多选"
                onClick={() => {
                  setSheetTask(null)
                  selection.toggle(sheetTask.id)
                }}
              />
            </SheetGroup>
            <SheetGroup>
              <SheetAction
                icon={<Trash2 size={18} />}
                label="删除任务"
                danger
                onClick={() => {
                  setSheetTask(null)
                  remove([sheetTask])
                }}
              />
            </SheetGroup>
          </>
        )}
      </BottomSheet>
    </div>
  )
}
