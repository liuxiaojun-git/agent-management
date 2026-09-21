// base URL 已收敛到 utils/apiBase.ts（单一口径：v1 根）。这里做**请求封装**：
// 把旧 `/api/data` 的「{action,name,data} POST」语义分派到对应 v1 REST 端点，
// 并把 v1 信封 `{code,message,data,requestId}` 统一翻译回调用方仍在用的 `{success,data,error}`，
// 让 requestStore / contentAsset / Knowledge 这类快照调用方**不必改判读逻辑**。
import { V1_BASE, KNOWLEDGE_BASE } from './apiBase'

// /api/proxy 与本次迁移无关（ApiTest 页的代理回放通道），保持原样。
export const PROXY_API_URL = '/api/proxy'

// P2-9 乐观锁：两个快照工作区的 revision 往返。GET 时记下、PUT 时自动带回（`?revision=N`），
// 成功则本地 +1（后端保证「恰好 +1」，见 services/workspaceRevision.js），
// 409 RESOURCE_CONFLICT 时清空 —— 让下一次保存退回旧语义（后写覆盖），而不是拿过期值反复撞 409。
//
// 键不按用户区分：每次登录后必然先 GET（页面首屏加载），而 GET 会覆盖旧值，所以跨用户不会串号；
// 登出/401 时 handleUnauthorized 整体清空，双保险。
const workspaceRevisions = new Map<string, number>()

function captureWorkspaceRevision(name: string, data: unknown): void {
  if (data && typeof data === 'object' && typeof (data as { revision?: unknown }).revision === 'number') {
    workspaceRevisions.set(name, (data as { revision: number }).revision)
  }
}

function workspacePutPath(name: string, path: string): string {
  const revision = workspaceRevisions.get(name)
  return revision != null ? `${path}?revision=${revision}` : path
}

// 401 代表令牌已失效。本文件的请求封装一律把失败吞成 { success:false }，页面拿到后只会静默
// 停在旧数据上（日志轮询停摆、模型配置"保存成功"但没写库），所以必须在这里主动清态并跳登录页。
// 与 services/chatService.ts 的同名函数保持一致：清同一组键。
let redirectingToLogin = false
function handleUnauthorized() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('user')
  workspaceRevisions.clear()
  // 已在登录页就不必再跳；并发的多个 401 也只跳一次，避免重复 assign
  if (redirectingToLogin || window.location.pathname === '/login') return
  redirectingToLogin = true
  window.location.assign('/login')
}

// 独立类型：调用方据此跳过回退重试（令牌失效时重试只会白跑一次并再拿一个 401）。
class UnauthorizedError extends Error {
  constructor() {
    super('登录状态已失效，请重新登录')
    this.name = 'UnauthorizedError'
  }
}

export interface ApiDataResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  /** v1 业务码：成功为数字 0；失败为 'RESOURCE_CONFLICT' 等字符串。用于乐观锁冲突等需区分失败原因的场景。 */
  code?: number | string
}

interface V1Envelope<T = unknown> {
  code: number | string
  message?: string
  data?: T
  requestId?: string
}

interface ProxyRequestOptions extends RequestInit {
  bodyEncoding?: 'base64'
}

export async function proxyRequest(targetUrl: string, options: ProxyRequestOptions) {
  const { signal, ...serializedOptions } = options
  const res = await fetch(PROXY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: targetUrl, options: serializedOptions }),
    signal,
  })
  return res
}

