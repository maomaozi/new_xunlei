import { useQuery } from '@tanstack/react-query'
import { accountApi } from '../lib/api'

export function useAccountOverview() {
  const status = useAccountStatus()
  return useQuery({
    queryKey: ['account', 'overview', status.data?.user_id, status.data?.logged_in],
    queryFn: accountApi.overview,
    enabled: status.isSuccess,
    staleTime: 120_000,
  })
}

export function useAccountStatus() {
  return useQuery({ queryKey: ['account', 'status'], queryFn: accountApi.status, staleTime: 5_000, refetchInterval: 10_000 })
}
