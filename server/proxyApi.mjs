import { handleProxyRequest } from './proxy.mjs'

export function proxyApiPlugin() {
  return {
    name: 'proxy-api',
    configureServer(server) {
      server.middlewares.use('/api/proxy', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        await handleProxyRequest(req, res)
      })
    },
  }
}
