import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView } from '@codemirror/view'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { xml } from '@codemirror/lang-xml'
import * as XLSX from 'xlsx'
import { createMarkdownPreviewHtml, type ExcelSheet } from '../utils/documentRenderer'
import type { DocxParagraphDraft } from '../utils/docxEditor'
import { markdownTypographyClassName } from './DocumentRenderer'

// 草稿形态。Word 与 Markdown 都用 markdown 字段，走同一套编辑面和预览。
export type EditDraft =
  | { kind: 'text'; text: string }
  | { kind: 'sheet'; sheets: ExcelSheet[]; activeSheet: number }
  | { kind: 'word'; format: 'legacy'; markdown: string }
  | { kind: 'word'; format: 'docx'; sourceBytes: Uint8Array; paragraphs: DocxParagraphDraft[] }

export type EditableKind = 'word' | 'markdown' | 'text' | 'sheet'

// 草稿以「更新函数」而不是「新草稿」的形式往外抛：SheetEditor 的单元格回调要跨渲染保持稳定标识，
// 否则每敲一个字符回调都换新，SheetRow 的 memo 会全部失效、整张表跟着重渲染。
// 拿当前草稿这件事因此得交给 useState 的更新函数来做，而不是让编辑器闭包捕获 draft。
export type DraftUpdater = (current: EditDraft) => EditDraft

// 这些损失在解析阶段就注定了（parseExcelFile 只取 cell.w ?? cell.v，从不读 cell.f），
// 用户看不到，所以必须在编辑态显式告知。
const LOSS_NOTICE: Partial<Record<EditableKind, string>> = {
  sheet: '保存后公式与单元格样式会丢失 —— 解析时只保留了每个单元格的显示值。',
}

const wordParagraphClasses: Record<DocxParagraphDraft['style'], string> = {
  title: 'text-2xl font-semibold',
  heading1: 'text-xl font-semibold',
  heading2: 'text-lg font-semibold',
  heading3: 'text-base font-semibold',
  heading4: 'text-sm font-semibold',
  heading5: 'text-sm font-medium',
  heading6: 'text-sm font-medium text-base-content/70',
  normal: 'text-sm',
}

const editorChromeTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  '.cm-gutters': {
    backgroundColor: 'color-mix(in oklab, var(--color-base-200) 30%, var(--color-base-100))',
    borderRight: '1px solid var(--color-base-200)',
    zIndex: '2',
  },
  '.cm-content': { padding: '12px 0' },
})

const editorSetup = {
  lineNumbers: true,
  foldGutter: true,
  highlightActiveLineGutter: true,
  highlightActiveLine: true,
  bracketMatching: true,
  closeBrackets: true,
  autocompletion: true,
  indentOnInput: true,
}

const useDebouncedValue = <T,>(value: T, delay: number) => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

// 分栏预览。排版规则直接复用只读预览那一份，改一处两边同步。
const MarkdownPreview = ({ markdown }: { markdown: string }) => {
  const debounced = useDebouncedValue(markdown, 150)
  const previewHtml = useMemo(() => createMarkdownPreviewHtml(debounced), [debounced])
  return <div className={`px-6 py-6 ${markdownTypographyClassName}`} dangerouslySetInnerHTML={{ __html: previewHtml }} />
}

const languageExtensionFor = (name: string) => {
  const lower = name.toLowerCase()
  if (lower.endsWith('.json')) return json()
  if (lower.endsWith('.xml')) return xml()
  if (/\.html?$/.test(lower)) return html()
  // .md / .markdown / .txt / .csv：没有装 markdown 语言模式，也不需要，纯文本即可。
  return null
}

type CellMeta = { kind: 'normal' } | { kind: 'anchor'; rowSpan: number; colSpan: number } | { kind: 'covered' }

function buildRowMeta(sheet: ExcelSheet): CellMeta[][] {
  const meta: CellMeta[][] = Array.from({ length: sheet.rows }, () =>
    Array.from({ length: sheet.columns }, () => ({ kind: 'normal' }) as CellMeta))

  for (const merge of sheet.merges) {
    const anchor = meta[merge.startRow]?.[merge.startCol]
    if (anchor) anchor.kind = 'normal'
    if (meta[merge.startRow]?.[merge.startCol]) {
      meta[merge.startRow][merge.startCol] = {
        kind: 'anchor',
        rowSpan: merge.endRow - merge.startRow + 1,
        colSpan: merge.endCol - merge.startCol + 1,
      }
    }
    for (let row = merge.startRow; row <= merge.endRow; row += 1) {
      for (let col = merge.startCol; col <= merge.endCol; col += 1) {
        if (row === merge.startRow && col === merge.startCol) continue
        if (meta[row]?.[col]) meta[row][col] = { kind: 'covered' }
      }
    }
  }

  return meta
}

