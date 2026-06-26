// API 测试 — 接口调试工具，支持请求编辑、发送、响应查看、历史记录保存与多标签管理
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { addLog } from '../utils/logStore'
import { getSavedRequests, setSavedRequests as storeSaveRequests, type SavedRequest } from '../utils/requestStore'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface KvPair {
  key: string
  value: string
  enabled: boolean
}

interface Collection {
  name: string
  icon: string
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

const collections: Collection[] = [
  { name: '默认集合', icon: '📁' },
  { name: '模型 API', icon: '🧠' },
  { name: '工作流', icon: '⚡' },
]

const defaultHeaders: KvPair[] = [
  { key: 'Content-Type', value: 'application/json', enabled: true },
  { key: 'Authorization', value: 'Bearer sk-...', enabled: true },
]

const defaultBody = `{
  "model": "qwen-max",
  "messages": [
    { "role": "user", "content": "你好" }
  ],
  "temperature": 0.7
}`

let nextRequestId = Date.now()

const bodyTypeMeta: Record<string, { label: string; badge: string; mime: string; color: string; icon: string }> = {
  json:       { label: 'JSON',    badge: 'border-l-green-500 bg-green-50 text-green-700',    mime: 'application/json',                color: 'text-green-600',  icon: '{}' },
  text:       { label: 'Text',    badge: 'border-l-base-content/20 bg-base-200 text-base-content/70', mime: 'text/plain',             color: 'text-base-content/50',   icon: 'T' },
  javascript: { label: 'JavaScript', badge: 'border-l-yellow-500 bg-yellow-50 text-yellow-700', mime: 'application/javascript',       color: 'text-yellow-600', icon: 'JS' },
  html:       { label: 'HTML',    badge: 'border-l-orange-500 bg-orange-50 text-orange-700', mime: 'text/html',                        color: 'text-orange-600', icon: '</>' },
  xml:        { label: 'XML',     badge: 'border-l-blue-500 bg-blue-50 text-blue-700',       mime: 'application/xml',                  color: 'text-blue-600',   icon: '<>' },
}

export default function ApiTest() {
  // 有历史记录时默认选中第一条
  const initialList = getSavedRequests()
  const hasHistory = initialList.length > 0
  const [method, setMethod] = useState<HttpMethod>(hasHistory ? initialList[0].method as HttpMethod : 'POST')
  const [url, setUrl] = useState(hasHistory ? initialList[0].url : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'body' | 'auth'>('body')
  const [bodyType, setBodyType] = useState<'json' | 'text' | 'javascript' | 'html' | 'xml'>('json')
  const [headers, setHeaders] = useState<KvPair[]>(hasHistory ? initialList[0].headers.map(h => ({ ...h })) : defaultHeaders.map(h => ({ ...h })))
  const [body, setBody] = useState(hasHistory ? initialList[0].body : defaultBody)

  // 已保存的请求
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>(() => initialList)
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(hasHistory ? initialList[0].id : null)

  // 响应
  const firstResponse = hasHistory ? initialList[0].lastResponse : null
  const [response, setResponse] = useState<{
    status: number
    statusText: string
    time: string
    size: string
    headers: Record<string, string>
    body: string
  } | null>(firstResponse || null)
  const [sending, setSending] = useState(false)
  const [activeResponseTab, setActiveResponseTab] = useState<'body' | 'headers' | 'concurrent'>('body')
  // 并发测试
  const cfg = hasHistory ? initialList[0].concurrentConfig : null
  const [concurrentMode, setConcurrentMode] = useState(cfg?.mode ?? false)
  const [concurrentCount, setConcurrentCount] = useState(cfg?.count ?? 5)
  const [concurrentDuration, setConcurrentDuration] = useState(cfg?.duration ?? 10)
  const [requestTimeout, setRequestTimeout] = useState(cfg?.timeout ?? 600)
  const [concurrentResults, setConcurrentResults] = useState<{ index: number; status: number; time: string }[] | null>(() => hasHistory ? (initialList[0].concurrentResults || null) : null)

  // 切换 body 类型时同步更新 Content-Type 请求头
  const changeBodyType = (type: typeof bodyType) => {
    setBodyType(type)
    setHeaders(prev => {
      const filtered = prev.filter(h => h.key.toLowerCase() !== 'content-type')
      return [{ key: 'Content-Type', value: bodyTypeMeta[type].mime, enabled: true }, ...filtered]
    })
  }

  // UI 状态
  const [showSidebar, setShowSidebar] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  // 首次保存弹窗
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveLabel, setSaveLabel] = useState('')
  // 确认首次保存
  const confirmFirstSave = () => {
    if (!saveLabel.trim()) return
    const now = new Date().toLocaleString('zh-CN', { hour12: false })

    // 去重：同 method + url 直接更新，不新增
    const existingIdx = savedRequests.findIndex(r => r.method === method && r.url === url)
    if (existingIdx >= 0) {
      const existing = savedRequests[existingIdx]
      setSavedRequests(prev => prev.map(r =>
        r.id === existing.id
          ? { ...r, label: saveLabel.trim(), headers: headers.map(h => ({ ...h })), body, savedAt: now, lastResponse: response ? { status: response.status, statusText: response.statusText, time: response.time, size: response.size, body: response.body, headers: response.headers } : r.lastResponse, concurrentResults: concurrentResults || r.concurrentResults, concurrentSummary: calcConcurrentSummary() || r.concurrentSummary,
              concurrentConfig: { mode: concurrentMode, count: concurrentCount, duration: concurrentDuration, timeout: requestTimeout } }
          : r
      ))
      setCurrentSavedId(existing.id)
      showToast('🔄 已更新已有记录')
    } else {
      const newReq: SavedRequest = {
        id: `saved_${++nextRequestId}`,
        label: saveLabel.trim(),
        method, url,
        headers: headers.map(h => ({ ...h })),
        body,
        collection: collections[0].name,
        savedAt: now,
        lastResponse: response ? { status: response.status, statusText: response.statusText, time: response.time, size: response.size, body: response.body, headers: response.headers } : undefined,
        concurrentResults: concurrentResults || undefined,
        concurrentSummary: calcConcurrentSummary() || undefined,
        concurrentConfig: { mode: concurrentMode, count: concurrentCount, duration: concurrentDuration, timeout: requestTimeout },
      }
      setSavedRequests(prev => [newReq, ...prev])
      setCurrentSavedId(newReq.id)
      showToast('✅ 保存成功')
    }
    setShowSaveModal(false)
  }

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  // 重命名状态
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameLabel, setRenameLabel] = useState('')
  // 语法高亮编辑（单层 contentEditable）
  const bodyRef = useRef<HTMLDivElement>(null)
  const syncBodyScroll = () => {}
  // 响应面板高度拖拽
  const [responseHeight, setResponseHeight] = useState(Math.min(400, window.innerHeight * 0.35))
  const dragging = useRef(false)
  const startY = useRef(0)
  const startH = useRef(0)

