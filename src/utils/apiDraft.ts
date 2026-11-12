// 知识库问答 → API 测试的请求草稿通道。
// 解析优先级：```http 代码块 > ```curl/```bash 中的 curl > 紧邻的 ```json 请求体 > 文本里的 METHOD /path。
// 从 sessionStorage 读回时一律经过白名单校验，不信任任何外部内容。
import type { BodyMode, RawBodyType, RequestBodyConfig } from './requestBody'

export const DRAFT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export type DraftMethod = (typeof DRAFT_METHODS)[number]

export interface DraftAuth {
  type: 'bearer' | 'apiKey' | 'basic' | 'none'
  token: string
  apiKey: string
  apiValue: string
  apiAddTo: 'header' | 'query'
  username: string
  password: string
}

/** 回答的来源信息：用于 API 测试的来源条、日志和后续写回 SavedRequest。 */
export interface ApiDraftOrigin {
  libraryId: number
  conversationId?: string
  messageIndex: number
  question: string
  citationIds: number[]
}

export interface ApiRequestDraft {
  id: string
  method: DraftMethod
  url: string
  headers?: Array<{ key: string; value: string; enabled: boolean }>
  body?: string
  bodyConfig?: Partial<RequestBodyConfig>
  auth?: DraftAuth | null
  /** full = 解析出完整请求；method-path = 只识别出方法和路径 */
  confidence: 'full' | 'method-path'
  /** 解析时被清理或需要用户补全的提示，例如示例 Token 已移除。 */
  notices?: string[]
  origin: ApiDraftOrigin
  createdAt: string
}

/** 回答气泡里展示、点击后再补上来源信息的候选请求。 */
export type ApiDraftCandidate = Omit<ApiRequestDraft, 'id' | 'origin' | 'createdAt'>

type DraftHeader = { key: string; value: string; enabled: boolean }

type RawRequest = {
  method: DraftMethod
  url: string
  headers: DraftHeader[]
  body: string
  auth?: DraftAuth | null
  notes: string[]
}

type FenceBlock = { lang: string; content: string; start: number; end: number }

const STASH_KEY = 'zhiyu:api-request-draft'
const MAX_DRAFT_LENGTH = 256 * 1024
const MAX_URL_LENGTH = 8192
const MAX_BODY_LENGTH = 128 * 1024
const MAX_QUESTION_LENGTH = 500
const MAX_HEADER_COUNT = 64
const MAX_DRAFT_COUNT = 24

const EMPTY_AUTH: DraftAuth = {
  type: 'none',
  token: '',
  apiKey: '',
  apiValue: '',
  apiAddTo: 'header',
  username: '',
  password: '',
}

const HTTP_LANGS = new Set(['http', 'https', 'http-request', 'httprequest', 'rest'])
const CURL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'curl', 'powershell', 'ps1'])
const JSON_LANGS = new Set(['json', 'json5'])
const HOP_BY_HOP_HEADERS = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding',
  'keep-alive', 'proxy-connection', 'upgrade', 'te', 'trailer',
])
const BODY_MODES = new Set(['none', 'form-data', 'urlencoded', 'raw', 'binary', 'graphql'])
const RAW_TYPES = new Set(['json', 'text', 'javascript', 'html', 'xml'])

export function stashApiDraft(draft: ApiRequestDraft): boolean {
  try {
    const serialized = JSON.stringify(draft)
    if (serialized.length > MAX_DRAFT_LENGTH) return false
    sessionStorage.setItem(STASH_KEY, serialized)
    return true
  } catch {
    return false
  }
}

