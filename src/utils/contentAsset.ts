import { useEffect, useState } from 'react'
import { apiRequest } from './api'
import { KNOWLEDGE_BASE } from './apiBase'

// 知识库文件字节的水合层。
//
// 工作区只同步引用（content_key + hasAsset + mimeType + size），文件本体按需通过
// GET /api/knowledge/contents/:contentKey/asset 取回，转成 blob: URL 交给 <img>/<iframe>/fetch 使用。
// 选 blob: 而不是直接暴露带鉴权的 HTTP URL，是因为 <img src> / <iframe src> 无法附带 Authorization 头。
//
// 这里也是全应用唯一调用 URL.revokeObjectURL 的地方 —— 组件只 acquire/release，不负责回收，
// 否则某个组件提前撤销就会让另一个还在用同一个 URL 的组件（或 iframe 的内部重载）拿到失效地址。

export type AssetState =
  | { status: 'ready'; url: string } // 内联 data: 源，或已缓存的 blob: URL
  | { status: 'loading' }
  | { status: 'unavailable' } // 服务端没有字节，且本地也没有内联源
  | { status: 'error'; error: string }

export interface ContentAssetSource {
  id: string
  name?: string
  type?: string
  src?: string
  mimeType?: string
  size?: number
  hasAsset?: boolean
}

// 服务端能力标记：只有它明确宣告 assetWire >= 2，才允许省略已有条目的 src。
// 没有这道门，前端先于后端上线会让服务端把已有字节当成「客户端没给」而删掉。
let serverAssetWire = 0
export const setServerAssetWire = (value: unknown) => { serverAssetWire = Number(value) || 0 }
export const supportsContentAsset = () => serverAssetWire >= 2

const MAX_ENTRIES = 16
const MAX_CACHED_BYTES = 96 * 1024 * 1024
const MAX_CONCURRENT_FETCHES = 3

// 读取知识库工作区：请求里带上 assetWire 声明能力，响应里的 assetWire 决定我们是否敢省略已有条目的 src。
// 放在这里而不是 api.ts，是为了避免 api ↔ contentAsset 形成循环依赖。
export async function getKnowledgeWorkspace<T>() {
  const response = await apiRequest<T>('get', 'knowledge-workspace', { assetWire: 2 })
  if (response.success) {
    setServerAssetWire((response.data as { assetWire?: unknown } | undefined)?.assetWire)
  }
  return response
}

// 缩略图只水合小图；大图直接退回类型徽章，避免一个 20MB 的图把带宽占满。
export const THUMBNAIL_MAX_BYTES = 3 * 1024 * 1024
// 列表首屏最多同时水合多少张缩略图（按列表顺序，超出部分保持徽章）。
export const THUMBNAIL_LIMIT = 24

class AssetUnavailableError extends Error {}

type Entry = { url: string; bytes: number; lastUsed: number }

const entries = new Map<string, Entry>()
const inflight = new Map<string, Promise<string>>()
// 与 entries 分开维护：条目在 fetch 完成后才进缓存，但 acquire 在挂载时就发生了。
const refs = new Map<string, number>()
// 每个 id 的字节版本号。覆盖资产后 entries 里已经换成新 blob，但 useContentSrc 的签名只比较
// id/src/hasAsset —— 这三者一个都没变，落后一版的状态于是被当成「已就绪」而放行。
// 失效一次就 +1，把版本号并进签名，重取才会被逼出来。
const generations = new Map<string, number>()

export const assetGeneration = (id: string) => generations.get(id) ?? 0

// 丢弃某个条目的缓存字节，下次 useContentSrc 会重新下载。
// 覆盖保存后必须调用，否则预览会一直显示覆盖前的旧内容。
//
// 副作用是撤销该 id 当前的 blob: URL。同一 id 同时被多个组件持有时会打断其他持有者 ——
// 当前架构下一个 content_key 只对应一个文档标签页，所以成立；若要支持多持有者，
// 得改成等 refs 归零后再撤销，而不是立刻。
export function invalidateContentAsset(id: string) {
  const entry = entries.get(id)
  if (entry) {
    entries.delete(id)
    URL.revokeObjectURL(entry.url)
  }
  inflight.delete(id)
  generations.set(id, assetGeneration(id) + 1)
}

