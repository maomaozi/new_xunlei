import { describe, expect, it } from 'vitest'
import type { DriveFile } from './api'
import { fileType, playable } from './files'

const file = (name: string, mime = '', kind = 'drive#file') => ({ name, mime_type: mime, kind }) as DriveFile

describe('file types', () => {
  it('detects types by extension, then mime type', () => {
    expect(fileType(file('a.MKV'))).toBe('video')
    expect(fileType(file('x', 'image/png'))).toBe('image')
    expect(fileType(file('dir', '', 'drive#folder'))).toBe('folder')
    expect(fileType(file('seed.torrent'))).toBe('torrent')
  })

  it('only offers in-browser playback for common containers', () => {
    expect(playable(file('movie.mp4'))).toBe('video')
    expect(playable(file('movie.mkv'))).toBeNull()
    expect(playable(file('song.flac'))).toBe('audio')
  })
})
