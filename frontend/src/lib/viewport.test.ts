import { describe, expect, it } from 'vitest'
import { phoneLayoutWidth } from './viewport'

describe('phoneLayoutWidth', () => {
  it('pins phones to the screen width of the current orientation', () => {
    expect(phoneLayoutWidth({ touchPoints: 5, screenWidth: 393, screenHeight: 852, landscape: false })).toBe(393)
    expect(phoneLayoutWidth({ touchPoints: 5, screenWidth: 393, screenHeight: 852, landscape: true })).toBe(852)
  })

  it('leaves tablets and desktops on device-width', () => {
    expect(phoneLayoutWidth({ touchPoints: 5, screenWidth: 820, screenHeight: 1180, landscape: false })).toBeNull()
    expect(phoneLayoutWidth({ touchPoints: 0, screenWidth: 390, screenHeight: 844, landscape: false })).toBeNull()
  })
})
