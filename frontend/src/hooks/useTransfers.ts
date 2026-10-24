import { useQuery } from '@tanstack/react-query'
import { transfersApi, type TransferKind } from '../lib/api'
import { useAppSettings } from '../lib/settingsContext'

export function useTransfers(kind?: TransferKind) {
  const { settings } = useAppSettings()
  const fast = settings?.ui.transfer_poll_ms ?? 1000
  return useQuery({
    queryKey: ['transfers', kind ?? 'all'],
    queryFn: () => transfersApi.list(kind),
    refetchInterval: (query) => {
      const summary = query.state.data?.summary
      return summary && (summary.running > 0 || summary.queued > 0) ? fast : 5000
    },
    staleTime: 0,
  })
}
