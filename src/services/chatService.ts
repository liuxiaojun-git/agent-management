// AI 会话/消息的服务层（批次 F：迁到 v1 的 /conversations、/models、/files 端点）。
// base URL 已收敛到 utils/apiBase.ts 的 V1_BASE（绝对地址 //host:3000/api/v1，prod 下 nginx 无 /api 转发，
// 相对路径会拿到 200+index.html 的假成功 —— 见 apiBase.ts 顶部注释）。
import { V1_BASE } from '../utils/apiBase'

export type ChatRole = 'user' | 'assistant'

type BackendModel = {
  id: string
  name: string
  enabled: boolean
}

export type ChatFile = {
  id: string
  name: string
  size: number
  type: string
  status?: 'uploading' | 'parsed' | 'failed'
}

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  createdAt: string
  files?: ChatFile[]
  status?: 'streaming' | 'completed' | 'stopped' | 'failed'
  model?: string
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  sources?: Array<{ title?: string; url?: string; snippet?: string }>
}

export type ChatConversation = {
  id: string
  backendId?: string
  title: string
  updatedAt: string
  messages: ChatMessage[]
}

export type ChatModel = {
  id: string
  name: string
  provider: string
  enabled: boolean
}

export const CHAT_SESSIONS_KEY = 'zhiyu-chat-sessions-v1'
export const CHAT_MODEL_KEY = 'zhiyu-chat-model-v1'
let modelsRequest: Promise<ChatModel[]> | null = null
let conversationsRequest: Promise<ChatConversation[]> | null = null

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('access_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// 401 清态跳登录。加防重入守卫：并发多个 401 只跳一次，且已在登录页不再 assign。
let redirectingToLogin = false
function handleUnauthorized() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('user')
  if (redirectingToLogin || window.location.pathname === '/login') return
  redirectingToLogin = true
  window.location.assign('/login')
}

const slug = (value: string) => value.toString().trim().slice(0, 18) || '新对话'

export function createConversationId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createConversation(title = '新对话'): ChatConversation {
  const now = new Date().toISOString()
  return {
    id: createConversationId(),
    title,
    updatedAt: now,
    messages: [],
  }
}

export function buildTitleFromPrompt(text: string) {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned ? slug(cleaned) : '新对话'
}

export function getStoredConversations(): ChatConversation[] {
  try {
    const raw = localStorage.getItem(CHAT_SESSIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatConversation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveStoredConversations(conversations: ChatConversation[]) {
  localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(conversations))
}

export async function getModels(): Promise<ChatModel[]> {
  if (modelsRequest) return modelsRequest

  modelsRequest = (async () => {
    try {
      const response = await fetch(`${V1_BASE}/models`, { headers: authHeaders() })
      const payload = await response.json().catch(() => ({})) as { code?: number | string; data?: BackendModel[]; message?: string }
      if (response.status === 401) handleUnauthorized()
      if (!response.ok || payload.code !== 0) throw new Error(payload.message || `模型列表请求失败（${response.status}）`)
      return (payload.data || []).filter((model) => model.enabled).map((model) => ({
        id: model.id,
        name: model.id,
        provider: model.name,
        enabled: model.enabled,
      }))
    } catch (error) {
      console.error('[ai-chat] load models failed', error)
      throw error
    }
  })()

  try {
    return await modelsRequest
  } finally {
    modelsRequest = null
  }
}

// v1 信封 → data。非 2xx 或 code !== 0 一律抛错（带 message），401 额外清态跳登录。
async function readBackend<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${V1_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
  })
  const payload = await response.json().catch(() => ({})) as { code?: number | string; data?: T; message?: string }
  if (response.status === 401) handleUnauthorized()
  if (!response.ok || payload.code !== 0) throw new Error(payload.message || `请求失败（${response.status}）`)
  return payload.data as T
}

export async function getBackendConversations(): Promise<ChatConversation[]> {
  if (conversationsRequest) return conversationsRequest

  conversationsRequest = (async () => {
    // v1 分页参数是 pageSize（不是旧路径的 page_size）；时间字段已是 camelCase（updatedAt）。
    const result = await readBackend<{ items: Array<{ id: string; title: string; model?: string; updatedAt: string }> }>('/conversations?page=1&pageSize=100')
    return result.items.map((item) => ({
      id: item.id,
      backendId: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
      messages: [],
    }))
  })()

  try {
    return await conversationsRequest
  } finally {
    conversationsRequest = null
  }
}

