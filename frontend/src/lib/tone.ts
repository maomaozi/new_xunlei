export type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'muted' | 'violet'

export const TONE_TEXT: Record<Tone, string> = {
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-ink-3',
  violet: 'text-accent-2',
}
