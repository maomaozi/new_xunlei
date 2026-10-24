import { useQuery } from '@tanstack/react-query'
import { accountApi } from '../lib/api'

export function useAccountOverview() {
  return useQuery({ queryKey: ['account', 'overview'], queryFn: accountApi.overview, staleTime: 120_000 })
}

export function useAccountStatus() {
  return useQuery({ queryKey: ['account', 'status'], queryFn: accountApi.status, staleTime: 30_000 })
}
