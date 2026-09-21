import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { apiRequest, apiRequestWithProgress, askKnowledge, getDocumentConversations, getKnowledgeConversations, replaceContentAsset, saveDocumentConversations, saveKnowledgeConversations, type KnowledgeAskScope } from '../utils/api'
import {
  bytesToDataUrl, getKnowledgeWorkspace, invalidateContentAsset, supportsContentAsset, useContentSrc, useThumbnailSrc,
  THUMBNAIL_LIMIT, type AssetState,
} from '../utils/contentAsset'
import DocumentRenderer from '../components/DocumentRenderer'
import DocumentEditor, { type EditDraft, type EditableKind } from '../components/DocumentEditor'
// 弹窗、⋯ 浮层菜单、图标与 AI 问答页共用一套，定义在 components/OperationUI.tsx 与 operationMenu.tsx。
import { Dialog, DialogActions, DialogError, DialogField, DialogHeader, Icon, MenuAction, MenuPanel, RowMenuPopover, RowMenuTrigger } from '../components/OperationUI'
import { menuIcons, useRowMenu } from '../components/operationMenu'
import { buildExcelBytes, parseExcelFile, parseWordDocument, DOCX_MIME_TYPE } from '../utils/documentRenderer'
import { htmlToMarkdown } from '../utils/htmlToMarkdown'
import { markdownToDocxBytes } from '../utils/markdownToDocx'
import { renderAssistantBlocks } from '../utils/assistantMarkdown'

type Library = { id: number; name: string; icon: string; description: string; count: number; type?: 'personal' | 'shared' | 'subscribed' }
// url 是「网页链接」条目的外链地址：这类条目没有文件字节，点击直接在浏览器里打开该地址，
// 不进入文档预览，也不参与针对文档的问答作用域。
type ContentItem = { id: string; name: string; type: 'folder' | 'doc' | 'pdf' | 'image'; count?: number; createdAt: string; updatedAt: string; contentUpdatedAt?: string; parent?: string; src?: string; mimeType?: string; size?: number; hasAsset?: boolean; url?: string }
type Citation = { id: number; title: string; path?: string; updated?: string }
type ChatMessage = { role: 'user' | 'assistant'; text: string; citations?: Citation[]; createdAt?: string }
type Conversation = { id: string; title: string; messages: ChatMessage[]; createdAt: string; updatedAt: string }
type KnowledgeGroup = { key: string; name: string; system: boolean }
// conversations 为现用字段；messages/collectionMessages/folderMessages 为旧版本只读字段，仅用于迁移到 conversations
// assetWire >= 2 表示服务端支持「文件只存引用、按需下载」；只有拿到该标记才敢在保存时省略已有条目的 src。
type KnowledgeWorkspace = { assetWire?: number; groups?: KnowledgeGroup[]; libraries: Library[]; contents: Record<number, ContentItem[]>; conversations?: Record<string, Conversation[]>; messages?: Record<number, ChatMessage[]>; collectionMessages?: Record<string, ChatMessage[]>; folderMessages?: Record<number, ChatMessage[]> }
// 问答作用域：集合（跨集合内全部知识库）/ 文件夹（库内某个文件夹路径）/ 知识库
type QaScope =
  | { level: 'collection'; key: string; libraryIds: number[] }
  | { level: 'folder'; libraryId: number; folder: string }
  | { level: 'library'; libraryId: number }
type SortKey = 'updated' | 'created' | 'size' | 'type' | 'name'
// 一次导入批次中单个文件的进度行；viewParent 是发起导入时所处的位置（用于把进度行显示在用户当时看到的那一层），
// 与实际写入的 item.parent 可能不同（文件夹导入时文件被写进新文件夹，而进度行显示在上一层）。
type UploadTask = { id: string; libraryId: number; viewParent: string | null; name: string; size: number; phase: 'reading' | 'saving' | 'failed'; percent: number; error?: string }
type DocumentKind = 'word' | 'markdown' | 'text' | 'pdf' | 'sheet' | 'image'

const libraryCovers = [
  { id: 'neural', label: '神经网络', colors: 'from-indigo-500 to-violet-700' },
  { id: 'circuit', label: '智能芯片', colors: 'from-cyan-400 to-blue-600' },
  { id: 'matrix', label: '数据矩阵', colors: 'from-emerald-400 to-teal-700' },
  { id: 'orbit', label: '科技轨道', colors: 'from-slate-500 to-indigo-800' },
  { id: 'spark', label: '智能星芒', colors: 'from-fuchsia-400 to-purple-700' },
  { id: 'wave', label: '数字波纹', colors: 'from-blue-400 to-cyan-700' },
  { id: 'cube', label: '数据立方', colors: 'from-amber-400 to-orange-600' },
  { id: 'portal', label: '知识入口', colors: 'from-rose-400 to-red-700' },
] as const

const LibraryCover = ({ cover, className = '' }: { cover?: string; className?: string }) => {
  const selected = libraryCovers.find((item) => item.id === cover) || libraryCovers[0]
  const glyph = selected.id === 'circuit' ? <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m12 0h4M2 15h4m12 0h4" /><circle cx="12" cy="12" r="2" /></>
    : selected.id === 'matrix' ? <><path d="M5 5h4v4H5zm10 0h4v4h-4zM5 15h4v4H5zm10 0h4v4h-4z" /><path d="M9 7h6M7 9v6m10-6v6m-8 2h6" /></>
      : selected.id === 'orbit' ? <><circle cx="12" cy="12" r="2.5" /><ellipse cx="12" cy="12" rx="9" ry="4" /><ellipse cx="12" cy="12" rx="4" ry="9" transform="rotate(35 12 12)" /></>
        : selected.id === 'spark' ? <><path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2Z" /><circle cx="12" cy="12" r="2" /></>
          : selected.id === 'wave' ? <><path d="M3 8c3-4 6 4 9 0s6 4 9 0M3 16c3-4 6 4 9 0s6 4 9 0" /></>
            : selected.id === 'cube' ? <><path d="m12 2 8 4.5v11L12 22l-8-4.5v-11Z" /><path d="m4 6.5 8 5 8-5M12 11.5V22" /></>
              : selected.id === 'portal' ? <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="M12 2v4m0 12v4M2 12h4m12 0h4" /></>
                : <><circle cx="12" cy="8" r="2" /><circle cx="7" cy="16" r="2" /><circle cx="17" cy="16" r="2" /><path d="m10.8 9.6-2.6 4.8m5-4.8 2.6 4.8M9 16h6" /></>
  return <span className={`inline-flex items-center justify-center rounded-lg bg-linear-to-br ${selected.colors} text-white shadow-sm ${className}`}><Icon className="h-1/2 w-1/2">{glyph}</Icon></span>
}

const useAssistantPaneResize = (initialWidth: number) => {
  const [assistantWidth, setAssistantWidth] = useState(initialWidth)

  const startAssistantResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = assistantWidth
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMove = (moveEvent: PointerEvent) => {
      const maximumWidth = Math.floor(window.innerWidth / 2)
      const minimumWidth = Math.min(300, maximumWidth)
      setAssistantWidth(Math.max(minimumWidth, Math.min(maximumWidth, startWidth + startX - moveEvent.clientX)))
    }
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  return { assistantWidth, startAssistantResize }
}

const defaultAssistantPaneWidth = () => Math.min(Math.floor(window.innerWidth / 2), Math.max(300, Math.round(window.innerWidth / 4)))

const AssistantResizeHandle = ({ onPointerDown, className = '' }: { onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void; className?: string }) => (
  <div role="separator" aria-label="调整文档预览与 AI 助手宽度" aria-orientation="vertical" onPointerDown={onPointerDown} className={`group z-40 flex w-2 shrink-0 cursor-col-resize touch-none items-center justify-center bg-base-200/30 transition-colors hover:bg-primary/10 ${className}`}>
    <span className="h-10 w-0.5 rounded-full bg-base-content/20 transition-colors group-hover:bg-primary/60" />
  </div>
)

const AutofocusInput = (props: React.InputHTMLAttributes<HTMLInputElement>) => {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  return <input ref={inputRef} {...props} />
}

// 「新建知识库」和「修改资料」里一模一样的封面九宫格，抽出来免得两处各自漂移。
const CoverPicker = ({ value, onChange }: { value: string; onChange: (cover: string) => void }) => (
  <fieldset className="mt-4"><legend className="text-xs font-medium text-base-content/60">封面</legend>
    <div className="mt-2 grid grid-cols-4 gap-3">{libraryCovers.map((cover) => (
      <button key={cover.id} type="button" onClick={() => onChange(cover.id)} title={cover.label} aria-label={cover.label} aria-pressed={value === cover.id}
        className={`relative rounded-xl p-1 transition ${value === cover.id ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-base-200'}`}>
        <LibraryCover cover={cover.id} className="aspect-square w-full" />
        {value === cover.id && <span className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-content shadow">✓</span>}
      </button>
    ))}</div>
  </fieldset>
)

const imageFilePattern = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
const officeFilePattern = /\.(xlsx|xls|docx|doc)$/i
const maxImageSize = 10 * 1024 * 1024
const maxPdfSize = 100 * 1024 * 1024
const maxOfficeSize = 100 * 1024 * 1024
const textFilePattern = /\.(txt|md|markdown|csv|json|xml|html?)$/i

const createContentId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
  ? crypto.randomUUID()
  : `content-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

// 三种「⋯」（侧栏知识库行、内容行、分组标题行）共用 openMenuId：同一时刻只开一个。
// 内容 id 是客户端 UUID，用前缀把这三种键分开，不会撞上。
const libraryMenuKey = (libraryId: number) => `library:${libraryId}`
const sectionMenuKey = (sectionKey: string) => `section:${sectionKey}`

// 网页链接的地址解析。用户习惯只敲 example.com，缺协议头时补 https；已有协议头（含 http:）就原样尊重。
// 只负责「能不能解析成 URL」，协议白名单由调用方判——mailto: 之类也能解析成功，但不是能放进 href 的网页地址。
const parseWebLink = (input: string): URL | null => {
  const raw = input.trim()
  if (!raw) return null
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
}

// 内容时间由服务端最终写入 UTC；这里仅给刚创建、尚未回读的数据提供即时预览。
const createContentTimestamps = () => {
  const now = new Date().toISOString()
  return { createdAt: now, updatedAt: now, contentUpdatedAt: now }
}

const formatContentUpdatedAt = (value?: string) => {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  const now = new Date()
  const locale = 'zh-CN'
  const zone = 'Asia/Shanghai'
  const day = new Intl.DateTimeFormat(locale, { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
  const today = day.format(now)
  const yesterday = day.format(new Date(now.getTime() - 86_400_000))
  const hourMinute = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  const diff = now.getTime() - date.getTime()
  if (diff >= 0 && diff < 60_000) return '刚刚更新'
  if (day.format(date) === today) return `今天 ${hourMinute}`
  if (day.format(date) === yesterday) return `昨天 ${hourMinute}`
  const year = new Intl.DateTimeFormat(locale, { timeZone: zone, year: 'numeric' }).format(date)
  const currentYear = new Intl.DateTimeFormat(locale, { timeZone: zone, year: 'numeric' }).format(now)
  return new Intl.DateTimeFormat(locale, { timeZone: zone, ...(year === currentYear ? { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false } : { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) }).format(date)
}

const readFileAsDataUrl = (file: File, onProgress?: (ratio: number) => void) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  // Safari 对 readAsDataURL 可能给出 lengthComputable === false，此时不上报，进度保持不确定态。
  reader.onprogress = (event) => { if (event.lengthComputable && event.total) onProgress?.(event.loaded / event.total) }
  reader.onload = () => { onProgress?.(1); resolve(String(reader.result || '')) }
  reader.onerror = () => reject(reader.error || new Error('图片读取失败'))
  reader.readAsDataURL(file)
})

const createContentItemFromFile = async (file: File, parent?: string, options?: { id?: string; onProgress?: (ratio: number) => void }): Promise<ContentItem> => {
  const isImage = file.type.startsWith('image/') || imageFilePattern.test(file.name)
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  const isOffice = officeFilePattern.test(file.name)
  const isText = file.type.startsWith('text/') || /^(application\/(json|xml))$/.test(file.type) || textFilePattern.test(file.name)
  const type: ContentItem['type'] = isImage ? 'image' : isPdf ? 'pdf' : 'doc'
  // 只有这几类会把内容内联为 data URL；其余（zip/pptx 等）不读文件，需补一次完成回调，否则进度行永远停在 0%。
  const inlineSource = isImage || isPdf || isText || isOffice
  const src = inlineSource ? await readFileAsDataUrl(file, options?.onProgress) : undefined
  if (!inlineSource) options?.onProgress?.(1)
  return {
    id: options?.id || createContentId(),
    name: file.name,
    type,
    ...createContentTimestamps(),
    ...(parent ? { parent } : {}),
    ...(src != null ? { src, mimeType: file.type || (isPdf ? 'application/pdf' : isText ? 'text/plain' : isOffice ? 'application/octet-stream' : 'image/*'), size: file.size } : {}),
  }
}

const formatFileSize = (size?: number) => !size ? '' : size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`

// 保存载荷的白名单序列化。两个作用：
// 1. 服务端已经有字节的条目（hasAsset）不再回传 src —— 否则每次重命名/删除都要把整库 base64 重传一遍。
// 2. src 只允许是 data: —— 水合层产出的 blob: URL 一旦落库就会被存成一串几十字节的假地址，真字节永久丢失。
//    这里是结构性的闸门，不依赖调用方自觉。
const serializeContentItem = (item: ContentItem) => ({
  id: item.id,
  name: item.name,
  type: item.type,
  ...(item.count != null ? { count: item.count } : {}),
  ...(item.parent != null ? { parent: item.parent } : {}),
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  ...(item.contentUpdatedAt ? { contentUpdatedAt: item.contentUpdatedAt } : {}),
  ...(item.mimeType ? { mimeType: item.mimeType } : {}),
  ...(item.size != null ? { size: item.size } : {}),
  ...(item.hasAsset ? { hasAsset: true } : {}),
  ...(!item.hasAsset && item.src?.startsWith('data:') ? { src: item.src } : {}),
  ...(item.url ? { url: item.url } : {}),
})

// 保存成功后把内联的 base64 从本地状态里摘掉，换成一个 hasAsset 标记。
// 回读本会覆盖 contentMap，但这覆盖不到「被更高版本取代」和「回读失败」两条提前返回的路径；
// 少了它，100MB 文件的 base64 会一直挂在 React state 里，下一次保存又原样重传。
// 只摘这次真正进过 payload 的条目（savedIds），不会碰此后新加入、尚未落库的内容。
const stripSavedSources = (contents: Record<number, ContentItem[]>, savedIds: Set<string>) => Object.fromEntries(
  Object.entries(contents).map(([libraryId, items]) => [
    libraryId,
    items.map((item) => savedIds.has(item.id) && item.src ? { ...item, src: undefined, hasAsset: true } : item),
  ])
)

// 进度上报节流：整数百分比变化且距上次 >120ms 才上报，避免大文件触发上百次全列表重渲染。
// 丢弃小于上次的值——请求失败回退到 defaultApiUrl 重传时 XHR 会从 0 重来，百分比不能倒退。
const makeProgressReporter = (report: (percent: number) => void) => {
  let lastPercent = -1
  let lastAt = -Infinity
  return (ratio: number) => {
    const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)))
    if (percent < lastPercent) return
    const now = performance.now()
    // 100% 必须放行，否则最后一个跳动会被 120ms 阈值吃掉，进度行卡在 99%。
    if (percent !== 100 && (percent === lastPercent || now - lastAt < 120)) return
    lastPercent = percent
    lastAt = now
    report(percent)
  }
}

const formatMessageTime = (value?: string) => {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

const createConversationId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
  ? crypto.randomUUID()
  : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const truncateTitle = (text: string) => (text.length > 20 ? `${text.slice(0, 20)}…` : text)

const formatConversationTime = (value?: string) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return date.toLocaleDateString('zh-CN')
}

// 迁移：旧版本把每个 scope 存为单一扁平消息数组（messages/collectionMessages/folderMessages），
// 现统一为 conversationsByScope（每个 scope 一个会话数组）。有 conversations 字段则直接用，否则包装旧数据。
const normalizeConversations = (data: KnowledgeWorkspace): Record<string, Conversation[]> => {
  if ('conversations' in data && data.conversations) return data.conversations
  const result: Record<string, Conversation[]> = {}
  const wrap = (key: string, msgs: ChatMessage[]) => {
    if (!msgs.length) return
    const last = msgs[msgs.length - 1]
    const at = last?.createdAt || new Date().toISOString()
    result[key] = [{ id: createConversationId(), title: truncateTitle(msgs.find((m) => m.role === 'user')?.text ?? '历史对话'), messages: msgs, createdAt: at, updatedAt: at }]
  }
  Object.entries(data.messages ?? {}).forEach(([id, msgs]) => wrap(`library:${id}`, msgs))
  Object.entries(data.collectionMessages ?? {}).forEach(([key, msgs]) => wrap(`collection:${key}`, msgs))
  Object.entries(data.folderMessages ?? {}).forEach(([key, msgs]) => wrap(key, msgs))
  return result
}

// 问答记录持久化：每次会话状态变更后调用（外部后端 MySQL 契约，见 docs/knowledge-conversations-api.md）。
// 后端未实现/网络失败时静默降级为内存态，不影响问答。
// 串行化 save chain：replace-all 语义下避免两次 POST 乱序把较旧快照写回。
let conversationsSaveChain: Promise<unknown> = Promise.resolve()
const persistConversations = (nextMap: Record<string, Conversation[]>) => {
  conversationsSaveChain = conversationsSaveChain
    .catch(() => {})
    .then(() => saveKnowledgeConversations(nextMap))
    .catch(() => {})
}

const getDocumentKind = (item: ContentItem): DocumentKind => {
  if (item.type === 'image' || imageFilePattern.test(item.name)) return 'image'
  if (item.type === 'pdf' || /\.pdf$/i.test(item.name)) return 'pdf'
  if (/\.(xlsx?|csv)$/i.test(item.name)) return 'sheet'
  if (/\.(md|markdown)$/i.test(item.name) || item.mimeType === 'text/markdown') return 'markdown'
  if (/\.(txt|md|markdown|json|xml|html?)$/i.test(item.name) || item.mimeType?.startsWith('text/')) return 'text'
  return 'word'
}

const documentKindMeta: Record<DocumentKind, { short: string; label: string; badge: string; accent: string }> = {
  word: { short: 'DOC', label: 'Word 文档', badge: 'bg-blue-50 text-blue-600', accent: 'text-blue-600' },
  markdown: { short: 'MD', label: 'Markdown 文档', badge: 'bg-sky-50 text-sky-700', accent: 'text-sky-700' },
  text: { short: 'TXT', label: '文本文件', badge: 'bg-slate-100 text-slate-600', accent: 'text-slate-600' },
  pdf: { short: 'PDF', label: 'PDF 文档', badge: 'bg-red-50 text-red-500', accent: 'text-red-500' },
  sheet: { short: 'XLS', label: 'Excel 表格', badge: 'bg-emerald-50 text-emerald-600', accent: 'text-emerald-600' },
  image: { short: 'IMG', label: '图片', badge: 'bg-fuchsia-50 text-fuchsia-600', accent: 'text-fuchsia-600' },
}

// 可在线编辑的类型。刻意排除几种：.doc 走 mammoth 必然解析失败（它只认 OOXML）；
// .xls 我们只能写回 xlsx 字节，顶着 .xls 的扩展名会让用户以为自己拿到的是老格式。
const editableKindOf = (item: ContentItem, assetReady: boolean): EditableKind | null => {
  if (!assetReady || /\.(pdf|doc|xls)$/i.test(item.name)) return null
  const kind = getDocumentKind(item)
  return kind === 'pdf' || kind === 'image' ? null : kind
}

// 文本类写回时的 MIME：优先沿用条目原有的类型，缺失或退化成八位字节流时按扩展名补。
const textMimeTypeFor = (name: string, current?: string) => {
  if (current && current !== 'application/octet-stream') return current
  const lower = name.toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.xml')) return 'application/xml'
  if (/\.html?$/.test(lower)) return 'text/html'
  if (lower.endsWith('.csv')) return 'text/csv'
  return 'text/plain'
}

