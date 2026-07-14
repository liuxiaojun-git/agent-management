import { apiRequest } from './api'

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
  status?: 'success' | 'failed'
  duration?: string
  tokens?: number
  api?: string
  model?: string
  firstCharDelay?: string
}

const fileName = (cat: string) => cat === 'audit' ? 'app-logs-run' : 'app-logs-operation'

// 日志缓存：重复请求直接返回缓存结果
// 使用 Promise 缓存避免并发重复请求
const logCache = new Map<string, LogEntry[] | Promise<LogEntry[]>>()
export async function getLogs(cat?: string): Promise<LogEntry[]> {
  if (cat) {
    const cached = logCache.get(cat)
    if (cached instanceof Promise) return cached
    if (Array.isArray(cached)) return cached
    const promise = apiRequest<LogEntry[]>('get', fileName(cat)).then(result => {
      const data = result.success ? (result.data || []) : []
      logCache.set(cat, data)
      return data
    })
    logCache.set(cat, promise)
    return promise
  }
  // 读取两个文件合并
  const [op, au] = await Promise.all([
    apiRequest<LogEntry[]>('get', fileName('operation')),
    apiRequest<LogEntry[]>('get', fileName('audit')),
  ])
  const all = [...(op.success ? op.data || [] : []), ...(au.success ? au.data || [] : [])]
  all.sort((a: LogEntry, b: LogEntry) => b.timestamp - a.timestamp)
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
  const current = await getLogs(cat)
  const entry: LogEntry = {
    ...log,
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  }
  current.unshift(entry)
  logCache.set(cat, current)
  const result = await apiRequest('set', fileName(cat), current.slice(0, 500))
  return result.success ? entry : null
}
