import { useQuery } from '@tanstack/react-query'
import { downloadsApi, engineApi, type DownloadFilter, type LiveDownloads, type EngineSettings } from '../lib/api'
import { filterDownloads, latestDownloadSnapshot } from '../lib/downloads'
import { useAppSettings } from '../lib/settingsContext'

export function useEngineStatus(live = false) {
  return useQuery({
    queryKey: ['engine'], queryFn: engineApi.status,
    refetchInterval: (query) => (query.state.data?.state === 'starting' ? 1500 : live ? 3000 : 10000),
  })
}

export function useEngineCapabilities(platform?: EngineSettings['platform']) {
  const { settings } = useAppSettings()
  const selected = platform ?? settings?.engine.platform
  return useQuery({
    queryKey: ['engine-capabilities', selected],
    queryFn: () => engineApi.capabilities(selected),
    enabled: Boolean(selected), retry: false, refetchInterval: 5000,
  })
}

/** Every screen observes one snapshot; filtering never starts another cloud poll. */
function useDownloadSnapshot(enabled: boolean) {
  const { settings } = useAppSettings()
  const fast = settings?.engine.live_progress === false
    ? (settings.engine.task_poll_seconds ?? 10) * 1000 : (settings?.engine.live_poll_ms ?? 1000)
  return useQuery({
    queryKey: ['downloads'], queryFn: () => downloadsApi.list('all'), enabled,
    retry: false, structuralSharing: latestDownloadSnapshot,
    refetchInterval: (query) => query.state.error ? Math.max(fast, 10000) : fast,
    staleTime: 300,
  })
}

export function useDownloads(filter: DownloadFilter, enabled = true) {
  const query = useDownloadSnapshot(enabled)
  return { ...query, data: filterDownloads(query.data, filter) }
}

/** Compatibility shape for navigation and overview; shares the same query and version. */
export function useLiveDownloads(enabled = true) {
  const query = useDownloadSnapshot(enabled)
  const snapshot = query.data
  const data: LiveDownloads | undefined = snapshot && {
    tasks: snapshot.tasks.map((task) => ({ ...task, running: task.status === 'running' })),
    running: snapshot.tasks.filter((task) => task.status === 'running').length,
    speed: snapshot.summary.speed, version: snapshot.version, epoch: snapshot.epoch,
    observed_at: snapshot.observed_at, stale: snapshot.stale,
    downloads: snapshot.tasks, source_errors: snapshot.source_errors,
  }
  return { ...query, data }
}
