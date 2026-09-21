// mammoth 的 HTML 输出 → Markdown。
//
// Word 的编辑面刻意选在 Markdown 而不是 HTML 上：一边能直接复用 createMarkdownPreviewHtml 做实时预览，
// 另一边回写 .docx 时只要把 Markdown 的块模型翻译成 docx 元素即可，不必去操作 DOM。
//
// 这一层能表达的范围就是 Markdown 的范围：标题、段落、加粗/斜体、行内代码、链接、有序/无序列表、
// 表格、引用、代码块、分隔线。图片（mammoth 会内联成 data: URL）直接丢弃 —— 回写 .docx 时无法还原。
// 页眉页脚、批注、分栏、文本框本就不在 mammoth 的输出里。调用方必须把这些损失显式告知用户。

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
const LIST_TAGS = new Set(['UL', 'OL'])

// 正文里出现的 Markdown 元字符要转义，否则回读时会被当成结构。
// 转义范围刻意收窄到行内级别：转义过多会让用户看到的 Markdown 难以阅读。
const escapeInline = (text: string) => text
  .replace(/\\/g, '\\\\')
  .replace(/([`*_[\]])/g, '\\$1')

const escapeCell = (text: string) => escapeInline(text).replace(/\|/g, '\\|')

// 段落正文如果恰好以块级标记开头（"1. 首先"、"# 不是标题"），Markdown 会把它解析成结构而不是文字。
const escapeLeadingMarker = (text: string) =>
  /^(#{1,6}\s|[-+*]\s|>\s|\d+[.)]\s)/.test(text) ? `\\${text}` : text

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeInline(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as HTMLElement
  const children = () => Array.from(element.childNodes).map((child) => inline(child)).join('')

  switch (element.tagName) {
    case 'STRONG':
    case 'B': {
      const text = children()
      return text.trim() ? `**${text}**` : text
    }
    case 'EM':
    case 'I': {
      const text = children()
      return text.trim() ? `*${text}*` : text
    }
    case 'CODE':
      return `\`${element.textContent ?? ''}\``
    case 'A': {
      const href = element.getAttribute('href')
      const text = children()
      return href ? `[${text}](${href})` : text
    }
    // 行尾两个空格是 Markdown 的硬换行。整段仍是一行，回写 docx 时可还原成 break。
    case 'BR':
      return '  \n'
    // 图片无法回写，丢弃；其余未知的内联元素一律降级成它的文字内容。
    case 'IMG':
      return ''
    default:
      return children()
  }
}

function tableToMarkdown(element: HTMLElement): string {
  const rows = Array.from(element.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr'))
  if (!rows.length) return ''

  const cellsOf = (row: Element) =>
    Array.from(row.querySelectorAll(':scope > th, :scope > td')).map((cell) => escapeCell((cell.textContent ?? '').trim()))

  const header = cellsOf(rows[0])
  const body = rows.slice(1).map(cellsOf)
  const width = Math.max(header.length, ...body.map((row) => row.length), 1)
  const pad = (row: string[]) => Array.from({ length: width }, (_, index) => row[index] ?? '')

  return [
    pad(header),
    Array.from({ length: width }, () => '---'),
    ...body.map(pad),
  ].map((row) => `| ${row.join(' | ')} |`).join('\n')
}

function listToMarkdown(element: HTMLElement, depth: number): string[] {
  const ordered = element.tagName === 'OL'
  const lines: string[] = []
  let index = 1

  for (const child of Array.from(element.children)) {
    if (child.tagName !== 'LI') continue

    // li 里既可能有这一条的正文，也可能有嵌套列表。先把嵌套列表摘出去，
    // 剩下的才拼成这一条的文字，否则子列表会被并进父项的行里。
    const nested: HTMLElement[] = []
    const ownNodes: Node[] = []
    for (const node of Array.from(child.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE && LIST_TAGS.has((node as HTMLElement).tagName)) nested.push(node as HTMLElement)
      else ownNodes.push(node)
    }

    const text = ownNodes.map((node) => inline(node)).join('').trim()
    lines.push(`${'  '.repeat(depth)}${ordered ? `${index}.` : '-'} ${escapeLeadingMarker(text)}`)
    for (const childList of nested) lines.push(...listToMarkdown(childList, depth + 1))
    index += 1
  }

  return lines
}

function blocksToMarkdown(nodes: Node[], depth: number): string[] {
  const out: string[] = []

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').trim()
      if (text) out.push(escapeLeadingMarker(escapeInline(text)))
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue

    const element = node as HTMLElement

    if (HEADING_TAGS.has(element.tagName)) {
      const text = inline(element).trim()
      if (text) out.push(`${'#'.repeat(Number(element.tagName[1]))} ${text}`)
      continue
    }

    switch (element.tagName) {
      case 'P': {
        const text = inline(element).trim()
        if (text) out.push(escapeLeadingMarker(text))
        break
      }
      case 'UL':
      case 'OL':
        out.push(...listToMarkdown(element, depth))
        break
      case 'TABLE': {
        const markdown = tableToMarkdown(element)
        if (markdown) out.push(markdown)
        break
      }
      case 'BLOCKQUOTE': {
        const inner = blocksToMarkdown(Array.from(element.childNodes), depth)
        if (inner.length) {
          out.push(inner.join('\n\n').split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n'))
        }
        break
      }
      case 'PRE': {
        const code = (element.textContent ?? '').replace(/\n$/, '')
        if (code.trim()) out.push(`\`\`\`\n${code}\n\`\`\``)
        break
      }
      case 'HR':
        out.push('---')
        break
      default:
        // div / section / body 之类的容器：本身不产生块，内容继续按块拆。
        out.push(...blocksToMarkdown(Array.from(element.childNodes), depth))
    }
  }

  return out
}

export function htmlToMarkdown(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  return blocksToMarkdown(Array.from(parsed.body.childNodes), 0)
    .filter((block) => block.trim() !== '')
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