  const onDragStart = useCallback((e: React.MouseEvent) => {
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
      const newH = Math.min(Math.max(startH.current + delta, 100), 600)
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

  // 侧边栏宽度拖拽
  const [sidebarWidth, setSidebarWidth] = useState(256)
  const sidebarDragging = useRef(false)
  const sidebarStartX = useRef(0)
  const sidebarStartW = useRef(0)

  const onSidebarDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    sidebarDragging.current = true
    sidebarStartX.current = e.clientX
    sidebarStartW.current = sidebarWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [sidebarWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!sidebarDragging.current) return
      const delta = e.clientX - sidebarStartX.current
      const newW = Math.min(Math.max(sidebarStartW.current + delta, 180), 480)
      setSidebarWidth(newW)
    }
    const onUp = () => {
      if (!sidebarDragging.current) return
      sidebarDragging.current = false
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
  useEffect(() => { storeSaveRequests(savedRequests) }, [savedRequests])

  const getApiPath = (u: string) => { try { return new URL(u).pathname } catch { return u } }
  const getModelName = () => { try { return JSON.parse(body).model || '' } catch { return '' } }
  const nowStr = () => { const d = new Date(); return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}` }

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  // 并发发送请求（每秒 N 路，持续 M 秒）
  const handleConcurrentSend = async () => {
    if (!url.trim()) { showToast('⚠️ 请输入 URL'); return }
    setSending(true)
    setResponse(null)
    setConcurrentResults(null)

    const perSec = concurrentCount
    const seconds = concurrentDuration
    const results: { index: number; status: number; time: string }[] = []
    // eslint-disable-next-line react-hooks/purity
    const startTime = Date.now()

    // 构建 Headers
    const reqHeaders: Record<string, string> = {}
    headers.filter(h => h.enabled && h.key.trim()).forEach(h => { reqHeaders[h.key.trim()] = h.value })
    const fetchOptions: RequestInit = { method, headers: reqHeaders }
    if (method !== 'GET' && body.trim()) fetchOptions.body = body

    // 捕获第一个成功响应的 body 用于展示
    let sampleBody = ''
    let sampleStatus = 0
    let sampleStatusText = ''
    const sampleHeaders: Record<string, string> = {}
    const timeoutMs = requestTimeout * 1000
    let seq = 0

    // 显示进度
    const progressInterval = setInterval(() => {
      setConcurrentResults([...results])
    }, 200)

    // 逐秒发送
    for (let sec = 0; sec < seconds; sec++) {
      const batch = Array.from({ length: perSec }, async () => {
        const idx = ++seq
        const t0 = performance.now()
        const ac = new AbortController()
        const tid = setTimeout(() => ac.abort(), timeoutMs)
        try {
          const res = await fetch(url, { ...fetchOptions, signal: ac.signal })
          const t1 = performance.now()
          results.push({ index: idx, status: res.status, time: ((t1 - t0) / 1000).toFixed(2) + 's' })
          if (!sampleBody) {
            sampleStatus = res.status
            sampleStatusText = res.statusText || (res.ok ? 'OK' : 'Error')
            res.headers.forEach((v, k) => { sampleHeaders[k] = v })
            const ct = res.headers.get('content-type') || ''
            sampleBody = ct.includes('application/json')
              ? JSON.stringify(await res.clone().json(), null, 2)
              : await res.clone().text()
          }
        } catch {
          const t1 = performance.now()
          results.push({ index: idx, status: 0, time: ((t1 - t0) / 1000).toFixed(2) + 's' })
        } finally {
          clearTimeout(tid)
        }
      })
      await Promise.allSettled(batch)
      if (sec < seconds - 1) {
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    clearInterval(progressInterval)

    // eslint-disable-next-line react-hooks/purity
    const endTime = Date.now()
    const totalTime = ((endTime - startTime) / 1000).toFixed(2)
    setConcurrentResults(results)

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

    setResponse({
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
    })
    setSending(false)
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
    // 自动保存
    autoSave()
  }

  // 发送请求（真实 HTTP 调用）
  const handleSend = async () => {
    if (!url.trim()) {
      showToast('⚠️ 请输入 URL')
      return
    }

    setSending(true)
    setResponse(null)

    const startTime = Date.now()

    try {
      // 构建 Headers
      const reqHeaders: Record<string, string> = {}
      headers.filter(h => h.enabled && h.key.trim()).forEach(h => {
        reqHeaders[h.key.trim()] = h.value
      })

      const fetchOptions: RequestInit = {
        method,
        headers: reqHeaders,
      }

      // 添加 Body（GET 不允许 body）
      if (method !== 'GET' && body.trim()) {
        fetchOptions.body = body
      }

      const timeoutMs = requestTimeout * 1000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const res = await fetch(url, { ...fetchOptions, signal: controller.signal }).finally(() => clearTimeout(timer))
      const endTime = Date.now()
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

      setResponse({
        status: res.status,
        statusText: res.statusText || (res.ok ? 'OK' : 'Error'),
        time: duration,
        size: sizeStr,
        headers: respHeaders,
        body: responseBody,
      })
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
    } catch (err) {
      const endTime = Date.now()
      const duration = ((endTime - startTime) / 1000).toFixed(2) + 's'

      setResponse({
        status: 0,
        statusText: '请求失败',
        time: duration,
        size: '0 B',
        headers: {},
        body: JSON.stringify({
          error: (err as Error).name === 'AbortError' ? '请求超时' : (err as Error).message,
          hint: (err as Error).name === 'AbortError'
            ? `请求超过 ${requestTimeout} 秒未返回，已自动中止。可增大超时时间或检查服务端响应速度。`
            : '可能的原因：CORS 跨域限制、网络不通、URL 格式错误、HTTPS 证书问题',
        }, null, 2),
      })
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
    } finally {
      setSending(false)
      autoSave()
    }
  }

  // 计算并发统计摘要
  const calcConcurrentSummary = () => {
    if (!concurrentResults || concurrentResults.length === 0) return null
    const success = concurrentResults.filter(r => r.status >= 200 && r.status < 300).length
    const failed = concurrentResults.filter(r => r.status === 0 || r.status >= 400).length
    const times = concurrentResults.map(r => parseFloat(r.time)).filter(t => t > 0)
    const avg = times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2) : '0'
    return {
      total: concurrentResults.length,
      success,
      failed,
      avgTime: avg + 's',
      totalTime: response?.time || '0s',
    }
  }

  // 自动保存（发送成功后调用）
  const autoSave = () => {
    if (!url.trim()) return
    if (currentSavedId) {
      quickSave()
    } else {
      const label = url.split('/').pop()?.split('?')[0]?.split('.')[0] || '未命名'
      const now = new Date().toLocaleString('zh-CN', { hour12: false })
      const existingIdx = savedRequests.findIndex(r => r.method === method && r.url === url)
      if (existingIdx >= 0) {
        const existing = savedRequests[existingIdx]
        setSavedRequests(prev => prev.map(r =>
          r.id === existing.id
            ? { ...r, label, headers: headers.map(h => ({ ...h })), body, savedAt: now, lastResponse: response ? { status: response.status, statusText: response.statusText, time: response.time, size: response.size, body: response.body, headers: response.headers } : r.lastResponse, concurrentResults: concurrentResults || r.concurrentResults, concurrentSummary: calcConcurrentSummary() || r.concurrentSummary,
              concurrentConfig: { mode: concurrentMode, count: concurrentCount, duration: concurrentDuration, timeout: requestTimeout } }
            : r
        ))
        setCurrentSavedId(existing.id)
      } else {
        const newReq: SavedRequest = {
          id: `saved_${++nextRequestId}`,
          label, method, url,
          headers: headers.map(h => ({ ...h })),
          body,
          collection: collections[0].name,
          savedAt: now,
          lastResponse: response ? { status: response.status, statusText: response.statusText, time: response.time, size: response.size, body: response.body, headers: response.headers } : undefined,
          concurrentResults: concurrentResults || undefined,
          concurrentSummary: calcConcurrentSummary() || undefined,
        }
        setSavedRequests(prev => [newReq, ...prev])
        setCurrentSavedId(newReq.id)
      }
    }
  }

  // 快速保存（已有保存时直接覆盖，不弹窗）
  const quickSave = () => {
    if (!currentSavedId) return
    const saved = savedRequests.find(r => r.id === currentSavedId)
    if (!saved) return

    const now = new Date().toLocaleString('zh-CN', { hour12: false })
    setSavedRequests(prev =>
      prev.map(r =>
        r.id === currentSavedId
          ? {
              ...r, method, url,
              headers: headers.map(h => ({ ...h })), body, savedAt: now,
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
      )
    )
    showToast('✅ 保存成功')
  }

  // 加载已保存请求（含上次调试结果）
  const loadRequest = (r: SavedRequest) => {
    setMethod(r.method as HttpMethod)
    setUrl(r.url)
    setHeaders(r.headers.map(h => ({ ...h })))
    setBody(r.body)
    setCurrentSavedId(r.id)
    setResponse(r.lastResponse ? { ...r.lastResponse } : null)
    setConcurrentResults(r.concurrentResults || null)
    if (r.concurrentConfig) {
      setConcurrentMode(r.concurrentConfig.mode)
      setConcurrentCount(r.concurrentConfig.count)
      setConcurrentDuration(r.concurrentConfig.duration)
      if (r.concurrentConfig.timeout) setRequestTimeout(r.concurrentConfig.timeout)
    }
    if (window.innerWidth < 1024) setShowSidebar(false)
  }

  // 删除已保存请求
  const confirmDelete = () => {
    if (!deleteTarget) return
    setSavedRequests(prev => prev.filter(r => r.id !== deleteTarget))
    if (currentSavedId === deleteTarget) {
      setCurrentSavedId(null)
    }
    setDeleteTarget(null)
    showToast('🗑️ 已删除')
  }

  // 打开重命名
  const openRename = (r: SavedRequest, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamingId(r.id)
    setRenameLabel(r.label)
  }

  // 确认重命名
  const confirmRename = () => {
    if (!renameLabel.trim() || !renamingId) return
    setSavedRequests(prev =>
      prev.map(r => r.id === renamingId ? { ...r, label: renameLabel.trim() } : r)
    )
    setRenamingId(null)
    showToast('✏️ 已重命名')
  }

  // 语法高亮
  const escapeHtml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const highlighters = useMemo(() => ({
    json(text: string) {
      let formatted: string
      try { formatted = JSON.stringify(JSON.parse(text), null, 2) } catch { return escapeHtml(text) }
      return formatted.replace(
        /("(?:\\.|[^"\\])*")\s*:|\b(true|false)\b|\b(null)\b|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|("(?:\\.|[^"\\])*")/g,
        ($0: string, key: string, bool: string, nul: string, num: string, str: string) => {
          if (key) return `<span style="color:#60a5fa">${escapeHtml(key)}</span><span style="color:#9ca3af">:</span>`
          if (bool) return `<span style="color:#818cf8">${bool}</span>`
          if (nul) return `<span style="color:#818cf8">null</span>`
          if (num) return `<span style="color:#34d399">${num}</span>`
          if (str) return `<span style="color:#fb923c">${escapeHtml(str)}</span>`
          return escapeHtml($0)
        }
      )
    },

    javascript(text: string) {
      const escaped = escapeHtml(text)
      let s = escaped.replace(/\/\*[\s\S]*?\*\//g, '<span class="text-green-500 italic">$&</span>')
      s = s.replace(/(\/\/.*)$/gm, '<span class="text-green-500 italic">$1</span>')
      s = s.replace(/`(?:[^`\\]|\\.)*`/g, '<span class="text-amber-600">$&</span>')
      s = s.replace(/"([^"\\]|\\.)*"/g, '<span class="text-green-600">$&</span>')
      s = s.replace(/'([^'\\]|\\.)*'/g, '<span class="text-green-600">$&</span>')
      s = s.replace(/\b(\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, '<span class="text-orange-500">$1</span>')
      const keywords = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|import|export|from|async|await|try|catch|finally|throw|new|delete|typeof|instanceof|this|super|extends|yield|of|in|with|default|static|get|set)\b/g
      s = s.replace(keywords, '<span class="text-blue-600 font-medium">$1</span>')
      s = s.replace(/\b(console|Math|JSON|Promise|Array|Object|String|Number|Boolean|Date|RegExp|Error|Map|Set|Symbol|BigInt)\b/g, '<span class="text-blue-400">$1</span>')
      return s
    },

