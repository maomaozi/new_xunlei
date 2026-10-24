import { describe, expect, it } from 'vitest'
import { phoneZoomedOut } from './viewport'

describe('phoneZoomedOut', () => {
  it('flags a touch phone laid out wider than its screen', () => {
    expect(phoneZoomedOut({ touchPoints: 5, screenWidth: 393, screenHeight: 852, viewportWidth: 786, viewportHeight: 1700 })).toBe(true)
    expect(phoneZoomedOut({ touchPoints: 5, screenWidth: 393, screenHeight: 852, viewportWidth: 980, viewportHeight: 2100 })).toBe(true)
  })

  it('ignores normal phones (either orientation), tablets and desktops', () => {
    expect(phoneZoomedOut({ touchPoints: 5, screenWidth: 393, screenHeight: 852, viewportWidth: 393, viewportHeight: 760 })).toBe(false)
    expect(phoneZoomedOut({ touchPoints: 5, screenWidth: 393, screenHeight: 852, viewportWidth: 852, viewportHeight: 360 })).toBe(false)
    expect(phoneZoomedOut({ touchPoints: 5, screenWidth: 1024, screenHeight: 1366, viewportWidth: 1024, viewportHeight: 1300 })).toBe(false)
    expect(phoneZoomedOut({ touchPoints: 0, screenWidth: 1440, screenHeight: 900, viewportWidth: 1440, viewportHeight: 800 })).toBe(false)
  })
})
