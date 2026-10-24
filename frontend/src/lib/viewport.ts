/**
 * A touch phone whose CSS viewport is clearly wider than its screen renders everything
 * scaled down: Safari page zoom below 100% or "Request Desktop Website" is on.
 */
export function phoneZoomedOut(env: {
  touchPoints: number
  screenWidth: number
  screenHeight: number
  viewportWidth: number
  viewportHeight: number
}): boolean {
  const shortSide = Math.min(env.screenWidth, env.screenHeight)
  const longSide = Math.max(env.screenWidth, env.screenHeight)
  // iOS reports the portrait screen size in both orientations.
  const screenWidth = env.viewportWidth > env.viewportHeight ? longSide : shortSide
  return env.touchPoints > 0 && shortSide > 0 && shortSide < 600 && env.viewportWidth > screenWidth * 1.15
}

export function currentPhoneZoomedOut(): boolean {
  if (typeof window === 'undefined') return false
  return phoneZoomedOut({
    touchPoints: navigator.maxTouchPoints ?? 0,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  })
}
