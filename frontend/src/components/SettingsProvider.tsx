import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { settingsApi, type AppSettings, type SettingsSection } from '../lib/api'
import { SettingsContext } from '../lib/settingsContext'
import { useMediaQuery } from '../hooks/useMediaQuery'

function writeCache(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode / disabled storage: the theme is still applied for this session.
  }
}

export default function SettingsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get, staleTime: 60_000 })
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)')
  const mode = data?.ui.theme ?? 'auto'
  const resolvedTheme: 'light' | 'dark' = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolvedTheme
    writeCache('xl-theme', mode)
    if (data) {
      root.style.setProperty('--accent', data.ui.accent)
      root.dataset.motion = data.ui.animations ? 'on' : 'off'
      root.dataset.density = data.ui.density
      writeCache('xl-accent', data.ui.accent)
    }
    const meta = document.querySelectorAll('meta[name="theme-color"]')
    meta.forEach((node) => node.setAttribute('content', resolvedTheme === 'dark' ? '#22252b' : '#e7ebf1'))
  }, [resolvedTheme, mode, data])

  const mutation = useMutation({
    mutationFn: settingsApi.save,
    onSuccess: (saved) => queryClient.setQueryData(['settings'], saved),
  })

  const replace = useCallback((next: AppSettings) => mutation.mutateAsync(next), [mutation])

  const update = useCallback(
    <S extends SettingsSection>(section: S, patch: Partial<AppSettings[S]>) => {
      const current = queryClient.getQueryData<AppSettings>(['settings'])
      if (!current) return Promise.reject(new Error('设置尚未加载完成。'))
      const next = { ...current, [section]: { ...current[section], ...patch } }
      queryClient.setQueryData(['settings'], next)
      return mutation.mutateAsync(next).catch((error: unknown) => {
        queryClient.setQueryData(['settings'], current)
        throw error
      })
    },
    [mutation, queryClient],
  )

  const value = useMemo(
    () => ({ settings: data ?? null, loading: isLoading, resolvedTheme, update, replace }),
    [data, isLoading, resolvedTheme, update, replace],
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
