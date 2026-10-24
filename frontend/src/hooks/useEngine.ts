import { useQuery } from '@tanstack/react-query'
import { downloadsApi, engineApi, type DownloadFilter } from '../lib/api'
import { useAppSettings } from '../lib/settingsContext'

/** Engine process/login state; polls faster while the engine is starting or `live` is set. */
export function useEngineStatus(live = false) {
  return useQuery({
    queryKey: ['engine'],
    queryFn: engineApi.status,
    refetchInterval: (query) => (query.state.data?.state === 'starting' ? 1500 : live ? 3000 : 10000),
  })
}

/**
 * Cloud task list of one filter. Live progress comes from `useLiveDownloads`, so this only
 * needs to catch state changes and runs at the slower cloud interval.
 */
export function useDownloads(filter: DownloadFilter, enabled = true) {
  const { settings } = useAppSettings()
  const active = (settings?.engine.task_poll_seconds ?? 10) * 1000
  return useQuery({
    queryKey: ['downloads', filter],
    queryFn: () => downloadsApi.list(filter),
    enabled,
    refetchInterval: (query) => (query.state.data?.summary.active ? active : Math.max(active, 30000)),
    staleTime: 0,
  })
}

/** Per-second progress/speed straight from the engine's memory (local, no cloud round-trip). */
export function useLiveDownloads(enabled = true) {
  const { settings } = useAppSettings()
  const on = enabled && (settings?.engine.live_progress ?? true)
  const fast = settings?.engine.live_poll_ms ?? 1000
  return useQuery({
    queryKey: ['downloads-live'],
    queryFn: downloadsApi.live,
    enabled: on,
    retry: false,
    // Keep polling while idle (cheap and local) so new tasks show up quickly.
    refetchInterval: (query) => (query.state.error ? 10000 : query.state.data?.tasks.length ? fast : Math.max(fast, 3000)),
    staleTime: 0,
  })
}
