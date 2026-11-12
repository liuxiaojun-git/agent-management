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

export type PersonalPromptTemplate = {
  id: number
  title: string
  category: string
  description: string
  content: string
  favorite: boolean
  createdAt: string
  updatedAt: string
}

export type PersonalPromptTemplateInput = Omit<PersonalPromptTemplate, 'id' | 'createdAt' | 'updatedAt'>

export type TaskStatus = 'pending' | 'in_progress' | 'paused' | 'completed'
export type TaskPriority = 'low' | 'normal' | 'high'

export type PersonalTask = {
  id: number
  assignedUserId: number | null
  assignedUserName: string | null
  isAssignedToMe: boolean
  projectId: number | null
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  sourceConversationId: string | null
  sourceMessageId: string | null
  images: TaskImage[]
  createdAt: string
  updatedAt: string
}

export type TaskImage = {
  id: string
  filename: string
  type: string
  size: number
}

export type PersonalTaskInput = Pick<PersonalTask, 'title' | 'description' | 'priority' | 'dueDate'> & {
  projectId?: number | null
  assignedUserId?: number | null
  imageIds?: string[]
}
export type TaskAssignee = { id: number; username: string; nickname: string | null; name: string }
export type TaskProject = { id: number; name: string; taskCount: number; createdAt: string; updatedAt: string }

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

export async function getBackendConversation(conversationId: string): Promise<ChatConversation> {
  const result = await readBackend<{ conversation: { id: string; title: string; updatedAt: string } }>(
    `/conversations/${encodeURIComponent(conversationId)}`,
  )
  return {
    id: result.conversation.id,
    backendId: result.conversation.id,
    title: result.conversation.title,
    updatedAt: result.conversation.updatedAt,
    messages: [],
  }
}

