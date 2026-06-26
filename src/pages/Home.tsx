// 首页 — 核心数据看板，展示消息数、活跃用户、费用消耗等统计指标，含柱状图和面积图
import { useState } from 'react'
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'

const timeRanges = ['今天', '7天', '30天', '年', '所有时间'] as const
type TimeRange = typeof timeRanges[number]

const _now = new Date()
const _currentMonth = _now.getMonth() + 1

// 年视图各月基础数据（1~12月）
const yearMessages = [2100, 2450, 2800, 3100, 3400, 3750, 4100, 3800, 3500, 4200, 3850, 4470]
const yearUsers    = [180,  210,  240,  265,  290,  320,  350,  325,  298,  360,  330,  380]
const yearCost     = [13.5, 15.8, 18.2, 20.1, 22.0, 24.3, 26.8, 24.5, 22.8, 27.4, 25.0, 29.5]
const yearAvgCalls = [11.7, 11.7, 11.7, 11.7, 11.7, 11.7, 11.7, 11.7, 11.7, 11.7, 11.7, 11.8]

const mockData: Record<TimeRange, { messages: number; users: number; cost: number; avgCalls: number }> = {
  '今天':      { messages: 365,   users: 142, cost: 2.45,  avgCalls: 2.6 },
  '7天':       { messages: 856,   users: 156, cost: 5.47,  avgCalls: 5.5 },
  '30天':      { messages: 17680, users: 2450, cost: 108.50, avgCalls: 7.2 },
  '年':        {
    messages: yearMessages.slice(0, _currentMonth).reduce((a, b) => a + b, 0),
    users: yearUsers.slice(0, _currentMonth).reduce((a, b) => a + b, 0),
    cost: Math.round(yearCost.slice(0, _currentMonth).reduce((a, b) => a + b, 0) * 100) / 100,
    avgCalls: Math.round(yearAvgCalls.slice(0, _currentMonth).reduce((a, b) => a + b, 0) / _currentMonth * 10) / 10,
  },
  '所有时间':    { messages: 93200, users: 6210, cost: 582.45, avgCalls: 15.0 },
}

const trendData: Record<TimeRange, Record<string, number[]>> = {
  '今天':      { messages: [5,3,8,6,4,7,9,12,15,18,10,14,20,16,22,25,28,18,30,24,26,20,15,10], users: [2,1,3,2,1,3,4,5,6,8,4,6,9,7,10,11,13,8,14,10,12,9,7,5], cost: [0.03,0.02,0.05,0.04,0.03,0.05,0.06,0.08,0.10,0.12,0.07,0.09,0.14,0.10,0.15,0.17,0.19,0.12,0.21,0.16,0.18,0.14,0.10,0.07], avgCalls: [2.5,3.0,2.7,3.0,2.0,2.3,2.3,2.4,2.5,2.3,2.5,2.3,2.2,2.3,2.2,2.3,2.2,2.3,2.1,2.4,2.2,2.2,2.1,2.0] },
  '7天':       { messages: [85,98,120,110,132,95,140], users: [18,22,28,26,30,20,32], cost: [0.55,0.62,0.78,0.71,0.85,0.60,0.91], avgCalls: [4.7,4.5,4.3,4.2,4.4,4.8,4.4] },
  '30天':      { messages: [520,680,450,720,580,620,490,750,530,660,410,590,470,700,510,640,430,670,500,630,460,690,480,650,420,710,440,610,370,800], users: [85,105,70,115,92,98,78,120,88,102,65,95,75,110,82,100,68,108,80,96,72,112,76,98,66,118,74,90,58,132], cost: [3.2,4.1,2.8,4.5,3.6,3.9,3.0,4.8,3.3,4.0,2.5,3.7,2.9,4.3,3.1,3.8,2.6,4.2,3.0,3.9,2.7,4.4,2.8,4.0,2.5,4.6,2.7,3.6,2.2,5.8], avgCalls: [6.1,6.5,6.4,6.3,6.3,6.3,6.3,6.3,6.0,6.5,6.3,6.2,6.3,6.4,6.2,6.4,6.3,6.2,6.3,6.4,6.4,6.2,6.3,6.6,6.4,6.0,5.9,6.8,6.4,6.9] },
  '年':        {
    messages: yearMessages.slice(0, _currentMonth),
    users: yearUsers.slice(0, _currentMonth),
    cost: yearCost.slice(0, _currentMonth),
    avgCalls: yearAvgCalls.slice(0, _currentMonth),
  },
  '所有时间':   { messages: [3200,8600,16500,28500,36400], users: [280,720,1350,2180,2680], cost: [18.5,52.0,108.0,185.0,219.0], avgCalls: [11.4,11.9,12.2,13.1,14.2] },
}

