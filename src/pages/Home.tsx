import { useCallback, useEffect, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
// base URL 已收敛到 utils/apiBase.ts（原本此处有一份与另外 3 个文件逐字重复的定义）
import { V1_BASE } from '../utils/apiBase'

type Range = 'today' | '7d' | '30d' | 'year' | 'all'
interface DashboardData {
  summary: { calls: number; successful: number; failed: number; successRate: number; totalTokens: number; inputTokens: number; outputTokens: number; averageDuration: number }
  knowledge: { libraries: number; documents: number; folders: number }
  users: number
  models: Array<{ name: string; provider: string; model: string; enabled: boolean }>
  trend: Array<{ label: string; calls: number; success: number; failed: number; tokens: number }>
  apiDistribution: Array<{ name: string; value: number }>
  recentFailures: Array<{ timestamp: number; requestId: string; api: string; model: string; message: string }>
}

const ranges: Array<{ value: Range; label: string }> = [{ value: 'today', label: '今天' }, { value: '7d', label: '近 7 天' }, { value: '30d', label: '近 30 天' }, { value: 'year', label: '本年' }, { value: 'all', label: '全部' }]
const number = (value: number) => value.toLocaleString('zh-CN')
const formatTime = (timestamp: number) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp)).replaceAll('/', '-')

function MetricIcon({ type }: { type: 'calls' | 'success' | 'tokens' | 'speed' }) {
  const paths = {
    calls: <><path d="M4 5h16v11H7l-3 3V5Z" /><path d="M8 9h8M8 12h5" /></>,
    success: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    tokens: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
    speed: <><path d="M4 14a8 8 0 1 1 16 0" /><path d="m12 14 4-4" /><path d="M5 18h14" /></>,
  }
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[type]}</svg>
}

