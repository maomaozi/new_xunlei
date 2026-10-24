import { Moon, Sun, SunMoon } from 'lucide-react'
import { useAppSettings } from '../lib/settingsContext'

/** Cycles the theme setting auto → light → dark. */
export function useThemeCycle() {
  const { settings, update } = useAppSettings()
  const mode = settings?.ui.theme ?? 'auto'
  const next = mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto'
  return {
    Icon: mode === 'auto' ? SunMoon : mode === 'light' ? Sun : Moon,
    label: { auto: '跟随系统', light: '浅色', dark: '深色' }[mode],
    cycle: () => void update('ui', { theme: next }),
  }
}
