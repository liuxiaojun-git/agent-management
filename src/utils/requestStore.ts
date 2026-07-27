import { apiRequest } from './api'

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
  concurrentSummary?: {
    total: number
    success: number
    failed: number
    avgTime: string
    totalTime: string
  }
  concurrentConfig?: { mode: boolean; count: number; duration: number; timeout: number }
}

export interface Collection {
  name: string
  icon: string
}

interface SavedRequestStore {
  collections: Collection[]
  requests: SavedRequest[]
  collapsedCollections: Record<string, boolean>
}

const NAME = 'api-test-saved-requests'
const LS_KEY = 'api-test-saved-requests'
const DEFAULT_COLLECTIONS: Collection[] = [{ name: '默认集合', icon: '📁' }]
const EMPTY_STORE: SavedRequestStore = {
  collections: DEFAULT_COLLECTIONS,
  requests: [],
  collapsedCollections: {},
}

let cache: SavedRequestStore | null = null

function normalizeStore(data: unknown): SavedRequestStore {
  if (Array.isArray(data)) {
    return { ...EMPTY_STORE, requests: data as SavedRequest[] }
  }

  if (!data || typeof data !== 'object') return { ...EMPTY_STORE }

  const store = data as Partial<SavedRequestStore>
  return {
    collections:
      Array.isArray(store.collections) && store.collections.length > 0
        ? store.collections
        : DEFAULT_COLLECTIONS,
    requests: Array.isArray(store.requests) ? store.requests : [],
    collapsedCollections:
      store.collapsedCollections && typeof store.collapsedCollections === 'object'
        ? store.collapsedCollections
        : {},
  }
}

// 从 localStorage 同步恢复（保证首次渲染就有数据）
function localStorageFallback(): SavedRequestStore {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? normalizeStore(JSON.parse(raw)) : { ...EMPTY_STORE }
  } catch {
    return { ...EMPTY_STORE }
  }
}

// 缓存 fetchFromFile 调用，避免重复请求
let fetchPromise: Promise<SavedRequestStore> | null = null
async function fetchFromFile(): Promise<SavedRequestStore> {
  if (!fetchPromise) {
    fetchPromise = (async () => {
      try {
        const result = await apiRequest<SavedRequestStore | SavedRequest[]>('get', NAME)
        if (result.success && result.data != null) {
          return normalizeStore(result.data)
        }
      } catch {
        // 服务端不可用时继续使用本地缓存。
      }
      return { ...EMPTY_STORE }
    })()
  }
  return fetchPromise
}

// 同步写入 localStorage（保证页面刷新后仍能恢复）
function syncToLocal(data: SavedRequestStore) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data))
  } catch {
    // 浏览器禁用存储时仍允许页面继续工作。
  }
}

let flushTimer: ReturnType<typeof setTimeout> | null = null

function getCacheData(): SavedRequestStore {
  if (!cache) cache = localStorageFallback()
  return cache
}

function updateStore(update: Partial<SavedRequestStore>) {
  const current = getCacheData()
  const next = { ...current, ...update }

  if (JSON.stringify(current) === JSON.stringify(next)) return

  cache = next
  syncToLocal(next)

  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    void apiRequest('set', NAME, next)
    flushTimer = null
  }, 300)
}

export function getCollapsedCollections(): Record<string, boolean> {
  return getCacheData().collapsedCollections
}

// 同步读取（首次调用后缓存）
export function getSavedRequests(): SavedRequest[] {
  return getCacheData().requests
}

export function getCollections(): Collection[] {
  return getCacheData().collections
}

export async function hydrateStoreFromFile(): Promise<SavedRequestStore> {
  const fileData = await fetchFromFile()
  const localData = getCacheData()
  const normalized: SavedRequestStore = {
    collections: fileData.collections.length > 0 ? fileData.collections : localData.collections,
    requests: fileData.requests.length > 0 ? fileData.requests : localData.requests,
    collapsedCollections: fileData.collapsedCollections,
  }
  cache = normalized
  syncToLocal(normalized)
  return normalized
}

// 同步更新并异步持久化
export function setSavedRequests(data: SavedRequest[]) {
  updateStore({ requests: data })
}

export function setCollections(data: Collection[]) {
  updateStore({ collections: data })
}

export function setCollapsedCollections(data: Record<string, boolean>) {
  updateStore({ collapsedCollections: data })
}
