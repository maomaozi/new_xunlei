import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { App } from 'antd'
import { CheckCheck, RefreshCw, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import BottomSheet, { SheetAction, SheetGroup } from '../components/BottomSheet'
import FileIcon from '../components/FileIcon'
import { FileRow } from '../components/FileItems'
import LoginRequired from '../components/LoginRequired'
import PageHeader from '../components/PageHeader'
import { ActionBar, Card, EmptyState, IconButton, ListSkeleton, PillButton, SelectionControls } from '../components/ui'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useSelection } from '../hooks/useSelection'
import { errorMessage, isAuthError, trashApi, type DriveFile } from '../lib/api'
import { isFolder } from '../lib/files'
import { formatBytes, formatRelative } from '../lib/format'

export default function TrashPage() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const selection = useSelection()
  const [sheetFile, setSheetFile] = useState<DriveFile | null>(null)
  const query = useInfiniteQuery({
    queryKey: ['trash'],
    queryFn: ({ pageParam }) => trashApi.list(pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_page_token || undefined,
  })
  const files = useMemo(() => query.data?.pages.flatMap((p) => p.files) ?? [], [query.data])
  const targets = files.filter((f) => selection.has(f.id))

  const refresh = () => {
    selection.clear()
    void queryClient.invalidateQueries({ queryKey: ['trash'] })
    window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['trash'] }), 1500)
    void queryClient.invalidateQueries({ queryKey: ['files'] })
  }

  const restore = async (items: DriveFile[]) => {
    try {
      await trashApi.restore(items.map((f) => f.id))
      message.success('已恢复到原位置')
      refresh()
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const purge = (items: DriveFile[]) =>
    modal.confirm({
      title: `彻底删除 ${items.length} 项？`,
      content: '彻底删除后无法恢复。',
      okText: '彻底删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await trashApi.remove(items.map((f) => f.id))
          message.success('已彻底删除')
          refresh()
        } catch (error) {
          message.error(errorMessage(error))
        }
      },
    })

  const empty = () =>
    modal.confirm({
      title: '清空回收站？',
      content: '回收站中的所有文件都将被彻底删除，无法恢复。',
      okText: '清空',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await trashApi.empty()
          message.success('回收站已清空')
          refresh()
        } catch (error) {
          message.error(errorMessage(error))
        }
      },
    })

  if (query.error && isAuthError(query.error)) {
    return (
      <>
        <PageHeader title="回收站" />
        <LoginRequired />
      </>
    )
  }

  const touchSelecting = isMobile && selection.selecting
  const allSelected = targets.length > 0 && targets.length === files.length

  return (
    <div>
      <PageHeader
        title={touchSelecting ? `已选 ${targets.length} 项` : '回收站'}
        back={touchSelecting ? false : undefined}
        subtitle={touchSelecting ? undefined : files.length ? `${files.length} 项 · 删除的文件会在这里保留一段时间` : undefined}
        actions={
          touchSelecting ? (
            <SelectionControls allSelected={allSelected} onAll={() => (allSelected ? selection.clear() : selection.selectAll(files.map((f) => f.id)))} onDone={selection.clear} />
          ) : (
            <>
              <IconButton icon={RefreshCw} label="刷新" size={isMobile ? 'sm' : 'md'} onClick={() => query.refetch()} spinning={query.isFetching} />
              {isMobile ? (
                <IconButton icon={Trash2} label="清空回收站" size="sm" tone="danger" disabled={!files.length} onClick={empty} />
              ) : (
                <PillButton icon={Trash2} disabled={!files.length} onClick={empty} className="!text-danger">
                  清空回收站
                </PillButton>
              )}
            </>
          )
        }
      />
      {!isMobile && selection.selecting && (
        <div className="glass-card sticky top-4 z-30 mb-4 flex items-center gap-3 rounded-[22px] p-2 pl-4 text-[13px] text-ink-2">
          已选 <b className="text-accent">{selection.selected.size}</b> 项
          <div className="flex-1" />
          <PillButton icon={Undo2} onClick={() => restore(targets)} className="!py-2">
            恢复
          </PillButton>
          <PillButton icon={Trash2} className="!py-2 !text-danger" onClick={() => purge(targets)}>
            彻底删除
          </PillButton>
          <PillButton onClick={selection.clear} className="!py-2">
            取消
          </PillButton>
        </div>
      )}
      <Card className="!rounded-[26px] p-1.5 md:p-3">
        {query.isLoading ? (
          <ListSkeleton rows={6} />
        ) : files.length === 0 ? (
          <EmptyState icon={Trash2} title="回收站是空的" description="删除的文件会在这里保留一段时间" />
        ) : (
          <div className="space-y-0.5">
            {files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                selected={selection.has(file.id)}
                selecting={selection.selecting}
                thumbnails={false}
                compact={false}
                trailing={<span className="hidden text-xs text-ink-3 sm:block">删除于 {formatRelative(file.delete_time || file.modified_time)}</span>}
                handlers={{
                  onOpen: (f) => (isMobile ? setSheetFile(f) : selection.toggle(f.id)),
                  onToggle: (f) => selection.toggle(f.id),
                  onMore: (f) => setSheetFile(f),
                  menu: isMobile
                    ? undefined
                    : (f) => [
                        { key: 'restore', icon: <Undo2 size={15} />, label: '恢复', onClick: () => void restore([f]) },
                        { type: 'divider' },
                        { key: 'purge', icon: <Trash2 size={15} />, label: '彻底删除', danger: true, onClick: () => purge([f]) },
                      ],
                }}
              />
            ))}
          </div>
        )}
      </Card>
      {query.hasNextPage && (
        <div className="mt-5 text-center">
          <PillButton icon={RotateCcw} onClick={() => query.fetchNextPage()}>
            加载更多
          </PillButton>
        </div>
      )}

      {touchSelecting && (
        <ActionBar
          actions={[
            { key: 'restore', icon: Undo2, label: '恢复', onClick: () => restore(targets) },
            { key: 'purge', icon: Trash2, label: '彻底删除', danger: true, onClick: () => purge(targets) },
          ]}
        />
      )}

      <BottomSheet
        open={Boolean(sheetFile)}
        onClose={() => setSheetFile(null)}
        header={
          sheetFile && (
            <div className="mb-4 flex items-center gap-3 px-1">
              <FileIcon file={sheetFile} size={48} thumbnails={false} />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[15px] font-semibold break-all text-ink">{sheetFile.name}</div>
                <div className="mt-0.5 text-[12px] text-ink-3">
                  {isFolder(sheetFile) ? '文件夹' : formatBytes(sheetFile.size)} · 删除于 {formatRelative(sheetFile.delete_time || sheetFile.modified_time)}
                </div>
              </div>
            </div>
          )
        }
      >
        {sheetFile && (
          <>
            <SheetGroup>
              <SheetAction
                icon={<Undo2 size={18} />}
                label="恢复到原位置"
                onClick={() => {
                  setSheetFile(null)
                  void restore([sheetFile])
                }}
              />
              <SheetAction
                icon={<CheckCheck size={18} />}
                label="多选"
                onClick={() => {
                  setSheetFile(null)
                  selection.toggle(sheetFile.id)
                }}
              />
            </SheetGroup>
            <SheetGroup>
              <SheetAction
                icon={<Trash2 size={18} />}
                label="彻底删除"
                danger
                onClick={() => {
                  setSheetFile(null)
                  purge([sheetFile])
                }}
              />
            </SheetGroup>
          </>
        )}
      </BottomSheet>
    </div>
  )
}
