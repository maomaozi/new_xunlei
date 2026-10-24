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

/** Engine downloads of one filter; polls at the engine setting while something is active. */
export function useDownloads(filter: DownloadFilter, enabled = true) {
  const { settings } = useAppSettings()
  const fast = (settings?.engine.task_poll_seconds ?? 2) * 1000
  return useQuery({
    queryKey: ['downloads', filter],
    queryFn: () => downloadsApi.list(filter),
    enabled,
    refetchInterval: (query) => (query.state.data?.summary.active ? fast : 10000),
    staleTime: 0,
  })
}
