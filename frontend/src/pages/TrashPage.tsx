import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { App } from 'antd'
import { RefreshCw, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FileRow } from '../components/FileItems'
import LoginRequired from '../components/LoginRequired'
import PageHeader from '../components/PageHeader'
import { Card, EmptyState, IconButton, ListSkeleton, PillButton } from '../components/ui'
import { errorMessage, isAuthError, trashApi, type DriveFile } from '../lib/api'
import { formatRelative } from '../lib/format'

export default function TrashPage() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const query = useInfiniteQuery({
    queryKey: ['trash'],
    queryFn: ({ pageParam }) => trashApi.list(pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_page_token || undefined,
  })
  const files = useMemo(() => query.data?.pages.flatMap((p) => p.files) ?? [], [query.data])
  const targets = selected.size ? files.filter((f) => selected.has(f.id)) : []

  const refresh = () => {
    setSelected(new Set())
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

  const toggle = (file: DriveFile) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(file.id)) next.delete(file.id)
      else next.add(file.id)
      return next
    })

  return (
    <div>
      <PageHeader
        title="回收站"
        subtitle={files.length ? `${files.length} 项` : undefined}
        actions={
          <>
            <IconButton icon={RefreshCw} label="刷新" onClick={() => void query.refetch()} spinning={query.isFetching} />
            <PillButton icon={Trash2} disabled={!files.length} onClick={empty} className="!text-danger">
              <span className="hidden sm:inline">清空回收站</span>
            </PillButton>
          </>
        }
      />
      {selected.size > 0 && (
        <div className="neu-raised sticky top-4 z-30 mb-4 flex items-center gap-3 rounded-[22px] p-2 pl-4 text-[13px] text-ink-2">
          已选 <b className="text-accent">{selected.size}</b> 项
          <div className="flex-1" />
          <PillButton icon={Undo2} onClick={() => void restore(targets)}>恢复</PillButton>
          <PillButton icon={Trash2} className="!text-danger" onClick={() => purge(targets)}>彻底删除</PillButton>
        </div>
      )}
      <Card className="p-2 md:p-3">
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
                selected={selected.has(file.id)}
                selecting={selected.size > 0}
                thumbnails={false}
                compact={false}
                trailing={<span className="hidden text-xs text-ink-3 sm:block">删除于 {formatRelative(file.delete_time || file.modified_time)}</span>}
                handlers={{
                  onOpen: toggle,
                  onToggle: toggle,
                  onMore: () => void restore([file]),
                }}
              />
            ))}
          </div>
        )}
      </Card>
      {query.hasNextPage && (
        <div className="mt-5 text-center">
          <PillButton icon={RotateCcw} onClick={() => void query.fetchNextPage()}>加载更多</PillButton>
        </div>
      )}
    </div>
  )
}