// 草稿 → 回写的字节。size 跟着实际字节走，否则列表页显示的体积会和内容对不上。
const buildAssetPayload = async (draft: EditDraft, item: ContentItem) => {
  if (draft.kind === 'sheet') {
    const { bytes, mimeType } = buildExcelBytes(draft.sheets, item.name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx')
    return { src: bytesToDataUrl(bytes, mimeType), mimeType, size: bytes.length }
  }
  if (draft.kind === 'word') {
    const bytes = await markdownToDocxBytes(draft.markdown)
    return { src: bytesToDataUrl(bytes, DOCX_MIME_TYPE), mimeType: DOCX_MIME_TYPE, size: bytes.length }
  }
  const bytes = new TextEncoder().encode(draft.text)
  const mimeType = textMimeTypeFor(item.name, item.mimeType)
  return { src: bytesToDataUrl(bytes, mimeType), mimeType, size: bytes.length }
}

// 第三方应用不解析 Markdown 源码。纯文本降级时去掉格式标记，同时保留列表和标题层次。
const assistantMarkdownToPlainText = (text: string) => text
  .replace(/(根据|依据|参照|参考)\s*(资料|文档|内容|信息)?\s*(：|:)?\s*\[\s*\d+(?:\s*,\s*\d+)*\s*\]\s*/gi, '')
  .replace(/(根据|依据|参照|参考)\s*(资料|文档|内容|信息)?\s*(：|:)?\s*/gi, '')
  .replace(/\[(\d+)\]/g, '')
  .replace(/^#{1,3}\s+(.+)$/gm, '$1')
  // 全角空格可避免微信等纯文本编辑器吞掉多级列表的行首缩进。
  .replace(/^(\s*)[-*+]\s+/gm, (_match, indent: string) => `${'　'.repeat(Math.floor(indent.replace(/\t/g, '  ').length / 2))}• `)
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\r\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()
  // 清理模型偶尔生成的句首逗号/冒号；放在 Markdown 转换后，避免影响标题和列表识别。
  .replace(/^[,，。；;：:、]+\s*/u, '')

const escapeClipboardHtml = (text: string) => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const assistantInlineToClipboardHtml = (text: string) => escapeClipboardHtml(text)
  .replace(/`([^`]+)`/g, '<code style="font-family:monospace;background:#f2f3f5;border-radius:4px;padding:1px 4px">$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:700">$1</strong>')

type ClipboardListItem = { text: string; depth: number; ordered: boolean; children: ClipboardListItem[] }

const renderClipboardList = (items: ClipboardListItem[], ordered = items[0]?.ordered ?? false): string => {
  const tag = ordered ? 'ol' : 'ul'
  const style = ordered ? 'margin:6px 0;padding-left:24px' : 'margin:6px 0;padding-left:24px;list-style-type:disc'
  return `<${tag} style="${style}">${items.map((item) => `<li style="margin:3px 0">${assistantInlineToClipboardHtml(item.text)}${item.children.length ? renderClipboardList(item.children, item.children[0].ordered) : ''}</li>`).join('')}</${tag}>`
}

// 为跨应用粘贴生成自包含 HTML：使用真实 h1/h2/h3、嵌套列表和内联样式，不依赖本站 CSS。
const assistantMarkdownToClipboardHtml = (text: string) => {
  const source = text
    .replace(/\r\n/g, '\n')
    .replace(/\[(\d+)\]/g, '')
    .trim()
    .replace(/^[,，。；;：:、]+\s*/u, '')
  const lines = source.split('\n')
  const html: string[] = []

  for (let index = 0; index < lines.length;) {
    const trimmed = lines[index].trim()
    if (!trimmed) { index += 1; continue }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const sizes = ['22px', '18px', '16px']
      html.push(`<h${level} style="font-size:${sizes[level - 1]};font-weight:700;line-height:1.5;margin:12px 0 6px">${assistantInlineToClipboardHtml(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    const firstListItem = lines[index].match(/^(\s*)(?:([-*+])|(\d+)[.、)])\s+(.+)$/)
    if (firstListItem) {
      const roots: ClipboardListItem[] = []
      const parents: ClipboardListItem[] = []
      while (index < lines.length) {
        const match = lines[index].match(/^(\s*)(?:([-*+])|(\d+)[.、)])\s+(.+)$/)
        if (!match) break
        const requestedDepth = Math.floor(match[1].replace(/\t/g, '  ').length / 2)
        const depth = Math.min(requestedDepth, parents.length)
        const item: ClipboardListItem = { text: match[4].trim(), depth, ordered: Boolean(match[3]), children: [] }
        if (depth === 0) roots.push(item)
        else parents[depth - 1].children.push(item)
        parents[depth] = item
        parents.length = depth + 1
        index += 1
      }
      html.push(renderClipboardList(roots, roots[0]?.ordered))
      continue
    }

    html.push(`<p style="font-size:14px;line-height:1.8;margin:6px 0">${assistantInlineToClipboardHtml(trimmed)}</p>`)
    index += 1
  }
  return `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#1f2329">${html.join('')}</div>`
}