export async function getBackendMessages(conversationId: string, targetMessageId?: string): Promise<ChatMessage[]> {
  // v1 消息按倒序分页，单页最多 100 条；深链需要翻页直到定位到目标消息。
  const pageSize = 100
  const pages: Array<Array<{ id: string; role: ChatRole; content: string; model?: string | null; status?: ChatMessage['status']; createdAt: string }>> = []
  let totalPages = 1
  for (let page = 1; page <= totalPages; page += 1) {
    const result = await readBackend<{
      items: Array<{ id: string; role: ChatRole; content: string; model?: string | null; status?: ChatMessage['status']; createdAt: string }>
      totalPages: number
    }>(`/conversations/${encodeURIComponent(conversationId)}/messages?page=${page}&pageSize=${pageSize}`)
    pages.push(result.items)
    totalPages = result.totalPages
    if (targetMessageId && result.items.some((message) => message.id === targetMessageId)) break
  }
  const messages = (targetMessageId ? pages.reverse().flat() : pages[0] || [])
  // v1 响应不含 usage/tokens，正文和任务溯源所需的消息字段保持足够。
  return messages.map((message) => ({
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

export async function getBackendPromptTemplates(): Promise<PersonalPromptTemplate[]> {
  return readBackend<PersonalPromptTemplate[]>('/conversations/prompt-templates')
}

export async function createBackendPromptTemplate(template: PersonalPromptTemplateInput): Promise<PersonalPromptTemplate> {
  const result = await readBackend<{ template: PersonalPromptTemplate }>('/conversations/prompt-templates', {
    method: 'POST',
    body: JSON.stringify(template),
  })
  return result.template
}

export async function updateBackendPromptTemplate(id: number, template: PersonalPromptTemplateInput): Promise<PersonalPromptTemplate> {
  const result = await readBackend<{ template: PersonalPromptTemplate }>(`/conversations/prompt-templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(template),
  })
  return result.template
}

export async function deleteBackendPromptTemplate(id: number): Promise<void> {
  await readBackend<null>(`/conversations/prompt-templates/${id}`, { method: 'DELETE' })
}

export type TaskDueFilter = 'overdue' | 'today' | 'upcoming'
export type TaskSort = 'default' | 'priority' | 'due_date'
export type TaskSummary = {
  totalTasks: number
  pending: number
  inProgress: number
  paused: number
  completed: number
  overdue: number
  dueToday: number
  dueNext7Days: number
}

export async function getBackendTasks(options: {
  page?: number
  pageSize?: number
  projectId?: number | 'all' | 'unassigned' | 'assigned'
  status?: TaskStatus | ''
  keyword?: string
  due?: TaskDueFilter | ''
  sort?: TaskSort
} = {}) {
  const query = new URLSearchParams({
    page: String(options.page || 1),
    pageSize: String(options.pageSize || 20),
    sort: options.sort || 'default',
  })
  if (options.projectId !== undefined && options.projectId !== 'all') query.set('projectId', String(options.projectId))
  if (options.status) query.set('status', options.status)
  if (options.keyword?.trim()) query.set('keyword', options.keyword.trim())
  if (options.due) query.set('due', options.due)
  return readBackend<{
    items: PersonalTask[]
    page: number
    pageSize: number
    total: number
    totalPages: number
    summary: TaskSummary
  }>(`/tasks?${query}`)
}

export async function getBackendTaskProjects(): Promise<{ projects: TaskProject[]; unassignedCount: number; assignedCount: number }> {
  return readBackend<{ projects: TaskProject[]; unassignedCount: number; assignedCount: number }>('/tasks/projects')
}

export async function getBackendTaskAssignees(): Promise<TaskAssignee[]> {
  const result = await readBackend<{ items: TaskAssignee[] }>('/tasks/assignees')
  return result.items
}

export async function createBackendTaskProject(name: string): Promise<TaskProject> {
  const result = await readBackend<{ project: TaskProject }>('/tasks/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  return result.project
}

export async function reorderBackendTaskProjects(ids: number[]): Promise<void> {
  await readBackend<null>('/tasks/projects/order', {
    method: 'PUT',
    body: JSON.stringify({ ids }),
  })
}

export async function updateBackendTaskProject(id: number, name: string): Promise<TaskProject> {
  const result = await readBackend<{ project: TaskProject }>(`/tasks/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
  return result.project
}

export async function deleteBackendTaskProject(id: number): Promise<void> {
  await readBackend<null>(`/tasks/projects/${id}`, { method: 'DELETE' })
}

export async function createBackendTasks(
  tasks: PersonalTaskInput[],
  source: { conversationId: string | null; messageId: string | null } = { conversationId: null, messageId: null },
  projectId: number | null = null,
): Promise<{ items: PersonalTask[]; skipped: number }> {
  const result = await readBackend<{ items: PersonalTask[]; skipped: number }>('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      tasks,
      sourceConversationId: source.conversationId,
      sourceMessageId: source.messageId,
      projectId,
    }),
  })
  return result
}

export async function updateBackendTask(id: number, task: PersonalTaskInput & { status: TaskStatus }): Promise<PersonalTask> {
  const result = await readBackend<{ task: PersonalTask }>(`/tasks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(task),
  })
  return result.task
}

export async function deleteBackendTask(id: number): Promise<void> {
  await readBackend<null>(`/tasks/${id}`, { method: 'DELETE' })
}

export async function uploadTaskImage(file: File): Promise<ChatFile> {
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  if (!allowedTypes.has(file.type)) throw new Error('图片仅支持 PNG、JPEG、WebP 或 GIF 格式')
  if (file.size > 5 * 1024 * 1024) throw new Error('单张任务图片不能超过 5MB')
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`${V1_BASE}/files`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  })
  const payload = await response.json().catch(() => ({})) as { code?: number | string; message?: string; data?: { id: string; filename: string; size: number; type: string } }
  if (response.status === 401) handleUnauthorized()
  if (!response.ok || payload.code !== 0 || !payload.data) throw new Error(payload.message || `图片上传失败（${response.status}）`)
  return { id: payload.data.id, name: payload.data.filename, size: payload.data.size, type: payload.data.type }
}

export async function getTaskImageObjectUrl(id: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(`${V1_BASE}/files/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
    signal,
  })
  if (response.status === 401) handleUnauthorized()
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(payload.message || `图片加载失败（${response.status}）`)
  }
  return URL.createObjectURL(await response.blob())
}

export async function updateBackendTaskStatuses(ids: number[], status: TaskStatus): Promise<number> {
  const result = await readBackend<{ affectedCount: number }>('/tasks/bulk/status', {
    method: 'PATCH',
    body: JSON.stringify({ ids, status }),
  })
  return result.affectedCount
}

export async function deleteBackendTasks(ids: number[]): Promise<number> {
  const result = await readBackend<{ affectedCount: number }>('/tasks/bulk', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  })
  return result.affectedCount
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
