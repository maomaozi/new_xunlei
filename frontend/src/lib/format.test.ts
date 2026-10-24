import { describe, expect, it } from 'vitest'
import { formatBytes, formatEta, percent } from './format'

describe('format', () => {
  it('formats byte sizes with binary units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(23089744183296)).toBe('21.0 TB')
  })

  it('computes eta and clamps percent', () => {
    expect(formatEta(120, 2)).toBe('1:00')
    expect(formatEta(100, 0)).toBe('--')
    expect(percent(5, 0)).toBe(0)
    expect(percent(150, 100)).toBe(100)
  })
})
