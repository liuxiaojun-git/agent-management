export type RawBodyType = 'json' | 'text' | 'javascript' | 'html' | 'xml'
export type BodyMode =
  | 'none'
  | 'form-data'
  | 'urlencoded'
  | 'raw'
  | 'binary'
  | 'graphql'

export interface BodyField {
  id: string
  key: string
  value: string
  enabled: boolean
  kind: 'text' | 'file'
  fileName?: string
  fileType?: string
  fileBase64?: string
}

export interface BinaryBody {
  fileName: string
  mimeType: string
  base64: string
  size: number
}

export interface RequestBodyConfig {
  mode: BodyMode
  rawType: RawBodyType
  fields: BodyField[]
  binary: BinaryBody | null
  graphqlQuery: string
  graphqlVariables: string
}

export interface EncodedRequestBody {
  body?: string
  bodyEncoding?: 'base64'
  contentType?: string
}

const encoder = new TextEncoder()

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const result = new Uint8Array(size)
  let offset = 0
  parts.forEach(part => {
    result.set(part, offset)
    offset += part.length
  })
  return result
}

function quoteHeaderValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function buildMultipart(fields: BodyField[]): EncodedRequestBody {
  const boundary = `----AgentManagement${Date.now().toString(16)}`
  const parts: Uint8Array[] = []
  const appendText = (value: string) => parts.push(encoder.encode(value))

  fields.filter(field => field.enabled && field.key).forEach(field => {
    appendText(`--${boundary}\r\n`)
    const key = quoteHeaderValue(field.key)
    if (field.kind === 'file' && field.fileBase64) {
      const fileName = quoteHeaderValue(field.fileName || 'file')
      appendText(
        `Content-Disposition: form-data; name="${key}"; filename="${fileName}"\r\n`
        + `Content-Type: ${field.fileType || 'application/octet-stream'}\r\n\r\n`,
      )
      parts.push(base64ToBytes(field.fileBase64))
      appendText('\r\n')
      return
    }
    appendText(`Content-Disposition: form-data; name="${key}"\r\n\r\n${field.value}\r\n`)
  })

  appendText(`--${boundary}--\r\n`)
  return {
    body: bytesToBase64(concatBytes(parts)),
    bodyEncoding: 'base64',
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

export function buildRequestBody(
  config: RequestBodyConfig,
  rawBody: string,
): EncodedRequestBody {
  switch (config.mode) {
    case 'none':
      return {}
    case 'raw':
      return rawBody ? { body: rawBody } : {}
    case 'urlencoded': {
      const params = new URLSearchParams()
      config.fields
        .filter(field => field.enabled && field.key)
        .forEach(field => params.append(field.key, field.value))
      return {
        body: params.toString(),
        contentType: 'application/x-www-form-urlencoded',
      }
    }
    case 'form-data':
      return buildMultipart(config.fields)
    case 'binary':
      return config.binary
        ? {
            body: config.binary.base64,
            bodyEncoding: 'base64',
            contentType: config.binary.mimeType || 'application/octet-stream',
          }
        : {}
    case 'graphql': {
      let variables: unknown = {}
      if (config.graphqlVariables.trim()) {
        variables = JSON.parse(config.graphqlVariables)
      }
      return {
        body: JSON.stringify({ query: config.graphqlQuery, variables }),
        contentType: 'application/json',
      }
    }
  }
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export function createBodyField(): BodyField {
  return {
    id: `field_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    key: '',
    value: '',
    enabled: true,
    kind: 'text',
  }
}
