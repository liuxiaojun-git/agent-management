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
  status?: 'success' | 'failed'
  duration?: string
  tokens?: number
  api?: string
  model?: string
  firstCharDelay?: string
}

const fileName = (cat: string) => cat === 'audit' ? 'app-logs-run' : 'app-logs-operation'

export async function getLogs(cat?: string): Promise<LogEntry[]> {
  if (cat) {
    const result = await apiRequest<LogEntry[]>('get', fileName(cat))
    return result.success ? (result.data || []) : []
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

export async function addLog(log: Omit<LogEntry, 'id' | 'timestamp'>): Promise<LogEntry | null> {
  const cat = log.category || 'operation'
  const current = await getLogs(cat)
  const entry: LogEntry = {
    ...log,
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  }
  current.unshift(entry)
  const result = await apiRequest('set', fileName(cat), current.slice(0, 500))
  return result.success ? entry : null
}
