import { describe, expect, it } from 'vitest'
import { ApiError, errorMessage, isAuthError, parseError } from './errors'

describe('api errors', () => {
  it('keeps backend codes and Chinese messages', async () => {
    const response = new Response(JSON.stringify({ error: { code: 'auth_required', message: '尚未登录' } }), { status: 401 })
    const error = await parseError(response)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.code).toBe('auth_required')
    expect(errorMessage(error)).toBe('尚未登录')
    expect(isAuthError(error)).toBe(true)
  })

  it('explains gateway failures when the backend is down', async () => {
    const error = await parseError(new Response('bad gateway', { status: 502 }))
    expect(error.code).toBe('backend_unreachable')
  })
})
