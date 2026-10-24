import { useEffect, useRef } from 'react'
import { useAppSettings } from '../lib/settingsContext'

const VOLUME_KEY = 'xl-volume'

export default function MediaPlayer({ src, kind }: { src: string; kind: 'video' | 'audio' }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const { settings } = useAppSettings()
  const remember = settings?.player.remember_volume ?? true

  useEffect(() => {
    const element = ref.current
    if (!element || !remember) return
    try {
      const saved = Number(localStorage.getItem(VOLUME_KEY))
      if (saved >= 0 && saved <= 1 && localStorage.getItem(VOLUME_KEY) !== null) element.volume = saved
    } catch {
      // Volume memory is optional.
    }
    const onVolume = () => {
      try {
        localStorage.setItem(VOLUME_KEY, String(element.volume))
      } catch {
        // Ignore storage failures.
      }
    }
    element.addEventListener('volumechange', onVolume)
    return () => element.removeEventListener('volumechange', onVolume)
  }, [remember, src])

  if (kind === 'audio') {
    return <audio ref={ref} src={src} controls autoPlay={settings?.player.autoplay} className="w-full" />
  }
  return (
    <video
      ref={ref}
      src={src}
      controls
      playsInline
      autoPlay={settings?.player.autoplay}
      className="aspect-video w-full rounded-2xl bg-black"
    />
  )
}