/** 只读不删：API 测试应用成功后再 commit，异常时草稿不会丢。 */
export function peekApiDraft(): ApiRequestDraft | null {
  try {
    const raw = sessionStorage.getItem(STASH_KEY)
    return raw ? normalizeApiDraft(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function commitApiDraftConsumed() {
  try {
    sessionStorage.removeItem(STASH_KEY)
  } catch {
    // 存储不可用时草稿本来就不会被写入，忽略即可。
  }
}

export function toApiDraft(candidate: ApiDraftCandidate, origin: ApiDraftOrigin): ApiRequestDraft {
  return {
    ...candidate,
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    url: candidate.url.trim().slice(0, MAX_URL_LENGTH),
    origin,
    createdAt: new Date().toISOString(),
  }
}

export function extractApiDrafts(text: string): ApiDraftCandidate[] {
  const blocks = readFenceBlocks(text)
  const parsed: ApiDraftCandidate[] = []

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    const content = block.content.trim()
    if (!content) continue

    let requests: RawRequest[] = []
    if (/^curl(?:\.exe)?\b/i.test(content)) {
      requests = parseCurlCommands(block.content)
    } else if (HTTP_LANGS.has(block.lang)) {
      requests = parseHttpRequests(block.content)
    } else if (CURL_LANGS.has(block.lang) && /\bcurl(?:\.exe)?\b/i.test(content)) {
      requests = parseCurlCommands(block.content)
    } else if (/^(GET|POST|PUT|PATCH|DELETE)\b/i.test(content)) {
      // 没有语言标记的代码块，只要首行是请求行也按 HTTP 请求解析。
      requests = parseHttpRequests(block.content)
    }
    if (!requests.length) continue

    // 很多回答把请求体单独放在紧跟的 json 代码块里；GET/DELETE 后面常见的其实是响应示例，
    // 因此只给通常带请求体的方法自动附加，且要求两个代码块之间没有其他文字。
    let consumedJsonBlock = false
    const lastRequest = requests[requests.length - 1]
    if (!lastRequest.body && canCarryBody(lastRequest.method)) {
      const next = blocks[index + 1]
      if (next && JSON_LANGS.has(next.lang) && text.slice(block.end, next.start).trim() === '') {
        const body = next.content.trim()
        if (isJson(body)) {
          lastRequest.body = body
          consumedJsonBlock = true
        }
      }
    }

    for (const request of requests) {
      const candidate = finalizeRequest(request)
      if (candidate) parsed.push(candidate)
    }
    if (consumedJsonBlock) index += 1
  }

  const inline = extractInlineCandidates(maskParsedBlocks(text, blocks))
  return dedupeCandidates([...parsed, ...inline]).slice(0, MAX_DRAFT_COUNT)
}

/** 生成可直接粘贴到终端的 cURL；示例认证信息用占位符，不输出空值。 */
export function toCurl(draft: ApiDraftCandidate): string {
  let url = draft.url
  const auth = draft.auth
  if (auth?.type === 'apiKey' && auth.apiAddTo === 'query' && auth.apiKey.trim()) {
    const value = auth.apiValue || '<api-key>'
    url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(auth.apiKey.trim())}=${encodeURIComponent(value)}`
  }

  const parts = [`curl -X ${draft.method} ${shellQuote(url)}`]
  for (const header of draft.headers ?? []) {
    if (!header.enabled || !header.key.trim()) continue
    parts.push(`  -H ${shellQuote(`${header.key}: ${header.value}`)}`)
  }
  if (auth?.type === 'bearer') {
    parts.push(`  -H ${shellQuote(`Authorization: Bearer ${auth.token || '<token>'}`)}`)
  } else if (auth?.type === 'basic') {
    parts.push(`  -u ${shellQuote(`${auth.username || '<username>'}:${auth.password || '<password>'}`)}`)
  } else if (auth?.type === 'apiKey' && auth.apiAddTo === 'header') {
    parts.push(`  -H ${shellQuote(`${auth.apiKey || 'X-API-Key'}: ${auth.apiValue || '<api-key>'}`)}`)
  }
  if (draft.body) {
    parts.push(`  --data-raw ${shellQuote(draft.body)}`)
  }
  return parts.join(' \\\n')
}

function readFenceBlocks(text: string): FenceBlock[] {
  const blocks: FenceBlock[] = []
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0
    blocks.push({
      lang: (match[1].trim().toLowerCase().split(/\s+/)[0] || ''),
      content: match[2].replace(/\r\n/g, '\n'),
      start,
      end: start + match[0].length,
    })
  }
  return blocks
}

function maskParsedBlocks(text: string, blocks: FenceBlock[]): string {
  const chars = text.split('')
  for (const block of blocks) {
    if (!HTTP_LANGS.has(block.lang) && !CURL_LANGS.has(block.lang) && !JSON_LANGS.has(block.lang)) continue
    for (let index = block.start; index < block.end && index < chars.length; index += 1) {
      chars[index] = ' '
    }
  }
  return chars.join('')
}

function parseHttpRequests(content: string): RawRequest[] {
  return splitHttpRequests(content).flatMap((segment) => {
    const request = parseHttpBlock(segment)
    return request ? [request] : []
  })
}

function parseCurlCommands(content: string): RawRequest[] {
  return splitCurlCommands(content).flatMap((command) => {
    const request = parseCurl(command)
    return request ? [request] : []
  })
}

function splitHttpRequests(content: string): string[] {
  const segments: string[] = []
  let current: string[] = []
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    if (isRequestLine(line)) {
      if (current.length) segments.push(current.join('\n'))
      current = [line]
    } else if (current.length) {
      current.push(line)
    }
  }
  if (current.length) segments.push(current.join('\n'))
  return segments.length ? segments : [content]
}

function splitCurlCommands(content: string): string[] {
  const commands: string[] = []
  let current: string[] = []
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim().replace(/^[$>]\s*/, '')
    if (/^curl(?:\.exe)?\b/i.test(trimmed)) {
      if (current.length) commands.push(current.join('\n'))
      current = [line]
    } else if (current.length) {
      current.push(line)
    }
  }
  if (current.length) commands.push(current.join('\n'))
  return commands.length ? commands : [content]
}

function isRequestLine(line: string): boolean {
  const trimmed = line.trim().replace(/^[`'"]+|[`'"]+$/g, '')
  const match = trimmed.match(/^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/\d(?:\.\d)?)?$/i)
  return Boolean(match && asDraftMethod(match[1]))
}

function canCarryBody(method: DraftMethod): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH'
}