const formatAssistantText = (text: string) => {
  // 语义处理留在本页：去掉“根据资料[…]”声明与正文内引用标记后再交给共享排版模块渲染。
  const sanitizedText = text
    .replace(/(根据|依据|参照|参考)\s*(资料|文档|内容|信息)?\s*(：|:)?\s*\[\s*\d+(?:\s*,\s*\d+)*\s*\]\s*/gi, '')
    .replace(/(根据|依据|参照|参考)\s*(资料|文档|内容|信息)?\s*(：|:)?\s*/gi, '')
    .replace(/\[(\d+)\]/g, '')
    // 只清理普通句首分隔符，不能吞掉首行的 Markdown 标题/列表标记。
    .replace(/^[\s,，。；;：:]+(?=\S)/u, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return renderAssistantBlocks(sanitizedText, { stripRefNumbers: true })
}

type MessageBubbleProps = {
  message: ChatMessage
  bubbleClass?: string
  index?: number
  onEdit?: (message: ChatMessage, index: number) => void
  isEditing?: boolean
  editValue?: string
  onEditChange?: (value: string) => void
  onCancelEdit?: () => void
  onSubmitEdit?: () => void
}

const MessageBubble = ({ message, bubbleClass = 'max-w-full px-0 py-1', index = 0, onEdit, isEditing = false, editValue = '', onEditChange, onCancelEdit, onSubmitEdit }: MessageBubbleProps) => {
  const [copied, setCopied] = useState(false)
  const messageContentRef = useRef<HTMLDivElement>(null)

  const handleCopy = async () => {
    let success = false
    const plainText = message.role === 'assistant' ? assistantMarkdownToPlainText(message.text) : message.text
    try {
      // 同时写入 text/html 与 text/plain：飞书等支持富文本的应用可保留标题、加粗和列表，
      // 微信等只接收纯文本的应用也不会再显示 Markdown 星号、井号和反引号。
      if (message.role === 'assistant' && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        const html = assistantMarkdownToClipboardHtml(message.text)
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plainText], { type: 'text/plain' }),
        })])
        success = true
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(plainText)
        success = true
      }
    } catch {
      // 非 HTTPS 或浏览器拒绝剪贴板权限时，继续使用兼容方案。
    }
    if (!success) {
      const textarea = document.createElement('textarea')
      textarea.value = plainText
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'fixed'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      try {
        success = document.execCommand('copy')
      } catch {
        success = false
      } finally {
        document.body.removeChild(textarea)
      }
    }
    if (success) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    }
  }

  const isUser = message.role === 'user'
  const createdAtLabel = formatMessageTime(message.createdAt)
  const copyButton = (
    <button type="button" onClick={handleCopy} className={`flex items-center gap-1 rounded-lg p-1.5 text-base-content/55 transition hover:bg-base-200 hover:text-base-content ${copied ? 'px-2 text-primary' : ''}`} title={copied ? '复制成功' : '复制内容'} aria-label={copied ? '复制成功' : '复制内容'}>
      {copied ? <Icon className="h-3.5 w-3.5"><path d="m5 13 4 4L19 7" /></Icon> : <Icon className="h-4 w-4"><rect x="8" y="3" width="12" height="13" rx="2.5" /><rect x="4" y="8" width="12" height="13" rx="2.5" /></Icon>}
      {copied ? <span className="whitespace-nowrap text-xs" role="status" aria-live="polite">复制成功</span> : null}
    </button>
  )

  return <div className={`group/message flex ${isUser ? 'justify-end' : 'justify-start'}`}>
    <div className={`flex min-w-0 flex-col ${isUser && !isEditing ? 'max-w-[85%] items-end' : 'w-full items-start'} ${isEditing ? 'w-full' : ''}`}>
      {isEditing ? <div className="ml-auto w-full max-w-3xl rounded-3xl bg-base-200/80 p-3 shadow-sm">
        <textarea autoFocus value={editValue} onChange={(event) => onEditChange?.(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && editValue.trim()) onSubmitEdit?.() }} rows={3} className="min-h-20 w-full resize-none bg-transparent px-1 text-sm leading-7 text-base-content outline-none" aria-label="编辑消息" />
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onCancelEdit} className="rounded-full border border-base-300 bg-base-100 px-4 py-2 text-sm font-medium text-base-content transition hover:bg-base-200">取消</button>
          <button type="button" onClick={onSubmitEdit} disabled={!editValue.trim()} className="rounded-full bg-base-content px-4 py-2 text-sm font-medium text-base-100 transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35">发送</button>
        </div>
      </div> : <>
      <div className={`text-sm leading-6 ${isUser ? 'rounded-3xl bg-base-200 text-base-content' : 'w-full bg-transparent text-base-content'}`}>
        <div ref={messageContentRef} className={isUser ? 'px-4 py-2.5' : bubbleClass}>
          {message.role === 'assistant' ? formatAssistantText(message.text) : <p className="wrap-anywhere whitespace-pre-wrap text-sm leading-7">{message.text}</p>}
        </div>
      </div>
      <div className={`mt-2 flex items-center gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div className={`flex items-center gap-0.5 transition-opacity ${isUser ? `ml-auto opacity-100 sm:opacity-0 sm:group-hover/message:opacity-100 sm:focus-within:opacity-100 ${copied ? 'sm:opacity-100' : ''}` : ''}`}>
          {!isUser ? (
            copyButton
          ) : (
            <>
              {copyButton}
              {onEdit ? <button type="button" onClick={() => onEdit(message, index)} className="rounded-lg p-1.5 text-base-content/55 transition hover:bg-base-200 hover:text-base-content" title="编辑消息" aria-label="编辑消息"><Icon className="h-4 w-4"><path d="M13.5 6.5 17.5 10.5" /><path d="M4 20h4l11-11a2.83 2.83 0 0 0-4-4L4 16v4Z" /></Icon></button> : null}
            </>
          )}
        </div>
        <p className={`text-[10px] ${isUser ? 'text-right text-base-content/45' : 'text-left text-base-content/35'}`}>{createdAtLabel}</p>
      </div>
      {message.role === 'assistant' && message.citations?.length ? (
        <div className="mt-2 border-t border-base-300/70 pt-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-base-content/40">参考资料</p>
          <ul className="space-y-1">
            {message.citations.map((citation) => (
              <li key={citation.id} className="flex items-start gap-1.5 text-xs leading-5">
                <span className="shrink-0 font-semibold text-primary">[{citation.id}]</span>
                <span className="min-w-0">
                  <span className="font-medium text-base-content/85">{citation.title}</span>
                  {citation.path ? <span className="text-base-content/45"> · {citation.path}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      </>}
    </div>
  </div>
}

const platformDeliveryWorkbookSheets = [
  { name: '方案一各平台配置', src: '/knowledge-previews/platform-pre-delivery/plan-1-config.png' },
  { name: '方案一的合计', src: '/knowledge-previews/platform-pre-delivery/plan-1-total.png' },
  { name: '方案二各平台配置', src: '/knowledge-previews/platform-pre-delivery/plan-2-config.png' },
  { name: '方案二的合计', src: '/knowledge-previews/platform-pre-delivery/plan-2-total.png' },
]

const getWorkbookSheetPreviews = (item: ContentItem) =>
  item.name === '平台预交付配置清单_0728.xlsx' ? platformDeliveryWorkbookSheets : []

const behaviorLabManualPages = Array.from({ length: 6 }, (_, index) =>
  `/knowledge-previews/behavior-lab-manual/page-${index + 1}.png`)

const getDocumentPagePreviews = (item: ContentItem) =>
  item.name === '行为实验室剪辑工具使用手册.docx' ? behaviorLabManualPages : []

const DocumentTypeBadge = ({ item, size = 'md' }: { item: ContentItem; size?: 'sm' | 'md' }) => {
  const meta = documentKindMeta[getDocumentKind(item)]
  return <span className={`flex shrink-0 items-center justify-center rounded-lg font-bold ${meta.badge} ${size === 'sm' ? 'h-7 min-w-7 px-1 text-[9px]' : 'h-9 min-w-9 px-1.5 text-[10px]'}`}>{meta.short}</span>
}

// 列表行缩略图。文件字节不在工作区里，按需下载后再显示；没取到（加载中/过大/失败）就退回类型徽章。
// 单独抽成 memo 组件：缩略图陆续到达时只重渲染这一行，不会牵动整页上千行 JSX。
const ContentRowThumb = memo(({ item, enabled }: { item: ContentItem; enabled: boolean }) => {
  // hook 必须无条件调用；网页链接没有字节，返回值必定是 unavailable，这里只是先用掉这次调用。
  const asset = useThumbnailSrc(item, enabled)
  // 链接条目要走在地无扩展名的域名上，落到 getDocumentKind 会被判成 Word 而显示 "DOC" 徽章，所以在缩略图之前拦下。
  if (item.url) return <span className="flex h-9 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600"><Icon className="h-4 w-4"><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1" /></Icon></span>
  if (asset.status === 'ready') return <img src={asset.url} alt="" className="h-9 w-10 shrink-0 rounded-lg border border-base-200 object-cover" />
  return <DocumentTypeBadge item={item} />
})
ContentRowThumb.displayName = 'ContentRowThumb'

// 水合失败/无字节时统一的红色提示块，视觉与 DocumentRenderer 的解析失败态一致。
const AssetErrorNotice = ({ title, detail }: { title: string; detail?: string }) => (
  <div className="mx-auto flex min-h-130 max-w-215 flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 text-sm text-red-600">
    <div className="text-center">
      <p className="mb-2 text-lg font-medium">{title}</p>
      {detail && <p>{detail}</p>}
    </div>
  </div>
)

const DocumentPreviewCanvas = ({ item, zoom, sheetIndex, onSheetChange, onPageCountChange, onCurrentPageChange }: { item: ContentItem; zoom: number; sheetIndex: number; onSheetChange: (index: number) => void; onPageCountChange?: (pageCount: number) => void; onCurrentPageChange?: (page: number) => void }) => {
  const kind = getDocumentKind(item)
  const meta = documentKindMeta[kind]
  const title = item.name.replace(/\.(docx?|pdf|xlsx?|csv|txt|md|markdown|json|xml|html?)$/i, '')
  const scale = zoom / 100
  // 文件字节不在工作区里，这里按需取回（内联 data: 直接命中，已落库的走下载端点 → blob: URL）。
  // 打开期间 refs 保持 > 0，缓存回收不会把这一个撤掉，PDF 的 iframe 内部重载才不会拿到失效地址。
  const asset: AssetState = useContentSrc(item)
  const src = asset.status === 'ready' ? asset.url : undefined
  const failed = asset.status === 'error' || asset.status === 'unavailable'

  if (kind === 'image') {
    if (failed) return <AssetErrorNotice title="图片加载失败" detail={asset.status === 'error' ? asset.error : '该条目没有可用的文件内容'} />
    if (!src) return <div className="mx-auto flex min-h-130 max-w-215 items-center justify-center rounded-lg border border-base-300 bg-base-100 text-sm text-base-content/40 shadow-sm">图片正在加载，完成后将在这里显示原图。</div>
    return <figure className="mx-auto overflow-hidden rounded-xl border border-base-300 bg-base-100 transition-[width,max-width] duration-150" style={{ width: `${scale * 100}%`, maxWidth: `${1200 * scale}px` }}>
      <div className="flex min-h-105 items-center justify-center bg-[linear-gradient(45deg,#f3f4f6_25%,transparent_25%),linear-gradient(-45deg,#f3f4f6_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f3f4f6_75%),linear-gradient(-45deg,transparent_75%,#f3f4f6_75%)] bg-size-[20px_20px] bg-position-[0_0,0_10px,10px_-10px,-10px_0px] p-5">
        <img src={src} alt={item.name} className="block h-auto max-h-[calc(100vh-220px)] max-w-full object-contain" draggable={false} />
      </div>
      <figcaption className="flex items-center justify-between border-t border-base-200 px-4 py-3 text-xs text-base-content/45"><span className="truncate">{item.name}</span><span className="ml-4 shrink-0">{item.mimeType || '图片'}{item.size ? ` · ${formatFileSize(item.size)}` : ''}</span></figcaption>
    </figure>
  }

  if (kind === 'pdf') {
    if (failed) return <AssetErrorNotice title="PDF 加载失败" detail={asset.status === 'error' ? asset.error : '该条目没有可用的文件内容'} />
    if (!src) return <div className="mx-auto flex min-h-130 max-w-215 items-center justify-center rounded-lg border border-base-300 bg-base-100 text-sm text-base-content/40 shadow-sm">PDF 文件正在加载，完成后将在这里显示全部页面。</div>
    return <div className="mx-auto h-[calc(100vh-180px)] min-h-155 w-full max-w-300 overflow-hidden rounded-xl border border-base-300 bg-base-100">
      <iframe src={src} title={`${item.name} PDF 预览`} className="h-full w-full border-0" />
    </div>
  }

  // Excel / Word / Markdown / 文本：水合中也要挂载 DocumentRenderer，它会自己渲染「正在解析文档...」占位。
  if ((kind === 'sheet' || kind === 'word' || kind === 'markdown' || kind === 'text') && (src || asset.status === 'loading')) {
    return <div className="mx-auto origin-top transition-transform duration-150" style={{ transform: `scale(${scale})`, width: `${100 / scale}%` }}>
      <div className="min-w-0 bg-base-100">
        <DocumentRenderer item={item} src={src} onPageCountChange={onPageCountChange} onCurrentPageChange={onCurrentPageChange} />
      </div>
    </div>
  }

  // 真实文件取回失败：明确报错，不要落到下面那些按文件名硬编码的占位预览上假装成功。
  // 'unavailable' 不走这里——那些是本来就没有文件内容的占位条目，下面的兜底才是它们该有的样子。
  if (asset.status === 'error') return <AssetErrorNotice title="文档加载失败" detail={asset.error} />

  // 对于 Excel 预览图片的情况（向后兼容）
  if (kind === 'sheet') {
    const sheets = getWorkbookSheetPreviews(item)
    const activeSheet = sheets[sheetIndex] || sheets[0]
    if (!activeSheet) return <div className="mx-auto flex min-h-130 max-w-190 items-center justify-center rounded-lg border border-base-300 bg-base-100 text-sm text-base-content/40 shadow-sm">Excel 文件正在解析，完成后将在这里显示真实工作表。</div>

    return <div className="mx-auto origin-top transition-transform duration-150" style={{ transform: `scale(${scale})`, width: `${100 / scale}%` }}>
      <div className="min-w-280 overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-sm">
        <div className="border-b border-base-200 bg-base-100 px-4 py-3">
          <p className="truncate text-xs text-base-content/40">{item.name} · {activeSheet.name}</p>
        </div>
        <div className="bg-[#f7f8f9] p-3">
          <img src={activeSheet.src} alt={`${item.name} - ${activeSheet.name}`} className="block h-auto w-full select-none bg-white" draggable={false} />
        </div>
        <div className="flex h-11 items-end gap-0.5 overflow-x-auto border-t border-base-300 bg-[#f3f4f5] px-4">
          {sheets.map((sheet, index) => <button key={sheet.name} onClick={() => onSheetChange(index)} className={`h-10 shrink-0 border-x border-t px-4 text-xs transition ${index === sheetIndex ? 'border-base-300 bg-base-100 font-medium text-emerald-700' : 'border-transparent text-base-content/55 hover:bg-base-200'}`}>{sheet.name}</button>)}
          <span className="px-3 pb-2 text-lg text-base-content/35">＋</span>
        </div>
      </div>
    </div>
  }

  // 对于 Word 预览图片的情况（向后兼容）
  const documentPages = getDocumentPagePreviews(item)
  if (kind === 'word' && documentPages.length > 0) {
    return <div className="mx-auto flex flex-col gap-6 transition-[width,max-width] duration-150" style={{ width: `${scale * 100}%`, maxWidth: `${840 * scale}px` }}>
        {documentPages.map((page, index) => <figure key={page} className="overflow-hidden rounded-sm border border-base-300 bg-base-100 shadow-sm">
          <img src={page} alt={`${item.name} - 第 ${index + 1} 页`} className="block h-auto w-full select-none" draggable={false} loading={index > 1 ? 'lazy' : 'eager'} />
          <figcaption className="border-t border-base-200 px-3 py-2 text-center text-[11px] text-base-content/35">第 {index + 1} / {documentPages.length} 页</figcaption>
        </figure>)}
    </div>
  }

  // 默认占位符（无 src 和 预览页面）
  return <div className="mx-auto origin-top transition-transform duration-150" style={{ transform: `scale(${scale})`, width: `${100 / scale}%` }}>
    <article className="mx-auto min-h-190 max-w-190 rounded-sm border border-base-200 bg-base-100 px-12 py-14 shadow-sm md:px-16">
      <div className="mb-10 flex items-center justify-between text-xs text-base-content/35"><span>{meta.label} · {formatContentUpdatedAt(item.updatedAt)}</span><span>第 1 页</span></div>
      <h1 className="text-3xl font-semibold leading-tight tracking-tight text-base-content">{title}</h1>
      <div className="my-8 h-px bg-base-200" />
      <div className="space-y-5 text-[15px] leading-8 text-base-content/65">
        <p>该文档已收录到当前知识库，可在此进行阅读、检索，并作为知识问答的可信来源。</p>
        <h2 className="pt-3 text-xl font-semibold text-base-content">文档概览</h2>
        <p>文档预览支持保持原有标题层级、正文段落和分页结构。解析服务接入后，这里将展示文件中的真实内容、图片和表格。</p>
        <div className="rounded-xl border-l-4 border-blue-400 bg-base-200/40 px-5 py-4"><p className="text-sm">你可以在右侧知识助手中总结文档、提取重点，或针对当前文档继续提问。</p></div>
        <h2 className="pt-3 text-xl font-semibold text-base-content">主要内容</h2>
        <p>预览区域将根据页面宽度自动居中，支持缩放和适应页面，阅读过程中不会影响左侧知识库与内容列表的操作。</p>
      </div>
    </article>
  </div>
}

export function KnowledgeDocument() {
  const [lookup] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const type = params.get('type')
    return {
      // 带 id 的链接（新版本生成的）可以直接按 content_key 取文件；老链接没有 id，退回按名字匹配工作区。
      id: params.get('id') || '',
      mimeType: params.get('mimeType') || undefined,
      size: params.get('size') ? Number(params.get('size')) : undefined,
      name: params.get('name') || '未命名文档',
      type: type === 'pdf' ? 'pdf' as const : type === 'image' ? 'image' as const : 'doc' as const,
      updatedAt: params.get('updatedAt') || new Date().toISOString(),
      library: params.get('library') || '知识库',
      libraryId: Number(params.get('libraryId') || 0),
      parent: params.get('parent') || undefined,
    }
  })
  const [item, setItem] = useState<ContentItem>(() => ({
    id: lookup.id || createContentId(),
    name: lookup.name,
    type: lookup.type,
    createdAt: lookup.updatedAt,
    updatedAt: lookup.updatedAt,
    parent: lookup.parent,
    ...(lookup.mimeType ? { mimeType: lookup.mimeType } : {}),
    ...(lookup.size != null ? { size: lookup.size } : {}),
    // 链接里带了 id 就说明这个条目有内容可取，交给水合层去下载。
    ...(lookup.id ? { hasAsset: true } : {}),
  }))
  const libraryName = lookup.library
  const [previewZoom, setPreviewZoom] = useState(100)
  const [previewSheetIndex, setPreviewSheetIndex] = useState(0)
  const [renderedPageCount, setRenderedPageCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [assistantOpen, setAssistantOpen] = useState(true)
  const [question, setQuestion] = useState('')
  const [documentConversations, setDocumentConversations] = useState<Conversation[]>([])
  const [activeDocumentConversationId, setActiveDocumentConversationId] = useState<string | null>(null)
  const [documentHistoryOpen, setDocumentHistoryOpen] = useState(false)
  const [documentHistoryLoaded, setDocumentHistoryLoaded] = useState(false)
  const [asking, setAsking] = useState(false)
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const { assistantWidth, startAssistantResize } = useAssistantPaneResize(defaultAssistantPaneWidth())
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeDocumentConversation = documentConversations.find((conversation) => conversation.id === activeDocumentConversationId) ?? documentConversations[0] ?? null
  const messages = activeDocumentConversation?.messages ?? []
  const kind = getDocumentKind(item)
  const pageCount = renderedPageCount || getDocumentPagePreviews(item).length
  const sheetCount = getWorkbookSheetPreviews(item).length
  const handlePageCountChange = useCallback((nextPageCount: number) => {
    setRenderedPageCount((current) => current === nextPageCount ? current : nextPageCount)
  }, [])

  // 文件字节由水合层按需取回，item.src 通常一直是空的，所以这里盯的是解析出来的地址。
  const documentAsset = useContentSrc(item)
  const documentSrc = documentAsset.status === 'ready' ? documentAsset.url : undefined

  // —— 编辑态 ——
  // 独立页是另一个浏览器标签页，编辑态自成一套，不复用列表页的任何状态。
  const [editing, setEditing] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const editableKind = editableKindOf(item, documentAsset.status === 'ready')

  // 字节不必重下：documentSrc 就是已水合的 blob: URL，直接喂给解析器。
  const beginEdit = async () => {
    if (!documentSrc || !editableKind || editLoading) return
    setEditLoading(true)
    setSaveError(null)
    try {
      if (editableKind === 'sheet') {
        const sheets = await parseExcelFile(documentSrc)
        if (!sheets.length) throw new Error('该文件没有可编辑的工作表')
        setDraft({ kind: 'sheet', sheets, activeSheet: 0 })
      } else if (editableKind === 'word') {
        // Word 以 Markdown 为编辑面：mammoth 只负责 DOCX→HTML，这里再降一层。
        const parsed = await parseWordDocument(documentSrc)
        setDraft({ kind: 'word', markdown: htmlToMarkdown(parsed.html) })
      } else {
        const response = await fetch(documentSrc)
        if (!response.ok) throw new Error(`文件读取失败（${response.status}）`)
        setDraft({ kind: 'text', text: await response.text() })
      }
      setDirty(false)
      setEditing(true)
    } catch (error) {
      // 打不开编辑器就只报错，不进入编辑态 —— 没有草稿的空编辑器比错误提示更让人困惑。
      setSaveError(error instanceof Error ? error.message : '无法打开编辑器')
    } finally {
      setEditLoading(false)
    }
  }

  const cancelEdit = () => {
    if (dirty && !window.confirm('放弃未保存的修改？')) return
    setEditing(false)
    setDraft(null)
    setDirty(false)
    setSaveError(null)
  }

  // 身份必须稳定：它是编辑器的 SheetRow memo 唯一能拦住的依赖。
  const handleDraftChange = useCallback((updater: (current: EditDraft) => EditDraft) => {
    setDraft((current) => (current ? updater(current) : current))
    setDirty(true)
  }, [])

  const saveEdit = async () => {
    // 认 item.id 而不是 lookup.id：老链接不带 id，但条目可能已经从工作区里按名字匹配回来了，
    // 这时真正的 content_key 在 item 上，用 lookup.id 会静默什么都不做。
    if (!draft || !item.id || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload = await buildAssetPayload(draft, item)
      const result = await replaceContentAsset(item.id, payload)
      if (!result.success) throw new Error(result.error || '保存失败')
      // 缓存里还是覆盖前的字节，而 id / src / hasAsset 一个都没变，
      // 不主动失效的话预览会一直停在旧内容上。
      invalidateContentAsset(item.id)
      const stamp = result.data?.contentUpdatedAt ?? new Date().toISOString()
      setItem((current) => ({ ...current, mimeType: payload.mimeType, size: payload.size, updatedAt: stamp, contentUpdatedAt: stamp }))
      setEditing(false)
      setDraft(null)
      setDirty(false)
    } catch (error) {
      // 失败时保留草稿与编辑态：用户改了半天的东西不能因为一次网络抖动就丢掉。
      setSaveError(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  useEffect(() => {
    setRenderedPageCount(0)
    setCurrentPage(1)
  }, [item.id, documentSrc, item.name])

  useEffect(() => {
    // 链接里带了 content_key 就不必再拉整个工作区——文件本身已经能按需下载。
    if (lookup.id) return
    if (!lookup.libraryId) return
    let cancelled = false
    void getKnowledgeWorkspace<KnowledgeWorkspace>().then((result) => {
      if (cancelled || !result.success || !result.data) return
      const matched = (result.data.contents?.[lookup.libraryId] || []).find((candidate) =>
        candidate.name === lookup.name && (candidate.parent || '') === (lookup.parent || ''))
      if (matched) setItem(matched)
    })
    return () => { cancelled = true }
  }, [lookup.id, lookup.libraryId, lookup.name, lookup.parent])

  useEffect(() => {
    if (!lookup.libraryId) return
    let cancelled = false
    void getDocumentConversations(lookup.libraryId, lookup.name, lookup.parent || '').then((result) => {
      if (cancelled) return
      const conversations = (result.success ? (result.data?.conversations || []) : []).map((conversation) => {
        const firstQuestion = conversation.messages.find((message) => message.role === 'user')?.text
        return conversation.title === '新对话' && firstQuestion ? { ...conversation, title: truncateTitle(firstQuestion) } : conversation
      })
      setDocumentConversations(conversations)
      setActiveDocumentConversationId(conversations[0]?.id ?? null)
      setDocumentHistoryLoaded(true)
    })
    return () => { cancelled = true }
  }, [lookup.libraryId, lookup.name, lookup.parent])

  useEffect(() => {
    if (!documentHistoryLoaded || !lookup.libraryId) return
    void saveDocumentConversations(lookup.libraryId, lookup.name, lookup.parent || '', documentConversations)
  }, [documentConversations, documentHistoryLoaded, lookup.libraryId, lookup.name, lookup.parent])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: 'end' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages.length, asking])

  const stopGeneration = () => {
    abortController?.abort()
    setAbortController(null)
    setAsking(false)
  }

  const askDocument = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = question.trim()
    if (!text || !lookup.libraryId || asking) return
    const userMessage = { role: 'user' as const, text }
    const editingIndex = editingMessageIndex
    const history = editingIndex === null ? messages : messages.slice(0, editingIndex)
    const targetId = activeDocumentConversation?.id ?? createConversationId()
    const now = new Date().toISOString()
    const nextMessages = [...(editingIndex === null ? messages : messages.slice(0, editingIndex)), userMessage]
    setDocumentConversations((current) => activeDocumentConversation
      ? current.map((conversation) => conversation.id === targetId ? { ...conversation, title: conversation.title === '新对话' ? truncateTitle(text) : conversation.title, messages: nextMessages, updatedAt: now } : conversation)
      : [{ id: targetId, title: truncateTitle(text), messages: nextMessages, createdAt: now, updatedAt: now }, ...current])
    setActiveDocumentConversationId(targetId)
    setQuestion('')
    setEditingMessageIndex(null)
    setAsking(true)
    const controller = new AbortController()
    setAbortController(controller)
    const result = await askKnowledge(lookup.libraryId, text, history, controller.signal, { level: 'document', libraryId: lookup.libraryId, name: item.name, parent: item.parent || '' })
    if (controller.signal.aborted) return
    const citations = result.success && result.data ? result.data.citations : []
    const assistantMessage = { role: 'assistant' as const, text: result.success && result.data ? result.data.answer : `问答失败：${result.error || '未知错误'}`, createdAt: new Date().toISOString(), ...(citations.length ? { citations } : {}) }
    setDocumentConversations((current) => current.map((conversation) => conversation.id === targetId
      ? { ...conversation, messages: [...nextMessages, assistantMessage], updatedAt: new Date().toISOString() }
      : conversation))
    setAsking(false)
    setAbortController(null)
  }

  const createDocumentConversation = () => {
    const now = new Date().toISOString()
    const conversation: Conversation = { id: createConversationId(), title: '新对话', messages: [], createdAt: now, updatedAt: now }
    setDocumentConversations((current) => [conversation, ...current])
    setActiveDocumentConversationId(conversation.id)
    setDocumentHistoryOpen(false)
    setQuestion('')
    setEditingMessageIndex(null)
  }

  const deleteDocumentConversation = (conversationId: string) => {
    const target = documentConversations.find((conversation) => conversation.id === conversationId)
    if (!target) return
    if (!window.confirm(`确定删除对话「${target.title}」吗？删除后无法恢复。`)) return
    setDocumentConversations((current) => {
      const next = current.filter((conversation) => conversation.id !== conversationId)
      if (activeDocumentConversationId === conversationId) setActiveDocumentConversationId(next[0]?.id ?? null)
      return next
    })
  }

  return <div className="flex h-screen min-h-0 flex-col bg-base-200/50 text-base-content">
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-base-200 bg-base-100 px-5">
      <DocumentTypeBadge item={item} size="sm" />
      <div className="min-w-0 flex-1"><h1 className="truncate text-sm font-medium">{item.name}</h1><p className="mt-0.5 truncate text-[11px] text-base-content/35">{libraryName} · {formatContentUpdatedAt(item.updatedAt)}</p></div>
      <button onClick={() => setAssistantOpen((open) => !open)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition hover:bg-base-200 ${assistantOpen ? 'bg-emerald-50 text-emerald-700' : 'text-base-content/50'}`}><span className="flex h-5 w-5 items-center justify-center rounded-md bg-linear-to-br from-lime-300 to-emerald-400 text-[9px] font-bold text-emerald-950">AI</span>AI 助手</button>
      {editableKind ? <button onClick={() => void beginEdit()} disabled={editLoading || editing} className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs transition hover:bg-base-200 disabled:cursor-not-allowed disabled:opacity-60 ${editing ? 'bg-primary/10 text-primary' : 'text-base-content/50'}`} title="编辑文档" aria-label="编辑文档">{editLoading ? <span className="loading loading-spinner loading-xs" /> : <Icon><path d="M13.5 6.5 17.5 10.5" /><path d="M4 20h4l11-11a2.83 2.83 0 0 0-4-4L4 16v4Z" /></Icon>}编辑</button> : null}
      <button className="rounded-lg p-2 text-base-content/45 hover:bg-base-200" title="下载文档"><Icon><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M5 21h14" /></Icon></button>
      <button onClick={() => window.close()} className="rounded-lg p-2 text-base-content/45 hover:bg-base-200" title="关闭标签页"><Icon><path d="M18 6 6 18M6 6l12 12" /></Icon></button>
    </header>
    <div className="flex min-h-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col">
        {editing ? <>
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-base-200 bg-base-100 px-5 text-xs text-base-content/45">
            <span className="flex items-center gap-2">编辑文档{dirty ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">未保存</span> : null}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={cancelEdit} disabled={saving} className="rounded-lg border border-base-300 px-3 py-1.5 text-xs text-base-content/70 transition hover:bg-base-200 disabled:opacity-40">取消</button>
              <button type="button" onClick={() => void saveEdit()} disabled={saving} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-content transition hover:opacity-90 disabled:opacity-50">{saving ? <span className="loading loading-spinner loading-xs" /> : null}{saving ? '保存中…' : '保存'}</button>
            </div>
          </div>
          {saveError ? <p className="shrink-0 border-b border-red-200 bg-red-50 px-5 py-2 text-xs leading-5 text-red-600">{saveError}</p> : null}
          <div className="flex min-h-0 flex-1 flex-col bg-base-100">
            {draft && editableKind ? <DocumentEditor kind={editableKind} itemName={item.name} draft={draft} onChange={handleDraftChange} /> : <div className="flex flex-1 items-center justify-center"><span className="loading loading-spinner loading-lg" /></div>}
          </div>
        </> : <>
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-base-200 bg-base-100 px-5 text-xs text-base-content/45">
          <span>文档预览</span>
          {kind === 'pdf' ? <span>使用 PDF 工具栏缩放、翻页和搜索</span> : <div className="flex items-center gap-1">
            <button onClick={() => setPreviewZoom((value) => Math.max(70, value - 10))} disabled={previewZoom <= 70} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-base-200 disabled:opacity-30" title="缩小">−</button>
            <span className="w-12 text-center tabular-nums">{previewZoom}%</span>
            <button onClick={() => setPreviewZoom((value) => Math.min(140, value + 10))} disabled={previewZoom >= 140} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-base-200 disabled:opacity-30" title="放大">＋</button>
            <button onClick={() => setPreviewZoom(100)} className="ml-1 rounded-md px-2 py-1.5 hover:bg-base-200">适应页面</button>
          </div>}
          <span>{kind === 'pdf' ? 'PDF 预览' : kind === 'sheet' ? `工作表 ${previewSheetIndex + 1} / ${Math.max(sheetCount, 1)}` : kind === 'markdown' ? 'Markdown 预览' : kind === 'image' ? '图片预览' : `第 ${Math.min(currentPage, Math.max(pageCount, 1))} / ${Math.max(pageCount, 1)} 页`}</span>
        </div>
        <div data-document-preview-scroll className="flex-1 overflow-auto bg-base-100 px-6 py-8" style={{ paddingBottom: 'clamp(12rem, 45vh, 28rem)' }}>
          <DocumentPreviewCanvas item={item} zoom={previewZoom} sheetIndex={previewSheetIndex} onSheetChange={setPreviewSheetIndex} onPageCountChange={handlePageCountChange} onCurrentPageChange={setCurrentPage} />
        </div>
        </>}
      </main>
      {assistantOpen ? <AssistantResizeHandle onPointerDown={startAssistantResize} /> : null}
      <aside style={{ width: assistantWidth }} className={`${assistantOpen ? 'flex' : 'hidden'} shrink-0 flex-col bg-base-100 shadow-xl lg:shadow-none`}>
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-base-200 px-4">
          <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-br from-lime-300 to-emerald-400 text-xs font-bold text-emerald-950">AI</span><span className="text-sm font-medium">AI 助手</span></div>
          <div className="flex items-center gap-0.5">
            <button onClick={createDocumentConversation} className="rounded-lg p-2 text-base-content/45 hover:bg-base-200" title="新建问答" aria-label="新建问答"><Icon><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="M8 12h8M12 8v8" /></Icon></button>
            <button onClick={() => setDocumentHistoryOpen((open) => !open)} className={`rounded-lg p-2 hover:bg-base-200 ${documentHistoryOpen ? 'bg-base-200 text-primary' : 'text-base-content/45'}`} title="历史对话" aria-label="历史对话"><Icon><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></Icon></button>
            <button onClick={() => setAssistantOpen(false)} className="rounded-lg p-2 text-base-content/45 hover:bg-base-200" title="关闭助手"><Icon><path d="M18 6 6 18M6 6l12 12" /></Icon></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-16 pb-16 pt-5">
          {documentHistoryOpen ? <div className="-mx-12"><div className="mb-3 flex items-center justify-between px-2"><span className="text-xs font-medium text-base-content/60">历史对话</span><span className="text-[10px] text-base-content/35">{documentConversations.length} 个</span></div>
            {!documentConversations.length ? <p className="py-10 text-center text-xs text-base-content/35">暂无历史对话</p> : <ul className="space-y-1">{documentConversations.map((conversation) => <li key={conversation.id} className={`group/history flex items-center gap-1 rounded-xl px-3 py-2.5 ${conversation.id === activeDocumentConversation?.id ? 'bg-primary/10' : 'hover:bg-base-200'}`}><button onClick={() => { setActiveDocumentConversationId(conversation.id); setDocumentHistoryOpen(false); setQuestion(''); setEditingMessageIndex(null) }} className="min-w-0 flex-1 text-left"><div className={`truncate text-sm ${conversation.id === activeDocumentConversation?.id ? 'font-medium text-primary' : 'text-base-content/75'}`}>{conversation.title}</div><div className="mt-0.5 text-[10px] text-base-content/35">{formatConversationTime(conversation.updatedAt)}</div></button><button onClick={() => deleteDocumentConversation(conversation.id)} className="rounded-md p-1.5 text-base-content/30 opacity-0 hover:bg-error/10 hover:text-error group-hover/history:opacity-100" title="删除对话"><Icon className="h-3.5 w-3.5"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4h8v2" /></Icon></button></li>)}</ul>}
          </div> : messages.length === 0 ? <div className="space-y-4">
            <p className="text-sm leading-6 text-base-content/60">你好，我是你的 AI 助手。可以基于当前文档帮你总结内容、提取重点或回答问题。</p>
            <div className="grid gap-2">{['总结这篇文档', '提取文档重点', '根据文档生成测验'].map((prompt) => <button key={prompt} onClick={() => setQuestion(prompt)} className="rounded-xl border border-base-200 px-3 py-2.5 text-left text-xs text-base-content/55 hover:border-primary/25 hover:bg-primary/5 hover:text-primary">{prompt}</button>)}</div>
          </div> : <div className="space-y-4">{messages.map((message, index) => <MessageBubble key={`${message.role}-${index}`} message={message} index={index} onEdit={asking ? undefined : (currentMessage, currentIndex) => { setQuestion(currentMessage.text); setEditingMessageIndex(currentIndex) }} isEditing={editingMessageIndex === index} editValue={question} onEditChange={setQuestion} onCancelEdit={() => { setEditingMessageIndex(null); setQuestion('') }} onSubmitEdit={() => { void askDocument() }} />)}<div ref={messagesEndRef} /></div>}
        </div>
        <div className="shrink-0 border-t border-base-200 p-4">
          {asking ? <div className="mb-3 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"><span>正在生成回答…</span><button type="button" onClick={stopGeneration} className="rounded-md bg-white px-2 py-1 font-medium">停止</button></div> : null}
          <div className="mb-3 rounded-xl bg-linear-to-r from-emerald-50 to-lime-100 p-3"><div className="flex min-w-0 items-center gap-2"><span className={`text-xs font-bold ${documentKindMeta[kind].accent}`}>{documentKindMeta[kind].short}</span><span className="truncate text-xs font-medium">{item.name}</span></div></div>
          {editingMessageIndex === null ? <form onSubmit={askDocument} className="rounded-2xl border border-base-300 bg-base-100 p-3 shadow-md focus-within:border-primary/40">
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} rows={3} className="w-full resize-none bg-transparent text-sm leading-6 outline-none" placeholder="针对当前文档提问" />
            <div className="mt-2 flex items-center justify-between"><button type="button" className="rounded-lg bg-base-200 px-2.5 py-1.5 text-xs text-base-content/60">快速回答⌄</button><button type="submit" disabled={!question.trim()} className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-content disabled:bg-base-300 disabled:text-base-content/30" aria-label="发送"><Icon><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></Icon></button></div>
          </form> : null}
          <p className="mt-2 text-center text-[10px] text-base-content/25">内容由 AI 生成，仅供参考</p>
        </div>
      </aside>
    </div>
  </div>
}

export default function Knowledge() {
  const workspaceRef = useRef<HTMLDivElement>(null)
  const persistVersionRef = useRef(0)
  // 保存的串行链，见 persistWorkspace 里的说明。
  const persistChainRef = useRef<Promise<void>>(Promise.resolve())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const sortPopoverRef = useRef<HTMLDivElement>(null)
  const addPopoverRef = useRef<HTMLDivElement>(null)
  // 三种「⋯」（分组标题行、侧栏知识库行、内容行）共用一套状态：同一时刻只开一个，位置按触发器实测。
  const rowMenu = useRowMenu()
  const dragRef = useRef<{ pane: 'left' | 'middle'; startX: number; startWidth: number } | null>(null)
  const idCounterRef = useRef(1_000_000_000)
  const [leftWidth, setLeftWidth] = useState(230)
  const [middleWidth, setMiddleWidth] = useState(410)
  const [resizing, setResizing] = useState(false)
  const [libraries, setLibraries] = useState<Library[]>([])
  // 拖拽中的知识库。载荷里存 section 而不是到 dragover 时现查 libraries：分组判定要跟渲染这一行
  // 的 type 走（'personal' 要兜底），现查既多一次 O(n) 查找，又得把 type 的缺省再写一遍。
  const [dragPayload, setDragPayload] = useState<{ id: number; section: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: number; zone: 'before' | 'after' } | null>(null)
  const [contentMap, setContentMap] = useState<Record<number, ContentItem[]>>({})
  const [conversationsByScope, setConversationsByScope] = useState<Record<string, Conversation[]>>({})
  const [askingConvId, setAskingConvId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loadingData, setLoadingData] = useState(true)
  const [syncState, setSyncState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  // 区分「保存失败」与「乐观锁冲突（其他窗口已改，需刷新）」——后者是可操作提示，不是普通网络错误。
  const [syncConflict, setSyncConflict] = useState(false)
  const [asking, setAsking] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const [selectedLibraryName, setSelectedLibraryName] = useState<string | null>(null)
  const [selectedCollectionKey, setSelectedCollectionKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [currentFolder, setCurrentFolder] = useState<string | null>(null)
  const [selectedDocument, setSelectedDocument] = useState<ContentItem | null>(null)
  const [previewZoom, setPreviewZoom] = useState(100)
  const [previewSheetIndex, setPreviewSheetIndex] = useState(0)
  const [documentAssistantOpen, setDocumentAssistantOpen] = useState(false)
  const { assistantWidth: documentAssistantWidth, startAssistantResize: startDocumentAssistantResize } = useAssistantPaneResize(defaultAssistantPaneWidth())
  const [sortKey, setSortKey] = useState<SortKey>('updated')
  const [sortOpen, setSortOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false)
  const [editingLibraryId, setEditingLibraryId] = useState<number | null>(null)
  const [editingLibraryName, setEditingLibraryName] = useState('')
  const [editingLibraryCover, setEditingLibraryCover] = useState('neural')
  const [deletingLibraryId, setDeletingLibraryId] = useState<number | null>(null)
  const [deletingContent, setDeletingContent] = useState<ContentItem | null>(null)
  const [renamingContent, setRenamingContent] = useState<ContentItem | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // 网页链接条目编辑时名称与地址一起改，地址单独存一份。
  const [renameUrl, setRenameUrl] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const [movingContent, setMovingContent] = useState<ContentItem | null>(null)
  // 弹窗里的目标选择：左栏选知识库，右栏选该库里的文件夹；path 为 null 表示该库根目录。
  const [moveTargetLibraryId, setMoveTargetLibraryId] = useState<number | null>(null)
  const [moveTargetPath, setMoveTargetPath] = useState<string | null>(null)
  // 「添加网页链接」弹窗。地址与名称分开存，校验失败就地提示，不再用 window.prompt/alert 打断页面。
  const [addingLink, setAddingLink] = useState(false)
  const [linkName, setLinkName] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  // 菜单键记的是条目 id，不是索引——列表会重排。
  const { openMenuId, menuAnchor, panelRef: rowMenuRef, close: closeRowMenu } = rowMenu
  const [creatingLibrary, setCreatingLibrary] = useState(false)
  const [creatingLibraryType, setCreatingLibraryType] = useState<'personal' | 'shared' | 'subscribed'>('personal')
  const [newLibraryName, setNewLibraryName] = useState('')
  const [newLibraryCover, setNewLibraryCover] = useState('neural')
  const [addingContentLibraryId, setAddingContentLibraryId] = useState<number | null>(null)
  // 上传进度拆成两份状态：pendingIds 只在批次开始/结束时变化，是 visibleContents 的依赖；
  // 百分比放在 uploadTasks 里，只被进度行读取——否则每跳一个百分点都要重排整个内容列表。
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([])
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [newContentName, setNewContentName] = useState('')
  const [newContentType, setNewContentType] = useState<ContentItem['type']>('folder')
  const [newContentError, setNewContentError] = useState<string | null>(null)
  const [sectionTitles, setSectionTitles] = useState<Record<string, string>>({ personal: '个人知识库', shared: '共享知识库', subscribed: '订阅知识库' })
  const [customCollections, setCustomCollections] = useState<string[]>([])
  const [question, setQuestion] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ personal: true, shared: true, subscribed: true })
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null)
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const active = activeId == null ? undefined : libraries.find((item) => item.id === activeId)
  const visibleLibraries = useMemo(() => libraries.filter((item) => `${item.name}${item.description}`.toLowerCase().includes(libraryQuery.toLowerCase())), [libraries, libraryQuery])
  const getCollectionLibraryIds = (key: string) => libraries.filter((library) => (library.type || 'personal') === key).map((library) => library.id)
  // 问答面板范围自适应：选中集合 > 进入文件夹 > 选中知识库
  const activeScope: QaScope | null = (() => {
    if (selectedCollectionKey) return { level: 'collection', key: selectedCollectionKey, libraryIds: getCollectionLibraryIds(selectedCollectionKey) }
    if (currentFolder != null && activeId != null) return { level: 'folder', libraryId: activeId, folder: currentFolder }
    if (activeId != null) return { level: 'library', libraryId: activeId }
    return null
  })()
  const scopeKey = (scope: QaScope): string =>
    scope.level === 'collection' ? `collection:${scope.key}`
      : scope.level === 'folder' ? `folder:${scope.libraryId}:${scope.folder}`
        : `library:${scope.libraryId}`
  // 每个作用域的会话数组，最新在前；头部（index 0）即活跃会话，查看会话即移到头部
  const scopeConversations = activeScope ? (conversationsByScope[scopeKey(activeScope)] ?? []) : []
  const activeConversation = scopeConversations[0] ?? null
  const messages = activeConversation?.messages ?? []
  // 编辑态只属于其发起时所在的会话；切走会话/作用域后自动失效，无需 effect 重置
  const editingActive = editingMessageIndex !== null && editingConversationId != null && editingConversationId === activeConversation?.id
  const scopeLabel = (scope: QaScope): string => {
    if (scope.level === 'collection') return `基于「${sectionTitles[scope.key] || '知识库集合'}」集合问答`
    if (scope.level === 'folder') return `基于「${active?.name || ''} / ${scope.folder}」问答`
    return `基于「${active?.name || ''}」问答`
  }
  const inputDisabled = !activeScope || (activeScope.level === 'collection' && !activeScope.libraryIds.length)
  const inputPlaceholder = !activeScope ? '请先选择知识库或集合' : activeScope.level === 'collection' ? (activeScope.libraryIds.length ? '基于集合提问' : '该集合暂无知识库') : activeScope.level === 'folder' ? '基于文件夹提问' : '基于知识库提问'
  const visibleContents = useMemo(() => {
    const allItems = activeId == null ? [] : contentMap[activeId] ?? []
    const actualCount = (item: ContentItem) => {
      if (item.type !== 'folder') return 1
      const path = item.parent ? `${item.parent}/${item.name}` : item.name
      return allItems.filter((child) => child.parent === path).length
    }
    // 正在上传的条目由进度行占位，这里隐藏真实行，避免同一文件出现两行。
    // 链接条目一律只存域名，同名时只能靠地址区分，所以搜索要一并匹配 url。
    const needle = query.toLowerCase()
    const source = allItems.filter((item) => (item.parent || null) === currentFolder && !pendingIds.has(item.id)
      && (item.name.toLowerCase().includes(needle) || Boolean(item.url?.toLowerCase().includes(needle))))
    return source.map((item, index) => ({ item, index })).sort((left, right) => {
      if (sortKey === 'name') return left.item.name.localeCompare(right.item.name, 'zh-CN')
      if (sortKey === 'type') return left.item.type.localeCompare(right.item.type) || left.item.name.localeCompare(right.item.name, 'zh-CN')
      if (sortKey === 'size') return actualCount(right.item) - actualCount(left.item)
      if (sortKey === 'created') return right.index - left.index
      return new Date(right.item.updatedAt).getTime() - new Date(left.item.updatedAt).getTime() || left.index - right.index
    }).map(({ item }) => item)
  }, [activeId, contentMap, currentFolder, query, sortKey, pendingIds])

  // 进度行钉在列表顶部，不参与排序；过滤条件与真实行保持一致（同一层、同一搜索词）。
  const visibleUploads = useMemo(() => {
    const needle = query.toLowerCase()
    return activeId == null ? [] : uploadTasks.filter((task) => task.libraryId === activeId && task.viewParent === currentFolder && task.name.toLowerCase().includes(needle))
  }, [uploadTasks, activeId, currentFolder, query])

  const dismissUploadTask = (id: string) => {
    setUploadTasks((tasks) => tasks.filter((task) => task.id !== id))
    setPendingIds((current) => { const next = new Set(current); next.delete(id); return next })
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: 'end' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages.length, asking])

  // 工具条那两个浮层的「点外面就收」和 Esc。「⋯」的那份在 useRowMenu 里，同一个 hook 也管它自己的
  // 滚动/缩放收起，这里只管排序和添加内容这两个挂在工具条上的浮层。
  useEffect(() => {
    if (!sortOpen && !addMenuOpen) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (sortOpen && !sortPopoverRef.current?.contains(target)) setSortOpen(false)
      if (addMenuOpen && !addPopoverRef.current?.contains(target)) setAddMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSortOpen(false)
      setAddMenuOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [sortOpen, addMenuOpen])

  // 工具条那两个浮层和「⋯」互斥，开这边就收那边（键盘触发 click 时没有 pointerdown 帮我们收）。
  const toggleRowMenu = (key: string, trigger: HTMLElement) => {
    setSortOpen(false)
    setAddMenuOpen(false)
    rowMenu.toggle(key, trigger)
  }

  const getGroups = (titles = sectionTitles, customs = customCollections): KnowledgeGroup[] => [
    { key: 'personal', name: titles.personal, system: true },
    { key: 'shared', name: titles.shared, system: true },
    { key: 'subscribed', name: titles.subscribed, system: true },
    ...customs.map((key) => ({ key, name: titles[key], system: false })),
  ]

  // 知识库结构与内容的持久化；问答记录（conversations）已迁移到独立接口，由 persistConversations 负责。
  // onProgress 仅在导入本地文件时传入（走 XHR 才能拿到上传进度），其余保存路径继续用 apiRequest。
  // 返回值供导入流程判断该批次是否落库；被更高版本取代或回读失败都算成功——POST 已经写进去了。
  //
  // 每次保存 POST 的都是整份工作区，而后端把「payload 里没有的库」理解成删除（data.js:333-346），
  // 把「payload 里有、库里没有的 id」理解成新建（data.js:352）。两份快照重叠时，后落地的那份会
  // 抹掉中间发生的事：刚新建的库被删掉，或者已删的库被重新插回来（还换了新的自增 id）。
  // persistVersionRef 只决定回读结果采不采纳，管不到写。所以在这里把保存串成一条链，
  // 让每一份快照都建立在上一份的结果之上——放在这一层而不是各调用方，11 个调用点一次性都受保护。
  const persistWorkspace = (nextLibraries: Library[], nextContents = contentMap, nextGroups = getGroups(), selectionName = selectedLibraryName, onProgress?: (ratio: number) => void): Promise<{ success: boolean }> => {
    // 版本号留在链外：它要按「调用先后」发，不是按「实际执行先后」发。
    const version = ++persistVersionRef.current
    setSyncState('saving')
    const run = persistChainRef.current.then(() => (async () => {
      // 服务端不支持按需下载时必须照旧回传全部 src，否则老后端会把「没给」当成「删除」而清掉已有字节。
      const payload = supportsContentAsset()
        ? {
          assetWire: 2,
          groups: nextGroups,
          libraries: nextLibraries,
          contents: Object.fromEntries(Object.entries(nextContents).map(([libraryId, items]) => [libraryId, items.map(serializeContentItem)])),
        }
        : { groups: nextGroups, libraries: nextLibraries, contents: nextContents }
      if (import.meta.env.DEV) {
        for (const items of Object.values(nextContents)) {
          for (const item of items) {
            if (item.src && !item.src.startsWith('data:')) {
              throw new Error(`拒绝持久化非 data: 的 src：${item.name} → ${item.src.slice(0, 40)}`)
            }
          }
        }
      }
      const saved = onProgress
        ? await apiRequestWithProgress('set', 'knowledge-workspace', payload, onProgress)
        : await apiRequest('set', 'knowledge-workspace', payload)
      if (!saved.success) {
        // 失败时故意不剥离 src：乐观条目仍带着内联字节，后续任意一次保存都会把它们重新落库。
        if (version === persistVersionRef.current) {
          setSyncState('error')
          setSyncConflict(saved.code === 'RESOURCE_CONFLICT')
        }
        return { success: false }
      }
      const refreshed = await getKnowledgeWorkspace<KnowledgeWorkspace>()
      if (version !== persistVersionRef.current || !refreshed.success || !refreshed.data) {
        // 回读被更高版本取代或失败：这批内联字节已经落库了，本地摘掉以免下次保存重传。
        const savedIds = new Set(
          Object.values(nextContents).flat().filter((item) => item.src?.startsWith('data:')).map((item) => item.id)
        )
        setContentMap((current) => stripSavedSources(current, savedIds))
        return { success: true }
      }
      const data = refreshed.data
      setLibraries(data.libraries)
      setContentMap(data.contents || {})
      if (selectionName) {
        const selected = data.libraries.find((library) => library.name === selectionName)
        setActiveId(selected?.id ?? null)
      }
      setSyncState('saved')
      setSyncConflict(false)
      window.setTimeout(() => { if (version === persistVersionRef.current) setSyncState('idle') }, 1600)
      return { success: true }
    })())
    // 链本身不能因为一次失败就断掉，否则之后所有保存都会被前一次失败卡住。真实失败仍然由 run 的
    // 调用方看到（导入流程靠返回值判断这批有没有落库），这里只是不让它污染链。
    persistChainRef.current = run.then(() => undefined, () => undefined)
    return run
  }

  const saveLibraryProfile = (id: number) => {
    const name = editingLibraryName.trim()
    if (!name) return
    const previousName = libraries.find((library) => library.id === id)?.name
    const wasSelected = selectedLibraryName === previousName
    const nextLibraries = libraries.map((library) => library.id === id ? { ...library, name, icon: editingLibraryCover } : library)
    setLibraries(nextLibraries)
    if (wasSelected) setSelectedLibraryName(name)
    setEditingLibraryId(null)
    persistWorkspace(nextLibraries, contentMap, getGroups(), wasSelected ? name : selectedLibraryName)
  }

  const deleteLibrary = (id: number) => {
    const nextLibraries = libraries.filter((library) => library.id !== id)
    const nextContents = { ...contentMap }
    const nextConversations = Object.fromEntries(Object.entries(conversationsByScope).filter(([key]) => key !== `library:${id}` && !key.startsWith(`folder:${id}:`)))
    delete nextContents[id]
    setLibraries(nextLibraries)
    setContentMap(nextContents)
    setConversationsByScope(nextConversations)
    if (activeId === id && nextLibraries.length) setActiveId(nextLibraries[0].id)
    if (selectedLibraryName === libraries.find((library) => library.id === id)?.name) setSelectedLibraryName(null)
    setDeletingLibraryId(null)
    persistWorkspace(nextLibraries, nextContents, getGroups(), selectedLibraryName)
    persistConversations(nextConversations)
  }

  const createLibrary = () => {
    const name = newLibraryName.trim()
    if (!name) return
    const id = ++idCounterRef.current
    const nextLibraries = [...libraries, { id, name, icon: newLibraryCover, description: '', count: 0, type: creatingLibraryType }]
    const nextContents = { ...contentMap, [id]: [] }
    setLibraries(nextLibraries)
    setContentMap(nextContents)
    setActiveId(id)
    setSelectedLibraryName(name)
    setCreatingLibrary(false)
    setNewLibraryName('')
    setNewLibraryCover('neural')
    persistWorkspace(nextLibraries, nextContents, getGroups(), name)
  }

  const addContent = () => {
    const name = newContentName.trim()
    const libraryId = addingContentLibraryId
    if (!name || libraryId == null) return
    // 同级重名必须先拦掉，理由和重命名一样——但这里更狠：文件夹路径由名字拼成，两个同名的同级
    // 文件夹在系统里指向同一个 parent_path，看起来「都装着同一批内容」，删掉其中任何一个还会
    // 连带删掉另一个的子项。而且列表行的 key 也是「父路径-名字」，重名会让两行撞同一个 key。
    if (name.includes('/')) { setNewContentError('名称不能包含 “/”'); return }
    // name 在库中是 varchar(500)，但 parent_path 只有 varchar(2000)：名称过长时深层子项的路径会溢出。
    if (name.length > 255) { setNewContentError(`名称过长（${name.length} 字符，最多 255）`); return }
    const parent = currentFolder || null
    const duplicated = (contentMap[libraryId] || []).some((candidate) => (candidate.parent || null) === parent && candidate.name === name)
    if (duplicated) { setNewContentError('同一层级下已存在同名内容'); return }
    const nextContents = {
      ...contentMap,
      [libraryId]: [...(contentMap[libraryId] || []), { id: createContentId(), name, type: newContentType, ...createContentTimestamps(), ...(newContentType === 'folder' ? { count: 0 } : {}), ...(parent ? { parent } : {}) }],
    }
    const nextLibraries = libraries.map((library) => library.id === libraryId ? { ...library, count: nextContents[libraryId].length } : library)
    setContentMap(nextContents)
    setLibraries(nextLibraries)
    setActiveId(libraryId)
    setAddingContentLibraryId(null)
    setNewContentName('')
    setNewContentType('folder')
    setNewContentError(null)
    persistWorkspace(nextLibraries, nextContents)
  }

  // 取消要把名字一并清掉：只关弹窗的话，下次打开输入框里还留着上次没提交的名字，
  // 顺手再点一次「添加」就会建出一个同名的重复条目。
  const closeAddContent = () => {
    setAddingContentLibraryId(null)
    setNewContentName('')
    setNewContentError(null)
  }

  // parent 由调用方在批次开始时捕获传入：读取期间用户可能切了文件夹，归档位置要和用户看到的那一行一致。
  const addImportedContent = (items: ContentItem[], options?: { parent?: string | null; onProgress?: (ratio: number) => void }) => {
    if (!items.length || activeId == null) return Promise.resolve({ success: true })
    const parent = options?.parent === undefined ? currentFolder : options.parent
    const importedItems = items.map((item) => ({ ...item, ...(!item.parent && parent ? { parent } : {}) }))
    const nextContents = { ...contentMap, [activeId]: [...(contentMap[activeId] || []), ...importedItems] }
    const nextLibraries = libraries.map((library) => library.id === activeId ? { ...library, count: nextContents[activeId].length } : library)
    setContentMap(nextContents)
    setLibraries(nextLibraries)
    return persistWorkspace(nextLibraries, nextContents, getGroups(), selectedLibraryName, options?.onProgress)
  }

  // 读取本地文件：入口先同步建好进度行，再逐文件读取。map 里的 try/catch 保证单个文件读失败只影响它自己，
  // 不像原来的 Promise.all 那样整批 reject、丢弃已读好的文件。
  const prepareImportedFiles = async (files: File[], parent?: string): Promise<ContentItem[]> => {
    const oversizedAssets = files.filter((file) => {
      if ((file.type.startsWith('image/') || imageFilePattern.test(file.name)) && file.size > maxImageSize) return true
      if ((file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) && file.size > maxPdfSize) return true
      if (officeFilePattern.test(file.name) && file.size > maxOfficeSize) return true
      return false
    })
    if (oversizedAssets.length) window.alert(`以下文件超过大小限制，已跳过（图片 10 MB、PDF/Office 100 MB）：\n${oversizedAssets.map((file) => file.name).join('\n')}`)
    const acceptedFiles = files.filter((file) => !oversizedAssets.includes(file))
    if (!acceptedFiles.length) return []
    const entries = acceptedFiles.map((file) => ({ file, id: createContentId() }))
    const libraryId = activeId ?? -1
    const viewParent = currentFolder
    setUploadTasks((tasks) => [...tasks, ...entries.map(({ file, id }) => ({ id, libraryId, viewParent, name: file.name, size: file.size, phase: 'reading' as const, percent: 0 }))])
    const settled = await Promise.all(entries.map(async ({ file, id }) => {
      const report = makeProgressReporter((percent) => setUploadTasks((tasks) => tasks.map((task) => task.id === id ? { ...task, percent } : task)))
      try {
        return await createContentItemFromFile(file, parent, { id, onProgress: report })
      } catch {
        setUploadTasks((tasks) => tasks.map((task) => task.id === id ? { ...task, phase: 'failed', error: '文件读取失败' } : task))
        return null
      }
    }))
    return settled.filter((item): item is ContentItem => item != null)
  }

  // 落库阶段：整批文件共用一次 POST，所以所有进度行显示同一个聚合百分比，一次 setState 全部刷新。
  // progressIds 只包含有进度行的条目（文件夹导入时新建的文件夹没有进度行，不能隐藏它的真实行）。
  const commitImportedContent = async (items: ContentItem[], progressIds: string[], viewParent: string | null) => {
    if (!items.length) return
    const ids = progressIds
    setPendingIds((current) => new Set([...current, ...ids]))
    setUploadTasks((tasks) => tasks.map((task) => ids.includes(task.id) ? { ...task, phase: 'saving', percent: 0 } : task))
    const report = makeProgressReporter((percent) => setUploadTasks((tasks) => tasks.map((task) => ids.includes(task.id) ? { ...task, percent } : task)))
    const result = await addImportedContent(items, { parent: viewParent, onProgress: report })
    setPendingIds((current) => { const next = new Set(current); ids.forEach((id) => next.delete(id)); return next })
    // 失败时保留乐观插入的条目：后续任意一次保存都会把它们重新落库，直接丢弃反而丢数据。
    setUploadTasks((tasks) => result.success ? tasks.filter((task) => !ids.includes(task.id)) : tasks.map((task) => ids.includes(task.id) ? { ...task, phase: 'failed', error: '保存失败，仅本地保留' } : task))
  }

  const importLocalFiles = async (files: File[]) => {
    const viewParent = currentFolder
    const importedFiles = await prepareImportedFiles(files, viewParent ?? undefined)
    await commitImportedContent(importedFiles, importedFiles.map((item) => item.id), viewParent)
  }

  const importLocalFolder = async (files: Array<File & { webkitRelativePath?: string }>) => {
    const folderName = files[0]?.webkitRelativePath?.split('/')[0]
    if (!folderName) return
    const viewParent = currentFolder
    const folderPath = viewParent ? `${viewParent}/${folderName}` : folderName
    // 文件写进 folderPath，但进度行显示在当前层——folderPath 要到保存时才存在，否则行会被过滤掉、完全看不见。
    const importedFiles = await prepareImportedFiles(files, folderPath)
    if (!importedFiles.length) return
    await commitImportedContent([{ id: createContentId(), name: folderName, type: 'folder', ...createContentTimestamps() }, ...importedFiles], importedFiles.map((item) => item.id), viewParent)
  }

  // 网页链接是个「只存地址」的条目：不抓取、不解析、不进问答，点击时直接在新标签页打开。
  // 地址必须校验后才落库——列表行是 <a href={item.url}>，一个非法地址会变成点不动的死行。
  const openAddWebLink = () => {
    setAddMenuOpen(false)
    setLinkName('')
    setLinkUrl('')
    setLinkError(null)
    setAddingLink(true)
  }

  const addWebLink = () => {
    if (activeId == null) return
    const rawUrl = linkUrl.trim()
    if (!rawUrl) { setLinkError('请输入网页链接'); return }
    const parsed = parseWebLink(rawUrl)
    if (!parsed) { setLinkError('链接格式不正确，请输入完整网址，例如 https://example.com/page'); return }
    // new URL('mailto:a@b') 也能解析成功，但那样的 href 点下去不是「打开网页」，必须在落库前拦掉。
    if (!/^https?:$/.test(parsed.protocol)) { setLinkError('只支持 http/https 链接'); return }
    // 名称留空时退回域名：用户多半只想粘个地址，不该被一个必填项挡住。
    const nextName = (linkName.trim() || parsed.hostname || rawUrl).slice(0, 255)
    // 同级重名会撞 React key（父路径-名字），和重命名同一套规则，在入口拦掉。
    const parent = currentFolder || null
    if ((contentMap[activeId] || []).some((candidate) => (candidate.parent || null) === parent && candidate.name === nextName)) {
      setLinkError('同一层级下已存在同名内容')
      return
    }
    setAddingLink(false)
    addImportedContent([{ id: createContentId(), name: nextName, type: 'doc', url: parsed.href, ...createContentTimestamps() }])
  }

  const getActualFolderCount = (item: ContentItem) => {
    if (item.type !== 'folder' || activeId == null) return undefined
    const path = item.parent ? `${item.parent}/${item.name}` : item.name
    return (contentMap[activeId] || []).filter((child) => child.parent === path).length
  }

  const deleteContent = (item: ContentItem) => {
    if (activeId == null) return
    const itemPath = item.parent ? `${item.parent}/${item.name}` : item.name
    const nextItems = (contentMap[activeId] || []).filter((candidate) => {
      if (candidate === item) return false
      if (item.type !== 'folder') return true
      return candidate.parent !== itemPath && !candidate.parent?.startsWith(`${itemPath}/`)
    })
    const nextContents = { ...contentMap, [activeId]: nextItems }
    const nextLibraries = libraries.map((library) => library.id === activeId ? { ...library, count: nextItems.length } : library)
    const nextConversations = item.type === 'folder'
      ? Object.fromEntries(Object.entries(conversationsByScope).filter(([key]) => {
        const match = key.match(/^folder:\d+:(.+)$/)
        if (!match) return true
        const path = match[1]
        return path !== itemPath && !path.startsWith(`${itemPath}/`)
      }))
      : conversationsByScope
    setContentMap(nextContents)
    setLibraries(nextLibraries)
    setConversationsByScope(nextConversations)
    if (selectedDocument === item) setSelectedDocument(null)
    if (currentFolder === itemPath || currentFolder?.startsWith(`${itemPath}/`)) setCurrentFolder(item.parent || null)
    setDeletingContent(null)
    persistWorkspace(nextLibraries, nextContents, getGroups(), selectedLibraryName)
    persistConversations(nextConversations)
  }

  // 文档问答记录按 (libraryId, name, parent) 三元组存。改名——或改名文件夹导致后代父路径变化——
  // 会让旧记录变成孤儿：文档页再打开时一条历史都读不到，且界面上完全看不出来。
  // 后端没有 rename 端点，只能借它的 replace-all 语义做「读旧 → 写新 → 清旧」。
  // 改名文档时 name 变、parent 不变；改名文件夹时后代的 parent 变、name 不变，故两端都要带上。
  // 跨库移动时 libraryId 也是键的一部分，新旧库都要显式写出来。
  const migrateDocumentConversations = async (moves: Array<{ fromLibraryId: number; fromName: string; fromParent: string; toLibraryId: number; toName: string; toParent: string }>) => {
    for (const move of moves) {
      try {
        const result = await getDocumentConversations(move.fromLibraryId, move.fromName, move.fromParent)
        const conversations = result.success ? (result.data?.conversations || []) : []
        // 没有历史就不必写新键，但旧键仍要清——它可能是空 title 之类的残留行。
        if (!conversations.length) {
          await saveDocumentConversations(move.fromLibraryId, move.fromName, move.fromParent, [])
          continue
        }
        const saved = await saveDocumentConversations(move.toLibraryId, move.toName, move.toParent, conversations)
        if (saved.success) await saveDocumentConversations(move.fromLibraryId, move.fromName, move.fromParent, [])
      } catch {
        // 问答历史迁移失败不该连累改名本身：改名是用户的主诉求，历史是附带数据。
      }
    }
  }

  // 条目路径 = 层级本身。改名和移动本质上是同一件事——「这条路径换成了那条路径」：
  // 改名换的是 name 字段，移动换的是 parent 字段，但路径搬家的连带影响完全一样。
  // 两条流程共用这一处，免得日后只在其中一条里补了某项清理，另一条悄悄漏掉。
  // targetLibraryId 传入别的库时是跨库移动：除了路径，条目归属的库本身也变了，
  // 于是「连带走什么」从换路径前缀升级成换数组，问答记录、会话键、库条目数都要跟着改。
  const relocateContent = (item: ContentItem, nextName: string, nextParent: string | null, targetLibraryId = activeId, nextUrl?: string) => {
    if (activeId == null || targetLibraryId == null) return
    const sourceId = activeId
    // 跨库时条目是「整条换库」，同库时只是换路径前缀；下面所有历史数据的搬运都按这个开关分叉。
    const crossesLibrary = targetLibraryId !== sourceId
    const sourceItems = contentMap[sourceId] || []
    const targetItems = crossesLibrary ? (contentMap[targetLibraryId] || []) : sourceItems
    const oldPath = item.parent ? `${item.parent}/${item.name}` : item.name
    const newPath = nextParent ? `${nextParent}/${nextName}` : nextName
    const isFolder = item.type === 'folder'
    // 文件夹的后代整体跟着走，成员和字段都不变，只有 parent 换前缀。
    const descendants = isFolder
      ? sourceItems.filter((candidate) => candidate.parent === oldPath || candidate.parent?.startsWith(`${oldPath}/`))
      : []
    const rewiredDescendants = descendants.map((candidate) => ({ ...candidate, parent: `${newPath}${(candidate.parent || '').slice(oldPath.length)}` }))
    const rewiredById = new Map(rewiredDescendants.map((candidate) => [candidate.id, candidate]))
    const movedItem = { ...item, name: nextName, parent: nextParent ?? undefined, ...(nextUrl !== undefined ? { url: nextUrl } : {}) }
    const movedIds = new Set([item.id, ...descendants.map((candidate) => candidate.id)])
    // 文档问答记录的迁移清单要在改状态之前算——它需要每个后代的旧 parent。
    // 链接条目没有文档页，也就没有文档问答记录，跳过可省掉无谓请求。
    const moves: Array<{ fromLibraryId: number; fromName: string; fromParent: string; toLibraryId: number; toName: string; toParent: string }> = []
    if (isFolder) {
      rewiredDescendants.forEach((after, index) => {
        const before = descendants[index]
        if (before.type === 'folder' || before.url) return
        moves.push({ fromLibraryId: sourceId, fromName: before.name, fromParent: before.parent || '', toLibraryId: targetLibraryId, toName: after.name, toParent: after.parent || '' })
      })
    } else if (!item.url) {
      moves.push({ fromLibraryId: sourceId, fromName: item.name, fromParent: item.parent || '', toLibraryId: targetLibraryId, toName: nextName, toParent: nextParent || '' })
    }
    const rewiredSource = sourceItems.map((candidate) => {
      if (candidate.id === item.id) return movedItem
      if (!isFolder) return candidate
      return rewiredById.get(candidate.id) ?? candidate
    })
    // 跨库时源库要把搬走的整个子树剔掉（不是留成孤儿），目标库里按同样顺序追加。
    const nextSourceItems = crossesLibrary ? rewiredSource.filter((candidate) => !movedIds.has(candidate.id)) : rewiredSource
    const nextContents = crossesLibrary
      ? { ...contentMap, [sourceId]: nextSourceItems, [targetLibraryId]: [...targetItems, movedItem, ...rewiredDescendants] }
      : { ...contentMap, [sourceId]: nextSourceItems }
    const nextConversations = isFolder
      ? Object.fromEntries(Object.entries(conversationsByScope).map(([key, conversations]) => {
        const match = key.match(/^folder:(\d+):(.+)$/)
        if (!match || Number(match[1]) !== sourceId) return [key, conversations]
        const path = match[2]
        // 两个分支（同名的那条、后代的那条）能合成一句：换掉路径前缀和库 id 就行。
        if (path !== oldPath && !path.startsWith(`${oldPath}/`)) return [key, conversations]
        return [`folder:${targetLibraryId}:${newPath}${path.slice(oldPath.length)}`, conversations]
      }))
      : conversationsByScope
    setContentMap(nextContents)
    let nextSelectionName = selectedLibraryName
    // 用户正站在被搬走的文件夹里（或它的子层）时，浏览位置要跟着走，否则会被弹回上一层。
    // activeScope 由 currentFolder 推导，所以这里改完，文件夹问答的作用域也一并跟随。
    if (currentFolder === oldPath || currentFolder?.startsWith(`${oldPath}/`)) {
      setCurrentFolder(`${newPath}${currentFolder.slice(oldPath.length)}`)
      // 跨库时整个文件夹换到了另一个知识库，浏览位置得连库一起切，否则会停在一个不存在的路径上。
      if (crossesLibrary) {
        setActiveId(targetLibraryId)
        nextSelectionName = libraries.find((library) => library.id === targetLibraryId)?.name ?? selectedLibraryName
        setSelectedLibraryName(nextSelectionName)
      }
    }
    if (isFolder) setConversationsByScope(nextConversations)
    setRenamingContent(null)
    setRenameError(null)
    setMovingContent(null)
    closeRowMenu()
    // count 只统计条目数量：改名/同库移动都不改数量，跨库移动必然改，两个库都要重算。
    // 这里不伪造 updatedAt——否则会凭本地时钟把这一行顶到「最近更新」的最前面。
    const nextLibraries = crossesLibrary
      ? libraries.map((library) => library.id === sourceId ? { ...library, count: nextSourceItems.length }
        : library.id === targetLibraryId ? { ...library, count: targetItems.length + movedIds.size }
          : library)
      : libraries
    if (crossesLibrary) setLibraries(nextLibraries)
    persistWorkspace(nextLibraries, nextContents, getGroups(), nextSelectionName)
    if (isFolder) persistConversations(nextConversations)
    // 不 await：问答历史迁移是附带数据，让它自己在后台跑完，界面反馈不必等它。
    if (moves.length) void migrateDocumentConversations(moves)
  }

  const openRenameContent = (item: ContentItem) => {
    closeRowMenu()
    setRenamingContent(item)
    setRenameValue(item.name)
    setRenameUrl(item.url || '')
    setRenameError(null)
  }

  const renameContent = () => {
    const item = renamingContent
    if (!item || activeId == null) return
    const nextName = renameValue.trim()
    if (!nextName) { setRenamingContent(null); setRenameError(null); return }
    // 同级重名必须先拦掉：列表行的 React key 是「父路径-名字」，文件夹路径也由名字拼成，
    // 重名会让两行撞同一个 key，两条不同分支还会被当成同一条文件夹路径。
    if (nextName.includes('/')) { setRenameError('名称不能包含 “/”'); return }
    // name 在库里是 varchar(500)，而 parent_path 只有 varchar(2000)：名称过长时后端要么报错，
    // 要么让深层子项的路径溢出。在入口用文件名惯例的 255 拦掉，报错信息才落在用户能看懂的地方。
    if (nextName.length > 255) { setRenameError(`名称过长（${nextName.length} 字符，最多 255）`); return }
    const siblingParent = item.parent || null
    const duplicated = (contentMap[activeId] || []).some((candidate) =>
      candidate !== item && (candidate.parent || null) === siblingParent && candidate.name === nextName)
    if (duplicated) { setRenameError('同一层级下已存在同名内容'); return }

    // 网页链接条目除名称外还要校验并改写地址，复用添加网页链接时的同一套规则。
    let nextUrl = item.url
    if (item.url) {
      const rawUrl = renameUrl.trim()
      if (!rawUrl) { setRenameError('请输入网页链接'); return }
      const parsed = parseWebLink(rawUrl)
      if (!parsed) { setRenameError('链接格式不正确，请输入完整网址，例如 https://example.com/page'); return }
      if (!/^https?:$/.test(parsed.protocol)) { setRenameError('只支持 http/https 链接'); return }
      nextUrl = parsed.href
    }

    // 什么都没改就静默关掉：普通条目只看名称，链接条目同时看名称和地址。
    if (nextName === item.name && (!item.url || nextUrl === item.url)) { setRenamingContent(null); setRenameError(null); return }

    relocateContent(item, nextName, item.parent || null, activeId, nextUrl)
  }

  // 移动：只换 parent（跨库时连 library_id 一起换），名字不变。
  const openMoveContent = (item: ContentItem) => {
    closeRowMenu()
    setMovingContent(item)
    // 弹窗一开就落在当前知识库、且不选中任何文件夹——也就是「当前位置」这个起点，
    // 用户要么往右栏挑一个文件夹，要么直接确认（不选文件夹 = 移到该库根目录）。
    setMoveTargetLibraryId(activeId)
    setMoveTargetPath(null)
  }

  // 左栏的知识库分组照抄侧边栏：系统分组（个人/共享/订阅）+ 自定义集合，顺序也一致。
  // 跨库移动能不能落地，取决于后端把「content_key 换了库」识别成 UPDATE library_id——
  // 见 docs/knowledge-cross-library-move-backend-task.md，后端没部署时跨库移动会整次保存失败。
  const moveLibraryGroups = () => getGroups()
    .map((group) => ({ key: group.key, name: group.name, libraries: libraries.filter((library) => (library.type || 'personal') === group.key) }))
    .filter((group) => group.libraries.length > 0)

  // 当前位置能不能确认。三件事都要看：
  // 1) 文件夹不能移进自身或自己的后代——那会在路径上绕成一个环，路径串看起来自洽、结构却是无限的。
  //    右栏是可下钻的浏览器，用户能主动走进被移动文件夹自己的子树里，所以这条必须留在确认这一步，
  //    光靠「列表里不出现」已经挡不住了。跨库时 item 不在目标库里，这层关系不成立。
  // 2) 不能就是当前位置（同库同父路径，移了等于没移）。
  // 3) 目标处不能已有同名条目——列表行的 key 是「父路径-名字」，文件夹路径也由名字拼成，
  //    同层重名会让两行撞同一个 key，两条不同分支还会被当成同一条文件夹路径。
  const moveOptionState = (item: ContentItem, libraryId: number, path: string | null): { disabled: boolean; reason?: string } => {
    if (activeId == null) return { disabled: true }
    if (libraryId === activeId && item.type === 'folder') {
      const itemPath = item.parent ? `${item.parent}/${item.name}` : item.name
      if (path === itemPath || path?.startsWith(`${itemPath}/`)) return { disabled: true, reason: '不能移进自身' }
    }
    if (libraryId === activeId && path === (item.parent || null)) return { disabled: true, reason: '当前位置' }
    const collides = (contentMap[libraryId] || []).some((candidate) =>
      candidate !== item && (candidate.parent || null) === path && candidate.name === item.name)
    return collides ? { disabled: true, reason: '已有同名内容' } : { disabled: false }
  }

  // 右栏是文件夹浏览器：列的是「当前位置」的直接子文件夹，点进去继续下钻。
  // 只列文件夹——目标是「放进哪个文件夹」，文档当不了容器。
  // 根目录不占一行：它是 path === null 这个状态，由面包屑和确认区的目标文案点明。
  const moveSubfolders = (libraryId: number, path: string | null): string[] => {
    return (contentMap[libraryId] || [])
      .filter((candidate) => candidate.type === 'folder' && (candidate.parent || null) === path)
      .map((candidate) => (path ? `${path}/${candidate.name}` : candidate.name))
      .sort((left, right) => left.localeCompare(right, 'zh-CN'))
  }

  // 面包屑按当前路径拆段，从目标知识库一路到当前位置；每段都可点，点它就回到那一层。
  // 首段写知识库名而不是「根目录」：路径为 null 时的目标就是那个库本身，摆名字比摆位置描述更好认，
  // 也和左栏选中的库、确认区的目标文案对得上。
  // 「返回」不是另记一份历史，而是从目标路径本身推出来的——路径是唯一的真相，两者不会走岔。
  const moveBreadcrumb = (libraryName: string, path: string | null): Array<{ label: string; path: string | null }> => {
    const segments = path ? path.split('/') : []
    return [
      { label: libraryName, path: null },
      ...segments.map((name, index) => ({ label: name, path: segments.slice(0, index + 1).join('/') })),
    ]
  }

  // 上一级：末段去掉就是父路径，根目录的上一级仍是根目录（弹窗里用 disabled 表达）。
  const moveParentPath = (path: string | null): string | null => {
    if (!path) return null
    const slash = path.lastIndexOf('/')
    return slash < 0 ? null : path.slice(0, slash)
  }

  const confirmMove = () => {
    const item = movingContent
    if (!item || moveTargetLibraryId == null) return
    if (moveOptionState(item, moveTargetLibraryId, moveTargetPath).disabled) return
    setMoveTargetLibraryId(null)
    setMoveTargetPath(null)
    // 名字不变，只换父路径；跨库时 relocateContent 会连库一起换。
    relocateContent(item, item.name, moveTargetPath, moveTargetLibraryId)
  }

  // 该文件夹下的后代数量，用于说明这次操作会连带搬走/改名多少内容。
  const descendantCount = (item: ContentItem) => {
    if (item.type !== 'folder' || activeId == null) return 0
    const path = item.parent ? `${item.parent}/${item.name}` : item.name
    return (contentMap[activeId] || []).filter((candidate) => candidate.parent === path || candidate.parent?.startsWith(`${path}/`)).length
  }

  const renameSection = (key: string) => {
    const name = window.prompt('请输入分组名称', sectionTitles[key])?.trim()
    if (name) {
      const nextTitles = { ...sectionTitles, [key]: name }
      setSectionTitles(nextTitles)
      persistWorkspace(libraries, contentMap, getGroups(nextTitles))
    }
  }

  const deleteSectionLibraries = (type: string) => {
    if (!['personal', 'shared', 'subscribed'].includes(type)) {
      if (!window.confirm(`确定删除知识库集合“${sectionTitles[type]}”吗？`)) return
      const nextCustoms = customCollections.filter((key) => key !== type)
      const nextTitles = { ...sectionTitles }
      const nextConversations = Object.fromEntries(Object.entries(conversationsByScope).filter(([key]) => key !== `collection:${type}`))
      delete nextTitles[type]
      setCustomCollections(nextCustoms)
      setSectionTitles(nextTitles)
      setConversationsByScope(nextConversations)
      if (selectedCollectionKey === type) setSelectedCollectionKey(null)
      persistWorkspace(libraries, contentMap, getGroups(nextTitles, nextCustoms), selectedLibraryName)
      persistConversations(nextConversations)
      return
    }
    const targets = libraries.filter((library) => (library.type || 'personal') === type)
    if (!targets.length || !window.confirm(`确定删除“${sectionTitles[type]}”中的全部知识库吗？`)) return
    const ids = new Set(targets.map((library) => library.id))
    const nextLibraries = libraries.filter((library) => !ids.has(library.id))
    const nextContents = Object.fromEntries(Object.entries(contentMap).filter(([id]) => !ids.has(Number(id))))
    const nextConversations = Object.fromEntries(Object.entries(conversationsByScope).filter(([key]) => {
      if (key === `collection:${type}`) return false
      if (key.startsWith('library:')) return !ids.has(Number(key.slice(8)))
      const match = key.match(/^folder:(\d+):/)
      if (match) return !ids.has(Number(match[1]))
      return true
    }))
    setLibraries(nextLibraries)
    setContentMap(nextContents)
    setConversationsByScope(nextConversations)
    if (activeId != null && ids.has(activeId) && nextLibraries.length) setActiveId(nextLibraries[0].id)
    if (targets.some((library) => library.name === selectedLibraryName)) setSelectedLibraryName(null)
    if (selectedCollectionKey === type) setSelectedCollectionKey(null)
    persistWorkspace(nextLibraries, nextContents, getGroups(), selectedLibraryName)
    persistConversations(nextConversations)
  }

  const createKnowledgeCollection = () => {
    const name = window.prompt('请输入知识库集合名称')?.trim()
    if (!name) return
    const key = `collection-${++idCounterRef.current}`
    const nextCustoms = [...customCollections, key]
    const nextTitles = { ...sectionTitles, [key]: name }
    setCustomCollections(nextCustoms)
    setSectionTitles(nextTitles)
    setExpanded((states) => ({ ...states, [key]: true }))
    persistWorkspace(libraries, contentMap, getGroups(nextTitles, nextCustoms))
  }

  const finishDrag = () => {
    setDragPayload(null)
    setDropTarget(null)
  }

  /** 投放带：行的上半 = 插到这一行前面，下半 = 插到后面。和接口信息那边同一套手感。 */
  const zoneAtDrop = (event: React.DragEvent): 'before' | 'after' => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
  }

  // 拖拽途中源行被卸载的话，dragend 到不了 React，dragPayload 会一直挂着：所有行停在 opacity-40，
  // 下一次拖拽的可用性判定也是脏的。挂到 document 上兜底，和 useRowMenu 的写法一致。
  useEffect(() => {
    if (!dragPayload) return
    const clear = () => { setDragPayload(null); setDropTarget(null) }
    document.addEventListener('dragend', clear)
    document.addEventListener('drop', clear)
    return () => {
      document.removeEventListener('dragend', clear)
      document.removeEventListener('drop', clear)
    }
  }, [dragPayload])

  /** 同组内重排。只动顺序，其余字段一概不碰。 */
  const moveLibrary = (targetId: number, placeAfter: boolean) => {
    // 搜索过滤中列表只显示一部分行，「插到 X 前面」在完整数组里落不到用户以为的位置。
    // 手柄那边已经禁掉了，这里再兜一道——这个状态的输入是「哪些行可见」，不能只靠 UI 约定。
    if (libraryQuery) return
    if (!dragPayload || dragPayload.id === targetId) return
    const source = libraries.find((library) => library.id === dragPayload.id)
    if (!source) return
    const remaining = libraries.filter((library) => library.id !== dragPayload.id)
    const targetIndex = remaining.findIndex((library) => library.id === targetId)
    if (targetIndex < 0) return
    remaining.splice(targetIndex + (placeAfter ? 1 : 0), 0, source)
    // 原地落下等于没动，而一次保存要传整份工作区（含全部内容），白跑一趟不划算。
    // 判据用「同组内的相对顺序变没变」而不是整个数组：createLibrary 是追加，所以
    // [个人, 共享, 个人] 这种交错数组是常态，把 S1 拖到 S2 旁边会改变全局顺序，
    // 但共享组看上去一模一样——那种情况下没有任何用户看得见的东西值得保存。
    const sectionOf = (library: Library) => library.type || 'personal'
    const sourceSection = sectionOf(source)
    const sectionOrder = (list: Library[]) => list
      .filter((library) => sectionOf(library) === sourceSection)
      .map((library) => library.id)
    const previousOrder = sectionOrder(libraries)
    if (previousOrder.every((id, index) => id === sectionOrder(remaining)[index])) return
    setLibraries(remaining)
    // 第 4 个参数必须显式传 null，不能用默认值：回读那段是按名字重新找选中库的，
    // 重排会改变「第一个同名的是谁」，允许重名时选中态会莫名其妙跳到另一个库。
    // 传 null 让整段跳过——重排本来就不该改变选中项。
    persistWorkspace(remaining, contentMap, getGroups(), null)
  }

  const selectLibrary = async (library: Library) => {
    setActiveId(library.id)
    setSelectedLibraryName(library.name)
    setSelectedCollectionKey(null)
    setCurrentFolder(null)
    setSelectedDocument(null)
    const result = await getKnowledgeWorkspace<KnowledgeWorkspace>()
    if (!result.success || !result.data) return
    const data = result.data
    const latestLibrary = data.libraries.find((item) => item.name === library.name)
    setLibraries(data.libraries)
    setContentMap(data.contents || {})
    // 问答记录以内存/独立接口为准，这里不覆盖 conversationsByScope
    if (latestLibrary) setActiveId(latestLibrary.id)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // 知识库结构与内容
      const result = await getKnowledgeWorkspace<KnowledgeWorkspace>()
      if (!cancelled && result.success && result.data) {
        const data = result.data
        setLibraries(data.libraries || [])
        setContentMap(data.contents || {})
        if (data.groups?.length) {
          setSectionTitles(Object.fromEntries(data.groups.map((group) => [group.key, group.name])))
          setCustomCollections(data.groups.filter((group) => !group.system).map((group) => group.key))
          setExpanded((states) => ({ ...states, ...Object.fromEntries(data.groups!.map((group) => [group.key, states[group.key] ?? false])) }))
        }
      }
      // 问答记录：优先来自后端；后端为空/未实现时迁移 workspace 中的历史会话
      const conv = await getKnowledgeConversations()
      const serverMap = conv.success && conv.data ? conv.data : {}
      const serverNonEmpty = Object.values(serverMap).some((arr) => arr.length > 0)
      if (cancelled) return
      if (serverNonEmpty) {
        setConversationsByScope(serverMap)
      } else {
        const legacy = result.success && result.data ? normalizeConversations(result.data) : {}
        if (Object.values(legacy).some((arr) => arr.length > 0)) {
          setConversationsByScope(legacy)
          persistConversations(legacy)
        } else {
          setConversationsByScope({})
        }
      }
    })().finally(() => { if (!cancelled) setLoadingData(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    // 文档编辑发生在独立标签页里，保存后这边手里的 updatedAt 还是旧的。
    // 切回来时静默重拉一次，「覆盖原条目」这个语义才对用户可见。
    // 只在本地没有未落库改动时刷新 —— 否则会把正在写的改动冲掉。
    if (syncState !== 'idle' && syncState !== 'saved') return
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      void getKnowledgeWorkspace<KnowledgeWorkspace>().then((result) => {
        if (!result.success || !result.data) return
        setLibraries(result.data.libraries || [])
        setContentMap(result.data.contents || {})
      })
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [syncState])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current
      const workspace = workspaceRef.current
      if (!drag || !workspace) return
      const totalWidth = workspace.getBoundingClientRect().width
      const nextWidth = drag.startWidth + event.clientX - drag.startX
      if (drag.pane === 'left') {
        setLeftWidth(Math.max(180, Math.min(nextWidth, Math.min(360, totalWidth - middleWidth - 368))))
      } else {
        setMiddleWidth(Math.max(300, Math.min(nextWidth, totalWidth - leftWidth - 368)))
      }
    }
    const stop = () => {
      if (!dragRef.current) return
      dragRef.current = null
      setResizing(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [leftWidth, middleWidth])

  useEffect(() => {
    if (!resizing) return
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [resizing])

  const startResize = (pane: 'left' | 'middle', event: React.PointerEvent) => {
    dragRef.current = { pane, startX: event.clientX, startWidth: pane === 'left' ? leftWidth : middleWidth }
    setResizing(true)
    event.preventDefault()
  }

  const nudgePane = (pane: 'left' | 'middle', delta: number) => {
    const totalWidth = workspaceRef.current?.getBoundingClientRect().width ?? 1200
    if (pane === 'left') setLeftWidth((width) => Math.max(180, Math.min(width + delta, Math.min(360, totalWidth - middleWidth - 368))))
    else setMiddleWidth((width) => Math.max(300, Math.min(width + delta, totalWidth - leftWidth - 368)))
  }

  const resizeHandle = (pane: 'left' | 'middle', label: string) => (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={(event) => startResize(pane, event)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); nudgePane(pane, -12) }
        if (event.key === 'ArrowRight') { event.preventDefault(); nudgePane(pane, 12) }
      }}
      className="group z-20 flex w-2 shrink-0 self-stretch cursor-col-resize items-center justify-center bg-base-200/30 outline-none transition-colors hover:bg-base-200 focus:bg-primary/10"
    >
      <span className="h-8 w-0.5 rounded-full bg-base-content/20 transition-colors group-hover:bg-primary/50 group-focus:bg-primary/50" />
    </div>
  )

  const ask = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = question.trim()
    const scope = activeScope
    if (!text || !scope || asking) return
    if (scope.level === 'collection' && !scope.libraryIds.length) return
    // 仅当编辑态仍属于当前活跃会话时才生效；切走会话/作用域后按新提问处理
    const editingIndex = editingActive ? editingMessageIndex : null
    const now = new Date().toISOString()
    const userMessage = { role: 'user' as const, text, createdAt: now }
    const key = scopeKey(scope)
    const current = activeConversation
    const currentScopeConvs = scopeConversations
    let targetId: string
    let nextMap: Record<string, Conversation[]>
    // 前半：显式计算用户消息入列后的 nextMap 并立即持久化（abort 后用户消息也已在库）
    if (current) {
      targetId = current.id
      const base = editingIndex === null ? current.messages : current.messages.slice(0, editingIndex)
      const nextConv: Conversation = {
        ...current,
        title: current.title === '新对话' ? truncateTitle(text) : current.title,
        messages: [...base, userMessage],
        updatedAt: now,
      }
      nextMap = { ...conversationsByScope, [key]: currentScopeConvs.map((c) => (c.id === targetId ? nextConv : c)) }
    } else {
      targetId = createConversationId()
      const conversation: Conversation = { id: targetId, title: truncateTitle(text), messages: [userMessage], createdAt: now, updatedAt: now }
      nextMap = { ...conversationsByScope, [key]: [conversation, ...currentScopeConvs] }
    }
    setConversationsByScope(nextMap)
    persistConversations(nextMap)
    setQuestion('')
    setEditingMessageIndex(null)
    setEditingConversationId(null)
    setAsking(true)
    setAskingConvId(targetId)
    const controller = new AbortController()
    setAbortController(controller)
    const libraryId = scope.level === 'collection' ? scope.libraryIds[0] : scope.libraryId
    const askScope: KnowledgeAskScope | undefined = selectedDocument
      ? { level: 'document', libraryId, name: selectedDocument.name, parent: selectedDocument.parent || '' }
      : scope.level === 'collection'
        ? { level: 'collection', key: scope.key, libraryIds: scope.libraryIds }
        : scope.level === 'folder'
          ? { level: 'folder', libraryId: scope.libraryId, folder: scope.folder }
          : undefined
    const history = current ? (editingIndex === null ? current.messages : current.messages.slice(0, editingIndex)) : []
    const result = await askKnowledge(libraryId, text, history, controller.signal, askScope)
    if (controller.signal.aborted) return
    const answer = result.success && result.data ? result.data.answer : `问答失败：${result.error || '未知错误'}`
    const citations = result.success && result.data ? result.data.citations : []
    const assistantMessage = { role: 'assistant' as const, text: answer, createdAt: new Date().toISOString(), ...(citations.length ? { citations } : {}) }
    // 后半：基于前半捕获的 nextMap 追加助手消息（不能重读 activeConversation 闭包）；
    // 会话在等待期间被删除（convIndex === -1）则不复活、不写回
    const convs = nextMap[key] ?? []
    const convIndex = convs.findIndex((c) => c.id === targetId)
    if (convIndex !== -1) {
      const conv = convs[convIndex]
      const msgs = editingIndex === null ? [...conv.messages, assistantMessage] : [...conv.messages.slice(0, editingIndex), userMessage, assistantMessage]
      const assistantMap = { ...nextMap, [key]: convs.map((c, i) => (i === convIndex ? { ...c, messages: msgs, updatedAt: new Date().toISOString() } : c)) }
      setConversationsByScope(assistantMap)
      persistConversations(assistantMap)
    }
    setAsking(false)
    setAskingConvId(null)
    setAbortController(null)
  }

  const stopGeneration = () => {
    abortController?.abort()
    setAbortController(null)
    setAsking(false)
    setAskingConvId(null)
  }

  const createNewConversation = () => {
    if (!activeScope) return
    // 当前活跃会话已是空会话时不再重复新建，避免空会话堆积
    if (activeConversation && activeConversation.messages.length === 0) {
      setQuestion('')
      setEditingMessageIndex(null)
      setEditingConversationId(null)
      return
    }
    const now = new Date().toISOString()
    const key = scopeKey(activeScope)
    const conversation: Conversation = { id: createConversationId(), title: '新对话', messages: [], createdAt: now, updatedAt: now }
    const nextMap = { ...conversationsByScope, [key]: [conversation, ...(conversationsByScope[key] ?? [])] }
    setConversationsByScope(nextMap)
    persistConversations(nextMap)
    setQuestion('')
    setEditingMessageIndex(null)
    setEditingConversationId(null)
  }

  const viewConversation = (conversationId: string) => {
    if (!activeScope) return
    const key = scopeKey(activeScope)
    const convs = conversationsByScope[key] ?? []
    const index = convs.findIndex((c) => c.id === conversationId)
    // index > 0 才需要置顶重排；同时避免 index === -1 时 splice(-1, 1) 误删末尾会话
    if (index > 0) {
      const next = [...convs]
      const [conversation] = next.splice(index, 1)
      next.unshift(conversation)
      const nextMap = { ...conversationsByScope, [key]: next }
      setConversationsByScope(nextMap)
      persistConversations(nextMap)
    }
    setEditingMessageIndex(null)
    setEditingConversationId(null)
    setQuestion('')
    setHistoryOpen(false)
  }

  const deleteConversation = (conversationId: string) => {
    if (!activeScope) return
    const target = scopeConversations.find((c) => c.id === conversationId)
    if (!target) return
    if (!window.confirm(`确定删除对话「${target.title}」吗？删除后无法恢复。`)) return
    if (conversationId === activeConversation?.id && asking) stopGeneration()
    const key = scopeKey(activeScope)
    const nextMap = { ...conversationsByScope, [key]: (conversationsByScope[key] ?? []).filter((c) => c.id !== conversationId) }
    setConversationsByScope(nextMap)
    persistConversations(nextMap)
  }

  // 带上 id/mimeType/size：新标签页可以直接用 content_key 按需下载文件，
  // 不必为了找一个条目再把整个工作区拉一遍（libraryId 为空时那条路径本来就不可用）。
  const getDocumentTabUrl = (item: ContentItem) => {
    const params = new URLSearchParams({
      id: item.id,
      name: item.name,
      type: item.type,
      updatedAt: item.updatedAt,
      library: active?.name || selectedLibraryName || '知识库',
      libraryId: String(activeId || ''),
      ...(item.mimeType ? { mimeType: item.mimeType } : {}),
      ...(item.size != null ? { size: String(item.size) } : {}),
      ...(item.parent ? { parent: item.parent } : {}),
    })
    return `${import.meta.env.BASE_URL}knowledge/document?${params.toString()}`
  }

  const section = (key: string, title: string, children?: React.ReactNode, onAdd?: () => void) => {
    const menuOpen = openMenuId === sectionMenuKey(key)
    return <div className="border-b border-base-200 py-2">
      {/* 悬停高亮挂在外层整行上，不挂在标题按钮上：挂在按钮上时高亮在「⋯」前面就断了，
          鼠标移到「⋯」上整行反而没反应。知识库行一直是整行高亮，这里对齐它。 */}
      <div className={`group flex items-center gap-1 rounded-lg px-2 ${selectedCollectionKey === key ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-base-200/70'}`}>
        <button className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium" onClick={() => { setExpanded((state) => ({ ...state, [key]: !state[key] })); setSelectedCollectionKey((current) => (current === key ? null : key)) }}>
          <Icon className={`shrink-0 transition ${expanded[key] ? 'rotate-90' : ''}`}><path d="m9 18 6-6-6-6" /></Icon>
          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left" title={title}>{title}</span>
        </button>
        {/* 这一行原先是并排三个 hover 按钮（+ / 改名 / 删库），是页面上唯一没走「⋯」的地方：
            尺寸是 DaisyUI 的 24px、图标各画各的，旁边的知识库行却是 32px 的「⋯」。收进同一个菜单后
            图标、尺寸、显隐规则全部一致，代价是「添加知识库」多一次点击。 */}
        <div className="mr-1"><RowMenuTrigger open={menuOpen} onClick={(event) => toggleRowMenu(sectionMenuKey(key), event.currentTarget)} label={`${title}操作`} /></div>
      </div>
      {expanded[key] && children}
      {menuOpen && menuAnchor ? <RowMenuPopover anchor={menuAnchor} panelRef={rowMenuRef}>
        <MenuAction icon={menuIcons.folderPlus} label="添加知识库" onClick={() => { closeRowMenu(); onAdd?.() }} />
        <MenuAction icon={menuIcons.edit} label="重命名分组" onClick={() => { closeRowMenu(); renameSection(key) }} />
        <MenuAction icon={menuIcons.trash} label="删除分组" tone="danger" onClick={() => { closeRowMenu(); deleteSectionLibraries(key) }} />
      </RowMenuPopover> : null}
    </div>
  }

  const renderLibraryList = (type: NonNullable<Library['type']>) => {
    const items = visibleLibraries.filter((library) => (library.type || 'personal') === type)
    // 判定式跟上面 visibleLibraries 的过滤条件保持一致——那边用的是 libraryQuery，不 trim。
    // 这里 trim 的话，查询串是 " " 时列表被过滤了、拖拽却是开的，就会对着看不见的行算锚点。
    const dragEnabled = !libraryQuery
    return <div className="space-y-1 px-1 pb-1">
      {items.map((library) => {
        const menuOpen = openMenuId === libraryMenuKey(library.id)
        const isDragged = dragPayload?.id === library.id
        // 只接同组。分组就是 type，跨组投放要顺带改归属，那是另一个手势，这里不接。
        const accepts = dragEnabled && dragPayload !== null && dragPayload.id !== library.id && dragPayload.section === type
        const zone = dropTarget?.id === library.id ? dropTarget.zone : null
        return <div
          key={library.id}
          className={`group relative flex flex-col rounded-lg transition-all ${selectedLibraryName === library.name ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-base-200/70'} ${isDragged ? 'opacity-40' : ''}`}
          aria-selected={selectedLibraryName === library.name}
          onDragOver={accepts ? (event) => {
            event.preventDefault()
            const next = zoneAtDrop(event)
            // 必须做恒等短路：每帧都是新对象的话 Object.is 永不相等，整个知识库页会跟着鼠标 60fps 重渲染。
            setDropTarget((current) => current?.id === library.id && current.zone === next ? current : { id: library.id, zone: next })
          } : undefined}
          onDrop={accepts ? (event) => {
            event.preventDefault()
            moveLibrary(library.id, zoneAtDrop(event) === 'after')
            finishDrag()
          } : undefined}
        >
          {/* 落点指示器用绝对定位的细条，没有照抄接口信息的 border-t-2：那会把行高撑大 2px，
              而 zoneAtDrop 量的就是这个行的实时 rect，中线跟着漂——光标恰好卡在那 1px 里就会
              「亮→灭→亮」来回翻，下面所有行每次悬停也跟着位移。绝对定位完全不动布局。
              另外 border-primary 也会和选中行的 ring-1 ring-primary/30 打架。
              -top-0.5/-bottom-0.5 让细条落在 space-y-1 那 4px 间隙里，不压在行自己的背景上。 */}
          {zone === 'before' && <span className="pointer-events-none absolute inset-x-1 -top-0.5 h-0.5 rounded-full bg-primary" />}
          {zone === 'after' && <span className="pointer-events-none absolute inset-x-1 -bottom-0.5 h-0.5 rounded-full bg-primary" />}
          <div className="flex h-10 items-center">
            {/* 光标必须是三元而不是两个类名并存：cursor-grab 和 cursor-not-allowed 同优先级，
                谁生效取决于样式表里的先后，跟 class 写的顺序无关。
                这个手柄没有 onClick 守卫也不需要：本行没有 onClick，下面那个点击按钮是它的兄弟
                而不是祖先，点手柄碰不到它（接口信息那边需要守卫是因为行点击挂在祖先 div 上）。 */}
            <span
              className={`shrink-0 select-none pl-1 text-base-content/25 ${dragEnabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-30'}`}
              draggable={dragEnabled}
              title={dragEnabled ? '拖动排序' : '搜索时无法排序'}
              onDragStart={(event) => {
                if (!dragEnabled) return
                event.stopPropagation()
                event.dataTransfer.effectAllowed = 'move'
                // 真实拖拽里 useRowMenu 的 document pointerdown 监听总是先于 dragstart 触发，菜单
                // 早就关了；这行是给派发合成 DragEvent 的 QA 脚本兜底的，那里没有 pointerdown。
                closeRowMenu()
                setDragPayload({ id: library.id, section: type })
              }}
              onDragEnd={finishDrag}
            >⠿</span>
            <button onClick={() => { void selectLibrary(library) }} className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 text-left text-sm text-base-content/70 transition">
              <LibraryCover cover={library.icon} className="h-6 w-6 shrink-0" />
              <span className="truncate">{library.name}</span>
            </button>
            <div className="mr-1"><RowMenuTrigger open={menuOpen} onClick={(event) => toggleRowMenu(libraryMenuKey(library.id), event.currentTarget)} label={`${library.name}操作`} /></div>
          </div>
          {menuOpen && menuAnchor ? <RowMenuPopover anchor={menuAnchor} panelRef={rowMenuRef}>
            <MenuAction icon={menuIcons.edit} label="修改资料" onClick={() => { closeRowMenu(); setEditingLibraryId(library.id); setEditingLibraryName(library.name); setEditingLibraryCover(library.icon || 'neural') }} />
            <MenuAction icon={menuIcons.trash} label="删除" tone="danger" onClick={() => { closeRowMenu(); setDeletingLibraryId(library.id) }} />
          </RowMenuPopover> : null}
        </div>
      })}
      {!items.length && <p className="px-3 py-3 text-xs text-base-content/35">暂无知识库</p>}
    </div>
  }

  return (
    <div className="flex h-full min-h-155 flex-col gap-6 overflow-hidden">
      <div className="flex shrink-0 items-center justify-between">
        <h1 className="text-2xl font-bold text-base-content">知识库</h1>
        <span className={`text-xs transition-opacity ${syncState === 'idle' ? 'opacity-0' : 'opacity-100'} ${syncState === 'error' ? 'text-error' : 'text-base-content/40'}`}>{syncState === 'saving' ? '正在保存…' : syncState === 'saved' ? '已保存' : syncState === 'error' ? (syncConflict ? '保存冲突：其他窗口已修改，请刷新' : '保存失败') : ''}</span>
      </div>

      <div ref={workspaceRef} className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-base-200 bg-base-100 shadow-sm">
      <aside style={{ width: leftWidth }} className="flex shrink-0 flex-col bg-base-100">
        <div className="flex h-14 items-center justify-between border-b border-base-200 px-4">
          <span className={`whitespace-nowrap text-sm font-medium text-base-content/70 transition-all duration-200 ${librarySearchOpen ? 'w-0 overflow-hidden opacity-0' : 'w-auto opacity-100'}`}>我的知识库</span>
          <div className={`ml-auto flex h-9 items-center overflow-hidden rounded-lg transition-all duration-200 ${librarySearchOpen ? 'w-full border border-base-300 bg-base-100 shadow-sm' : 'w-9'}`}>
            {librarySearchOpen && <AutofocusInput value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setLibrarySearchOpen(false); setLibraryQuery('') } }} className="min-w-0 flex-1 bg-transparent pl-3 text-sm outline-none" placeholder="搜索知识库" />}
            <button onClick={() => { if (librarySearchOpen) setLibraryQuery(''); setLibrarySearchOpen((open) => !open) }} className="flex h-9 w-9 shrink-0 items-center justify-center text-base-content/55 hover:bg-base-200" aria-label={librarySearchOpen ? '关闭知识库搜索' : '搜索知识库'}><Icon>{librarySearchOpen ? <><path d="M18 6 6 18M6 6l12 12" /></> : <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>}</Icon></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-1">
          {section('personal', sectionTitles.personal, renderLibraryList('personal'), () => { setCreatingLibraryType('personal'); setCreatingLibrary(true) })}
          {section('shared', sectionTitles.shared, renderLibraryList('shared'), () => { setCreatingLibraryType('shared'); setCreatingLibrary(true) })}
          {section('subscribed', sectionTitles.subscribed, renderLibraryList('subscribed'), () => { setCreatingLibraryType('subscribed'); setCreatingLibrary(true) })}
          {customCollections.map((key) => section(key, sectionTitles[key], <p className="px-5 pb-3 text-xs text-base-content/35">暂无知识库</p>, () => { setCreatingLibraryType('personal'); setCreatingLibrary(true) }))}
        </div>
        <div className="p-3">
          <button type="button" className="btn btn-ghost btn-block" onClick={createKnowledgeCollection} title="新建知识库集合">+ 新建知识库集合</button>
        </div>
      </aside>

      {resizeHandle('left', '调整知识库列表宽度')}

      <section style={{ width: middleWidth }} className="flex shrink-0 flex-col bg-base-100">
        <div className="relative flex items-center gap-2 border-b border-base-200 px-4 py-3">
          {currentFolder && <button onClick={() => setCurrentFolder(currentFolder.includes('/') ? currentFolder.slice(0, currentFolder.lastIndexOf('/')) : null)} className="rounded-lg p-2 text-base-content/55 hover:bg-base-200" title="返回上一级"><Icon><path d="m15 18-6-6 6-6" /></Icon></button>}
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-base-200/70 px-3 text-base-content/35"><Icon><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon><input disabled={!active} value={query} onChange={(e) => setQuery(e.target.value)} className="w-full bg-transparent text-sm text-base-content outline-none disabled:cursor-not-allowed" placeholder={active ? '搜索内容' : '请先选择知识库'} /></label>
          <div ref={sortPopoverRef} className="relative shrink-0">
            <button disabled={!active} onClick={() => { setSortOpen((open) => !open); setAddMenuOpen(false) }} className={`rounded-lg p-2 text-base-content/45 hover:bg-base-200 disabled:cursor-not-allowed disabled:opacity-30 ${sortOpen ? 'bg-base-200 text-base-content' : ''}`} title="排序"><Icon><path d="M8 6h12M8 12h8M8 18h4" /><path d="M4 4v16m0 0-2-2m2 2 2-2" /></Icon></button>
            {sortOpen && <div className="absolute right-0 top-[calc(100%+6px)] z-50">
              <MenuPanel>
                {([['updated', '更新时间'], ['created', '创建时间'], ['size', '大小'], ['type', '类型'], ['name', '名称']] as const).map(([key, label]) => (
                  <MenuAction key={key} icon={<span className="flex w-4 justify-center">{sortKey === key ? menuIcons.check : null}</span>} label={label} active={sortKey === key} onClick={() => { setSortKey(key); setSortOpen(false) }} />
                ))}
              </MenuPanel>
            </div>}
          </div>
          <div ref={addPopoverRef} className="relative shrink-0">
            <button disabled={!active} onClick={() => { setAddMenuOpen((open) => !open); setSortOpen(false) }} className={`rounded-lg p-2 text-base-content/45 hover:bg-base-200 disabled:cursor-not-allowed disabled:opacity-30 ${addMenuOpen ? 'bg-base-200 text-base-content' : ''}`} title="添加内容"><Icon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M12 12v6m-3-3h6" /></Icon></button>
            {addMenuOpen && <div className="absolute right-0 top-[calc(100%+6px)] z-50">
              <MenuPanel>
                <MenuAction icon={menuIcons.uploadFile} label="本地文件" onClick={() => { setAddMenuOpen(false); fileInputRef.current?.click() }} />
                <MenuAction icon={menuIcons.uploadFolder} label="本地文件夹" onClick={() => { setAddMenuOpen(false); folderInputRef.current?.click() }} />
                <div className="my-1 border-t border-base-200" />
                <MenuAction icon={menuIcons.link} label="网页链接" onClick={openAddWebLink} />
                <div className="my-1 border-t border-base-200" />
                <MenuAction icon={menuIcons.folderPlus} label="新建文件夹" onClick={() => { setAddMenuOpen(false); setNewContentType('folder'); setNewContentName(''); setNewContentError(null); if (activeId != null) setAddingContentLibraryId(activeId) }} />
              </MenuPanel>
            </div>}
          </div>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files || []); event.target.value = ''; void importLocalFiles(files) }} />
          <input ref={folderInputRef} type="file" multiple className="hidden" {...{ webkitdirectory: '' }} onChange={(event) => { const files = Array.from(event.target.files || []) as Array<File & { webkitRelativePath?: string }>; event.target.value = ''; void importLocalFolder(files) }} />
        </div>
        {currentFolder && <div className="flex h-10 items-center gap-1 border-b border-base-200 px-4 text-xs text-base-content/45"><button onClick={() => setCurrentFolder(null)} className="hover:text-primary">全部内容</button>{currentFolder.split('/').map((part, index, parts) => <span key={`${part}-${index}`} className="flex items-center gap-1"><span>/</span><button onClick={() => setCurrentFolder(parts.slice(0, index + 1).join('/'))} className={index === parts.length - 1 ? 'font-medium text-base-content/70' : 'hover:text-primary'}>{part}</button></span>)}</div>}
        <div className="flex-1 overflow-y-auto p-3">
          {visibleUploads.map((task) => <div key={`upload-${task.id}`} className="flex w-full items-center rounded-xl bg-base-200/40">
            <span className="flex h-9 w-10 shrink-0 items-center justify-center">{task.phase === 'failed' ? <Icon className="text-error"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></Icon> : <span className="loading loading-spinner loading-sm text-primary" />}</span>
            <span className="min-w-0 flex-1 py-3 pr-2">
              <span className="block truncate text-sm font-medium">{task.name}</span>
              <span className="mt-1.5 flex items-center gap-2">
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-base-200"><span className={`block h-full rounded-full transition-[width] duration-200 ${task.phase === 'failed' ? 'bg-error' : task.phase === 'saving' ? 'bg-primary' : 'bg-success'}`} style={{ width: `${task.phase === 'failed' ? 100 : task.percent}%` }} /></span>
                <span className={`shrink-0 text-xs ${task.phase === 'failed' ? 'text-error' : 'text-base-content/50'}`}>{task.phase === 'failed' ? task.error : `${task.phase === 'saving' ? '上传中' : '读取中'} ${task.percent}%`}</span>
                <span className="shrink-0 text-xs text-base-content/35">{formatFileSize(task.size)}</span>
              </span>
            </span>
            {task.phase === 'failed' && <button onClick={() => dismissUploadTask(task.id)} className="mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base-content/30 hover:bg-base-200 hover:text-base-content" title="忽略"><Icon><path d="M18 6 6 18M6 6l12 12" /></Icon></button>}
          </div>)}
          {visibleContents.map((item, index) => {
            const content = <>
              {item.type === 'folder' ? <span className="relative h-9 w-10 shrink-0"><svg viewBox="0 0 40 36" className="h-full w-full"><path fill="#9bd7bd" d="M2 8a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z"/><path fill="#c8eadb" d="M2 13h36v18a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z"/></svg></span> : <ContentRowThumb item={item} enabled={index < THUMBNAIL_LIMIT} />}
              {/* 链接条目只显示域名，同一站点的多个页面会长得一样；把完整地址放进副标题是唯一能区分它们的线索。 */}
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.name}</span><span className={`mt-1 block truncate text-xs text-base-content/35 ${item.url ? 'pr-2' : ''}`} title={item.url}>{item.type === 'folder' ? `${getActualFolderCount(item)} 项 · ` : ''}{item.url || formatContentUpdatedAt(item.updatedAt)}</span></span>
              <span className="opacity-0 transition group-hover:opacity-100"><Icon className="text-base-content/30"><path d="m9 18 6-6-6-6" /></Icon></span>
            </>
            const menuOpen = openMenuId === item.id
            return <div key={`${item.parent || 'root'}-${item.name}`} className={`group flex flex-col rounded-xl hover:bg-base-200/60 ${menuOpen ? 'bg-base-200/60' : ''} ${selectedDocument === item ? 'bg-primary/5 ring-1 ring-primary/15' : ''}`}>
              <div className="flex w-full items-center">
                {item.type === 'folder'
                  ? <button onClick={() => { setCurrentFolder(currentFolder ? `${currentFolder}/${item.name}` : item.name); setSelectedDocument(null); setQuery('') }} className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-3 text-left">{content}</button>
                  : <a href={item.url || getDocumentTabUrl(item)} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-3 text-left">{content}</a>}
                {/* 「⋯」触发器。菜单展开时保持可见，否则鼠标移开行、菜单还开着却找不到它的入口。
                    focus 让键盘 Tab 也能把触发器显出来，不然焦点会落在看不见的按钮上。 */}
                <div className="mr-2"><RowMenuTrigger open={menuOpen} onClick={(event) => toggleRowMenu(item.id, event.currentTarget)} label="更多操作" /></div>
              </div>
              {menuOpen && menuAnchor ? <RowMenuPopover anchor={menuAnchor} panelRef={rowMenuRef}>
                <MenuAction icon={menuIcons.edit} label={item.url ? '编辑' : '重命名'} onClick={() => openRenameContent(item)} />
                <MenuAction icon={menuIcons.move} label="移动到" onClick={() => openMoveContent(item)} />
                <MenuAction icon={menuIcons.trash} label="删除" tone="danger" onClick={() => { closeRowMenu(); setDeletingContent(item) }} />
              </RowMenuPopover> : null}
            </div>
          })}
          {!visibleContents.length && !visibleUploads.length && (!active ? <div className="flex min-h-80 flex-col items-center justify-center px-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/8 text-primary"><Icon className="h-6 w-6"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H6.5A2.5 2.5 0 0 1 4 15.5Z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H14v18a3 3 0 0 1 3-3h.5a2.5 2.5 0 0 0 2.5-2.5Z" /></Icon></div>
            <h3 className="mt-4 text-sm font-medium text-base-content/70">从“我的知识库”开始</h3>
            <p className="mt-2 max-w-xs text-xs leading-5 text-base-content/40">从左侧选择一个知识库，即可查看其中的文件、文件夹和更新内容</p>
          </div> : <div className="py-16 text-center text-sm text-base-content/35">未找到相关内容</div>)}
        </div>
      </section>

      {resizeHandle('middle', '调整内容列表宽度')}

      <main className="relative flex min-w-90 flex-1 flex-col bg-base-100">
        {selectedDocument ? <div className="flex h-full min-h-0">
          <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-base-200 px-5">
            <DocumentTypeBadge item={selectedDocument} size="sm" />
            <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-medium">{selectedDocument.name}</h2><p className="mt-0.5 text-[11px] text-base-content/35">{formatContentUpdatedAt(selectedDocument.updatedAt)}</p></div>
            <button onClick={() => setDocumentAssistantOpen((open) => !open)} className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs hover:bg-base-200 ${documentAssistantOpen ? 'bg-emerald-50 text-emerald-600' : 'text-base-content/45'}`} title="知识助手"><span className="flex h-5 w-5 items-center justify-center rounded-md bg-linear-to-br from-lime-300 to-emerald-400 text-[9px] font-bold text-emerald-950">AI</span><span className="hidden sm:inline">助手</span></button>
            <button className="rounded-lg p-2 text-base-content/45 hover:bg-base-200" title="下载文档"><Icon><path d="M12 3v12m-4-4 4 4 4-4" /><path d="M5 21h14" /></Icon></button>
            <button onClick={() => setSelectedDocument(null)} className="rounded-lg p-2 text-base-content/45 hover:bg-base-200" title="关闭文档"><Icon><path d="M18 6 6 18M6 6l12 12" /></Icon></button>
          </div>
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-base-200 bg-base-100 px-4 text-xs text-base-content/45">
            <span>文档预览</span>
            {getDocumentKind(selectedDocument) === 'pdf' ? <span>使用 PDF 工具栏缩放、翻页和搜索</span> : <div className="flex items-center gap-1">
              <button onClick={() => setPreviewZoom((value) => Math.max(70, value - 10))} disabled={previewZoom <= 70} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-base-200 disabled:opacity-30" title="缩小">−</button>
              <span className="w-12 text-center tabular-nums">{previewZoom}%</span>
              <button onClick={() => setPreviewZoom((value) => Math.min(140, value + 10))} disabled={previewZoom >= 140} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-base-200 disabled:opacity-30" title="放大">＋</button>
              <button onClick={() => setPreviewZoom(100)} className="ml-1 rounded-md px-2 py-1.5 hover:bg-base-200">适应页面</button>
            </div>}
            <span>{getDocumentKind(selectedDocument) === 'pdf' ? 'PDF 预览' : getDocumentKind(selectedDocument) === 'sheet' ? `工作表 ${previewSheetIndex + 1} / ${Math.max(getWorkbookSheetPreviews(selectedDocument).length, 1)}` : getDocumentKind(selectedDocument) === 'markdown' ? 'Markdown 预览' : getDocumentPagePreviews(selectedDocument).length > 0 ? `共 ${getDocumentPagePreviews(selectedDocument).length} 页` : '第 1 / 1 页'}</span>
          </div>
          <div className="flex-1 overflow-auto bg-base-200/50 px-6 py-8">
            <DocumentPreviewCanvas item={selectedDocument} zoom={previewZoom} sheetIndex={previewSheetIndex} onSheetChange={setPreviewSheetIndex} />
          </div>
          </section>
          {documentAssistantOpen ? <AssistantResizeHandle onPointerDown={startDocumentAssistantResize} className="hidden 2xl:flex" /> : null}
          <aside style={{ width: documentAssistantWidth }} className={`${documentAssistantOpen ? 'flex' : 'hidden'} absolute inset-y-0 right-0 z-30 shrink-0 flex-col bg-base-100 shadow-2xl 2xl:relative 2xl:inset-auto 2xl:z-auto 2xl:shadow-none`}>
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-base-200 px-4">
              <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-br from-lime-300 to-emerald-400 text-xs font-bold text-emerald-950">AI</span><span className="text-sm font-medium">知识助手</span></div>
              <div className="flex items-center gap-0.5">
                <button onClick={() => { createNewConversation(); setHistoryOpen(false) }} disabled={!activeScope} className="rounded-lg p-2 text-base-content/45 hover:bg-base-200 disabled:opacity-30" title="新建问答" aria-label="新建问答"><Icon><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="M8 12h8M12 8v8" /></Icon></button>
                <button onClick={() => setHistoryOpen((open) => !open)} disabled={!activeScope} className={`rounded-lg p-2 hover:bg-base-200 disabled:opacity-30 ${historyOpen ? 'bg-base-200 text-primary' : 'text-base-content/45'}`} title="历史对话" aria-label="历史对话"><Icon><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></Icon></button>
                <button onClick={() => setDocumentAssistantOpen(false)} className="rounded-lg p-2 text-base-content/45 hover:bg-base-200" title="关闭助手"><Icon><path d="M18 6 6 18M6 6l12 12" /></Icon></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-16 pb-16 pt-2">
              {historyOpen ? <div className="-mx-12">
                <div className="mb-3 flex items-center justify-between px-2"><span className="text-xs font-medium text-base-content/60">历史对话</span><span className="text-[10px] text-base-content/35">{scopeConversations.length} 个</span></div>
                {!scopeConversations.length ? <p className="py-10 text-center text-xs text-base-content/35">暂无历史对话</p> : <ul className="space-y-1">{scopeConversations.map((conversation) => <li key={conversation.id} className={`group/history flex items-center gap-1 rounded-xl px-3 py-2.5 ${conversation.id === activeConversation?.id ? 'bg-primary/10' : 'hover:bg-base-200'}`}>
                  <button onClick={() => { viewConversation(conversation.id); setHistoryOpen(false) }} className="min-w-0 flex-1 text-left"><div className={`truncate text-sm ${conversation.id === activeConversation?.id ? 'font-medium text-primary' : 'text-base-content/75'}`}>{conversation.title}</div><div className="mt-0.5 text-[10px] text-base-content/35">{formatConversationTime(conversation.updatedAt)}</div></button>
                  <button onClick={() => deleteConversation(conversation.id)} className="rounded-md p-1.5 text-base-content/30 opacity-0 hover:bg-error/10 hover:text-error group-hover/history:opacity-100" title="删除对话" aria-label="删除对话"><Icon className="h-3.5 w-3.5"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4h8v2" /></Icon></button>
                </li>)}</ul>}
              </div> : !messages.length ? <p className="text-sm leading-6 text-base-content/70">你好，我是你的智能助手，能帮你快速读文章、答疑解惑，快向我提问吧！</p> : <div className="space-y-4">{messages.map((message, index) => <MessageBubble key={`${message.role}-${index}`} message={message} index={index} onEdit={asking ? undefined : (currentMessage, currentIndex) => { setQuestion(currentMessage.text); setEditingMessageIndex(currentIndex); setEditingConversationId(activeConversation?.id ?? null) }} isEditing={editingActive && editingMessageIndex === index} editValue={question} onEditChange={setQuestion} onCancelEdit={() => { setEditingMessageIndex(null); setEditingConversationId(null); setQuestion('') }} onSubmitEdit={() => { void ask() }} />)}<div ref={messagesEndRef} /></div>}
            </div>
            <div className="shrink-0 bg-base-100 px-4 pb-4 pt-0">
              {asking ? <div className="mb-2 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"><span>正在生成回答…</span><button type="button" onClick={stopGeneration} className="rounded-md bg-white px-2 py-1 font-medium">停止</button></div> : null}
              <div className="relative mb-2 rounded-xl bg-linear-to-r from-emerald-50 to-lime-100 p-3 shadow-sm">
                <button onClick={() => setSelectedDocument(null)} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-base-content/55 text-xs text-base-100">×</button>
                <div className="flex min-w-0 items-center gap-2"><span className={`text-xs font-bold ${documentKindMeta[getDocumentKind(selectedDocument)].accent}`}>{documentKindMeta[getDocumentKind(selectedDocument)].short}</span><span className="truncate text-xs font-medium">{selectedDocument.name}</span></div>
                <div className="mt-2 flex gap-1 overflow-x-auto"><button onClick={() => setQuestion('总结这篇文档')} className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-[11px]">总结</button><button onClick={() => setQuestion('根据文档生成脑图')} className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-[11px]">生成脑图</button><button onClick={() => setQuestion('根据文档生成测验')} className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-[11px]">生成测验</button></div>
              </div>
              {!editingActive ? <form onSubmit={ask} className="rounded-2xl border border-base-300 bg-base-100 p-3 shadow-md focus-within:border-primary/40">
                <textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} rows={2} className="w-full resize-none bg-transparent text-sm leading-6 outline-none" placeholder="有问题尽管问我" />
                <div className="mt-2 flex items-center justify-between"><button type="button" className="rounded-lg bg-base-200 px-2.5 py-1.5 text-xs text-base-content/60">快速回答⌄</button><div className="flex items-center gap-1"><button type="button" className="rounded-lg p-2 text-base-content/45 hover:bg-base-200"><Icon><path d="M12 3v18M3 12h18" /></Icon></button><button type="submit" disabled={!question.trim()} className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-content disabled:bg-base-300 disabled:text-base-content/30"><Icon><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></Icon></button></div></div>
              </form> : null}
              <p className="mt-2 text-center text-[10px] text-base-content/25">内容由 AI 生成，仅供参考</p>
            </div>
          </aside>
        </div> : <>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-base-200 bg-base-100 px-4">
          <div className="flex min-w-0 items-center gap-2">
            {activeScope ? <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-medium text-primary"><span className="truncate">{scopeLabel(activeScope)}</span></span> : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {activeScope?.level === 'collection' ? <button onClick={() => setSelectedCollectionKey(null)} className="rounded-lg px-2 py-1.5 text-[11px] text-base-content/40 hover:bg-base-200 hover:text-primary" title="退出集合问答">退出</button> : null}
            <button onClick={createNewConversation} disabled={!activeScope} title="新建对话" className="rounded-lg p-2 text-base-content/45 hover:bg-base-200 disabled:opacity-30 disabled:hover:bg-transparent"><Icon><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="M8 12h8M12 8v8" /></Icon></button>
            <button onClick={() => setHistoryOpen((open) => !open)} disabled={!activeScope} title="历史对话" className={`rounded-lg p-2 hover:bg-base-200 disabled:opacity-30 disabled:hover:bg-transparent ${historyOpen ? 'bg-base-200 text-primary' : 'text-base-content/45'}`}><Icon><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></Icon></button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          {historyOpen && activeScope ? <aside className="w-64 shrink-0 overflow-y-auto border-r border-base-200 bg-base-100 py-2">
            <div className="mb-2 flex items-center justify-between px-3"><span className="text-xs font-medium text-base-content/60">历史对话</span><span className="text-[10px] text-base-content/35">{scopeConversations.length} 个</span></div>
            {scopeConversations.length === 0 ? <p className="px-3 py-8 text-center text-xs text-base-content/35">暂无历史对话</p> : <ul className="space-y-0.5 px-2">
              {scopeConversations.map((conversation) => {
                const isActive = conversation.id === activeConversation?.id
                return <li key={conversation.id} className={`group flex items-center gap-1 rounded-lg px-2 py-2 ${isActive ? 'bg-primary/10' : 'hover:bg-base-200'}`}>
                  <button onClick={() => viewConversation(conversation.id)} className="min-w-0 flex-1 text-left" title={conversation.title}><div className={`truncate text-sm ${isActive ? 'font-medium text-primary' : 'text-base-content/80'}`}>{conversation.title}</div><div className="mt-0.5 text-[10px] text-base-content/35">{formatConversationTime(conversation.updatedAt)}</div></button>
                  <button onClick={() => deleteConversation(conversation.id)} title="删除对话" className="shrink-0 rounded-md p-1 text-base-content/30 opacity-0 transition-opacity hover:bg-error/10 hover:text-error group-hover:opacity-100"><Icon><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M10 11v6M14 11v6" /></Icon></button>
                </li>
              })}
            </ul>}
          </aside> : null}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1 overflow-y-auto px-6 pb-16 pt-6">
            {loadingData ? <div className="flex h-full items-center justify-center"><span className="loading loading-spinner loading-md text-primary" /></div> : !activeScope ? <div className="flex h-full min-h-80 flex-col items-center justify-center px-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500"><Icon className="h-7 w-7"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><path d="M8 9h8M8 13h5" /></Icon></div>
            <h3 className="mt-4 font-medium text-base-content/70">选择知识库开始问答</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-base-content/40">左侧“我的知识库”已准备就绪，选择一个知识库或知识库集合后即可查看内容并基于资料提问</p>
          </div> : activeScope.level === 'collection' && !activeScope.libraryIds.length ? <div className="flex h-full min-h-80 flex-col items-center justify-center px-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-base-200/60 text-base-content/40"><Icon className="h-6 w-6"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H6.5A2.5 2.5 0 0 1 4 15.5Z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H14v18a3 3 0 0 1 3-3h.5a2.5 2.5 0 0 0 2.5-2.5Z" /></Icon></div>
            <h3 className="mt-4 font-medium">该集合下暂无知识库</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-base-content/40">请先向「{sectionTitles[activeScope.key] || '该集合'}」中添加知识库，再基于集合提问</p>
          </div> : !messages.length ? <div className="flex h-full min-h-80 flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500"><Icon className="h-6 w-6"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" /><path d="M8 9h8M8 13h5" /></Icon></div>
            {activeScope.level === 'folder' ? <><h3 className="mt-4 font-medium">基于文件夹问答</h3><p className="mt-2 max-w-sm text-sm leading-6 text-base-content/40">向我提问，我会从「{active?.name || ''} / {activeScope.folder}」中查找信息并整理答案</p></> : activeScope.level === 'collection' ? <><h3 className="mt-4 font-medium">基于知识库集合问答</h3><p className="mt-2 max-w-sm text-sm leading-6 text-base-content/40">向我提问，我会从「{sectionTitles[activeScope.key] || '该集合'}」中的全部知识库查找信息并整理答案</p></> : <><h3 className="mt-4 font-medium">基于知识库问答</h3><p className="mt-2 max-w-sm text-sm leading-6 text-base-content/40">向我提问，我会从「{active?.name || ''}」中查找信息并整理答案</p></>}
            <div className="mt-6 grid max-w-xl gap-2 sm:grid-cols-2">{(activeScope.level === 'collection' ? ['总结这个集合的主要内容', '集合中有哪些最近更新的资料？', '帮我汇总各知识库的产品需求', '根据集合内资料生成一份摘要'] : activeScope.level === 'folder' ? ['总结这个文件夹中的文档', '文件夹中有哪些资料？', '帮我查找相关需求文档', '根据文件夹内容生成摘要'] : ['总结这个知识库的主要内容', '有哪些最近更新的资料？', '帮我查找相关产品需求', '根据资料生成一份摘要']).map((prompt) => <button key={prompt} onClick={() => setQuestion(prompt)} className="rounded-xl border border-base-200 px-4 py-3 text-left text-xs text-base-content/55 hover:border-primary/25 hover:bg-primary/5 hover:text-primary">{prompt}</button>)}</div>
          </div> : <div className="mx-auto max-w-4xl space-y-5">{messages.map((message, index) => <MessageBubble key={`${message.role}-${index}`} message={message} bubbleClass="max-w-full px-0 py-1" index={index} onEdit={asking ? undefined : (currentMessage, currentIndex) => { setQuestion(currentMessage.text); setEditingMessageIndex(currentIndex); setEditingConversationId(activeConversation?.id ?? null) }} isEditing={editingActive && editingMessageIndex === index} editValue={question} onEditChange={setQuestion} onCancelEdit={() => { setEditingMessageIndex(null); setEditingConversationId(null); setQuestion('') }} onSubmitEdit={() => { void ask() }} />)}<div ref={messagesEndRef} /></div>}
            </div>
            <div className="shrink-0 bg-base-100 px-6 pb-5 pt-0">
              {asking && askingConvId === activeConversation?.id ? <div className="mx-auto mb-3 flex max-w-4xl items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700"><span>正在生成回答…</span><button type="button" onClick={stopGeneration} className="rounded-md bg-white px-2 py-1 font-medium">停止</button></div> : null}
              {!editingActive ? <form onSubmit={ask} className="mx-auto max-w-4xl rounded-2xl border border-base-300 bg-base-100 p-3 shadow-lg shadow-black/5 focus-within:border-primary/40">
                <textarea disabled={inputDisabled} value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} rows={2} className="w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none disabled:cursor-not-allowed" placeholder={inputPlaceholder} />
                <div className="mt-2 flex items-center justify-between"><button type="button" disabled={inputDisabled} className="rounded-lg bg-base-200 px-3 py-1.5 text-xs text-base-content/60 disabled:opacity-40">快速回答⌄</button><div className="flex items-center gap-1"><button type="button" disabled={inputDisabled} className="rounded-lg p-2 text-base-content/45 hover:bg-base-200 disabled:opacity-30" title="添加附件"><Icon><path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7L9.7 17.7a2 2 0 0 1-2.8-2.8l8.9-8.9" /></Icon></button><button type="submit" disabled={inputDisabled || !question.trim()} className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-content transition disabled:bg-base-300 disabled:text-base-content/30" aria-label="发送"><Icon><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></Icon></button></div></div>
              </form> : null}
            </div>
          </div>
        </div>
        </>}
      </main>
      </div>

      {deletingLibraryId != null && <Dialog onClose={() => setDeletingLibraryId(null)}>
        <DialogHeader
          title="删除知识库"
          icon={<span className="text-error">{menuIcons.trash}</span>}
          subtitle={`确定删除“${libraries.find((library) => library.id === deletingLibraryId)?.name}”吗？其中的内容和问答记录也会一并删除。`}
          onClose={() => setDeletingLibraryId(null)}
        />
        <DialogActions>
          <button onClick={() => setDeletingLibraryId(null)} className="btn btn-ghost">取消</button>
          <button onClick={() => deleteLibrary(deletingLibraryId)} className="btn btn-error">删除</button>
        </DialogActions>
      </Dialog>}

      {editingLibraryId != null && <Dialog width="md" onClose={() => setEditingLibraryId(null)}>
        <DialogHeader title="修改资料" icon={menuIcons.edit} onClose={() => setEditingLibraryId(null)} />
        <DialogField label="名称" required>
          <AutofocusInput value={editingLibraryName} onChange={(event) => setEditingLibraryName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && saveLibraryProfile(editingLibraryId)} className="input input-bordered mt-1.5 w-full" placeholder="请输入知识库名称" />
        </DialogField>
        <CoverPicker value={editingLibraryCover} onChange={setEditingLibraryCover} />
        <DialogActions>
          <button onClick={() => setEditingLibraryId(null)} className="btn btn-ghost">取消</button>
          <button onClick={() => saveLibraryProfile(editingLibraryId)} disabled={!editingLibraryName.trim()} className="btn btn-primary">保存</button>
        </DialogActions>
      </Dialog>}

      {deletingContent && <Dialog onClose={() => setDeletingContent(null)}>
        <DialogHeader
          title="确认删除"
          icon={<span className="text-error">{menuIcons.trash}</span>}
          subtitle={<>确定删除“{deletingContent.name}”吗？{deletingContent.type === 'folder' ? '文件夹内的全部内容也会一并删除，且无法恢复。' : '删除后无法恢复。'}</>}
          onClose={() => setDeletingContent(null)}
        />
        {/* 链接条目只以域名命名，同名条目在确认框里也必须能区分，否则用户是在盲删。 */}
        {deletingContent.url ? <p className="mt-2 wrap-anywhere text-xs leading-5 text-base-content/40">{deletingContent.url}</p> : null}
        <DialogActions>
          <button onClick={() => setDeletingContent(null)} className="btn btn-ghost">取消</button>
          <button onClick={() => deleteContent(deletingContent)} className="btn btn-error">删除</button>
        </DialogActions>
      </Dialog>}

      {creatingLibrary && <Dialog width="md" onClose={() => setCreatingLibrary(false)}>
        <DialogHeader title="新建知识库" icon={menuIcons.folderPlus} onClose={() => setCreatingLibrary(false)} />
        <DialogField label="名称" required>
          <AutofocusInput value={newLibraryName} onChange={(event) => setNewLibraryName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && createLibrary()} className="input input-bordered mt-1.5 w-full" placeholder="请输入知识库名称" />
        </DialogField>
        <CoverPicker value={newLibraryCover} onChange={setNewLibraryCover} />
        <DialogActions>
          <button onClick={() => setCreatingLibrary(false)} className="btn btn-ghost">取消</button>
          <button onClick={createLibrary} disabled={!newLibraryName.trim()} className="btn btn-primary">创建</button>
        </DialogActions>
      </Dialog>}

      {movingContent && (() => {
        // 没有选中的库就没什么可确认的（实际打不开这个弹窗——行内菜单只在库打开时存在）。
        const targetLibraryId = moveTargetLibraryId ?? activeId
        if (targetLibraryId == null) return null
        const targetLibrary = libraries.find((library) => library.id === targetLibraryId)
        const subfolders = moveSubfolders(targetLibraryId, moveTargetPath)
        const crumbs = moveBreadcrumb(targetLibrary?.name || '根目录', moveTargetPath)
        const targetState = moveOptionState(movingContent, targetLibraryId, moveTargetPath)
        return <Dialog width="2xl" onClose={() => setMovingContent(null)}>
            <DialogHeader title="移动到" icon={menuIcons.move} onClose={() => setMovingContent(null)}
              subtitle={<span className="block truncate" title={movingContent.name}>“{movingContent.name}” · 选择目标位置</span>} />
            {descendantCount(movingContent) > 0 ? <p className="mt-2 text-xs leading-5 text-base-content/45">该文件夹内有 {descendantCount(movingContent)} 项内容，会一并移动。</p> : null}
            {/* 两栏给确定高度而不是 flex-1：弹窗只有 max-h、没有确定高度，靠 flex-1 撑会因为
                可用空间为 0 而塌掉。max-h-[50vh] 让它在矮屏上让步。 */}
            <div className="mt-4 flex h-80 max-h-[50vh] gap-3">
              {/* 左栏：知识库。分组与顺序照抄侧边栏，用户不必在弹窗里重新认一遍结构。 */}
              <div className="w-52 shrink-0 overflow-y-auto rounded-xl border border-base-200 p-1.5">
                {moveLibraryGroups().map((group) => <div key={group.key} className="mb-1 last:mb-0">
                  <p className="px-2 py-1 text-[11px] font-medium text-base-content/40">{group.name}</p>
                  {group.libraries.map((library) => <button
                    key={library.id}
                    onClick={() => {
                      setMoveTargetLibraryId(library.id)
                      // 换库必须清掉已选路径：那条路径只在上一个库里成立，留着会让确认按钮指向一个不存在的位置。
                      setMoveTargetPath(null)
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition ${library.id === targetLibraryId ? 'bg-primary/10 text-primary ring-1 ring-primary/30' : 'text-base-content/70 hover:bg-base-200/70'}`}
                  >
                    <LibraryCover cover={library.icon} className="h-5 w-5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate" title={library.name}>{library.name}</span>
                    {library.id === activeId ? <span className="shrink-0 text-[10px] text-base-content/30">当前</span> : null}
                  </button>)}
                </div>)}
              </div>
              {/* 右栏：文件夹浏览器。列的是当前位置的直接子文件夹，点进去下钻；
                  当前所在的这一层本身就是目标，所以行上不再有「选中」态。 */}
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-base-200">
                <div className="flex items-center gap-1 border-b border-base-200 px-1.5 py-1.5">
                  <button
                    onClick={() => setMoveTargetPath(moveParentPath(moveTargetPath))}
                    disabled={moveTargetPath === null}
                    title="返回上一级"
                    className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs transition ${moveTargetPath === null ? 'cursor-not-allowed text-base-content/25' : 'text-base-content/60 hover:bg-base-200/70 hover:text-base-content'}`}
                  >
                    <Icon className="h-3 w-3"><path d="m15 18-6-6 6-6" /></Icon>返回
                  </button>
                  {/* 面包屑：每一段都能点，点哪一段就回到哪一层。 */}
                  <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-xs">
                    {crumbs.map((crumb, index) => <span key={crumb.path ?? '__root__'} className="flex min-w-0 items-center gap-1">
                      {index > 0 ? <span className="shrink-0 text-base-content/25">/</span> : null}
                      <button
                        onClick={() => setMoveTargetPath(crumb.path)}
                        title={crumb.label}
                        className={`min-w-0 truncate rounded px-1 py-0.5 transition ${index === crumbs.length - 1 ? 'font-medium text-base-content/80' : 'text-base-content/45 hover:bg-base-200/70 hover:text-base-content/80'}`}
                      >{crumb.label}</button>
                    </span>)}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {subfolders.length ? subfolders.map((path) => <button
                    key={path}
                    onClick={() => setMoveTargetPath(path)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm text-base-content/75 transition hover:bg-primary/10 hover:text-primary"
                  >
                    <Icon className="shrink-0"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></Icon>
                    {/* 只显示这一层的名字；完整路径已经由上面的面包屑交代了。 */}
                    <span className="min-w-0 flex-1 truncate" title={path}>{path.slice(path.lastIndexOf('/') + 1)}</span>
                    <Icon className="h-3.5 w-3.5 shrink-0 text-base-content/25"><path d="m9 18 6-6-6-6" /></Icon>
                  </button>) : <p className="px-2 py-8 text-center text-xs text-base-content/35">该文件夹下没有子文件夹，可直接移动至此</p>}
                </div>
              </div>
            </div>
            {/* 目标文案：只写库名时就是库根，不再缀「根目录」——前半句已经是库名，重复一遍只是噪音；
                右侧面包屑的首段用的是同一个名字，停在同一层时两处读起来一致。 */}
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-base-200/50 px-3 py-2 text-xs">
              <span className="min-w-0 flex-1 truncate">
                目标：<span className="text-base-content/80">{targetLibrary?.name || '—'}</span>{moveTargetPath ? <span className="text-base-content/80"> / {moveTargetPath.split('/').join(' / ')}</span> : null}
              </span>
              {targetState.reason ? <span className={`shrink-0 ${targetState.disabled ? 'text-warning' : 'text-base-content/35'}`}>{targetState.reason}</span> : null}
            </div>
            <DialogActions>
              <button onClick={() => setMovingContent(null)} className="btn btn-ghost">取消</button>
              <button onClick={confirmMove} disabled={targetState.disabled} className="btn btn-primary">移动至此</button>
            </DialogActions>
        </Dialog>
      })()}
      {renamingContent && (() => {
        const isLinkRename = Boolean(renamingContent.url)
        const closeRename = () => { setRenamingContent(null); setRenameError(null) }
        return <Dialog onClose={closeRename}>
          <DialogHeader
            title={isLinkRename ? '编辑网页链接' : `重命名${renamingContent.type === 'folder' ? '文件夹' : '文档'}`}
            icon={menuIcons.edit}
            subtitle={<span className="block truncate" title={renamingContent.name}>当前名称：{renamingContent.name}</span>}
            onClose={closeRename}
          />
          <DialogField label={isLinkRename ? '网页名称' : '新名称'} required>
            <AutofocusInput
              value={renameValue}
              onChange={(event) => { setRenameValue(event.target.value); setRenameError(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter') renameContent(); if (event.key === 'Escape') closeRename() }}
              className="input input-bordered mt-1.5 w-full"
              placeholder="请输入名称"
            />
          </DialogField>
          {isLinkRename ? <DialogField label="网页链接" required>
            <input
              value={renameUrl}
              onChange={(event) => { setRenameUrl(event.target.value); setRenameError(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter') renameContent(); if (event.key === 'Escape') closeRename() }}
              className="input input-bordered mt-1.5 w-full"
              placeholder="https://example.com/page"
            />
          </DialogField> : null}
          {/* 文件夹改名会连带改写所有后代的路径，先讲清楚会牵动多少内容，避免用户以为只改了个标签。 */}
          {descendantCount(renamingContent) > 0 ? <p className="mt-2 text-xs leading-5 text-base-content/45">该文件夹内有 {descendantCount(renamingContent)} 项内容，改名后它们的路径会一并更新。</p> : null}
          <DialogError>{renameError}</DialogError>
          <DialogActions>
            <button onClick={closeRename} className="btn btn-ghost">取消</button>
            <button onClick={renameContent} disabled={!renameValue.trim() || (renameValue.trim() === renamingContent.name && (!isLinkRename || renameUrl.trim() === renamingContent.url))} className="btn btn-primary">保存</button>
          </DialogActions>
        </Dialog>
      })()}
      {addingLink && (() => {
        // 名称留空时最终会落到域名：把这个「将要使用的名字」直接摆在占位符里，
        // 用户才知道留空不是丢失信息，而不是等到保存后才发现条目叫 example.com。
        const derivedName = parseWebLink(linkUrl)?.hostname || ''
        const closeLinkDialog = () => { setAddingLink(false); setLinkError(null) }
        return <Dialog onClose={closeLinkDialog}>
          <DialogHeader
            title="添加网页链接"
            icon={menuIcons.link}
            subtitle={`添加到“${libraries.find((library) => library.id === activeId)?.name}”${currentFolder ? ` / ${currentFolder.split('/').join(' / ')}` : ''}`}
            onClose={closeLinkDialog}
          />
          <DialogField label="网页链接" required>
            <AutofocusInput
              value={linkUrl}
              onChange={(event) => { setLinkUrl(event.target.value); setLinkError(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter') addWebLink(); if (event.key === 'Escape') closeLinkDialog() }}
              className="input input-bordered mt-1.5 w-full"
              placeholder="https://example.com/page"
            />
          </DialogField>
          <DialogField label="网页名称">
            <input
              value={linkName}
              onChange={(event) => { setLinkName(event.target.value); setLinkError(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter') addWebLink(); if (event.key === 'Escape') closeLinkDialog() }}
              className="input input-bordered mt-1.5 w-full"
              placeholder={derivedName || '不填则使用域名'}
            />
          </DialogField>
          <DialogError>{linkError}</DialogError>
          <DialogActions>
            <button onClick={closeLinkDialog} className="btn btn-ghost">取消</button>
            <button onClick={addWebLink} disabled={!linkUrl.trim()} className="btn btn-primary">添加</button>
          </DialogActions>
        </Dialog>
      })()}
      {addingContentLibraryId != null && <Dialog onClose={closeAddContent}>
        <DialogHeader
          title="添加内容"
          icon={menuIcons.folderPlus}
          subtitle={`添加到“${libraries.find((library) => library.id === addingContentLibraryId)?.name}”${currentFolder ? ` / ${currentFolder.split('/').join(' / ')}` : ''}`}
          onClose={closeAddContent}
        />
        <DialogField label="名称" required>
          <AutofocusInput
            value={newContentName}
            onChange={(event) => { setNewContentName(event.target.value); setNewContentError(null) }}
            onKeyDown={(event) => { if (event.key === 'Enter') addContent(); if (event.key === 'Escape') closeAddContent() }}
            className="input input-bordered mt-1.5 w-full"
            placeholder="请输入名称"
          />
        </DialogField>
        <DialogField label="类型">
          <select value={newContentType} onChange={(event) => setNewContentType(event.target.value as ContentItem['type'])} className="select select-bordered mt-1.5 w-full"><option value="folder">文件夹</option><option value="doc">Word 文档</option><option value="pdf">PDF 文档</option></select>
        </DialogField>
        <DialogError>{newContentError}</DialogError>
        <DialogActions>
          <button onClick={closeAddContent} className="btn btn-ghost">取消</button>
          <button onClick={addContent} disabled={!newContentName.trim()} className="btn btn-primary">添加</button>
        </DialogActions>
      </Dialog>}
    </div>
  )
}
