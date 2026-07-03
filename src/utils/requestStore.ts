export interface SavedRequest {
  id: string
  label: string
  method: string
  url: string
  headers: { key: string; value: string; enabled: boolean }[]
  body: string
  collection: string
  savedAt: string
  lastResponse?: {
    status: number
    statusText: string
    time: string
    size: string
    body: string
    headers: Record<string, string>
  }
  concurrentResults?: { index: number; status: number; time: string }[]
  concurrentSummary?: { total: number; success: number; failed: number; avgTime: string; totalTime: string }
  concurrentConfig?: { mode: boolean; count: number; duration: number; timeout: number }
}

export interface Collection {
  name: string
  icon: string
}

export interface SavedRequestStore {
  collections: Collection[]
  requests: SavedRequest[]
  collapsedCollections?: Record<string, boolean>
}

import { apiRequest } from './api'

const NAME = 'api-test-saved-requests'
const LS_KEY = 'api-test-saved-requests'
const DEFAULT_COLLECTIONS: Collection[] = [
  { name: '默认集合', icon: '📁' },
]
let cache: SavedRequestStore | null = null

// 从 localStorage 同步恢复（保证首次渲染就有数据）
function localStorageFallback(): SavedRequestStore {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { collections: DEFAULT_COLLECTIONS, requests: [], collapsedCollections: {} }
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return { collections: DEFAULT_COLLECTIONS, requests: parsed, collapsedCollections: {} }
    }
    return {
      collections: Array.isArray(parsed.collections) && parsed.collections.length > 0 ? parsed.collections : DEFAULT_COLLECTIONS,
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      collapsedCollections: typeof parsed.collapsedCollections === 'object' && parsed.collapsedCollections !== null ? parsed.collapsedCollections : {},
    }
  } catch {
    return { collections: DEFAULT_COLLECTIONS, requests: [], collapsedCollections: {} }
  }
}

async function fetchFromFile(): Promise<SavedRequestStore> {
  const result = await apiRequest<SavedRequestStore | SavedRequest[]>('get', NAME)
  if (!result.success || result.data == null) {
    return { collections: DEFAULT_COLLECTIONS, requests: [], collapsedCollections: {} }
  }
  if (Array.isArray(result.data)) {
    return { collections: DEFAULT_COLLECTIONS, requests: result.data, collapsedCollections: {} }
  }
  return {
    collections: Array.isArray(result.data.collections) && result.data.collections.length > 0 ? result.data.collections : DEFAULT_COLLECTIONS,
    requests: Array.isArray(result.data.requests) ? result.data.requests : [],
    collapsedCollections: typeof result.data.collapsedCollections === 'object' && result.data.collapsedCollections !== null ? result.data.collapsedCollections : {},
  }
}

async function writeToFile(data: SavedRequestStore) {
  await apiRequest('set', NAME, data)
}

// 同步写入 localStorage（保证页面刷新后仍能恢复）
function syncToLocal(data: SavedRequestStore) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)) } catch { /* ignore */ }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null
let synced = false

function getCacheData(): SavedRequestStore {
  if (!cache) cache = localStorageFallback()
  return cache
}

export function getCollapsedCollections(): Record<string, boolean> {
  return getCacheData().collapsedCollections || {}
}

// 同步读取（首次调用后缓存）
export function getSavedRequests(): SavedRequest[] {
  return getCacheData().requests
}

export function getCollections(): Collection[] {
  return getCacheData().collections
}

// 同步更新并异步持久化
export function setSavedRequests(data: SavedRequest[]) {
  const current = getCacheData()
  current.requests = data
  cache = current
  syncToLocal(current) // 同步写入 localStorage 保证跨页面恢复
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    writeToFile(current)
    flushTimer = null
  }, 300)

  if (!synced) {
    synced = true
    fetchFromFile().then(fileData => {
      const currentJson = JSON.stringify(current)
      const fileJson = JSON.stringify(fileData)
      if (fileJson !== currentJson) {
        cache = fileData
        writeToFile(fileData)
        try { localStorage.setItem(LS_KEY, JSON.stringify(fileData)) } catch { /* ignore */ }
      } else if (current.requests.length > 0 && fileData.requests.length === 0) {
        writeToFile(current)
      }
    })
  }
}

export function setCollections(data: Collection[]) {
  const current = getCacheData()
  current.collections = data
  cache = current
  syncToLocal(current)
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    writeToFile(current)
    flushTimer = null
  }, 300)
}

export function setCollapsedCollections(data: Record<string, boolean>) {
  const current = getCacheData()
  current.collapsedCollections = data
  cache = current
  syncToLocal(current)
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    writeToFile(current)
    flushTimer = null
  }, 300)
}