// 单元格按行 memo：改一格只重渲染那一行，不牵动整张表。
// 依赖 rows 是不可变的逐行替换 —— 见下面 updateCell 的实现。
const SheetRow = memo(function SheetRow({ rowIndex, values, meta, columnWidths, rowHeight, onChange, onFocusCell, onBlurCell }: {
  rowIndex: number
  values: (string | number | boolean | null)[]
  meta: CellMeta[]
  columnWidths: number[]
  rowHeight: number
  onChange: (rowIndex: number, colIndex: number, value: string) => void
  onFocusCell: (rowIndex: number, colIndex: number) => void
  onBlurCell: () => void
}) {
  return <tr style={{ height: rowHeight }}>
    <th className="sticky left-0 z-10 w-12 border border-base-300 bg-base-200/80 px-0 text-center text-[11px] font-normal text-base-content/50">{rowIndex + 1}</th>
    {values.map((value, colIndex) => {
      const cellMeta = meta[colIndex]
      if (cellMeta?.kind === 'covered') return null
      const span = cellMeta?.kind === 'anchor' ? cellMeta : null
      return <td
        key={colIndex}
        rowSpan={span?.rowSpan}
        colSpan={span?.colSpan}
        className="border border-base-300 p-0 align-middle"
        style={{ minWidth: columnWidths[colIndex] ?? 120 }}
      >
        <input
          value={value == null ? '' : String(value)}
          onChange={(event) => onChange(rowIndex, colIndex, event.target.value)}
          onFocus={() => onFocusCell(rowIndex, colIndex)}
          onBlur={onBlurCell}
          className={`h-full w-full min-w-0 bg-transparent px-2 py-1.5 text-[13px] text-base-content outline-none focus:bg-primary/5 ${span?.colSpan && span.colSpan > 1 ? 'text-center' : ''}`}
          aria-label={`第 ${rowIndex + 1} 行 第 ${colIndex + 1} 列`}
        />
      </td>
    })}
  </tr>
})

const MAX_COMFORTABLE_CELLS = 5000

