import { useQueryClient } from '@tanstack/react-query'
import { App, Checkbox } from 'antd'
import { ArrowDown, ArrowDownUp, ArrowUp, Brush, CheckCircle2, CircleAlert, Download, MoreHorizontal, Pause, Play, RotateCw, Trash2, X, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BottomSheet, { SheetAction, SheetGroup } from '../components/BottomSheet'
import HeroStats from '../components/HeroStats'
import PageHeader from '../components/PageHeader'
import { cx } from '../lib/cx'
import { Badge, Card, Chips, EmptyState, IconButton, IconTile, ListSkeleton, PillButton, ProgressBar, type Tone } from '../components/ui'
import { useBrowserUploads } from '../hooks/useBrowserUploads'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useTransfers } from '../hooks/useTransfers'
import { errorMessage, transfersApi, type TransferItem } from '../lib/api'
import { formatBytes, formatEta, formatSpeed, formatTime, percent } from '../lib/format'

type Filter = 'all' | 'download' | 'upload' | 'active' | 'finished'

type Action = 'pause' | 'resume' | 'cancel' | 'delete'

const FILTERS: { label: string; value: Filter }[] = [
  { label: '全部', value: 'all' },
  { label: '下载', value: 'download' },
  { label: '上传', value: 'upload' },
  { label: '进行中', value: 'active' },
  { label: '已结束', value: 'finished' },
]

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

