import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Checkbox, Input } from 'antd'
import { ArrowDown, CheckCheck, CircleAlert, Download, Gauge, Info, Pause, Play, Plus, RefreshCw, RotateCw, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import BottomSheet, { SheetAction, SheetGroup } from '../components/BottomSheet'
import DownloadDetailModal from '../components/DownloadDetailModal'
import DownloadRow from '../components/DownloadRow'
import { actionFeedback, primaryAction, taskIcon, type DownloadAction } from '../lib/downloadActions'
import EngineBanner from '../components/EngineBanner'
import HeroStats from '../components/HeroStats'
import LoginRequired from '../components/LoginRequired'
import PageHeader from '../components/PageHeader'
import { ActionBar, Badge, Card, Chips, EmptyState, IconButton, IconTile, ListSkeleton, PillButton, SelectionControls } from '../components/ui'
import { useDownloads, useEngineStatus } from '../hooks/useEngine'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useSelection } from '../hooks/useSelection'
import { downloadsApi, engineApi, errorMessage, isAuthError, type DownloadFilter, type DownloadList, type DownloadTask } from '../lib/api'
import { useCreate } from '../lib/createContext'
import { cx } from '../lib/cx'
import { applyActionResults, DOWNLOAD_STATUS, markActionsPending } from '../lib/downloads'
import { formatBytes, formatDuration, formatSpeed } from '../lib/format'
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
    <Card glass className="mb-4 flex items-center gap-3 !rounded-[22px] p-3.5">
      <IconTile icon={Gauge} tone="violet" size={40} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-ink">超级加速试用</div>
        <div className="mt-0.5 text-[12px] text-ink-3">
          剩余 {left} / {data.total} 次{trying ? ` · 本次还剩 ${formatDuration(data.remaining_seconds)}` : ''}
          {data.saved_seconds > 0 && ` · 累计节省 ${formatDuration(data.saved_seconds)}`}
        </div>
      </div>
      <PillButton primary disabled={!left || !active || trying} onClick={() => apply()} className="!px-3.5 !py-2">
        {trying ? '试用中' : '开启'}
      </PillButton>
    </Card>
  )
}

