/**
 * Phones get a viewport pinned to the physical screen width. With `width=device-width` some
 * browsers lay the page out wider than the screen (iOS Safari page zoom, desktop-website
 * mode), which renders everything shrunk; an explicit width is always scaled to fit.
 */
export function phoneLayoutWidth(env: { touchPoints: number; screenWidth: number; screenHeight: number; landscape: boolean }): number | null {
  const shortSide = Math.min(env.screenWidth, env.screenHeight)
  const longSide = Math.max(env.screenWidth, env.screenHeight)
  if (env.touchPoints <= 0 || shortSide <= 0 || shortSide >= 600) return null
  // iOS reports the portrait screen size in both orientations.
  return Math.round(env.landscape ? longSide : shortSide)
}

/** Pins the phone viewport (re-applied on rotation) and disables pinch / double-tap zoom. */
export function setupPhoneViewport() {
  const meta = document.querySelector('meta[name="viewport"]')
  const landscape = window.matchMedia('(orientation: landscape)')
  const apply = () => {
    const width = phoneLayoutWidth({
      touchPoints: navigator.maxTouchPoints ?? 0,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      landscape: landscape.matches,
    })
    if (width !== null) meta?.setAttribute('content', `width=${width}, viewport-fit=cover, user-scalable=no`)
  }
  apply()
  landscape.addEventListener('change', apply)

  if ((navigator.maxTouchPoints ?? 0) <= 0) return
  // iOS ignores user-scalable=no, so cancel the pinch gestures themselves.
  const block = (event: Event) => event.preventDefault()
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, block, { passive: false })
  document.addEventListener('touchmove', (event) => event.touches.length > 1 && event.preventDefault(), { passive: false })
}