function SheetEditor({ draft, onChange }: { draft: Extract<EditDraft, { kind: 'sheet' }>; onChange: (updater: DraftUpdater) => void }) {
  const sheet = draft.sheets[draft.activeSheet]
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null)
  const rowMetas = useMemo(() => buildRowMeta(sheet), [sheet])

  // 只依赖 onChange（身份稳定），不捕获 draft —— 回调标识跨渲染不变，SheetRow 的 memo 才拦得住。
  const updateCell = useCallback((rowIndex: number, colIndex: number, raw: string) => {
    onChange((current) => {
      if (current.kind !== 'sheet') return current
      const target = current.sheets[current.activeSheet]
      const original = target.data[rowIndex]?.[colIndex]
      // 只有原本就是数字的格子才保持数字。文本格子一律按文本存 ——
      // 否则「007」这类带前导零的编号会被 Number() 吃成 7。
      const next: string | number | boolean | null = typeof original === 'number' && raw !== '' && Number.isFinite(Number(raw))
        ? Number(raw)
        : (raw === '' ? null : raw)
      return {
        ...current,
        sheets: current.sheets.map((item, index) => index !== current.activeSheet ? item : {
          ...item,
          // 只替换被改的这一行，其余行保持同一个数组引用，memo 才有意义。
          data: item.data.map((row, rowIdx) => rowIdx !== rowIndex ? row : row.map((cell, colIdx) => colIdx !== colIndex ? cell : next)),
        }),
      }
    })
  }, [onChange])

  const focusCell = useCallback((row: number, col: number) => setSelected({ row, col }), [])
  const blurCell = useCallback(() => setSelected(null), [])

  const switchSheet = (index: number) => onChange((current) => current.kind === 'sheet' ? { ...current, activeSheet: index } : current)
  const totalCells = sheet.rows * sheet.columns
  const cellAddress = selected ? `${XLSX.utils.encode_col(selected.col)}${selected.row + 1}` : ''
  const cellValue = selected ? sheet.data[selected.row]?.[selected.col] : null

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-base-300 bg-base-200/50 px-3 text-xs">
      <span className="flex h-6 w-16 items-center justify-center rounded border border-base-300 bg-base-100 font-mono text-[11px] text-base-content/70" aria-label="当前单元格">{cellAddress}</span>
      <span className="min-w-0 flex-1 truncate rounded border border-base-300 bg-base-100 px-2 py-1 font-mono text-[11px] text-base-content/70">{cellValue == null ? '' : String(cellValue)}</span>
      <span className="shrink-0 text-base-content/40">{sheet.rows} 行 × {sheet.columns} 列</span>
    </div>
    {totalCells > MAX_COMFORTABLE_CELLS ? <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">该工作表有 {totalCells} 个单元格，编辑时可能卡顿。</p> : null}
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 w-12 border border-base-300 bg-base-200 px-0" />
            {Array.from({ length: sheet.columns }, (_, colIndex) => (
              <th key={colIndex} className="sticky top-0 z-20 border border-base-300 bg-base-200 px-2 py-1 text-center text-[11px] font-medium text-base-content/60">{XLSX.utils.encode_col(colIndex)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.data.map((values, rowIndex) => (
            <SheetRow
              key={rowIndex}
              rowIndex={rowIndex}
              values={values}
              meta={rowMetas[rowIndex]}
              columnWidths={sheet.columnWidths}
              rowHeight={sheet.rowHeights[rowIndex] ?? 34}
              onChange={updateCell}
              onFocusCell={focusCell}
              onBlurCell={blurCell}
            />
          ))}
        </tbody>
      </table>
    </div>
    {draft.sheets.length > 1 ? <div className="flex h-10 shrink-0 items-end gap-0.5 overflow-x-auto border-t border-base-300 bg-base-200/40 px-3">
      {draft.sheets.map((item, index) => (
        <button
          key={item.name}
          type="button"
          onClick={() => switchSheet(index)}
          className={`h-9 shrink-0 border-x border-t px-4 text-xs transition ${index === draft.activeSheet ? 'border-base-300 bg-base-100 font-medium text-emerald-700' : 'border-transparent text-base-content/55 hover:bg-base-200'}`}
        >{item.name}</button>
      ))}
    </div> : null}
  </div>
}

function TextEditor({ value, name, onChange, fill }: { value: string; name: string; onChange: (value: string) => void; fill: boolean }) {
  const extensions = useMemo(() => {
    const language = languageExtensionFor(name)
    return [...(language ? [language] : []), EditorView.lineWrapping, editorChromeTheme]
  }, [name])

  return <div className={fill ? 'h-full min-h-0' : 'min-h-0 flex-1'}>
    <CodeMirror
      className="h-full text-sm"
      value={value}
      height="100%"
      extensions={extensions}
      basicSetup={editorSetup}
      onChange={onChange}
    />
  </div>
}

export function DocumentEditor({ kind, itemName, draft, onChange }: {
  kind: EditableKind
  itemName: string
  draft: EditDraft
  onChange: (updater: DraftUpdater) => void
}) {
  const notice = LOSS_NOTICE[kind]
  const formatNotice = kind === 'word' && /\.doc$/i.test(itemName)
    ? '旧版 .doc 不支持原格式回写；保存时将转换为 .docx，并同步修改知识库中的文件名。'
    : null

  const body = (() => {
    if (draft.kind === 'sheet') return <SheetEditor draft={draft} onChange={onChange} />

    if (draft.kind === 'word') {
      if (draft.format === 'docx') {
        return <div className="min-h-0 flex-1 overflow-auto bg-base-100 px-8 py-6">
          <div className="mx-auto max-w-205 space-y-3">
            {draft.paragraphs.map((paragraph, index) => <textarea
              key={index}
              aria-label={`第 ${index + 1} 段`}
              value={paragraph.text}
              rows={Math.min(8, Math.max(1, Math.ceil(paragraph.text.length / 90)))}
              onChange={(event) => {
                const text = event.target.value.replace(/[\r\n]+/g, ' ')
                onChange((current) => current.kind === 'word' && current.format === 'docx'
                  ? { ...current, paragraphs: current.paragraphs.map((entry, entryIndex) => entryIndex === index ? { ...entry, text } : entry) }
                  : current)
              }}
              className={`block w-full resize-y rounded-md border border-transparent bg-transparent px-3 py-1.5 leading-7 text-base-content outline-none transition focus:border-primary/40 focus:bg-primary/5 ${wordParagraphClasses[paragraph.style]} ${paragraph.inTable ? 'border-l-2 border-base-300' : ''}`}
            />)}
          </div>
        </div>
      }

      return <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col border-r border-base-300"><TextEditor value={draft.markdown} name={itemName} onChange={(markdown) => onChange(() => ({ kind: 'word', format: 'legacy', markdown }))} fill /></div>
        <div className="min-w-0 flex-1 overflow-auto bg-base-100"><MarkdownPreview markdown={draft.markdown} /></div>
      </div>
    }

    const isMarkdown = kind === 'markdown'
    if (!isMarkdown) return <div className="flex min-h-0 flex-1 flex-col"><TextEditor value={draft.text} name={itemName} onChange={(text) => onChange(() => ({ kind: 'text', text }))} fill /></div>

    return <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col border-r border-base-300"><TextEditor value={draft.text} name={itemName} onChange={(text) => onChange(() => ({ kind: 'text', text }))} fill /></div>
      <div className="min-w-0 flex-1 overflow-auto bg-base-100"><MarkdownPreview markdown={draft.text} /></div>
    </div>
  })()

  return <div className="flex min-h-0 flex-1 flex-col">
    {formatNotice ? <p className="shrink-0 border-b border-blue-200 bg-blue-50 px-4 py-2 text-[11px] leading-5 text-blue-700">{formatNotice}</p> : null}
    {draft.kind === 'word' && draft.format === 'docx' ? <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] leading-5 text-amber-700">仅编辑原文档现有段落文字；保存会保留原 DOCX 的图片、页眉页脚、表格结构和版式。不支持新增/删除段落或修改格式。</p> : null}
    {notice ? <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] leading-5 text-amber-700">{notice}</p> : null}
    {body}
  </div>
}

export default DocumentEditor
