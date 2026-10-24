import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Input, Modal } from 'antd'
import { ChevronRight, FolderPlus, Home } from 'lucide-react'
import { useState } from 'react'
import { errorMessage, filesApi, type Breadcrumb } from '../lib/api'
import FileIcon from './FileIcon'
import { cx } from '../lib/cx'
import { ListSkeleton, PillButton } from './ui'

/** Pick a cloud folder; used by move/copy, cloud add targets and settings. */
export default function FolderPickerModal({
  open,
  title,
  okText = '选择此文件夹',
  disabledIds = [],
  onCancel,
  onPick,
}: {
  open: boolean
  title: string
  okText?: string
  disabledIds?: string[]
  onCancel: () => void
  onPick: (folder: Breadcrumb) => Promise<void> | void
}) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [trail, setTrail] = useState<Breadcrumb[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const current = trail.at(-1)
  const parentId = current?.id ?? ''

  const { data, isLoading } = useQuery({
    queryKey: ['picker', parentId],
    queryFn: () => filesApi.list({ parent_id: parentId }),
    enabled: open,
  })
  const folders = (data?.files ?? []).filter((file) => file.kind === 'drive#folder')

  const create = async () => {
    if (!newName.trim()) return
    try {
      const folder = await filesApi.createFolder(newName.trim(), parentId)
      setCreating(false)
      setNewName('')
      await queryClient.invalidateQueries({ queryKey: ['picker', parentId] })
      setTrail([...trail, { id: folder.id, name: folder.name }])
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const confirm = async () => {
    setBusy(true)
    try {
      await onPick(current ?? { id: '', name: '根目录' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      onOk={() => void confirm()}
      okText={okText}
      confirmLoading={busy}
      okButtonProps={{ disabled: disabledIds.includes(parentId) }}
      afterOpenChange={(visible) => !visible && setTrail([])}
      width={520}
      destroyOnHidden
    >
      <div className="scrollbar-none mb-3 flex items-center gap-1 overflow-x-auto py-1 text-[13px]">
        <button type="button" onClick={() => setTrail([])} className={cx('neu-press flex cursor-pointer items-center gap-1 rounded-xl border-0 px-2.5 py-1.5', trail.length === 0 ? 'text-accent' : 'text-ink-2')}>
          <Home size={14} /> 根目录
        </button>
        {trail.map((crumb, index) => (
          <span key={crumb.id} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-ink-3" />
            <button
              type="button"
              onClick={() => setTrail(trail.slice(0, index + 1))}
              className={cx('max-w-40 cursor-pointer truncate rounded-xl border-0 bg-transparent px-1.5 py-1', index === trail.length - 1 ? 'font-semibold text-accent' : 'text-ink-2')}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>
      <div className="neu-inset h-[46vh] max-h-[420px] overflow-y-auto rounded-3xl p-2">
        {isLoading ? (
          <ListSkeleton rows={5} />
        ) : folders.length === 0 ? (
          <div className="py-16 text-center text-sm text-ink-3">没有子文件夹</div>
        ) : (
          folders.map((folder) => {
            const disabled = disabledIds.includes(folder.id)
            return (
              <button
                key={folder.id}
                type="button"
                disabled={disabled}
                onClick={() => setTrail([...trail, { id: folder.id, name: folder.name }])}
                className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border-0 bg-transparent p-2.5 text-left text-ink transition hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.03]"
              >
                <FileIcon file={folder} size={36} thumbnails={false} />
                <span className="min-w-0 flex-1 truncate text-[14px]">{folder.name}</span>
                <ChevronRight size={16} className="text-ink-3" />
              </button>
            )
          })
        )}
      </div>
      <div className="mt-3">
        {creating ? (
          <div className="flex gap-2">
            <Input autoFocus value={newName} placeholder="新文件夹名称" onChange={(e) => setNewName(e.target.value)} onPressEnter={() => void create()} />
            <PillButton primary onClick={() => void create()}>创建</PillButton>
            <PillButton onClick={() => setCreating(false)}>取消</PillButton>
          </div>
        ) : (
          <PillButton icon={FolderPlus} onClick={() => setCreating(true)}>
            新建文件夹
          </PillButton>
        )}
      </div>
    </Modal>
  )
}
