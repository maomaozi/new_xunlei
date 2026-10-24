import { describe, expect, it } from 'vitest'
import type { DownloadTask } from './api'
import { primaryAction } from './downloadActions'

const task = (status: DownloadTask['status']) => ({ status }) as DownloadTask

describe('primaryAction', () => {
  it('offers the one state change that fits each status', () => {
    expect(primaryAction(task('running'))?.action).toBe('pause')
    expect(primaryAction(task('queued'))?.action).toBe('pause')
    expect(primaryAction(task('paused'))?.action).toBe('resume')
    expect(primaryAction(task('error'))?.action).toBe('retry')
    expect(primaryAction(task('complete'))).toBeNull()
  })
})
