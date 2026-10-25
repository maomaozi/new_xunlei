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

describe('confirmed and refused operation feedback', () => {
  it('disables a primary action while pending or explicitly unavailable', () => {
    expect(primaryAction({ ...task('running'), capabilities: { pause: false, resume: false, retry: false, delete: false } })).toBeNull()
    expect(primaryAction({ ...task('paused'), operation: { action: 'resume', status: 'pending', message: '' } })).toBeNull()
  })

  it('shows partial batch completion and preserves the useful refusal message', async () => {
    const { actionFeedback } = await import('./downloadActions')
    const feedback = actionFeedback({ ok: false, version: 5, results: [
      { task_id: 'ok', action: 'pause', status: 'confirmed', message: '' },
      { task_id: 'unavailable', action: 'pause', status: 'unsupported', message: '本地任务记录不可用' },
    ] })
    expect(feedback).toEqual({ kind: 'warning', text: '1 项已完成，本地任务记录不可用' })
    expect(actionFeedback({ ok: false, version: 6, results: [
      { task_id: 'late', action: 'delete', status: 'timeout', message: '本地移除尚未确认，文件已保留。' },
    ] })).toEqual({ kind: 'error', text: '本地移除尚未确认，文件已保留。' })
  })
})
