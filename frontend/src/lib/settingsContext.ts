import { createContext, useContext } from 'react'
import type { AppSettings, SettingsSection } from './api'

export interface SettingsContextValue {
  settings: AppSettings | null
  loading: boolean
  resolvedTheme: 'light' | 'dark'
  update: <S extends SettingsSection>(section: S, patch: Partial<AppSettings[S]>) => Promise<AppSettings>
  replace: (settings: AppSettings) => Promise<AppSettings>
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useAppSettings(): SettingsContextValue {
  const value = useContext(SettingsContext)
  if (!value) throw new Error('useAppSettings must be used inside SettingsProvider')
  return value
}
