import { useState, useEffect } from 'react'
import { clearLogCache, getLogs, type LogEntry } from '../utils/logStore'
import Pagination from '../components/Pagination'
import SearchInput from '../components/SearchInput'
import DateRangePicker from '../components/DateRangePicker'

const formatCreatedTime = (timestamp: number, fallback: string) => {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return fallback
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// 首字延时为 0（含 0 / 0ms / 0s，常见于即时返回）视为无有效测量，统一用 - 呈现
const formatFirstCharDelay = (value?: string | number | null) => {
  if (value === null || value === undefined || value === '') return '-'
  const text = String(value).trim()
  const n = Number.parseFloat(text)
  if (!Number.isNaN(n) && n === 0) return '-'
  return text
}

export default function RunLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  useEffect(() => {
    let active = true
    const refresh = () => {
      // 问答运行日志由后端直接写入，每次绕过前端缓存读取最新数据。
      clearLogCache('audit')
      getLogs('audit').then((nextLogs) => { if (active) setLogs(nextLogs) })
    }
    refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])
  const [filterApi, setFilterApi] = useState('所有接口')
  const [filterModel, setFilterModel] = useState('所有模型')
  const [filterStatus, setFilterStatus] = useState('所有状态')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const defaultStart = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth()+1).padStart(2,'0')}-${String(sixMonthsAgo.getDate()).padStart(2,'0')}T${String(sixMonthsAgo.getHours()).padStart(2,'0')}:${String(sixMonthsAgo.getMinutes()).padStart(2,'0')}`
  const now = new Date()
  // 默认覆盖到当天结束，避免页面打开后新生成的运行日志落在筛选结束时间之外。
  const defaultEnd = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T23:59`
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)
  const [detailModal, setDetailModal] = useState<LogEntry | null>(null)

  const handleFilterApi = (val: string) => { setFilterApi(val); setPage(1) }
  const handleFilterModel = (val: string) => { setFilterModel(val); setPage(1) }
  const handleFilterStatus = (val: string) => { setFilterStatus(val); setPage(1) }
  const handleSearch = (val: string) => { setSearch(val); setPage(1) }

  // API 接口名称映射
  const apiNames: Record<string, string> = {
    'knowledge/ask': '知识库问答',
    'health/score': '会议健康度评分',
    '/api/chat': 'AI 问答',
    'chat': 'AI 问答',
    'chat/completions': 'AI 问答',
    'cocreate': '纪要校对与共创',
    'summary/clarified': '澄清后纪要生成',
    'summary': '会议纪要生成',
  }

  const displayApi = (path: string) => {
    for (const [key, name] of Object.entries(apiNames)) {
      if (path.includes(key)) return name
    }
    const last = path.split('/').filter(Boolean).pop() || path
    return `${last.charAt(0).toUpperCase() + last.slice(1)} — ${path}`
  }

  const apiOptions = [...new Set(logs.map(l => l.api).filter(Boolean) as string[])].sort()
  const apiDisplayOptions = apiOptions.map(a => ({ value: a, label: displayApi(a) }))
  const modelOptions = [...new Set(logs.map(l => l.model).filter(Boolean) as string[])].sort()

  const filtered = logs.filter(log => {
    if (filterApi !== '所有接口' && log.api !== filterApi) return false
    if (filterModel !== '所有模型' && log.model !== filterModel) return false
    if (filterStatus !== '所有状态' && log.status !== filterStatus) return false
    if (log.timestamp) {
      const t = log.timestamp
      const start = new Date(startDate).getTime()
      const end = new Date(endDate).getTime() + 60000
      if (t < start || t > end) return false
    }
    if (search) {
      const q = search.toLowerCase()
      const match = (s: string) => s.toLowerCase().includes(q)
      if (!match(log.id) && !match(log.requestId || '') && !match(log.userName || '') && !match(log.message) && !match(log.detail) && !match(log.api || '')) return false
    }
    return true
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div className="h-full flex flex-col">
      {/* 搜索 + 筛选 */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <SearchInput placeholder="搜索 Request ID" value={search} onChange={handleSearch} />
        <DateRangePicker startDate={startDate} endDate={endDate} onStartChange={(v) => { setStartDate(v); setPage(1) }} onEndChange={(v) => { setEndDate(v); setPage(1) }} onReset={() => { const d = new Date(); const s = new Date(); s.setMonth(s.getMonth() - 6); setStartDate(`${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}T${String(s.getHours()).padStart(2,'0')}:${String(s.getMinutes()).padStart(2,'0')}`); setEndDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T23:59`); setPage(1) }} />
        <select className="select select-bordered w-40 h-10 min-h-0 rounded-2" value={filterApi} onChange={(e) => handleFilterApi(e.target.value)}>
          <option>所有接口</option>
          {apiDisplayOptions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        <select className="select select-bordered w-40 h-10 min-h-0 rounded-2" value={filterModel} onChange={(e) => handleFilterModel(e.target.value)}>
          <option>所有模型</option>
          {modelOptions.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="select select-bordered w-32 h-10 min-h-0 rounded-2" value={filterStatus} onChange={(e) => handleFilterStatus(e.target.value)}>
          <option>所有状态</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
        </select>
      </div>

      {/* 日志列表 */}
      <div className="overflow-auto rounded-lg bg-base-100" style={{ height: 'calc(100vh - 200px)' }}>
        <div className="flex flex-col min-h-full">
          <div className="flex-1">
          <table className="table w-full text-base table-fixed">
            <thead>
            <tr className="text-base text-base-content/60">
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-30">创建时间</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-20">用户</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-50">Request ID</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-16">状态</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-16">运行时间</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-16">首字延时</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-28">Tokens</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-36">API 接口</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-24">模型</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-30 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-16 text-center text-base-content/20">
                  <div className="flex flex-col items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    <span className="text-sm">暂无日志</span>
                  </div>
                </td>
              </tr>
            ) : paged.map((log) => (
                <tr key={log.id} className="transition-colors hover:bg-base-200">
                  <td className="text-sm text-base-content truncate w-30" title={formatCreatedTime(log.timestamp, log.time)}>{formatCreatedTime(log.timestamp, log.time)}</td>
                  <td className="text-sm text-base-content truncate w-20" title={log.userName || '-'}>{log.userName || '-'}</td>
                  <td className="text-sm text-base-content truncate w-50" title={log.requestId || '-'}>{log.requestId || '-'}</td>
                  <td className="truncate w-30">
                    {log.status ? (
                      <span className={`inline-flex items-center h-6 gap-1 rounded-sm px-2 text-sm font-medium text-white ${log.status === 'success' ? 'bg-success' : 'bg-error/80'}`}>
                        {log.status === 'success' ? '成功' : '失败'}
                      </span>
                    ) : (
                      <span className="text-base-content/30 text-sm">-</span>
                    )}
                  </td>
                  <td className="text-sm text-base-content truncate w-30" title={log.duration || '-'}>{log.duration || '-'}</td>
                  <td className="text-sm text-base-content truncate w-30" title={formatFirstCharDelay(log.firstCharDelay)}>{formatFirstCharDelay(log.firstCharDelay)}</td>
                  <td className="text-sm text-base-content w-28">
                    <div className="grid gap-1 whitespace-nowrap">
                      <span>全部 Token&nbsp;&nbsp;<strong>{log.tokens ?? '-'}</strong></span>
                      <span>输出 Token&nbsp;&nbsp;<strong>{log.outputTokens ?? '-'}</strong></span>
                      <span>输入 Token&nbsp;&nbsp;<strong>{log.inputTokens ?? '-'}</strong></span>
                    </div>
                  </td>
                  <td className="text-sm text-base-content truncate w-36" title={log.api ? displayApi(log.api) : '-'}>{log.api ? displayApi(log.api) : '-'}</td>
                  <td className="text-sm text-base-content truncate w-24" title={log.model || ''}>{log.model || ''}</td>
                  <td className="text-sm text-base-content truncate w-30 text-center">
                    <button className="btn btn-ghost btn-sm text-primary" onClick={() => setDetailModal(log)}>
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="sticky bottom-0 bg-base-100 border-t border-base-200 px-4 py-3 flex justify-end">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={filtered.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
            />
          </div>
        </div>
        </div>

      {/* 操作详情弹窗 */}
      {detailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDetailModal(null)}>
          <div className="w-full max-w-280 rounded-box bg-base-100 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-base">日志详情</h3>
              <button className="btn btn-ghost btn-square btn-sm" onClick={() => setDetailModal(null)}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="divide-y divide-base-200 text-sm overflow-y-auto h-160">
              <div className="flex gap-12 py-3">
                <span className="text-base-content/50 shrink-0 w-24">创建时间：</span>
                <span className="text-base-content">{formatCreatedTime(detailModal.timestamp, detailModal.time)}</span>
              </div>
              <div className="flex gap-12 py-3">
                <span className="text-base-content/50 shrink-0 w-24">用户：</span>
                <span className="text-base-content break-all">{detailModal.userName || '-'}</span>
              </div>
              <div className="flex gap-12 py-3">
                <span className="text-base-content/50 shrink-0 w-24">Request ID：</span>
                <span className="text-base-content break-all">{detailModal.requestId || '-'}</span>
              </div>
              <div className="flex gap-12 py-3">
                <span className="text-base-content/50 shrink-0 w-24">状态：</span>
                <span className={detailModal.status === 'failed' ? 'text-error font-medium' : 'text-base-content'}>
                  {detailModal.status === 'success' ? '成功' : detailModal.status === 'failed' ? '失败' : '-'}
                </span>
              </div>
              <div className="flex gap-12 py-3">
                <span className="text-base-content/50 shrink-0 w-24">运行时间：</span>
                <span className="text-base-content">{detailModal.duration || '-'}</span>
              </div>
              <div className="flex gap-12 py-3">
                <span className="text-base-content/50 shrink-0 w-24">首字延时：</span>
                <span className="text-base-content">{formatFirstCharDelay(detailModal.firstCharDelay)}</span>
              </div>
              <div className="flex gap-12 py-3">
                <span className="text-base-content/50 shrink-0 w-24">Tokens：</span>
                <div className="grid gap-2 text-base-content">
                  <span>全部 Token&nbsp;&nbsp;{detailModal.tokens ?? '-'}</span>
                  <span>输出 Token&nbsp;&nbsp;{detailModal.outputTokens ?? '-'}</span>
                  <span>输入 Token&nbsp;&nbsp;{detailModal.inputTokens ?? '-'}</span>
                </div>
              </div>
              {detailModal.api && (
                <div className="flex gap-12 py-3">
                  <span className="text-base-content/50 shrink-0 w-24">API：</span>
                  <span className="text-base-content">{detailModal.api}</span>
                </div>
              )}
              {detailModal.model && (
                <div className="flex gap-12 py-3">
                  <span className="text-base-content/50 shrink-0 w-24">模型：</span>
                  <span className="text-base-content">{detailModal.model}</span>
                </div>
              )}
              {detailModal.detail && (
                <div className="flex gap-12 py-3">
                  <span className="text-base-content/50 shrink-0 w-24">详情内容：</span>
                  <span className="text-base-content whitespace-pre-wrap">{detailModal.detail}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
