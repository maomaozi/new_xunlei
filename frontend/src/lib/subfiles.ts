import type { ResourcePreview, SubFile } from './api'
import { fileType } from './files'

/** The link or torrent whose sub-files can be picked; `key` identifies the current input. */
export interface SubFileTarget {
  key: string
  load: () => Promise<ResourcePreview>
}

export interface SubFileSelection {
  key: string
  indexes: number[]
}

/** Selected indexes for `target`, or undefined to download everything. */
export function selectedIndexes(target: SubFileTarget | null, value: SubFileSelection | null): number[] | undefined {
  return target && value?.key === target.key ? value.indexes : undefined
}

export interface SubFileNode {
  key: string
  name: string
  size: number
  /** BT index for files, undefined for folders. */
  index?: number
  children?: SubFileNode[]
}

/** Build a folder tree from flat torrent paths; leaf keys are the BT indexes. */
export function buildSubFileTree(files: SubFile[]): SubFileNode[] {
  const root: SubFileNode = { key: '', name: '', size: 0, children: [] }
  const folders = new Map<string, SubFileNode>([['', root]])
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    const name = parts.pop() ?? file.path
    let parent = root
    let path = ''
    for (const part of parts) {
      path = path ? `${path}/${part}` : part
      let folder = folders.get(path)
      if (!folder) {
        folder = { key: `d:${path}`, name: part, size: 0, children: [] }
        folders.set(path, folder)
        parent.children!.push(folder)
      }
      folder.size += file.size
      parent = folder
    }
    parent.children!.push({ key: String(file.index), name, size: file.size, index: file.index })
  }
  return root.children!
}

/** Leaf keys are numeric strings; folder keys are prefixed with `d:`. */
export function indexesFromKeys(keys: readonly (string | number | bigint)[]): number[] {
  return keys
    .map(String)
    .filter((key) => !key.startsWith('d:'))
    .map(Number)
    .sort((a, b) => a - b)
}

export function videoIndexes(files: SubFile[]): number[] {
  return files.filter((f) => fileType({ kind: 'drive#file', name: f.path, mime_type: '' }) === 'video').map((f) => f.index)
}
