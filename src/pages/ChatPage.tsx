import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'

type Message = { id: string; role: 'user' | 'assistant'; content: string; fileName?: string }
type Conversation = { id: string; title: string; messages: Message[]; updatedAt: string }
type Model = { id: string; name: string }

const storageKey = 'zhiyu-ai-conversations'
const modelOptions: Model[] = [
  { id: 'qwen3.7-max', name: 'Qwen3.7-Max' },
  { id: 'qwen3-max', name: 'Qwen3-Max' },
  { id: 'gpt', name: 'GPT' },
  { id: 'claude', name: 'Claude' },
]
const quickPrompts = ['帮我写一份产品需求', '帮我分析一份数据', '帮我优化一段文案', '帮我总结一篇文章', '帮我制定一个工作计划']
const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const timestamp = () => new Date().toISOString()

function readConversations(): Conversation[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]')
    return Array.isArray(saved) ? saved : []
  } catch { return [] }
}

function Icon({ name, className = 'h-4 w-4' }: { name: 'spark' | 'plus' | 'search' | 'send' | 'stop' | 'clip' | 'globe' | 'copy' | 'edit' | 'trash' | 'refresh'; className?: string }) {
  const paths = {
    spark: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7Z" /><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6Z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    send: <><path d="m21 3-7.5 18-3.5-7-7-3.5Z" /><path d="M10 14 21 3" /></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
    clip: <><path d="m20 11.5-7.4 7.4a5 5 0 0 1-7.1-7.1L13 4.3a3.5 3.5 0 0 1 5 5l-7.5 7.5a2 2 0 1 1-2.8-2.8l7-7" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    edit: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z" /><path d="m13.5 7.5 3 3" /></>,
    trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0 2 5" /><path d="M20 5v6h-6" /></>,
  }
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function AssistantMessage({ message, onCopy, onRegenerate, copied }: { message: Message; onCopy: () => void; onRegenerate: () => void; copied: boolean }) {
  return <article className="flex gap-3">
    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon name="spark" /></div>
    <div className="max-w-[85%]">
      <div className="rounded-2xl border border-base-300/70 bg-base-100 px-4 py-3"><p className="whitespace-pre-wrap text-sm leading-7">{message.content || '正在思考…'}</p></div>
      {message.content && <div className="mt-2 flex items-center gap-1 text-base-content/45"><button onClick={onCopy} className="btn btn-ghost btn-xs gap-1">{copied ? '已复制' : <><Icon name="copy" className="h-3.5 w-3.5" />复制</>}</button><button onClick={onRegenerate} className="btn btn-ghost btn-xs gap-1"><Icon name="refresh" className="h-3.5 w-3.5" />重新生成</button></div>}
    </div>
  </article>
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>(readConversations)
  const [activeId, setActiveId] = useState<string | null>(() => readConversations()[0]?.id || null)
  const [question, setQuestion] = useState('')
  const [search, setSearch] = useState('')
  const [model, setModel] = useState(modelOptions[0].id)
  const [webSearch, setWebSearch] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [asking, setAsking] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const active = conversations.find((item) => item.id === activeId) || null
  const filteredConversations = useMemo(() => conversations.filter((item) => item.title.toLowerCase().includes(search.toLowerCase())), [conversations, search])

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(conversations)) }, [conversations])
  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' }) }, [active?.messages.length, asking])

  const updateConversation = (id: string, update: Partial<Conversation>) => setConversations((items) => items.map((item) => item.id === id ? { ...item, ...update, updatedAt: timestamp() } : item))
  const newConversation = () => {
    const conversation: Conversation = { id: createId(), title: '新对话', messages: [], updatedAt: timestamp() }
    setConversations((items) => [conversation, ...items]); setActiveId(conversation.id); setHistoryOpen(false); setQuestion('')
  }

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    const text = question.trim()
    if (!text || asking) return
    let target = active
    if (!target) {
      target = { id: createId(), title: '新对话', messages: [], updatedAt: timestamp() }
      setActiveId(target.id); setConversations((items) => [target!, ...items])
    }
    const userMessage: Message = { id: createId(), role: 'user', content: text, ...(file ? { fileName: file.name } : {}) }
    const assistantId = createId()
    const assistantMessage: Message = { id: assistantId, role: 'assistant', content: '' }
    const messages = [...target.messages, userMessage, assistantMessage]
    updateConversation(target.id, { title: target.title === '新对话' ? text.slice(0, 24) : target.title, messages })
    setQuestion(''); setFile(null); setAsking(true)
    const controller = new AbortController(); abortRef.current = controller
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: target.id, message: text, model, webSearch, fileName: file?.name }), signal: controller.signal })
      if (!response.ok) throw new Error('chat-api')
      const payload = await response.json() as { answer?: string }
      updateConversation(target.id, { messages: messages.map((item) => item.id === assistantId ? { ...item, content: payload.answer || '暂无有效回复。' } : item) })
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      const fallback = `这是一个演示回复。你刚才提到：${text}\n\n接入后端 AI 服务后，我会基于${webSearch ? '联网搜索和' : ''}${modelOptions.find((item) => item.id === model)?.name}继续完成这项工作。`
      updateConversation(target.id, { messages: messages.map((item) => item.id === assistantId ? { ...item, content: fallback } : item) })
    } finally { setAsking(false); abortRef.current = null }
  }

  const stop = () => { abortRef.current?.abort(); abortRef.current = null; setAsking(false) }
  const deleteConversation = (id: string) => { if (!window.confirm('确定删除这条对话吗？')) return; setConversations((items) => items.filter((item) => item.id !== id)); if (activeId === id) setActiveId(null) }
  const copyMessage = async (message: Message) => { await navigator.clipboard?.writeText(message.content); setCopiedId(message.id); window.setTimeout(() => setCopiedId(null), 1400) }
  const regenerate = (message: Message) => { const index = active?.messages.findIndex((item) => item.id === message.id) ?? -1; const previous = index > 0 ? active?.messages[index - 1] : null; if (previous?.role === 'user' && !asking) { setQuestion(previous.content); window.setTimeout(() => void send(), 0) } }
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] || null)
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }

  return <div className="-m-4 flex min-h-140 h-[calc(100vh-4rem)] overflow-hidden bg-base-100 md:-m-6 md:h-[calc(100vh-3rem)]">
    <aside className={`${historyOpen ? 'absolute inset-0 z-20 flex' : 'hidden'} w-full shrink-0 flex-col border-r border-base-300/70 bg-base-100 sm:flex sm:w-72`}>
      <div className="flex items-center justify-between border-b border-base-300/70 px-4 py-4"><div><p className="text-sm font-semibold">对话历史</p><p className="mt-0.5 text-xs text-base-content/45">你的工作搭档</p></div><button className="btn btn-ghost btn-sm btn-square sm:hidden" onClick={() => setHistoryOpen(false)} aria-label="关闭历史">×</button></div>
      <div className="p-3"><button onClick={newConversation} className="btn btn-primary btn-sm w-full justify-start gap-2"><Icon name="plus" />新建对话</button><label className="input input-sm mt-3 flex items-center gap-2 border-base-300/70"><Icon name="search" className="h-3.5 w-3.5 text-base-content/40" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索对话" /></label></div>
      <div className="flex-1 space-y-1 overflow-y-auto px-2 pb-3">{filteredConversations.length ? filteredConversations.map((item) => <div key={item.id} className={`group flex items-center gap-1 rounded-lg px-3 py-2.5 ${item.id === activeId ? 'bg-primary/10 text-primary' : 'hover:bg-base-200/70'}`}><button onClick={() => { setActiveId(item.id); setHistoryOpen(false) }} className="min-w-0 flex-1 text-left"><p className="truncate text-sm font-medium">{item.title}</p><p className="mt-1 text-[11px] text-base-content/40">{item.messages.length} 条消息</p></button><button className="btn btn-ghost btn-xs btn-square opacity-0 group-hover:opacity-100" onClick={() => { const title = window.prompt('重命名对话', item.title); if (title?.trim()) updateConversation(item.id, { title: title.trim() }) }} aria-label="重命名"><Icon name="edit" className="h-3.5 w-3.5" /></button><button className="btn btn-ghost btn-xs btn-square text-error opacity-0 group-hover:opacity-100" onClick={() => deleteConversation(item.id)} aria-label="删除"><Icon name="trash" className="h-3.5 w-3.5" /></button></div>) : <p className="px-3 py-8 text-center text-xs text-base-content/40">暂无对话</p>}</div>
    </aside>
    <section className="flex min-w-0 flex-1 flex-col bg-base-200/20">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-base-300/70 bg-base-100 px-4 md:px-8"><div className="flex items-center gap-3"><button className="btn btn-ghost btn-sm btn-square sm:hidden" onClick={() => setHistoryOpen(true)} aria-label="打开历史"><Icon name="search" /></button><div><h1 className="text-base font-semibold">AI问答</h1><p className="hidden text-xs text-base-content/45 sm:block">让 AI 成为你的工作搭档</p></div></div><label className="select select-sm w-36 border-base-300/70"><select value={model} onChange={(event) => setModel(event.target.value)} aria-label="选择模型">{modelOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></header>
      <div ref={messagesRef} className="flex-1 overflow-y-auto"><div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-8 md:px-8">{active?.messages.length ? <div className="space-y-8">{active.messages.map((message) => message.role === 'user' ? <article key={message.id} className="flex justify-end"><div className="max-w-[85%] rounded-2xl bg-primary px-4 py-3 text-primary-content"><p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>{message.fileName && <p className="mt-2 text-xs opacity-75">📎 {message.fileName}</p>}</div></article> : <AssistantMessage key={message.id} message={message} copied={copiedId === message.id} onCopy={() => void copyMessage(message)} onRegenerate={() => regenerate(message)} />)}</div> : <div className="m-auto w-full max-w-2xl text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon name="spark" className="h-7 w-7" /></div><h2 className="mt-5 text-2xl font-bold tracking-tight">你好，我是你的 AI 工作搭档</h2><p className="mt-2 text-sm text-base-content/50">有什么工作需要我帮你？</p><div className="mt-8 grid gap-2 sm:grid-cols-2">{quickPrompts.map((prompt) => <button key={prompt} onClick={() => { setQuestion(prompt); inputRef.current?.focus() }} className="rounded-xl border border-base-300/70 bg-base-100 px-4 py-3 text-left text-sm transition hover:border-primary/40 hover:bg-primary/5">{prompt}<span className="float-right text-base-content/30">→</span></button>)}</div></div>}</div></div>
      <form onSubmit={(event) => void send(event)} className="border-t border-base-300/70 bg-base-100 px-4 py-4 md:px-8"><div className="mx-auto max-w-4xl">{file && <div className="mb-2 flex w-fit items-center gap-2 rounded-lg border border-base-300/70 bg-base-200/50 px-3 py-1.5 text-xs">📄 {file.name}<button type="button" onClick={() => setFile(null)} className="text-base-content/45">×</button></div>}<div className="flex items-end gap-2 rounded-2xl border border-base-300 bg-base-100 p-2 shadow-sm focus-within:border-primary/50"><label className="btn btn-ghost btn-sm btn-square shrink-0" title="上传文件"><Icon name="clip" /><input type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.md,image/*" onChange={onFileChange} /></label><textarea ref={inputRef} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={onKeyDown} rows={1} placeholder="输入你的问题，Enter 发送，Shift + Enter 换行" className="max-h-32 min-h-10 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm outline-none" /><button type="button" onClick={() => setWebSearch((value) => !value)} className={`btn btn-ghost btn-sm btn-square ${webSearch ? 'text-primary' : 'text-base-content/45'}`} title="联网搜索" aria-label="联网搜索"><Icon name="globe" /></button><button type={asking ? 'button' : 'submit'} onClick={asking ? stop : undefined} className={`btn btn-sm btn-square ${asking ? 'btn-error' : 'btn-primary'}`} disabled={!asking && !question.trim()} aria-label={asking ? '停止生成' : '发送'}><Icon name={asking ? 'stop' : 'send'} /></button></div><p className="mt-2 text-center text-[11px] text-base-content/35">AI 可能会出错，请核验重要信息</p></div></form>
    </section>
  </div>
}
