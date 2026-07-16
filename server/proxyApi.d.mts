export function proxyApiPlugin(): {
  name: string
  configureServer(server: any): void
}
