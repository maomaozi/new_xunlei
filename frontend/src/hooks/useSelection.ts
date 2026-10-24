import { useState } from 'react'

/** Multi-selection of list items by id. */
export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  return {
    selected,
    setSelected,
    selecting: selected.size > 0,
    has: (id: string) => selected.has(id),
    toggle: (id: string) =>
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    clear: () => setSelected(new Set()),
    selectAll: (ids: string[]) => setSelected(new Set(ids)),
  }
}
