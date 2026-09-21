import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CHAT_MODEL_KEY, type ChatConversation, type ChatFile, type ChatMessage, type ChatModel, buildTitleFromPrompt, createBackendConversation, createConversation, createConversationId, deleteBackendConversation, getBackendConversations, getBackendMessages, getModels, saveSelectedModel, stopChat, streamChat, uploadChatFile } from '../services/chatService'
import { clearLogCache } from '../utils/logStore'
import { renderAssistantBlocks } from '../utils/assistantMarkdown'
// 与知识库同一套操作外观：⋯ 浮层菜单、弹窗、图标。
import { Dialog, DialogActions, DialogError, DialogField, DialogHeader, Icon, MenuAction, RowMenuPopover, RowMenuTrigger } from '../components/OperationUI'
import { menuIcons, useRowMenu } from '../components/operationMenu'

const quickPrompts = [
  '帮我写一份产品需求',
  '帮我分析一份数据',
  '帮我优化一段文案',
  '帮我总结一篇文章',
  '帮我制定一个工作计划',
]

function formatTime(date: string) {
  return new Date(date).toLocaleString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  })
}

function renderAssistantText(text: string) {
  // 与知识库问答一致：正文按 Markdown 渲染标题层级、有序/无序/嵌套列表、加粗与行内代码。
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return renderAssistantBlocks(normalized)
}

async function copyMessage(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  }
}