function parseHttpBlock(content: string): RawRequest | null {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  let cursor = 0
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1
  const requestLine = (lines[cursor] ?? '')
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, '')
  const lineMatch = requestLine.match(/^([A-Za-z]+)\s+(\S+)(?:\s+HTTP\/\d(?:\.\d)?)?$/i)
  if (!lineMatch) return null
  const method = asDraftMethod(lineMatch[1])
  if (!method) return null

  const headers: DraftHeader[] = []
  const bodyLines: string[] = []
  let readingHeaders = true
  for (let index = cursor + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!readingHeaders) {
      bodyLines.push(line)
      continue
    }
    if (!line.trim()) {
      readingHeaders = false
      continue
    }
    const header = parseHeaderLine(line)
    if (header) headers.push(header)
    else {
      // 不是合法头时按 body 处理，容忍没有空行分隔的文档。
      readingHeaders = false
      bodyLines.push(line)
    }
  }

  return {
    method,
    url: cleanEndpoint(lineMatch[2]),
    headers,
    body: bodyLines.join('\n').trim(),
    notes: [],
  }
}

function parseCurl(content: string): RawRequest | null {
  const tokens = tokenizeShell(content.replace(/\\\r?\n/g, ' '))
  const curlIndex = tokens.findIndex((token) => /(?:^|\/)curl(?:\.exe)?$/i.test(token))
  if (curlIndex < 0) return null

  let method = ''
  let url = ''
  let body = ''
  let username = ''
  let password = ''
  const headers: DraftHeader[] = []
  const notes: string[] = []
  const appendBody = (value: string) => {
    body = body ? `${body}&${value}` : value
  }

  for (let index = curlIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]

    if (token === '-X' || token === '--request') { method = tokens[++index] || method; continue }
    if (token.startsWith('--request=')) { method = token.slice('--request='.length); continue }
    if (token.startsWith('-X') && token.length > 2) { method = token.slice(2); continue }

    if (token === '-H' || token === '--header') {
      const header = parseHeaderLine(tokens[++index] || '')
      if (header) headers.push(header)
      continue
    }
    if (token.startsWith('--header=')) {
      const header = parseHeaderLine(token.slice('--header='.length))
      if (header) headers.push(header)
      continue
    }
    if (token.startsWith('-H') && token.length > 2) {
      const header = parseHeaderLine(token.slice(2))
      if (header) headers.push(header)
      continue
    }

    if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary' || token === '--data-urlencode') {
      appendBody(tokens[++index] || '')
      continue
    }
    if (token.startsWith('--data-raw=')) { appendBody(token.slice('--data-raw='.length)); continue }
    if (token.startsWith('--data-binary=')) { appendBody(token.slice('--data-binary='.length)); continue }
    if (token.startsWith('--data-urlencode=')) { appendBody(token.slice('--data-urlencode='.length)); continue }
    if (token.startsWith('--data=')) { appendBody(token.slice('--data='.length)); continue }

    if (token === '--json') {
      appendBody(tokens[++index] || '')
      if (!headers.some(header => header.key.toLowerCase() === 'content-type')) {
        headers.push({ key: 'Content-Type', value: 'application/json', enabled: true })
      }
      continue
    }
    if (token.startsWith('--json=')) {
      appendBody(token.slice('--json='.length))
      if (!headers.some(header => header.key.toLowerCase() === 'content-type')) {
        headers.push({ key: 'Content-Type', value: 'application/json', enabled: true })
      }
      continue
    }

    if (token === '-u' || token === '--user') {
      const credentials = tokens[++index] || ''
      const separator = credentials.indexOf(':')
      username = separator >= 0 ? credentials.slice(0, separator) : credentials
      password = separator >= 0 ? credentials.slice(separator + 1) : ''
      continue
    }
    if (token.startsWith('--user=')) {
      const credentials = token.slice('--user='.length)
      const separator = credentials.indexOf(':')
      username = separator >= 0 ? credentials.slice(0, separator) : credentials
      password = separator >= 0 ? credentials.slice(separator + 1) : ''
      continue
    }

    if (token === '--url') { url = tokens[++index] || url; continue }
    if (token.startsWith('--url=')) { url = token.slice('--url='.length); continue }

    if (token === '-F' || token === '--form') {
      index += 1
      notes.push('cURL 的 multipart/form-data 未自动解析，请在 Body 页手工补全')
      continue
    }
    if (FLAGS_WITH_VALUE.has(token)) {
      index += 1
      continue
    }
    if (token.startsWith('-')) continue
    if (!url) url = token
  }

  if (!url) return null
  const finalMethod = asDraftMethod(method) ?? (body ? 'POST' : 'GET')
  const auth = username || password
    ? { ...EMPTY_AUTH, type: 'basic' as const }
    : null
  if (auth) notes.push('已移除 cURL 示例用户名和密码，请在 Auth 页补填')

  return {
    method: finalMethod,
    url: cleanEndpoint(url),
    headers,
    body: body.trim(),
    auth,
    notes,
  }
}

