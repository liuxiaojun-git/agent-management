// 操作日志 — 操作记录列表，展示级别（错误/警告/信息）、时间和详情，支持搜索和日期范围筛选
import { useState, useEffect } from 'react'
import { getLogs, type LogEntry } from '../utils/logStore'
import Pagination from '../components/Pagination'
import SearchInput from '../components/SearchInput'
import DateRangePicker from '../components/DateRangePicker'

const formatCreatedTime = (timestamp: number, fallback: string) => {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return fallback
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export default function OperationLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  useEffect(() => { getLogs('operation').then(setLogs) }, [])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const defaultStart = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth()+1).padStart(2,'0')}-${String(sixMonthsAgo.getDate()).padStart(2,'0')}T${String(sixMonthsAgo.getHours()).padStart(2,'0')}:${String(sixMonthsAgo.getMinutes()).padStart(2,'0')}`
  const now = new Date()
  const defaultEnd = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  const [startDate, setStartDate] = useState(defaultStart)
  const [endDate, setEndDate] = useState(defaultEnd)

  const handleSearch = (val: string) => { setSearch(val); setPage(1) }

  const filtered = logs.filter(log => {
    if (log.timestamp) {
      const t = log.timestamp
      const start = new Date(startDate).getTime()
      const end = new Date(endDate).getTime() + 60000
      if (t < start || t > end) return false
    }
    if (search) {
      const q = search.toLowerCase()
      const match = (s: string) => s.toLowerCase().includes(q)
      if (!match(log.message) && !match(log.detail)) return false
    }
    return true
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize)

  return (
    <div className="h-full flex flex-col">
      {/* 搜索 + 筛选 */}
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <SearchInput placeholder="搜索详情" value={search} onChange={handleSearch} />
        <DateRangePicker startDate={startDate} endDate={endDate} onStartChange={(v) => { setStartDate(v); setPage(1) }} onEndChange={(v) => { setEndDate(v); setPage(1) }} onReset={() => { const d = new Date(); const s = new Date(); s.setMonth(s.getMonth() - 6); setStartDate(`${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}T${String(s.getHours()).padStart(2,'0')}:${String(s.getMinutes()).padStart(2,'0')}`); setEndDate(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`); setPage(1) }} />
      </div>

      {/* 日志列表 */}
      <div className="overflow-auto rounded-lg bg-base-100" style={{ height: 'calc(100vh - 200px)' }}>
        <div className="flex flex-col min-h-full">
          <div className="flex-1">
          <table className="table w-full text-base table-fixed">
            <thead>
            <tr className="text-base text-base-content/60">
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-16">级别</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-20">创建时间</th>
              <th className="sticky top-0 z-10 bg-base-100 text-sm w-100">详情</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-16 text-center text-base-content/20">
                  <div className="flex flex-col items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    <span className="text-sm">暂无日志</span>
                  </div>
                </td>
              </tr>
            ) : paged.map((log) => (
                <tr key={log.id} className="transition-colors hover:bg-base-200">
                  <td className="truncate w-16">
                    <span className={`inline-flex items-center justify-center gap-0.5 rounded-sm h-6 w-16 text-sm font-medium uppercase tracking-wide ${
                      log.level === 'error' ? 'bg-error text-white' : log.level === 'warn' ? 'bg-warning text-white' : 'bg-info text-white'
                    }`}>
                      {log.level === 'error' ? (
                        <><svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>错误</>
                      ) : log.level === 'warn' ? (
                        <><svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>警告</>
                      ) : (
                        <><svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>信息</>
                      )}
                    </span>
                  </td>
                  <td className="text-sm text-base-content truncate w-30" title={formatCreatedTime(log.timestamp, log.time)}>{formatCreatedTime(log.timestamp, log.time)}</td>
                  <td className="text-sm text-base-content truncate" title={`${log.message} · ${log.detail}`}>
                    <span className="truncate block max-w-[150ch]">{log.message}{log.detail ? ' · ' + log.detail : ''}</span>
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
    </div>
  )
}