export default function DownloadsPage() {
  const { message, modal } = App.useApp()
  const { settings } = useAppSettings()
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const create = useCreate()
  const engine = useEngineStatus(true)
  const [filter, setFilter] = useState<DownloadFilter>('active')
  const [keyword, setKeyword] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const selection = useSelection()
  const [detail, setDetail] = useState<DownloadTask | null>(null)
  const [sheetTask, setSheetTask] = useState<DownloadTask | null>(null)
  const query = useDownloads(filter)
  const allDownloads = useDownloads('all', Boolean(detail || sheetTask))
  const data = query.data
  const summary = data?.summary
  const degraded = data?.source_errors?.live ?? data?.source_errors?.database
  const [pending, setPending] = useState<Set<string>>(new Set())
  const markPending = (items: DownloadTask[], active: boolean) => setPending((previous) => {
    const next = new Set(previous)
    items.forEach((task) => active ? next.add(task.id) : next.delete(task.id))
    return next
  })
  const notify = (result: Awaited<ReturnType<typeof downloadsApi.pause>>) => {
    queryClient.setQueryData<DownloadList>(['downloads'], (previous) => applyActionResults(previous, result))
    const feedback = actionFeedback(result)
    message[feedback.kind](feedback.text)
  }

  const tasks = useMemo(() => {
    const all = data?.tasks ?? []
    const word = keyword.trim().toLowerCase()
    return word ? all.filter((t) => t.name.toLowerCase().includes(word) || t.local_path.toLowerCase().includes(word)) : all
  }, [data, keyword])
  const chosen = tasks.filter((t) => selection.has(t.id))

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['downloads'] })
    void queryClient.invalidateQueries({ queryKey: ['engine'] })
  }

  const changeFilter = (value: DownloadFilter) => {
    setFilter(value)
    selection.clear()
  }

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
          markPending(items, true)
          await queryClient.cancelQueries({ queryKey: ['downloads'] })
          queryClient.setQueryData<DownloadList>(['downloads'], (previous) => markActionsPending(previous, new Set(items.map((task) => task.id)), 'delete'))
          notify(await downloadsApi.remove(items.map((t) => t.id), withFiles))
          selection.clear()
          refresh()
        } catch (error) {
          message.error(errorMessage(error))
        } finally {
          markPending(items, false)
          refresh()
        }
      },
    })
  }

  const run = async (items: DownloadTask[], action: DownloadAction) => {
    if (!items.length) return
    if (action === 'detail') return setDetail(items[0])
    if (action === 'delete') return confirmDelete(items)
    items = items.filter((task) => !pending.has(task.id))
    if (!items.length) return
    try {
      const ids = items.map((t) => t.id)
      markPending(items, true)
      await queryClient.cancelQueries({ queryKey: ['downloads'] })
      queryClient.setQueryData<DownloadList>(['downloads'], (previous) => markActionsPending(previous, new Set(ids), action))
      if (action === 'pause') notify(await downloadsApi.pause(ids))
      if (action === 'resume') notify(await downloadsApi.resume(ids))
      if (action === 'retry') {
        const { results } = await downloadsApi.retry(ids)
        results.filter((r) => !r.ok).forEach((r) => message.error(r.error))
      }
      selection.clear()
      refresh()
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      markPending(items, false)
      refresh()
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
  const failedChosen = chosen.filter((t) => t.capabilities?.retry && !pending.has(t.id))
  const allSelected = chosen.length > 0 && chosen.length === tasks.length
  const touchSelecting = isMobile && selection.selecting

  const searchBox = (
    <Input
      allowClear
      autoFocus={isMobile}
      prefix={<Search size={15} className="text-ink-3" />}
      placeholder="搜索名称或路径"
      value={keyword}
      onChange={(e) => setKeyword(e.target.value)}
      className={isMobile ? '' : '!w-60'}
    />
  )

  const currentSheetTask = allDownloads.data
    ? allDownloads.data.tasks.find((task) => task.id === sheetTask?.id) ?? null : sheetTask
  const currentDetailTask = allDownloads.data
    ? allDownloads.data.tasks.find((task) => task.id === detail?.id) ?? null : detail
  const sheetPrimary = currentSheetTask ? primaryAction(currentSheetTask) : null

  return (
    <div>
      <PageHeader
        title={touchSelecting ? `已选 ${chosen.length} 项` : '下载'}
        subtitle={touchSelecting ? undefined : isMobile ? `${summary?.active ?? 0} 个进行中 · ${formatSpeed(summary?.speed ?? 0)}` : '由本机迅雷下载引擎执行：链接、磁力、种子与云盘文件'}
        actions={
          touchSelecting ? (
            <SelectionControls
              allSelected={allSelected}
              onAll={() => (allSelected ? selection.clear() : selection.selectAll(tasks.map((t) => t.id)))}
              onDone={selection.clear}
            />
          ) : isMobile ? (
            <>
              <IconButton icon={Search} label="搜索" size="sm" active={searchOpen} onClick={() => setSearchOpen(!searchOpen)} />
              <IconButton icon={RefreshCw} label="刷新" size="sm" onClick={refresh} spinning={query.isFetching} />
            </>
          ) : (
            <>
              <IconButton icon={RefreshCw} label="刷新" onClick={refresh} spinning={query.isFetching} />
              <PillButton primary icon={Plus} onClick={create.download}>
                新建下载
              </PillButton>
            </>
          )
        }
      >
        {isMobile && searchOpen && !touchSelecting && searchBox}
      </PageHeader>
      <EngineBanner status={engine.data} />
      <HeroStats
        className="mb-4"
        icon={ArrowDown}
        label="下载速度"
        value={formatSpeed(summary?.speed ?? 0)}
        hint={engine.data?.logged_in ? `${engine.data.user.name} · VIP${engine.data.user.vip_level}` : undefined}
        stats={[
          { label: '下载中', value: summary?.active ?? 0, active: filter === 'active', onClick: () => changeFilter('active') },
          { label: '已暂停', value: summary?.paused ?? 0, active: filter === 'paused', onClick: () => changeFilter('paused') },
          { label: '已完成', value: summary?.complete ?? 0, active: filter === 'complete', onClick: () => changeFilter('complete') },
          { label: '失败', value: summary?.error ?? 0, active: filter === 'error', onClick: () => changeFilter('error') },
        ]}
      />
      {degraded && (
        <div role="status" className="mb-4 text-[12px] text-ink-3">
          <Badge tone="warning">{degraded}</Badge>
          {data?.stale && <span className="ml-2">显示上次记录</span>}
        </div>
      )}
      {engine.data?.state === 'running' && engine.data.logged_in && <TrialStrip active={summary?.active ?? 0} />}

      <div className="mb-3 flex items-center gap-3">
        <Chips
          value={filter}
          onChange={changeFilter}
          options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))}
          className={cx('min-w-0 flex-1 py-1', isMobile && '-mx-4 px-4')}
        />
        {!isMobile && searchBox}
      </div>

      {!isMobile && selection.selecting && (
        <div className="glass-card sticky top-4 z-30 mb-3 flex flex-wrap items-center gap-2 rounded-[22px] p-2 pl-4 text-[13px] text-ink-2">
          已选 <b className="text-accent">{chosen.length}</b> 项
          <div className="flex-1" />
          <PillButton icon={Pause} disabled={!chosen.some((t) => t.capabilities?.pause && !pending.has(t.id))} onClick={() => run(chosen.filter((t) => t.capabilities?.pause), 'pause')} className="!px-3 !py-2">
            暂停
          </PillButton>
          <PillButton icon={Play} disabled={!chosen.some((t) => t.capabilities?.resume && !pending.has(t.id))} onClick={() => run(chosen.filter((t) => t.capabilities?.resume), 'resume')} className="!px-3 !py-2">
            继续
          </PillButton>
          <PillButton icon={RotateCw} disabled={!failedChosen.length} onClick={() => run(failedChosen, 'retry')} className="!px-3 !py-2">
            重试
          </PillButton>
          <PillButton icon={Trash2} disabled={!chosen.some((t) => t.capabilities?.delete && !pending.has(t.id))} onClick={() => run(chosen.filter((t) => t.capabilities?.delete), 'delete')} className="!px-3 !py-2 !text-danger">
            删除
          </PillButton>
          <PillButton onClick={selection.clear} className="!px-3 !py-2">
            取消
          </PillButton>
        </div>
      )}

      <Card className="!rounded-[26px] p-1.5 md:p-3">
        {!isMobile && tasks.length > 0 && (
          <div className="flex items-center gap-3 px-4 pt-1 pb-2 text-[12px] text-ink-3">
            <Checkbox checked={allSelected} indeterminate={chosen.length > 0 && !allSelected} onChange={(e) => (e.target.checked ? selection.selectAll(tasks.map((t) => t.id)) : selection.clear())}>
              <span className="text-[12px] text-ink-3">全选</span>
            </Checkbox>
            <div className="flex-1" />
            <span>{tasks.length} 个任务</span>
          </div>
        )}
        {query.isLoading ? (
          <ListSkeleton rows={5} />
        ) : query.error ? (
          <EmptyState icon={CircleAlert} title="加载失败" description={errorMessage(query.error)} action={<PillButton onClick={refresh}>重试</PillButton>} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={Download}
            title={keyword ? '没有匹配的任务' : '没有下载任务'}
            description={isMobile ? '点击下方 + 添加链接或种子，或在云盘中选择文件下载到本机' : '点击“新建下载”添加链接或种子，或在云盘中选择文件下载到本机'}
            action={
              <PillButton primary icon={Plus} onClick={create.download}>
                新建下载
              </PillButton>
            }
          />
        ) : (
          <div className="divide-y divide-line/70">
            {tasks.map((task) => (
              <DownloadRow
                key={task.id}
                task={pending.has(task.id) ? { ...task, operation: { action: '', status: 'pending', message: '' } } : task}
                touch={isMobile}
                selected={selection.has(task.id)}
                selecting={selection.selecting}
                onToggle={() => selection.toggle(task.id)}
                onAction={(action) => run([task], action)}
                onOpen={() => setSheetTask(task)}
              />
            ))}
          </div>
        )}
      </Card>
      {!isMobile && !selection.selecting && tasks.length > 0 && <div className="mt-3 text-center text-xs text-ink-3">勾选任务后可批量暂停、继续、重试或删除</div>}

      {touchSelecting && (
        <ActionBar
          actions={[
            { key: 'pause', icon: Pause, label: '暂停', disabled: !chosen.some((t) => t.capabilities?.pause && !pending.has(t.id)), onClick: () => run(chosen.filter((t) => t.capabilities?.pause), 'pause') },
            { key: 'resume', icon: Play, label: '继续', disabled: !chosen.some((t) => t.capabilities?.resume && !pending.has(t.id)), onClick: () => run(chosen.filter((t) => t.capabilities?.resume), 'resume') },
            { key: 'retry', icon: RotateCw, label: '重试', disabled: !failedChosen.length, onClick: () => run(failedChosen, 'retry') },
            { key: 'delete', icon: Trash2, label: '删除', danger: true, disabled: !chosen.some((t) => t.capabilities?.delete && !pending.has(t.id)), onClick: () => run(chosen.filter((t) => t.capabilities?.delete), 'delete') },
          ]}
        />
      )}

      <BottomSheet
        open={Boolean(currentSheetTask)}
        onClose={() => setSheetTask(null)}
        header={
          currentSheetTask && (
            <div className="mb-4 flex items-center gap-3 px-1">
              <IconTile icon={taskIcon(currentSheetTask)} tone={DOWNLOAD_STATUS[currentSheetTask.status].tone} size={46} />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[15px] font-semibold break-all text-ink">{currentSheetTask.name}</div>
                <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                  <Badge tone={DOWNLOAD_STATUS[currentSheetTask.status].tone}>{DOWNLOAD_STATUS[currentSheetTask.status].label}</Badge>
                  {currentSheetTask.size > 0 && formatBytes(currentSheetTask.size)}
                </div>
              </div>
            </div>
          )
        }
      >
        {currentSheetTask && (
          <>
            <SheetGroup>
              {sheetPrimary && (
                <SheetAction
                  icon={<sheetPrimary.icon size={18} />}
                  label={sheetPrimary.label}
                  onClick={() => {
                    setSheetTask(null)
                    void run([currentSheetTask], sheetPrimary.action)
                  }}
                />
              )}
              <SheetAction
                icon={<Info size={18} />}
                label="任务详情"
                onClick={() => {
                  setSheetTask(null)
                  setDetail(currentSheetTask)
                }}
              />
              <SheetAction
                icon={<CheckCheck size={18} />}
                label="多选"
                onClick={() => {
                  setSheetTask(null)
                  selection.toggle(currentSheetTask.id)
                }}
              />
            </SheetGroup>
            <SheetGroup>
              <SheetAction
                icon={<Trash2 size={18} />}
                label="删除任务"
                disabled={currentSheetTask.capabilities?.delete === false || pending.has(currentSheetTask.id)}
                danger
                onClick={() => {
                  setSheetTask(null)
                  confirmDelete([currentSheetTask])
                }}
              />
            </SheetGroup>
          </>
        )}
      </BottomSheet>
      <DownloadDetailModal task={currentDetailTask} onClose={() => setDetail(null)} />
    </div>
  )
}
