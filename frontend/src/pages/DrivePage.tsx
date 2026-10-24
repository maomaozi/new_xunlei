import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Checkbox, Dropdown, Input, Modal, type MenuProps } from 'antd'
import {
  ArrowDownAZ,
  ArrowUpDown,
  CheckCheck,
  ChevronRight,
  ClipboardCopy,
  Copy,
  Download,
  FilePlus2,
  FolderInput,
  FolderPlus,
  FolderUp,
  HardDrive,
  HardDriveDownload,
  Home,
  Info,
  LayoutGrid,
  List,
  Magnet,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Share2,
  Star,
  StarOff,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso'
import BottomSheet, { SheetAction, SheetGroup } from '../components/BottomSheet'
import FileDetailModal from '../components/FileDetailModal'
import FileIcon from '../components/FileIcon'
import { FileRow, FileTile, type ItemHandlers } from '../components/FileItems'
import FolderPickerModal from '../components/FolderPickerModal'
import EngineFolderSelect from '../components/EngineFolderSelect'
import LocalPathPicker from '../components/LocalPathPicker'
import LoginRequired from '../components/LoginRequired'
import OfflineCreatePanel from '../components/OfflineCreatePanel'
import PageHeader from '../components/PageHeader'
import ShareModal from '../components/ShareModal'
import { cx } from '../lib/cx'
import { ActionBar, Chips, EmptyState, IconButton, ListSkeleton, PillButton, SelectionControls } from '../components/ui'
import { useIsMobile } from '../hooks/useMediaQuery'
import { downloadsApi, errorMessage, filesApi, isAuthError, transfersApi, type Category, type DriveFile } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { isFolder, playable } from '../lib/files'
import { formatBytes, formatTime } from '../lib/format'
import { useAppSettings } from '../lib/settingsContext'
import { uploadStore } from '../lib/uploads'

type View = 'all' | Category | 'starred'

const VIEWS: { key: View; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'video', label: '视频' },
  { key: 'image', label: '图片' },
  { key: 'audio', label: '音频' },
  { key: 'document', label: '文档' },
  { key: 'archive', label: '压缩包' },
  { key: 'starred', label: '收藏' },
]

const SORTS = [
  { key: 'name', label: '名称' },
  { key: 'modified_time', label: '修改时间' },
  { key: 'created_time', label: '创建时间' },
  { key: 'size', label: '大小' },
] as const

type Dialog =
  | { type: 'rename'; file: DriveFile }
  | { type: 'mkdir' }
  | { type: 'move' | 'copy'; ids: string[] }
  | { type: 'share'; ids: string[]; title: string }
  | { type: 'download'; ids: string[]; title: string }
  | { type: 'offline' }
  | { type: 'hostUpload' }
  | null

