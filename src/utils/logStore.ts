// 日志读写层（批次 F：迁到 v1 的 /logs/* 端点）。
//
// v1 的日志列表是**分页**的（{items,page,pageSize,total,totalPages}），而日志页是「一次取全量 →
// 前端 filter+slice」的既有形态。所以 getLogs 在这里**逐页拼全量**，把拼好的数组照旧返回，
// 页面对应的分页/排序代码一字不改。
//
// 写入从旧路径的「读全量 → unshift → 回写 slice(0,500)」改成**单条追加**（POST {logs:[entry]}）：
// v1 只允许追加、没有删除端点（P2-7 之后两条路径都只有追加），旧的那个回写若命中
// LOG_WRITE_MODE=replace 会把日志表截断到 500 行 —— 现在这条删除路径整个不存在了。
import { V1_BASE } from './apiBase'

export interface LogEntry {
  id: string
  time: string
  level: 'info' | 'warn' | 'error'
  source: string
  message: string
  detail: string
  timestamp: number
  category?: 'operation' | 'audit'
  requestId?: string
  userName?: string
  status?: 'success' | 'failed'
  duration?: string
  tokens?: number
  inputTokens?: number
  outputTokens?: number
  api?: string
  model?: string
  firstCharDelay?: string
}

// 401 清态跳登录，与 api.ts / chatService.ts 同口径（清同一组键、防重入、登录页不再跳）。
let redirectingToLogin = false
function handleUnauthorized() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('user')
  if (redirectingToLogin || window.location.pathname === '/login') return
  redirectingToLogin = true
  window.location.assign('/login')
}

interface V1Envelope<T = unknown> {
  code: number | string
  message?: string
  data?: T
  requestId?: string
}

interface PagedResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

// 分类 → v1 resource 段。'audit' 是运行日志（旧 app-logs-run → runs），其余都落操作日志。
const resourceOf = (cat: string) => (cat === 'audit' ? 'runs' : 'operations')

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<V1Envelope<T>> {
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
    return { code: 'UNAUTHORIZED', message: '登录状态已失效，请重新登录' }
  }
  try {
    return (await response.json()) as V1Envelope<T>
  } catch {
    return { code: 'NETWORK', message: `请求失败（${response.status}）` }
  }
}

// 自动翻页拉全量：逐页拼 items，直到拿齐 total（或某一页为空，防御 total 与 items 数不一致的边界）。
async function fetchAll(resource: string): Promise<LogEntry[]> {
  const all: LogEntry[] = []
  const pageSize = 100
  for (let page = 1; ; page += 1) {
    const payload = await fetchJson<PagedResult<LogEntry>>(`/logs/${resource}?page=${page}&pageSize=${pageSize}`)
    if (payload.code !== 0 || !payload.data) break
    const { items, total } = payload.data
    all.push(...items)
    if (all.length >= total || items.length === 0) break
  }
  return all
}

// 日志缓存：重复请求直接返回缓存结果。用 Promise 缓存避免并发重复请求。
const logCache = new Map<string, LogEntry[] | Promise<LogEntry[]>>()

export async function getLogs(cat?: string): Promise<LogEntry[]> {
  if (cat) {
    const cached = logCache.get(cat)
    if (cached instanceof Promise) return cached
    if (Array.isArray(cached)) return cached
    const promise = fetchAll(resourceOf(cat)).then((data) => {
      logCache.set(cat, data)
      return data
    })
    logCache.set(cat, promise)
    return promise
  }
  // 读取两个资源合并
  const [op, au] = await Promise.all([fetchAll('operations'), fetchAll('runs')])
  const all = [...op, ...au]
  all.sort((a, b) => b.timestamp - a.timestamp)
  return all
}

// 清除日志缓存（新增日志后调用）
export function clearLogCache(cat?: string) {
  if (cat) logCache.delete(cat)
  else logCache.clear()
}

export async function addLog(log: Omit<LogEntry, 'id' | 'timestamp'>): Promise<LogEntry | null> {
  const cat = log.category || 'operation'
  clearLogCache(cat)
  const entry: LogEntry = {
    ...log,
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  }
  const payload = await fetchJson(`/logs/${resourceOf(cat)}`, {
    method: 'POST',
    body: JSON.stringify({ logs: [entry] }),
  })
  return payload.code === 0 ? entry : null
}
