import type { ViteDevServer } from 'vite'

export function proxyApiPlugin(): {
  name: string
  configureServer(server: ViteDevServer): void
}
