// 助手回复的 Markdown 排版渲染 — AI 问答与知识库问答共用同一套结构/样式（知识库为基准）。
// 知识库问答在调用前会先做“根据资料[…]”等引用声明清理，并传入 stripRefNumbers 还原正文内的 [n] 标记处理；
// AI 问答直接使用默认行为，不清除正文里的内容。
import type { ReactNode } from 'react'

type RenderAssistantList = { kind: 'ol' | 'ul'; items: Array<{ text: string; depth: number }> } | null

const paragraphClass = 'wrap-anywhere whitespace-pre-wrap text-sm leading-7'

// 行内富文本：`行内代码` 与 **加粗**（用于段落、标题及列表项内部）
export function renderAssistantInline(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean)
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded-md bg-base-200 px-1.5 py-0.5 font-mono text-[12px] text-base-content/80">{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className="font-semibold text-base-content">{part.slice(2, -2)}</strong>
    return <span key={index}>{part}</span>
  })
}

// 正文块渲染：一级/二级/三级标题（# / ## / ###）、有序/无序（含缩进层级）列表、段落流动排版。
// 段落回行：保留原文换行，超长内容在气泡宽度内自动折行，保证每一行完整显示（飞书文档式排版）。
export function renderAssistantBlocks(text: string, options: { stripRefNumbers?: boolean } = {}) {
  const { stripRefNumbers = false } = options
  const lines = text.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let list: RenderAssistantList = null

  const flushParagraph = () => {
    // 段内用空格连接、连续流动，只在到达气泡右边距时才折行；空行分隔的才是独立段落
    const content = paragraph.join(' ').trim()
    if (content) blocks.push(<p key={`p-${blocks.length}`} className={paragraphClass}>{renderAssistantInline(content)}</p>)
    paragraph = []
  }

  const flushList = () => {
    if (!list || !list.items.length) { list = null; return }
    blocks.push(list.kind === 'ol'
      ? <ol key={`ol-${blocks.length}`} className="list-decimal space-y-1.5 pl-5 text-sm leading-7">{list.items.map((item, index) => <li key={index} className="wrap-anywhere pl-1 marker:font-medium marker:text-primary">{renderAssistantInline(item.text)}</li>)}</ol>
      : <ul key={`ul-${blocks.length}`} className="list-none space-y-1 text-sm leading-7">{list.items.map((item, index) => <li key={index} className="wrap-anywhere pl-1 marker:text-primary" style={{ display: 'list-item', listStyleType: item.depth === 0 ? 'disc' : item.depth === 1 ? 'circle' : 'square', marginLeft: `${1.25 + item.depth * 1.5}rem` }}>{renderAssistantInline(item.text)}</li>)}</ul>)
    list = null
  }

  const clean = (value: string) => (stripRefNumbers ? value.replace(/\[(\d+)\]/g, '') : value).trim()

  lines.forEach((line) => {
    const trimmed = line.trim()
    // 空行只冲刷段落、不冲刷列表：模型常把列表写成「项之间空一行」的松散列表（loose list），
    // 若空行就 flushList，每个 1. 2. 3. 会各自成一个 <ol>，全部从头显示成 1。
    if (!trimmed) { flushParagraph(); return }
    // 一级/二级/三级标题（Markdown # / ## / ###），飞书文档式排版
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      const level = headingMatch[1].length
      const headingText = clean(headingMatch[2].replace(/\*\*/g, ''))
      const headingClass = level === 1 ? 'text-[17px] font-bold leading-8' : level === 2 ? 'text-[15px] font-bold leading-7' : 'text-sm font-semibold leading-7'
      const headingProps = { key: `h-${blocks.length}`, className: `${headingClass} pt-1 text-base-content` }
      blocks.push(level === 1 ? <h1 {...headingProps}>{headingText}</h1> : level === 2 ? <h2 {...headingProps}>{headingText}</h2> : <h3 {...headingProps}>{headingText}</h3>)
      return
    }
    const orderedMatch = trimmed.match(/^(\d+)([.、)：)])(.*)$/)
    if (orderedMatch) {
      flushParagraph()
      const item = clean(orderedMatch[3])
      if (list && list.kind === 'ol') list.items.push({ text: item, depth: 0 })
      else { flushList(); list = { kind: 'ol', items: [{ text: item, depth: 0 }] } }
      return
    }
    const unorderedMatch = line.match(/^(\s*)[-•*+·]\s+(.+)$/)
    if (unorderedMatch) {
      flushParagraph()
      const item = unorderedMatch[2].trim()
      const depth = Math.min(2, Math.floor(unorderedMatch[1].replace(/\t/g, '  ').length / 2))
      if (list && list.kind === 'ul') list.items.push({ text: item, depth })
      else { flushList(); list = { kind: 'ul', items: [{ text: item, depth }] } }
      return
    }
    // 列表内的缩进续行（松散列表项的第二行描述）并入当前项，而不是当段落把列表冲掉。
    if (list && /^\s/.test(line)) {
      const last = list.items[list.items.length - 1]
      last.text = last.text ? `${last.text} ${trimmed}` : trimmed
      return
    }
    flushList()
    paragraph.push(trimmed)
  })

  flushParagraph()
  flushList()

  if (!blocks.length) return <p className={paragraphClass}>{text}</p>
  return <div className="space-y-3">{blocks}</div>
}