const FLAGS_WITH_VALUE = new Set([
  '-o', '--output', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie',
  '--connect-timeout', '--max-time', '-m', '--retry', '--retry-delay', '--retry-max-time',
  '--proxy', '-x', '--cert', '--key', '--cacert', '--resolve', '--interface', '--limit-rate',
])

function finalizeRequest(request: RawRequest): ApiDraftCandidate | null {
  const url = cleanEndpoint(request.url)
  if (!url) return null

  const notes = [...request.notes]
  const originalHeaders = request.headers.filter((header) => header.key.trim())
  const transportHeadersRemoved = originalHeaders.some((header) => HOP_BY_HOP_HEADERS.has(header.key.toLowerCase()))

  let headers = originalHeaders
    .filter((header) => !HOP_BY_HOP_HEADERS.has(header.key.toLowerCase()))
    .map((header) => ({ key: header.key.trim(), value: header.value.trim(), enabled: header.enabled !== false }))

  const authResult = extractAuthHeaders(headers)
  headers = authResult.headers
  notes.push(...authResult.notes)
  if (transportHeadersRemoved) notes.push('已忽略 Host、Content-Length 等由客户端自动生成的头')
  const auth = request.auth ?? authResult.auth

  let body = request.body.trim()
  let rawType: RawBodyType
  if (body) {
    try {
      body = JSON.stringify(JSON.parse(body), null, 2)
      rawType = 'json'
    } catch {
      rawType = detectRawType(headers)
    }
  } else {
    const detected = detectRawType(headers)
    rawType = detected === 'text' ? 'json' : detected
  }
  if (body.length > MAX_BODY_LENGTH) body = body.slice(0, MAX_BODY_LENGTH)

  if (body && !hasHeader(headers, 'content-type')) {
    headers = [{ key: 'Content-Type', value: rawType === 'json' ? 'application/json' : 'text/plain', enabled: true }, ...headers]
  }

  return {
    method: request.method,
    url,
    headers,
    body,
    bodyConfig: { mode: body ? 'raw' : 'none', rawType },
    auth,
    confidence: 'full',
    ...(notes.length ? { notices: dedupeStrings(notes).slice(0, 4) } : {}),
  }
}

