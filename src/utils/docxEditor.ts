import JSZip from 'jszip'

const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export type DocxParagraphDraft = {
  text: string
  style: 'title' | 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6' | 'normal'
  inTable: boolean
}

export type EditableDocx = {
  sourceBytes: Uint8Array
  paragraphs: DocxParagraphDraft[]
}

const wordChildren = (element: Element, localName: string) =>
  Array.from(element.getElementsByTagNameNS(WORD_NAMESPACE, localName))

const directWordChild = (element: Element, localName: string) =>
  Array.from(element.children).find((child) => child.namespaceURI === WORD_NAMESPACE && child.localName === localName)

const paragraphStyle = (paragraph: Element): DocxParagraphDraft['style'] => {
  const paragraphProperties = directWordChild(paragraph, 'pPr')
  const styleElement = paragraphProperties ? directWordChild(paragraphProperties, 'pStyle') : undefined
  const styleId = styleElement?.getAttributeNS(WORD_NAMESPACE, 'val')?.toLowerCase() || ''
  const outlineElement = paragraphProperties ? directWordChild(paragraphProperties, 'outlineLvl') : undefined
  const outlineLevel = Number(outlineElement?.getAttributeNS(WORD_NAMESPACE, 'val'))

  if (/title/.test(styleId)) return 'title'
  const headingMatch = styleId.match(/heading\s*(\d)/)
  const headingLevel = headingMatch ? Number(headingMatch[1]) : Number.isInteger(outlineLevel) ? outlineLevel + 1 : 0
  return headingLevel >= 1 && headingLevel <= 6 ? `heading${headingLevel}` as DocxParagraphDraft['style'] : 'normal'
}

const getParagraphElements = (document: Document) => {
  const body = document.getElementsByTagNameNS(WORD_NAMESPACE, 'body').item(0)
  if (!body) throw new Error('DOCX 文件缺少正文内容')
  return wordChildren(body, 'p').filter((paragraph) => {
    let parent = paragraph.parentElement
    while (parent && parent !== body) {
      if (parent.namespaceURI === WORD_NAMESPACE && parent.localName === 'p') return false
      parent = parent.parentElement
    }
    return true
  })
}

const getRunElements = (paragraph: Element) => wordChildren(paragraph, 'r').filter((run) => {
  let parent = run.parentElement
  while (parent && parent !== paragraph && parent.localName !== 'p') parent = parent.parentElement
  return parent === paragraph && wordChildren(run, 't').length > 0
})

const getRunText = (run: Element) => wordChildren(run, 't').map((text) => text.textContent || '').join('')

const parseXml = (xml: string) => {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length) throw new Error('DOCX 正文 XML 无法解析')
  return document
}

const isParagraphInTable = (paragraph: Element) => {
  let parent = paragraph.parentElement
  while (parent) {
    if (parent.namespaceURI === WORD_NAMESPACE && parent.localName === 'tc') return true
    parent = parent.parentElement
  }
  return false
}

export async function readDocxForEditing(source: ArrayBuffer): Promise<EditableDocx> {
  const sourceBytes = new Uint8Array(source)
  const zip = await JSZip.loadAsync(sourceBytes)
  const documentFile = zip.file('word/document.xml')
  if (!documentFile) throw new Error('DOCX 文件缺少正文内容')

  const xmlDocument = parseXml(await documentFile.async('string'))
  const paragraphs = getParagraphElements(xmlDocument).map((paragraph) => ({
    text: getRunElements(paragraph).map(getRunText).join(''),
    style: paragraphStyle(paragraph),
    inTable: isParagraphInTable(paragraph),
  }))

  if (!paragraphs.length) throw new Error('DOCX 文件没有可编辑的正文段落')
  return { sourceBytes, paragraphs }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const updateRunText = (runs: Element[], nextText: string) => {
  const originalTexts = runs.map(getRunText)
  const originalText = originalTexts.join('')
  if (originalText === nextText) return

  let prefixLength = 0
  while (prefixLength < originalText.length && prefixLength < nextText.length && originalText[prefixLength] === nextText[prefixLength]) {
    prefixLength += 1
  }

  let suffixLength = 0
  while (
    suffixLength < originalText.length - prefixLength
    && suffixLength < nextText.length - prefixLength
    && originalText[originalText.length - suffixLength - 1] === nextText[nextText.length - suffixLength - 1]
  ) {
    suffixLength += 1
  }

  const changedText = nextText.slice(prefixLength, nextText.length - suffixLength)
  const changedEnd = originalText.length - suffixLength
  const offsets: Array<{ start: number; end: number }> = []
  let offset = 0
  originalTexts.forEach((text) => {
    offsets.push({ start: offset, end: offset + text.length })
    offset += text.length
  })

  let targetRunIndex = offsets.findIndex(({ end }) => end > prefixLength)
  if (targetRunIndex < 0) targetRunIndex = offsets.length - 1

  let nextOffset = 0
  originalTexts.forEach((text, index) => {
    const start = nextOffset
    const end = start + text.length
    nextOffset = end

    const prefix = text.slice(0, clamp(prefixLength - start, 0, text.length))
    const suffix = text.slice(clamp(changedEnd - start, 0, text.length))
    const updatedText = index === targetRunIndex ? `${prefix}${changedText}${suffix}` : `${prefix}${suffix}`
    const textElements = wordChildren(runs[index], 't')
    const firstText = textElements[0]
    if (!firstText) return

    firstText.textContent = updatedText
    if (/^\s|\s$/.test(updatedText)) firstText.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
    else firstText.removeAttributeNS('http://www.w3.org/XML/1998/namespace', 'space')
    textElements.slice(1).forEach((textElement) => { textElement.textContent = '' })
  })
}

export async function writeDocxEdits(sourceBytes: Uint8Array, paragraphs: DocxParagraphDraft[]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(sourceBytes)
  const documentFile = zip.file('word/document.xml')
  if (!documentFile) throw new Error('DOCX 文件缺少正文内容')

  const xmlDocument = parseXml(await documentFile.async('string'))
  const sourceParagraphs = getParagraphElements(xmlDocument)
  if (sourceParagraphs.length !== paragraphs.length) {
    throw new Error('文档段落结构已变化，请取消编辑后重新打开文档')
  }

  sourceParagraphs.forEach((paragraph, index) => {
    let runs = getRunElements(paragraph)
    if (!runs.length && paragraphs[index].text) {
      const run = xmlDocument.createElementNS(WORD_NAMESPACE, 'w:r')
      const text = xmlDocument.createElementNS(WORD_NAMESPACE, 'w:t')
      text.textContent = paragraphs[index].text
      if (/^\s|\s$/.test(paragraphs[index].text)) {
        text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve')
      }
      run.appendChild(text)
      paragraph.appendChild(run)
      runs = [run]
    }
    updateRunText(runs, paragraphs[index].text)
  })

  zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDocument))
  return zip.generateAsync({ type: 'uint8array' })
}