// 统一的 v1 请求：带 Bearer 头，401 时清态跳登录。返回原生 Response，由调用方决定如何读。
async function v1Fetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('access_token')
  const response = await fetch(`${V1_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })
  if (response.status === 401) {
    handleUnauthorized()
    throw new UnauthorizedError()
  }
  return response
}

async function readJson<T = unknown>(response: Response): Promise<V1Envelope<T> | undefined> {
  try {
    return (await response.json()) as V1Envelope<T>
  } catch {
    return undefined
  }
}

// v1 信封 → 旧的 {success,data,error}。code===0 才算成功；失败取 message。
// fallbackError：响应体不是 JSON 信封（如 500 的 HTML）时用状态码兜底，而不是笼统的「服务响应异常」。
function toDataResponse<T>(payload: V1Envelope<T> | undefined, fallbackError = '服务响应异常'): ApiDataResponse<T> {
  if (!payload) return { success: false, error: fallbackError }
  if (payload.code === 0) return { success: true, data: payload.data, code: 0 }
  return { success: false, error: payload.message || '请求失败', code: payload.code }
}

// 快照工作区的 get/set 分派。model-providers 与日志已改用各自的直接调用，
// 不再经过这里 —— 出现未知 name 就显式报错，便于尽早发现遗漏。
export async function apiRequest<T = unknown>(action: 'get' | 'set', name: string, data?: unknown): Promise<ApiDataResponse<T>> {
  try {
    if (name === 'api-test-saved-requests') {
      if (action === 'get') {
        const response = await v1Fetch('/api-tests/workspace')
        if (!response.ok) return { success: false, error: `请求失败（${response.status}）` }
        const payload = await readJson<T>(response)
        captureWorkspaceRevision('api-test-saved-requests', payload?.data)
        return toDataResponse<T>(payload)
      }
      const revision = workspaceRevisions.get('api-test-saved-requests')
      const response = await v1Fetch(workspacePutPath('api-test-saved-requests', '/api-tests/workspace'), { method: 'PUT', body: JSON.stringify(data ?? {}) })
      const payload = await readJson<T>(response)
      if (payload?.code === 0) {
        if (revision != null) workspaceRevisions.set('api-test-saved-requests', revision + 1)
      } else if (payload?.code === 'RESOURCE_CONFLICT') {
        workspaceRevisions.delete('api-test-saved-requests')
      }
      return toDataResponse<T>(payload, `保存失败（${response.status}）`)
    }
    if (name === 'knowledge-workspace') {
      if (action === 'get') {
        const response = await v1Fetch('/knowledge/workspace?assetWire=2')
        if (!response.ok) return { success: false, error: `请求失败（${response.status}）` }
        const payload = await readJson<T>(response)
        captureWorkspaceRevision('knowledge-workspace', payload?.data)
        return toDataResponse<T>(payload)
      }
      const revision = workspaceRevisions.get('knowledge-workspace')
      const response = await v1Fetch(workspacePutPath('knowledge-workspace', '/knowledge/workspace'), { method: 'PUT', body: JSON.stringify(data ?? {}) })
      const payload = await readJson<T>(response)
      if (payload?.code === 0) {
        if (revision != null) workspaceRevisions.set('knowledge-workspace', revision + 1)
      } else if (payload?.code === 'RESOURCE_CONFLICT') {
        workspaceRevisions.delete('knowledge-workspace')
      }
      return toDataResponse<T>(payload, `保存失败（${response.status}）`)
    }
    console.error(`[api] 未知的数据键：${name}`)
    return { success: false, error: `未知的数据键：${name}` }
  } catch (error) {
    if (error instanceof UnauthorizedError) return { success: false, error: error.message }
    console.error(`[api] ${action} ${name} failed`, error)
    return { success: false, error: 'network error' }
  }
}

// fetch 无法读取上传进度，知识库保存大文件时改用 XHR。
// 与 apiRequest 的 PUT 分支保持一致：带 revision、成功后 +1、409 清空；非 2xx 也 resolve（解析出信封），
// 这样 409 冲突的 code 能传给 persistWorkspace，而不是被笼统的「network error」吞掉。
function xhrPut<T = unknown>(path: string, data: unknown, onProgress?: (ratio: number) => void) {
  return new Promise<ApiDataResponse<T>>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const token = localStorage.getItem('access_token')
    const revision = workspaceRevisions.get('knowledge-workspace')
    xhr.open('PUT', `${V1_BASE}${workspacePutPath('knowledge-workspace', path)}`)
    xhr.setRequestHeader('Content-Type', 'application/json')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (event) => { if (event.lengthComputable && event.total) onProgress?.(event.loaded / event.total) }
    xhr.onload = () => {
      if (xhr.status === 401) {
        handleUnauthorized()
        reject(new UnauthorizedError())
        return
      }
      let payload: V1Envelope<T> | undefined
      try {
        payload = JSON.parse(xhr.responseText) as V1Envelope<T>
      } catch {
        payload = undefined
      }
      if (payload?.code === 0) {
        if (revision != null) workspaceRevisions.set('knowledge-workspace', revision + 1)
      } else if (payload?.code === 'RESOURCE_CONFLICT') {
        workspaceRevisions.delete('knowledge-workspace')
      }
      const failed = xhr.status < 200 || xhr.status >= 300
      resolve(toDataResponse<T>(payload, failed ? `API request failed: ${xhr.status} ${xhr.statusText}` : undefined))
    }
    xhr.onerror = () => reject(new Error('API request failed: network error'))
    xhr.ontimeout = () => reject(new Error('API request failed: timeout'))
    xhr.send(JSON.stringify(data ?? {}))
  })
}

export async function apiRequestWithProgress<T = unknown>(action: 'get' | 'set', name: string, data?: unknown, onProgress?: (ratio: number) => void): Promise<ApiDataResponse<T>> {
  try {
    if (name === 'knowledge-workspace' && action === 'set') {
      return await xhrPut<T>('/knowledge/workspace', data, onProgress)
    }
    return await apiRequest<T>(action, name, data)
  } catch (error) {
    if (error instanceof UnauthorizedError) return { success: false, error: error.message }
    console.error(`[api] ${action} ${name} failed`, error)
    return { success: false, error: 'network error' }
  }
}

export interface KnowledgeAnswer {
  answer: string
  model: string
  citations: Array<{ id: number; title: string; path?: string; updated?: string }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

// 问答检索范围：集合级（跨集合内全部知识库）或文件夹级（库内某个文件夹路径）。
// 后端仅识别 libraryId 时，scope 会被忽略并回退到整库检索。
export interface KnowledgeAskScope {
  level: 'collection' | 'folder' | 'document'
  key?: string // collection 级：集合 key（'personal' | 'shared' | 'subscribed' | 'collection-<n>'）
  libraryIds?: number[] // collection 级：集合内知识库 id 列表
  libraryId?: number // folder 级：所属知识库 id
  folder?: string // folder 级：文件夹路径，如 '产品规划/子文件夹'
  name?: string // document 级：当前文档名称
  parent?: string // document 级：当前文档所在路径，根目录为空字符串
}

// 问答记录持久化（外部后端 MySQL 契约，见 docs/knowledge-conversations-api.md）
// 与 Knowledge.tsx 本地类型结构一致，结构化类型可互相赋值。
export interface KnowledgeChatMessage {
  role: 'user' | 'assistant'
  text: string
  citations?: Array<{ id: number; title: string; path?: string; updated?: string }>
  createdAt?: string
}

export interface KnowledgeConversation {
  id: string
  title: string
  messages: KnowledgeChatMessage[]
  createdAt: string
  updatedAt: string
}

export async function askKnowledge(libraryId: number, question: string, history: Array<{ role: 'user' | 'assistant'; text: string }> = [], signal?: AbortSignal, scope?: KnowledgeAskScope): Promise<ApiDataResponse<KnowledgeAnswer>> {
  const token = localStorage.getItem('access_token')
  const body = JSON.stringify(scope ? { libraryId, question, history, scope } : { libraryId, question, history })
  const waitBeforeRetry = () => new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, 1200)
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = Date.now()
    try {
      const response = await fetch(`${KNOWLEDGE_BASE}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body,
        signal,
      })
      let payload: V1Envelope<KnowledgeAnswer>
      try {
        payload = await response.json() as V1Envelope<KnowledgeAnswer>
      } catch {
        // 服务重启或网关异常时可能短暂返回空响应/HTML，按瞬时连接故障处理。
        throw new Error('invalid-response')
      }
      // 直接返回、不进入下面的重试分支：令牌没刷新前重试必然还是 401
      if (response.status === 401) {
        handleUnauthorized()
        return { success: false, error: '登录状态已失效，请重新登录' }
      }
      if (!response.ok) return { success: false, error: payload.message || `知识问答请求失败（${response.status}）` }
      if (payload.code === 0) return { success: true, data: payload.data }
      return { success: false, error: payload.message || '知识问答请求失败' }
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return { success: false, error: '已停止生成' }
      }
      const failedQuickly = Date.now() - startedAt < 5000
      if (attempt === 0 && failedQuickly) {
        console.warn('[api] knowledge ask connection failed, retrying once', error)
        try {
          await waitBeforeRetry()
          continue
        } catch {
          return { success: false, error: '已停止生成' }
        }
      }
      console.error('[api] knowledge ask failed', error)
      return {
        success: false,
        error: error instanceof Error && error.message === 'invalid-response'
          ? '知识问答服务响应异常，请稍后重试'
          : '知识问答服务暂时不可用，请稍后重试',
      }
    }
  }
  return { success: false, error: '知识问答服务暂时不可用，请稍后重试' }
}

