import type { AppSettings } from './api'

export type ExternalPlayer = AppSettings['player']['external_player']

export const PLAYERS: { value: ExternalPlayer; label: string }[] = [
  { value: 'none', label: '不使用' },
  { value: 'potplayer', label: 'PotPlayer' },
  { value: 'vlc', label: 'VLC' },
  { value: 'iina', label: 'IINA' },
  { value: 'infuse', label: 'Infuse' },
  { value: 'nplayer', label: 'nPlayer' },
  { value: 'mpv', label: 'mpv' },
]

export function externalPlayerUrl(player: ExternalPlayer, url: string): string | null {
  const encoded = encodeURIComponent(url)
  switch (player) {
    case 'potplayer':
      return `potplayer://${url}`
    case 'vlc':
      return `vlc://${url}`
    case 'iina':
      return `iina://weblink?url=${encoded}`
    case 'infuse':
      return `infuse://x-callback-url/play?url=${encoded}`
    case 'nplayer':
      return `nplayer-${url}`
    case 'mpv':
      return `mpv://${encoded}`
    default:
      return null
  }
}
