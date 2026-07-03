import { useState, useEffect } from 'react'
import { getLogs, type LogEntry } from '../utils/logStore'
import Pagination from '../components/Pagination'
import SearchInput from '../components/SearchInput'
import DateRangePicker from '../components/DateRangePicker'

export default function RunLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  useEffect(() => { getLogs('audit').then(setLogs) }, [])
  const [filterApi, setFilterApi] = useState('所有接口')
  const [filterModel, setFilterModel] = useState('所有模型')
  const [filterStatus, setFilterStatus] = useState('所有状态')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const defaultStart = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth()+1).padStart(2,'0')}-${String(sixMonthsAgo.getDate()).padStart(2,'0')}T${String(sixMonthsAgo.getHours()).padStart(2,'0')}:${String(sixMonthsAgo.getMinutes()).padStart(2,'0')}`
  const now = new Date()
  const defaultEnd = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)
  const [detailModal, setDetailModal] = useState<LogEntry | null>(null)

  const handleFilterApi = (val: string) => { setFilterApi(val); setPage(1) }
  const handleFilterModel = (val: string) => { setFilterModel(val); setPage(1) }
  const handleFilterStatus = (val: string) => { setFilterStatus(val); setPage(1) }
  const handleSearch = (val: string) => { setSearch(val); setPage(1) }

  // API 接口名称映射
  const apiNames: Record<string, string> = {
    'health/score': '会议健康度评分',
    'chat/completions': 'Chat — 对话',
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
      if (!match(log.id) && !match(log.message) && !match(log.detail) && !match(log.api || '')) return false
    }
    return true
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div className="h-full flex flex-col">
      {/* 搜索 + 筛选 */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <SearchInput placeholder="搜索 Minutes ID" value={search} onChange={handleSearch} />
        <DateRangePicker startDate={startDate} endDate={endDate} onStartChange={(v) => { setStartDate(v); setPage(1) }} onEndChange={(v) => { setEndDate(v); setPage(1) }} onReset={() => { const d = new Date(); const s = new Date(); s.setMonth(s.getMonth() - 6); setStartDate(`${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}T${String(s.getHours()).padStart(2,'0')}:${String(s.getMinutes()).padStart(2,'0')}`); setEndDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`); setPage(1) }} />
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
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-30">开始时间</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-50">Minutes ID</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-16">状态</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-16">运行时间</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-16">首字延时</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-16">Tokens</th>
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
                  <td className="text-sm text-base-content truncate w-30" title={log.time}>{log.time}</td>
                  <td className="text-sm text-base-content truncate w-50" title={log.id}>{log.id}</td>
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
                  <td className="text-sm text-base-content truncate w-30" title={log.firstCharDelay || '-'}>{log.firstCharDelay || '-'}</td>
                  <td className="text-sm text-base-content truncate w-30" title={log.tokens !== undefined && log.tokens !== null ? log.tokens.toLocaleString() : '0'}>{log.tokens !== undefined && log.tokens !== null ? log.tokens.toLocaleString() : '0'}</td>
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
                <span className="text-base-content/50 shrink-0 w-24">开始时间：</span>
                <span className="text-base-content">{detailModal.time}</span>
              </div>
              {detailModal.id && (
                <div className="flex gap-12 py-3">
                  <span className="text-base-content/50 shrink-0 w-24">Minutes ID：</span>
                  <span className="text-base-content break-all">{detailModal.id}</span>
                </div>
              )}
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
                <span className="text-base-content">{detailModal.firstCharDelay || '-'}</span>
              </div>
              <div className="flex gap-12 py-3">
                <span className="text-base-content/50 shrink-0 w-24">总 Token 数：</span>
                <span className="text-base-content">{detailModal.tokens !== undefined && detailModal.tokens !== null ? `${detailModal.tokens.toLocaleString()} Tokens` : '0 Tokens'}</span>
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
