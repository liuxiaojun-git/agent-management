// API 测试 — 接口调试工具，支持请求编辑、发送、响应查看、历史记录保存与多标签管理
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { json } from '@codemirror/lang-json'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { xml } from '@codemirror/lang-xml'
import { addLog } from '../utils/logStore'
import { createRequestGuard } from '../utils/requestGuard.ts'
import {
  proxyRequest,
  listApiTestFolderShares,
  listApiTestFolderShareCandidates,
  createApiTestFolderShares,
  revokeApiTestFolderShare,
  requestApiTestFolderEdit,
  setApiTestFolderEditStatus,
  createSharedApiTestRequest,
  updateSharedApiTestRequest,
  deleteSharedApiTestRequest,
  createSharedApiTestFolder,
  renameSharedApiTestFolder,
  setSharedApiTestFolderBaseUrl,
  deleteSharedApiTestFolder,
  type ApiTestFolderShareEntry,
  type SharedApiTestFolder,
  type ShareCandidate,
} from '../utils/api'
import {
  buildRequestBody,
  createBodyField,
  readFileAsBase64,
  type BinaryBody,
  type BodyField,
  type BodyMode,
  type RawBodyType,
  type RequestBodyConfig,
} from '../utils/requestBody'
import {
  getSavedRequests,
  getActiveRequestId,
  setActiveRequestId,
  getCollections,
  getFolders,
  setSavedRequests as storeSaveRequests,
  setCollections as storeSetCollections,
  setFolders as storeSetFolders,
  hydrateStoreFromFile,
  type SavedRequest,
  type SavedFolder,
  type Collection,
} from '../utils/requestStore'
import { peekApiDraft, commitApiDraftConsumed, type ApiDraftOrigin, type ApiRequestDraft } from '../utils/apiDraft'
import { getModels, CHAT_MODEL_KEY, type ChatModel } from '../services/chatService'
import { analyzeApiResponse, type ApiResponseAnalysisInput, type ApiResponseAnalysisMode, type ApiResponseAnalysisResult } from '../services/apiResponseAnalysis'
import { renderAssistantBlocks } from '../utils/assistantMarkdown'
// 树运算与 React 无关，全在 requestTree 里；这里只负责把当前一层的行画出来。
import {
  MAX_PATH_LENGTH,
  browseBreadcrumb,
  childCount,
  childFolders,
  childRequests,
  folderIdsInSubtree,
  folderPath,
  isSelfOrDescendant,
  leafNameOf,
  normParent,
  parentPathOf,
  collectionRequestCount,
  requestsInSubtree,
  siblingNameTaken,
} from '../utils/requestTree'
// 弹窗、⋯ 浮层菜单、图标与知识库/AI 问答共用一套，定义在 components/OperationUI.tsx 与 operationMenu.tsx。
import { Dialog, DialogActions, DialogError, DialogField, DialogHeader, MenuAction, RowMenuPopover, RowMenuTrigger } from '../components/OperationUI'
import { menuIcons, useRowMenu } from '../components/operationMenu'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

// 分析结果的缓存键：请求、响应、模式和模型任一变化都视为新的上下文。
// 只取正文首尾片段而不是整段正文，避免每次按键都生成超长字符串。
const apiAnalysisCacheKey = (input: ApiResponseAnalysisInput) => {
  const req = input.request
  const res = input.response
  return [
    input.mode,
    input.model || 'default',
    req.method,
    req.url,
    req.body.length,
    req.body.slice(0, 120),
    req.body.slice(-120),
    res.status,
    res.statusText,
    res.time,
    res.size,
    res.body.length,
    res.body.slice(0, 120),
    res.body.slice(-120),
  ].join('\u0000')
}

// 请求行的 key 就是请求 id，集合行的 key 得自己加前缀：两边共用一个 openMenuId，
// 集合名叫 "12"、请求 id 也叫 "12" 时不能撞上。
const collectionMenuKey = (name: string) => `collection:${name}`
// 文件夹行的菜单键也走 openMenuId。按 id 而不是路径：改名和移动都不该让一个开着的菜单指向别处。
const folderMenuKey = (id: string) => `folder:${id}`
const sharedFolderMenuKey = (shareId: number, id: string) => `shared:${shareId}:folder:${id}`
const sharedRequestMenuKey = (shareId: number, id: string) => `shared:${shareId}:request:${id}`
// 右栏顶栏那个「+」的菜单键。同样走 openMenuId，好和行菜单互斥——同一时刻只该有一个浮层开着。
const newEntryMenuKey = 'new-entry'

// 三种东西都能拖，各自的载荷不同。收成一个联合类型，`kind` 当判别式用，
// 处理器里 `dragPayload.kind === 'request'` 就能把 id 收窄成 string。
type DragPayload =
  | { kind: 'collection'; name: string }
  | { kind: 'folder'; id: string }
  | { kind: 'request'; id: string }

/**
 * 投放带。右栏一次只显示一层，所以行上只剩前后两条边（对半分）。
 * `into` 只有集合行在用：把文件夹或请求丢进另一个集合，等于落到那个集合的根层。
 */
type DropZone = 'before' | 'after' | 'into'

// 侧栏两栏的宽度下限。右栏是本页的主操作区，窄到 180 就没法用了，
// 左栏再宽也不能把它挤没——两处钳制都拿这两个常量算，免得改一处漏一处。
const COLLECTION_PANE_MIN = 150
const COLLECTION_PANE_MAX = 320
const BROWSER_PANE_MIN = 180
const PANE_HANDLE_WIDTH = 8
const PANE_MIN_TOTAL = COLLECTION_PANE_MIN + BROWSER_PANE_MIN + PANE_HANDLE_WIDTH

interface KvPair {
  key: string
  value: string
  enabled: boolean
}
type AuthType = 'bearer' | 'apiKey' | 'basic' | 'none'

interface AuthConfig {
  type: AuthType
  token: string
  apiKey: string
  apiValue: string
  apiAddTo: 'header' | 'query'
  username: string
  password: string
}

type DraftSource = {
  confidence: ApiRequestDraft['confidence']
  origin: ApiDraftOrigin
  notices: string[]
}

const methodColors: Record<HttpMethod, string> = {
  GET: 'text-green-600',
  POST: 'text-blue-600',
  PUT: 'text-orange-500',
  PATCH: 'text-purple-500',
  DELETE: 'text-red-500',
}

const methodSelectBg: Record<HttpMethod, string> = {
  GET: 'bg-green-50 border-green-300 text-green-700',
  POST: 'bg-blue-50 border-blue-300 text-blue-700',
  PUT: 'bg-orange-50 border-orange-300 text-orange-600',
  PATCH: 'bg-purple-50 border-purple-300 text-purple-600',
  DELETE: 'bg-red-50 border-red-300 text-red-600',
}

const defaultHeaders: KvPair[] = [
  { key: 'Content-Type', value: 'application/json', enabled: true },
  { key: 'Authorization', value: 'Bearer sk-...', enabled: true },
]
const defaultAuthConfig: AuthConfig = {
  type: 'none',
  token: '',
  apiKey: '',
  apiValue: '',
  apiAddTo: 'header',
  username: '',
  password: '',
}

const defaultBody = `{
  "model": "qwen3.7-plus",
  "messages": [
    { "role": "user", "content": "你好" }
  ],
  "temperature": 0.7
}`