// 生成 X 轴标签
function getXLabels(range: TimeRange): string[] {
  const now = new Date()
  const map: Record<TimeRange, string[]> = {
    '今天':      Array.from({ length: 24 }, (_, i) => `${i}:00`).map((_, i, a) => i === a.length - 1 ? `${now.getHours()}:00` : `${i}:00`),
    '7天':       Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - (6 - i)); return i === 6 ? '今天' : `${d.getMonth() + 1}/${d.getDate()}` }),
    '30天':      Array.from({ length: 30 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - (29 - i)); return i === 29 ? '今天' : `${d.getMonth() + 1}/${d.getDate()}` }),
    '年':        Array.from({ length: _currentMonth }, (_, i) => `${i + 1}月`),
    '所有时间':   Array.from({ length: 5 }, (_, i) => `${2022 + i}`).map((_, i, a) => i === a.length - 1 ? `${now.getFullYear()}` : `${2022 + i}`),
  }
  return map[range]
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="px-3 py-2 text-sm border shadow-sm rounded-xl border-base-200 bg-base-100">
      <p className="font-medium text-base-content">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.name === '活跃用户' ? '#10b981' : 'var(--color-primary, oklch(0.546 0.245 262.881))' }}>{p.name}: {p.value}</p>
      ))}
    </div>
  )
}

export default function Home() {
  const [range, setRange] = useState<TimeRange>('今天')
  const data = mockData[range]
  const trend = trendData[range]
  const xLabels = getXLabels(range)

  // 图表数据
  const chartData = trend.messages.map((v, i) => ({
    label: xLabels[i] || '',
    '消息数': v,
    '活跃用户': trend.users[i],
  }))
  const costChartData = trend.cost.map((v, i) => ({
    label: xLabels[i] || '',
    '费用(¥)': Math.round(v * 100) / 100,
  }))

  const cards = [
    { label: '全部消息数', value: data.messages.toLocaleString(), color: 'var(--color-primary, oklch(0.546 0.245 262.881))' },
    { label: '活跃用户数', value: data.users.toLocaleString(), color: '#10b981' },
    { label: '费用消耗', value: `¥${data.cost.toFixed(2)}`, color: '#f59e0b', detail: `${Math.round(data.cost / 0.002 * 1000).toLocaleString()} Tokens` },
    { label: '平均用户调用次数', value: `${data.avgCalls}`, color: '#8b5cf6' },
  ]

  return (
    <div className="h-full overflow-y-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-base-content">首页</h1>
        <div className="flex items-center gap-2">
          {timeRanges.map(t => (
            <button key={t} className={`btn btn-sm ${range === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setRange(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* 核心指标 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-5">
        {cards.map((card, idx) => (
          <div key={idx} className="rounded-2xl border-2 border-base-300 bg-base-100 p-4 transition-all hover:border-primary/20 hover:shadow-md">
            <p className="text-xs font-black text-base-content/60">{card.label}</p>
            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-2xl font-bold tracking-tight text-base-content">{card.value}</span>
              {card.detail && <span className="text-xs text-base-content/40">{card.detail}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* 图表区域 */}
      <div>
        <h2 className="text-base font-semibold mb-4">数据统计</h2>
        <div className="flex flex-col gap-5">
          {/* 消息/用户柱状图 */}
          <div className="p-5 border shadow-sm rounded-xl border-base-200 bg-base-100">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-semibold">消息概况</h3>
              <div className="flex items-center gap-3 text-xs text-base-content/50">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: 'var(--color-primary, oklch(0.546 0.245 262.881))' }} />消息数</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" />活跃用户</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} barGap={4} margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0% 0 0 / 0.08)" />
                <XAxis dataKey="label" interval={0} tick={{ fontSize: 12, fill: 'oklch(0% 0 0 / 0.5)' }} axisLine={false} tickLine={false} minTickGap={0} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'oklch(0% 0 0 / 0.04)' }} />
                <Bar dataKey="消息数" fill="var(--color-primary, oklch(0.546 0.245 262.881))" radius={[3, 3, 0, 0]} maxBarSize={48} />
                <Bar dataKey="活跃用户" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 费用面积图 */}
          <div className="p-5 border shadow-sm rounded-xl border-base-200 bg-base-100">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-semibold">费用概况</h3>
              <div className="flex items-center gap-3 text-xs text-base-content/50">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-amber-500" />费用 (¥)</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={costChartData} margin={{ left: 15, right: 15 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0% 0 0 / 0.08)" />
                <XAxis dataKey="label" interval={0} tick={{ fontSize: 12, fill: 'oklch(0% 0 0 / 0.5)' }} axisLine={false} tickLine={false} minTickGap={0} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="费用(¥)" stroke="#f59e0b" fill="rgba(245,158,11,0.15)" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}