export async function getBackendMessages(conversationId: string): Promise<ChatMessage[]> {
  // v1 消息是分页的 pagedResult（.items），且**不含 usage/tokens**（§5.3 精简了字段），
  // 所以这里不再拼 usage，调用方对 undefined usage 本就做了「不显示」的处理。
  const result = await readBackend<{ items: Array<{ id: string; role: ChatRole; content: string; model?: string | null; status?: ChatMessage['status']; createdAt: string }> }>(`/conversations/${encodeURIComponent(conversationId)}/messages?page=1&pageSize=1000`)
  return result.items.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    model: message.model ?? undefined,
    status: message.status,
    createdAt: message.createdAt,
  }))
}

export async function createBackendConversation(title: string, model: string): Promise<string> {
  // v1 POST /conversations 回 {data:{conversation:{id,...}}}，id 在 data.conversation 里。
  const result = await readBackend<{ conversation: { id: string } }>('/conversations', {
    method: 'POST',
    body: JSON.stringify({ title, model }),
  })
  return result.conversation.id
}

export async function deleteBackendConversation(conversationId: string) {
  await readBackend<null>(`/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
}

export async function uploadChatFile(file: File): Promise<ChatFile> {
  // v1 走 multipart（字段名 file），不再 base64 JSON。Content-Type 交给浏览器填 multipart 边界。
  const form = new FormData()
  form.append('file', file)
  const token = localStorage.getItem('access_token')
  const response = await fetch(`${V1_BASE}/files`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  const payload = await response.json().catch(() => ({})) as { code?: number | string; message?: string; data?: { id: string; filename: string; size: number; type: string; status: 'parsed' | 'failed' } }
  if (response.status === 401) handleUnauthorized()
  if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.message || `文件上传失败（${response.status}）`)
  return { id: payload.data.id, name: payload.data.filename, size: payload.data.size, type: payload.data.type, status: payload.data.status }
}

export type ChatStreamCallbacks = {
  onStart?: (messageId: string) => void
  onDelta?: (content: string) => void
  onDone?: (data: { messageId?: string; usage?: ChatMessage['usage']; sources?: ChatMessage['sources']; stopped?: boolean }) => void
}

export async function streamChat(conversationId: string, message: string, model: string, files: string[], webSearch: boolean, signal: AbortSignal, callbacks: ChatStreamCallbacks = {}) {
  const response = await fetch(`${V1_BASE}/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ message, model, files, web_search: webSearch }),
    signal,
  })
  if (!response.ok || !response.body) {
    if (response.status === 401) handleUnauthorized()
    const payload = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(payload.message || `模型请求失败（${response.status}）`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const consume = (eventText: string) => {
    // v1 的 SSE 帧：`id: N` 行 + `event: ...` 行 + `data: {...}` 行；`id:` 与注释帧（`: ping`）
    // 都不带 event/data，被下面这行判定静默跳过。
    const eventName = eventText.match(/^event:\s*(.+)$/m)?.[1]
    const dataText = eventText.match(/^data:\s*(.+)$/m)?.[1]
    if (!eventName || !dataText) return
    const data = JSON.parse(dataText) as { messageId?: string; content?: string; usage?: ChatMessage['usage']; sources?: ChatMessage['sources']; stopped?: boolean; message?: string }
    if (eventName === 'message_start' && data.messageId) callbacks.onStart?.(data.messageId)
    if (eventName === 'message_delta' && data.content) callbacks.onDelta?.(data.content)
    if (eventName === 'message_end') callbacks.onDone?.({ messageId: data.messageId, usage: data.usage, sources: data.sources, stopped: data.stopped ?? false })
    if (eventName === 'message_cancelled') callbacks.onDone?.({ messageId: data.messageId, usage: data.usage, stopped: true })
    if (eventName === 'message_error') throw new Error(data.message || 'AI 服务异常')
  }
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() || ''
    events.forEach(consume)
    if (done) break
  }
  if (buffer.trim()) consume(buffer)
}

// v1 的中止端点把 conversationId 放进 URL 路径（归属校验靠它），不再是旧的 /chat/{messageId}/stop。
export async function stopChat(conversationId: string, messageId: string) {
  return readBackend<{ id: string; stopped: boolean }>(`/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/stop`, { method: 'POST' })
}

export function saveSelectedModel(modelId: string) {
  localStorage.setItem(CHAT_MODEL_KEY, JSON.stringify({ selectedModelId: modelId }))
}