const STATUS: Record<TransferItem['status'], { label: string; tone: Tone }> = {
  queued: { label: '排队中', tone: 'muted' },
  running: { label: '进行中', tone: 'accent' },
  paused: { label: '已暂停', tone: 'warning' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  canceled: { label: '已取消', tone: 'muted' },
}

/** Actions available for an item in its current state, in display order. */
function itemActions(item: TransferItem): { action: Action; label: string; icon: typeof Pause; danger?: boolean }[] {
  const live = item.status === 'running' || item.status === 'queued'
  return [
    ...(live ? [{ action: 'pause' as const, label: '暂停', icon: Pause }] : []),
    ...(item.status === 'paused' ? [{ action: 'resume' as const, label: '继续', icon: Play }] : []),
    ...(item.status === 'failed' || item.status === 'canceled' ? [{ action: 'resume' as const, label: '重试', icon: RotateCw }] : []),
    ...(live || item.status === 'paused' ? [{ action: 'cancel' as const, label: '取消', icon: X }] : []),
    { action: 'delete' as const, label: '删除记录', icon: Trash2, danger: true },
  ]
}

function itemIcon(item: TransferItem) {
  if (item.status === 'completed') return CheckCircle2
  if (item.status === 'failed') return CircleAlert
  return item.kind === 'download' ? ArrowDown : ArrowUp
}

function TransferRow({ item, touch, onAction, onMenu }: { item: TransferItem; touch: boolean; onAction: (action: Action) => unknown; onMenu: () => void }) {
  const status = STATUS[item.status]
  const value = item.status === 'completed' ? 100 : percent(item.done_bytes, item.size)
  const active = item.status === 'running'
  const phase = PHASES[item.phase] ?? item.phase
  const actions = itemActions(item)
  const primary = actions[0].action === 'delete' ? null : actions[0]
  return (
    <div
      role={touch ? 'button' : undefined}
      onClick={touch ? onMenu : undefined}
      className={cx('flex items-center gap-3 rounded-[20px] px-3 py-3 md:gap-4 md:px-4', touch && 'tap cursor-pointer')}
    >
      <IconTile icon={itemIcon(item)} tone={item.status === 'failed' ? 'danger' : item.status === 'completed' ? 'success' : item.kind === 'upload' ? 'violet' : 'accent'} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14.5px] font-medium text-ink" title={item.local_path}>
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
          {active && item.speed > 0 && <span className="font-medium text-accent">{formatSpeed(item.speed)}</span>}
          {active && item.speed > 0 && <span>剩余 {formatEta(item.size - item.done_bytes, item.speed)}</span>}
          {active && item.connections > 1 && <span>{item.connections} 线程</span>}
          {item.group_name && <span className="truncate">· {item.group_name}</span>}
          {item.finished_at && !active && <span>{formatTime(item.finished_at)}</span>}
        </div>
        {item.error && <div className="mt-1 line-clamp-2 text-[12px] break-all text-danger">{item.error}</div>}
        {item.status !== 'completed' && (
          <div className="mt-2 flex items-center gap-2.5">
            <ProgressBar value={value} animated={active} tone={item.status === 'failed' ? 'danger' : item.status === 'paused' ? 'warning' : 'accent'} className="flex-1" />
            <span className="w-11 text-right text-[11px] font-medium text-ink-2 tabular-nums">{value.toFixed(1)}%</span>
          </div>
        )}
        {!touch && <div className="mt-1 truncate text-[11px] text-ink-3">{item.local_path}</div>}
      </div>
      {touch ? (
        primary && (
          <IconButton
            icon={primary.icon}
            label={primary.label}
            size="sm"
            showTooltip={false}
            tone={primary.action === 'pause' ? 'default' : 'accent'}
            className="!rounded-full"
            onClick={(event) => {
              event.stopPropagation()
              return onAction(primary.action)
            }}
          />
        )
      ) : (
        <div className="flex shrink-0 gap-2">
          {actions.map((a) => (
            <IconButton key={a.label} icon={a.icon} label={a.label} size="sm" tone={a.danger ? 'danger' : a.action === 'pause' || a.action === 'cancel' ? 'default' : 'accent'} onClick={() => onAction(a.action)} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function TransfersPage() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const { data, isLoading } = useTransfers()
  const browserUploads = useBrowserUploads()
  const [filter, setFilter] = useState<Filter>('all')
  const [sheetItem, setSheetItem] = useState<TransferItem | null>(null)
  const [bulkSheet, setBulkSheet] = useState(false)
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
  const bulkActions = [
    { key: 'pause-all' as const, icon: Pause, label: '全部暂停' },
    { key: 'resume-all' as const, icon: Play, label: '全部继续' },
    { key: 'clear-finished' as const, icon: Brush, label: '清除已完成' },
  ]

  return (
    <div>
      <PageHeader
        title="传输"
        subtitle={isMobile ? '上传队列与内置 HTTP 下载器' : '上传队列与内置 HTTP 下载器（多线程分段、断点续传）'}
        actions={
          isMobile ? (
            <IconButton icon={MoreHorizontal} label="批量操作" size="sm" onClick={() => setBulkSheet(true)} />
          ) : (
            <PillButton icon={Download} onClick={() => navigate('/downloads')}>
              迅雷引擎下载
            </PillButton>
          )
        }
      />
      <HeroStats
        className="mb-4"
        icon={ArrowDownUp}
        label="下载速度"
        value={formatSpeed(summary?.download_speed ?? 0)}
        hint={`上传 ${formatSpeed(summary?.upload_speed ?? 0)}${uploadingInBrowser ? ` · 浏览器正在传输 ${uploadingInBrowser} 项` : ''}`}
        stats={[
          { label: '进行中', value: summary?.running ?? 0, active: filter === 'active', onClick: () => setFilter('active') },
          { label: '排队', value: summary?.queued ?? 0 },
          { label: '失败', value: summary?.failed ?? 0 },
          { label: '已完成', value: summary?.completed ?? 0, active: filter === 'finished', onClick: () => setFilter('finished') },
        ]}
      />
      <div className="mb-3 flex items-center gap-3">
        <Chips value={filter} onChange={setFilter} options={FILTERS} className={cx('min-w-0 flex-1 py-1', isMobile && '-mx-4 px-4')} />
        {!isMobile && (
          <div className="flex gap-2">
            {bulkActions.map((b) => (
              <PillButton key={b.key} icon={b.icon} onClick={() => bulk(b.key)} className="!px-3 !py-2">
                {b.label}
              </PillButton>
            ))}
          </div>
        )}
      </div>
      <Card className="!rounded-[26px] p-1.5 md:p-3">
        {isLoading ? (
          <ListSkeleton rows={5} />
        ) : items.length === 0 ? (
          <EmptyState icon={ArrowDownUp} title="没有传输任务" description="链接与种子请在「下载」页由迅雷引擎下载；云盘文件可在设置中选择使用内置 HTTP 下载器" />
        ) : (
          <div className="divide-y divide-line/70">
            {items.map((item) => (
              <TransferRow key={item.id} item={item} touch={isMobile} onAction={(action) => act(item, action)} onMenu={() => setSheetItem(item)} />
            ))}
          </div>
        )}
      </Card>

      <BottomSheet open={bulkSheet} onClose={() => setBulkSheet(false)} title="批量操作">
        <SheetGroup>
          {bulkActions.map((b) => (
            <SheetAction
              key={b.key}
              icon={<b.icon size={18} />}
              label={b.label}
              onClick={() => {
                setBulkSheet(false)
                void bulk(b.key)
              }}
            />
          ))}
        </SheetGroup>
        <SheetGroup>
          <SheetAction
            icon={<Download size={18} />}
            label="前往迅雷引擎下载"
            onClick={() => {
              setBulkSheet(false)
              navigate('/downloads')
            }}
          />
        </SheetGroup>
      </BottomSheet>
      <BottomSheet
        open={Boolean(sheetItem)}
        onClose={() => setSheetItem(null)}
        header={
          sheetItem && (
            <div className="mb-4 px-1">
              <div className="line-clamp-2 text-[15px] font-semibold break-all text-ink">{sheetItem.name}</div>
              <div className="mt-1 text-[12px] break-all text-ink-3">{sheetItem.local_path}</div>
            </div>
          )
        }
      >
        {sheetItem &&
          (() => {
            const actions = itemActions(sheetItem)
            const run = (action: Action) => {
              setSheetItem(null)
              void act(sheetItem, action)
            }
            return (
              <>
                {actions.length > 1 && (
                  <SheetGroup>
                    {actions
                      .filter((a) => !a.danger)
                      .map((a) => (
                        <SheetAction key={a.label} icon={<a.icon size={18} />} label={a.label} onClick={() => run(a.action)} />
                      ))}
                  </SheetGroup>
                )}
                <SheetGroup>
                  <SheetAction icon={<Trash2 size={18} />} label="删除记录" danger onClick={() => run('delete')} />
                </SheetGroup>
              </>
            )
          })()}
      </BottomSheet>
    </div>
  )
}
