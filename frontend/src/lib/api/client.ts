import { ApiError, parseError } from './errors'

type Query = Record<string, string | number | boolean | null | undefined>

export function buildUrl(path: string, query?: Query): string {
  const url = `/api/v1${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `${url}?${text}` : url
}

async function request<T>(method: string, path: string, init: { query?: Query; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  let body: BodyInit | undefined
  if (init.form) {
    body = init.form
  } else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(init.body)
  }
  const response = await fetch(buildUrl(path, init.query), { method, headers, body })
  if (!response.ok) throw await parseError(response)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const http = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>('POST', path, { body, query }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  form: <T>(path: string, form: FormData) => request<T>('POST', path, { form }),
}

export interface UploadProgress {
  loaded: number
  total: number
}

/** Streams a browser file to the backend upload endpoint with progress events. */
export function streamUpload<T>(
  path: string,
  query: Query,
  file: Blob,
  onProgress: (progress: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', buildUrl(path, query))
    xhr.setRequestHeader('Content-Type', 'application/octet-stream')
    xhr.upload.onprogress = (event) => onProgress({ loaded: event.loaded, total: event.total || file.size })
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as T)
        return
      }
      void parseError(new Response(xhr.responseText, { status: xhr.status })).then(reject)
    }
    xhr.onerror = () => reject(new ApiError(0, 'network_error', '上传连接中断，请检查网络后重试。'))
    xhr.onabort = () => reject(new ApiError(0, 'aborted', '上传已取消。'))
    signal?.addEventListener('abort', () => xhr.abort())
    xhr.send(file)
  })
}
