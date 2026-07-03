const defaultApiUrl = '/api/data'
export const API_URL = import.meta.env.VITE_API_URL || defaultApiUrl

export interface ApiDataResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

async function fetchApi(url: string, action: 'get' | 'set', name: string, data?: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, name, data }),
  })
}

export async function apiRequest<T = unknown>(action: 'get' | 'set', name: string, data?: unknown): Promise<ApiDataResponse<T>> {
  try {
    const res = await fetchApi(API_URL, action, name, data)
    return (await res.json()) as ApiDataResponse<T>
  } catch {
    if (import.meta.env.VITE_API_URL) {
      try {
        const res = await fetchApi(defaultApiUrl, action, name, data)
        return (await res.json()) as ApiDataResponse<T>
      } catch {
        return { success: false, error: 'network error' }
      }
    }
    return { success: false, error: 'network error' }
  }
}