// 文本类字节统一按 UTF-8 编码后再 base64。
// 不能直接 btoa(text)：非 Latin-1 字符（中文）会抛 InvalidCharacterError；
// 也不能一次性 String.fromCharCode(...bytes)：几十万字节会撑爆调用栈，所以分块。
const BASE64_CHUNK_SIZE = 0x8000

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE))
  }
  return btoa(binary)
}

/** 二进制字节 → data URL。编辑保存时文本、xlsx、docx 都先编码成字节再走这条。 */
export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

const authToken = () => localStorage.getItem('access_token')

async function requestAsset(item: ContentAssetSource, base: string) {
  const response = await fetch(`${base}/contents/${encodeURIComponent(item.id)}/asset`, {
    cache: 'no-store',
    headers: authToken() ? { Authorization: `Bearer ${authToken()}` } : undefined,
  })
  if (!response.ok) {
    if (response.status === 404) throw new AssetUnavailableError('该条目没有可用的文件内容')
    throw new Error(`文件加载失败（${response.status}）`)
  }
  // Blob 的 type 是必需的：没有类型的 blob 会让浏览器把 PDF 当下载而不是内嵌渲染。
  const type = response.headers.get('Content-Type') || item.mimeType || 'application/octet-stream'
  const blob = new Blob([await response.arrayBuffer()], { type })
  return { url: URL.createObjectURL(blob), bytes: blob.size }
}

// 并发闸门：一次只允许 N 个资产同时在传，避免打开一个多图文件夹就并发几十个请求。
let activeFetches = 0
const fetchWaiters: Array<() => void> = []

async function withFetchSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeFetches >= MAX_CONCURRENT_FETCHES) {
    await new Promise<void>((resolve) => fetchWaiters.push(resolve))
  }
  activeFetches += 1
  try {
    return await task()
  } finally {
    activeFetches -= 1
    fetchWaiters.shift()?.()
  }
}

function evictIfOverBudget() {
  if (entries.size <= MAX_ENTRIES) {
    let total = 0
    for (const entry of entries.values()) total += entry.bytes
    if (total <= MAX_CACHED_BYTES) return
  }
  // 惰性回收：只在超预算时触发，所以 release 到 0 是空操作 ——
  // 这样 StrictMode 的 mount→cleanup→mount 双调用不会在两次 acquire 之间把 URL 撤掉。
  const evictable = [...entries.entries()]
    .filter(([key]) => !(refs.get(key) ?? 0))
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
  for (const [key, entry] of evictable) {
    if (entries.size <= MAX_ENTRIES) {
      let total = 0
      for (const other of entries.values()) total += other.bytes
      if (total <= MAX_CACHED_BYTES) break
    }
    entries.delete(key)
    URL.revokeObjectURL(entry.url)
  }
}

async function download(item: ContentAssetSource): Promise<string> {
  // 记下发起时的版本号：传输期间若发生覆盖保存，这一份就是旧字节，不能写回缓存。
  const generation = assetGeneration(item.id)
  const result = await withFetchSlot(() => requestAsset(item, KNOWLEDGE_BASE))
  if (assetGeneration(item.id) !== generation) {
    // 旧字节。撤销掉直接报错，让调用方（此时必然已经被版本号变化重新触发过）去取新的，
    // 而不是把一份过期内容留在缓存里，让下一次打开又看到它。
    URL.revokeObjectURL(result.url)
    throw new Error('文件已被覆盖，请重新加载')
  }
  const entry: Entry = { url: result.url, bytes: result.bytes, lastUsed: Date.now() }
  entries.set(item.id, entry)
  evictIfOverBudget()
  return entry.url
}