export default function AiChatPage() {
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [models, setModels] = useState<ChatModel[]>([])
  const [modelLoadError, setModelLoadError] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [files, setFiles] = useState<ChatFile[]>([])
  const [webSearch, setWebSearch] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState('')
  const [deleteConversationId, setDeleteConversationId] = useState('')
  const [renamingConversation, setRenamingConversation] = useState<ChatConversation | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState('')
  // 没选模型时不再用 window.alert 打断：那条提示就地显示在输入框上方，改完模型发下一条就消失。
  const [sendHint, setSendHint] = useState('')
  const [searchText, setSearchText] = useState('')
  // 对话历史行的「⋯」。和知识库同一个 hook：同一时刻只开一个、fixed 定位、滚出视口就收。
  const rowMenu = useRowMenu()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null)
  const conversationsRef = useRef<ChatConversation[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentMessageIdRef = useRef('')
  const currentConversationIdRef = useRef('')

  const activeConversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  )

  const updateConversation = useCallback((next: ChatConversation) => {
    setConversations((current) => {
      const filtered = current.filter((item) => item.id !== next.id)
      return [next, ...filtered]
    })
  }, [])

  useEffect(() => {
    void getBackendConversations().then((list) => {
      setConversations(list)
      setActiveConversationId((current) => current || list[0]?.id || '')
    }).catch(() => setConversations([]))
    void getModels().then((list) => {
      setModelLoadError('')
      setModels(list)
      const savedSelection = localStorage.getItem(CHAT_MODEL_KEY)
      let nextSelected = list[0]?.id || ''
      if (savedSelection) {
        try {
          const parsed = JSON.parse(savedSelection) as { selectedModelId?: string }
          if (parsed.selectedModelId && list.some((model) => model.id === parsed.selectedModelId)) {
            nextSelected = parsed.selectedModelId
          }
        } catch {
          // ignore invalid cached selection
        }
      }
      if (nextSelected) {
        setSelectedModelId(nextSelected)
      }
    }).catch((error) => {
      setModels([])
      setModelLoadError(error instanceof Error ? error.message : '无法连接模型服务')
    })
  }, [])

  useEffect(() => {
    const conversation = conversations.find((item) => item.id === activeConversationId)
    if (!conversation || conversation.messages.length > 0 || !conversation.backendId) return
    void getBackendMessages(conversation.backendId).then((messages) => {
      updateConversation({ ...conversation, messages })
    }).catch(() => undefined)
  }, [activeConversationId, conversations, updateConversation])

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeConversation?.messages.length, isGenerating])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }, [prompt])

  const createNewConversation = () => {
    const item = createConversation('新对话')
    setConversations((current) => [item, ...current])
    setActiveConversationId(item.id)
    setPrompt('')
    setFiles([])
    setEditingMessageId('')
  }

  const selectConversation = (id: string) => {
    // 切换会话时收起未完成的内联编辑，避免编辑态残留到其他会话
    setEditingMessageId('')
    setPrompt('')
    setActiveConversationId(id)
  }

  const ensureActiveConversation = () => {
    if (!activeConversation) {
      const next = createConversation('新对话')
      setConversations((current) => [next, ...current])
      setActiveConversationId(next.id)
      return next
    }
    return activeConversation
  }

  const runSend = async (rawText: string, editingMessageIdOverride: string) => {
    const text = rawText.trim()
    if (!text && files.length === 0) return
    if (!selectedModelId) {
      setSendHint('请先在模型管理中配置至少一个启用的模型。')
      return
    }
    setSendHint('')

    const sourceConversation = ensureActiveConversation()
    const editingIndex = editingMessageIdOverride
      ? sourceConversation.messages.findIndex((message) => message.id === editingMessageIdOverride)
      : -1
    const editingMessage = editingIndex >= 0 ? sourceConversation.messages[editingIndex] : undefined
    // 编辑已有问题时保留原消息已上传的附件，避免重新生成时丢失
    const userFiles = editingMessage?.files?.length ? editingMessage.files : files
    const conversation = editingIndex >= 0
      ? {
          ...sourceConversation,
          id: createConversationId(),
          backendId: undefined,
          messages: sourceConversation.messages.slice(0, editingIndex),
        }
      : sourceConversation
    const userMessage: ChatMessage = {
      id: createConversationId(),
      role: 'user',
      content: text || '我已上传文件，请协助查看。',
      createdAt: new Date().toISOString(),
      files: userFiles,
    }

    const assistantMessage: ChatMessage = {
      id: createConversationId(),
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    }

    try {
      const backendId = conversation.backendId || await createBackendConversation(
        buildTitleFromPrompt(text || '新对话'),
        selectedModelId,
      )
      currentConversationIdRef.current = backendId
      const nextConversation: ChatConversation = {
        ...conversation,
        backendId,
        title: conversation.messages.length === 0 ? buildTitleFromPrompt(text || '新对话') : conversation.title,
        updatedAt: new Date().toISOString(),
        messages: [...conversation.messages, userMessage, assistantMessage],
      }
      updateConversation(nextConversation)
      if (conversation.id !== sourceConversation.id) {
        setConversations((current) => [nextConversation, ...current.filter((item) => item.id !== sourceConversation.id)])
        setActiveConversationId(nextConversation.id)
      }
      setPrompt('')
      setFiles([])
      setEditingMessageId('')
      setIsGenerating(true)
      const controller = new AbortController()
      abortControllerRef.current = controller
      await streamChat(
        backendId,
        text || '请帮我分析已上传文件内容。',
        selectedModelId,
        userFiles.filter((file) => file.status === 'parsed').map((file) => file.id),
        webSearch,
        controller.signal,
        {
          onStart: (messageId) => {
            currentMessageIdRef.current = messageId
            updateConversation({
              ...nextConversation,
              messages: nextConversation.messages.map((message, index) => index === nextConversation.messages.length - 1 ? { ...message, id: messageId, status: 'streaming', model: selectedModelId } : message),
            })
          },
          onDelta: (content) => {
            setConversations((current) => current.map((item) => item.id !== conversation.id ? item : {
              ...item,
              updatedAt: new Date().toISOString(),
              messages: item.messages.map((message, index) => index === item.messages.length - 1 ? { ...message, content: `${message.content}${content}`, status: 'streaming' } : message),
            }))
          },
          onDone: (data) => {
            setConversations((current) => current.map((item) => item.id !== conversation.id ? item : {
              ...item,
              updatedAt: new Date().toISOString(),
              messages: item.messages.map((message, index) => index === item.messages.length - 1 ? { ...message, status: data.stopped ? 'stopped' : 'completed', usage: data.usage, sources: data.sources } : message),
            }))
          },
        },
      )
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '模型请求失败，请稍后重试。'
      if (abortControllerRef.current?.signal.aborted) return
      setConversations((current) => current.map((item) => item.id !== conversation.id ? item : {
        ...item,
        updatedAt: new Date().toISOString(),
        messages: item.messages.length === 0
          ? [{ id: createConversationId(), role: 'assistant', content: `调用模型失败：${errorMessage}`, createdAt: new Date().toISOString(), status: 'failed' }]
          : item.messages.map((message, index) => index === item.messages.length - 1 ? { ...message, content: message.content || `调用模型失败：${errorMessage}`, status: 'failed' } : message),
      }))
    } finally {
      setIsGenerating(false)
      abortControllerRef.current = null
      clearLogCache('audit')
    }
  }

  const handleSend = () => {
    void runSend(prompt, '')
  }

  const handleSubmitEdit = () => {
    const text = prompt.trim()
    if (!text || isGenerating) return
    void runSend(text, editingMessageId)
  }

  const handleCancelEdit = () => {
    setEditingMessageId('')
    setPrompt('')
  }

  const handleStop = async () => {
    const messageId = currentMessageIdRef.current
    const conversationId = currentConversationIdRef.current
    if (messageId && conversationId) await stopChat(conversationId, messageId).catch(() => undefined)
    abortControllerRef.current?.abort()
    setIsGenerating(false)
  }

  const handleEditMessage = (message: ChatMessage) => {
    // 与知识库一致：在原消息位置就地编辑，文本写入底部编辑卡片而非输入框
    setEditingMessageId(message.id)
    setPrompt(message.content || '')
  }

  const handleCopyMessage = async (message: ChatMessage) => {
    if (await copyMessage(message.content)) {
      setCopiedMessageId(message.id)
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? '' : current), 1200)
    }
  }

  const handleDeleteConversation = (id: string) => {
    const target = conversations.find((item) => item.id === id)
    if (target?.backendId) void deleteBackendConversation(target.backendId).catch(() => undefined)
    const next = conversations.filter((item) => item.id !== id)
    setConversations(next)
    setEditingMessageId('')
    setPrompt('')
    if (activeConversationId === id) {
      setActiveConversationId(next[0]?.id || '')
    }
  }

  const confirmDeleteConversation = () => {
    if (!deleteConversationId) return
    handleDeleteConversation(deleteConversationId)
    setDeleteConversationId('')
  }

  // 重命名改成弹窗而不是 window.prompt：弹窗能显示是哪条对话、能就地报错，
  // 也和知识库的重命名长成同一个样子。
  const openRenameConversation = (conversation: ChatConversation) => {
    setRenamingConversation(conversation)
    setRenameValue(conversation.title)
    setRenameError('')
  }

  const renameConversation = () => {
    const target = renamingConversation
    if (!target) return
    const nextTitle = renameValue.trim()
    if (!nextTitle) { setRenameError('请输入对话名称'); return }
    setConversations((current) => current.map((item) => item.id === target.id ? { ...item, title: nextTitle } : item))
    setRenamingConversation(null)
    setRenameError('')
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(event.target.files || [])
    if (incoming.length === 0) return
    const pending = incoming.map((file) => ({ id: createConversationId(), name: file.name, size: file.size, type: file.type, status: 'uploading' as const }))
    setFiles((current) => [...current, ...pending])
    event.target.value = ''
    await Promise.all(incoming.map(async (file, index) => {
      try {
        const uploaded = await uploadChatFile(file)
        setFiles((current) => current.map((item) => item.id === pending[index].id ? { ...uploaded, id: uploaded.id, status: uploaded.status } : item))
      } catch {
        setFiles((current) => current.map((item) => item.id === pending[index].id ? { ...item, status: 'failed' } : item))
      }
    }))
  }

  const filteredConversations = conversations
    .filter((item) => {
      if (!searchText.trim()) return true
      return item.title.toLowerCase().includes(searchText.toLowerCase()) || item.messages.some((message) => message.content.toLowerCase().includes(searchText.toLowerCase()))
    })
    // 历史对话按最近更新时间倒序，最新的会话始终排在最上面
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  const selectedModel = models.find((model) => model.id === selectedModelId) || models[0]
  const selectedModelName = selectedModel?.name || '未选择'

  if (models.length === 0) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center rounded-2xl border border-base-300/60 bg-base-100 shadow-sm">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-3xl text-primary">🤖</div>
          <h2 className="text-xl font-semibold">暂无可用模型</h2>
          <p className="mt-2 text-sm text-base-content/60">{modelLoadError || '请在后端配置至少一个启用且已设置 API Key 的模型后再使用 AI 问答。'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-6 shrink-0">
        <h1 className="text-2xl font-bold">AI 问答</h1>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-base-300/60 bg-base-100 shadow-sm">
      <aside className="hidden w-72 shrink-0 border-r border-base-300/60 bg-base-200/30 p-4 md:flex md:flex-col">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">对话历史</h2>
          <button type="button" onClick={createNewConversation} className="btn btn-primary btn-sm rounded-full px-3">
            + 新建对话
          </button>
        </div>

        <div className="mb-4">
          <input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="搜索"
            className="input input-bordered input-sm w-full"
          />
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          {filteredConversations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-base-300 p-4 text-sm text-base-content/50">
              暂无对话
            </div>
          ) : (
            filteredConversations.map((conversation) => {
              // 与知识库的知识库行一致：操作收进一个「⋯」，不再是并排两个字号更小的字符按钮
              // （✎ / ✕ 长短不一、看不出是图标还是文字，删除还没有二次确认的入口标识）。
              const menuOpen = rowMenu.openMenuId === conversation.id
              return (
                <div
                  key={conversation.id}
                  className={`group rounded-xl border p-3 transition ${activeConversationId === conversation.id ? 'border-primary bg-primary/5 shadow-sm' : 'border-base-300 bg-base-100/60 hover:border-primary/50'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => selectConversation(conversation.id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-medium">{conversation.title}</div>
                      <div className="mt-1 text-[11px] text-base-content/45">{formatTime(conversation.updatedAt)}</div>
                    </button>
                    <RowMenuTrigger open={menuOpen} onClick={(event) => rowMenu.toggle(conversation.id, event.currentTarget)} label={`${conversation.title}操作`} />
                  </div>
                  {menuOpen && rowMenu.menuAnchor ? <RowMenuPopover anchor={rowMenu.menuAnchor} panelRef={rowMenu.panelRef}>
                    <MenuAction icon={menuIcons.edit} label="重命名" onClick={() => { rowMenu.close(); openRenameConversation(conversation) }} />
                    <MenuAction icon={menuIcons.trash} label="删除" tone="danger" onClick={() => { rowMenu.close(); setDeleteConversationId(conversation.id) }} />
                  </RowMenuPopover> : null}
                </div>
              )
            })
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {!activeConversation || activeConversation.messages.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="max-w-2xl text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-3xl text-primary">🤖</div>
                <h1 className="text-3xl font-bold">你好，我是你的 AI 工作搭档</h1>
                <p className="mt-3 text-base text-base-content/60">有什么工作需要我帮你？</p>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {quickPrompts.map((promptText) => (
                    <button
                      key={promptText}
                      type="button"
                      onClick={() => setPrompt(promptText)}
                      className="rounded-xl border border-base-300 bg-base-200/40 px-4 py-3 text-left text-sm text-base-content/70 transition hover:border-primary/50 hover:bg-primary/5"
                    >
                      {promptText}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
              <div className="mx-auto max-w-4xl space-y-5">
                {activeConversation.messages.map((message) =>
                  message.role === 'user' && editingMessageId === message.id ? (
                    <div key={message.id} className="group/message flex justify-end">
                      <div className="flex w-full min-w-0 flex-col items-start">
                        <div className="ml-auto w-full max-w-3xl rounded-3xl bg-base-200/80 p-3 shadow-sm">
                          <textarea autoFocus value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && prompt.trim() && !isGenerating) handleSubmitEdit() }} rows={3} className="min-h-20 w-full resize-none bg-transparent px-1 text-sm leading-7 text-base-content outline-none" aria-label="编辑消息" />
                          <div className="mt-2 flex justify-end gap-2">
                            <button type="button" onClick={handleCancelEdit} className="rounded-full border border-base-300 bg-base-100 px-4 py-2 text-sm font-medium text-base-content transition hover:bg-base-200">取消</button>
                            <button type="button" onClick={handleSubmitEdit} disabled={!prompt.trim()} className="rounded-full bg-base-content px-4 py-2 text-sm font-medium text-base-100 transition hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-35">发送</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                  <div key={message.id} className={`group/message flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex min-w-0 flex-col ${message.role === 'user' ? 'max-w-[85%] items-end' : 'w-full items-start'}`}>
                      <div className={`text-sm leading-6 ${message.role === 'user' ? 'rounded-3xl bg-base-200 text-base-content' : 'w-full text-base-content'}`}>
                        <div className={message.role === 'user' ? 'px-4 py-2.5' : 'py-1'}>
                          {message.role === 'assistant' ? renderAssistantText(message.content) : <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-7">{message.content}</p>}
                        </div>
                      </div>
                      {message.files && message.files.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {message.files.map((file) => (
                            <span key={file.id} className="rounded-full border border-current/20 bg-current/5 px-2 py-1 text-[11px] opacity-80">
                              {file.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className={`mt-2 flex items-center gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <button type="button" onClick={() => void handleCopyMessage(message)} className={`flex items-center gap-1 rounded-lg p-1.5 text-base-content/55 transition hover:bg-base-200 hover:text-base-content ${copiedMessageId === message.id ? 'px-2 text-primary' : ''}`} title={copiedMessageId === message.id ? '复制成功' : '复制内容'} aria-label={copiedMessageId === message.id ? '复制成功' : '复制内容'}>
                          {copiedMessageId === message.id ? <Icon className="h-3.5 w-3.5"><path d="m5 13 4 4L19 7" /></Icon> : menuIcons.copy}
                          {copiedMessageId === message.id ? <span className="whitespace-nowrap text-xs" role="status" aria-live="polite">复制成功</span> : null}
                        </button>
                        {message.role === 'user' && !isGenerating && (
                          <button type="button" onClick={() => handleEditMessage(message)} className="rounded-lg p-1.5 text-base-content/55 transition hover:bg-base-200 hover:text-base-content" title="编辑消息" aria-label="编辑消息">{menuIcons.edit}</button>
                        )}
                        <span className="text-[10px] text-base-content/35">{formatTime(message.createdAt)}</span>
                      </div>
                      {message.role === 'assistant' && message.status && message.status !== 'completed' && (
                        <div className="text-[11px] text-base-content/55">
                          {message.status === 'stopped' && '已停止'}
                          {message.status === 'failed' && '生成失败'}
                        </div>
                      )}
                      {message.role === 'assistant' && message.usage?.total_tokens && (
                        <div className="mt-3 text-[10px] text-base-content/45">
                          Token：{message.usage.total_tokens}
                        </div>
                      )}
                      {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                        <div className="mt-3 border-t border-base-300/60 pt-2 text-[11px] text-base-content/60">
                          来源：{message.sources.map((source) => source.title || source.url).filter(Boolean).join('、')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isGenerating && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
                      <span className="inline-flex items-center gap-2 text-sm text-base-content/70">
                        <span className="loading loading-dots loading-xs" />
                        智域正在思考…
                      </span>
                    </div>
                  </div>
                )}
                <div ref={endOfMessagesRef} />
              </div>
            </div>
          )}
        </div>

        {!editingMessageId ? (
        <div className="border-t border-base-300/60 bg-base-100 p-4 sm:p-5">
          {files.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {files.map((file) => (
                <div key={file.id} className="inline-flex items-center gap-2 rounded-full bg-base-200 px-2.5 py-1.5 text-xs text-base-content/75">
                  <span>📄</span>
                  <span className="max-w-45 truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))}
                    className="text-base-content/50 hover:text-error"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mx-auto max-w-5xl rounded-2xl border border-base-300 bg-base-100 p-3 shadow-lg shadow-black/5 focus-within:border-primary/40">
            {sendHint ? <p className="mb-2 text-xs leading-5 text-error" role="alert">{sendHint}</p> : null}

            <textarea
              ref={textareaRef}
              rows={2}
              value={prompt}
              onChange={(event) => { setPrompt(event.target.value); setSendHint('') }}
              placeholder="输入你的问题…"
              className="min-h-13 w-full resize-none bg-transparent px-1 text-sm leading-6 outline-none placeholder:text-base-content/40"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  if (isGenerating) handleStop()
                  else handleSend()
                }
              }}
            />

            <div className="mt-2 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <select
                  value={selectedModelId}
                  onChange={(event) => {
                    setSelectedModelId(event.target.value)
                    saveSelectedModel(event.target.value)
                  }}
                  className="select select-bordered select-xs min-w-37.5 rounded-full bg-base-100"
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
                <span className="hidden text-[11px] text-base-content/55">当前模型：{selectedModelName}</span>
                {/* 联网搜索开关：后端需配置 SEARCH_API_URL（搜索适配器）才真正生效，未配置时打开会直接报
                    「联网搜索当前不可用」。先 hidden 隐藏，配好后把 hidden 改回 flex 即可恢复。 */}
                <label className="hidden cursor-pointer items-center gap-2 text-[11px] text-base-content/60">
                  <input type="checkbox" className="toggle toggle-primary toggle-xs" checked={webSearch} onChange={(event) => setWebSearch(event.target.checked)} />
                  联网搜索
                </label>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg p-2 text-base-content/45 transition hover:bg-base-200 hover:text-base-content"
                  title="上传文件"
                  aria-label="上传文件"
                >
                  <Icon><path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7L9.7 17.7a2 2 0 0 1-2.8-2.8l8.9-8.9" /></Icon>
                </button>
                <button
                  type="button"
                  onClick={isGenerating ? handleStop : handleSend}
                  disabled={!isGenerating && !prompt.trim() && files.length === 0}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-content transition hover:opacity-85 disabled:bg-base-300 disabled:text-base-content/30"
                  aria-label={isGenerating ? '停止生成' : '发送'}
                  title={isGenerating ? '停止生成' : '发送'}
                >
                  {isGenerating
                    ? <Icon><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /></Icon>
                    : <Icon><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></Icon>}
                </button>
              </div>
            </div>
          </div>

          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileChange} />
        </div>
        ) : null}
      </main>
      </div>
      {/* 删除确认：副标题带上对话标题。此前只说「这条历史对话」，左侧列表长得都差不多，
          用户没法确认删的是哪一条。 */}
      {deleteConversationId && (() => {
        const target = conversations.find((item) => item.id === deleteConversationId)
        return <Dialog onClose={() => setDeleteConversationId('')}>
          <DialogHeader
            title="删除历史对话"
            icon={<span className="text-error">{menuIcons.trash}</span>}
            subtitle={<>确定删除“{target?.title || '该对话'}”吗？删除后无法恢复。</>}
            onClose={() => setDeleteConversationId('')}
          />
          <DialogActions>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleteConversationId('')}>取消</button>
            <button type="button" className="btn btn-error" onClick={confirmDeleteConversation}>删除</button>
          </DialogActions>
        </Dialog>
      })()}

      {renamingConversation && (() => {
        const closeRename = () => { setRenamingConversation(null); setRenameError('') }
        return <Dialog onClose={closeRename}>
          <DialogHeader title="重命名对话" icon={menuIcons.edit} onClose={closeRename} />
          <DialogField label="名称" required>
            <input
              autoFocus
              value={renameValue}
              onChange={(event) => { setRenameValue(event.target.value); setRenameError('') }}
              onKeyDown={(event) => { if (event.key === 'Enter') renameConversation(); if (event.key === 'Escape') closeRename() }}
              className="input input-bordered mt-1.5 w-full"
              placeholder="请输入对话名称"
            />
          </DialogField>
          <DialogError>{renameError}</DialogError>
          <DialogActions>
            <button type="button" className="btn btn-ghost" onClick={closeRename}>取消</button>
            <button type="button" className="btn btn-primary" onClick={renameConversation} disabled={!renameValue.trim() || renameValue.trim() === renamingConversation.title}>保存</button>
          </DialogActions>
        </Dialog>
      })()}
    </div>
  )
}
