import { App, Modal, Tree } from 'antd'
import { ListChecks } from 'lucide-react'
import { useMemo, useState } from 'react'
import { errorMessage, type ResourcePreview } from '../lib/api'
import { formatBytes } from '../lib/format'
import {
  buildSubFileTree,
  indexesFromKeys,
  selectedIndexes,
  videoIndexes,
  type SubFileNode,
  type SubFileSelection,
  type SubFileTarget,
} from '../lib/subfiles'
import { PillButton } from './ui'

/** "选择文件" button that lists BT sub-files (via resource/list or a parsed torrent) for picking. */
export default function SubFileSelect({
  target,
  value,
  onChange,
}: {
  target: SubFileTarget | null
  value: SubFileSelection | null
  onChange: (value: SubFileSelection | null) => void
}) {
  const { message } = App.useApp()
  const [preview, setPreview] = useState<{ key: string; data: ResourcePreview } | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checked, setChecked] = useState<number[]>([])

  const files = useMemo(() => preview?.data.files ?? [], [preview])
  const tree = useMemo(() => buildSubFileTree(files), [files])
  const sizes = useMemo(() => new Map(files.map((f) => [f.index, f.size])), [files])
  const current = selectedIndexes(target, value)

  if (!target) return null

  const show = async () => {
    let data = preview?.key === target.key ? preview.data : null
    if (!data) {
      setLoading(true)
      try {
        data = await target.load()
        setPreview({ key: target.key, data })
      } catch (error) {
        message.error(errorMessage(error))
        return
      } finally {
        setLoading(false)
      }
    }
    if (data.files.length < 2) {
      message.info('该链接只包含一个文件，无需选择')
      return
    }
    setChecked(current ?? data.files.map((f) => f.index))
    setOpen(true)
  }

  const confirm = () => {
    if (!checked.length) {
      message.warning('请至少选择一个文件')
      return
    }
    onChange(checked.length === files.length ? null : { key: target.key, indexes: checked })
    setOpen(false)
  }

  const selectedSize = checked.reduce((sum, index) => sum + (sizes.get(index) ?? 0), 0)

  return (
    <>
      <PillButton icon={ListChecks} active={Boolean(current)} disabled={loading} onClick={() => show()}>
        {loading ? '解析中…' : current ? `已选 ${current.length} 个文件` : '选择文件'}
      </PillButton>
      <Modal
        open={open}
        title="选择要下载的文件"
        onCancel={() => setOpen(false)}
        onOk={confirm}
        okText="确定"
        width={560}
        destroyOnHidden
      >
        <div className="mb-3 truncate text-sm text-ink-3">{preview?.data.name}</div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <PillButton onClick={() => setChecked(files.map((f) => f.index))}>全选</PillButton>
          <PillButton onClick={() => setChecked(videoIndexes(files))}>仅视频</PillButton>
          <PillButton onClick={() => setChecked([])}>清空</PillButton>
        </div>
        <div className="neu-inset rounded-3xl p-2">
          <Tree<SubFileNode>
            checkable
            selectable={false}
            defaultExpandAll
            height={380}
            treeData={tree}
            fieldNames={{ key: 'key', title: 'name', children: 'children' }}
            checkedKeys={checked.map(String)}
            onCheck={(keys) => setChecked(indexesFromKeys(Array.isArray(keys) ? keys : keys.checked))}
            titleRender={(node) => (
              <span className="flex min-w-0 items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{node.name}</span>
                <span className="shrink-0 text-xs text-ink-3">{formatBytes(node.size)}</span>
              </span>
            )}
            className="!bg-transparent"
          />
        </div>
        <div className="mt-3 text-xs text-ink-3">
          已选 {checked.length} / {files.length} 个文件 · {formatBytes(selectedSize)}
        </div>
      </Modal>
    </>
  )
}