export default function DrivePage() {
  const { folderId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const view = (searchParams.get('view') as View | null) ?? 'all'
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const { settings, update } = useAppSettings()
  const drive = settings?.drive

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [detail, setDetail] = useState<{ file: DriveFile; play: boolean } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [sheetFile, setSheetFile] = useState<DriveFile | null>(null)
  const [addSheet, setAddSheet] = useState(false)
  const [viewSheet, setViewSheet] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [downloadDir, setDownloadDir] = useState('')
  const [engineFolder, setEngineFolder] = useState('')
  const viaEngine = settings?.download.cloud_engine !== 'builtin'
  const [pickDir, setPickDir] = useState(false)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null)
  const [folderInput, setFolderInput] = useState<HTMLInputElement | null>(null)

  const listParams = useMemo(() => {
    if (view === 'starred') return { parent_id: '*', starred: true }
    if (view !== 'all') return { parent_id: '*', category: view }
    return { parent_id: folderId }
  }, [view, folderId])

  const listing = useInfiniteQuery({
    queryKey: ['files', listParams],
    queryFn: ({ pageParam }) => filesApi.list({ ...listParams, page_token: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next_page_token || undefined,
  })
  const crumbs = useQuery({
    queryKey: ['path', folderId],
    queryFn: () => filesApi.path(folderId),
    enabled: Boolean(folderId) && view === 'all',
    staleTime: 300_000,
  })

  const files = useMemo(() => {
    const all = listing.data?.pages.flatMap((page) => page.files) ?? []
    const keyword = filter.trim().toLowerCase()
    const visible = keyword ? all.filter((file) => file.name.toLowerCase().includes(keyword)) : all
    if (!drive) return visible
    const dir = drive.sort_order === 'asc' ? 1 : -1
    return [...visible].sort((a, b) => {
      if (drive.folders_first && isFolder(a) !== isFolder(b)) return isFolder(a) ? -1 : 1
      switch (drive.sort_by) {
        case 'size':
          return (a.size - b.size) * dir
        case 'modified_time':
          return a.modified_time.localeCompare(b.modified_time) * dir
        case 'created_time':
          return a.created_time.localeCompare(b.created_time) * dir
        default:
          return a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) * dir
      }
    })
  }, [listing.data, filter, drive])

  const selectedFiles = files.filter((file) => selected.has(file.id))
  const selecting = selected.size > 0
  const currentName = view !== 'all' ? VIEWS.find((v) => v.key === view)?.label : folderId ? crumbs.data?.at(-1)?.name ?? '…' : '我的云盘'
  const currentFolder = { id: folderId, name: folderId ? crumbs.data?.at(-1)?.name ?? '当前文件夹' : '根目录' }

  const refresh = useCallback(
    (delayed = false) => {
      const run = () => void queryClient.invalidateQueries({ queryKey: ['files'] })
      run()
      // Batch operations finish asynchronously on Xunlei; refetch once more shortly after.
      if (delayed) window.setTimeout(run, 1500)
    },
    [queryClient],
  )

  const clearSelection = () => {
    setSelected(new Set())
    setAnchor(null)
  }

  // Menu-driven actions have no button to spin, so slow calls show a keyed loading toast and
  // the same action cannot be started again while it is pending.
  const [pendingOps] = useState(() => new Set<string>())
  const withProgress = async <T,>(key: string, action: () => Promise<T>): Promise<T | undefined> => {
    if (pendingOps.has(key)) return undefined
    pendingOps.add(key)
    const timer = window.setTimeout(() => message.open({ key, type: 'loading', content: '处理中…', duration: 0 }), 300)
    try {
      return await action()
    } finally {
      window.clearTimeout(timer)
      message.destroy(key)
      pendingOps.delete(key)
    }
  }

  const run = async (action: () => Promise<unknown>, success: string, delayed = true) => {
    try {
      await withProgress(`op:${success}`, action)
      message.success(success)
      clearSelection()
      refresh(delayed)
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const [dialogBusy, setDialogBusy] = useState(false)
  const dialogBusyRef = useRef(false)
  const submitDialog = async (action: () => Promise<void>) => {
    if (dialogBusyRef.current) return
    dialogBusyRef.current = true
    setDialogBusy(true)
    try {
      await action()
    } finally {
      dialogBusyRef.current = false
      setDialogBusy(false)
    }
  }

  // ------------------------------------------------------------------ actions

  const open = (file: DriveFile) => {
    if (isFolder(file)) {
      clearSelection()
      setFilter('')
      navigate(`/drive/${file.id}`)
    } else {
      setDetail({ file, play: Boolean(playable(file)) })
    }
  }

  const toggle = (file: DriveFile, event: MouseEvent | null) => {
    const index = files.findIndex((f) => f.id === file.id)
    setSelected((current) => {
      const next = new Set(current)
      if (event?.shiftKey && anchor !== null) {
        const [a, b] = [anchor, index].sort((x, y) => x - y)
        files.slice(a, b + 1).forEach((f) => next.add(f.id))
      } else if (next.has(file.id)) next.delete(file.id)
      else next.add(file.id)
      return next
    })
    setAnchor(index)
  }

  const remove = (targets: DriveFile[]) => {
    const permanentDefault = drive?.delete_mode === 'permanent'
    let permanent = permanentDefault
    const execute = () =>
      run(
        () => (permanent ? filesApi.remove(targets.map((f) => f.id)) : filesApi.trash(targets.map((f) => f.id))),
        permanent ? '已彻底删除' : '已移入回收站',
      )
    if (drive && !drive.confirm_delete && !permanentDefault) {
      void execute()
      return
    }
    modal.confirm({
      title: targets.length === 1 ? `删除「${targets[0].name}」？` : `删除选中的 ${targets.length} 项？`,
      content: (
        <div className="pt-2">
          <Checkbox defaultChecked={permanentDefault} onChange={(e) => (permanent = e.target.checked)}>
            彻底删除（不进入回收站，无法恢复）
          </Checkbox>
        </div>
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: execute,
    })
  }

  const starToggle = (targets: DriveFile[]) => {
    const star = targets.some((f) => !f.starred)
    void run(() => filesApi.star(targets.map((f) => f.id), star), star ? '已收藏' : '已取消收藏', false)
  }

  const copyLink = async (file: DriveFile) => {
    try {
      const link = await withProgress(`link:${file.id}`, () => filesApi.link(file.id))
      if (link && (await copyText(link.url))) message.success('直链已复制')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const browserDownload = async (file: DriveFile) => {
    try {
      if (settings?.download.proxy_browser_downloads) {
        window.open(filesApi.streamUrl(file.id, true), '_blank')
        return
      }
      const link = await withProgress(`link:${file.id}`, () => filesApi.link(file.id))
      if (link) window.open(link.url, '_blank')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const askDownload = (targets: DriveFile[]) => {
    setDownloadDir(settings?.download.directory ?? '')
    setDialog({
      type: 'download',
      ids: targets.map((f) => f.id),
      title: targets.length === 1 ? targets[0].name : `${targets.length} 项`,
    })
  }

  const menuFor = (file: DriveFile): MenuProps['items'] => {
    const folder = isFolder(file)
    return [
      ...(folder
        ? [{ key: 'open', icon: <FolderInput size={15} />, label: '打开', onClick: () => open(file) }]
        : [
            ...(playable(file) ? [{ key: 'play', icon: <Play size={15} />, label: '播放', onClick: () => setDetail({ file, play: true }) }] : []),
            { key: 'browser', icon: <Download size={15} />, label: '浏览器下载', onClick: () => void browserDownload(file) },
            { key: 'link', icon: <ClipboardCopy size={15} />, label: '复制直链', onClick: () => void copyLink(file) },
          ]),
      { key: 'host', icon: <HardDriveDownload size={15} />, label: '下载到本机', onClick: () => askDownload([file]) },
      { type: 'divider' as const },
      { key: 'share', icon: <Share2 size={15} />, label: '分享', onClick: () => setDialog({ type: 'share', ids: [file.id], title: file.name }) },
      {
        key: 'star',
        icon: file.starred ? <StarOff size={15} /> : <Star size={15} />,
        label: file.starred ? '取消收藏' : '收藏',
        onClick: () => starToggle([file]),
      },
      {
        key: 'rename',
        icon: <Pencil size={15} />,
        label: '重命名',
        onClick: () => {
          setNameInput(file.name)
          setDialog({ type: 'rename', file })
        },
      },
      { key: 'move', icon: <FolderInput size={15} />, label: '移动到…', onClick: () => setDialog({ type: 'move', ids: [file.id] }) },
      { key: 'copy', icon: <Copy size={15} />, label: '复制到…', onClick: () => setDialog({ type: 'copy', ids: [file.id] }) },
      { key: 'info', icon: <Info size={15} />, label: '详细信息', onClick: () => setDetail({ file, play: false }) },
      { type: 'divider' as const },
      { key: 'delete', icon: <Trash2 size={15} />, label: '删除', danger: true, onClick: () => remove([file]) },
    ]
  }

  const [menuState, setMenuState] = useState<{ file: DriveFile; x: number; y: number } | null>(null)

  const handlers: ItemHandlers = {
    onOpen: open,
    onToggle: toggle,
    onMore: (file, event) => {
      if (isMobile) setSheetFile(file)
      else setMenuState({ file, x: event.clientX, y: event.clientY })
    },
    onContext: (file, event) => !isMobile && setMenuState({ file, x: event.clientX, y: event.clientY }),
    menu: isMobile ? undefined : menuFor,
  }

  const pickFiles = (list: FileList | null, folderMode: boolean) => {
    if (!list?.length) return
    const entries = Array.from(list).map((file) => ({
      file,
      relativePath: folderMode ? (file as File & { webkitRelativePath: string }).webkitRelativePath : undefined,
    }))
    uploadStore.add(entries, folderId)
    message.info(`已加入上传队列：${entries.length} 个文件`)
  }

  const addMenu: MenuProps['items'] = [
    { key: 'file', icon: <Upload size={15} />, label: '上传文件', onClick: () => fileInput?.click() },
    { key: 'folder', icon: <FolderUp size={15} />, label: '上传文件夹', onClick: () => folderInput?.click() },
    { key: 'host', icon: <Server size={15} />, label: '上传服务器本机文件', onClick: () => setDialog({ type: 'hostUpload' }) },
    { type: 'divider' },
    {
      key: 'mkdir',
      icon: <FolderPlus size={15} />,
      label: '新建文件夹',
      onClick: () => {
        setNameInput('')
        setDialog({ type: 'mkdir' })
      },
    },
    { key: 'offline', icon: <Magnet size={15} />, label: '云添加到此处', onClick: () => setDialog({ type: 'offline' }) },
  ]

  const sortMenu: MenuProps = {
    selectable: true,
    selectedKeys: [drive?.sort_by ?? 'name', drive?.sort_order ?? 'asc', drive?.folders_first ? 'ff' : ''],
    items: [
      ...SORTS.map((s) => ({ key: s.key, label: s.label })),
      { type: 'divider' },
      { key: 'asc', label: '升序' },
      { key: 'desc', label: '降序' },
      { type: 'divider' },
      { key: 'ff', label: '文件夹优先' },
    ],
    onClick: ({ key }) => {
      if (key === 'asc' || key === 'desc') void update('drive', { sort_order: key })
      else if (key === 'ff') void update('drive', { folders_first: !drive?.folders_first })
      else void update('drive', { sort_by: key as (typeof SORTS)[number]['key'] })
    },
  }

  if (listing.error && isAuthError(listing.error)) {
    return (
      <>
        <PageHeader title="云盘" />
        <LoginRequired />
      </>
    )
  }

  const gridView = drive?.default_view === 'grid'
  const thumbnails = drive?.show_thumbnails ?? true
  const compact = settings?.ui.density === 'compact'
  const loadMore = () => listing.hasNextPage && !listing.isFetchingNextPage && void listing.fetchNextPage()

  const allSelected = selecting && selected.size === files.length
  const selectAll = () => (allSelected ? clearSelection() : setSelected(new Set(files.map((f) => f.id))))
  const batchActions = [
    { key: 'download', icon: HardDriveDownload, label: '下载到本机', short: '下载', onClick: () => askDownload(selectedFiles) },
    { key: 'share', icon: Share2, label: '分享', short: '分享', onClick: () => setDialog({ type: 'share', ids: [...selected], title: selectedFiles[0]?.name ?? '分享' }) },
    { key: 'move', icon: FolderInput, label: '移动', short: '移动', onClick: () => setDialog({ type: 'move', ids: [...selected] }) },
    { key: 'copy', icon: Copy, label: '复制', short: '复制', onClick: () => setDialog({ type: 'copy', ids: [...selected] }) },
    { key: 'star', icon: Star, label: '收藏/取消', short: '收藏', onClick: () => starToggle(selectedFiles) },
    { key: 'delete', icon: Trash2, label: '删除', short: '删除', danger: true, onClick: () => remove(selectedFiles) },
  ]

  const batchBar =
    selecting &&
    (isMobile ? (
      <ActionBar actions={batchActions.map((a) => ({ ...a, label: a.short }))} />
    ) : (
      <div className="glass-card sticky top-4 z-40 mb-4 flex items-center gap-2 rounded-[22px] p-2">
        <div className="flex items-center gap-2 pr-2 pl-1 text-[13px] text-ink-2">
          <IconButton icon={X} label="取消选择" size="sm" variant="ghost" onClick={clearSelection} />
          已选 <b className="text-accent">{selected.size}</b> 项 · {formatBytes(selectedFiles.reduce((sum, f) => sum + f.size, 0))}
          <button type="button" className="cursor-pointer border-0 bg-transparent text-[13px] text-accent" onClick={selectAll}>
            {allSelected ? '全不选' : '全选'}
          </button>
        </div>
        <div className="flex-1" />
        {batchActions.map((action) => (
          <IconButton key={action.key} icon={action.icon} label={action.label} size="sm" tone={action.danger ? 'danger' : 'default'} onClick={action.onClick} />
        ))}
      </div>
    ))

  const parentCrumb = crumbs.data && crumbs.data.length > 1 ? crumbs.data[crumbs.data.length - 2] : null
  const mobileBack = view === 'all' && folderId ? () => navigate(parentCrumb ? `/drive/${parentCrumb.id}` : '/drive') : false

  const menuSheetGroups = (items: MenuProps['items']) => {
    const groups: NonNullable<MenuProps['items']>[] = [[]]
    for (const item of items ?? []) {
      if (item && 'type' in item && item.type === 'divider') groups.push([])
      else groups[groups.length - 1].push(item)
    }
    return groups.filter((group) => group.length)
  }

  return (
    <div>
      <PageHeader
        title={isMobile && selecting ? `已选 ${selected.size} 项` : currentName}
        back={isMobile && selecting ? false : mobileBack}
        subtitle={
          isMobile && selecting
            ? formatBytes(selectedFiles.reduce((sum, f) => sum + f.size, 0))
            : listing.data
              ? `${files.length}${listing.hasNextPage ? '+' : ''} 项${filter ? ' · 已筛选' : ''}`
              : undefined
        }
        actions={
          isMobile && selecting ? (
            <SelectionControls allSelected={allSelected} onAll={selectAll} onDone={clearSelection} />
          ) : isMobile ? (
            <>
              <IconButton icon={Search} label="筛选" size="sm" active={searchOpen} onClick={() => setSearchOpen(!searchOpen)} />
              <IconButton icon={ArrowUpDown} label="排序与视图" size="sm" onClick={() => setViewSheet(true)} />
              <IconButton icon={Plus} label="新建" size="sm" tone="accent" onClick={() => setAddSheet(true)} />
            </>
          ) : (
            <>
              <Input
                allowClear
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="筛选当前列表"
                prefix={<Search size={15} className="text-ink-3" />}
                className="!w-56 !rounded-2xl"
              />
              <IconButton icon={RefreshCw} label="刷新" onClick={() => refresh()} spinning={listing.isFetching} />
              <Dropdown menu={sortMenu} trigger={['click']}>
                <span>
                  <IconButton icon={ArrowDownAZ} label="排序" showTooltip={false} />
                </span>
              </Dropdown>
              <IconButton
                icon={gridView ? List : LayoutGrid}
                label={gridView ? '列表视图' : '网格视图'}
                onClick={() => update('drive', { default_view: gridView ? 'list' : 'grid' })}
              />
              <Dropdown menu={{ items: addMenu }} trigger={['click']}>
                <span>
                  <PillButton primary icon={Plus}>
                    新建 / 上传
                  </PillButton>
                </span>
              </Dropdown>
            </>
          )
        }
      >
        {isMobile && searchOpen && !selecting && (
          <Input
            autoFocus
            allowClear
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="筛选当前列表"
            prefix={<Search size={15} className="text-ink-3" />}
            className="mb-3 !rounded-2xl"
          />
        )}
        <Chips
          value={view}
          onChange={(key) => {
            clearSelection()
            setSearchParams(key === 'all' ? {} : { view: key })
            if (key !== 'all' && folderId) navigate(`/drive?view=${key}`)
          }}
          options={VIEWS.map((item) => ({ value: item.key, label: item.label }))}
          className="-mx-4 px-4 py-1 md:mx-0 md:px-0"
        />
          {view === 'all' && (folderId || !isMobile) && (
            <div className="scrollbar-none -mx-4 mt-2 flex items-center gap-1 overflow-x-auto px-4 py-1 text-[13px] md:mx-0 md:px-0">
              <button
                type="button"
                onClick={() => navigate('/drive')}
                className={cx('tap flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border-0 px-2.5 py-1.5', !folderId ? 'tint text-accent' : 'bg-transparent text-ink-2')}
              >
                <Home size={14} /> 云盘
              </button>
              {crumbs.data?.map((crumb, index) => (
                <span key={crumb.id} className="flex shrink-0 items-center gap-1">
                  <ChevronRight size={14} className="text-ink-3" />
                  <button
                    type="button"
                    onClick={() => navigate(`/drive/${crumb.id}`)}
                    className={cx(
                      'max-w-48 cursor-pointer truncate rounded-xl border-0 px-2.5 py-1.5',
                      index === (crumbs.data?.length ?? 0) - 1 ? 'tint font-semibold text-accent' : 'bg-transparent text-ink-2 hover:text-ink',
                    )}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </div>
          )}
      </PageHeader>

      {batchBar}

      {listing.isLoading ? (
        <div className="neu-raised rounded-[28px] p-3">
          <ListSkeleton rows={8} />
        </div>
      ) : listing.error ? (
        <EmptyState icon={HardDrive} title="加载失败" description={errorMessage(listing.error)} action={<PillButton onClick={() => refresh()}>重试</PillButton>} />
      ) : files.length === 0 ? (
        <div className="neu-raised rounded-[28px]">
          <EmptyState
            icon={filter ? Search : FilePlus2}
            title={filter ? '没有匹配的文件' : '这里还是空的'}
            description={filter ? '换个关键词试试' : '上传文件或使用云添加保存资源'}
            action={
              !filter && view === 'all' ? (
                <div className="flex gap-3">
                  <PillButton icon={Upload} onClick={() => fileInput?.click()}>上传</PillButton>
                  <PillButton primary icon={Magnet} onClick={() => setDialog({ type: 'offline' })}>云添加</PillButton>
                </div>
              ) : undefined
            }
          />
        </div>
      ) : gridView ? (
        <VirtuosoGrid
          useWindowScroll
          data={files}
          endReached={loadMore}
          listClassName="grid grid-cols-2 gap-3 md:gap-4 xs:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 pb-4"
          itemContent={(_, file) => (
            <FileTile file={file} selected={selected.has(file.id)} selecting={selecting} thumbnails={thumbnails} handlers={handlers} />
          )}
        />
      ) : (
        <div className="neu-raised rounded-[26px] py-1.5 md:py-2">
          {!isMobile && (
            <div className="flex items-center gap-4 px-7 pt-2 pb-3 text-[12px] text-ink-3">
              <Checkbox
                checked={selecting && selected.size === files.length}
                indeterminate={selecting && selected.size < files.length}
                onChange={(e) => (e.target.checked ? setSelected(new Set(files.map((f) => f.id))) : clearSelection())}
              />
              <span className="flex-1 pl-11">名称</span>
              <span className="w-24 text-right">大小</span>
              <span className="hidden w-32 text-right lg:block">修改时间</span>
              <span className="w-9" />
            </div>
          )}
          <Virtuoso
            useWindowScroll
            data={files}
            endReached={loadMore}
            increaseViewportBy={400}
            itemContent={(_, file) => (
              <FileRow file={file} selected={selected.has(file.id)} selecting={selecting} thumbnails={thumbnails} compact={compact} handlers={handlers} />
            )}
            components={{
              Footer: () =>
                listing.isFetchingNextPage ? <div className="py-4 text-center text-xs text-ink-3">正在加载更多…</div> : null,
            }}
          />
        </div>
      )}

      {/* context menu for desktop */}
      {menuState && (
        <Dropdown
          open
          menu={{ items: menuFor(menuState.file), onClick: () => setMenuState(null) }}
          onOpenChange={(visible) => !visible && setMenuState(null)}
          trigger={['click']}
        >
          <span className="fixed h-px w-px" style={{ left: menuState.x, top: menuState.y }} />
        </Dropdown>
      )}

      <input
        ref={setFileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          pickFiles(e.target.files, false)
          e.target.value = ''
        }}
      />
      <input
        ref={setFolderInput}
        type="file"
        hidden
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          pickFiles(e.target.files, true)
          e.target.value = ''
        }}
      />

      {/* mobile sheets */}
      <BottomSheet
        open={Boolean(sheetFile)}
        onClose={() => setSheetFile(null)}
        header={
          sheetFile && (
            <div className="mb-4 flex items-center gap-3 px-1">
              <FileIcon file={sheetFile} size={48} thumbnails={thumbnails} />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[15px] font-semibold break-all text-ink">{sheetFile.name}</div>
                <div className="mt-0.5 text-[12px] text-ink-3">
                  {isFolder(sheetFile) ? '文件夹' : formatBytes(sheetFile.size)} · {formatTime(sheetFile.modified_time)}
                </div>
              </div>
            </div>
          )
        }
      >
        {sheetFile && (
          <>
            {menuSheetGroups(menuFor(sheetFile)).map((group, groupIndex) => (
              <SheetGroup key={groupIndex}>
                {group.map((item, index) =>
                  item && 'onClick' in item && item.onClick ? (
                    <SheetAction
                      key={String(item.key ?? index)}
                      icon={'icon' in item ? item.icon : null}
                      label={String('label' in item ? item.label : '')}
                      danger={'danger' in item ? Boolean(item.danger) : false}
                      onClick={() => {
                        setSheetFile(null)
                        ;(item.onClick as () => void)()
                      }}
                    />
                  ) : null,
                )}
              </SheetGroup>
            ))}
            <SheetGroup>
              <SheetAction
                icon={<CheckCheck size={15} />}
                label="多选"
                onClick={() => {
                  const file = sheetFile
                  setSheetFile(null)
                  toggle(file, null)
                }}
              />
            </SheetGroup>
          </>
        )}
      </BottomSheet>
      <BottomSheet open={addSheet} onClose={() => setAddSheet(false)} title={`新建 / 上传到「${currentFolder.name}」`}>
        {menuSheetGroups(addMenu).map((group, groupIndex) => (
          <SheetGroup key={groupIndex}>
            {group.map((item, index) =>
              item && 'onClick' in item && item.onClick ? (
                <SheetAction
                  key={String(item.key ?? index)}
                  icon={'icon' in item ? item.icon : null}
                  label={String('label' in item ? item.label : '')}
                  onClick={() => {
                    setAddSheet(false)
                    ;(item.onClick as () => void)()
                  }}
                />
              ) : null,
            )}
          </SheetGroup>
        ))}
      </BottomSheet>
      <BottomSheet open={viewSheet} onClose={() => setViewSheet(false)} title="排序与视图">
        <div className="mb-2 px-3 text-[12px] text-ink-3">排序方式</div>
        <SheetGroup>
          {SORTS.map((sort) => (
            <SheetAction key={sort.key} label={sort.label} active={(drive?.sort_by ?? 'name') === sort.key} onClick={() => void update('drive', { sort_by: sort.key })} />
          ))}
        </SheetGroup>
        <SheetGroup>
          <SheetAction label="升序" active={(drive?.sort_order ?? 'asc') === 'asc'} onClick={() => void update('drive', { sort_order: 'asc' })} />
          <SheetAction label="降序" active={drive?.sort_order === 'desc'} onClick={() => void update('drive', { sort_order: 'desc' })} />
          <SheetAction label="文件夹优先" active={Boolean(drive?.folders_first)} onClick={() => void update('drive', { folders_first: !drive?.folders_first })} />
        </SheetGroup>
        <div className="mb-2 px-3 text-[12px] text-ink-3">视图</div>
        <SheetGroup>
          <SheetAction icon={<List size={18} />} label="列表" active={!gridView} onClick={() => void update('drive', { default_view: 'list' })} />
          <SheetAction icon={<LayoutGrid size={18} />} label="网格" active={gridView} onClick={() => void update('drive', { default_view: 'grid' })} />
        </SheetGroup>
        <SheetGroup>
          <SheetAction
            icon={<RefreshCw size={18} />}
            label="刷新列表"
            onClick={() => {
              setViewSheet(false)
              refresh()
            }}
          />
        </SheetGroup>
      </BottomSheet>

      {/* dialogs */}
      <Modal
        open={dialog?.type === 'rename' || dialog?.type === 'mkdir'}
        title={dialog?.type === 'rename' ? '重命名' : '新建文件夹'}
        onCancel={() => setDialog(null)}
        okButtonProps={{ disabled: !nameInput.trim() }}
        confirmLoading={dialogBusy}
        onOk={() =>
          submitDialog(async () => {
            if (dialog?.type === 'rename') {
              await run(() => filesApi.rename(dialog.file.id, nameInput.trim()), '已重命名', false)
            } else {
              await run(() => filesApi.createFolder(nameInput.trim(), folderId), '文件夹已创建', false)
            }
            setDialog(null)
          })
        }
        destroyOnHidden
      >
        <Input
          autoFocus
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onFocus={(e) => {
            const dot = e.target.value.lastIndexOf('.')
            if (dialog?.type === 'rename' && dot > 0) e.target.setSelectionRange(0, dot)
          }}
          placeholder="名称"
          className="!mt-2"
        />
      </Modal>

      <FolderPickerModal
        open={dialog?.type === 'move' || dialog?.type === 'copy'}
        title={dialog?.type === 'copy' ? '复制到' : '移动到'}
        okText={dialog?.type === 'copy' ? '复制到这里' : '移动到这里'}
        disabledIds={dialog && 'ids' in dialog ? dialog.ids : []}
        onCancel={() => setDialog(null)}
        onPick={async (target) => {
          if (dialog?.type !== 'move' && dialog?.type !== 'copy') return
          const ids = dialog.ids
          await run(
            () => (dialog.type === 'copy' ? filesApi.copy(ids, target.id) : filesApi.move(ids, target.id)),
            dialog.type === 'copy' ? `已复制到「${target.name}」` : `已移动到「${target.name}」`,
          )
          setDialog(null)
        }}
      />

      <ShareModal
        open={dialog?.type === 'share'}
        fileIds={dialog?.type === 'share' ? dialog.ids : []}
        title={dialog?.type === 'share' ? dialog.title : ''}
        onClose={() => setDialog(null)}
      />

      <Modal
        open={dialog?.type === 'download'}
        title="下载到本机"
        okText="开始下载"
        onCancel={() => setDialog(null)}
        confirmLoading={dialogBusy}
        onOk={() =>
          submitDialog(async () => {
          if (dialog?.type !== 'download') return
          try {
            if (viaEngine) {
              const { results } = await downloadsApi.cloud(dialog.ids, engineFolder)
              const failed = results.filter((r) => !r.ok)
              failed.forEach((r) => message.error(r.error))
              if (failed.length === results.length) return
              message.success(`已交给迅雷引擎：${results.length - failed.length} 个任务，可在「下载」页查看`)
              void queryClient.invalidateQueries({ queryKey: ['downloads'] })
            } else {
              const result = await transfersApi.download(dialog.ids, downloadDir !== settings?.download.directory ? downloadDir : undefined)
              message.success(`已加入下载队列：${result.count} 个文件`)
              void queryClient.invalidateQueries({ queryKey: ['transfers'] })
            }
            clearSelection()
            setDialog(null)
          } catch (error) {
            message.error(errorMessage(error))
          }
        })
        }
        destroyOnHidden
      >
        <div className="space-y-4 pt-2">
          <div className="text-sm text-ink-2">
            将 <b className="text-ink">{dialog?.type === 'download' ? dialog.title : ''}</b> 下载到运行本服务的主机，
            {viaEngine
              ? '由迅雷下载引擎取回（会员加速，文件夹整体取回并保留结构）。'
              : '由内置下载器从 VIP CDN 多线程拉取，文件夹会递归下载并保留目录结构。'}
          </div>
          <div>
            <div className="mb-2 text-[13px] text-ink-3">保存目录</div>
            {viaEngine ? (
              <EngineFolderSelect value={engineFolder} onChange={setEngineFolder} disabled={dialog?.type !== 'download'} />
            ) : (
              <div className="flex gap-2">
                <Input value={downloadDir} onChange={(e) => setDownloadDir(e.target.value)} />
                <PillButton onClick={() => setPickDir(true)}>浏览</PillButton>
              </div>
            )}
          </div>
        </div>
      </Modal>
      <LocalPathPicker
        open={pickDir}
        title="选择保存目录"
        mode="dir"
        initialPath={downloadDir || undefined}
        onCancel={() => setPickDir(false)}
        onPick={(path) => {
          setDownloadDir(path)
          setPickDir(false)
        }}
      />
      <LocalPathPicker
        open={dialog?.type === 'hostUpload'}
        title="选择服务器上的文件或文件夹"
        mode="any"
        onCancel={() => setDialog(null)}
        onPick={async (path) => {
          try {
            const result = await transfersApi.uploadLocal(path, folderId)
            message.success(`已加入上传队列：${result.count} 个文件`)
            void queryClient.invalidateQueries({ queryKey: ['transfers'] })
            setDialog(null)
          } catch (error) {
            message.error(errorMessage(error))
          }
        }}
      />

      <Modal open={dialog?.type === 'offline'} title="云添加" footer={null} onCancel={() => setDialog(null)} width={620} destroyOnHidden>
        <div className="pt-2">
          <OfflineCreatePanel initialFolder={currentFolder} compact onCreated={() => setDialog(null)} />
        </div>
      </Modal>

      <FileDetailModal
        file={detail?.file ?? null}
        autoPlay={detail?.play}
        onClose={() => setDetail(null)}
        onDownloadToHost={(file) => {
          setDetail(null)
          askDownload([file])
        }}
        onShare={(file) => {
          setDetail(null)
          setDialog({ type: 'share', ids: [file.id], title: file.name })
        }}
      />

      {!isMobile && files.length > 0 && <div className="mt-3 text-center text-xs text-ink-3">右键文件打开菜单 · Shift 连选 · Ctrl/⌘ 多选</div>}
    </div>
  )
}