function extractAuthHeaders(headers: DraftHeader[]) {
  const remaining: DraftHeader[] = []
  const notes: string[] = []
  let auth: DraftAuth | null = null

  for (const header of headers) {
    const key = header.key.toLowerCase()
    if (key === 'authorization') {
      if (/^bearer\b/i.test(header.value)) {
        auth = { ...EMPTY_AUTH, type: 'bearer' }
        notes.push('已移除示例 Bearer Token，请在 Auth 页补填')
      } else if (/^basic\b/i.test(header.value)) {
        auth = { ...EMPTY_AUTH, type: 'basic' }
        notes.push('已移除示例 Basic Auth，请在 Auth 页补填')
      } else {
        notes.push('已移除示例 Authorization 头，请在 Auth 页或 Headers 里按文档补填')
      }
      continue
    }
    if (key === 'x-api-key' || key === 'api-key' || key === 'apikey') {
      auth = { ...EMPTY_AUTH, type: 'apiKey', apiKey: header.key }
      notes.push(`已移除示例 ${header.key}，请在 Auth 页补填`)
      continue
    }
    remaining.push(header)
  }

  return { headers: remaining, auth, notes }
}

function extractInlineCandidates(text: string): ApiDraftCandidate[] {
  const candidates: ApiDraftCandidate[] = []
  const seen = new Set<string>()
  const pattern = /\b(GET|POST|PUT|PATCH|DELETE)\s*[:：]?\s*(https?:\/\/[^\s`<>)，。；]+|\/[a-zA-Z0-9_{}:./?=&%~-]+)/gi
  for (const match of text.matchAll(pattern)) {
    const method = asDraftMethod(match[1])
    if (!method) continue
    const url = cleanEndpoint(match[2])
    if (!url) continue
    const key = `${method} ${url}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ method, url, headers: [], body: '', confidence: 'method-path' })
  }
  return candidates
}

function dedupeCandidates(candidates: ApiDraftCandidate[]): ApiDraftCandidate[] {
  const byKey = new Map<string, ApiDraftCandidate>()
  for (const candidate of candidates) {
    const key = `${candidate.method} ${candidate.url}`
    const existing = byKey.get(key)
    if (!existing || candidateScore(candidate) > candidateScore(existing)) {
      byKey.set(key, candidate)
    }
  }
  return [...byKey.values()]
}

function candidateScore(candidate: ApiDraftCandidate): number {
  return (candidate.confidence === 'full' ? 1000 : 0)
    + (candidate.headers?.length ?? 0) * 10
    + Math.min(candidate.body?.length ?? 0, MAX_BODY_LENGTH) / 100
}