export function getContentSrc(item: ContentAssetSource): Promise<string> {
  const inline = item.src
  // 刚导入、还没落库的条目带着内联 data: 源，直接用，零请求。
  // 已经是 blob: 的一律不认（那是上一轮水合的产物，URL 可能已被回收）。
  if (inline && !inline.startsWith('blob:')) return Promise.resolve(inline)

  const cached = entries.get(item.id)
  if (cached) {
    cached.lastUsed = Date.now()
    return Promise.resolve(cached.url)
  }
  const pending = inflight.get(item.id)
  if (pending) return pending
  if (!item.hasAsset) return Promise.reject(new AssetUnavailableError('该条目没有可用的文件内容'))

  // finally 里认领自己的槽位：失效重取会先删掉 inflight 再挂一个新请求，
  // 旧请求收尾时若无条件 delete，会把新请求的槽位一并抹掉。
  const promise = download(item).finally(() => {
    if (inflight.get(item.id) === promise) inflight.delete(item.id)
  })
  inflight.set(item.id, promise)
  return promise
}

function acquire(id: string) {
  refs.set(id, (refs.get(id) ?? 0) + 1)
}

function release(id: string) {
  const count = (refs.get(id) ?? 0) - 1
  if (count > 0) refs.set(id, count)
  else refs.delete(id)
}

export function clearContentAssets() {
  for (const entry of entries.values()) URL.revokeObjectURL(entry.url)
  entries.clear()
  inflight.clear()
  refs.clear()
  generations.clear()
  serverAssetWire = 0
}

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message ? error.message : '文件加载失败'

// 同步可判定的状态（内联源、已缓存、确实没有字节）直接给出结果，避免闪一下 loading。
function settledState(id: string, src: string | undefined, hasAsset: boolean | undefined): AssetState | null {
  if (src && !src.startsWith('blob:')) return { status: 'ready', url: src }
  const cached = entries.get(id)
  if (cached) {
    cached.lastUsed = Date.now()
    return { status: 'ready', url: cached.url }
  }
  if (!hasAsset) return { status: 'unavailable' }
  return null
}

export function useContentSrc(item: ContentAssetSource | null | undefined, enabled = true): AssetState {
  const id = item?.id ?? ''
  const src = item?.src
  const mimeType = item?.mimeType
  const hasAsset = item?.hasAsset
  // 覆盖保存后 id/src/hasAsset 一个都不变，只有版本号能说明缓存里的字节已经过期。
  const generation = assetGeneration(id)
  const resolveSync = () => (id && settledState(id, src, hasAsset)) || { status: 'loading' as const }
  const [state, setState] = useState<AssetState>(resolveSync)
  const [signature, setSignature] = useState(() => ({ id, src, hasAsset, generation }))

  // 条目变了就立刻按已知信息校正状态。用渲染期更新而不是 effect：
  // 少一次提交，内联源/已缓存的条目不会闪一帧 loading。
  if (signature.id !== id || signature.src !== src || signature.hasAsset !== hasAsset || signature.generation !== generation) {
    setSignature({ id, src, hasAsset, generation })
    setState(resolveSync())
  }

  useEffect(() => {
    if (!id || !enabled) return
    // 状态已在渲染期定下来（内联源 / 已缓存 / 确实无字节）就不用发请求了。
    if (settledState(id, src, hasAsset)) return
    let cancelled = false
    acquire(id)
    getContentSrc({ id, src, mimeType, hasAsset }).then(
      (url) => { if (!cancelled) setState({ status: 'ready', url }) },
      (error) => {
        if (cancelled) return
        setState(error instanceof AssetUnavailableError
          ? { status: 'unavailable' }
          : { status: 'error', error: errorMessage(error) })
      }
    )
    // 故意不 abort：结果进共享缓存，重新打开同一文件就是瞬时的。
    return () => { cancelled = true; release(id) }
  }, [id, src, mimeType, hasAsset, generation, enabled])

  return enabled ? state : { status: 'unavailable' }
}

// 列表行缩略图：只对图片、且体积在阈值内的条目水合，其余一律保持类型徽章。
export function useThumbnailSrc(item: ContentAssetSource, enabled: boolean): AssetState {
  const eligible = enabled
    && item.type === 'image'
    && Boolean(item.hasAsset || item.src)
    && (item.size == null || item.size === 0 || item.size <= THUMBNAIL_MAX_BYTES)
  return useContentSrc(item, eligible)
}
