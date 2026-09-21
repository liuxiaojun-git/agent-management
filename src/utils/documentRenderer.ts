import * as XLSX from 'xlsx'
import * as mammoth from 'mammoth'

/**
 * Excel 表格数据结构
 */
export interface ExcelSheet {
  name: string
  data: (string | number | boolean | null)[][]
  columns: number
  rows: number
  columnWidths: number[]
  rowHeights: number[]
  merges: Array<{ startRow: number; startCol: number; endRow: number; endCol: number }>
  startRow: number
  startCol: number
}

/**
 * Word 文档数据结构
 */
export interface WordDocument {
  html: string
  text: string
}

const sanitizeLink = (value: string) => {
  const href = value.trim()
  return /^(https?:|mailto:|\/|#)/i.test(href) ? href : '#'
}

const markdownLineBreak = '\u0001'

// 兼容从富文本/表格工具导出的 Markdown：这些内容会额外转义标点，或把链接重复包裹。
const normalizeMarkdownSource = (markdown: string) => {
  const unescaped = markdown
    .replace(/\\([\\`*{}\[\]()#+\-.!_>@:&$?])/g, '$1')
    .replace(/\*{4}([^*]+)\*{4}/g, '**$1**')
    .replace(/\[\[(https?:\/\/[^\]]+)\]\((https?:\/\/[^)]+)\)\]\((https?:\/\/[^)]+)\)/g, '[$1]($2)')
    .replace(/<br\s*\/?>/gi, markdownLineBreak)
  // 旧版本会把多条内容拼接成一行；标准表格中的 ||| 是空单元格，不能拆开。
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/m.test(unescaped)
    ? unescaped
    : unescaped.replace(/\|\|\|/g, '\n\n')
}

const renderMarkdownInline = (value: string) => {
  const tokens: string[] = []
  const token = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`
  let output = escapeHtml(value)
  output = output.replaceAll(markdownLineBreak, token('<br />'))
  output = output.replace(/`([^`]+)`/g, (_, code: string) => token(`<code>${code}</code>`))
  output = output.replace(/!?\[([^\]]*)\]\(([^\s)]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label: string, href: string) => {
    const safeHref = sanitizeLink(href)
    return token(`<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${label || safeHref}</a>`)
  })
  output = output.replace(/https?:\/\/[^\s<]+/g, (url: string) => {
    const suffix = url.match(/[).,;:!?]+$/)?.[0] || ''
    const href = url.slice(0, url.length - suffix.length)
    return token(`<a href="${escapeHtml(sanitizeLink(href))}" target="_blank" rel="noreferrer">${href}</a>`) + suffix
  })
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
  output = output.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>').replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>')
  return output.replace(/\u0000(\d+)\u0000/g, (_, index: string) => tokens[Number(index)] || '')
}

/** 将常用 Markdown 安全转换为预览 HTML；原始 HTML 会被作为普通文本显示。 */
export function createMarkdownPreviewHtml(markdown: string): string {
  const lines = normalizeMarkdownSource(markdown)
    .replace(/\r\n?/g, '\n')
    .split('\n')
  const blocks: string[] = []
  let index = 0
  let paragraph: string[] = []
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${renderMarkdownInline(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  while (index < lines.length) {
    const line = lines[index]
    if (/^\s*```/.test(line)) {
      flushParagraph()
      const language = line.replace(/^\s*```/, '').trim()
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++])
      blocks.push(`<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`)
    } else if (/^(?:\*\*)?(#{1,6})\s+(.+?)(?:\*\*)?$/.test(line)) {
      flushParagraph()
      const [, hashes, title] = line.match(/^(?:\*\*)?(#{1,6})\s+(.+?)(?:\*\*)?$/)!
      const level = hashes.length
      blocks.push(`<h${level}>${renderMarkdownInline(title)}</h${level}>`)
    } else if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph()
      blocks.push('<hr />')
    } else if (/^>\s?/.test(line)) {
      flushParagraph()
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''))
      blocks.push(`<blockquote><p>${renderMarkdownInline(quote.join(' '))}</p></blockquote>`)
      continue
    } else if (index + 1 < lines.length && /^\s*\|?.+\|.+\|?\s*$/.test(line) && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      flushParagraph()
      const parseCells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
      const rawHeaders = parseCells(line)
      const lastHeader = rawHeaders.reduce((last, header, cellIndex) => header ? cellIndex : last, 0)
      const headers = rawHeaders.slice(0, lastHeader + 1)
      index += 2
      const rows: string[] = []
      while (index < lines.length && /^\s*\|?.+\|.+\|?\s*$/.test(lines[index])) {
        const cells = parseCells(lines[index])
        rows.push(`<tr>${headers.map((_, cellIndex) => `<td>${renderMarkdownInline(cells[cellIndex] || '')}</td>`).join('')}</tr>`)
        index += 1
      }
      blocks.push(`<div class="markdown-table-wrap"><table><thead><tr>${headers.map((header) => `<th>${renderMarkdownInline(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`)
      continue
    } else if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      flushParagraph()
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: string[] = []
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/
      while (index < lines.length) {
        const match = lines[index].match(pattern)
        if (!match) break
        items.push(`<li>${renderMarkdownInline(match[1])}</li>`)
        index += 1
      }
      blocks.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`)
      continue
    } else if (!line.trim()) {
      flushParagraph()
    } else {
      // 旧资料常以 |内容| 存储单列表记录；移除仅用于分隔的首尾竖线。
      const normalizedLine = line.trim().replace(/^\|([^|]+)\|$/, '$1')
      paragraph.push(normalizedLine)
    }
    index += 1
  }
  flushParagraph()
  return blocks.join('\n') || '<p class="markdown-empty">（空 Markdown 文件）</p>'
}

/**
 * 从 data URL 或 base64 字符串中提取二进制数据
 */
function extractBinaryFromDataUrl(dataUrl: string): ArrayBuffer {
  // Handle data URL format: data:application/vnd.ms-excel;base64,...
  if (dataUrl.startsWith('data:')) {
    const base64 = dataUrl.split(',')[1]
    if (!base64) throw new Error('Invalid data URL format')
    const binaryString = atob(base64)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    return bytes.buffer
  }
  
  // Handle raw base64
  const binaryString = atob(dataUrl)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

/**
 * 取文件的二进制内容。src 可能是内联 data URL（刚导入、尚未落库），
 * 也可能是水合层给的 blob: URL —— 后者不能丢给 atob，会把 'blob:http…' 当 base64 解而抛 InvalidCharacterError。
 */
async function extractBinaryFrom(source: string): Promise<ArrayBuffer> {
  if (source.startsWith('blob:')) return await (await fetch(source)).arrayBuffer()
  return extractBinaryFromDataUrl(source)
}

/**
 * 解析 Excel 文件并提取所有工作表
 */
export async function parseExcelFile(dataUrl: string): Promise<ExcelSheet[]> {
  try {
    const arrayBuffer = await extractBinaryFrom(dataUrl)
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true, cellDates: true })
    
    const sheets: ExcelSheet[] = workbook.SheetNames.map((sheetName) => {
      const worksheet = workbook.Sheets[sheetName]
      // Convert sheet to array of arrays
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1')
      const data: (string | number | boolean | null)[][] = []
      
      for (let row = range.s.r; row <= range.e.r; row++) {
        const rowData: (string | number | boolean | null)[] = []
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: row, c: col })
          const cell = worksheet[cellAddress]
          const value = cell ? (cell.w ?? cell.v) : null
          rowData.push(value ?? null)
        }
        data.push(rowData)
      }
      
      const merges = (worksheet['!merges'] || []).map((merge) => ({
        startRow: merge.s.r - range.s.r,
        startCol: merge.s.c - range.s.c,
        endRow: merge.e.r - range.s.r,
        endCol: merge.e.c - range.s.c,
      }))
      const sourceColumns = worksheet['!cols'] || []
      const columnWidths = Array.from({ length: range.e.c - range.s.c + 1 }, (_, columnIndex) => {
        const source = sourceColumns[range.s.c + columnIndex]
        if (source?.wpx) return Math.max(56, Math.min(320, source.wpx))
        if (source?.wch) return Math.max(56, Math.min(320, Math.round(source.wch * 8 + 16)))
        let longest = 0
        for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
          const mergedAcross = merges.some((merge) => merge.startRow === rowIndex && merge.startCol === columnIndex && merge.endCol > merge.startCol)
          if (mergedAcross) continue
          const text = String(data[rowIndex]?.[columnIndex] ?? '')
          const visualLength = Array.from(text.slice(0, 40)).reduce((total, char) => total + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0)
          longest = Math.max(longest, visualLength)
        }
        return Math.max(88, Math.min(240, longest * 7 + 28))
      })
      const sourceRows = worksheet['!rows'] || []
      const rowHeights = Array.from({ length: range.e.r - range.s.r + 1 }, (_, rowIndex) => {
        const source = sourceRows[range.s.r + rowIndex]
        return Math.max(34, Math.min(240, source?.hpx || (source?.hpt ? Math.round(source.hpt * 96 / 72) : 34)))
      })

      return {
        name: sheetName,
        data,
        columns: range.e.c - range.s.c + 1,
        rows: range.e.r - range.s.r + 1,
        columnWidths,
        rowHeights,
        merges,
        startRow: range.s.r,
        startCol: range.s.c,
      }
    })
    
    return sheets
  } catch (error) {
    console.error('Failed to parse Excel file:', error)
    throw error
  }
}

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const CSV_MIME_TYPE = 'text/csv'
export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * 编辑后重建工作簿字节。写回的是「值 + 合并区域 + 列宽行高」，
 * 公式与单元格样式在 parseExcelFile 那一步就没保留（那里读的是 cell.w ?? cell.v，从不读 cell.f），
 * 所以这里也不假装能还回去。
 *
 * csv 走单独分支：只取第一张表写成文本。把 csv 存成 xlsx 二进制会让扩展名撒谎，
 * 用户下载后拿文本编辑器打不开。
 */
export function buildExcelBytes(sheets: ExcelSheet[], format: 'xlsx' | 'csv'): { bytes: Uint8Array; mimeType: string } {
  const workbook = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.data)
    if (format === 'csv') {
      workbook.Sheets[sheet.name] = worksheet
      continue
    }
    // merges 存的是相对 range 起点的偏移（见 parseExcelFile），aoa_to_sheet 从头开始排，
    // 所以偏移可以直接当绝对坐标用，不需要再加 startRow / startCol。
    worksheet['!merges'] = sheet.merges.map((merge) => ({
      s: { r: merge.startRow, c: merge.startCol },
      e: { r: merge.endRow, c: merge.endCol },
    }))
    worksheet['!cols'] = sheet.columnWidths.map((wpx) => ({ wpx }))
    worksheet['!rows'] = sheet.rowHeights.map((hpx) => ({ hpx }))
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name)
  }

  if (format === 'csv') {
    const first = sheets[0]?.name
    const csv = first ? XLSX.utils.sheet_to_csv(workbook.Sheets[first]) : ''
    return { bytes: new TextEncoder().encode(csv), mimeType: CSV_MIME_TYPE }
  }

  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return { bytes: new Uint8Array(bytes), mimeType: XLSX_MIME_TYPE }
}

/**
 * 解析 Word 文档
 */
export async function parseWordDocument(dataUrl: string): Promise<WordDocument> {
  try {
    const arrayBuffer = await extractBinaryFrom(dataUrl)
    const result = await mammoth.convertToHtml({ arrayBuffer })
    
    return {
      html: result.value,
      text: result.value.replace(/<[^>]*>/g, '').trim(),
    }
  } catch (error) {
    console.error('Failed to parse Word document:', error)
    throw error
  }
}

/**
 * 将 Excel 数据转换为 HTML 表格
 */
export function excelSheetToHtmlTable(sheet: ExcelSheet): string {
  const coveredCells = new Set<string>()
  const mergeStarts = new Map<string, { rowSpan: number; colSpan: number }>()
  sheet.merges.forEach((merge) => {
    mergeStarts.set(`${merge.startRow}:${merge.startCol}`, {
      rowSpan: merge.endRow - merge.startRow + 1,
      colSpan: merge.endCol - merge.startCol + 1,
    })
    for (let row = merge.startRow; row <= merge.endRow; row++) {
      for (let col = merge.startCol; col <= merge.endCol; col++) {
        if (row !== merge.startRow || col !== merge.startCol) coveredCells.add(`${row}:${col}`)
      }
    }
  })
  const totalWidth = sheet.columnWidths.reduce((sum, width) => sum + width, 0)
  const columns = sheet.columnWidths.map((width) => `<col style="width:${width}px;min-width:${width}px">`).join('')
  const columnHeaders = sheet.columnWidths.map((_, columnIndex) => {
    const label = XLSX.utils.encode_col(sheet.startCol + columnIndex)
    return `<th class="sticky top-0 z-20 h-7 border border-slate-300 bg-slate-100 text-center text-xs font-normal text-slate-500">${label}</th>`
  }).join('')
  const rows = sheet.data.map((rowData, rowIndex) => {
    const cells = rowData
      .map((cell, columnIndex) => {
        const key = `${rowIndex}:${columnIndex}`
        if (coveredCells.has(key)) return ''
        const value = cell ?? ''
        const escaped = String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
        const merge = mergeStarts.get(key)
        const spans = `${merge?.rowSpan && merge.rowSpan > 1 ? ` rowspan="${merge.rowSpan}"` : ''}${merge?.colSpan && merge.colSpan > 1 ? ` colspan="${merge.colSpan}"` : ''}`
        const address = `${XLSX.utils.encode_col(sheet.startCol + columnIndex)}${sheet.startRow + rowIndex + 1}`
        return `<td${spans} data-excel-cell="true" data-address="${address}" data-value="${escaped}" class="cursor-cell border border-slate-200 bg-white px-3 py-2 align-middle text-sm leading-6 text-slate-700 whitespace-pre-wrap wrap-break-word hover:bg-emerald-50/40">${escaped}</td>`
      })
      .join('')
    return `<tr style="height:${sheet.rowHeights[rowIndex] || 34}px"><th class="sticky left-0 z-10 w-12 min-w-12 border border-slate-300 bg-slate-100 text-center text-xs font-normal text-slate-500">${sheet.startRow + rowIndex + 1}</th>${cells}</tr>`
  }).join('')
  
  return `
    <table class="table-fixed border-collapse border border-slate-300 bg-white" style="width:${totalWidth}px;min-width:${totalWidth}px">
      <colgroup><col style="width:48px;min-width:48px">${columns}</colgroup>
      <thead><tr><th class="sticky left-0 top-0 z-30 h-7 border border-slate-300 bg-slate-200"></th>${columnHeaders}</tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `
}

/**
 * 创建 Excel 文档的预览 HTML
 */
export function createExcelPreviewHtml(sheets: ExcelSheet[]): string {
  const sheetTabs = sheets
    .map((sheet, index) => {
      const tableHtml = excelSheetToHtmlTable(sheet)
      return `
        <div class="sheet-content" data-sheet="${index}" style="${index === 0 ? '' : 'display: none;'}">
          <div class="mb-3 flex items-center justify-between gap-4">
            <h2 class="truncate text-base font-semibold text-slate-800">${escapeHtml(sheet.name)}</h2>
            <span class="shrink-0 text-xs text-slate-400">${sheet.rows} 行 × ${sheet.columns} 列</span>
          </div>
          <div class="max-w-full overflow-auto rounded-lg border border-slate-200 bg-slate-100 shadow-inner">
            ${tableHtml}
          </div>
        </div>
      `
    })
    .join('')
  
  const tabButtons = sheets
    .map((sheet, index) => {
      return `
        <button class="sheet-tab px-4 py-2 border-b-2 ${index === 0 ? 'border-primary text-primary' : 'border-transparent text-base-content/60'}" data-sheet="${index}">
          ${escapeHtml(sheet.name)}
        </button>
      `
    })
    .join('')
  
  return `
    <div class="excel-preview min-w-0 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
      <div class="flex h-10 items-center gap-1 border-b border-slate-300 bg-[#f7f7f7] px-2 text-slate-600">
        <span class="rounded px-2 py-1 text-xs font-semibold text-emerald-700">Excel</span>
        <span class="mx-1 h-5 w-px bg-slate-300"></span>
        <button type="button" class="rounded px-2 py-1 text-xs hover:bg-slate-200" title="加粗">B</button>
        <button type="button" class="rounded px-2 py-1 text-xs italic hover:bg-slate-200" title="斜体">I</button>
        <button type="button" class="rounded px-2 py-1 text-xs underline hover:bg-slate-200" title="下划线">U</button>
        <span class="mx-1 h-5 w-px bg-slate-300"></span>
        <span class="text-xs text-slate-400">只读预览</span>
      </div>
      <div class="grid grid-cols-[88px_36px_minmax(0,1fr)] items-center border-b border-slate-300 bg-white text-sm">
        <div data-excel-name class="h-9 border-r border-slate-300 px-3 py-2 text-center text-xs text-slate-600">A1</div>
        <div class="text-center font-serif italic text-slate-500">fx</div>
        <div data-excel-formula class="h-9 truncate border-l border-slate-200 px-3 py-2 text-slate-700"></div>
      </div>
      <div class="bg-slate-50 p-3">
        ${sheetTabs}
      </div>
      <div class="flex h-10 items-end overflow-x-auto border-t border-slate-300 bg-[#f3f3f3] px-3">
        <span class="mb-2 mr-2 text-sm text-slate-400">‹</span>
        ${tabButtons}
        <span class="mb-1.5 ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded text-lg text-slate-500 hover:bg-slate-200">＋</span>
      </div>
      <div class="flex h-7 items-center justify-between border-t border-slate-300 bg-[#f7f7f7] px-3 text-[11px] text-slate-400">
        <span>就绪</span><span>单击单元格可查看内容</span>
      </div>
    </div>
  `
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * 创建 Word 文档的预览 HTML，应用样式
 */
export function createWordPreviewHtml(doc: WordDocument): string {
  // 添加样式以确保 Word 内容渲染正确
  return `
    <article class="word-preview mx-auto min-h-130 max-w-205 rounded-xl border border-slate-200 bg-white px-6 py-10 text-slate-800 sm:px-10 md:px-14">
      <style>
        .word-content {
          font-size: 15px;
          line-height: 1.8;
        }
        .word-content h1 { margin: 0 0 1.75rem; font-size: 2rem; font-weight: 600; line-height: 1.25; }
        .word-content h2 { margin: 2.5rem 0 1rem; border-bottom: 1px solid #e5e7eb; padding-bottom: .5rem; font-size: 1.5rem; font-weight: 600; line-height: 1.4; }
        .word-content h3 { margin: 2rem 0 .75rem; font-size: 1.2rem; font-weight: 600; line-height: 1.4; }
        .word-content p { margin: 1.25rem 0; }
        .word-content ul, .word-content ol { margin: 1.25rem 0; padding-left: 1.75rem; }
        .word-content li { margin: .25rem 0; padding-left: .25rem; }
        .word-content table { width: 100%; margin: 1.5rem 0; border-collapse: collapse; font-size: .9rem; }
        .word-content table th, .word-content table td { border: 1px solid #e5e7eb; padding: .75rem; text-align: left; vertical-align: top; }
        .word-content table th { background-color: #f9fafb; font-weight: 600; }
        .word-content blockquote { margin: 1.5rem 0; border-left: 2px solid #9ca3af; padding-left: 1rem; color: #6b7280; }
        .word-content code { border-radius: .375rem; background-color: #f3f4f6; padding: .125rem .375rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
        .word-content pre { margin: 1.5rem 0; overflow-x: auto; border-radius: .75rem; background-color: #292524; padding: 1rem; color: #f5f5f4; }
        .word-content pre code { background: transparent; padding: 0; color: inherit; }
      </style>
      <div class="word-content">
        ${doc.html}
      </div>
    </article>
  `
}
