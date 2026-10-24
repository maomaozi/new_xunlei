import { useRef } from 'react'

/** Long-press (touch) handler, used to enter selection mode like native file managers. */
export function useLongPress(onLongPress: () => void, delay = 450) {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
  }
  return {
    fired,
    handlers: {
      onTouchStart: () => {
        fired.current = false
        timer.current = window.setTimeout(() => {
          fired.current = true
          navigator.vibrate?.(12)
          onLongPress()
        }, delay)
      },
      onTouchEnd: clear,
      onTouchMove: clear,
      onTouchCancel: clear,
    },
  }
}