function parseHeaderLine(line: string): DraftHeader | null {
  const match = line.trim().match(/^([!#$%&'*+\-.^_`|~0-9A-Za-z]+):\s*(.*)$/)
  if (!match) return null
  return { key: match[1], value: match[2].trim(), enabled: true }
}

function tokenizeShell(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (const char of input) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) tokens.push(current)
  return tokens
}

function cleanEndpoint(value: string): string {
  return value
    .trim()
    .replace(/^[`'"<]+/, '')
    .replace(/[`'">,;，。；]+$/, '')
    .slice(0, MAX_URL_LENGTH)
}

function asDraftMethod(value: string | undefined): DraftMethod | null {
  if (!value) return null
  const method = value.trim().toUpperCase()
  return (DRAFT_METHODS as readonly string[]).includes(method) ? method as DraftMethod : null
}

function detectRawType(headers: DraftHeader[]): RawBodyType {
  const contentType = headers.find((header) => header.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? ''
  if (contentType.includes('json')) return 'json'
  if (contentType.includes('xml')) return 'xml'
  if (contentType.includes('html')) return 'html'
  if (contentType.includes('javascript') || contentType.includes('ecmascript')) return 'javascript'
  return 'text'
}

function hasHeader(headers: DraftHeader[], name: string): boolean {
  return headers.some((header) => header.key.toLowerCase() === name.toLowerCase())
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function normalizeMethod(value: unknown): DraftMethod {
  return asDraftMethod(String(value ?? '')) ?? 'GET'
}

function normalizeOrigin(value: unknown): ApiDraftOrigin {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const libraryId = Number(raw.libraryId)
  const messageIndex = Number(raw.messageIndex)
  const conversationId = typeof raw.conversationId === 'string' ? raw.conversationId.slice(0, 128) : ''
  return {
    libraryId: Number.isSafeInteger(libraryId) && libraryId > 0 ? libraryId : 0,
    ...(conversationId ? { conversationId } : {}),
    messageIndex: Number.isSafeInteger(messageIndex) && messageIndex >= 0 ? messageIndex : 0,
    question: typeof raw.question === 'string' ? raw.question.slice(0, MAX_QUESTION_LENGTH) : '',
    citationIds: Array.isArray(raw.citationIds)
      ? [...new Set(raw.citationIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 32)
      : [],
  }
}

function normalizeHeaders(value: unknown): DraftHeader[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_HEADER_COUNT).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const item = entry as Record<string, unknown>
    const key = typeof item.key === 'string' ? item.key.slice(0, 256) : ''
    if (!key.trim()) return []
    return [{
      key,
      value: typeof item.value === 'string' ? item.value.slice(0, 8192) : '',
      enabled: item.enabled !== false,
    }]
  })
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : ''
}

function normalizeBodyConfig(value: unknown): Partial<RequestBodyConfig> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const mode = typeof raw.mode === 'string' && BODY_MODES.has(raw.mode) ? raw.mode as BodyMode : undefined
  const rawType = typeof raw.rawType === 'string' && RAW_TYPES.has(raw.rawType) ? raw.rawType as RawBodyType : undefined
  if (!mode && !rawType) return undefined
  return {
    ...(mode ? { mode } : {}),
    ...(rawType ? { rawType } : {}),
  }
}

function normalizeAuth(value: unknown): DraftAuth | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (raw.type !== 'bearer' && raw.type !== 'apiKey' && raw.type !== 'basic') return null
  return {
    type: raw.type,
    token: normalizeText(raw.token, 8192),
    apiKey: normalizeText(raw.apiKey, 512),
    apiValue: normalizeText(raw.apiValue, 8192),
    apiAddTo: raw.apiAddTo === 'query' ? 'query' : 'header',
    username: normalizeText(raw.username, 512),
    password: normalizeText(raw.password, 2048),
  }
}

function normalizeNotices(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const notices = [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.slice(0, 200)),
  )].slice(0, 5)
  return notices.length ? notices : undefined
}

export function normalizeApiDraft(value: unknown): ApiRequestDraft | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const url = typeof raw.url === 'string' ? cleanEndpoint(raw.url) : ''
  if (!url) return null

  const headers = normalizeHeaders(raw.headers)
    .filter((header) => !HOP_BY_HOP_HEADERS.has(header.key.toLowerCase()))
  const body = normalizeText(raw.body, MAX_BODY_LENGTH)
  const bodyConfig = normalizeBodyConfig(raw.bodyConfig)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 128) : `draft_${Date.now()}`,
    method: normalizeMethod(raw.method),
    url,
    headers,
    body,
    bodyConfig: {
      mode: bodyConfig?.mode ?? (body ? 'raw' : 'none'),
      rawType: bodyConfig?.rawType ?? detectRawType(headers),
    },
    auth: normalizeAuth(raw.auth),
    confidence: raw.confidence === 'full' ? 'full' : 'method-path',
    notices: normalizeNotices(raw.notices),
    origin: normalizeOrigin(raw.origin),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  }
}
