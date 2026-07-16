// 模型管理 — AI 模型配置管理，支持模型列表展示、启用/停用、参数编辑等操作
import { useState, useEffect } from 'react'
import { addLog } from '../utils/logStore'
import { apiRequest } from '../utils/api'

interface ModelProvider {
  id: string
  name: string
  provider: string
  models: string[]
  enabled: boolean
  endpoint: string
  keyPreview: string
  latency: string
}

const mockProviders: ModelProvider[] = [
  { id: '1', name: '阿里云百炼', provider: 'dashscope', models: ['qwen-max'], enabled: true, endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyPreview: 'sk-2a8f4c19d7b65e03ef', latency: '320ms' },
  { id: '2', name: 'DeepSeek', provider: 'deepseek', models: ['deepseek-reasoner-v4'], enabled: false, endpoint: 'https://api.deepseek.com/v1', keyPreview: 'sk-9c3e7f21a8b40d56cd', latency: '450ms' },
]

const maskKey = (key: string) => {
  if (key.length <= 12) return key
  return key.slice(0, 8) + '••••' + key.slice(-4)
}

const modelColors: Record<string, string> = {
  dashscope: 'border-l-cyan-500',
  deepseek: 'border-l-blue-600',
}

const FILE_KEY = 'model-providers'

async function loadProviders(): Promise<typeof mockProviders> {
  try {
    const result = await apiRequest<typeof mockProviders>('get', FILE_KEY)
    if (result.success && result.data) return result.data
  } catch { /* ignore */ }
  // 本地兜底
  try {
    const saved = localStorage.getItem(FILE_KEY)
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return mockProviders
}

async function saveProviders(data: typeof mockProviders) {
  try {
    await apiRequest('set', FILE_KEY, data)
  } catch { /* ignore */ }
  localStorage.setItem(FILE_KEY, JSON.stringify(data))
}

export default function Models() {
  const [providers, setProviders] = useState<typeof mockProviders>(mockProviders)
  const [editingId, setEditingId] = useState<string | null>(null)
  useEffect(() => { loadProviders().then(setProviders) }, [])

  const toggleProvider = (id: string) => {
    setProviders(prev => {
      const p = prev.find(x => x.id === id)
      const updated = prev.map(x => x.id === id ? { ...x, enabled: !x.enabled } : x)
      saveProviders(updated)
      if (p) addLog({ time: new Date().toLocaleString('zh-CN', { hour12: false }), level: 'info', source: '模型', message: `用户 admin 切换模型服务商状态: ${p.name} → ${p.enabled ? '禁用' : '启用'}`, detail: `提供商: ${p.provider}`, category: 'operation', status: 'success' })
      return updated
    })
  }

  return (
    <div>
      {/* 标题栏 */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">模型管理</h1>
          <p className="text-base-content/60 mt-1"></p>
        </div>
        <button className="btn btn-primary">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          新增服务商
        </button>
      </div>

      {/* 服务商列表 */}
      <div className="flex flex-col gap-4">
        {providers.map((p) => (
          <div
            key={p.id}
            className={`rounded-box border border-base-200 bg-base-100 shadow-sm transition-all hover:shadow-md ${p.enabled ? '' : 'opacity-60'}`}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between border-b border-base-200 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className={`h-9 w-9 rounded-lg border-l-[3px] ${modelColors[p.provider] ?? 'border-l-base-300'} bg-base-200/50 flex items-center justify-center text-sm font-bold`}>
                  {p.name.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{p.name}</h3>
                    <span className="text-xs text-base-content/40">{p.provider}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-base-content/50">
                    <span>{p.models.length} 个模型</span>
                    {p.enabled && <span className="flex items-center gap-1">⚡ {p.latency}</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button className="btn btn-ghost btn-sm btn-square" onClick={() => setEditingId(editingId === p.id ? null : p.id)}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                </button>
                <input type="checkbox" className="toggle toggle-primary toggle-sm" checked={p.enabled} onChange={() => toggleProvider(p.id)} />
              </div>
            </div>

            {/* 模型列表 */}
            <div className="flex flex-wrap gap-2 px-5 py-3">
              {p.models.map((m) => (
                <span key={m} className="badge badge-outline badge-sm gap-1">
                  {p.enabled ? '🟢' : '⚪'} {m}
                </span>
              ))}
            </div>

            {/* 编辑面板 */}
            {editingId === p.id && (
              <div className="border-t border-base-200 px-5 py-4">
                <div className="grid grid-cols-1 sm:grid-cols-1 gap-6">
                  <div className="flex items-center gap-6">
                    <label className="label w-16 shrink-0"><span className="label-text text-xs">Endpoint</span></label>
                    <input type="text" className="input input-bordered input-sm w-180" defaultValue={p.endpoint} />
                  </div>
                  <div className="flex items-center gap-6">
                    <label className="label w-16 shrink-0"><span className="label-text text-xs">API Key</span></label>
                    <input type="text" className="input input-bordered input-sm font-mono text-xs w-180" defaultValue={maskKey(p.keyPreview)} placeholder="输入密钥..." readOnly />
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button className="btn btn-ghost btn-xs">测试连接</button>
                  <button className="btn btn-primary btn-xs" onClick={() => addLog({ time: new Date().toLocaleString('zh-CN', { hour12: false }), level: 'info', source: '模型', message: `用户 admin 更新模型服务商配置: ${p.name}`, detail: `Endpoint: ${p.endpoint}`, category: 'operation', status: 'success' })}>保存</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