const nowMs = () => Date.now()
let nextRequestId = nowMs()
// 文件夹 id 和请求 id 落在同一张表的 request_id 列上，(user_id, request_id) 有唯一索引。
// 前缀分开不是为了约束，只是为了排查时一眼看出这是哪种记录。
let nextFolderId = nowMs()
const createFolderId = () => `folder_${++nextFolderId}`
// 路径分隔符：Windows 用 \，Mac/Linux 用 /
// 注意：仅转换非 JSON/JS 转义序列的 \，避免破坏 \n \t \\ 等合法转义
const isWin = navigator.platform?.toLowerCase().includes('win')
const normalizePathSep = (s: string) => isWin ? s : s.replace(/\\(?!['"\\/bfnrtu])/g, '/')

const bodyTypeMeta: Record<string, { label: string; badge: string; mime: string; color: string; icon: string }> = {
  json:       { label: 'JSON',    badge: 'border-l-green-500 bg-green-50 text-green-700',    mime: 'application/json',                color: 'text-green-600',  icon: '{}' },
  text:       { label: 'Text',    badge: 'border-l-base-content/20 bg-base-200 text-base-content/70', mime: 'text/plain',             color: 'text-base-content/50',   icon: 'T' },
  javascript: { label: 'JavaScript', badge: 'border-l-yellow-500 bg-yellow-50 text-yellow-700', mime: 'application/javascript',       color: 'text-yellow-600', icon: 'JS' },
  html:       { label: 'HTML',    badge: 'border-l-orange-500 bg-orange-50 text-orange-700', mime: 'text/html',                        color: 'text-orange-600', icon: '</>' },
  xml:        { label: 'XML',     badge: 'border-l-blue-500 bg-blue-50 text-blue-700',       mime: 'application/xml',                  color: 'text-blue-600',   icon: '<>' },
}

const editorChromeTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  '.cm-gutters': {
    backgroundColor: 'color-mix(in oklab, var(--color-base-200) 30%, var(--color-base-100))',
    borderRight: '1px solid var(--color-base-200)',
    zIndex: '2',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '3rem',
    paddingRight: '0.5rem',
  },
  '.cm-foldGutter .cm-gutterElement': {
    width: '1.25rem',
    padding: '0 0.25rem 0 0',
    textAlign: 'center',
  },
  '.cm-content': { padding: '1rem 0' },
  '.cm-line': { padding: '0 1rem' },
})

const defaultBodyConfig: RequestBodyConfig = {
  mode: 'raw',
  rawType: 'json',
  fields: [createBodyField()],
  binary: null,
  graphqlQuery: 'query Example {\n  __typename\n}',
  graphqlVariables: '{\n  \n}',
}

export default function ApiTest() {
  const isAdminUser = (() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null')
      return user?.role ? user.role === 'admin' : (user?.permissions || []).includes('users')
    } catch {
      return false
    }
  })()
  // 刷新时恢复上次打开的请求，不以列表第一条代替用户的选择。
  const initialList = getSavedRequests()
  const initialRequestId = getActiveRequestId()
  const initialRequest = initialList.find(request => request.id === initialRequestId)
  const [method, setMethod] = useState<HttpMethod>(initialRequest ? initialRequest.method as HttpMethod : 'POST')
  const [url, setUrl] = useState(initialRequest ? initialRequest.url : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'body' | 'auth'>('body')
  const initialBodyConfig = initialRequest?.bodyConfig || defaultBodyConfig
  const [bodyMode, setBodyMode] = useState<BodyMode>(initialBodyConfig.mode)
  const [bodyType, setBodyType] = useState<RawBodyType>(initialBodyConfig.rawType)
  const [headers, setHeaders] = useState<KvPair[]>(initialRequest ? initialRequest.headers.map(h => ({ ...h })) : defaultHeaders.map(h => ({ ...h })))
  const [auth, setAuth] = useState<AuthConfig>(() => initialRequest?.auth || defaultAuthConfig)
  const initBody = initialRequest ? normalizePathSep(initialRequest.body) : defaultBody
  const [body, setBody] = useState(initBody)
  const [bodyFields, setBodyFields] = useState<BodyField[]>(
    () => initialBodyConfig.fields.map(field => ({ ...field })),
  )
  const [binaryBody, setBinaryBody] = useState<BinaryBody | null>(initialBodyConfig.binary)
  const [graphqlQuery, setGraphqlQuery] = useState(initialBodyConfig.graphqlQuery)
  const [graphqlVariables, setGraphqlVariables] = useState(initialBodyConfig.graphqlVariables)

  // 已保存的请求
  const initialCollections = getCollections()
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>(() => initialList)
  const [storeHydrated, setStoreHydrated] = useState(false)
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(initialRequest?.id || null)
  const [showWelcome, setShowWelcome] = useState(!initialRequest)
  const [collections, setCollections] = useState<Collection[]>(initialCollections)
  const initialCurrentCollection = initialRequest && initialCollections.some(c => c.name === initialRequest.collection)
    ? initialRequest.collection
    : initialCollections[0]?.name || '默认集合'
  const [currentCollection, setCurrentCollection] = useState<string>(initialCurrentCollection)
  const [folders, setFolders] = useState<SavedFolder[]>(() => getFolders())
  const [folderShares, setFolderShares] = useState<ApiTestFolderShareEntry[]>([])
  const [incomingFolderShares, setIncomingFolderShares] = useState<SharedApiTestFolder[]>([])
  const [folderShareError, setFolderShareError] = useState<string | null>(null)
  const [shareDialogFolderId, setShareDialogFolderId] = useState<string | null>(null)
  const [shareCandidates, setShareCandidates] = useState<ShareCandidate[]>([])
  const [sharePicked, setSharePicked] = useState<Set<number>>(() => new Set())
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [activeSharedFolderShareId, setActiveSharedFolderShareId] = useState<number | null>(null)
  const [baseUrlDialog, setBaseUrlDialog] = useState<{ folderId: string; shareId: number | null } | null>(null)
  const [baseUrlDraft, setBaseUrlDraft] = useState('')
  const [baseUrlError, setBaseUrlError] = useState('')
  const [sharedRequestMode, setSharedRequestMode] = useState(false)
  const [sharedRequestId, setSharedRequestId] = useState<string | null>(null)
  const [sharedRequestLabel, setSharedRequestLabel] = useState('')
  // 「当前这一层」的路径（集合相对），同时是两件事：右栏正在浏览哪一层、下一条保存落到哪一层。
  // 合成一个而不是拆成 browsePath + savePath：两份状态一旦能不一致，就会出现
  // 「看着 A 文件夹、新请求却存进 B」这种没法解释的现象。
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  // 集合行与请求行的「⋯」共用一个状态：同一时刻只开一个，位置在打开那一刻按触发器实测。
  const rowMenu = useRowMenu()
  const { openMenuId, menuAnchor, panelRef: rowMenuRef, close: closeRowMenu } = rowMenu

  // 知识库问答带入的草稿只在这一会话里显示来源；切换或新建请求即消失。
  const [draftSource, setDraftSource] = useState<DraftSource | null>(null)

  // AI 响应分析：一次性请求，不创建 AI 会话。模型列表与选中模型独立于 AI 问答页。
  const [models, setModels] = useState<ChatModel[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [analysisResult, setAnalysisResult] = useState<ApiResponseAnalysisResult | null>(null)
  const [analysisMode, setAnalysisMode] = useState<ApiResponseAnalysisMode>('explain')
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  // 按「请求 + 响应 + 模式 + 模型」缓存分析结果：关闭弹窗后再打开直接复用，不重复请求模型。
  const analysisCacheRef = useRef(new Map<string, ApiResponseAnalysisResult>())

  // 响应
  const firstResponse = initialRequest?.lastResponse || null
  const [response, setResponse] = useState<{
    status: number
    statusText: string
    time: string
    size: string
    headers: Record<string, string>
    body: string
  } | null>(firstResponse || null)
  const [sending, setSending] = useState(false)
  const abortControllers = useRef<AbortController[]>([])
  const timeoutIds = useRef<ReturnType<typeof setTimeout>[]>([])
  const cancelRequested = useRef(false)
  const sendGuardRef = useRef(createRequestGuard())
  const [activeResponseTab, setActiveResponseTab] = useState<'body' | 'headers' | 'concurrent'>('body')
  // 并发测试
  const cfg = initialRequest?.concurrentConfig
  const [concurrentMode, setConcurrentMode] = useState(cfg?.mode ?? false)
  const [concurrentCount, setConcurrentCount] = useState(cfg?.count ?? 5)
  const [concurrentDuration, setConcurrentDuration] = useState(cfg?.duration ?? 10)
  const [requestTimeout, setRequestTimeout] = useState(cfg?.timeout ?? 600)
  const [concurrentResults, setConcurrentResults] = useState<{ index: number; status: number; time: string; body?: string }[] | null>(() => initialRequest?.concurrentResults || null)
  const [selectedConcurrentResult, setSelectedConcurrentResult] = useState<{ index: number; status: number; time: string; body?: string } | null>(null)

  // 切换 body 类型时同步更新 Content-Type 请求头
  const changeBodyType = (type: typeof bodyType) => {
    setBodyType(type)
    setHeaders(prev => {
      const filtered = prev.filter(h => h.key.toLowerCase() !== 'content-type')
      return [{ key: 'Content-Type', value: bodyTypeMeta[type].mime, enabled: true }, ...filtered]
    })
  }

  const getBodyConfig = (): RequestBodyConfig => ({
    mode: bodyMode,
    rawType: bodyType,
    fields: bodyFields.map(field => ({ ...field })),
    binary: binaryBody ? { ...binaryBody } : null,
    graphqlQuery,
    graphqlVariables,
  })

  const buildFetchOptions = () => {
    const reqHeaders: Record<string, string> = {}
    headers.filter(h => h.enabled && h.key.trim()).forEach(h => {
      reqHeaders[h.key.trim()] = h.value
    })

    const authorizationHeader = Object.keys(reqHeaders).find(key => key.toLowerCase() === 'authorization')
    if (authorizationHeader) delete reqHeaders[authorizationHeader]
    if (auth.type === 'bearer' && auth.token.trim()) {
      reqHeaders.Authorization = `Bearer ${auth.token.trim()}`
    } else if (auth.type === 'basic' && (auth.username || auth.password)) {
      reqHeaders.Authorization = `Basic ${btoa(`${auth.username}:${auth.password}`)}`
    } else if (auth.type === 'apiKey' && auth.apiAddTo === 'header' && auth.apiKey.trim()) {
      reqHeaders[auth.apiKey.trim()] = auth.apiValue
    } else if (auth.type === 'none' && authorizationHeader) {
      reqHeaders[authorizationHeader] = headers.find(h => h.key === authorizationHeader)?.value || ''
    }

    const encodedBody = buildRequestBody(getBodyConfig(), body)
    if (encodedBody.contentType) {
      const existingContentType = Object.keys(reqHeaders)
        .find(key => key.toLowerCase() === 'content-type')
      if (existingContentType) delete reqHeaders[existingContentType]
      reqHeaders['Content-Type'] = encodedBody.contentType
    }

    return {
      method,
      headers: reqHeaders,
      ...(method !== 'GET' && encodedBody.body !== undefined
        ? {
            body: encodedBody.body,
            bodyEncoding: encodedBody.bodyEncoding,
          }
        : {}),
    }
  }

  const getCurrentFolderBaseUrl = () => {
    const activeShare = activeSharedFolderShareId == null
      ? null
      : incomingFolderShares.find(share => share.shareId === activeSharedFolderShareId) || null
    const targetFolders = activeShare?.folders || folders
    const targetCollection = activeShare?.collection || currentCollection
    const targetPath = normParent(currentPath)
    return targetPath
      ? targetFolders
          .filter(folder =>
            folder.collection === targetCollection
            && folder.baseUrl?.trim()
            && isSelfOrDescendant(targetPath, folderPath(folder)),
          )
          .sort((a, b) => folderPath(b).length - folderPath(a).length)[0]?.baseUrl?.trim()
      : undefined
  }

  const currentFolderBaseUrl = getCurrentFolderBaseUrl()

  const buildRequestUrl = () => {
    const baseUrl = currentFolderBaseUrl
    const endpoint = url.trim()
    const resolvedUrl = baseUrl && !/^https?:\/\//i.test(endpoint)
      ? `${baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`
      : endpoint
    if (auth.type !== 'apiKey' || auth.apiAddTo !== 'query' || !auth.apiKey.trim()) return resolvedUrl
    const separator = resolvedUrl.includes('?') ? '&' : '?'
    return `${resolvedUrl}${separator}${encodeURIComponent(auth.apiKey.trim())}=${encodeURIComponent(auth.apiValue)}`
  }

  const openFolderBaseUrlDialog = (folder: SavedFolder, shareId: number | null = null) => {
    setBaseUrlDialog({ folderId: folder.id, shareId })
    setBaseUrlDraft(folder.baseUrl || '')
    setBaseUrlError('')
  }

  const saveFolderBaseUrl = async () => {
    if (!baseUrlDialog) return
    const value = baseUrlDraft.trim()
    let normalizedBaseUrl = ''
    if (value.length > 2048) {
      setBaseUrlError('Base URL 不能超过 2048 个字符')
      return
    }
    if (value) {
      try {
        const parsed = new URL(value)
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.search || parsed.hash) {
          throw new Error('invalid URL')
        }
        normalizedBaseUrl = value.replace(/\/+$/, '')
      } catch {
        setBaseUrlError('请输入有效的 HTTP 或 HTTPS Base URL，且不要包含查询参数或片段')
        return
      }
    }

    if (baseUrlDialog.shareId == null) {
      if (!folders.some(folder => folder.id === baseUrlDialog.folderId)) {
        setBaseUrlError('文件夹已不存在，请关闭后重试')
        return
      }
      setFolders(previous => previous.map(folder =>
        folder.id === baseUrlDialog.folderId
          ? { ...folder, baseUrl: normalizedBaseUrl || undefined }
          : folder,
      ))
    } else {
      const result = await setSharedApiTestFolderBaseUrl(
        baseUrlDialog.shareId,
        baseUrlDialog.folderId,
        normalizedBaseUrl,
      )
      if (!result.success) {
        setBaseUrlError(result.error || '保存 Base URL 失败')
        return
      }
      await refreshFolderShares()
    }

    setBaseUrlDialog(null)
    showToast('✅ Base URL 已保存')
  }

  const updateBodyField = (id: string, update: Partial<BodyField>) => {
    setBodyFields(previous => previous.map(field =>
      field.id === id ? { ...field, ...update } : field
    ))
  }

  const selectFieldFile = async (id: string, file?: File) => {
    if (!file) return
    const fileBase64 = await readFileAsBase64(file)
    updateBodyField(id, {
      kind: 'file',
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      fileBase64,
    })
  }

  const selectBinaryFile = async (file?: File) => {
    if (!file) return
    setBinaryBody({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      base64: await readFileAsBase64(file),
      size: file.size,
    })
  }

  const formatRawBody = () => {
    if (bodyType !== 'json') {
      showToast('格式化当前仅适用于 JSON')
      return
    }
    try {
      const formatted = JSON.stringify(JSON.parse(body), null, 2)
      setBody(formatted)
      showToast('✅ JSON 格式正确')
    } catch (error) {
      showToast(`⚠️ JSON 格式错误：${(error as Error).message}`)
    }
  }

  // UI 状态
  const [toast, setToast] = useState<string | null>(null)
  // 首次保存弹窗
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveLabel, setSaveLabel] = useState('')
  const [saveCollection, setSaveCollection] = useState(currentCollection)
  // 保存弹窗里选的目标文件夹路径，null = 集合根层。切换集合时必须重置：
  // 路径只在所属集合内成立，留着上一个集合的路径会指向一个不存在的文件夹。
  const [saveParent, setSaveParent] = useState<string | null>(null)
  // 同名判断按 (集合, 父路径) 限定，不再整个集合内唯一：
  // 不同文件夹里允许同名请求，这正是文件夹的意义所在，是有意为之的放宽。
  // 复用 siblingNameTaken 而不是自己写一遍——它同时查文件夹和请求两个数组，
  // 和「移动到」的守卫是同一个口径。两处各写一份的话，保存能进的名字移动时会被拒。
  const hasDuplicateLabel = (label: string, collection: string, parent: string | null, excludeId?: string | null) =>
    siblingNameTaken(folders, savedRequests, collection, parent, label, excludeId)
  const getUniqueLabel = (label: string, collection: string, parent: string | null) => {
    const baseLabel = label.trim() || '未命名'
    if (!hasDuplicateLabel(baseLabel, collection, parent)) return baseLabel
    let sequence = 2
    while (hasDuplicateLabel(`${baseLabel} (${sequence})`, collection, parent)) sequence += 1
    return `${baseLabel} (${sequence})`
  }
  const saveLabelDuplicated = Boolean(
    saveLabel.trim()
    && saveCollection
    && hasDuplicateLabel(saveLabel, saveCollection, saveParent, currentSavedId),
  )
  // 保存弹窗的文件夹下拉。标签写成全路径而不是单段名：下拉是平的，
  // 两个不同深度的同名文件夹光看单段名分不出来。值用路径本身，正好是 parent 的语义。
  const saveFolderOptions = folders
    .filter(folder => folder.collection === saveCollection)
    .map(folder => {
      const path = folderPath(folder)
      return { path, label: path.split('/').join(' / ') }
    })
  // 确认首次保存
  const confirmFirstSave = () => {
    if (!saveLabel.trim() || !saveCollection) return
    if (hasDuplicateLabel(saveLabel, saveCollection, saveParent, currentSavedId)) {
      showToast('⚠️ 当前位置已存在同名条目，请修改保存名称')
      return
    }
    const now = new Date().toLocaleString('zh-CN', { hour12: false })

    if (currentSavedId) {
      setSavedRequests(prev => prev.map(r =>
        r.id === currentSavedId
          ? {
              ...r,
              label: saveLabel.trim(),
              method,
              url,
              headers: headers.map(h => ({ ...h })),
              auth: { ...auth },
              body,
              bodyConfig: getBodyConfig(),
              collection: saveCollection,
              // 保存弹窗选中的文件夹。存到 undefined 而不是 null：老数据的 parent 就是缺省的，
              // 两者在 JSON 里不同形，混着写会让 normalizeStore 前后判成两份不同的数据。
              parent: saveParent ?? undefined,
              savedAt: now,
              lastResponse: response ? {
                status: response.status,
                statusText: response.statusText,
                time: response.time,
                size: response.size,
                body: response.body,
                headers: response.headers,
              } : r.lastResponse,
              concurrentResults: concurrentResults || r.concurrentResults,
              concurrentSummary: calcConcurrentSummary() || r.concurrentSummary,
              concurrentConfig: { mode: concurrentMode, count: concurrentCount, duration: concurrentDuration, timeout: requestTimeout },
            }
          : r
      ))
      setCurrentCollection(saveCollection)
      setCurrentPath(saveParent)
      setShowSaveModal(false)
      showToast('✅ 保存成功')
      return
    }

    const newReq: SavedRequest = {
        id: `saved_${++nextRequestId}`,
        label: saveLabel.trim(),
        method, url,
        headers: headers.map(h => ({ ...h })),
        auth: { ...auth },
        body,
        bodyConfig: getBodyConfig(),
        collection: saveCollection,
        parent: saveParent ?? undefined,
        savedAt: now,
        lastResponse: response ? { status: response.status, statusText: response.statusText, time: response.time, size: response.size, body: response.body, headers: response.headers } : undefined,
        concurrentResults: concurrentResults || undefined,
        concurrentSummary: calcConcurrentSummary() || undefined,
        concurrentConfig: { mode: concurrentMode, count: concurrentCount, duration: concurrentDuration, timeout: requestTimeout },
    }
    setSavedRequests(prev => [newReq, ...prev])
    setCurrentSavedId(newReq.id)
    setActiveRequestId(newReq.id)
    setSharedRequestMode(false)
    setActiveSharedFolderShareId(null)
    showToast('✅ 保存成功')
    setCurrentCollection(saveCollection)
    setCurrentPath(saveParent)
    setShowSaveModal(false)
  }

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  // 重命名状态
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameLabel, setRenameLabel] = useState('')
  const [renameError, setRenameError] = useState('')
  // 集合的新建与重命名只有标题和一个初值不同，共用一个弹窗。
  const [collectionDialog, setCollectionDialog] = useState<{
    mode: 'create' | 'rename' | 'createFolder' | 'renameFolder'
    original: string
    /** 文件夹模式下的归属集合；集合模式下不用。 */
    collection: string
    /** 文件夹模式下新建/改名后落在哪一层；null = 集合根层。 */
    parent: string | null
  } | null>(null)
  const [deletingFolder, setDeletingFolder] = useState<string | null>(null)
  // 「移动到」的目标选择。打开时定位到自己的当前位置，让「不能原地不动」这条规则
  // 以确认按钮禁用的形式直接可见，而不是点下去才弹一个错。
  const [movingNode, setMovingNode] = useState<{ kind: 'folder' | 'request'; id: string } | null>(null)
  const [moveTargetCollection, setMoveTargetCollection] = useState('')
  const [moveTargetPath, setMoveTargetPath] = useState<string | null>(null)
  const [collectionName, setCollectionName] = useState('')
  const [collectionNameError, setCollectionNameError] = useState('')
  // 删除集合要连里面的请求一起删，得先问清楚，所以单独一个确认框。
  const [deletingCollection, setDeletingCollection] = useState<string | null>(null)
  // 语法高亮编辑（单层 contentEditable）
  const [wrapBody, setWrapBody] = useState(false)
  // 响应面板高度拖拽
  const [responseHeight, setResponseHeight] = useState(Math.min(400, window.innerHeight * 0.35))
  const dragging = useRef(false)
  const startY = useRef(0)
  const startH = useRef(0)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startY.current = e.clientY
    startH.current = responseHeight
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [responseHeight])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = startY.current - e.clientY
      const maxHeight = Math.max(160, window.innerHeight - 320)
      const newH = Math.min(Math.max(startH.current + delta, 160), maxHeight)
      setResponseHeight(newH)
    }
    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // 侧边栏宽度拖拽。外面那根管整个侧栏，里面那根管「集合列表 / 当前层浏览器」的分割比。
  // 两根共用一套 mouse 拖拽与一条 effect，只有各自的起点不同。
  const [sidebarWidth, setSidebarWidth] = useState(620)
  const [collectionPaneWidth, setCollectionPaneWidth] = useState(280)
  const sidebarDragging = useRef(false)
  const sidebarStartX = useRef(0)
  const sidebarStartW = useRef(0)
  const paneDragging = useRef(false)
  const paneStartX = useRef(0)
  const paneStartW = useRef(0)
  // 两个宽度互相钳制（左栏再宽也不能把右栏挤没，反之亦然），但 onMove 挂在 window 上、
  // effect 依赖列表为空——所以经过 ref 读另一侧的最新值，而不是每次拖动都重挂监听。
  const widthsRef = useRef({ sidebarWidth, collectionPaneWidth })
  useEffect(() => {
    widthsRef.current = { sidebarWidth, collectionPaneWidth }
  }, [sidebarWidth, collectionPaneWidth])

  const onSidebarDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    sidebarDragging.current = true
    sidebarStartX.current = e.clientX
    sidebarStartW.current = widthsRef.current.sidebarWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  const onPaneDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    paneDragging.current = true
    paneStartX.current = e.clientX
    paneStartW.current = widthsRef.current.collectionPaneWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const { sidebarWidth: total, collectionPaneWidth: pane } = widthsRef.current
      if (sidebarDragging.current) {
        const delta = e.clientX - sidebarStartX.current
        const lower = pane + BROWSER_PANE_MIN + PANE_HANDLE_WIDTH
        setSidebarWidth(Math.min(Math.max(sidebarStartW.current + delta, lower), 900))
        return
      }
      if (paneDragging.current) {
        const delta = e.clientX - paneStartX.current
        const upper = Math.min(COLLECTION_PANE_MAX, total - BROWSER_PANE_MIN - PANE_HANDLE_WIDTH)
        setCollectionPaneWidth(Math.min(Math.max(paneStartW.current + delta, COLLECTION_PANE_MIN), upper))
      }
    }
    const onUp = () => {
      if (!sidebarDragging.current && !paneDragging.current) return
      sidebarDragging.current = false
      paneDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // 自动持久化到文件
  useEffect(() => {
    if (storeHydrated) storeSaveRequests(savedRequests)
  }, [savedRequests, storeHydrated])
  useEffect(() => {
    if (storeHydrated) storeSetCollections(collections)
  }, [collections, storeHydrated])
  useEffect(() => {
    if (storeHydrated) storeSetFolders(folders)
  }, [folders, storeHydrated])

  useEffect(() => {
    let cancelled = false
    const loadPersistedRequests = async () => {
      try {
        const persisted = await hydrateStoreFromFile()
        if (cancelled) return
        setFolders(persisted.folders)
        if (persisted.requests.length === 0) {
          setSavedRequests([])
          setCollections(persisted.collections)
          setCurrentCollection(persisted.collections[0]?.name || '默认集合')
          setCurrentPath(null)
          setCurrentSavedId(null)
          setShowWelcome(true)
          setActiveRequestId(null)
          return
        }

        setSavedRequests(persisted.requests)
        setCollections(persisted.collections)
        const selected = persisted.requests.find(request => request.id === getActiveRequestId())
        if (!selected) {
          setCurrentCollection(persisted.collections[0]?.name || '默认集合')
          setCurrentPath(null)
          setCurrentSavedId(null)
          setShowWelcome(true)
          setActiveRequestId(null)
          setMethod('POST')
          setUrl('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
          setHeaders(defaultHeaders.map(header => ({ ...header })))
          setAuth(defaultAuthConfig)
          setBody(defaultBody)
          setBodyMode(defaultBodyConfig.mode)
          setBodyType(defaultBodyConfig.rawType)
          setBodyFields(defaultBodyConfig.fields.map(field => ({ ...field })))
          setBinaryBody(defaultBodyConfig.binary)
          setGraphqlQuery(defaultBodyConfig.graphqlQuery)
          setGraphqlVariables(defaultBodyConfig.graphqlVariables)
          setResponse(null)
          setConcurrentMode(false)
          setConcurrentCount(5)
          setConcurrentDuration(10)
          setRequestTimeout(600)
          setConcurrentResults(null)
          return
        }

        setMethod(selected.method as HttpMethod)
        setUrl(selected.url)
        setHeaders(selected.headers.map(h => ({ ...h })))
        setAuth(selected.auth || defaultAuthConfig)
        setBody(normalizePathSep(selected.body))
        const persistedBody = selected.bodyConfig || defaultBodyConfig
        setBodyMode(persistedBody.mode)
        setBodyType(persistedBody.rawType)
        setBodyFields(persistedBody.fields.map(field => ({ ...field })))
        setBinaryBody(persistedBody.binary)
        setGraphqlQuery(persistedBody.graphqlQuery)
        setGraphqlVariables(persistedBody.graphqlVariables)
        setResponse(selected.lastResponse || null)
        setConcurrentMode(selected.concurrentConfig?.mode ?? false)
        setConcurrentCount(selected.concurrentConfig?.count ?? 5)
        setConcurrentDuration(selected.concurrentConfig?.duration ?? 10)
        setRequestTimeout(selected.concurrentConfig?.timeout ?? 600)
        setConcurrentResults(selected.concurrentResults || null)
        setCurrentCollection(
          persisted.collections.some(c => c.name === selected.collection)
            ? selected.collection
            : persisted.collections[0]?.name || '默认集合'
        )
        setCurrentSavedId(selected.id)
        setCurrentPath(normParent(selected.parent))
        setShowWelcome(false)
      } catch {
        // 忽略恢复失败，保留当前已加载的状态
      } finally {
        if (!cancelled) setStoreHydrated(true)
      }
    }

    loadPersistedRequests()
    return () => { cancelled = true }
  }, [])

  const getApiPath = (u: string) => { try { return new URL(u).pathname } catch { return u } }
  const getModelName = () => { try { return JSON.parse(body).model || '' } catch { return '' } }
  const nowStr = () => { const d = new Date(); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}` }

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }, [])

  const refreshFolderShares = useCallback(async () => {
    const result = await listApiTestFolderShares()
    if (!result.success || !result.data) {
      setFolderShareError(result.error || '共享信息加载失败')
      return false
    }
    setFolderShares(result.data.outgoing)
    setIncomingFolderShares(result.data.incoming)
    setFolderShareError(null)
    return true
  }, [])

  const openFolderShareDialog = async (folder: SavedFolder) => {
    closeRowMenu()
    setShareDialogFolderId(folder.id)
    setSharePicked(new Set())
    setShareCandidates([])
    setShareError(null)
    const [sharesResult, candidatesResult] = await Promise.all([
      listApiTestFolderShares(),
      listApiTestFolderShareCandidates(),
    ])
    if (sharesResult.success && sharesResult.data) {
      setFolderShares(sharesResult.data.outgoing)
      setIncomingFolderShares(sharesResult.data.incoming)
      setFolderShareError(null)
    } else {
      setShareError(sharesResult.error || '共享信息加载失败')
    }
    if (candidatesResult.success && candidatesResult.data) {
      setShareCandidates(candidatesResult.data.users)
    } else {
      setShareError(candidatesResult.error || '用户列表加载失败')
    }
  }

  const saveFolderShares = async () => {
    if (!shareDialogFolderId || shareBusy) return
    const alreadySharedIds = new Set(
      folderShares.filter(entry => entry.folderId === shareDialogFolderId).map(entry => entry.granteeUserId),
    )
    const pending = [...sharePicked].filter(id => !alreadySharedIds.has(id))
    if (!pending.length) return
    setShareBusy(true)
    setShareError(null)
    const result = await createApiTestFolderShares(shareDialogFolderId, pending)
    setShareBusy(false)
    if (!result.success) {
      setShareError(result.error || '共享失败')
      return
    }
    setSharePicked(new Set())
    await refreshFolderShares()
  }

  const revokeFolderShare = async (entry: ApiTestFolderShareEntry) => {
    if (shareBusy) return
    setShareBusy(true)
    setShareError(null)
    const result = await revokeApiTestFolderShare(entry.shareId)
    setShareBusy(false)
    if (!result.success) {
      setShareError(result.error || '取消共享失败')
      return
    }
    await refreshFolderShares()
  }

  const requestSharedFolderEdit = async (share: SharedApiTestFolder) => {
    const result = await requestApiTestFolderEdit(share.shareId)
    if (!result.success) {
      showToast(`⚠️ ${result.error || '编辑申请失败'}`)
      return
    }
    showToast('✅ 编辑申请已提交，等待所有者审批')
    await refreshFolderShares()
  }

  const updateFolderEditAccess = async (
    shareId: number,
    editStatus: 'approved' | 'rejected' | 'none',
  ) => {
    setShareBusy(true)
    const result = await setApiTestFolderEditStatus(shareId, editStatus)
    setShareBusy(false)
    if (!result.success) {
      setShareError(result.error || '编辑权限更新失败')
      return
    }
    await refreshFolderShares()
  }

  const sharedRequestPayload = (
    responseToSave = response,
    resultsToSave = concurrentResults,
  ) => {
    const summary = calcConcurrentSummary(resultsToSave, responseToSave)
    return {
      label: sharedRequestLabel || url.split('/').pop()?.split('?')[0]?.split('.')[0] || '未命名',
      method,
      url,
      headers: headers.map(header => ({ ...header })),
      auth: { ...auth },
      body,
      bodyConfig: getBodyConfig(),
      savedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      ...(responseToSave ? { lastResponse: { ...responseToSave } } : {}),
      ...(resultsToSave ? { concurrentResults: resultsToSave } : {}),
      ...(summary ? { concurrentSummary: summary } : {}),
      concurrentConfig: { mode: concurrentMode, count: concurrentCount, duration: concurrentDuration, timeout: requestTimeout },
    }
  }

  const persistSharedRequest = async (
    responseToSave = response,
    resultsToSave = concurrentResults,
  ) => {
    if (!activeSharedFolder || activeSharedFolder.editStatus !== 'approved') return false
    const payload = sharedRequestPayload(responseToSave, resultsToSave)
    const result = sharedRequestId
      ? await updateSharedApiTestRequest(activeSharedFolder.shareId, sharedRequestId, payload)
      : await createSharedApiTestRequest(activeSharedFolder.shareId, { ...payload, parent: browsePath || activeSharedRootPath || undefined })
    if (!result.success) {
      showToast(`⚠️ ${result.error || '共享请求保存失败'}`)
      return false
    }
    if (!sharedRequestId && result.data?.id) setSharedRequestId(result.data.id)
    setSharedRequestLabel(payload.label)
    await refreshFolderShares()
    showToast('✅ 共享请求已保存')
    return true
  }

  const createSharedSubfolder = async () => {
    if (!activeSharedFolder || activeSharedFolder.editStatus !== 'approved') return
    const name = window.prompt('请输入新文件夹名称')
    if (!name?.trim()) return
    const result = await createSharedApiTestFolder(
      activeSharedFolder.shareId,
      name.trim(),
      browsePath || activeSharedRootPath || '',
    )
    if (!result.success) {
      showToast(`⚠️ ${result.error || '创建文件夹失败'}`)
      return
    }
    await refreshFolderShares()
    showToast('✅ 文件夹已创建')
  }

  const renameSharedSubfolder = async (folder: SavedFolder) => {
    if (!activeSharedFolder || activeSharedFolder.editStatus !== 'approved') return
    const name = window.prompt('请输入新的文件夹名称', folder.name)
    if (!name?.trim() || name.trim() === folder.name) return
    const result = await renameSharedApiTestFolder(activeSharedFolder.shareId, folder.id, name.trim())
    if (!result.success) {
      showToast(`⚠️ ${result.error || '重命名文件夹失败'}`)
      return
    }
    await refreshFolderShares()
  }

  const deleteSharedSubfolder = async (folder: SavedFolder) => {
    if (!activeSharedFolder || activeSharedFolder.editStatus !== 'approved') return
    if (!window.confirm(`删除文件夹“${folder.name}”及其全部子内容？`)) return
    const result = await deleteSharedApiTestFolder(activeSharedFolder.shareId, folder.id)
    if (!result.success) {
      showToast(`⚠️ ${result.error || '删除文件夹失败'}`)
      return
    }
    if (browsePath === folderPath(folder) || browsePath?.startsWith(`${folderPath(folder)}/`)) {
      setCurrentPath(activeSharedFolder.rootPath)
    }
    await refreshFolderShares()
  }

  const deleteSharedRequest = async (request: SavedRequest) => {
    if (!activeSharedFolder || activeSharedFolder.editStatus !== 'approved') return
    if (!window.confirm(`删除请求“${request.label}”？`)) return
    const result = await deleteSharedApiTestRequest(activeSharedFolder.shareId, request.id)
    if (!result.success) {
      showToast(`⚠️ ${result.error || '删除请求失败'}`)
      return
    }
    if (sharedRequestId === request.id) {
      setSharedRequestId(null)
      setCurrentSavedId(null)
      setSharedRequestMode(false)
    }
    await refreshFolderShares()
  }

  const renameSharedRequest = async (request: SavedRequest) => {
    if (!activeSharedFolder || activeSharedFolder.editStatus !== 'approved') return
    const label = window.prompt('请输入新的请求名称', request.label)
    if (!label?.trim() || label.trim() === request.label) return
    const result = await updateSharedApiTestRequest(activeSharedFolder.shareId, request.id, {
      ...request,
      label: label.trim(),
    })
    if (!result.success) {
      showToast(`⚠️ ${result.error || '重命名请求失败'}`)
      return
    }
    await refreshFolderShares()
  }

  const startNewSharedRequest = () => {
    if (!activeSharedFolder || activeSharedFolder.editStatus !== 'approved') return
    startNewRequest(activeSharedFolder.collection, browsePath || activeSharedRootPath)
    setActiveSharedFolderShareId(activeSharedFolder.shareId)
    setSharedRequestMode(true)
    setSharedRequestId(null)
    setSharedRequestLabel('')
  }

  useEffect(() => {
    void refreshFolderShares()
  }, [refreshFolderShares])

  const isValidCollectionName = (value: string) => /^[\p{L}\p{N}\s_-]+$/u.test(value)

  /**
   * 文件夹名校验。创建 / 改名 / 移动 / 拖拽守卫共用同一个口。
   *
   * 千万别拿它去校验【请求】名：isValidCollectionName 不允许括号，而 getUniqueLabel
   * 生成的正是 `${label} (${sequence})`——套上去会让每次自动保存遇到重名 URL 都失败。
   * 请求名不进路径，本来也没有禁 '/' 的需求；文件夹名必须过这一关，
   * 因为禁掉 '/' 正是路径式父子关系赖以成立的不变量。
   *
   * extraLength 是移动/改名时最深后代还要占的字符数：路径长度得连整棵子树一起算。
   */
  const validateFolderName = (
    name: string,
    collection: string,
    parent: string | null,
    excludeId?: string | null,
    extraLength = 0,
  ): string | null => {
    const trimmed = name.trim()
    if (!trimmed) return '请输入名称'
    if (!isValidCollectionName(trimmed)) return '仅支持中文、字母、数字、空格、下划线和短横线'
    if (trimmed.length > 255) return '名称最多 255 个字符'
    if (siblingNameTaken(folders, savedRequests, collection, parent, trimmed, excludeId)) {
      return '当前位置已存在同名条目'
    }
    const path = parent ? `${parent}/${trimmed}` : trimmed
    if (path.length + extraLength > MAX_PATH_LENGTH) return '路径过长，请减少嵌套层级或缩短名称'
    return null
  }

  // 新建与重命名走同一个提交口：校验规则一样，只有落在最后的那一步不同。
  // 校验不过时把原因写在弹窗里而不是 toast——弹窗还开着，用户改一个字就能重试。
  const openCollectionDialog = (
    mode: 'create' | 'rename' | 'createFolder' | 'renameFolder',
    original = '',
    collection = currentCollection,
    parent: string | null = null,
  ) => {
    setCollectionDialog({ mode, original, collection, parent })
    setCollectionName(original)
    setCollectionNameError('')
  }

  const closeCollectionDialog = () => {
    setCollectionDialog(null)
    setCollectionNameError('')
  }

  const submitCollectionDialog = () => {
    if (!collectionDialog) return
    const { mode, original, collection, parent } = collectionDialog
    const name = collectionName.trim()

    // 文件夹两态走自己的校验：名字要和同级条目比，路径长度要算上最深后代。
    if (mode === 'createFolder' || mode === 'renameFolder') {
      const target = mode === 'renameFolder'
        ? folders.find(f => f.collection === collection && f.name === original && normParent(f.parent) === normParent(parent))
        : undefined
      // 改名时，整棵子树最深还要多占多少字符：新路径长度得连它们一起算。
      const suffix = target
        ? folderIdsInSubtree(folders, collection, folderPath(target))
            .reduce((max, id) => {
              const descendant = folders.find(f => f.id === id)
              return descendant ? Math.max(max, folderPath(descendant).length - folderPath(target).length) : max
            }, 0)
        : 0
      const error = validateFolderName(name, collection, parent, target?.id ?? null, suffix)
      if (error) { setCollectionNameError(error); return }

      if (mode === 'createFolder') {
        setFolders(prev => [...prev, {
          id: createFolderId(),
          name,
          collection,
          ...(parent ? { parent } : {}),
        }])
        // 不用管「能不能看见」：新文件夹落在用户当前浏览的那一层，
        // 右栏本来就画着这一层，下一帧它自己就出现了。
        showToast('✅ 已创建新文件夹')
      } else if (target) {
        // 回车也能提交，绕开了保存按钮的 disabled，所以这里得自己认一次「没改」。
        if (name !== original) {
          relocateFolder(target, name, normParent(parent), collection)
          showToast('✅ 修改文件夹名称成功')
        }
      }
      closeCollectionDialog()
      return
    }

    if (!name) { setCollectionNameError('请输入集合名称'); return }
    if (!isValidCollectionName(name)) { setCollectionNameError('仅支持中文、字母、数字、空格、下划线和短横线'); return }
    if (collections.some(c => c.name.toLowerCase() === name.toLowerCase() && c.name !== original)) {
      setCollectionNameError('已存在同名集合')
      return
    }

    if (mode === 'create') {
      setCollections(prev => [...prev, { name, icon: '📁' }])
      setCurrentCollection(name)
      // 新集合是空的，落点必须是根层；留着上一个集合的路径，右栏会画一个这里不存在的层。
      setCurrentPath(null)
      showToast('✅ 已创建新集合')
    } else {
      // 回车也能提交，绕开了保存按钮的 disabled，所以这里得自己认一次「没改」：
      // 没改就当作取消，不必白刷一遍所有请求的 collection、也不必报一次「成功」。
      if (name !== original) {
        setCollections(prev => prev.map(c => c.name === original ? { ...c, name } : c))
        setSavedRequests(prev => prev.map(r => r.collection === original ? { ...r, collection: name } : r))
        // 文件夹也得跟着走。它的 parent 是「集合相对路径」，集合改名不影响路径本身，
        // 所以只改 collection 一个字段，不必重写任何 parent——currentPath 同理，原样保留。
        setFolders(prev => prev.map(f => f.collection === original ? { ...f, collection: name } : f))
        if (currentCollection === original) setCurrentCollection(name)
        showToast('✅ 修改集合名称成功')
      }
    }
    closeCollectionDialog()
  }

  /**
   * 文件夹改名与移动合成一个函数：两者的涟漪完全相同——祖先路径变了，整棵子树都得跟着重写。
   *
   * 没有会话迁移：接口信息的 lastResponse / concurrentResults 等按【请求 id】挂，
   * 移动时 id 不变，所以受影响的只有 parent 前缀。（知识库那边要迁文档问答记录，
   * 是因为它的会话是按路径归组的，这里不要照抄。）
   */
  const relocateFolder = (
    folder: SavedFolder,
    nextName: string,
    nextParent: string | null,
    targetCollection: string,
  ) => {
    const oldPath = folderPath(folder)
    const newPath = nextParent ? `${nextParent}/${nextName}` : nextName

    // 前缀切片是全部诀窍：后代的 parent 必然以 oldPath 开头，切掉旧前缀再拼新前缀，
    // 一遍扫完且深度保真，不需要递归。根层条目的 parent 是 undefined，经 normParent 得
    // null，isSelfOrDescendant 直接为假，不会误匹配。
    const rewrite = (parent?: string) => {
      const normalized = normParent(parent)
      if (normalized == null) return parent
      return `${newPath}${normalized.slice(oldPath.length)}`
    }
    const inside = (parent?: string) => {
      const normalized = normParent(parent)
      return normalized != null && isSelfOrDescendant(normalized, oldPath)
    }

    setFolders(prev => prev.map(item => {
      if (item.id === folder.id) {
        return { ...item, name: nextName, parent: nextParent ?? undefined, collection: targetCollection }
      }
      if (item.collection !== folder.collection || !inside(item.parent)) return item
      return { ...item, parent: rewrite(item.parent), collection: targetCollection }
    }))

    setSavedRequests(prev => prev.map(request => {
      if (request.collection !== folder.collection || !inside(request.parent)) return request
      return { ...request, parent: rewrite(request.parent), collection: targetCollection }
    }))

    // 用户站位跟着走：正在编辑的请求若就在这棵子树里，它现在挂在别的路径下了。
    // 只在站位确实落在子树里时才跟着换集合。用户人在别的文件夹下，拖走一个无关的
    // 文件夹不该把他的当前集合也切走。
    const currentNormalized = normParent(currentPath)
    if (currentNormalized != null && isSelfOrDescendant(currentNormalized, oldPath)) {
      setCurrentPath(`${newPath}${currentNormalized.slice(oldPath.length)}`)
      setCurrentCollection(targetCollection)
    }

    closeRowMenu()
  }

  const confirmDeleteFolder = () => {
    const folder = folders.find(f => f.id === deletingFolder)
    if (!folder) { setDeletingFolder(null); return }
    const path = folderPath(folder)
    const killedFolderIds = folderIdsInSubtree(folders, folder.collection, path)
    const killedRequests = requestsInSubtree(savedRequests, folder.collection, path)

    setFolders(prev => prev.filter(f => !killedFolderIds.includes(f.id)))
    setSavedRequests(prev => prev.filter(r => !killedRequests.some(k => k.id === r.id)))
    if (currentSavedId && killedRequests.some(r => r.id === currentSavedId)) {
      setCurrentSavedId(null)
      setActiveRequestId(null)
    }
    // 站位落在被删的子树里就退回父层，否则 currentPath 会指向一个不存在的路径，
    // 下次保存写进去的 parent 渲染不出来，请求等于凭空消失。
    if (isSelfOrDescendant(normParent(currentPath), path)) {
      setCurrentPath(normParent(folder.parent))
    }
    setDeletingFolder(null)
    showToast(`✅ 已删除文件夹及 ${killedRequests.length} 条请求`)
  }

  /** 单条记录换父路径，没有后代，所以独立成函数。 */
  const relocateRequest = (request: SavedRequest, nextParent: string | null, targetCollection: string) => {
    setSavedRequests(prev => prev.map(r =>
      r.id === request.id
        ? { ...r, parent: nextParent ?? undefined, collection: targetCollection }
        : r
    ))
    if (currentSavedId === request.id) {
      setCurrentPath(nextParent)
      setCurrentCollection(targetCollection)
    }
    closeRowMenu()
  }

  const openMoveDialog = (kind: 'folder' | 'request', id: string) => {
    const collection = kind === 'folder'
      ? folders.find(f => f.id === id)?.collection
      : savedRequests.find(r => r.id === id)?.collection
    const parent = kind === 'folder'
      ? normParent(folders.find(f => f.id === id)?.parent)
      : normParent(savedRequests.find(r => r.id === id)?.parent)
    setMovingNode({ kind, id })
    setMoveTargetCollection(collection || currentCollection)
    setMoveTargetPath(parent)
  }

  const closeMoveDialog = () => {
    setMovingNode(null)
    setMoveTargetPath(null)
  }

  /** 右栏某一层的直接子文件夹，保持数组顺序——接口信息有手动排序，按名字排会让每次拖拽都弹回去。 */
  const moveSubfolders = (collection: string, parent: string | null) =>
    childFolders(folders, collection, parent)

  /** 面包屑：首段是集合名而不是「根目录」，和知识库那边一致——摆名字比摆位置描述更好认。 */
  const moveBreadcrumb = (collection: string, path: string | null): Array<{ label: string; path: string | null }> => {
    const segments = path ? path.split('/') : []
    return [
      { label: collection, path: null },
      ...segments.map((name, index) => ({ label: name, path: segments.slice(0, index + 1).join('/') })),
    ]
  }

  /** 整棵子树里的请求数，用于确认区的文案。 */
  const descendantRequestCount = (): number => {
    if (!movingNode) return 0
    if (movingNode.kind === 'request') return 1
    const folder = folders.find(f => f.id === movingNode.id)
    if (!folder) return 0
    return requestsInSubtree(savedRequests, folder.collection, folderPath(folder)).length
  }

  /**
   * 「移动到」的三条校验，全在确认时执行——不靠隐藏选项。
   * 右栏是可下钻的浏览器，用户能主动走进被移动文件夹自己的子树，
   * 光靠「列表里不出现它」挡不住。
   */
  const moveBlockedReason = (): string | null => {
    if (!movingNode) return ''
    const isFolder = movingNode.kind === 'folder'
    const node = isFolder
      ? folders.find(f => f.id === movingNode.id)
      : savedRequests.find(r => r.id === movingNode.id)
    if (!node) return ''

    const name = isFolder ? (node as SavedFolder).name : (node as SavedRequest).label
    const currentParent = normParent((node as SavedFolder | SavedRequest).parent)

    // 1) 不能移进自身或后代。按路径判而不是按 id：同集合里目标路径若落在自己的子树内，
    //    移完就是自己套自己。跨集合时目标集合里不可能长着这棵子树，天然安全。
    if (isFolder && moveTargetPath != null) {
      const folder = node as SavedFolder
      if (moveTargetCollection === folder.collection
        && isSelfOrDescendant(moveTargetPath, folderPath(folder))) {
        return '不能移进自身或其子文件夹'
      }
    }

    // 2) 不能原地不动。
    if (moveTargetCollection === node.collection && moveTargetPath === currentParent) return '当前位置'

    // 3) 同级重名。比知识库更严：那边只有一个内容数组，这里要同时查文件夹和请求。
    //    excludeId 排除自己——放在原地那条已经被规则 2 拦下了，这里排除只是为了不误判。
    if (siblingNameTaken(folders, savedRequests, moveTargetCollection, moveTargetPath, name, node.id)) {
      return '目标位置已存在同名条目'
    }
    return null
  }

  const confirmMove = () => {
    if (!movingNode) return
    if (moveBlockedReason()) return
    if (movingNode.kind === 'folder') {
      const folder = folders.find(f => f.id === movingNode.id)
      if (folder) relocateFolder(folder, folder.name, moveTargetPath, moveTargetCollection)
    } else {
      const request = savedRequests.find(r => r.id === movingNode.id)
      if (request) relocateRequest(request, moveTargetPath, moveTargetCollection)
    }
    closeMoveDialog()
    showToast('✅ 已移动')
  }

  // 只剩一个集合时不给删：直接说清楚，别开一个确认框点完了才告诉你不让删。
  const openDeleteCollection = (name: string) => {
    if (collections.length <= 1) {
      showToast('⚠️ 需保留至少一个集合')
      return
    }
    setDeletingCollection(name)
  }

  const confirmDeleteCollection = () => {
    const name = deletingCollection
    if (!name) return
    const remainingCollections = collections.filter(c => c.name !== name)
    if (remainingCollections.length === 0) { setDeletingCollection(null); return }
    const requestsToDelete = savedRequests.filter(r => r.collection === name)
    // 要在 filter 之前算出来——filter 跑完 folders 里就没有它们了，报数会变成 0。
    const foldersToDelete = folders.filter(f => f.collection === name)
    setCollections(remainingCollections)
    setSavedRequests(prev => prev.filter(r => r.collection !== name))
    setFolders(prev => prev.filter(f => f.collection !== name))
    if (currentSavedId && requestsToDelete.some(request => request.id === currentSavedId)) {
      setCurrentSavedId(null)
      setActiveRequestId(null)
    }
    if (currentCollection === name) {
      setCurrentCollection(remainingCollections[0].name)
      // currentPath 是「集合相对路径」，换了集合就失效了。不清掉的话，下次保存会写入一个
      // 指向旧集合某文件夹的 parent——那个路径在新集合里渲染不出来，请求等于凭空消失。
      setCurrentPath(null)
    }
    setDeletingFolder(null)
    setDeletingCollection(null)
    showToast(`✅ 已删除集合、${foldersToDelete.length} 个文件夹及 ${requestsToDelete.length} 条请求`)
  }

  const startNewRequest = (collection = currentCollection, parent: string | null = null) => {
    setMethod('GET')
    setUrl('')
    setHeaders([{ key: 'Content-Type', value: 'application/json', enabled: true }])
    setAuth({ ...defaultAuthConfig })
    setBody('')
    setBodyMode('raw')
    setBodyType('json')
    setBodyFields([createBodyField()])
    setBinaryBody(null)
    setGraphqlQuery(defaultBodyConfig.graphqlQuery)
    setGraphqlVariables(defaultBodyConfig.graphqlVariables)
    setWrapBody(false)
    setCurrentCollection(collection)
    setCurrentPath(parent)
    setCurrentSavedId(null)
    setActiveRequestId(null)
    setActiveSharedFolderShareId(null)
    setSharedRequestMode(false)
    setResponse(null)
    setConcurrentResults(null)
    setSelectedConcurrentResult(null)
    setConcurrentMode(false)
    setConcurrentCount(5)
    setConcurrentDuration(10)
    setRequestTimeout(30)
    setDraftSource(null)
    setShowWelcome(false)
    showToast('✨ 新建请求')
  }

  // 知识库问答带入的草稿：只预填，是否发送由用户确认。
  const applyApiDraft = useCallback((draft: ApiRequestDraft) => {
    setMethod(draft.method)
    setUrl(draft.url)
    setHeaders(draft.headers?.length
      ? draft.headers.map(header => ({ ...header }))
      : [])
    setAuth(draft.auth ? { ...draft.auth } : { ...defaultAuthConfig })
    setBody(draft.body ?? '')
    setBodyMode(draft.bodyConfig?.mode ?? 'raw')
    setBodyType(draft.bodyConfig?.rawType ?? 'json')
    setBodyFields(draft.bodyConfig?.fields?.map(field => ({ ...field })) ?? [createBodyField()])
    setBinaryBody(draft.bodyConfig?.binary ?? null)
    setGraphqlQuery(draft.bodyConfig?.graphqlQuery ?? defaultBodyConfig.graphqlQuery)
    setGraphqlVariables(draft.bodyConfig?.graphqlVariables ?? defaultBodyConfig.graphqlVariables)
    setWrapBody(false)
    setCurrentSavedId(null)
    setActiveRequestId(null)
    setActiveSharedFolderShareId(null)
    setSharedRequestMode(false)
    setSharedRequestId(null)
    setResponse(null)
    setConcurrentResults(null)
    setSelectedConcurrentResult(null)
    setConcurrentMode(false)
    setDraftSource({ confidence: draft.confidence, origin: draft.origin, notices: draft.notices ?? [] })
    setShowWelcome(false)
  }, [])

  // 必须等工作区 hydrate 完成再消费：否则会被「恢复上次打开的请求」覆盖。
  const incomingDraftApplied = useRef(false)
  useEffect(() => {
    if (!storeHydrated || incomingDraftApplied.current) return
    incomingDraftApplied.current = true
    const draft = peekApiDraft()
    if (!draft) return
    applyApiDraft(draft)
    commitApiDraftConsumed()
    showToast('已从知识库问答带入请求，请确认后发送')
  }, [storeHydrated, applyApiDraft, showToast])

  // 加载可用模型，用于响应 AI 分析；失败不阻塞主流程。
  useEffect(() => {
    let mounted = true
    void getModels()
      .then((list) => {
        if (!mounted) return
        setModels(list)
        setModelsLoaded(true)
        const saved = localStorage.getItem(CHAT_MODEL_KEY)
        try {
          const parsed = JSON.parse(saved || '{}') as { selectedModelId?: string }
          if (parsed.selectedModelId && list.some((model) => model.id === parsed.selectedModelId)) {
            setSelectedModelId(parsed.selectedModelId)
          } else if (list.length) {
            setSelectedModelId(list[0].id)
          }
        } catch {
          if (list.length) setSelectedModelId(list[0].id)
        }
      })
      .catch(() => {
        if (!mounted) return
        setModelsLoaded(true)
      })
    return () => { mounted = false }
  }, [])

  const analysisInput = useMemo<ApiResponseAnalysisInput | null>(() => {
    if (!response) return null
    return {
      mode: analysisMode,
      ...(selectedModelId ? { model: selectedModelId } : {}),
      request: { method, url, headers, authType: auth.type, body },
      response: {
        status: response.status,
        statusText: response.statusText,
        time: response.time,
        size: response.size,
        headers: response.headers,
        body: response.body,
      },
    }
  }, [method, url, headers, auth.type, body, response, analysisMode, selectedModelId])

  const analysisKey = useMemo(() => (
    analysisInput ? apiAnalysisCacheKey(analysisInput) : ''
  ), [analysisInput])

  const runResponseAnalysis = async () => {
    if (!analysisInput || !analysisKey || analysisLoading) return
    const key = analysisKey
    setAnalysisLoading(true)
    setAnalysisError(null)
    setAnalysisResult(null)
    try {
      const result = await analyzeApiResponse(analysisInput)
      analysisCacheRef.current.set(key, result)
      if (analysisCacheRef.current.size > 12) {
        const oldest = analysisCacheRef.current.keys().next().value
        if (oldest) analysisCacheRef.current.delete(oldest)
      }
      setAnalysisResult(result)
      showToast('✅ AI 分析完成')
    } catch (error) {
      setAnalysisError((error as Error).message || 'AI 分析失败')
    } finally {
      setAnalysisLoading(false)
    }
  }

  const openResponseAnalysis = () => {
    setAnalysisDialogOpen(true)
    if (!analysisKey) return
    const cached = analysisCacheRef.current.get(analysisKey)
    if (cached) {
      setAnalysisResult(cached)
      setAnalysisError(null)
      return
    }
    if (!analysisLoading) void runResponseAnalysis()
  }

  // 响应变化（重新发送/切换请求）后，旧的分析结论不再适用。
  useEffect(() => {
    setAnalysisResult(null)
    setAnalysisError(null)
  }, [response])

  // 并发发送请求（每秒 N 路，持续 M 秒）
  const cancelSend = () => {
    if (!sending) return
    cancelRequested.current = true
    abortControllers.current.forEach(controller => controller.abort())
    abortControllers.current = []
    timeoutIds.current.forEach(clearTimeout)
    timeoutIds.current = []
    setSending(false)
    showToast('已取消发送')
  }

  const handleConcurrentSend = async () => {
    if (!url.trim()) { showToast('⚠️ 请输入 URL'); return }
    if (!sendGuardRef.current.begin()) {
      showToast('⏳ 请求正在发送，请稍后再试')
      return
    }
    cancelRequested.current = false
    abortControllers.current = []
    timeoutIds.current = []
    setSending(true)
    setResponse(null)
    setConcurrentResults([])
    setSelectedConcurrentResult(null)

    const perSec = concurrentCount
    const seconds = concurrentDuration
    const results: { index: number; status: number; time: string; body?: string }[] = []
    const startTime = Date.now()

    let fetchOptions: ReturnType<typeof buildFetchOptions>
    try {
      fetchOptions = buildFetchOptions()
    } catch (error) {
      setSending(false)
      sendGuardRef.current.end()
      showToast(`⚠️ ${(error as Error).message || 'Body 配置无效'}`)
      return
    }

    // 捕获第一个成功响应的 body 用于展示
    let sampleBody = ''
    let sampleStatus = 0
    let sampleStatusText = ''
    const sampleHeaders: Record<string, string> = {}
    const timeoutMs = requestTimeout * 1000
    let seq = 0

    for (let sec = 0; sec < seconds; sec++) {
      const batch = Array.from({ length: perSec }, async () => {
        const idx = ++seq
        const t0 = performance.now()
        const ac = new AbortController()
        abortControllers.current.push(ac)
        const tid = setTimeout(() => ac.abort(), timeoutMs)
        timeoutIds.current.push(tid)
        try {
          const res = await proxyRequest(buildRequestUrl(), { ...fetchOptions, signal: ac.signal })
          const t1 = performance.now()
          const responseText = await res.text()
          let responseBody = responseText
          try {
            responseBody = JSON.stringify(JSON.parse(responseText), null, 2)
          } catch {
            // 非 JSON 响应保留原文。
          }
          const entry = {
            index: idx,
            status: res.status,
            time: ((t1 - t0) / 1000).toFixed(2) + 's',
            body: responseBody,
          }
          results.push(entry)
          flushSync(() => {
            setConcurrentResults(prev => (prev ? [...prev, entry] : [entry]))
          })
          if (!sampleBody) {
            sampleStatus = res.status
            sampleStatusText = res.statusText || (res.ok ? 'OK' : 'Error')
            res.headers.forEach((v, k) => { sampleHeaders[k] = v })
            sampleBody = responseBody
          }
        } catch {
          const t1 = performance.now()
          const entry = {
            index: idx,
            status: 0,
            time: ((t1 - t0) / 1000).toFixed(2) + 's',
            body: '请求失败或已超时，未获取到响应 Body。',
          }
          results.push(entry)
          flushSync(() => {
            setConcurrentResults(prev => (prev ? [...prev, entry] : [entry]))
          })
        } finally {
          clearTimeout(tid)
          timeoutIds.current = timeoutIds.current.filter((id) => id !== tid)
          abortControllers.current = abortControllers.current.filter((c) => c !== ac)
        }
      })
      await Promise.allSettled(batch)
      if (cancelRequested.current) break
      if (sec < seconds - 1) {
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    const endTime = nowMs()
    const totalTime = ((endTime - startTime) / 1000).toFixed(2)

    if (cancelRequested.current) {
      setResponse({
        status: 0,
        statusText: '已取消',
        time: `${totalTime}s`,
        size: `${results.length} 次请求`,
        headers: {},
        body: JSON.stringify({
          error: '压测已取消',
          hint: '当前并发发送已被手动取消，不会保存结果。',
          completed: `${results.length} 次请求已完成`,
        }, null, 2),
      })
      setSending(false)
      cancelRequested.current = false
      abortControllers.current = []
      timeoutIds.current = []
      showToast('已取消发送')
      sendGuardRef.current.end()
      return
    }

    abortControllers.current = []
    timeoutIds.current = []

    // 汇总统计
    const success = results.filter(r => r.status >= 200 && r.status < 300).length
    const timeout = results.filter(r => r.status === 0).length
    const failed = results.filter(r => r.status >= 400).length
    const times = results.map(r => parseFloat(r.time)).filter(t => t > 0).sort((a, b) => a - b)
    const avg = times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2) : '0'
    const actualQps = (results.length / parseFloat(totalTime)).toFixed(2)

    // 百分位计算
    const percentile = (p: number) => {
      if (!times.length) return '-'
      const idx = Math.ceil((p / 100) * times.length) - 1
      return times[Math.max(0, idx)].toFixed(2) + 's'
    }

    const concurrentResponse = {
      status: success > 0 ? sampleStatus || 200 : 0,
      statusText: sampleStatusText || `压测完成 · ${results.length} 次 · ${actualQps} QPS`,
      time: `${totalTime}s`,
      size: `${results.length} 次请求`,
      headers: {
        '成功': `${success}`,
        '超时': `${timeout}`,
        '失败': `${failed}`,
        '平均': `${avg}s`,
        'P50': percentile(50),
        'P90': percentile(90),
        'P95': percentile(95),
        'P99': percentile(99),
        '实际QPS': actualQps,
      },
      body: sampleBody || JSON.stringify(results.map(r => ({ '#': r.index, 状态: r.status || (r.status === 0 ? '超时' : r.status), 耗时: r.time })), null, 2),
    }
    setResponse(concurrentResponse)
    setSending(false)
    sendGuardRef.current.end()
    const totalFailed = timeout + failed
    showToast(`🏁 压测完成: ${success} 成功, ${totalFailed} 失败/超时`)

    // 写入日志
    const failDetails = results.filter(r => r.status === 0 || r.status >= 400).map(r => `#${r.index} ${r.status === 0 ? '超时' : '状态=' + r.status} 耗时=${r.time}`).join('; ')
    await addLog({
      time: nowStr(),
      level: totalFailed > 0 ? 'warn' : 'info',
      source: 'API 测试',
      message: `压测 ${method} ${url} 完成: ${results.length} 次, QPS ${actualQps}, 成功 ${success}, 超时 ${timeout}, 失败 ${failed}`,
      detail: totalFailed > 0 ? `失败详情: ${failDetails}` : `平均 ${avg}s · P50 ${percentile(50)} · P95 ${percentile(95)}`,
      status: totalFailed > 0 ? 'failed' : 'success',
      duration: totalTime + 's',
      api: getApiPath(url),
      model: getModelName(),
      category: 'operation',
    })
    // 至少一条请求成功时自动保存配置和并发结果。
    if (success > 0) autoSave(concurrentResponse, results)
  }

  // 发送请求（真实 HTTP 调用）
  const handleSend = async () => {
    if (!url.trim()) {
      showToast('⚠️ 请输入 URL')
      return
    }
    if (!sendGuardRef.current.begin()) {
      showToast('⏳ 请求正在发送，请稍后再试')
      return
    }

    setSending(true)
    setResponse(null)

    const startTime = nowMs()

    try {
      const fetchOptions = buildFetchOptions()

      const timeoutMs = requestTimeout * 1000
      cancelRequested.current = false
      abortControllers.current = []
      timeoutIds.current = []
      const controller = new AbortController()
      abortControllers.current.push(controller)
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      timeoutIds.current.push(timer)
      const res = await proxyRequest(buildRequestUrl(), { ...fetchOptions, signal: controller.signal }).finally(() => {
        clearTimeout(timer)
        timeoutIds.current = timeoutIds.current.filter((id) => id !== timer)
        abortControllers.current = abortControllers.current.filter((c) => c !== controller)
      })
      const endTime = nowMs()
      const duration = ((endTime - startTime) / 1000).toFixed(2) + 's'

      // 读取响应体
      const contentType = res.headers.get('content-type') || ''
      let responseBody: string
      if (contentType.includes('application/json')) {
        const json = await res.json()
        responseBody = JSON.stringify(json, null, 2)
      } else {
        responseBody = await res.text()
      }

      // 计算响应大小
      const size = new TextEncoder().encode(responseBody).length
      const sizeStr = size > 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`

      // 收集响应头
      const respHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => { respHeaders[k] = v })

      const singleResponse = {
        status: res.status,
        statusText: res.statusText || (res.ok ? 'OK' : 'Error'),
        time: duration,
        size: sizeStr,
        headers: respHeaders,
        body: responseBody,
      }
      setResponse(singleResponse)
      // 写入单次调试日志
      const isError = res.status >= 400
      let tokens: number | undefined
      try {
        const parsed = JSON.parse(responseBody)
        if (parsed?.usage?.total_tokens) tokens = parsed.usage.total_tokens
      } catch { /* ignore */ }
      await addLog({
        time: nowStr(),
        level: isError ? 'warn' : 'info',
        source: 'API 测试',
        message: `${method} ${url} → ${res.status}`,
        detail: `耗时 ${duration} · 大小 ${sizeStr}`,
        status: isError ? 'failed' : 'success',
        duration,
        tokens,
        api: getApiPath(url),
        model: getModelName(),
        category: 'operation',
      })
      if (res.ok) autoSave(singleResponse, null)
    } catch (err) {
      const endTime = nowMs()
      const duration = ((endTime - startTime) / 1000).toFixed(2) + 's'
      const isAbort = (err as Error).name === 'AbortError'
      const isCanceled = isAbort && cancelRequested.current

      setResponse({
        status: 0,
        statusText: isCanceled ? '已取消' : '请求失败',
        time: duration,
        size: '0 B',
        headers: {},
        body: JSON.stringify({
          error: isCanceled ? '请求已取消' : '请求超时',
          hint: isCanceled
            ? '已手动取消发送，不会保存当前请求。'
            : `请求超过 ${requestTimeout} 秒未返回，已自动中止。可增大超时时间或检查服务端响应速度。`,
        }, null, 2),
      })
      if (!isCanceled) {
        await addLog({
          time: nowStr(),
          level: 'error',
          source: 'API 测试',
          message: `${method} ${url} → 请求失败`,
          detail: `耗时 ${duration} · ${(err as Error).name === 'AbortError' ? '超时' : (err as Error).message}`,
          status: 'failed',
          duration,
          api: getApiPath(url),
          model: getModelName(),
          category: 'operation',
        })
      }
    } finally {
      setSending(false)
      sendGuardRef.current.end()
      cancelRequested.current = false
      abortControllers.current = []
      timeoutIds.current = []
    }
  }

  // 计算并发统计摘要
  const calcConcurrentSummary = (
    resultsToSave = concurrentResults,
    responseToSave = response,
  ) => {
    if (!resultsToSave || resultsToSave.length === 0) return null
    const success = resultsToSave.filter(r => r.status >= 200 && r.status < 300).length
    const failed = resultsToSave.filter(r => r.status === 0 || r.status >= 400).length
    const times = resultsToSave.map(r => parseFloat(r.time)).filter(t => t > 0)
    const avg = times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2) : '0'
    return {
      total: resultsToSave.length,
      success,
      failed,
      avgTime: avg + 's',
      totalTime: responseToSave?.time || '0s',
    }
  }

  // 自动保存（发送成功后调用）
  const autoSave = (
    responseToSave = response,
    resultsToSave = concurrentResults,
  ) => {
    if (!url.trim()) return
    if (sharedRequestMode) {
      if (activeSharedFolder?.editStatus === 'approved') void persistSharedRequest(responseToSave, resultsToSave)
      return
    }
    if (currentSavedId) {
      quickSave(responseToSave, resultsToSave)
    } else {
      // 自动保存落在当前所在的文件夹里，重名判断也跟着这个层级走。
      const label = getUniqueLabel(url.split('/').pop()?.split('?')[0]?.split('.')[0] || '未命名', currentCollection, currentPath)
      const now = new Date().toLocaleString('zh-CN', { hour12: false })
      const newReq: SavedRequest = {
          id: `saved_${++nextRequestId}`,
          label, method, url,
          headers: headers.map(h => ({ ...h })),
          auth: { ...auth },
          body,
          bodyConfig: getBodyConfig(),
          collection: currentCollection,
          parent: currentPath ?? undefined,
          savedAt: now,
          lastResponse: responseToSave ? { status: responseToSave.status, statusText: responseToSave.statusText, time: responseToSave.time, size: responseToSave.size, body: responseToSave.body, headers: responseToSave.headers } : undefined,
          concurrentResults: resultsToSave || undefined,
          concurrentSummary: calcConcurrentSummary(resultsToSave, responseToSave) || undefined,
      }
      setSavedRequests(prev => [newReq, ...prev])
      setCurrentSavedId(newReq.id)
      setActiveRequestId(newReq.id)
    }
  }

  // 快速保存（已有保存时直接覆盖，不弹窗）
  const quickSave = (
    responseToSave = response,
    resultsToSave = concurrentResults,
  ) => {
    if (!currentSavedId) return
    const saved = savedRequests.find(r => r.id === currentSavedId)
    if (!saved) return

    const now = new Date().toLocaleString('zh-CN', { hour12: false })
    setSavedRequests(prev =>
      prev.map(r =>
        r.id === currentSavedId
          ? {
              ...r, method, url,
              headers: headers.map(h => ({ ...h })), body, bodyConfig: getBodyConfig(), savedAt: now,
              auth: { ...auth },
              lastResponse: responseToSave ? {
                status: responseToSave.status,
                statusText: responseToSave.statusText,
                time: responseToSave.time,
                size: responseToSave.size,
                body: responseToSave.body,
                headers: responseToSave.headers,
              } : r.lastResponse,
              concurrentResults: resultsToSave || r.concurrentResults,
              concurrentSummary: calcConcurrentSummary(resultsToSave, responseToSave) || r.concurrentSummary,
              concurrentConfig: { mode: concurrentMode, count: concurrentCount, duration: concurrentDuration, timeout: requestTimeout },
            }
          : r
      )
    )
    showToast('✅ 保存成功')
  }

  // 加载已保存请求（含上次调试结果）
  const loadRequest = (r: SavedRequest) => {
    setActiveSharedFolderShareId(null)
    setSharedRequestMode(false)
    setSharedRequestId(null)
    setDraftSource(null)
    setShowWelcome(false)
    setMethod(r.method as HttpMethod)
    setUrl(r.url)
    setHeaders(r.headers.map(h => ({ ...h })))
    setAuth(r.auth || defaultAuthConfig)
    setBody(normalizePathSep(r.body))
    const savedBody = r.bodyConfig || defaultBodyConfig
    setBodyMode(savedBody.mode)
    setBodyType(savedBody.rawType)
    setBodyFields(savedBody.fields.map(field => ({ ...field })))
    setBinaryBody(savedBody.binary)
    setGraphqlQuery(savedBody.graphqlQuery)
    setGraphqlVariables(savedBody.graphqlVariables)
    // 右栏跟着跳到这条请求所在的那一层，否则高亮落在看不见的地方。
    setCurrentCollection(r.collection)
    setCurrentPath(normParent(r.parent))
    setCurrentSavedId(r.id)
    setActiveRequestId(r.id)
    setResponse(r.lastResponse ? { ...r.lastResponse } : null)
    setConcurrentResults(r.concurrentResults || null)
    setSelectedConcurrentResult(null)
    if (r.concurrentConfig) {
      setConcurrentMode(r.concurrentConfig.mode)
      setConcurrentCount(r.concurrentConfig.count)
      setConcurrentDuration(r.concurrentConfig.duration)
      if (r.concurrentConfig.timeout) setRequestTimeout(r.concurrentConfig.timeout)
    }
  }

  const loadSharedRequest = (r: SavedRequest) => {
    setDraftSource(null)
    setShowWelcome(false)
    setMethod(r.method as HttpMethod)
    setUrl(r.url)
    setHeaders(r.headers.map(h => ({ ...h })))
    setAuth(r.auth || defaultAuthConfig)
    setBody(normalizePathSep(r.body))
    const savedBody = r.bodyConfig || defaultBodyConfig
    setBodyMode(savedBody.mode)
    setBodyType(savedBody.rawType)
    setBodyFields(savedBody.fields.map(field => ({ ...field })))
    setBinaryBody(savedBody.binary)
    setGraphqlQuery(savedBody.graphqlQuery)
    setGraphqlVariables(savedBody.graphqlVariables)
    setCurrentSavedId(null)
    setActiveRequestId(null)
    setSharedRequestMode(true)
    setSharedRequestId(r.id)
    setSharedRequestLabel(r.label)
    setResponse(r.lastResponse ? { ...r.lastResponse } : null)
    setConcurrentResults(r.concurrentResults || null)
    setSelectedConcurrentResult(null)
    if (r.concurrentConfig) {
      setConcurrentMode(r.concurrentConfig.mode)
      setConcurrentCount(r.concurrentConfig.count)
      setConcurrentDuration(r.concurrentConfig.duration)
      if (r.concurrentConfig.timeout) setRequestTimeout(r.concurrentConfig.timeout)
    }
  }

  // 删除已保存请求
  const confirmDelete = () => {
    if (!deleteTarget) return
    setSavedRequests(prev => prev.filter(r => r.id !== deleteTarget))
    if (currentSavedId === deleteTarget) {
      setCurrentSavedId(null)
      setActiveRequestId(null)
    }
    setDeleteTarget(null)
    showToast('🗑️ 已删除')
  }

  // 打开重命名
  const openRename = (r: SavedRequest) => {
    setRenamingId(r.id)
    setRenameLabel(r.label)
    setRenameError('')
  }

  // 确认重命名
  const confirmRename = () => {
    const label = renameLabel.trim()
    if (!label || !renamingId) return
    const request = savedRequests.find(item => item.id === renamingId)
    if (request && hasDuplicateLabel(label, request.collection, normParent(request.parent), renamingId)) {
      setRenameError('当前位置已存在同名条目')
      return
    }
    setSavedRequests(prev =>
      prev.map(r => r.id === renamingId ? { ...r, label } : r)
    )
    setRenamingId(null)
    setRenameError('')
    showToast('✏️ 已重命名')
  }

  const duplicateRequest = (request: SavedRequest) => {
    const duplicate: SavedRequest = {
      ...request,
      id: `saved_${++nextRequestId}`,
      label: getUniqueLabel(`${request.label} 副本`, request.collection, normParent(request.parent)),
      headers: request.headers.map(header => ({ ...header })),
      auth: request.auth ? { ...request.auth } : undefined,
      bodyConfig: request.bodyConfig ? {
        ...request.bodyConfig,
        fields: request.bodyConfig.fields.map(field => ({ ...field })),
        binary: request.bodyConfig.binary ? { ...request.bodyConfig.binary } : null,
      } : undefined,
      parent: request.parent,
      savedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      lastResponse: request.lastResponse ? {
        ...request.lastResponse,
        headers: { ...request.lastResponse.headers },
      } : undefined,
      concurrentResults: request.concurrentResults?.map(result => ({ ...result })),
      concurrentSummary: request.concurrentSummary ? { ...request.concurrentSummary } : undefined,
      concurrentConfig: request.concurrentConfig ? { ...request.concurrentConfig } : undefined,
    }
    setSavedRequests(previous => [duplicate, ...previous])
    loadRequest(duplicate)
    showToast('✅ 已复制副本')
  }

  const rawEditorExtensions = useMemo(() => {
    const language = {
      json: json(),
      javascript: javascript(),
      html: html(),
      xml: xml(),
      text: null,
    }[bodyType]
    return [
      ...(language ? [language] : []),
      ...(wrapBody ? [EditorView.lineWrapping] : []),
      editorChromeTheme,
    ]
  }, [bodyType, wrapBody])

  const responseEditor = useMemo(() => {
    const contentType = Object.entries(response?.headers || {})
      .find(([key]) => key.toLowerCase() === 'content-type')?.[1]
      ?.toLowerCase() || ''
    let detectedType: RawBodyType = 'text'

    if (contentType.includes('json')) detectedType = 'json'
    else if (contentType.includes('javascript')) detectedType = 'javascript'
    else if (contentType.includes('html')) detectedType = 'html'
    else if (contentType.includes('xml')) detectedType = 'xml'
    else if (response?.body) {
      try {
        JSON.parse(response.body)
        detectedType = 'json'
      } catch {
        // 非 JSON 响应保持纯文本。
      }
    }

    const language = {
      json: json(),
      javascript: javascript(),
      html: html(),
      xml: xml(),
      text: null,
    }[detectedType]

    return {
      mime: bodyTypeMeta[detectedType].mime,
      extensions: [...(language ? [language] : []), editorChromeTheme],
    }
  }, [response])

  const addHeader = () => setHeaders([...headers, { key: '', value: '', enabled: true }])
  const updateHeader = (i: number, field: 'key' | 'value', val: string) => {
    const next = [...headers]; next[i] = { ...next[i], [field]: val }; setHeaders(next)
  }
  const toggleHeader = (i: number) => {
    const next = [...headers]; next[i] = { ...next[i], enabled: !next[i].enabled }; setHeaders(next)
  }
  const removeHeader = (i: number) => setHeaders(headers.filter((_, idx) => idx !== i))

  // 拖拽状态收成一个联合类型。原先是三个散装的可空字符串，多加一个「文件夹」维度后
  // 就有三种「谁在拖」，三个 flag 各自为政很容易出现两个同时非空这种说不清的状态。
  // 投放目标也从裸字符串变成 {key, zone}：一行现在最多有三个投放带（上/中/下），
  // 光一个 key 说不清鼠标悬在哪一带。
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null)
  const [dragOverTarget, setDragOverTarget] = useState<{ key: string; zone: DropZone } | null>(null)

  const finishDrag = () => {
    setDragPayload(null)
    setDragOverTarget(null)
  }

  const dropZoneOf = (key: string): DropZone | null =>
    dragOverTarget?.key === key ? dragOverTarget.zone : null

  /** 投放前的通用守卫。拦下就要说清楚原因——悄悄什么都不发生，用户只会以为拖拽坏了。 */
  const dragBlockedReason = (
    targetCollection: string,
    targetParent: string | null,
    movingName: string,
    movingId: string,
  ): string | null => {
    if (dragPayload?.kind === 'folder') {
      const folder = folders.find(f => f.id === dragPayload.id)
      // 文件夹拖进自身或后代，整棵子树会自己套自己。跨集合不可能成环（那里没有这棵子树）。
      if (folder && targetCollection === folder.collection
        && isSelfOrDescendant(targetParent, folderPath(folder))) {
        return '不能移进自身或其子文件夹'
      }
    }
    // 同一层内重排不该被自己挡住；换个位置放同名条目才是真的冲突。
    const stayingPut = dragPayload?.kind === 'folder'
      ? folders.find(f => f.id === dragPayload.id)
      : dragPayload?.kind === 'request'
        ? savedRequests.find(r => r.id === dragPayload.id)
        : undefined
    const sameLevel = stayingPut
      && stayingPut.collection === targetCollection
      && normParent(stayingPut.parent) === targetParent
    if (!sameLevel
      && siblingNameTaken(folders, savedRequests, targetCollection, targetParent, movingName, movingId)) {
      return '该位置已有同名条目'
    }
    const resultPath = targetParent ? `${targetParent}/${movingName}` : movingName
    if (resultPath.length > MAX_PATH_LENGTH) return '路径过长，请减少嵌套层级'
    return null
  }

  const moveCollection = (targetName: string, placeAfter: boolean) => {
    if (dragPayload?.kind !== 'collection' || dragPayload.name === targetName) return
    const sourceName = dragPayload.name
    setCollections(previous => {
      const source = previous.find(collection => collection.name === sourceName)
      if (!source) return previous
      const remaining = previous.filter(collection => collection.name !== sourceName)
      const targetIndex = remaining.findIndex(collection => collection.name === targetName)
      if (targetIndex < 0) return previous
      remaining.splice(targetIndex + (placeAfter ? 1 : 0), 0, source)
      return remaining
    })
  }

  /** 请求落点。同时写 collection 和 parent——只改 collection 会让它留在一个新集合里不存在的路径下。 */
  const moveRequest = (targetCollection: string, targetParent: string | null, targetId?: string, placeAfter = false) => {
    if (dragPayload?.kind !== 'request') return
    const source = savedRequests.find(request => request.id === dragPayload.id)
    if (!source || source.id === targetId) return
    const blocked = dragBlockedReason(targetCollection, targetParent, source.label, source.id)
    if (blocked) { showToast(`⚠️ ${blocked}`); return }

    setSavedRequests(previous => {
      const moved = { ...source, collection: targetCollection, parent: targetParent ?? undefined }
      const remaining = previous.filter(request => request.id !== dragPayload.id)
      if (!targetId) {
        // 追加到末尾。匹配要同时看 collection 和 parent：只看集合会把别的层的位置也算进来。
        const lastIndex = remaining.reduce(
          (result, request, index) =>
            request.collection === targetCollection && normParent(request.parent) === targetParent
              ? index
              : result,
          -1,
        )
        remaining.splice(lastIndex + 1, 0, moved)
        return remaining
      }

      const targetIndex = remaining.findIndex(request => request.id === targetId)
      if (targetIndex < 0) return previous
      remaining.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved)
      return remaining
    })

    if (currentSavedId === source.id) {
      setCurrentCollection(targetCollection)
      setCurrentPath(targetParent)
    }
  }

  /** 文件夹落点。同层只是排序，换层/换集合才要动路径。 */
  const moveFolder = (targetCollection: string, targetParent: string | null, targetId?: string, placeAfter = false) => {
    if (dragPayload?.kind !== 'folder') return
    const folder = folders.find(f => f.id === dragPayload.id)
    if (!folder || folder.id === targetId) return

    const sameLevel = folder.collection === targetCollection && normParent(folder.parent) === targetParent
    if (!sameLevel) {
      const blocked = dragBlockedReason(targetCollection, targetParent, folder.name, folder.id)
      if (blocked) { showToast(`⚠️ ${blocked}`); return }
      // relocateFolder 负责改名字段和整棵子树的前缀重写，这里只需要再把它挪到锚点位置。
      relocateFolder(folder, folder.name, targetParent, targetCollection)
    }
    if (!targetId) return

    // 同层排序走这里；换层时上一步已经改完字段，这里读到的就是改过的那份。
    setFolders(previous => {
      const moved = previous.find(f => f.id === folder.id)
      if (!moved) return previous
      const remaining = previous.filter(f => f.id !== folder.id)
      const targetIndex = remaining.findIndex(f => f.id === targetId)
      if (targetIndex < 0) return previous
      remaining.splice(targetIndex + (placeAfter ? 1 : 0), 0, moved)
      return remaining
    })
  }

  // 右栏一次只画一层，所以不再需要「拍平成一张大表再切回去」——直接取当前层的两串。
  // 渲染顺序永远是文件夹在前、请求在后；两串各自保序，拖拽排的就是各自数组里的位置。
  const browsePath = normParent(currentPath)
  const activeSharedFolder = incomingFolderShares.find(share => share.shareId === activeSharedFolderShareId) || null
  const activeSharedRootPath = activeSharedFolder
    ? activeSharedFolder.rootPath || activeSharedFolder.folderName
    : null
  const visibleFolders = useMemo(
    () => childFolders(folders, currentCollection, browsePath),
    [folders, currentCollection, browsePath],
  )
  const visibleRequests = useMemo(
    () => childRequests(savedRequests, currentCollection, browsePath),
    [savedRequests, currentCollection, browsePath],
  )
  const breadcrumbs = useMemo(() => browseBreadcrumb(browsePath), [browsePath])
  const sharedVisibleFolders = activeSharedFolder
    ? childFolders(activeSharedFolder.folders, activeSharedFolder.collection, browsePath)
    : []
  const sharedVisibleRequests = activeSharedFolder
    ? childRequests(activeSharedFolder.requests, activeSharedFolder.collection, browsePath)
    : []
  useEffect(() => {
    if (activeSharedFolderShareId != null && !incomingFolderShares.some(share => share.shareId === activeSharedFolderShareId)) {
      setActiveSharedFolderShareId(null)
    }
  }, [activeSharedFolderShareId, incomingFolderShares])

  /** 对半分的投放带。右栏一次只显示一层，行上就只剩前后两条边。 */
  const zoneAtDrop = (event: React.DragEvent): DropZone => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before'
  }

  /** 文件夹行。点整行钻进去；不再有收起箭头和缩进——层级由「你在哪一层」表达。 */
  const renderFolderRow = (folder: SavedFolder) => {
    const path = folderPath(folder)
    const total = childCount(folders, savedRequests, folder.collection, path)
    const sharedCount = folderShares.filter(entry => entry.folderId === folder.id).length
    const isDragged = dragPayload?.kind === 'folder' && dragPayload.id === folder.id
    const zone = dropZoneOf(folderMenuKey(folder.id))
    // 看得见的行都在同一层，所以文件夹落到文件夹行上只可能是同层排序；
    // 请求落到文件夹行上是「放进去」——把请求归档的主要手势。
    // 集合不接：要挪集合请用左栏。
    const accepts = Boolean(dragPayload) && dragPayload?.kind !== 'collection' && !isDragged

    return (
      <div
        key={`folder:${folder.id}`}
        className={`group flex min-w-0 flex-nowrap items-center gap-1 whitespace-nowrap rounded-lg py-1 pr-2 text-sm tracking-wider text-base-content/40 transition-colors hover:bg-base-200/70 ${
          openMenuId === folderMenuKey(folder.id) ? 'bg-base-200/70' : ''
        } ${isDragged ? 'opacity-40' : ''
        } ${zone === 'into' ? 'bg-primary/10 ring-1 ring-primary/30' : ''
        } ${zone === 'before' ? 'border-t-2 border-primary' : ''
        } ${zone === 'after' ? 'border-b-2 border-primary' : ''}`}
        onDragOver={(event) => {
          if (!accepts) return
          event.preventDefault()
          event.stopPropagation()
          setDragOverTarget({
            key: folderMenuKey(folder.id),
            zone: dragPayload?.kind === 'request' ? 'into' : zoneAtDrop(event),
          })
        }}
        onDrop={(event) => {
          if (!accepts) return
          event.preventDefault()
          // 必须停在这里：不停的话外层容器的 onDrop 会接着触发，把落点重新算成集合根层。
          event.stopPropagation()
          if (dragPayload?.kind === 'request') {
            moveRequest(folder.collection, path, undefined, false)
          } else {
            moveFolder(folder.collection, normParent(folder.parent), folder.id, zoneAtDrop(event) === 'after')
          }
          finishDrag()
        }}
      >
        <span
          className="cursor-grab select-none text-base-content/25 active:cursor-grabbing"
          draggable
          title="拖动文件夹排序或移动"
          onDragStart={(event) => {
            event.stopPropagation()
            event.dataTransfer.effectAllowed = 'move'
            setDragPayload({ kind: 'folder', id: folder.id })
          }}
          onDragEnd={finishDrag}
        >
          ⠿
        </span>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left"
          onClick={() => setCurrentPath(path)}
          title={`进入“${folder.name}”`}
        >
          {/* 集合与文件夹统一用知识库同款双色填充文件夹（卡片 h-9 w-10）。 */}
          <span className="relative h-9 w-10 shrink-0"><svg viewBox="0 0 40 36" className="h-full w-full"><path fill="#9bd7bd" d="M2 8a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z"/><path fill="#c8eadb" d="M2 13h36v18a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z"/></svg></span>
          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-base-content/60" title={path}>{folder.name}</span>
          <span className="shrink-0 text-base-content/20">({total})</span>
          {sharedCount > 0 && <span className="shrink-0 text-[10px] text-primary" title={`已共享给 ${sharedCount} 人`}>↗{sharedCount}</span>}
          {/* 可下钻的提示。以前这里是收起/展开箭头，现在层级靠「你在哪一层」表达。 */}
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0 text-base-content/25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 6 15 12 9 18" /></svg>
        </button>
        <div className="mr-1">
          <RowMenuTrigger
            open={openMenuId === folderMenuKey(folder.id)}
            onClick={(event) => { event.stopPropagation(); rowMenu.toggle(folderMenuKey(folder.id), event.currentTarget) }}
            label={`${folder.name}操作`}
          />
        </div>
        {openMenuId === folderMenuKey(folder.id) && menuAnchor ? (
          <RowMenuPopover anchor={menuAnchor} panelRef={rowMenuRef}>
            {/* 「新建请求 / 新建文件夹」没了：钻进来就用顶栏的 +，菜单里再放一份是同一个动作的第二条路径。 */}
            <MenuAction icon={menuIcons.edit} label="重命名" onClick={() => { closeRowMenu(); openCollectionDialog('renameFolder', folder.name, folder.collection, normParent(folder.parent)) }} />
            <MenuAction icon={menuIcons.environment} label="环境配置" onClick={() => { closeRowMenu(); openFolderBaseUrlDialog(folder) }} />
            <MenuAction icon={menuIcons.link} label="共享管理" onClick={() => { void openFolderShareDialog(folder) }} />
            <MenuAction icon={menuIcons.move} label="移动到" onClick={() => { closeRowMenu(); openMoveDialog('folder', folder.id) }} />
            <MenuAction icon={menuIcons.trash} label="删除" tone="danger" onClick={() => { closeRowMenu(); setDeletingFolder(folder.id) }} />
          </RowMenuPopover>
        ) : null}
      </div>
    )
  }

  /** 请求行。 */
  const renderRequestRow = (r: SavedRequest) => {
    const isDragged = dragPayload?.kind === 'request' && dragPayload.id === r.id
    const zone = dropZoneOf(r.id)
    // 只接请求。文件夹落到请求行上没有说得通的语义：文件夹和请求是两个数组，
    // 「插到这个请求前面」在 folders 数组里找不到锚点（moveFolder 会 findIndex 返回 -1
    // 然后静默不动），要么归档进文件夹请拖到文件夹行上。
    const accepts = dragPayload?.kind === 'request' && !isDragged
    return (
      <div
        key={r.id}
        className={`group flex items-center gap-2 rounded-lg py-2 pr-2.5 text-left text-sm transition-colors hover:bg-base-200 cursor-pointer ${
          currentSavedId === r.id ? 'bg-primary/5 ring-1 ring-primary/20' : ''
        } ${zone === 'before' ? 'border-t-2 border-primary' : ''
        } ${zone === 'after' ? 'border-b-2 border-primary' : ''
        } ${isDragged ? 'opacity-40' : ''}`}
        onClick={() => loadRequest(r)}
        onDragOver={(event) => {
          if (!accepts) return
          event.preventDefault()
          event.stopPropagation()
          setDragOverTarget({ key: r.id, zone: zoneAtDrop(event) })
        }}
        onDrop={(event) => {
          if (!accepts) return
          event.preventDefault()
          // 外层容器的 onDrop 就在上层，不停就白算。
          event.stopPropagation()
          moveRequest(r.collection, normParent(r.parent), r.id, zoneAtDrop(event) === 'after')
          finishDrag()
        }}
      >
        <span
          className="cursor-grab select-none text-base-content/20 active:cursor-grabbing"
          draggable
          title="拖动请求排序或移动到其他文件夹"
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.stopPropagation()
            event.dataTransfer.effectAllowed = 'move'
            setDragPayload({ kind: 'request', id: r.id })
          }}
          onDragEnd={finishDrag}
        >
          ⠿
        </span>
        <span className={`font-mono font-bold text-[10px] w-10 shrink-0 ${methodColors[r.method as HttpMethod]}`}>
          {r.method}
        </span>
        <div className="flex-1 min-w-0">
          <div className="truncate font-medium text-base-content">{r.label}</div>
          <div className="truncate text-base-content/30 text-[10px]">{r.url}</div>
        </div>
        {/* 上次调试结果 */}
        {r.concurrentSummary ? (
          <div className="shrink-0 text-[10px] mr-0.5 flex items-center gap-1">
            <span className="text-green-600">{r.concurrentSummary.success}✓</span>
            {r.concurrentSummary.failed > 0 && <span className="text-red-500">{r.concurrentSummary.failed}✗</span>}
          </div>
        ) : r.lastResponse && (
          <div className={`shrink-0 text-[10px] font-bold mr-0.5 ${
            r.lastResponse.status >= 400 ? 'text-red-500' : r.lastResponse.status >= 300 ? 'text-amber-500' : 'text-green-600'
          }`}>
            {r.lastResponse.status}
          </div>
        )}
        {/* 「⋯」：和知识库同一套。原来这里是 DaisyUI 的 dropdown，靠 CSS 焦点开关，
            只能显示在行内、会被 overflow-y-auto 裁掉，菜单项也没有图标。 */}
        <RowMenuTrigger
          open={openMenuId === r.id}
          onClick={(event) => { event.stopPropagation(); rowMenu.toggle(r.id, event.currentTarget) }}
          label={`${r.label}操作`}
        />
        {openMenuId === r.id && menuAnchor ? (
          // 整行点了就加载请求，浮层虽然飘在外面、DOM 上仍在这行里，不挡住冒泡会连带把请求也打开。
          <RowMenuPopover anchor={menuAnchor} panelRef={rowMenuRef} onClick={(event) => event.stopPropagation()}>
            <MenuAction icon={menuIcons.edit} label="重命名" onClick={() => { closeRowMenu(); openRename(r) }} />
            <MenuAction icon={menuIcons.copy} label="复制副本" onClick={() => { closeRowMenu(); duplicateRequest(r) }} />
            <MenuAction icon={menuIcons.move} label="移动到" onClick={() => { closeRowMenu(); openMoveDialog('request', r.id) }} />
            <MenuAction icon={menuIcons.trash} label="删除" tone="danger" onClick={() => { closeRowMenu(); setDeleteTarget(r.id) }} />
          </RowMenuPopover>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 标题栏 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">API 测试</h1>
          <p className="text-base-content/60 mt-1"></p>
        </div>
      </div>

      {/* 工具区 */}
      <div className="flex flex-1 overflow-hidden rounded-box border border-base-200 bg-base-100">

        {/* ========== Toast ========== */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-bounce rounded-lg bg-base-content px-4 py-2 text-sm text-base-100 shadow-lg">
          {toast}
        </div>
      )}

      {/* ========== 左侧保存面板 ========== */}
      <>
          <aside
            className="relative z-auto flex h-full flex-row border-r border-base-200 bg-base-100"
            style={{ width: sidebarWidth, minWidth: PANE_MIN_TOTAL }}
          >
            {/* ===== 左栏：集合清单 ===== */}
            <div className="flex shrink-0 flex-col border-r border-base-200" style={{ width: collectionPaneWidth }}>
              <div className="flex h-14 items-center gap-2 border-b border-base-200 px-4">
                <h2 className="text-sm font-semibold">接口信息</h2>
              </div>

              <div className="flex-1 overflow-y-auto p-2">
                {collections.length === 0 ? (
                  <div className="flex h-32 flex-col items-center justify-center gap-2 text-xs text-base-content/20">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /></svg>
                    <span>暂无保存的配置</span>
                  </div>
                ) : collections.map(c => {
                  const isActive = c.name === currentCollection
                  const zone = dropZoneOf(collectionMenuKey(c.name))
                  const isDragged = dragPayload?.kind === 'collection' && dragPayload.name === c.name
                  return (
                    <div
                      key={c.name}
                      className={`group mb-1 flex min-w-0 flex-nowrap items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm transition-colors ${
                        isActive ? 'bg-primary/10 font-semibold text-primary' : 'text-base-content/60 hover:bg-base-200/70'
                      } ${zone === 'into' ? 'bg-primary/5 ring-1 ring-primary/30' : ''
                      } ${zone === 'before' ? 'border-t-2 border-primary' : ''
                      } ${zone === 'after' ? 'border-b-2 border-primary' : ''
                      } ${isDragged ? 'opacity-40' : ''}`}
                      onDragOver={(event) => {
                        if (!dragPayload) return
                        event.preventDefault()
                        // 集合拖到集合上才是排序；文件夹/请求落在这一行上一律是「放进这个集合根层」。
                        setDragOverTarget({
                          key: collectionMenuKey(c.name),
                          zone: dragPayload.kind === 'collection' ? zoneAtDrop(event) : 'into',
                        })
                      }}
                      onDrop={(event) => {
                        if (!dragPayload) return
                        event.preventDefault()
                        if (dragPayload.kind === 'collection') {
                          moveCollection(c.name, zoneAtDrop(event) === 'after')
                        } else if (dragPayload.kind === 'folder') {
                          // 文件夹落在集合行上 = 落到该集合根层，不会变成集合。
                          moveFolder(c.name, null, undefined, false)
                        } else {
                          moveRequest(c.name, null, undefined, false)
                        }
                        finishDrag()
                      }}
                    >
                      <span
                        className="cursor-grab select-none text-base-content/25 active:cursor-grabbing"
                        draggable
                        title="拖动集合排序"
                        onDragStart={(event) => {
                          event.stopPropagation()
                          event.dataTransfer.effectAllowed = 'move'
                          setDragPayload({ kind: 'collection', name: c.name })
                        }}
                        onDragEnd={finishDrag}
                      >
                        ⠿
                      </span>
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 py-1 text-left"
                        onClick={() => { setActiveSharedFolderShareId(null); setCurrentCollection(c.name); setCurrentPath(null) }}
                        title={`打开“${c.name}”`}
                      >
                        <span className="relative h-9 w-10 shrink-0"><svg viewBox="0 0 40 36" className="h-full w-full"><path fill="#9bd7bd" d="M2 8a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z"/><path fill="#c8eadb" d="M2 13h36v18a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z"/></svg></span>
                        <span className="min-w-0 flex-1 truncate whitespace-nowrap" title={c.name}>{c.name}</span>
                        {/* 报的是整个集合的请求总数，不是根层直接子项数：两栏布局里要靠这个数字
                            决定「打开哪个集合」，只数根层的话，请求都收在文件夹里的集合会显示 (0)。 */}
                        <span className="shrink-0 text-base-content/30">({collectionRequestCount(savedRequests, c.name)})</span>
                      </button>
                      <RowMenuTrigger
                        open={openMenuId === collectionMenuKey(c.name)}
                        onClick={(event) => { event.stopPropagation(); rowMenu.toggle(collectionMenuKey(c.name), event.currentTarget) }}
                        label={`${c.name}操作`}
                      />
                      {openMenuId === collectionMenuKey(c.name) && menuAnchor ? <RowMenuPopover anchor={menuAnchor} panelRef={rowMenuRef}>
                        <MenuAction icon={menuIcons.folderPlus} label="新建请求" onClick={() => { closeRowMenu(); startNewRequest(c.name) }} />
                        <MenuAction icon={menuIcons.folderPlus} label="新建文件夹" onClick={() => { closeRowMenu(); openCollectionDialog('createFolder', '', c.name, null) }} />
                        <MenuAction icon={menuIcons.edit} label="重命名集合" onClick={() => { closeRowMenu(); openCollectionDialog('rename', c.name) }} />
                        <MenuAction icon={menuIcons.trash} label="删除集合" tone="danger" onClick={() => { closeRowMenu(); openDeleteCollection(c.name) }} />
                      </RowMenuPopover> : null}
                    </div>
                  )
                })}
                {!isAdminUser && (incomingFolderShares.length > 0 || folderShareError) && (
                  <div className="mt-3 border-t border-base-200 pt-2">
                    <div className="px-2 pb-1 text-[10px] font-semibold tracking-wide text-base-content/35">共享给我的</div>
                    {folderShareError && <p className="px-2 pb-1 text-[10px] text-error">{folderShareError}</p>}
                    {incomingFolderShares.map(share => (
                      <button
                        key={share.shareId}
                        type="button"
                        onClick={() => {
                          setActiveSharedFolderShareId(share.shareId)
                          setCurrentPath(share.rootPath || share.folderName)
                          setShowWelcome(false)
                        }}
                        className={`mb-1 flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                          activeSharedFolderShareId === share.shareId ? 'bg-primary/10 text-primary' : 'text-base-content/65 hover:bg-base-200/70'
                        }`}
                        title={`来自 ${share.ownerName} · ${share.folderName}`}
                      >
                        <span className="shrink-0 text-base-content/35">↗</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{share.folderName}</span>
                          <span className="block truncate text-[10px] text-base-content/40">{share.ownerName}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-base-content/30">{share.requests.length}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="border-t border-base-200 px-3 py-2">
                <button type="button" className="btn btn-ghost btn-block btn-sm" onClick={() => openCollectionDialog('create')} title="新建集合">+ 新建集合</button>
              </div>
            </div>

            {/* 两栏之间的拖拽手柄 */}
            <div
              className="hidden shrink-0 cursor-col-resize items-center justify-center bg-base-200/30 transition-colors hover:bg-base-200 lg:flex"
              style={{ width: PANE_HANDLE_WIDTH }}
              onMouseDown={onPaneDragStart}
            >
              <div className="h-8 w-0.5 rounded-full bg-base-content/20" />
            </div>

            {/* ===== 右栏：当前这一层 ===== */}
            <div className="flex min-w-0 flex-1 flex-col">
              {activeSharedFolder ? (
                <>
                  <div className="flex h-14 items-center gap-2 border-b border-base-200 px-3">
                    {browsePath !== activeSharedRootPath && (
                      <button
                        type="button"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-base-content/45 transition hover:bg-base-200 hover:text-base-content"
                        onClick={() => setCurrentPath(parentPathOf(browsePath))}
                        title="返回上一级"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                      </button>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {!browsePath || browsePath === activeSharedRootPath ? activeSharedFolder.folderName : leafNameOf(browsePath)}
                    </span>
                    <span className="shrink-0 rounded-full bg-base-200 px-2 py-1 text-[10px] text-base-content/55">
                      来自 {activeSharedFolder.ownerName} · {activeSharedFolder.editStatus === 'approved' ? '可编辑' : '只读'}
                    </span>
                    {activeSharedFolder.editStatus !== 'approved' && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        disabled={activeSharedFolder.editStatus === 'pending'}
                        onClick={() => void requestSharedFolderEdit(activeSharedFolder)}
                      >
                        {activeSharedFolder.editStatus === 'pending'
                          ? '编辑申请中'
                          : activeSharedFolder.editStatus === 'rejected' ? '重新申请编辑' : '申请编辑'}
                      </button>
                    )}
                    {activeSharedFolder.editStatus === 'approved' && <>
                      <button
                        type="button"
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition hover:bg-base-300/70 ${
                          openMenuId === newEntryMenuKey ? 'bg-base-300/70 text-base-content' : 'text-base-content/40'
                        }`}
                        aria-haspopup="menu"
                        aria-expanded={openMenuId === newEntryMenuKey}
                        aria-label="新建"
                        title="新建"
                        onClick={(event) => {
                          event.stopPropagation()
                          rowMenu.toggle(newEntryMenuKey, event.currentTarget)
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                      </button>
                      {openMenuId === newEntryMenuKey && menuAnchor ? (
                        <RowMenuPopover anchor={menuAnchor} panelRef={rowMenuRef}>
                          <MenuAction icon={menuIcons.folderPlus} label="新建请求" onClick={() => { closeRowMenu(); startNewSharedRequest() }} />
                          <MenuAction icon={menuIcons.folderPlus} label="新建文件夹" onClick={() => { closeRowMenu(); void createSharedSubfolder() }} />
                        </RowMenuPopover>
                      ) : null}
                    </>}
                  </div>
                  {browsePath && (
                    <div className="flex h-10 items-center gap-1 overflow-hidden border-b border-base-200 px-4 text-xs text-base-content/45">
                      <button
                        type="button"
                        className="shrink-0 hover:text-primary"
                        onClick={() => setCurrentPath(activeSharedRootPath)}
                      >
                        {activeSharedFolder.folderName}
                      </button>
                      {(browsePath && activeSharedRootPath && browsePath.startsWith(`${activeSharedRootPath}/`)
                        ? browsePath.slice(activeSharedRootPath.length).split('/').filter(Boolean)
                        : []).map((part, index, parts) => {
                        const path = `${activeSharedRootPath}/${parts.slice(0, index + 1).join('/')}`
                        return <span key={path} className="flex min-w-0 items-center gap-1">
                          <span className="shrink-0">/</span>
                          <button
                            type="button"
                            className={index === parts.length - 1 ? 'truncate font-medium text-base-content/70' : 'shrink-0 hover:text-primary'}
                            onClick={() => setCurrentPath(path)}
                          >{part}</button>
                        </span>
                      })}
                    </div>
                  )}
                  <div className="flex-1 overflow-y-auto p-2">
                    {!sharedVisibleFolders.length && !sharedVisibleRequests.length ? (
                      <div className="rounded-lg border border-dashed border-base-200 bg-base-200/40 p-3 text-[11px] text-base-content/40">该文件夹下暂无内容</div>
                    ) : (
                      <>
                        {sharedVisibleFolders.map(folder => {
                          const menuKey = sharedFolderMenuKey(activeSharedFolder.shareId, folder.id)
                          const path = folderPath(folder)
                          const total = childCount(activeSharedFolder.folders, activeSharedFolder.requests, folder.collection, path)
                          return (
                            <div
                              key={menuKey}
                              className={`group flex min-w-0 flex-nowrap items-center gap-1 whitespace-nowrap rounded-lg py-1 pr-2 text-sm tracking-wider text-base-content/40 transition-colors hover:bg-base-200/70 ${
                                openMenuId === menuKey ? 'bg-base-200/70' : ''
                              }`}
                            >
                              <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left"
                                onClick={() => setCurrentPath(path)}
                                title={`进入“${folder.name}”`}
                              >
                                <span className="relative h-9 w-10 shrink-0"><svg viewBox="0 0 40 36" className="h-full w-full"><path fill="#9bd7bd" d="M2 8a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z"/><path fill="#c8eadb" d="M2 13h36v18a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z"/></svg></span>
                                <span className="min-w-0 flex-1 truncate whitespace-nowrap text-base-content/60" title={path}>{folder.name}</span>
                                <span className="shrink-0 text-base-content/20">({total})</span>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0 text-base-content/25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 6 15 12 9 18" /></svg>
                              </button>
                              {activeSharedFolder.editStatus === 'approved' && <>
                                <div className="mr-1">
                                  <RowMenuTrigger
                                    open={openMenuId === menuKey}
                                    onClick={(event) => { event.stopPropagation(); rowMenu.toggle(menuKey, event.currentTarget) }}
                                    label={`${folder.name}操作`}
                                  />
                                </div>
                                {openMenuId === menuKey && menuAnchor ? (
                                  <RowMenuPopover anchor={menuAnchor} panelRef={rowMenuRef} onClick={(event) => event.stopPropagation()}>
                                    <MenuAction icon={menuIcons.environment} label="环境配置" onClick={() => { closeRowMenu(); openFolderBaseUrlDialog(folder, activeSharedFolder.shareId) }} />
                                    <MenuAction icon={menuIcons.edit} label="重命名" onClick={() => { closeRowMenu(); void renameSharedSubfolder(folder) }} />
                                    <MenuAction icon={menuIcons.trash} label="删除" tone="danger" onClick={() => { closeRowMenu(); void deleteSharedSubfolder(folder) }} />
                                  </RowMenuPopover>
                                ) : null}
                              </>}
                            </div>
                          )
                        })}
                        {sharedVisibleRequests.map(request => {
                          const menuKey = sharedRequestMenuKey(activeSharedFolder.shareId, request.id)
                          return (
                            <div
                              key={menuKey}
                              className={`group flex items-center gap-2 rounded-lg py-2 pr-2.5 text-left text-sm transition-colors hover:bg-base-200 ${
                                openMenuId === menuKey ? 'bg-base-200' : ''
                              }`}
                              onClick={() => loadSharedRequest(request)}
                            >
                              <span className={`w-10 shrink-0 font-mono text-[10px] font-bold ${methodColors[request.method as HttpMethod]}`}>
                                {request.method}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-base-content">{request.label}</div>
                                <div className="truncate text-[10px] text-base-content/30">{request.url}</div>
                              </div>
                              {request.concurrentSummary ? (
                                <div className="mr-0.5 flex shrink-0 items-center gap-1 text-[10px]">
                                  <span className="text-green-600">{request.concurrentSummary.success}✓</span>
                                  {request.concurrentSummary.failed > 0 && <span className="text-red-500">{request.concurrentSummary.failed}✗</span>}
                                </div>
                              ) : request.lastResponse ? (
                                <div className={`mr-0.5 shrink-0 text-[10px] font-bold ${
                                  request.lastResponse.status >= 400 ? 'text-red-500' : request.lastResponse.status >= 300 ? 'text-amber-500' : 'text-green-600'
                                }`}>
                                  {request.lastResponse.status}
                                </div>
                              ) : null}
                              {activeSharedFolder.editStatus === 'approved' && <>
                                <RowMenuTrigger
                                  open={openMenuId === menuKey}
                                  onClick={(event) => { event.stopPropagation(); rowMenu.toggle(menuKey, event.currentTarget) }}
                                  label={`${request.label}操作`}
                                />
                                {openMenuId === menuKey && menuAnchor ? (
                                  <RowMenuPopover anchor={menuAnchor} panelRef={rowMenuRef} onClick={(event) => event.stopPropagation()}>
                                    <MenuAction icon={menuIcons.edit} label="重命名" onClick={() => { closeRowMenu(); void renameSharedRequest(request) }} />
                                    <MenuAction icon={menuIcons.trash} label="删除" tone="danger" onClick={() => { closeRowMenu(); void deleteSharedRequest(request) }} />
                                  </RowMenuPopover>
                                ) : null}
                              </>}
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
              <div className="flex h-14 items-center gap-1 border-b border-base-200 px-3">
                {browsePath && (
                  <button
                    type="button"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-base-content/45 transition hover:bg-base-200 hover:text-base-content"
                    onClick={() => setCurrentPath(parentPathOf(browsePath))}
                    title="返回上一级"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                  </button>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={browsePath ?? currentCollection}>
                  {browsePath ? leafNameOf(browsePath) : currentCollection}
                </span>
                {/* 「+」落在当前这一层。用 rowMenu 那套 openMenuId 而不是另起一个 state：
                    同一时刻只该有一个浮层开着，共用一个 id 就自然互斥了。 */}
                <button
                  type="button"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition hover:bg-base-300/70 ${
                    openMenuId === newEntryMenuKey ? 'bg-base-300/70 text-base-content' : 'text-base-content/40'
                  }`}
                  aria-haspopup="menu"
                  aria-expanded={openMenuId === newEntryMenuKey}
                  aria-label="新建"
                  title="新建"
                  onClick={(event) => { event.stopPropagation(); rowMenu.toggle(newEntryMenuKey, event.currentTarget) }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                </button>
                {openMenuId === newEntryMenuKey && menuAnchor ? <RowMenuPopover anchor={menuAnchor} panelRef={rowMenuRef}>
                  <MenuAction icon={menuIcons.folderPlus} label="新建请求" onClick={() => { closeRowMenu(); startNewRequest(currentCollection, browsePath) }} />
                  <MenuAction icon={menuIcons.folderPlus} label="新建文件夹" onClick={() => { closeRowMenu(); openCollectionDialog('createFolder', '', currentCollection, browsePath) }} />
                </RowMenuPopover> : null}
              </div>

              {/* 面包屑只在钻进去之后才有：根层再写一行「全部内容」是白占高度。 */}
              {browsePath && (
                <div className="flex h-10 items-center gap-1 overflow-hidden border-b border-base-200 px-4 text-xs text-base-content/45">
                  {breadcrumbs.map((crumb, index) => (
                    <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
                      {index > 0 && <span className="shrink-0">/</span>}
                      <button
                        type="button"
                        className={index === breadcrumbs.length - 1 ? 'truncate font-medium text-base-content/70' : 'shrink-0 hover:text-primary'}
                        onClick={() => setCurrentPath(crumb.path)}
                      >
                        {crumb.label}
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-2">
                {visibleFolders.length === 0 && visibleRequests.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-base-200 bg-base-200/40 p-3 text-[11px] text-base-content/40">
                    {browsePath ? '当前文件夹暂无内容' : '当前集合暂无请求'}
                  </div>
                ) : (
                  <>
                    {visibleFolders.map(folder => renderFolderRow(folder))}
                    {visibleRequests.map(request => renderRequestRow(request))}
                  </>
                )}
              </div>
                </>
              )}
            </div>
          </aside>
          {/* 侧边栏拖拽手柄 */}
          <div
            className="hidden lg:flex shrink-0 w-2 cursor-col-resize items-center justify-center bg-base-200/30 hover:bg-base-200 transition-colors"
            onMouseDown={onSidebarDragStart}
          >
            <div className="h-8 w-0.5 rounded-full bg-base-content/20" />
          </div>
      </>

      {/* ========== 主区域 ========== */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {showWelcome ? (
          <div className="relative flex h-full overflow-y-auto bg-linear-to-br from-base-100 via-base-100 to-primary/5 p-5 sm:p-8">
            <div className="mx-auto flex w-full max-w-4xl flex-col justify-center py-10">
              <div className="mb-10 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 9l3 3-3 3"/><path d="M13 15h3"/><rect x="3" y="4" width="18" height="16" rx="2"/></svg>
                </div>
                <h2 className="text-2xl font-bold">开始调试 API</h2>
                <p className="mx-auto mt-2 whitespace-nowrap text-[11px] leading-6 text-base-content/50 sm:text-sm">
                  创建一个新请求，或从最近保存的配置继续工作。请求参数和响应结果会自动保留。
                </p>
                <button
                  className="group relative mx-auto mt-7 flex w-full max-w-md items-center gap-5 overflow-hidden rounded-2xl bg-linear-to-r from-primary to-primary/80 px-6 py-5 text-left text-primary-content shadow-lg shadow-primary/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/30 active:translate-y-0"
                  onClick={() => startNewRequest(currentCollection, browsePath)}
                >
                  <span className="absolute -right-8 -top-12 h-32 w-32 rounded-full bg-white/10 transition-transform duration-300 group-hover:scale-125" />
                  <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                  </span>
                  <span className="relative min-w-0 flex-1">
                    <span className="block text-base font-semibold tracking-wide">新建 API 请求</span>
                    <span className="mt-1 block text-xs text-primary-content/70">配置地址、参数和请求体，立即开始调试</span>
                  </span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="relative h-5 w-5 shrink-0 transition-transform group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-base-200 bg-base-100/80 p-4 shadow-sm">
                  <div className="text-2xl font-semibold">{savedRequests.length}</div>
                  <div className="mt-1 text-xs text-base-content/45">已保存请求</div>
                </div>
                <div className="rounded-xl border border-base-200 bg-base-100/80 p-4 shadow-sm">
                  <div className="text-2xl font-semibold">{collections.length}</div>
                  <div className="mt-1 text-xs text-base-content/45">请求集合</div>
                </div>
                <div className="rounded-xl border border-base-200 bg-base-100/80 p-4 shadow-sm">
                  <div className="text-2xl font-semibold">{savedRequests.filter(request => request.lastResponse).length}</div>
                  <div className="mt-1 text-xs text-base-content/45">已有响应记录</div>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-base-200 bg-base-100/90 p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">最近请求</h3>
                  <span className="text-[11px] text-base-content/35">点击即可继续调试</span>
                </div>
                {savedRequests.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {savedRequests.slice(0, 6).map(request => (
                      <button
                        key={request.id}
                        className="group flex min-w-0 items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-left transition-colors hover:border-primary/20 hover:bg-primary/5"
                        onClick={() => loadRequest(request)}
                      >
                        <span className={`w-11 shrink-0 font-mono text-[10px] font-bold ${methodColors[request.method as HttpMethod]}`}>
                          {request.method}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{request.label}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-base-content/35">{request.url || '尚未填写 URL'}</span>
                        </span>
                        <span className="text-base-content/20 transition-transform group-hover:translate-x-0.5 group-hover:text-primary">→</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-base-200 py-8 text-center text-xs text-base-content/35">
                    暂无保存的请求，点击“新建请求”开始
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
        <>
        {/* ===== 工具栏 ===== */}
        {sharedRequestMode && (
          <div className="border-b border-primary/15 bg-primary/5 px-4 py-2 text-xs text-primary/80">
            {activeSharedFolder?.editStatus === 'approved'
              ? '你已获得编辑权限；保存将更新共享请求，发送后的响应也会同步保存。'
              : '正在调试共享请求；修改仅作用于当前会话，不会改动共享内容。可使用“复制到我的请求”另存。'}
          </div>
        )}
        {draftSource ? (() => {
          const relative = Boolean(url.trim()) && !/^https?:\/\//i.test(url.trim())
          const needsAuth = (auth.type === 'bearer' && !auth.token.trim())
            || (auth.type === 'basic' && (!auth.username.trim() || !auth.password.trim()))
            || (auth.type === 'apiKey' && !auth.apiValue.trim())
          const warnings = [
            relative && !currentFolderBaseUrl ? '相对路径需配置 Base URL' : '',
            needsAuth ? '请补全认证信息' : '',
            ...draftSource.notices,
          ].filter(Boolean)
          return (
            <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2 text-xs">
              <span className="font-medium text-primary">来自知识库问答</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${draftSource.confidence === 'full' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                {draftSource.confidence === 'full' ? '完整请求' : '仅方法/路径'}
              </span>
              <span className="rounded bg-base-100 px-1.5 py-0.5 text-[10px] text-base-content/50">{currentSavedId ? '已保存' : '未保存草稿'}</span>
              {draftSource.origin.question ? (
                <span className="min-w-0 max-w-md truncate text-base-content/50" title={draftSource.origin.question}>「{draftSource.origin.question}」</span>
              ) : null}
              {draftSource.origin.citationIds.length ? <span className="text-base-content/40">引用 {draftSource.origin.citationIds.length} 条</span> : null}
              {warnings.length ? <span className="text-amber-600" title={warnings.join('；')}>{warnings[0]}</span> : null}
              <button
                type="button"
                className="ml-auto rounded px-2 py-1 text-base-content/45 transition hover:bg-base-200 hover:text-base-content"
                onClick={() => setDraftSource(null)}
              >
                关闭
              </button>
            </div>
          )
        })() : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-base-200 bg-base-100 px-4 py-3">
          <select
            className={`select select-sm w-48 shrink-0 border font-bold text-xs ${methodSelectBg[method]}`}
            value={method}
            onChange={(e) => setMethod(e.target.value as HttpMethod)}
          >
            <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
          </select>

          <input
            type="text"
            className="input input-bordered input-sm min-w-0 flex-1 text-xs"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={currentFolderBaseUrl ? '接口路径，如 /v1/chat/completions' : 'https://api.example.com/v1/...'}
            title={currentFolderBaseUrl ? `Base URL: ${currentFolderBaseUrl}` : undefined}
          />


          {/* 保存按钮 */}
          <button
            className="btn btn-ghost btn-sm gap-1.5 text-base-content/60"
            onClick={() => {
              if (sharedRequestMode && activeSharedFolder?.editStatus === 'approved') {
                void persistSharedRequest()
                return
              }
              if (currentSavedId) {
                quickSave()
                return
              }
              const saved = currentSavedId
                ? savedRequests.find(request => request.id === currentSavedId)
                : null
              setSaveLabel(saved?.label || url.split('/').pop()?.split('?')[0]?.split('.')[0] || '未命名')
              setSaveCollection(saved?.collection || currentCollection)
              setSaveParent(saved ? normParent(saved.parent) : sharedRequestMode ? null : currentPath)
              setShowSaveModal(true)
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /></svg>
            {sharedRequestMode && activeSharedFolder?.editStatus === 'approved'
              ? '保存共享请求'
              : sharedRequestMode ? '复制到我的请求' : '保存'}
          </button>

          {/* 并发切换 */}
          <button
            className={`btn btn-sm gap-1.5 ${concurrentMode ? 'btn-outline btn-warning' : 'btn-ghost text-base-content/60'}`}
            onClick={() => setConcurrentMode(!concurrentMode)}
            title="并发测试"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /><path d="M16 14a8 8 0 1 0-16 0" /></svg>
            并发
          </button>

          {/* 并发参数 */}
          {concurrentMode && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
              <span className="text-base-content/40">发送速率</span>
              <input
                type="number"
                className="input input-bordered input-xs w-14 text-center"
                value={concurrentCount}
                min={1} max={1000}
                onChange={(e) => setConcurrentCount(Number(e.target.value) || 1)}
              />
              <span className="text-base-content/40">Requests/s · 持续</span>
              <input
                type="number"
                className="input input-bordered input-xs w-14 text-center"
                value={concurrentDuration}
                min={1} max={300}
                onChange={(e) => setConcurrentDuration(Number(e.target.value) || 1)}
              />
              <span className="text-base-content/40">秒 · 超时</span>
              <input
                type="number"
                className="input input-bordered input-xs w-14 text-center"
                value={requestTimeout}
                min={1} max={300}
                onChange={(e) => setRequestTimeout(Number(e.target.value) || 600)}
              />
              <span className="text-base-content/40">秒</span>
            </div>
          )}

          <div className="divider divider-horizontal mx-0 h-6" />

          <button
            className={`btn btn-primary btn-sm gap-1.5 ${sending ? 'btn-disabled' : ''}`}
            onClick={() => concurrentMode ? handleConcurrentSend() : handleSend()}
            disabled={sending}
          >
            {sending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            )}
            {sending ? '发送中...' : concurrentMode ? `QPS ${concurrentCount} · ${concurrentCount * concurrentDuration} 次` : '发送'}
          </button>
          {sending && (
            <button
              type="button"
              className="btn btn-ghost btn-sm text-error gap-1.5"
              onClick={cancelSend}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              取消
            </button>
          )}
        </div>

        {/* ===== 请求配置 Tab ===== */}
        <div className="border-b border-base-200 bg-base-100">
          <div className="flex items-center px-4">
            {(['params', 'auth', 'headers', 'body'] as const).map((tab) => (
              <button key={tab}
                className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
                  activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-base-content/50 hover:text-base-content'
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'params' && 'Params'}
                {tab === 'auth' && 'Authorization'}
                {tab === 'headers' && 'Headers'}
                {tab === 'body' && 'Body'}
              </button>
            ))}
          </div>
        </div>

        {/* ===== 请求配置内容 ===== */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'headers' && (
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-base-content/50">
                  请求头 <span className="text-base-content/30">· {headers.filter(h => h.enabled).length} 项已启用</span>
                </span>
                <button className="btn btn-ghost btn-xs gap-1" onClick={addHeader}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  添加
                </button>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-2 px-2 text-[10px] font-medium uppercase tracking-wider text-base-content/30">
                  <span className="w-6" /><span className="w-1/3">KEY</span><span className="w-1/2">VALUE</span><span className="w-8" />
                </div>
                {headers.map((h, i) => (
                  <div key={i} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${h.enabled ? 'border-base-200' : 'border-dashed border-base-200 opacity-40'}`}>
                    <button className="btn btn-ghost btn-xs btn-square" onClick={() => toggleHeader(i)}>
                      {h.enabled
                        ? <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                        : <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-base-content/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                      }
                    </button>
                    <input type="text" className="input input-ghost input-xs min-w-0 w-1/3 text-xs" placeholder="Key" value={h.key} onChange={(e) => updateHeader(i, 'key', e.target.value)} />
                    <input type="text" className="input input-ghost input-xs min-w-0 w-1/2 text-xs" placeholder="Value" value={h.value} onChange={(e) => updateHeader(i, 'value', e.target.value)} />
                    <button className="btn btn-ghost btn-xs btn-square" onClick={() => removeHeader(i)}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-base-content/30 hover:text-error" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'body' && (
            <div className="flex h-full min-h-0 flex-col overflow-hidden p-4">
              <div className="mb-3 flex shrink-0 flex-wrap items-center gap-4 border-b border-base-200">
                {([
                  ['none', 'none'],
                  ['form-data', 'form-data'],
                  ['urlencoded', 'x-www-form-urlencoded'],
                  ['raw', 'raw'],
                  ['binary', 'binary'],
                  ['graphql', 'GraphQL'],
                ] as const).map(([mode, label]) => (
                  <label key={mode} className="flex cursor-pointer items-center gap-1.5 pb-2 text-xs">
                    <input
                      type="radio"
                      className="radio radio-primary radio-xs"
                      checked={bodyMode === mode}
                      onChange={() => setBodyMode(mode)}
                    />
                    <span className={bodyMode === mode ? 'font-medium text-primary' : 'text-base-content/60'}>
                      {label}
                    </span>
                  </label>
                ))}
              </div>

              {bodyMode === 'none' && (
                <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-base-300 text-sm text-base-content/35">
                  此请求不包含 Body
                </div>
              )}

              {(bodyMode === 'form-data' || bodyMode === 'urlencoded') && (
                <div className="overflow-hidden rounded-lg border border-base-300">
                  <div className="grid grid-cols-[36px_minmax(120px,1fr)_minmax(180px,2fr)_36px] gap-2 border-b border-base-300 bg-base-200/50 px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-base-content/40">
                    <span />
                    <span>Key</span>
                    <span>Value</span>
                    <span />
                  </div>
                  {bodyFields.map(field => (
                    <div
                      key={field.id}
                      className={`grid grid-cols-[36px_minmax(120px,1fr)_minmax(180px,2fr)_36px] items-center gap-2 border-b border-base-200 px-2 py-1.5 last:border-b-0 ${field.enabled ? '' : 'opacity-40'}`}
                    >
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs"
                        checked={field.enabled}
                        onChange={(event) => updateBodyField(field.id, { enabled: event.target.checked })}
                      />
                      <input
                        className="input input-ghost input-sm w-full text-xs"
                        placeholder="Key"
                        value={field.key}
                        onChange={(event) => updateBodyField(field.id, { key: event.target.value })}
                      />
                      <div className="flex min-w-0 items-center gap-2">
                        {bodyMode === 'form-data' && (
                          <select
                            className="select select-ghost select-xs w-20"
                            value={field.kind}
                            onChange={(event) => updateBodyField(field.id, {
                              kind: event.target.value as BodyField['kind'],
                            })}
                          >
                            <option value="text">Text</option>
                            <option value="file">File</option>
                          </select>
                        )}
                        {bodyMode === 'form-data' && field.kind === 'file' ? (
                          <label className="btn btn-ghost btn-sm min-w-0 flex-1 justify-start text-xs font-normal">
                            <span className="truncate">{field.fileName || '选择文件'}</span>
                            <input
                              type="file"
                              className="hidden"
                              onChange={(event) => void selectFieldFile(field.id, event.target.files?.[0])}
                            />
                          </label>
                        ) : (
                          <input
                            className="input input-ghost input-sm min-w-0 flex-1 text-xs"
                            placeholder="Value"
                            value={field.value}
                            onChange={(event) => updateBodyField(field.id, { value: event.target.value })}
                          />
                        )}
                      </div>
                      <button
                        className="btn btn-ghost btn-square btn-xs text-error"
                        onClick={() => setBodyFields(previous => previous.filter(item => item.id !== field.id))}
                        title="删除"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    className="btn btn-ghost btn-sm m-2 text-xs"
                    onClick={() => setBodyFields(previous => [...previous, createBodyField()])}
                  >
                    + 添加字段
                  </button>
                </div>
              )}

              {bodyMode === 'binary' && (
                <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-base-300">
                  <div className="text-sm font-medium">{binaryBody?.fileName || '选择要发送的二进制文件'}</div>
                  {binaryBody && (
                    <div className="text-xs text-base-content/45">
                      {binaryBody.mimeType} · {(binaryBody.size / 1024).toFixed(1)} KB
                    </div>
                  )}
                  <label className="btn btn-outline btn-sm">
                    选择文件
                    <input
                      type="file"
                      className="hidden"
                      onChange={(event) => void selectBinaryFile(event.target.files?.[0])}
                    />
                  </label>
                  {binaryBody && (
                    <button className="btn btn-ghost btn-xs text-error" onClick={() => setBinaryBody(null)}>
                      清除文件
                    </button>
                  )}
                </div>
              )}

              {bodyMode === 'graphql' && (
                <div className="grid min-h-64 gap-3 lg:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-base-content/60">QUERY</span>
                    <textarea
                      className="textarea textarea-bordered min-h-60 w-full resize-y font-mono text-sm"
                      value={graphqlQuery}
                      onChange={(event) => setGraphqlQuery(event.target.value)}
                      placeholder="query Example { ... }"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-base-content/60">GRAPHQL VARIABLES (JSON)</span>
                    <textarea
                      className="textarea textarea-bordered min-h-60 w-full resize-y font-mono text-sm"
                      value={graphqlVariables}
                      onChange={(event) => setGraphqlVariables(event.target.value)}
                      placeholder={'{\n  "id": "1"\n}'}
                    />
                  </label>
                </div>
              )}

              {bodyMode === 'raw' && (
              <div className="flex min-h-0 flex-1 flex-col">
              {/* 代码块头部 */}
              <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-base-300 bg-base-200/50 px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className="dropdown">
                    <button tabIndex={0} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${bodyTypeMeta[bodyType].badge}`}>
                      {bodyTypeMeta[bodyType].icon} {bodyTypeMeta[bodyType].label}
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                    </button>
                    <ul tabIndex={0} className="menu dropdown-content z-1 mt-1 w-36 rounded-box bg-base-100 p-1 shadow-lg">
                      {Object.entries(bodyTypeMeta).map(([key, meta]) => (
                        <li key={key}>
                          <button className={`text-xs ${bodyType === key ? 'font-bold' : ''}`} onClick={() => changeBodyType(key as typeof bodyType)}>
                            <span className={`inline-flex items-center gap-1 ${meta.color}`}>{meta.icon} {meta.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <span className="text-xs text-base-content/30">·</span>
                  <span className="text-xs text-base-content/50">{bodyTypeMeta[bodyType].mime}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button className="btn btn-ghost btn-xs" onClick={formatRawBody}>
                    格式化
                  </button>
                  <button className="btn btn-ghost btn-xs text-base-content/40 hover:text-base-content gap-1" onClick={() => setWrapBody(!wrapBody)} title={wrapBody ? '取消自动换行' : '自动换行'}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12H7" /><path d="M11 18l-4-4 4-4" /><path d="M21 6H3" /></svg>
                    {wrapBody ? '自动换行' : '横向滚动'}
                  </button>
                  <button className="btn btn-ghost btn-xs text-base-content/40 hover:text-base-content gap-1" onClick={() => {
                    navigator.clipboard.writeText(body)
                    showToast('✅ 已复制')
                  }}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    复制
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden rounded-b-lg border border-base-300 bg-base-100">
                <CodeMirror
                  className="h-full text-sm"
                  value={body}
                  height="100%"
                  placeholder={`输入 ${bodyTypeMeta[bodyType].label}...`}
                  extensions={rawEditorExtensions}
                  basicSetup={{
                    lineNumbers: true,
                    foldGutter: true,
                    highlightActiveLineGutter: true,
                    highlightActiveLine: true,
                    bracketMatching: true,
                    closeBrackets: true,
                    autocompletion: true,
                    indentOnInput: true,
                  }}
                  onChange={setBody}
                />
              </div>
          </div>
          )}
          </div>
          )}

          {activeTab === 'params' && (
            <div className="flex items-center justify-center h-32 text-xs text-base-content/30">
              URL 查询参数（将在 URL 中附加为 ?key=value）
            </div>
          )}

          {activeTab === 'auth' && (
            <div className="px-6 py-4">
              <div className="flex max-w-xl flex-col gap-4">
                <div className="flex items-center gap-6">
                  <label className="label w-20 shrink-0"><span className="label-text text-xs">认证类型</span></label>
                  <select
                    className="select select-bordered select-sm flex-1"
                    value={auth.type}
                    onChange={(event) => setAuth(previous => ({ ...previous, type: event.target.value as AuthType }))}
                  >
                    <option value="bearer">Bearer Token</option>
                    <option value="apiKey">API Key</option>
                    <option value="basic">Basic Auth</option>
                    <option value="none">No Auth</option>
                  </select>
                </div>
                {auth.type === 'bearer' && (
                  <div className="flex items-center gap-6">
                    <label className="label w-20 shrink-0"><span className="label-text text-xs">Token</span></label>
                    <input
                      type="password"
                      className="input input-bordered input-sm flex-1"
                      placeholder="输入 Bearer token"
                      value={auth.token}
                      onChange={(event) => setAuth(previous => ({ ...previous, token: event.target.value }))}
                    />
                  </div>
                )}
                {auth.type === 'apiKey' && (
                  <>
                    <div className="flex items-center gap-6">
                      <label className="label w-20 shrink-0"><span className="label-text text-xs">Key</span></label>
                      <input
                        className="input input-bordered input-sm flex-1"
                        placeholder="X-API-Key"
                        value={auth.apiKey}
                        onChange={(event) => setAuth(previous => ({ ...previous, apiKey: event.target.value }))}
                      />
                    </div>
                    <div className="flex items-center gap-6">
                      <label className="label w-20 shrink-0"><span className="label-text text-xs">Value</span></label>
                      <input
                        type="password"
                        className="input input-bordered input-sm flex-1"
                        placeholder="输入 API key"
                        value={auth.apiValue}
                        onChange={(event) => setAuth(previous => ({ ...previous, apiValue: event.target.value }))}
                      />
                    </div>
                    <div className="flex items-center gap-6">
                      <label className="label w-20 shrink-0"><span className="label-text text-xs">添加到</span></label>
                      <select
                        className="select select-bordered select-sm flex-1"
                        value={auth.apiAddTo}
                        onChange={(event) => setAuth(previous => ({ ...previous, apiAddTo: event.target.value as AuthConfig['apiAddTo'] }))}
                      >
                        <option value="header">Header</option>
                        <option value="query">Query Params</option>
                      </select>
                    </div>
                  </>
                )}
                {auth.type === 'basic' && (
                  <>
                    <div className="flex items-center gap-6">
                      <label className="label w-20 shrink-0"><span className="label-text text-xs">用户名</span></label>
                      <input className="input input-bordered input-sm flex-1" value={auth.username} onChange={(event) => setAuth(previous => ({ ...previous, username: event.target.value }))} />
                    </div>
                    <div className="flex items-center gap-6">
                      <label className="label w-20 shrink-0"><span className="label-text text-xs">密码</span></label>
                      <input type="password" className="input input-bordered input-sm flex-1" value={auth.password} onChange={(event) => setAuth(previous => ({ ...previous, password: event.target.value }))} />
                    </div>
                  </>
                )}
                <p className="text-xs text-base-content/40">认证信息会在发送请求时自动应用，也可以在 Headers 中手动覆盖。</p>
              </div>
            </div>
          )}
        </div>

        {/* ===== 拖拽手柄 ===== */}
        <div
          className="group flex h-3 shrink-0 cursor-row-resize items-center justify-center border-y border-base-200 bg-base-200/30 transition-colors hover:bg-primary/10"
          onMouseDown={onDragStart}
          title="上下拖动调整请求与响应区域高度"
        >
          <div className="h-1 w-10 rounded-full bg-base-content/20 transition-colors group-hover:bg-primary/50" />
        </div>

        {/* ===== 响应面板（常显，可拖拽调整高度） ===== */}
        <div className="flex min-h-40 shrink-0 flex-col bg-base-100" style={{ height: responseHeight }}>
          <div className="flex items-center justify-between gap-3 border-b border-base-200 px-4 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">
              {concurrentResults && (() => {
                const s = concurrentResults.filter(r => r.status >= 200 && r.status < 300).length
                const f = concurrentResults.filter(r => r.status === 0 || r.status >= 400).length
                return (
                  <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[11px] font-medium">
                    <span className="text-green-600">{s}✓</span>
                    {f > 0 && <span className="text-red-500">{f}✗</span>}
                    <span className="text-base-content/30">·</span>
                    <span className="text-base-content/40">{concurrentResults.length} 路</span>
                  </div>
                )
              })()}
              {response ? (
                <>
                  <div className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-bold ${response.status >= 400 ? 'text-red-500' : 'text-green-600'}`}>
                    <span>{response.status}</span>
                    <span className="text-xs font-normal">{response.statusText}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 whitespace-nowrap text-[11px] text-base-content/40">
                    <span>⏱ {response.time}</span>
                    <span>📦 {response.size}</span>
                  </div>
                </>
              ) : !concurrentResults ? (
                <div className="flex items-center gap-2 whitespace-nowrap text-xs text-base-content/30">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                  点击「发送」调试接口
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button className={`btn btn-ghost btn-xs ${activeResponseTab === 'body' ? 'btn-active' : ''}`} onClick={() => setActiveResponseTab('body')}>Body</button>
              <button className={`btn btn-ghost btn-xs ${activeResponseTab === 'headers' ? 'btn-active' : ''}`} onClick={() => setActiveResponseTab('headers')}>Headers</button>
              <button className={`btn btn-ghost btn-xs ${activeResponseTab === 'concurrent' ? 'btn-active' : ''} ${concurrentMode ? '' : 'opacity-30'}`} onClick={() => setActiveResponseTab('concurrent')}>
                📊 并发
              </button>
              {response ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs text-primary"
                  onClick={openResponseAnalysis}
                  disabled={analysisLoading}
                  title="AI 响应分析：解释/排查/生成测试"
                >
                  {analysisLoading ? '分析中…' : '🤖 AI 分析'}
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {activeResponseTab === 'concurrent' && concurrentResults ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3 text-[10px] text-base-content/30 font-medium uppercase tracking-wider px-1 pb-1 border-b border-base-200">
                  <span className="w-8 text-center">#</span>
                  <span className="w-16 text-center">状态</span>
                  <span className="w-20 text-center">耗时</span>
                  <span className="flex-1">响应耗时</span>
                  <span className="w-16 text-right">详情</span>
                </div>
                {concurrentResults.map((r) => (
                  <button
                    key={r.index}
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-3 rounded px-1 py-1.5 text-left text-xs transition-colors hover:bg-primary/5 focus:outline-none focus:ring-1 focus:ring-primary/30"
                    onClick={() => setSelectedConcurrentResult(r)}
                    title={`查看第 ${r.index} 条响应 Body`}
                  >
                    <span className="w-8 text-center text-base-content/40">{r.index}</span>
                    <span className={`w-16 text-center font-bold ${r.status === 0 ? 'text-red-500' : r.status >= 400 ? 'text-amber-500' : 'text-green-600'}`}>
                      {r.status || 'ERR'}
                    </span>
                    <span className="w-20 text-center text-base-content/60">{r.time}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-base-200 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${r.status === 0 ? 'bg-red-400' : r.status >= 400 ? 'bg-amber-400' : 'bg-green-400'}`}
                        style={{ width: `${Math.min(100, (parseFloat(r.time) / (parseFloat(concurrentResults[concurrentResults.length - 1]?.time || '1') || 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-[10px] text-primary">查看 Body</span>
                  </button>
                ))}
              </div>
            ) : response ? (
              activeResponseTab === 'concurrent' ? (
                <div className="flex h-full items-center justify-center text-xs text-base-content/20 gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /><path d="M16 14a8 8 0 1 0-16 0" /></svg>
                  <span>开启并发模式后点击「发送」查看并发结果</span>
                </div>
              ) : activeResponseTab === 'body' ? (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-base-200 bg-base-200/50 px-4 py-1.5 shrink-0">
                    <span className="text-xs text-base-content/50">{responseEditor.mime}</span>
                    <button className="btn btn-ghost btn-xs text-base-content/40 hover:text-base-content gap-1" onClick={() => {
                      navigator.clipboard.writeText(response.body)
                      showToast('✅ 已复制')
                    }}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      复制
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden rounded-b-lg border border-base-200 bg-base-100">
                    <CodeMirror
                      className="h-full text-xs"
                      value={response.body}
                      height="100%"
                      editable={false}
                      extensions={responseEditor.extensions}
                      basicSetup={{
                        lineNumbers: true,
                        foldGutter: true,
                        highlightActiveLineGutter: false,
                        highlightActiveLine: false,
                        bracketMatching: true,
                        closeBrackets: false,
                        autocompletion: false,
                        indentOnInput: false,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {Object.entries(response.headers).map(([k, v]) => (
                    <div key={k} className="flex gap-3 text-xs">
                      <span className="font-medium text-base-content/60 w-24 lg:w-40 shrink-0">{k}:</span>
                      <span className="text-base-content">{v}</span>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-xs text-base-content/20 gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                <span>暂无响应数据</span>
                <span className="text-[10px]">填写 URL 后点击「发送」开始调试</span>
              </div>
            )}
          </div>
        </div>
        </>
        )}
      </div>

      {/* ========== AI 响应分析 ========== */}
      {analysisDialogOpen && (
        <Dialog width="2xl" onClose={() => setAnalysisDialogOpen(false)}>
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-base-content/50">分析模式：</span>
              {[
                { id: 'explain', label: '解释响应' },
                { id: 'troubleshoot', label: '排查问题' },
                { id: 'tests', label: '生成测试' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    const nextMode = item.id as ApiResponseAnalysisMode
                    setAnalysisMode(nextMode)
                    setAnalysisError(null)
                    if (!analysisInput) {
                      setAnalysisResult(null)
                      return
                    }
                    const cached = analysisCacheRef.current.get(apiAnalysisCacheKey({ ...analysisInput, mode: nextMode }))
                    setAnalysisResult(cached || null)
                  }}
                  className={`btn btn-xs btn-ghost ${analysisMode === item.id ? 'btn-active text-primary' : 'text-base-content/60 hover:text-base-content'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="w-16 shrink-0 text-base-content/50">模型：</span>
              <select
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                className="select select-sm border text-xs shrink-0 w-48"
              >
                {modelsLoaded
                  ? models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.id}
                      </option>
                    ))
                  : <option>加载模型…</option>}
              </select>
            </div>
            {analysisError && (
              <div className="p-2 rounded border border-error/20 bg-error/5 text-error text-xs">
                {analysisError}
                <button
                  type="button"
                  onClick={() => void runResponseAnalysis()}
                  className="ml-2 btn btn-xs btn-error"
                >
                  重试
                </button>
              </div>
            )}
            {analysisLoading ? (
              <div className="h-24 flex items-center justify-center text-xs text-base-content/40">正在请求模型分析，请稍候…</div>
            ) : analysisResult ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-base-200 pr-1 pt-3 space-y-4">
                <div className="flex items-center gap-2 text-[10px] text-base-content/40">
                  <span>{analysisResult.model}</span>
                  {analysisResult.usage?.total_tokens != null && (
                    <span>· {analysisResult.usage.total_tokens} tokens</span>
                  )}
                </div>
                {renderAssistantBlocks(analysisResult.content)}
              </div>
            ) : (
              <div className="h-24 flex items-center justify-center text-xs text-base-content/30">完成一次发送后，点击响应区的「AI 分析」即可开始</div>
            )}
          </div>
          <div className="mt-6 flex shrink-0 justify-end gap-2">
            <button type="button" onClick={() => setAnalysisDialogOpen(false)} className="btn btn-ghost">
              关闭
            </button>
            {!analysisLoading && analysisInput && (
              <button
                type="button"
                onClick={() => {
                  setAnalysisResult(null)
                  setAnalysisError(null)
                  void runResponseAnalysis()
                }}
                className="btn btn-primary"
              >
                {analysisResult ? '重新分析' : '开始分析'}
              </button>
            )}
          </div>
        </Dialog>
      )}
      {/* ========== 单条并发响应详情 ========== */}
      {selectedConcurrentResult && (
        <Dialog width="2xl" onClose={() => setSelectedConcurrentResult(null)}>
          <DialogHeader
            title={<>并发请求 #{selectedConcurrentResult.index}<span className={`badge badge-sm ${
              selectedConcurrentResult.status === 0
                ? 'badge-error'
                : selectedConcurrentResult.status >= 400
                  ? 'badge-warning'
                  : 'badge-success'
            }`}>
              {selectedConcurrentResult.status || 'ERR'}
            </span></>}
            subtitle={`耗时 ${selectedConcurrentResult.time}`}
            // 复制是打开就想按的动作，跟着标题走；正文可能有几千行，放底部按钮区就得先滚到底。
            actions={<button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                void navigator.clipboard.writeText(selectedConcurrentResult.body || '')
                showToast('✅ Body 已复制')
              }}
            >
              复制 Body
            </button>}
            onClose={() => setSelectedConcurrentResult(null)}
          />
          <pre className="mt-4 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-base-200/30 p-4 font-mono text-xs leading-5 text-base-content">
            {selectedConcurrentResult.body || '该历史结果未保存单条响应 Body。请重新执行并发请求后查看。'}
          </pre>
        </Dialog>
      )}

      {shareDialogFolderId && (() => {
        const folder = folders.find(item => item.id === shareDialogFolderId)
        if (!folder) return null
        const entries = folderShares.filter(entry => entry.folderId === folder.id)
        const alreadySharedIds = new Set(entries.map(entry => entry.granteeUserId))
        const pickedCount = [...sharePicked].filter(id => !alreadySharedIds.has(id)).length
        const closeShareDialog = () => {
          setShareDialogFolderId(null)
          setShareError(null)
          setSharePicked(new Set())
        }
        return <Dialog onClose={closeShareDialog}>
          <DialogHeader
            title="文件夹共享管理"
            icon={menuIcons.link}
            subtitle={`“${folder.name}”及其全部子文件夹、请求将共享为只读；接收方可申请编辑权限`}
            onClose={closeShareDialog}
          />
          <div className="mt-3 rounded-lg border border-base-200 p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm">指定用户可见</span>
              <span className="text-xs text-base-content/45">已选择 {pickedCount} 人</span>
            </div>
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {shareCandidates.map(user => {
                const shared = alreadySharedIds.has(user.id)
                return <label key={user.id} className={`flex items-center gap-2 rounded px-1.5 py-1 text-sm ${shared ? 'opacity-45' : 'cursor-pointer hover:bg-base-200/70'}`}>
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={shared || sharePicked.has(user.id)}
                    disabled={shared || shareBusy}
                    onChange={() => setSharePicked(current => {
                      const next = new Set(current)
                      if (next.has(user.id)) next.delete(user.id)
                      else next.add(user.id)
                      return next
                    })}
                  />
                  <span className="truncate">{user.nickname}</span>
                  {user.nickname !== user.username && <span className="truncate text-xs text-base-content/40">@{user.username}</span>}
                  {shared && <span className="ml-auto shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">已共享</span>}
                </label>
              })}
              {!shareCandidates.length && <p className="px-1.5 py-2 text-xs text-base-content/35">暂无可共享的用户</p>}
            </div>
            {entries.length > 0 && <div className="mt-2 border-t border-base-200 pt-2">
              <p className="mb-1 text-xs text-base-content/45">已共享用户与编辑申请</p>
              <div className="max-h-28 space-y-0.5 overflow-y-auto">
                {entries.map(entry => <div key={entry.shareId} className="flex items-center gap-2 px-1.5 py-0.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{entry.granteeName}</span>
                  {entry.editStatus === 'pending' ? <>
                    <span className="shrink-0 text-[10px] text-warning">申请编辑</span>
                    <button type="button" onClick={() => void updateFolderEditAccess(entry.shareId, 'approved')} disabled={shareBusy} className="btn btn-ghost btn-xs text-success">批准</button>
                    <button type="button" onClick={() => void updateFolderEditAccess(entry.shareId, 'rejected')} disabled={shareBusy} className="btn btn-ghost btn-xs">拒绝</button>
                  </> : entry.editStatus === 'approved' ? <>
                    <span className="shrink-0 text-[10px] text-success">可编辑</span>
                    <button type="button" onClick={() => void updateFolderEditAccess(entry.shareId, 'none')} disabled={shareBusy} className="btn btn-ghost btn-xs text-warning">撤销编辑</button>
                  </> : entry.editStatus === 'rejected' ? <span className="shrink-0 text-[10px] text-base-content/40">已拒绝</span> : null}
                  <button type="button" onClick={() => void revokeFolderShare(entry)} disabled={shareBusy} className="btn btn-ghost btn-xs text-error">取消共享</button>
                </div>)}
              </div>
            </div>}
          </div>
          <DialogError>{shareError}</DialogError>
          <DialogActions>
            <button onClick={closeShareDialog} className="btn btn-ghost">关闭</button>
            <button onClick={() => void saveFolderShares()} disabled={shareBusy || !pickedCount} className="btn btn-primary">
              {shareBusy ? '保存中…' : `共享给所选${pickedCount ? `（${pickedCount} 人）` : ''}`}
            </button>
          </DialogActions>
        </Dialog>
      })()}

      {/* ========== 删除请求确认 ========== */}
      {deleteTarget && (() => {
        const target = savedRequests.find(item => item.id === deleteTarget)
        return <Dialog onClose={() => setDeleteTarget(null)}>
          <DialogHeader
            title="删除请求"
            icon={<span className="text-error">{menuIcons.trash}</span>}
            // 原来这里不说删的是哪一条，标题只写「确认删除」，看不出点岔了没有。
            subtitle={<>确定删除“{target?.label || '该请求'}”吗？删除后无法恢复。</>}
            onClose={() => setDeleteTarget(null)}
          />
          <DialogActions>
            <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>取消</button>
            <button className="btn btn-error" onClick={confirmDelete}>删除</button>
          </DialogActions>
        </Dialog>
      })()}

      {/* ========== 首次保存 ========== */}
      {showSaveModal && (
        <Dialog onClose={() => setShowSaveModal(false)}>
          <DialogHeader
            title={sharedRequestMode ? '复制到我的请求' : '保存配置'}
            icon={menuIcons.save}
            subtitle={sharedRequestMode ? '另存到自己的集合，不会改动共享内容' : '设置请求名称并选择保存合集'}
            onClose={() => setShowSaveModal(false)}
          />
          <DialogField label="请求名称" required>
            <input
              type="text"
              className={`input input-bordered mt-1.5 w-full ${saveLabelDuplicated ? 'input-error' : ''}`}
              placeholder="输入请求名称..."
              value={saveLabel}
              onChange={(e) => setSaveLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmFirstSave()}
              autoFocus
            />
          </DialogField>
          <DialogError>{saveLabelDuplicated ? '当前位置已存在同名条目，请使用其他名称' : ''}</DialogError>
          <DialogField label="保存合集">
            <select
              className="select select-bordered mt-1.5 w-full"
              value={saveCollection}
              onChange={(e) => {
                setSaveCollection(e.target.value)
                // 路径只在所属集合内成立，换集合就失效了——留着会写进一个渲染不出来的 parent。
                setSaveParent(null)
              }}
            >
              {collections.map(collection => (
                <option key={collection.name} value={collection.name}>
                  {collection.icon} {collection.name}
                </option>
              ))}
            </select>
          </DialogField>
          <DialogField label="保存到文件夹">
            <select
              className="select select-bordered mt-1.5 w-full"
              value={saveParent ?? ''}
              onChange={(e) => setSaveParent(e.target.value || null)}
            >
              <option value="">（集合根目录）</option>
              {saveFolderOptions.map(folder => (
                <option key={folder.path} value={folder.path}>{folder.label}</option>
              ))}
            </select>
          </DialogField>
          {currentSavedId && saveCollection !== currentCollection && (
            <p className="mt-2 text-xs leading-5 text-warning">保存后该请求将移动到“{saveCollection}”</p>
          )}
          <DialogActions>
            <button className="btn btn-ghost" onClick={() => setShowSaveModal(false)}>取消</button>
            <button className="btn btn-primary" disabled={!saveLabel.trim() || !saveCollection || saveLabelDuplicated} onClick={confirmFirstSave}>保存</button>
          </DialogActions>
        </Dialog>
      )}

      {/* ========== 重命名请求 ========== */}
      {renamingId && (() => {
        const target = savedRequests.find(item => item.id === renamingId)
        const closeRename = () => { setRenamingId(null); setRenameError('') }
        return <Dialog onClose={closeRename}>
          <DialogHeader
            title="重命名请求"
            icon={menuIcons.edit}
            subtitle={<span className="block truncate" title={target?.label}>“{target?.label}” · 修改请求名称</span>}
            onClose={closeRename}
          />
          <DialogField label="新名称" required>
            <input
              type="text"
              className={`input input-bordered mt-1.5 w-full ${renameError ? 'input-error' : ''}`}
              placeholder="输入新名称..."
              value={renameLabel}
              onChange={(e) => { setRenameLabel(e.target.value); setRenameError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') closeRename() }}
              autoFocus
            />
          </DialogField>
          <DialogError>{renameError}</DialogError>
          <DialogActions>
            <button className="btn btn-ghost" onClick={closeRename}>取消</button>
            <button className="btn btn-primary" disabled={!renameLabel.trim() || renameLabel.trim() === target?.label} onClick={confirmRename}>保存</button>
          </DialogActions>
        </Dialog>
      })()}

      {baseUrlDialog && (() => {
        const sharedFolder = baseUrlDialog.shareId == null
          ? null
          : incomingFolderShares.find(share => share.shareId === baseUrlDialog.shareId) || null
        const folder = baseUrlDialog.shareId == null
          ? folders.find(item => item.id === baseUrlDialog.folderId)
          : sharedFolder?.folders.find(item => item.id === baseUrlDialog.folderId)
        const closeDialog = () => {
          setBaseUrlDialog(null)
          setBaseUrlError('')
        }
        if (!folder) return null
        return <Dialog onClose={closeDialog}>
          <DialogHeader
            title="环境配置（Base URL）"
            icon={menuIcons.environment}
            subtitle={`“${folder.name}”及其下级请求将使用此地址；子文件夹可单独设置并覆盖`}
            onClose={closeDialog}
          />
          <DialogField label="Base URL">
            <input
              type="url"
              className={`input input-bordered mt-1.5 w-full ${baseUrlError ? 'input-error' : ''}`}
              placeholder="https://api.example.com"
              value={baseUrlDraft}
              onChange={(event) => { setBaseUrlDraft(event.target.value); setBaseUrlError('') }}
              onKeyDown={(event) => { if (event.key === 'Enter') void saveFolderBaseUrl(); if (event.key === 'Escape') closeDialog() }}
              autoFocus
            />
          </DialogField>
          <p className="mt-2 text-xs leading-5 text-base-content/45">
            可留空以清除配置。设置后，请求输入框填写接口路径即可，例如 <code>/v1/users</code>；完整 URL 请求仍按原地址发送。
          </p>
          <DialogError>{baseUrlError}</DialogError>
          <DialogActions>
            <button className="btn btn-ghost" onClick={closeDialog}>取消</button>
            <button className="btn btn-primary" onClick={() => void saveFolderBaseUrl()}>保存</button>
          </DialogActions>
        </Dialog>
      })()}

      {/* ========== 新建 / 重命名集合 ========== */}
      {collectionDialog && (() => {
        const isFolderMode = collectionDialog.mode === 'createFolder' || collectionDialog.mode === 'renameFolder'
        const isCreate = collectionDialog.mode === 'create' || collectionDialog.mode === 'createFolder'
        const noun = isFolderMode ? '文件夹' : '集合'
        const where = collectionDialog.parent
          ? `“${collectionDialog.collection} / ${collectionDialog.parent.split('/').join(' / ')}”下`
          : `“${collectionDialog.collection}”下`
        return <Dialog onClose={closeCollectionDialog}>
          <DialogHeader
            title={`${isCreate ? '新建' : '重命名'}${noun}`}
            icon={isCreate ? menuIcons.folderPlus : menuIcons.edit}
            subtitle={isCreate
              ? (isFolderMode ? `在${where}建一个文件夹，可以继续往下嵌套` : '集合用来归类保存的请求')
              : `把“${collectionDialog.original}”改成新名称，${isFolderMode ? '里面的请求和子文件夹会一并跟着走' : '集合里的请求会一并跟着走'}`}
            onClose={closeCollectionDialog}
          />
          <DialogField label={`${noun}名称`} required>
            <input
              type="text"
              className={`input input-bordered mt-1.5 w-full ${collectionNameError ? 'input-error' : ''}`}
              placeholder={`请输入${noun}名称`}
              value={collectionName}
              onChange={(e) => { setCollectionName(e.target.value); setCollectionNameError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') submitCollectionDialog(); if (e.key === 'Escape') closeCollectionDialog() }}
              autoFocus
            />
          </DialogField>
          <DialogError>{collectionNameError}</DialogError>
          <DialogActions>
            <button className="btn btn-ghost" onClick={closeCollectionDialog}>取消</button>
            <button
              className="btn btn-primary"
              disabled={!collectionName.trim() || (!isCreate && collectionName.trim() === collectionDialog.original)}
              onClick={submitCollectionDialog}
            >{isCreate ? '创建' : '保存'}</button>
          </DialogActions>
        </Dialog>
      })()}

      {/* ========== 删除文件夹确认 ========== */}
      {deletingFolder && (() => {
        const folder = folders.find(f => f.id === deletingFolder)
        if (!folder) return null
        const path = folderPath(folder)
        const count = requestsInSubtree(savedRequests, folder.collection, path).length
        const subCount = folderIdsInSubtree(folders, folder.collection, path).length - 1
        return <Dialog onClose={() => setDeletingFolder(null)}>
          <DialogHeader
            title="删除文件夹"
            icon={<span className="text-error">{menuIcons.trash}</span>}
            subtitle={count + subCount > 0
              ? `文件夹“${folder.name}”包含 ${subCount} 个子文件夹和 ${count} 条请求，删除后这些内容也会被永久删除，且无法恢复。`
              : `确定删除空文件夹“${folder.name}”吗？此操作无法恢复。`}
            onClose={() => setDeletingFolder(null)}
          />
          <DialogActions>
            <button className="btn btn-ghost" onClick={() => setDeletingFolder(null)}>取消</button>
            <button className="btn btn-error" onClick={confirmDeleteFolder}>删除</button>
          </DialogActions>
        </Dialog>
      })()}

      {/* ========== 移动到 ========== */}
      {movingNode && (() => {
        const isFolder = movingNode.kind === 'folder'
        const folder = isFolder ? folders.find(f => f.id === movingNode.id) : undefined
        const request = isFolder ? undefined : savedRequests.find(r => r.id === movingNode.id)
        const name = folder?.name ?? request?.label ?? ''
        const blocked = moveBlockedReason()
        const crumbs = moveBreadcrumb(moveTargetCollection, moveTargetPath)
        const subfolders = moveSubfolders(moveTargetCollection, moveTargetPath)
        const requestCount = descendantRequestCount()
        return <Dialog width="2xl" onClose={closeMoveDialog}>
          <DialogHeader
            title={`移动${isFolder ? '文件夹' : '请求'}`}
            icon={menuIcons.move}
            subtitle={`把“${name}”移动到其他位置`}
            onClose={closeMoveDialog}
          />
          {/* 左选集合、右下钻文件夹。容器高度必须是固定值：弹窗只有 max-h 没有确定高度，
              用 flex-1 会塌成 0——里面的 overflow-y-auto 撑不起来。 */}
          <div className="mt-4 flex gap-3">
            <div className="w-52 shrink-0 overflow-y-auto rounded-xl border border-base-200 bg-base-200/30 p-1.5" style={{ height: '20rem', maxHeight: '50vh' }}>
              {collections.map(collection => {
                const active = collection.name === moveTargetCollection
                return (
                  <button
                    key={collection.name}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${active ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-base-200'}`}
                    onClick={() => { setMoveTargetCollection(collection.name); setMoveTargetPath(null) }}
                  >
                    <span className="shrink-0">{collection.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{collection.name}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-base-200">
              {/* 面包屑首段是集合名。每段都可点，点它就回到那一层。 */}
              <div className="flex flex-wrap items-center gap-1 border-b border-base-200 bg-base-200/30 px-2.5 py-2 text-[11px]">
                {crumbs.map((crumb, index) => (
                  <span key={`${crumb.path ?? 'root'}-${index}`} className="flex items-center gap-1">
                    {index > 0 && <span className="text-base-content/30">/</span>}
                    <button
                      type="button"
                      className={`rounded px-1 py-0.5 transition-colors ${index === crumbs.length - 1 ? 'font-semibold text-base-content' : 'text-base-content/60 hover:bg-base-200'}`}
                      onClick={() => setMoveTargetPath(crumb.path)}
                    >{crumb.label}</button>
                  </span>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-1.5" style={{ height: '17.5rem', maxHeight: '42vh' }}>
                {subfolders.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-[11px] text-base-content/40">
                    该层级下没有子文件夹
                  </div>
                ) : subfolders.map(child => {
                  const childPath = folderPath(child)
                  // 被移动的文件夹自己的子树在右栏里就地置灰，点了也不走——
                  // 但真正的拦截在确认时，用户能从别处走进来。
                  const insideSelf = isFolder && folder
                    && child.collection === folder.collection
                    && isSelfOrDescendant(childPath, folderPath(folder))
                  return (
                    <button
                      key={child.id}
                      type="button"
                      disabled={!!insideSelf}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                        insideSelf ? 'cursor-not-allowed opacity-40' : 'hover:bg-base-200'
                      }`}
                      onClick={() => setMoveTargetPath(childPath)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0 text-base-content/35" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                      <span className="min-w-0 flex-1 truncate">{child.name}</span>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0 text-base-content/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          {/* 目标文案：只写集合名时就是集合根，不再缀「根目录」——前半句已经是集合名，
              重复一遍只是噪音；右侧面包屑首段用的是同一个名字，两处读起来一致。 */}
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-base-200/50 px-3 py-2 text-xs">
            <span className="min-w-0 flex-1 truncate">
              目标：<span className="text-base-content/80">{moveTargetCollection || '—'}</span>
              {moveTargetPath ? <span className="text-base-content/80"> / {moveTargetPath.split('/').join(' / ')}</span> : null}
            </span>
            {isFolder && <span className="shrink-0 text-base-content/50">{requestCount} 条请求随行</span>}
          </div>
          {/* 三条规则都在确认时判，所以错误也得显示在这里，而不是靠把选项藏起来。 */}
          <DialogError>{blocked && blocked !== '当前位置' ? blocked : ''}</DialogError>
          <DialogActions>
            <button className="btn btn-ghost" onClick={closeMoveDialog}>取消</button>
            <button className="btn btn-primary" disabled={!!blocked} onClick={confirmMove}>
              {blocked === '当前位置' ? '当前位置' : '移动'}
            </button>
          </DialogActions>
        </Dialog>
      })()}

      {/* ========== 删除集合确认 ========== */}
      {deletingCollection && (() => {
        const count = savedRequests.filter(r => r.collection === deletingCollection).length
        return <Dialog onClose={() => setDeletingCollection(null)}>
          <DialogHeader
            title="删除集合"
            icon={<span className="text-error">{menuIcons.trash}</span>}
            subtitle={count > 0
              ? `集合“${deletingCollection}”包含 ${count} 条请求，删除集合后这些请求也会被永久删除，且无法恢复。`
              : `确定删除空集合“${deletingCollection}”吗？此操作无法恢复。`}
            onClose={() => setDeletingCollection(null)}
          />
          <DialogActions>
            <button className="btn btn-ghost" onClick={() => setDeletingCollection(null)}>取消</button>
            <button className="btn btn-error" onClick={confirmDeleteCollection}>删除</button>
          </DialogActions>
        </Dialog>
      })()}
      </div>
    </div>
  )
}
