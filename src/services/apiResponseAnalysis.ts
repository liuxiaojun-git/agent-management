// API 测试的 AI 响应分析：一次性请求，不创建 AI 会话。
import { V1_BASE } from '../utils/apiBase'

export type ApiResponseAnalysisMode = 'explain' | 'troubleshoot' | 'tests'

export type ApiAnalysisRequestContext = {
  method: string
  url: string
  headers: Array<{ key: string; value: string; enabled: boolean }>
  authType: string
  body: string
}

export type ApiAnalysisResponseContext = {
  status: number
  statusText: string
  time: string
  size: string
  headers: Record<string, string>
  body: string
}

export type ApiResponseAnalysisInput = {
  mode: ApiResponseAnalysisMode
  model?: string
  request: ApiAnalysisRequestContext
  response: ApiAnalysisResponseContext
}

export type ApiResponseAnalysisResult = {
  content: string
  model: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

const MAX_REQUEST_BODY = 40000
const MAX_RESPONSE_BODY = 80000

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('access_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function analyzeApiResponse(
  input: ApiResponseAnalysisInput,
  signal?: AbortSignal,
): Promise<ApiResponseAnalysisResult> {
  // 前端先截断，避免把几 MB 的响应体塞进请求；后端还会做一次更严格的白名单裁剪和脱敏。
  const payload = {
    ...input,
    request: { ...input.request, body: input.request.body.slice(0, MAX_REQUEST_BODY) },
    response: { ...input.response, body: input.response.body.slice(0, MAX_RESPONSE_BODY) },
  }

  const response = await fetch(`${V1_BASE}/api-tests/ai/analyze-response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
    signal,
  })
  const body = await response.json().catch(() => ({})) as {
    code?: number | string
    message?: string
    data?: ApiResponseAnalysisResult
  }
  if (response.status === 401) {
    localStorage.removeItem('access_token')
    localStorage.removeItem('user')
    if (window.location.pathname !== '/login') window.location.assign('/login')
    throw new Error('登录已过期，请重新登录')
  }
  if (!response.ok || body.code !== 0 || !body.data) {
    throw new Error(body.message || `AI 分析失败（${response.status}）`)
  }
  return body.data
}
