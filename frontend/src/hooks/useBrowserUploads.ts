import { useSyncExternalStore } from 'react'
import { uploadStore } from '../lib/uploads'

export function useBrowserUploads() {
  return useSyncExternalStore(uploadStore.subscribe, uploadStore.snapshot, uploadStore.snapshot)
}