// 统一的知识库鉴权请求辅助（会话记录、文档字节覆盖都走它）：
// 401 在此统一清态跳转 —— 五个调用方都只把失败当 { success:false } 处理，不清理就会静默丢会话。
// 任何异常都返回 { success:false }，绝不抛出（此处只做跳转副作用，仍然不抛）。
async function knowledgeConversationsFetch(path: string, options: RequestInit): Promise<Response> {
  const token = localStorage.getItem('access_token')
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  if (response.status === 401) handleUnauthorized()
  return response
}

// 读取当前用户全部问答记录（按 scopeKey 分组的会话 map）。后端未实现/网络失败 → 返回空（{ success:false }）。
export async function getKnowledgeConversations(): Promise<ApiDataResponse<Record<string, KnowledgeConversation[]>>> {
  try {
    const response = await knowledgeConversationsFetch(`${KNOWLEDGE_BASE}/conversations`, { method: 'GET' })
    if (!response.ok) return { success: false, error: `请求失败（${response.status}）` }
    const payload = await response.json() as V1Envelope<Record<string, KnowledgeConversation[]>>
    if (payload && payload.code === 0) return { success: true, data: payload.data || {} }
    return { success: false, error: payload?.message || '暂无问答记录数据' }
  } catch (error) {
    console.error('[api] knowledge conversations get failed', error)
    return { success: false, error: '无法连接问答记录服务' }
  }
}

