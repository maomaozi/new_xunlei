import { TreeSelect } from 'antd'
import { useEffect, useState } from 'react'
import { engineApi, type EngineFolder } from '../lib/api'

interface Node {
  id: string
  pId: string
  value: string
  title: string
  isLeaf: boolean
}

const toNode = (folder: EngineFolder, parent: string): Node => ({
  id: folder.id,
  pId: parent,
  value: folder.id,
  title: parent ? folder.name : `${folder.name}（${folder.path}）`,
  isLeaf: false,
})

/** Target folder of an engine download: a download root or one of its sub-folders. */
export default function EngineFolderSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (disabled) return
    let cancelled = false
    engineApi
      .folders()
      .then(({ folders }) => !cancelled && setNodes(folders.map((f) => toNode(f, ''))))
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [disabled])

  const loadData = async (node: { value?: unknown }) => {
    const id = typeof node.value === 'string' ? node.value : ''
    if (!id) return
    const { folders } = await engineApi.folders(id)
    setNodes((current) => [
      ...current.map((node) => (node.id === id && !folders.length ? { ...node, isLeaf: true } : node)),
      ...folders.filter((f) => !current.some((n) => n.id === f.id)).map((f) => toNode(f, id)),
    ])
  }

  return (
    <TreeSelect
      treeDataSimpleMode
      treeData={nodes}
      loadData={loadData}
      value={value || undefined}
      onChange={(id: string | undefined) => onChange(id ?? '')}
      placeholder={failed ? '无法读取引擎目录，将使用默认下载目录' : '默认下载目录'}
      allowClear
      disabled={disabled}
      className="w-full"
      popupMatchSelectWidth={false}
    />
  )
}