    html(text: string) {
      const escaped = escapeHtml(text)
      let s = escaped.replace(/&lt;!--[\s\S]*?--&gt;/g, '<span class="text-green-500 italic">$&</span>')
      s = s.replace(/&lt;(\/?)(\w[\w-]*)([\s\S]*?)(\/?)&gt;/g,
        (_match: string, close: string, tag: string, attrs: string, selfClose: string) => {
          const closeTag = close ? '<span class="text-base-content/30">/</span>' : ''
          const tagName = `<span class="text-blue-600 font-medium">${tag}</span>`
          const attrsHighlighted = attrs.replace(
            /([\w-]+)=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
            (_a: string, attr: string, val: string) => `<span class="text-red-400">${attr}</span><span class="text-base-content/30">=</span><span class="text-green-600">${val}</span>`
          )
          return `<span class="text-base-content/30">&lt;</span>${closeTag}${tagName}${attrsHighlighted}${selfClose ? '<span class="text-base-content/30">/</span>' : ''}<span class="text-base-content/30">&gt;</span>`
        }
      )
      return s
    },

    xml(text: string) {
      const escaped = escapeHtml(text)
      let s = escaped.replace(/&lt;!--[\s\S]*?--&gt;/g, '<span class="text-green-500 italic">$&</span>')
      s = s.replace(/&lt;!\[CDATA\[[\s\S]*?\]\]&gt;/g, '<span class="text-amber-600">$&</span>')
      s = s.replace(/&lt;(\/?)([\w][\w.:-]*)([\s\S]*?)(\/?)&gt;/g,
        (_match: string, close: string, tag: string, attrs: string, selfClose: string) => {
          const closeTag = close ? '<span class="text-base-content/30">/</span>' : ''
          const tagName = `<span class="text-blue-600 font-medium">${tag}</span>`
          const attrsHighlighted = attrs.replace(
            /([\w.:-]+)=("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g,
            (_a: string, attr: string, val: string) => `<span class="text-red-400">${attr}</span><span class="text-base-content/30">=</span><span class="text-green-600">${val}</span>`
          )
          return `<span class="text-base-content/30">&lt;</span>${closeTag}${tagName}${attrsHighlighted}${selfClose ? '<span class="text-base-content/30">/</span>' : ''}<span class="text-base-content/30">&gt;</span>`
        }
      )
      s = s.replace(/&lt;\?[\s\S]*?\?&gt;/g, '<span class="text-purple-500">$&</span>')
      return s
    },

    text(text: string) {
      return escapeHtml(text)
    },
  }), [])

  const addHeader = () => setHeaders([...headers, { key: '', value: '', enabled: true }])
  const updateHeader = (i: number, field: 'key' | 'value', val: string) => {
    const next = [...headers]; next[i] = { ...next[i], [field]: val }; setHeaders(next)
  }
  const toggleHeader = (i: number) => {
    const next = [...headers]; next[i] = { ...next[i], enabled: !next[i].enabled }; setHeaders(next)
  }
  const removeHeader = (i: number) => setHeaders(headers.filter((_, idx) => idx !== i))

  const prevType = useRef(bodyType)
  useEffect(() => {
    if (bodyRef.current) {
      const typeChanged = prevType.current !== bodyType
      prevType.current = bodyType
      if (typeChanged || bodyRef.current.textContent !== body) {
        bodyRef.current.innerHTML = highlighters[bodyType](body) || ''
      }
    }
  }, [body, bodyType, activeTab, highlighters])

  // 按集合分组
  const grouped = collections.map(c => ({
    ...c,
    items: savedRequests.filter(r => r.collection === c.name),
  }))

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 标题栏 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">API 测试</h1>
          <p className="text-base-content/60 mt-1"></p>
        </div>
        <button className="btn btn-primary" onClick={() => {
          setMethod('GET')
          setUrl('')
          setHeaders([{ key: 'Content-Type', value: 'application/json', enabled: true }])
          setBody('')
          setCurrentSavedId(null)
          setResponse(null)
          setConcurrentResults(null)
          setConcurrentMode(false)
          setConcurrentCount(5)
          setConcurrentDuration(10)
          setRequestTimeout(30)
          showToast('✨ 新建请求')
        }}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          新建
        </button>
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
      {showSidebar && (
        <>
          <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setShowSidebar(false)} />
          <aside className="fixed left-0 top-0 z-40 flex h-full flex-col border-r border-base-200 bg-base-100 lg:relative lg:z-auto lg:border-r" style={{ width: sidebarWidth }}>
            <div className="flex items-center justify-between border-b border-base-200 px-4 py-3">
              <h2 className="text-sm font-semibold">历史记录</h2>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-base-content/30">{savedRequests.length} 项</span>
                <button className="btn btn-ghost btn-square btn-xs lg:hidden" onClick={() => setShowSidebar(false)}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {savedRequests.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-xs text-base-content/20 gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /></svg>
                  <span>暂无保存的配置</span>
                </div>
              ) : (
                grouped.map(g => g.items.length > 0 && (
                  <div key={g.name} className="mb-2">
                    <div className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-base-content/40">
                      {g.icon} {g.name}
                      <span className="text-base-content/20 ml-1">({g.items.length})</span>
                    </div>
                    {g.items.map(r => (
                      <div
                        key={r.id}
                        className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-base-200 cursor-pointer ${
                          currentSavedId === r.id ? 'bg-primary/5 ring-1 ring-primary/20' : ''
                        }`}
                        onClick={() => loadRequest(r)}
                      >
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
                        {/* 三点操作菜单 */}
                        <div className="dropdown dropdown-end shrink-0 opacity-0 group-hover:opacity-100">
                          <button
                            tabIndex={0}
                            className="btn btn-ghost btn-xs btn-square"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-base-content/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>
                          </button>
                          <ul tabIndex={0} className="menu dropdown-content z-1 mt-1 w-28 rounded-box bg-base-100 p-1 shadow-lg">
                            <li>
                              <button className="text-xs" onClick={(e) => { e.stopPropagation(); openRename(r, e); }}>
                                重命名
                              </button>
                            </li>
                            <li>
                              <button className="text-xs text-red-500" onClick={(e) => { e.stopPropagation(); setDeleteTarget(r.id); }}>
                                删除
                              </button>
                            </li>
                          </ul>
                        </div>
                      </div>
                    ))}
                  </div>
                ))
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
      )}

      {/* ========== 主区域 ========== */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ===== 工具栏 ===== */}
        <div className="flex items-center gap-2 border-b border-base-200 bg-base-100 px-4 py-3 flex-wrap">
          <button className="btn btn-ghost btn-square btn-sm lg:hidden" onClick={() => setShowSidebar(true)}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
          </button>

          <select
            className={`select select-sm border font-bold text-xs ${methodSelectBg[method]}`}
            value={method}
            onChange={(e) => setMethod(e.target.value as HttpMethod)}
          >
            <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option>
          </select>

          <input
            type="text"
            className="input input-bordered input-sm flex-1 text-xs"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.example.com/v1/..."
          />


          {/* 保存按钮 */}
          <button
            className="btn btn-ghost btn-sm gap-1.5 text-base-content/60"
            onClick={() => {
              if (currentSavedId) {
                quickSave()
              } else {
                setSaveLabel(url.split('/').pop()?.split('?')[0]?.split('.')[0] || '未命名')
                setShowSaveModal(true)
              }
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /></svg>
            保存
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
            <div className="flex items-center gap-1.5 text-xs">
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
        </div>

        {/* ===== 请求配置 Tab ===== */}
        <div className="border-b border-base-200 bg-base-100">
          <div className="flex items-center px-4">
            {(['params', 'headers', 'body', 'auth'] as const).map((tab) => (
              <button key={tab}
                className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
                  activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-base-content/50 hover:text-base-content'
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'params' && 'Params'}
                {tab === 'headers' && 'Headers'}
                {tab === 'body' && 'Body'}
                {tab === 'auth' && 'Auth'}
              </button>
            ))}
          </div>
        </div>

        {/* ===== 请求配置内容 ===== */}
        <div className="flex-1 overflow-y-auto">
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
                <div className="flex items-center gap-2 px-2 text-[10px] text-base-content/30 font-medium uppercase tracking-wider">
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
                    <input type="text" className="input input-ghost input-xs w-1/3 text-xs" placeholder="Key" value={h.key} onChange={(e) => updateHeader(i, 'key', e.target.value)} />
                    <input type="text" className="input input-ghost input-xs w-1/2 text-xs" placeholder="Value" value={h.value} onChange={(e) => updateHeader(i, 'value', e.target.value)} />
                    <button className="btn btn-ghost btn-xs btn-square" onClick={() => removeHeader(i)}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-base-content/30 hover:text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'body' && (
            <div className="p-4 pt-0">
              <div className="sticky top-0 bg-base-100 z-10 pb-3 pt-4 flex items-center gap-2">
                {/* 类型选择器 */}
                <div className="dropdown">
                  <button tabIndex={0} className={`inline-flex items-center gap-1 rounded-md border-l-[3px] px-2 py-1 text-xs font-medium transition-colors ${bodyTypeMeta[bodyType].badge}`}>
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
                <span className="text-xs text-base-content/50">Content-Type: {bodyTypeMeta[bodyType].mime}</span>
              </div>
              <div
                ref={bodyRef}
                className="textarea textarea-bordered w-full min-h-50 p-4 whitespace-pre-wrap break-all text-sm leading-6 overflow-auto font-mono focus:outline-none"
                contentEditable
                suppressContentEditableWarning
                onInput={(e) => setBody((e.target as HTMLElement).textContent || '')}
                onScroll={syncBodyScroll}
                data-placeholder={`输入 ${bodyTypeMeta[bodyType].label}...`}
              />
            </div>
          )}

          {activeTab === 'params' && (
            <div className="flex items-center justify-center h-32 text-xs text-base-content/30">
              URL 查询参数（将在 URL 中附加为 ?key=value）
            </div>
          )}

          {activeTab === 'auth' && (
            <div className="px-6 py-4">
              <div className="flex flex-col gap-4 max-w-md">
                <div className="flex items-center gap-6">
                  <label className="label w-20 shrink-0"><span className="label-text text-xs">认证类型</span></label>
                  <select className="select select-bordered select-sm flex-1">
                    <option>Bearer Token</option>
                    <option>API Key</option>
                    <option>Basic Auth</option>
                    <option>No Auth</option>
                  </select>
                </div>
                <div className="flex items-center gap-6">
                  <label className="label w-20 shrink-0"><span className="label-text text-xs">Token</span></label>
                  <input type="password" className="input input-bordered input-sm flex-1" placeholder="sk-..." defaultValue="sk-ant-••••••••••" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ===== 拖拽手柄 ===== */}
        <div
          className="shrink-0 h-2 cursor-row-resize flex items-center justify-center border-t border-base-200 bg-base-200/30 hover:bg-base-200 transition-colors"
          onMouseDown={onDragStart}
        >
          <div className="w-8 h-0.5 rounded-full bg-base-content/20" />
        </div>

        {/* ===== 响应面板（常显，可拖拽调整高度） ===== */}
        <div className="shrink-0 bg-base-100 flex flex-col" style={{ height: responseHeight }}>
          <div className="flex items-center justify-between border-b border-base-200 px-4 py-2">
            <div className="flex items-center gap-3">
              {response ? (
                <>
                  <div className={`flex items-center gap-1.5 text-sm font-bold ${response.status >= 400 ? 'text-red-500' : 'text-green-600'}`}>
                    <span>{response.status}</span>
                    <span className="text-xs font-normal">{response.statusText}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-base-content/40">
                    <span>⏱ {response.time}</span>
                    <span>📦 {response.size}</span>
                  </div>
                  {concurrentResults && (() => {
                    const s = concurrentResults.filter(r => r.status >= 200 && r.status < 300).length
                    const f = concurrentResults.filter(r => r.status === 0 || r.status >= 400).length
                    return (
                      <div className="flex items-center gap-2 text-[11px] font-medium">
                        <span className="text-green-600">{s}✓</span>
                        {f > 0 && <span className="text-red-500">{f}✗</span>}
                        <span className="text-base-content/30">·</span>
                        <span className="text-base-content/40">{concurrentResults.length} 路</span>
                      </div>
                    )
                  })()}
                </>
              ) : (
                <div className="flex items-center gap-2 text-xs text-base-content/30">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                  点击「发送」调试接口
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button className={`btn btn-ghost btn-xs ${activeResponseTab === 'body' ? 'btn-active' : ''}`} onClick={() => setActiveResponseTab('body')}>Body</button>
              <button className={`btn btn-ghost btn-xs ${activeResponseTab === 'headers' ? 'btn-active' : ''}`} onClick={() => setActiveResponseTab('headers')}>Headers</button>
              <button className={`btn btn-ghost btn-xs ${activeResponseTab === 'concurrent' ? 'btn-active' : ''} ${concurrentMode ? '' : 'opacity-30'}`} onClick={() => setActiveResponseTab('concurrent')}>
                📊 并发
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {response ? (
              activeResponseTab === 'concurrent' ? (
                concurrentResults ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-3 text-[10px] text-base-content/30 font-medium uppercase tracking-wider px-1 pb-1 border-b border-base-200">
                      <span className="w-8 text-center">#</span>
                      <span className="w-16 text-center">状态</span>
                      <span className="w-20 text-center">耗时</span>
                      <span className="flex-1" />
                    </div>
                    {concurrentResults.map((r) => (
                      <div key={r.index} className="flex items-center gap-3 px-1 py-1 text-xs hover:bg-base-200/50 rounded">
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
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-base-content/20 gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M12 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" /><path d="M16 14a8 8 0 1 0-16 0" /></svg>
                    <span>开启并发模式后点击「发送」查看并发结果</span>
                  </div>
                )
              ) : activeResponseTab === 'body' ? (
                <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: highlighters[bodyType](response.body) }} />
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
      </div>

      {/* ========== 删除确认弹窗 ========== */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-xs rounded-box bg-base-100 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </div>
              <h3 className="font-bold text-base">确认删除</h3>
              <p className="text-xs text-base-content/50 mt-1">删除后无法恢复，确定要删除此条历史记录吗？</p>
            </div>
            <div className="mt-5 flex justify-center gap-3">
              <button className="btn btn-ghost btn-sm" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="btn btn-error btn-sm" onClick={confirmDelete}>删除</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 首次保存弹窗 ========== */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowSaveModal(false)}>
          <div className="w-full max-w-sm rounded-box bg-base-100 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">保存配置</h3>
                <p className="text-xs text-base-content/50 mt-0.5">为此请求输入一个名称</p>
              </div>
              <button className="btn btn-ghost btn-square btn-sm" onClick={() => setShowSaveModal(false)}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="输入请求名称..."
              value={saveLabel}
              onChange={(e) => setSaveLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmFirstSave()}
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-3">
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSaveModal(false)}>取消</button>
              <button className="btn btn-primary btn-sm" disabled={!saveLabel.trim()} onClick={confirmFirstSave}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 重命名弹窗 ========== */}
      {renamingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRenamingId(null)}>
          <div className="w-full max-w-sm rounded-box bg-base-100 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">重命名</h3>
                <p className="text-xs text-base-content/50 mt-0.5">修改请求名称</p>
              </div>
              <button className="btn btn-ghost btn-square btn-sm" onClick={() => setRenamingId(null)}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <input
              type="text"
              className="input input-bordered w-full"
              placeholder="输入新名称..."
              value={renameLabel}
              onChange={(e) => setRenameLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-3">
              <button className="btn btn-ghost btn-sm" onClick={() => setRenamingId(null)}>取消</button>
              <button className="btn btn-primary btn-sm" disabled={!renameLabel.trim()} onClick={confirmRename}>确认</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