export default function Home() {
  const [range, setRange] = useState<Range>('7d')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const token = localStorage.getItem('access_token')
      const response = await fetch(`${V1_BASE}/dashboard?range=${range}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      const payload = await response.json()
      if (!response.ok || payload.code !== 0) throw new Error(payload.message || '首页数据加载失败')
      setData(payload.data); setUpdatedAt(new Date())
    } catch (cause) { setError(cause instanceof Error ? cause.message : '首页数据加载失败') }
    finally { setLoading(false) }
  }, [range])
  useEffect(() => { void load() }, [load])

  const enabledModels = data?.models.filter((model) => model.enabled) || []
  const maxApiCalls = Math.max(1, ...(data?.apiDistribution.map((item) => item.value) || [1]))
  const cards = data ? [
    { label: '模型调用', value: number(data.summary.calls), note: `${data.summary.successful} 次成功 · ${data.summary.failed} 次失败`, type: 'calls' as const, color: 'text-indigo-600', bg: 'bg-indigo-500/10' },
    { label: '调用成功率', value: `${data.summary.successRate.toFixed(1)}%`, note: data.summary.failed ? `${data.summary.failed} 个失败需要关注` : '当前没有失败调用', type: 'success' as const, color: data.summary.successRate >= 95 ? 'text-emerald-600' : 'text-amber-600', bg: data.summary.successRate >= 95 ? 'bg-emerald-500/10' : 'bg-amber-500/10' },
    { label: 'Token 消耗', value: number(data.summary.totalTokens), note: `输入 ${number(data.summary.inputTokens)} · 输出 ${number(data.summary.outputTokens)}`, type: 'tokens' as const, color: 'text-violet-600', bg: 'bg-violet-500/10' },
    { label: '平均运行时间', value: `${data.summary.averageDuration.toFixed(2)}s`, note: '从请求开始到响应完成', type: 'speed' as const, color: 'text-sky-600', bg: 'bg-sky-500/10' },
  ] : []

  return <div className="h-full overflow-y-auto bg-base-200/25"><div className="mx-auto w-full max-w-none space-y-[clamp(0.75rem,1.2vw,1.5rem)] p-[clamp(0.25rem,0.8vw,1rem)] pb-8">
    <header className="flex flex-col gap-[clamp(0.75rem,1vw,1.25rem)] rounded-2xl border border-base-300/60 bg-base-100 px-[clamp(1rem,2vw,2rem)] py-[clamp(1rem,1.5vw,1.5rem)] shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div><h1 className="text-2xl font-bold tracking-tight">首页</h1><p className="mt-1 text-sm text-base-content/45">集中查看平台调用质量、资源消耗和知识资产状态。</p></div>
      <div className="flex min-w-0 flex-wrap items-center gap-2"><div className="flex max-w-full overflow-x-auto rounded-xl border border-base-300/70 bg-base-200/50 p-1">{ranges.map((item) => <button key={item.value} onClick={() => setRange(item.value)} className={`shrink-0 rounded-lg px-[clamp(0.55rem,1vw,0.85rem)] py-1.5 text-xs font-medium transition ${range === item.value ? 'bg-base-100 text-primary shadow-sm' : 'text-base-content/45 hover:text-base-content'}`}>{item.label}</button>)}</div><button onClick={() => void load()} className="btn btn-ghost btn-sm border border-base-300/70" disabled={loading} title="刷新数据"><svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 9A7 7 0 0 1 18 6l2 6M18 15a7 7 0 0 1-11.9 3L4 12" /></svg></button></div>
    </header>
    {error && <div role="alert" className="flex items-center justify-between rounded-xl border border-error/20 bg-error/8 px-4 py-3 text-sm text-error"><span>{error}</span><button onClick={() => void load()} className="font-medium underline">重新加载</button></div>}
    {loading && !data ? <div className="grid min-h-80 place-items-center rounded-2xl border border-base-300/60 bg-base-100"><span className="loading loading-spinner loading-lg text-primary" /></div> : data && <>
      <section className="grid gap-[clamp(0.75rem,1vw,1rem)] sm:grid-cols-2 lg:grid-cols-4">{cards.map((card) => <article key={card.label} className="rounded-2xl border border-base-300/60 bg-base-100 p-[clamp(1rem,1.4vw,1.5rem)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-start justify-between"><p className="text-sm font-medium text-base-content/50">{card.label}</p><span className={`grid h-10 w-10 place-items-center rounded-xl ${card.bg} ${card.color}`}><MetricIcon type={card.type} /></span></div><p className="mt-4 text-[clamp(1.5rem,2.2vw,2.25rem)] font-bold tracking-tight">{card.value}</p><p className="mt-2 truncate text-xs text-base-content/40" title={card.note}>{card.note}</p></article>)}</section>
      <section className="grid gap-[clamp(0.75rem,1vw,1rem)] lg:grid-cols-[minmax(0,1fr)_clamp(17rem,24vw,23rem)]">
        <article className="rounded-2xl border border-base-300/60 bg-base-100 p-[clamp(1rem,1.4vw,1.5rem)] shadow-sm"><div className="flex items-start justify-between"><div><h2 className="font-semibold">调用趋势</h2><p className="mt-1 text-xs text-base-content/40">成功与失败调用随时间变化</p></div><div className="flex gap-3 text-xs text-base-content/50"><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-primary" />成功</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-error" />失败</span></div></div><div className="mt-5 h-[clamp(14rem,30vh,22rem)]"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 320 }}><BarChart data={data.trend} margin={{ left: -24, right: 8 }}><CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 5" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.45 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.4 }} /><Tooltip /><Bar name="成功" dataKey="success" stackId="calls" fill="var(--color-primary)" radius={[4, 4, 0, 0]} /><Bar name="失败" dataKey="failed" stackId="calls" fill="var(--color-error)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></article>
        <aside className="grid h-full grid-rows-2 gap-[clamp(0.75rem,1vw,1rem)]"><article className="h-full rounded-2xl border border-base-300/60 bg-base-100 p-5 shadow-sm"><h2 className="font-semibold">平台资源</h2><div className="mt-4 grid grid-cols-2 gap-3">{[['知识库', data.knowledge.libraries], ['文档', data.knowledge.documents], ['文件夹', data.knowledge.folders], ['平台用户', data.users]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-base-200/55 p-3"><p className="text-xs text-base-content/45">{label}</p><p className="mt-1 text-xl font-bold">{number(Number(value))}</p></div>)}</div></article>
        <article className="h-full overflow-hidden rounded-2xl border border-base-300/60 bg-base-100 p-5 shadow-sm"><div className="flex items-center justify-between"><h2 className="font-semibold">模型状态</h2><span className="text-xs text-base-content/40">{enabledModels.length}/{data.models.length} 启用</span></div><div className="mt-4 space-y-3 overflow-y-auto">{data.models.map((model) => <div key={`${model.provider}-${model.model}`} className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{model.model || model.name}</p><p className="text-[11px] text-base-content/40">{model.name}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${model.enabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-base-200 text-base-content/40'}`}>{model.enabled ? '运行中' : '已停用'}</span></div>)}</div></article></aside>
      </section>
      <section className="grid gap-[clamp(0.75rem,1vw,1rem)] lg:grid-cols-2">
        <article className="rounded-2xl border border-base-300/60 bg-base-100 p-[clamp(1rem,1.4vw,1.5rem)] shadow-sm"><h2 className="font-semibold">Token 趋势</h2><p className="mt-1 text-xs text-base-content/40">模型上下文资源消耗</p><div className="mt-4 h-[clamp(13rem,24vh,18rem)]"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 280 }}><AreaChart data={data.trend} margin={{ left: -18, right: 8 }}><defs><linearGradient id="tokenArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="4 5" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.45 }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.4 }} /><Tooltip /><Area name="Tokens" type="monotone" dataKey="tokens" stroke="var(--color-primary)" strokeWidth={2.5} fill="url(#tokenArea)" /></AreaChart></ResponsiveContainer></div></article>
        <article className="rounded-2xl border border-base-300/60 bg-base-100 p-5 shadow-sm"><h2 className="font-semibold">接口调用分布</h2><p className="mt-1 text-xs text-base-content/40">识别高频业务与调用集中度</p><div className="mt-5 space-y-4">{data.apiDistribution.length ? data.apiDistribution.map((item) => <div key={item.name}><div className="mb-1.5 flex items-center justify-between gap-4 text-xs"><span className="truncate font-medium text-base-content/65" title={item.name}>{item.name}</span><span className="text-base-content/40">{item.value} 次</span></div><div className="h-2 overflow-hidden rounded-full bg-base-200"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, item.value / maxApiCalls * 100)}%` }} /></div></div>) : <p className="py-16 text-center text-sm text-base-content/35">当前范围暂无调用数据</p>}</div></article>
      </section>
      <section className="overflow-hidden rounded-2xl border border-base-300/60 bg-base-100 shadow-sm"><div className="flex items-center justify-between border-b border-base-300/60 px-5 py-4"><div><h2 className="font-semibold">最近失败调用</h2><p className="mt-1 text-xs text-base-content/40">优先关注影响稳定性的异常请求</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${data.recentFailures.length ? 'bg-error/10 text-error' : 'bg-emerald-500/10 text-emerald-600'}`}>{data.recentFailures.length ? `${data.recentFailures.length} 条` : '运行正常'}</span></div>{data.recentFailures.length ? <div className="overflow-x-auto"><table className="table"><thead><tr><th>时间</th><th>Request ID</th><th>API 接口</th><th>模型</th><th>失败原因</th></tr></thead><tbody>{data.recentFailures.map((failure) => <tr key={`${failure.timestamp}-${failure.requestId}`}><td className="whitespace-nowrap text-xs">{formatTime(failure.timestamp)}</td><td className="max-w-48 truncate font-mono text-xs" title={failure.requestId}>{failure.requestId}</td><td className="max-w-48 truncate text-xs" title={failure.api}>{failure.api}</td><td className="whitespace-nowrap text-xs">{failure.model}</td><td className="max-w-100 truncate text-xs text-error/80" title={failure.message}>{failure.message}</td></tr>)}</tbody></table></div> : <div className="py-12 text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-emerald-500/10 text-emerald-600">✓</div><p className="mt-3 text-sm font-medium">当前范围内没有失败调用</p><p className="mt-1 text-xs text-base-content/40">平台运行状态良好</p></div>}</section>
    </>}
    {updatedAt && <p className="text-right text-[11px] text-base-content/30">数据更新于 {updatedAt.toLocaleTimeString('zh-CN', { hour12: false })}</p>}
  </div></div>
}
