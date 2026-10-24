import { useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/**
 * Phone layout: narrow viewports, plus small touch screens whose CSS viewport is wider than
 * the screen (page zoom below 100%, desktop-website mode). Mirrors the breakpoint variants
 * in `src/index.css`.
 */
export const PHONE_QUERY = '(max-width: 767px), (hover: none) and (pointer: coarse) and (max-device-width: 599px)'

export function useIsMobile(): boolean {
  return useMediaQuery(PHONE_QUERY)
}
