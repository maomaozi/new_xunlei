import { useInfiniteQuery } from '@tanstack/react-query'
import { Activity, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import FileIcon from '../components/FileIcon'
import LoginRequired from '../components/LoginRequired'
import PageHeader from '../components/PageHeader'
import { Badge, Card, EmptyState, IconButton, ListSkeleton, PillButton } from '../components/ui'
import { eventsApi, isAuthError } from '../lib/api'
import { formatRelative, formatTime } from '../lib/format'

export default function EventsPage() {
  const navigate = useNavigate()
  const query = useInfiniteQuery({
    queryKey: ['events'],
    queryFn: ({ pageParam }) => eventsApi.list(pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_page_token || undefined,
  })
  const events = query.data?.pages.flatMap((p) => p.events) ?? []

  if (query.error && isAuthError(query.error)) {
    return (
      <>
        <PageHeader title="动态" />
        <LoginRequired />
      </>
    )
  }

  return (
    <div>
      <PageHeader
        title="动态"
        subtitle="云盘中的云添加、上传、转存等记录"
        actions={<IconButton icon={RefreshCw} label="刷新" onClick={() => query.refetch()} spinning={query.isFetching} />}
      />
      <Card className="p-3 md:p-5">
        {query.isLoading ? (
          <ListSkeleton rows={6} />
        ) : events.length === 0 ? (
          <EmptyState icon={Activity} title="暂无动态" />
        ) : (
          <ol className="relative m-0 list-none space-y-1 p-0">
            {events.map((event) => {
              const ref = event.reference_resource
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() =>
                      ref?.kind === 'drive#folder'
                        ? navigate(`/drive/${ref.id}`)
                        : navigate(ref?.parent_id ? `/drive/${ref.parent_id}` : '/drive')
                    }
                    className="flex w-full cursor-pointer items-center gap-3 rounded-[20px] border-0 bg-transparent p-3 text-left transition hover:bg-black/[0.02] md:gap-4 dark:hover:bg-white/[0.02]"
                  >
                    <FileIcon
                      file={{ kind: ref?.kind ?? 'drive#file', name: event.file_name, mime_type: event.mime_type, thumbnail_link: ref?.thumbnail_link ?? '' }}
                      size={44}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium text-ink">{event.file_name}</div>
                      <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                        <Badge tone="accent">{event.type_name || event.type}</Badge>
                        {event.device && <span>{event.device}</span>}
                        <span title={formatTime(event.created_time)}>{formatRelative(event.created_time)}</span>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
        {query.hasNextPage && (
          <div className="pt-4 text-center">
            <PillButton onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? '加载中…' : '加载更多'}
            </PillButton>
          </div>
        )}
      </Card>
    </div>
  )
}
