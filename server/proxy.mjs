export async function handleProxyRequest(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', async () => {
    try {
      const { url: targetUrl, options } = JSON.parse(body)
      if (!targetUrl) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'Missing target url' }))
        return
      }

      const sanitizedOptions = { ...options }
      delete sanitizedOptions.signal
      delete sanitizedOptions.bodyUsed
      delete sanitizedOptions.duplex

      const upstream = await fetch(targetUrl, sanitizedOptions)
      const buffer = Buffer.from(await upstream.arrayBuffer())
      res.statusCode = upstream.status
      res.statusMessage = upstream.statusText
      upstream.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'content-length') {
          res.setHeader(key, value)
        }
      })
      res.setHeader('Content-Length', buffer.length)
      res.end(buffer)
    } catch (err) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: err.message }))
    }
  })
}
