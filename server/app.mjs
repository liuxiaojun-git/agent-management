import { createServer } from 'http'
import { promises as fs } from 'fs'
import { join, dirname, extname } from 'path'
import { fileURLToPath } from 'url'
import { getData, setData } from './storage.mjs'
import { handleProxyRequest } from './proxy.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const distDir = join(__dirname, '..', 'dist')
const host = '0.0.0.0'
const port = 8081
const apiBase = process.env.API_BASE || '/api/data'

const contentTypeMap = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function serveFile(res, filePath) {
  try {
    const data = await fs.readFile(filePath)
    const ext = extname(filePath).toLowerCase()
    const contentType = contentTypeMap[ext] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(data)
  } catch (err) {
    if (err.code === 'ENOENT') {
      const indexPath = join(distDir, 'index.html')
      try {
        const data = await fs.readFile(indexPath)
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(data)
      } catch {
        res.writeHead(500)
        res.end('Internal Server Error')
      }
    } else {
      res.writeHead(500)
      res.end('Internal Server Error')
    }
  }
}

async function handleApiRequest(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, error: 'Method Not Allowed' }))
    return
  }

  let body = ''
  for await (const chunk of req) {
    body += chunk
  }

  try {
    const { action, name, data } = JSON.parse(body)
    if (action === 'get') {
      const result = getData(name)
      sendJson(res, 200, { success: true, data: result })
    } else if (action === 'set') {
      setData(name, data)
      sendJson(res, 200, { success: true })
    } else {
      sendJson(res, 400, { success: false, error: 'Unknown action' })
    }
  } catch (err) {
    sendJson(res, 500, { success: false, error: err.message })
  }
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400)
    res.end('Bad Request')
    return
  }

  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname === apiBase) {
    await handleApiRequest(req, res)
    return
  }

  if (url.pathname === '/api/proxy') {
    await handleProxyRequest(req, res)
    return
  }

  const pathname = url.pathname === '/' ? '/index.html' : url.pathname
  const filePath = join(distDir, pathname)
  await serveFile(res, filePath)
})

server.listen(port, host, () => {
  console.log(`Production server running on http://${host}:${port}`)
  console.log(`API endpoint: ${apiBase}`)
})