export async function getDocumentConversations(libraryId: number, name: string, parent = ''): Promise<ApiDataResponse<{ conversations: KnowledgeConversation[] }>> {
  try {
    const query = new URLSearchParams({ libraryId: String(libraryId), name, parent })
    const response = await knowledgeConversationsFetch(`${KNOWLEDGE_BASE}/document-conversations?${query}`, { method: 'GET' })
    const payload = await response.json() as V1Envelope<{ conversations: KnowledgeConversation[] }>
    if (response.ok && payload?.code === 0) return { success: true, data: payload.data }
    return { success: false, error: payload?.message || `请求失败（${response.status}）` }
  } catch {
    return { success: false, error: '无法读取文档问答记录' }
  }
}

export async function saveDocumentConversations(libraryId: number, name: string, parent: string, conversations: KnowledgeConversation[]): Promise<ApiDataResponse<never>> {
  try {
    const response = await knowledgeConversationsFetch(`${KNOWLEDGE_BASE}/document-conversations`, {
      method: 'POST',
      body: JSON.stringify({ libraryId, name, parent, conversations }),
    })
    const payload = await response.json() as V1Envelope
    return response.ok && payload?.code === 0 ? { success: true } : { success: false, error: payload?.message || `请求失败（${response.status}）` }
  } catch {
    return { success: false, error: '无法保存文档问答记录' }
  }
}

// 覆盖单个文档的字节，返回服务端写入的 content_updated_at。
//
// 这里刻意用单文档接口而不是整份 workspace 的读-改-写：文档独立页是一个新标签页，手里没有列表页的
// workspace 状态，而服务端对 contents 是按 content_key 做 diff（载荷里没有的就删除），
// 整份回传会把另一个标签页在此期间新增的文档一并删掉。
export async function replaceContentAsset(contentKey: string, payload: { src: string; mimeType: string; size: number }): Promise<ApiDataResponse<{ contentUpdatedAt?: string }>> {
  if (!contentKey) return { success: false, error: '缺少文档标识' }
  try {
    const response = await knowledgeConversationsFetch(`${KNOWLEDGE_BASE}/contents/${encodeURIComponent(contentKey)}/asset`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    if (response.status === 404 || response.status === 405) return { success: false, error: '当前后端版本尚不支持文档编辑，请升级后端服务' }
    if (response.status === 413) return { success: false, error: '文件超过服务端允许的大小（96 MB）' }
    if (!response.ok) return { success: false, error: `保存失败（${response.status}）` }
    let result: V1Envelope<{ contentUpdatedAt?: string }>
    try {
      result = await response.json() as V1Envelope<{ contentUpdatedAt?: string }>
    } catch {
      return { success: false, error: '文档保存服务响应异常，请确认后端已升级' }
    }
    return result?.code === 0 ? { success: true, data: result.data } : { success: false, error: result?.message || '保存失败' }
  } catch (error) {
    console.error('[api] replace content asset failed', error)
    return { success: false, error: '无法连接知识库服务' }
  }
}

// 全量替换问答记录（replace-all 语义）。后端未实现/网络失败 → 返回 { success:false }，调用方静默降级。
export async function saveKnowledgeConversations(conversations: Record<string, KnowledgeConversation[]>): Promise<ApiDataResponse> {
  try {
    const response = await knowledgeConversationsFetch(`${KNOWLEDGE_BASE}/conversations`, {
      method: 'POST',
      body: JSON.stringify({ conversations }),
    })
    if (!response.ok) return { success: false, error: `保存失败（${response.status}）` }
    const payload = await response.json() as V1Envelope
    if (payload && payload.code === 0) return { success: true, data: payload.data }
    return { success: false, error: payload?.message || '保存失败' }
  } catch (error) {
    console.error('[api] knowledge conversations save failed', error)
    return { success: false, error: '无法连接问答记录服务' }
  }
}
