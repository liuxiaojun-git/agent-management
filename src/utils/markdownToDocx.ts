// Markdown → .docx 字节。编辑面选在 Markdown 上（见 htmlToMarkdown.ts 的说明），
// 这里负责把用户改完的 Markdown 翻译回 Word 元素。
//
// 能还原的就是 Markdown 能表达的那些：标题、段落、加粗/斜体、行内代码、链接、
// 有序/无序列表、表格、引用、代码块、分隔线。原文档里的图片、页眉页脚、分栏、
// 文本框、批注、精确字体与颜色在 mammoth 提取那一步就已经不在 Markdown 里了。

import type { Paragraph as DocxParagraph, ParagraphChild, Table as DocxTable } from 'docx'

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; level: number; text: string }
  | { type: 'ordered'; level: number; text: string }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'table'; rows: string[][] }
  | { type: 'rule' }

const MAX_LIST_DEPTH = 4

const splitTableRow = (line: string) => line
  .replace(/^\s*\|/, '')
  .replace(/\|\s*$/, '')
  .split('|')
  .map((cell) => cell.trim())

const isTableSeparator = (line: string | undefined) =>
  typeof line === 'string' && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')

const isBlockStart = (line: string) =>
  /^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```)/.test(line) || isTableSeparator(line)

/**
 * 把 Markdown 拆成块。刻意做得很小：只认 htmlToMarkdown 会产出的那几种结构，
 * 以及用户在编辑器里手写的等价写法。遇到不认识的行一律当正文段落。
 */
function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index += 1; continue }

    if (/^\s*```/.test(line)) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```/.test(lines[index])) { code.push(lines[index]); index += 1 }
      index += 1
      blocks.push({ type: 'code', text: code.join('\n') })
      continue
    }

    if (/^\s*(?:[-*_])\s*(?:[-*_]\s*){2,}$/.test(line)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      index += 1
      continue
    }

    if (line.includes('|') && isTableSeparator(lines[index + 1])) {
      const rows: string[][] = [splitTableRow(line)]
      index += 2
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(splitTableRow(lines[index]))
        index += 1
      }
      blocks.push({ type: 'table', rows })
      continue
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'quote', text: quote.join('\n') })
      continue
    }

    const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
    if (item) {
      // 列表层级按两个空格算一级，和 htmlToMarkdown 的输出对齐。
      const level = Math.min(MAX_LIST_DEPTH - 1, Math.floor(item[1].replace(/\t/g, '  ').length / 2))
      const ordered = /\d/.test(item[2])
      blocks.push({ type: ordered ? 'ordered' : 'bullet', level, text: item[3] })
      index += 1
      continue
    }

    const paragraph = [line]
    index += 1
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index])
      index += 1
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') })
  }

  return blocks
}

let cachedModule: Promise<typeof import('docx')> | null = null
// 只在真正保存 Word 时才把 docx 拉进来，不让它进主 chunk。
const loadDocx = () => (cachedModule ??= import('docx'))

export async function markdownToDocxBytes(markdown: string): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, TextRun, ExternalHyperlink, Table, TableRow, TableCell, HeadingLevel, WidthType, LevelFormat, AlignmentType } = await loadDocx()

  // 行内元素。转义字符（\*、\#）在分段时就地还原成字面量。
  const inlineRuns = (text: string): ParagraphChild[] => {
    const runs: ParagraphChild[] = []
    const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]*)\]\(([^)]*)\)|\\(.)|\n)/g
    let cursor = 0
    let match: RegExpExecArray | null

    const flush = (segment: string) => {
      if (segment) runs.push(new TextRun({ text: segment }))
    }

    while ((match = pattern.exec(text)) !== null) {
      flush(text.slice(cursor, match.index))
      cursor = pattern.lastIndex

      if (match[2] !== undefined) runs.push(new TextRun({ text: match[2], bold: true }))
      else if (match[3] !== undefined) runs.push(new TextRun({ text: match[3], italics: true }))
      else if (match[4] !== undefined) runs.push(new TextRun({ text: match[4], font: 'Consolas' }))
      else if (match[5] !== undefined) runs.push(match[6]
        ? new ExternalHyperlink({ children: [new TextRun({ text: match[5], style: 'Hyperlink' })], link: match[6] })
        : new TextRun({ text: match[5] }))
      else if (match[7] !== undefined) runs.push(new TextRun({ text: match[7] }))
      // 段内的裸换行是硬换行（htmlToMarkdown 用行尾两空格产出），还原成 Word 的 break。
      else runs.push(new TextRun({ break: 1 }))
    }

    flush(text.slice(cursor))
    return runs.length ? runs : [new TextRun({ text: '' })]
  }

  const codeParagraphs = (text: string): DocxParagraph[] => text.split('\n').map((line, lineIndex) =>
    new Paragraph({
      children: [new TextRun({ text: line, font: 'Consolas', size: 20, break: lineIndex > 0 ? 1 : 0 })],
      spacing: { after: 0 },
    }))

  const tableElement = (rows: string[][]): DocxTable => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((cells, rowIndex) => new TableRow({
      // 表头标记只能在第一行给，而且不能给 false —— docx 会把 tableHeader: false 写成
      // <w:tblHeader w:val="false"/>，mammoth 只看元素在不在（不看 val），于是每一行都被读成表头，
      // 第二次编辑时整张表就废了。
      ...(rowIndex === 0 ? { tableHeader: true } : {}),
      children: cells.map((cell) => new TableCell({
        children: [new Paragraph({ children: inlineRuns(cell) })],
      })),
    })),
  })

  const headingLevels = [
    HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6,
  ]

  const toElements = (block: Block): Array<DocxParagraph | DocxTable> => {
    switch (block.type) {
      case 'heading':
        return [new Paragraph({ heading: headingLevels[Math.min(block.level, 6) - 1], children: inlineRuns(block.text) })]
      case 'paragraph':
        return [new Paragraph({ children: inlineRuns(block.text) })]
      case 'bullet':
        return [new Paragraph({ bullet: { level: block.level }, children: inlineRuns(block.text) })]
      case 'ordered':
        return [new Paragraph({ children: inlineRuns(block.text), numbering: { reference: 'markdown-ordered', level: block.level } })]
      case 'quote':
        return block.text.split('\n').map((line) =>
          new Paragraph({ children: inlineRuns(line), indent: { left: 480 }, spacing: { after: 0 } }))
      case 'code':
        return codeParagraphs(block.text)
      case 'table':
        return [tableElement(block.rows)]
      case 'rule':
        return [new Paragraph({ thematicBreak: true, children: [] })]
    }
  }

  const children = parseBlocks(markdown).flatMap(toElements)

  const document = new Document({
    // 有序列表必须在文档级登记编号定义，paragraph 上的 numbering.reference 才能解析得到。
    numbering: {
      config: [{
        reference: 'markdown-ordered',
        levels: Array.from({ length: MAX_LIST_DEPTH }, (_, level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
        })),
      }],
    },
    sections: [{ children }],
  })

  return new Uint8Array(await Packer.toArrayBuffer(document))
}
