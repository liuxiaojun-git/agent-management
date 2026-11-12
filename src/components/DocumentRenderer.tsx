import { useEffect, useState, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import {
  parseExcelFile,
  parseWordDocument,
  createWordDocumentFromPlainText,
  createExcelPreviewHtml,
  createMarkdownPreviewHtml,
  createWordPreviewHtml,
} from '../utils/documentRenderer'
import { getLegacyWordText } from '../utils/api'

interface ContentItem {
  id: string
  name: string
  type: 'folder' | 'doc' | 'pdf' | 'image'
  count?: number
  createdAt: string
  updatedAt: string
  parent?: string
  src?: string
  mimeType?: string
  size?: number
  hasAsset?: boolean
}

interface DocumentRendererProps {
  item: ContentItem
  /** 已水合出的可读地址（data: 或 blob:）。由父组件通过 useContentSrc 取回，本组件不关心来源与鉴权。 */
  src?: string
  onLoadingChange?: (loading: boolean) => void
  /** Word 预览按 A4 比例排版后计算出的页数。 */
  onPageCountChange?: (pageCount: number) => void
  /** 当前滚动位置对应的 Word 页码。 */
  onCurrentPageChange?: (page: number) => void
  onTocChange?: (entries: Array<{ id: string; text: string; level: number }>) => void
}

// Markdown 预览的排版规则。文档编辑器的分栏预览要和只读预览一致，所以单独导出复用。
export const markdownTypographyClassName = 'text-[15px] leading-7 text-base-content/85 [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:my-6 [&_blockquote]:border-l-2 [&_blockquote]:border-base-content/25 [&_blockquote]:pl-4 [&_blockquote]:text-base-content/65 [&_code]:rounded-md [&_code]:bg-base-200 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em] [&_em]:italic [&_h1]:mb-7 [&_h1]:mt-0 [&_h1]:text-[2rem] [&_h1]:font-semibold [&_h1]:leading-tight [&_h2]:mb-4 [&_h2]:mt-10 [&_h2]:border-b [&_h2]:border-base-300 [&_h2]:pb-2 [&_h2]:text-[1.5rem] [&_h2]:font-semibold [&_h2]:leading-snug [&_h3]:mb-3 [&_h3]:mt-8 [&_h3]:text-[1.2rem] [&_h3]:font-semibold [&_h3]:leading-snug [&_hr]:my-8 [&_hr]:border-base-300 [&_li]:my-1 [&_li]:pl-1 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:pl-7 [&_p]:my-5 [&_p]:leading-7 [&_pre]:my-6 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-neutral [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:leading-6 [&_pre]:text-neutral-content [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-base-300 [&_td]:px-3 [&_td]:py-2 [&_th]:border [&_th]:border-base-300 [&_th]:bg-base-200/70 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_.markdown-table-wrap]:my-6 [&_.markdown-table-wrap]:overflow-x-auto [&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-7'

// 只读预览的整页外框。编辑器里的分栏预览不用它 —— min-h / max-w 是整页尺寸，塞进分栏会撑出滚动条。
export const markdownPreviewClassName = `markdown-preview mx-auto min-h-130 max-w-205 bg-base-100 px-6 py-10 sm:px-10 md:px-14 ${markdownTypographyClassName}`

export function DocumentRenderer({ item, src, onLoadingChange, onPageCountChange, onCurrentPageChange, onTocChange }: DocumentRendererProps) {
  const headingIdPrefix = useId().replace(/:/g, '')
  // 初值为 true：组件挂载时文件还没水合完，先显示解析中的占位，避免闪一帧「无法加载文档内容」。
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [htmlContent, setHtmlContent] = useState('')
  const [textContent, setTextContent] = useState<string | null>(null)
  const [activeImage, setActiveImage] = useState<{ src: string; alt: string } | null>(null)
  const imageTriggerRef = useRef<HTMLImageElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = containerRef.current
    if (!root) {
      onTocChange?.([])
      return
    }
    const links = Array.from(root.querySelectorAll<HTMLElement>('.markdown-preview h1, .markdown-preview h2, .markdown-preview h3, .word-content h1, .word-content h2, .word-content h3, .word-content h4, .word-content h5, .word-content h6'))
    links.forEach((heading, index) => { heading.id = `preview-heading-${headingIdPrefix}-${index}` })
    onTocChange?.(links.map((heading, index) => ({ id: heading.id, text: heading.textContent?.trim() || `章节 ${index + 1}`, level: Number(heading.tagName.slice(1)) })))
  }, [htmlContent, loading, onTocChange, headingIdPrefix])

  useEffect(() => {
    const root = containerRef.current
    if (!root || loading) return

    const prepareImages = () => {
      root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
        image.tabIndex = 0
        image.setAttribute('role', 'button')
        image.setAttribute('aria-label', image.alt ? `放大查看图片：${image.alt}` : '放大查看图片')
        image.style.cursor = 'zoom-in'
      })
    }

    const openImage = (image: HTMLImageElement) => {
      if (!image.src) return
      imageTriggerRef.current = image
      setActiveImage({ src: image.src, alt: image.alt })
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const image = target.closest<HTMLImageElement>('img')
      if (!image || !root.contains(image)) return
      event.preventDefault()
      event.stopPropagation()
      openImage(image)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const target = event.target
      if (!(target instanceof Element)) return
      const image = target.closest<HTMLImageElement>('img')
      if (!image || !root.contains(image)) return
      event.preventDefault()
      openImage(image)
    }

    prepareImages()
    const observer = new MutationObserver(prepareImages)
    observer.observe(root, { childList: true, subtree: true })
    root.addEventListener('click', handleClick)
    root.addEventListener('keydown', handleKeyDown)
    return () => {
      observer.disconnect()
      root.removeEventListener('click', handleClick)
      root.removeEventListener('keydown', handleKeyDown)
    }
  }, [htmlContent, loading])

  useEffect(() => {
    if (!activeImage) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveImage(null)
        requestAnimationFrame(() => imageTriggerRef.current?.focus())
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeImage])

  // 类型判定放在渲染期：未托管的类型不能停在 loading 占位，而「是否托管」是个纯计算，不该靠 effect 里的 setState 表达。
  const isExcel = /\.(xlsx?|csv)$/i.test(item.name)
  const isWord = /\.(docx?)$/i.test(item.name)
  const isLegacyWord = /\.doc$/i.test(item.name)
  const isMarkdown = /\.(md|markdown)$/i.test(item.name) || item.mimeType === 'text/markdown'
  const isText = !isExcel && (/\.(txt|md|markdown|json|xml|html?)$/i.test(item.name) || item.mimeType?.startsWith('text/'))
  const handled = isExcel || isWord || isText

  useEffect(() => {
    // 还没有可读地址（水合中）——保持 loading 占位。
    // 本组件不负责的类型直接返回，交给外层的「无法加载文档内容」兜底。
    if ((!src && !isLegacyWord) || !handled) return

    let cancelled = false

    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        setHtmlContent('')
        setTextContent(null)
        onLoadingChange?.(true)

        if (isText) {
          if (!src) throw new Error('文件内容不可用')
          const response = await fetch(src)
          if (!response.ok) throw new Error(`文本读取失败（${response.status}）`)
          const text = await response.text()
          if (cancelled) return
          if (isMarkdown) setHtmlContent(createMarkdownPreviewHtml(text))
          else setTextContent(text)
        } else if (isExcel) {
          if (!src) throw new Error('文件内容不可用')
          const parsedSheets = await parseExcelFile(src)
          if (cancelled) return
          const html = createExcelPreviewHtml(parsedSheets)
          setHtmlContent(html)
        } else if (isWord) {
          let doc
          if (isLegacyWord) {
            const result = await getLegacyWordText(item.id)
            if (!result.success || !result.data) throw new Error(result.error || '旧版 .doc 文档解析失败')
            doc = createWordDocumentFromPlainText(result.data.text)
          } else {
            if (!src) throw new Error('文件内容不可用')
            doc = await parseWordDocument(src, item.name)
          }
          if (cancelled) return
          const html = createWordPreviewHtml(doc)
          setHtmlContent(html)
        }
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : '未知错误'
        setError(`文档解析失败: ${message}`)
        console.error('Document rendering error:', err)
      } finally {
        if (!cancelled) {
          setLoading(false)
          onLoadingChange?.(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [item.id, item.name, src, handled, isExcel, isWord, isLegacyWord, isMarkdown, isText, onLoadingChange])

  // 为 Excel 表格标签页添加事件监听
  useEffect(() => {
    if (!containerRef.current || htmlContent.indexOf('sheet-tab') === -1) return

    const handleTabClick = (e: Event) => {
      const target = e.currentTarget as HTMLElement
      const sheetIndex = parseInt(target.getAttribute('data-sheet') || '0', 10)
      
      // 更新按钮样式
      const tabs = containerRef.current?.querySelectorAll('.sheet-tab')
      tabs?.forEach((tab, index) => {
        if (index === sheetIndex) {
          tab.classList.remove('border-transparent', 'text-base-content/60')
          tab.classList.add('border-primary', 'text-primary')
        } else {
          tab.classList.remove('border-primary', 'text-primary')
          tab.classList.add('border-transparent', 'text-base-content/60')
        }
      })
      
      // 切换内容显示
      const contents = containerRef.current?.querySelectorAll('.sheet-content')
      contents?.forEach((content, index) => {
        if (index === sheetIndex) {
          (content as HTMLElement).style.display = ''
        } else {
          (content as HTMLElement).style.display = 'none'
        }
      })
      const selected = containerRef.current?.querySelector<HTMLElement>('[data-excel-selected="true"]')
      if (selected) {
        selected.style.boxShadow = ''
        selected.style.position = ''
        selected.removeAttribute('data-excel-selected')
      }
      const nameBox = containerRef.current?.querySelector<HTMLElement>('[data-excel-name]')
      const formulaBar = containerRef.current?.querySelector<HTMLElement>('[data-excel-formula]')
      if (nameBox) nameBox.textContent = 'A1'
      if (formulaBar) formulaBar.textContent = ''
    }

    const tabs = containerRef.current?.querySelectorAll('.sheet-tab')
    tabs?.forEach((tab) => {
      tab.addEventListener('click', handleTabClick)
    })

    return () => {
      tabs?.forEach((tab) => {
        tab.removeEventListener('click', handleTabClick)
      })
    }
  }, [htmlContent])

  // mammoth 输出的是连续 HTML，无法保留 Word 的物理分页符。这里按 A4 可用内容区的
  // 高度计算页数。不能只监听外层 article：它的尺寸在内容溢出时不一定变化，曾导致多页
  // 文档始终被当作 1 页。
  useEffect(() => {
    if (!/\.docx?$/i.test(item.name) || !htmlContent || !containerRef.current) return
    const preview = containerRef.current.querySelector<HTMLElement>('.word-preview')
    const content = preview?.querySelector<HTMLElement>('.word-content')
    if (!preview || !content) return

    let pageCount = 1
    let pageHeight = 1
    const findScrollParent = () => {
      const markedParent = containerRef.current?.closest<HTMLElement>('[data-document-preview-scroll]')
      if (markedParent) return markedParent
      let parent = containerRef.current?.parentElement
      while (parent) {
        const overflowY = window.getComputedStyle(parent).overflowY
        if (overflowY === 'auto' || overflowY === 'scroll') return parent
        parent = parent.parentElement
      }
      return null
    }
    const updateCurrentPage = () => {
      const scrollParent = findScrollParent()
      if (!scrollParent) return
      const maxScrollTop = scrollParent.scrollHeight - scrollParent.clientHeight
      if (maxScrollTop <= 0 || pageCount <= 1) {
        onCurrentPageChange?.(1)
        return
      }
      // 以阅读区域的真实滚动进度换算页码，避免 transform: scale() 改变屏幕坐标后
      // 使页码始终停在第 1 页。
      const progress = Math.min(1, Math.max(0, scrollParent.scrollTop / maxScrollTop))
      onCurrentPageChange?.(Math.min(pageCount, Math.floor(progress * pageCount) + 1))
    }
    const updatePageCount = () => {
      const width = preview.offsetWidth
      if (!width) return
      const styles = window.getComputedStyle(preview)
      const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom)
      const physicalPageHeight = Math.max(640, Math.round(width * 297 / 210))
      pageHeight = Math.max(1, physicalPageHeight - verticalPadding)
      const pageKey = `${Math.round(width)}-${Math.round(pageHeight)}`
      const existingPages = Array.from(content.querySelectorAll<HTMLElement>(':scope > .word-page'))
      if (content.dataset.pageKey !== pageKey || existingPages.length === 0) {
        const sourceHtml = content.dataset.sourceHtml ?? content.innerHTML
        content.dataset.pageKey = pageKey
        content.innerHTML = sourceHtml
        const headings = Array.from(content.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'))
        headings.forEach((heading, index) => { heading.id = `preview-heading-${headingIdPrefix}-${index}` })
        content.dataset.sourceHtml = content.innerHTML
        const blocks = Array.from(content.childNodes)
        content.replaceChildren()
        Object.assign(content.style, { display: 'flex', flexDirection: 'column', gap: '1.5rem' })
        preview.style.backgroundColor = '#f1f5f9'

        const pages: HTMLElement[] = []
        const createPage = () => {
          const page = document.createElement('section')
          page.className = 'word-page'
          Object.assign(page.style, {
            position: 'relative',
            boxSizing: 'border-box',
            minHeight: `${pageHeight}px`,
            backgroundColor: '#fff',
            paddingBottom: '3rem',
            boxShadow: '0 1px 3px rgba(15, 23, 42, .12)',
          })
          content.appendChild(page)
          pages.push(page)
          return page
        }
        let page = createPage()
        for (const block of blocks) {
          page.appendChild(block)
          if (page.scrollHeight > pageHeight && page.childNodes.length > 1) {
            page.removeChild(block)
            page = createPage()
            page.appendChild(block)
          }
        }
        pageCount = pages.length
        pages.forEach((pageElement, index) => {
          const footer = document.createElement('footer')
          Object.assign(footer.style, {
            position: 'absolute',
            right: '2.5rem',
            bottom: '1.25rem',
            left: '2.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTop: '1px solid #e2e8f0',
            paddingTop: '.75rem',
            color: '#94a3b8',
            fontSize: '10px',
            lineHeight: '1.4',
          })
          const brand = document.createElement('span')
          brand.textContent = '智域知识库'
          const pageNumber = document.createElement('span')
          pageNumber.textContent = `${index + 1} / ${pageCount}`
          Object.assign(pageNumber.style, { color: '#64748b', fontVariantNumeric: 'tabular-nums' })
          footer.append(brand, pageNumber)
          pageElement.appendChild(footer)
        })
      } else {
        pageCount = existingPages.length
      }
      onPageCountChange?.(pageCount)
      updateCurrentPage()
    }

    // 图片、字体和表格会在首次绘制后继续改变高度，延后一帧并监听内容本身。
    const frame = window.requestAnimationFrame(updatePageCount)
    const observer = new ResizeObserver(updatePageCount)
    observer.observe(content)
    observer.observe(preview)
    const mutationObserver = new MutationObserver(updatePageCount)
    mutationObserver.observe(content, { childList: true, subtree: true, characterData: true })
    const images = Array.from(content.querySelectorAll('img'))
    images.forEach((image) => image.addEventListener('load', updatePageCount))
    const scrollParent = findScrollParent()
    scrollParent?.addEventListener('scroll', updateCurrentPage, { passive: true })
    // scroll 事件不冒泡；使用捕获阶段可覆盖缩放包装层或布局调整后实际承载滚动的元素。
    const handleAnyScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && containerRef.current?.contains(target)) return
      updateCurrentPage()
    }
    window.addEventListener('scroll', handleAnyScroll, { capture: true, passive: true })
    window.addEventListener('resize', updatePageCount, { passive: true })
    document.fonts?.ready.then(updatePageCount).catch(() => undefined)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      mutationObserver.disconnect()
      images.forEach((image) => image.removeEventListener('load', updatePageCount))
      scrollParent?.removeEventListener('scroll', updateCurrentPage)
      window.removeEventListener('scroll', handleAnyScroll, true)
      window.removeEventListener('resize', updatePageCount)
    }
    // loading 必须在依赖里：解析中渲染的是 loading 占位而不是容器，此时 containerRef 还是空的。
    // 少了它，分页只会在「容器未挂载」的那一次跑一遍就再也不重跑，Word 预览会丢掉分页。
  }, [htmlContent, loading, item.name, onCurrentPageChange, onPageCountChange, headingIdPrefix])

  // Excel 单元格选择：显示名称框和当前单元格内容。
  useEffect(() => {
    const container = containerRef.current
    if (!container || htmlContent.indexOf('data-excel-cell') === -1) return
    const handleCellClick = (event: MouseEvent) => {
      const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-excel-cell="true"]')
      if (!cell || !container.contains(cell)) return
      const previous = container.querySelector<HTMLElement>('[data-excel-selected="true"]')
      if (previous && previous !== cell) {
        previous.style.boxShadow = ''
        previous.style.position = ''
        previous.removeAttribute('data-excel-selected')
      }
      cell.setAttribute('data-excel-selected', 'true')
      cell.style.position = 'relative'
      cell.style.boxShadow = 'inset 0 0 0 2px #16a34a'
      const nameBox = container.querySelector<HTMLElement>('[data-excel-name]')
      const formulaBar = container.querySelector<HTMLElement>('[data-excel-formula]')
      if (nameBox) nameBox.textContent = cell.dataset.address || ''
      if (formulaBar) {
        formulaBar.textContent = cell.dataset.value || ''
        formulaBar.title = cell.dataset.value || ''
      }
    }
    container.addEventListener('click', handleCellClick)
    return () => container.removeEventListener('click', handleCellClick)
  }, [htmlContent])

  // 托管类型且还没拿到地址 / 还在解析 → 占位；未托管的类型直接落到下面的兜底文案。
  if (handled && (loading || (!src && !isLegacyWord))) {
    return (
      <div className="mx-auto flex min-h-130 max-w-205 items-center justify-center rounded-xl border border-base-300 bg-base-100 text-sm text-base-content/45">
        <div className="text-center">
          <div className="loading loading-spinner loading-lg mb-4"></div>
          <p>正在解析文档...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto flex min-h-130 max-w-205 flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 text-sm text-red-600">
        <div className="text-center">
          <p className="mb-2 text-lg font-medium">解析文档失败</p>
          <p>{error}</p>
          <p className="mt-4 text-xs text-red-500/70">请检查文件格式是否正确</p>
        </div>
      </div>
    )
  }

  if (textContent !== null) {
    return (
      <article className="mx-auto min-h-130 max-w-205 rounded-xl border border-base-300 bg-base-100 px-6 py-10 sm:px-10 md:px-14">
        <div className="mb-6 flex items-center justify-between border-b border-base-300 pb-3 text-xs text-base-content/45">
          <span className="truncate">{item.name}</span>
          <span className="ml-4 shrink-0">{item.mimeType || 'text/plain'}{item.size ? ` · ${Math.max(1, Math.round(item.size / 1024))} KB` : ''}</span>
        </div>
        <pre className="whitespace-pre-wrap wrap-anywhere font-mono text-[13px] leading-6 text-base-content/80">{textContent || '（空文本文件）'}</pre>
      </article>
    )
  }

  if (!htmlContent) {
    return (
      <div className="mx-auto flex min-h-130 max-w-205 items-center justify-center rounded-xl border border-base-300 bg-base-100 text-sm text-base-content/45">
        无法加载文档内容
      </div>
    )
  }

  const closeImagePreview = () => {
    setActiveImage(null)
    requestAnimationFrame(() => imageTriggerRef.current?.focus())
  }

  return <>
    <div ref={containerRef} className={isMarkdown ? markdownPreviewClassName : 'mx-auto w-full min-w-0 max-w-none'} dangerouslySetInnerHTML={{ __html: htmlContent }} />
    {activeImage ? createPortal(
      <div
        role="dialog"
        aria-modal="true"
        aria-label="图片预览"
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-6"
        onClick={closeImagePreview}
      >
        <button
          type="button"
          autoFocus
          onClick={closeImagePreview}
          className="absolute right-5 top-5 rounded-lg bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20 focus:outline-2 focus:outline-offset-2 focus:outline-white"
          aria-label="关闭图片预览"
        >关闭</button>
        <figure className="m-0 flex max-h-full max-w-full flex-col items-center" onClick={(event) => event.stopPropagation()}>
          <img
            src={activeImage.src}
            alt={activeImage.alt || '文档图片放大预览'}
            className="max-h-[90vh] max-w-[94vw] object-contain"
          />
          {activeImage.alt ? <figcaption className="mt-3 max-w-[90vw] text-center text-sm text-white/80">{activeImage.alt}</figcaption> : null}
        </figure>
      </div>,
      document.body,
    ) : null}
  </>
}

export default DocumentRenderer
