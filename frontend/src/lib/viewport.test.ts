import { describe, expect, it } from 'vitest'
import { phoneInDesktopMode } from './viewport'

describe('phoneInDesktopMode', () => {
  it('flags a touch phone laid out at desktop width', () => {
    expect(phoneInDesktopMode({ touchPoints: 5, screenWidth: 393, screenHeight: 852, viewportWidth: 980 })).toBe(true)
  })

  it('ignores normal phones, tablets and desktops', () => {
    expect(phoneInDesktopMode({ touchPoints: 5, screenWidth: 393, screenHeight: 852, viewportWidth: 393 })).toBe(false)
    expect(phoneInDesktopMode({ touchPoints: 5, screenWidth: 1024, screenHeight: 1366, viewportWidth: 1024 })).toBe(false)
    expect(phoneInDesktopMode({ touchPoints: 0, screenWidth: 1440, screenHeight: 900, viewportWidth: 1440 })).toBe(false)
  })
})
