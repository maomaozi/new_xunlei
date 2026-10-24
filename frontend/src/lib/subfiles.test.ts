import { describe, expect, it } from 'vitest'
import { buildSubFileTree, indexesFromKeys, videoIndexes } from './subfiles'

const files = [
  { index: 0, path: 'a.srt', size: 1 },
  { index: 1, path: 'season/e1.mkv', size: 10 },
  { index: 2, path: 'season/extras/poster.jpg', size: 3 },
]

describe('sub-file tree', () => {
  it('nests folders, sums sizes and keys leaves by BT index', () => {
    const tree = buildSubFileTree(files)
    expect(tree.map((n) => n.key)).toEqual(['0', 'd:season'])
    const season = tree[1]
    expect(season.size).toBe(13)
    expect(season.children?.map((n) => n.key)).toEqual(['1', 'd:season/extras'])
    expect(season.children?.[1].children?.[0]).toMatchObject({ key: '2', name: 'poster.jpg', index: 2 })
  })

  it('maps checked keys back to sorted indexes and picks videos', () => {
    expect(indexesFromKeys(['d:season', '2', '1', 'd:season/extras'])).toEqual([1, 2])
    expect(videoIndexes(files)).toEqual([1])
  })
})
