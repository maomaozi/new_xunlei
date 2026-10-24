export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const FALLBACK = '请求失败，请稍后重试。'

export async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } }
    if (body.error?.message) {
      return new ApiError(response.status, body.error.code ?? 'http_error', body.error.message)
    }
  } catch {
    // Non-JSON error bodies (proxies, gateway timeouts) fall through to the generic message.
  }
  if (response.status === 502 || response.status === 504) {
    return new ApiError(response.status, 'backend_unreachable', '后端服务不可用，请确认 API 已启动。')
  }
  return new ApiError(response.status, 'http_error', FALLBACK)
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof TypeError) return '网络连接失败，请检查后端服务是否运行。'
  if (error instanceof Error && error.message) return error.message
  return FALLBACK
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'auth_required' || error.code === 'auth_failed')
}
