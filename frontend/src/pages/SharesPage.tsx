import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { App } from 'antd'
import { Copy, Eye, ExternalLink, Link2Off, RefreshCw, Share2, Users } from 'lucide-react'
import FileIcon from '../components/FileIcon'
import LoginRequired from '../components/LoginRequired'
import PageHeader from '../components/PageHeader'
import { Badge, Card, EmptyState, IconButton, ListSkeleton, PillButton } from '../components/ui'
import { errorMessage, isAuthError, sharesApi, type ShareItem } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { formatBytes, formatTime } from '../lib/format'

export default function SharesPage() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const query = useInfiniteQuery({
    queryKey: ['shares'],
    queryFn: ({ pageParam }) => sharesApi.list(pageParam || undefined),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_page_token || undefined,
  })
  const shares = query.data?.pages.flatMap((p) => p.data) ?? []

  const copy = async (share: ShareItem) => {
    const text = share.pass_code ? `${share.share_url} 提取码：${share.pass_code}` : share.share_url
    if (await copyText(text)) message.success('已复制链接与提取码')
  }

  const cancel = (share: ShareItem) =>
    modal.confirm({
      title: `取消分享「${share.title}」？`,
      content: '链接将立即失效，云盘中的文件不受影响。',
      okText: '取消分享',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await sharesApi.remove([share.share_id])
          message.success('已取消分享')
          void queryClient.invalidateQueries({ queryKey: ['shares'] })
        } catch (error) {
          message.error(errorMessage(error))
        }
      },
    })

  if (query.error && isAuthError(query.error)) {
    return (
      <>
        <PageHeader title="我的分享" />
        <LoginRequired />
      </>
    )
  }

  return (
    <div>
      <PageHeader
        title="我的分享"
        subtitle="在云盘中选择文件即可创建分享"
        actions={<IconButton icon={RefreshCw} label="刷新" onClick={() => void query.refetch()} spinning={query.isFetching} />}
      />
      {query.isLoading ? (
        <Card>
          <ListSkeleton rows={4} />
        </Card>
      ) : shares.length === 0 ? (
        <Card>
          <EmptyState icon={Share2} title="还没有分享" description="分享链接可以设置有效期、提取码和转存次数" />
        </Card>
      ) : (
        <div className="stagger grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {shares.map((share) => (
            <Card key={share.share_id} className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <FileIcon
                  file={{ kind: share.file_kind, name: share.params?.name ?? share.title, mime_type: '', thumbnail_link: share.thumbnail_link }}
                  size={48}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold text-ink">{share.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone={share.share_status === 'OK' ? 'success' : 'warning'}>{share.share_status_text || share.share_status}</Badge>
                    {share.file_num > 1 && <Badge>{share.file_num} 个文件</Badge>}
                    {share.file_size > 0 && <Badge>{formatBytes(share.file_size)}</Badge>}
                  </div>
                </div>
              </div>
              <div className="neu-inset grid grid-cols-3 gap-2 rounded-2xl p-3 text-center text-[12px] text-ink-3">
                <div>
                  <div className="flex items-center justify-center gap-1"><Eye size={12} /> 浏览</div>
                  <div className="mt-1 text-[15px] font-semibold text-ink tabular-nums">{share.view_count}</div>
                </div>
                <div>
                  <div className="flex items-center justify-center gap-1"><Users size={12} /> 转存</div>
                  <div className="mt-1 text-[15px] font-semibold text-ink tabular-nums">
                    {Math.max(share.restore_count, 0)}
                    {share.restore_limit > 0 ? `/${share.restore_limit}` : ''}
                  </div>
                </div>
                <div>
                  <div>提取码</div>
                  <div className="mt-1 font-mono text-[15px] font-semibold tracking-wider text-accent">{share.pass_code || '无'}</div>
                </div>
              </div>
              <div className="text-[12px] text-ink-3">
                创建于 {formatTime(share.create_time)} ·{' '}
                {share.expiration_days === -1 || share.expiration_days === 0 ? '永久有效' : `${formatTime(share.expiration_at)} 过期`}
              </div>
              <div className="mt-auto flex gap-2.5">
                <PillButton primary icon={Copy} className="flex-1 justify-center" onClick={() => void copy(share)}>
                  复制
                </PillButton>
                <IconButton icon={ExternalLink} label="打开链接" onClick={() => window.open(share.share_url, '_blank')} />
                <IconButton icon={Link2Off} label="取消分享" tone="danger" onClick={() => cancel(share)} />
              </div>
            </Card>
          ))}
        </div>
      )}
      {query.hasNextPage && (
        <div className="mt-6 text-center">
          <PillButton onClick={() => void query.fetchNextPage()}>加载更多</PillButton>
        </div>
      )}
    </div>
  )
}
