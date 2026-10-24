/**
 * A touch phone laid out wider than its screen is browsing with "Request Desktop Website"
 * on: the browser then ignores the viewport meta tag, so the app can only show the desktop
 * layout and suggest switching the mode off.
 */
export function phoneInDesktopMode(env: { touchPoints: number; screenWidth: number; screenHeight: number; viewportWidth: number }): boolean {
  const shortSide = Math.min(env.screenWidth, env.screenHeight)
  return env.touchPoints > 0 && shortSide > 0 && shortSide < 600 && env.viewportWidth >= 768
}

export function currentPhoneInDesktopMode(): boolean {
  if (typeof window === 'undefined') return false
  return phoneInDesktopMode({
    touchPoints: navigator.maxTouchPoints ?? 0,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    viewportWidth: window.innerWidth,
  })
}
