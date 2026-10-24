import { createContext, useContext } from 'react'

/** Global "create" entry points (tab bar + button, sidebar, page shortcuts). */
export interface CreateActions {
  /** Opens the new engine download dialog. */
  download: () => void
  /** Opens the cloud add dialog. */
  offline: () => void
  /** Opens the browser file picker; uploads go to the open cloud folder or the root. */
  upload: (folder?: boolean) => void
  /** Opens the create sheet (phones) listing all of the above. */
  sheet: () => void
}

export const CreateContext = createContext<CreateActions | null>(null)

export function useCreate(): CreateActions {
  const value = useContext(CreateContext)
  if (!value) throw new Error('useCreate must be used inside AppLayout')
  return value
}
