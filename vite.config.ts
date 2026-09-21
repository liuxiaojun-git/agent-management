import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { proxyApiPlugin } from './server/proxyApi.mjs'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // load env variables prefixed with VITE_ for the current mode
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_APP_BASE || '/'

  return {
    base,
    plugins: [react(), tailwindcss(), ...(command === 'serve' ? [proxyApiPlugin()] : [])],
    server: {
      host: '0.0.0.0',
      port: 8081,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        '/api/data': {
          target: env.VITE_BACKEND_URL || 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
        '/api/knowledge': {
          target: env.VITE_BACKEND_URL || 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
        // vite 的 proxy 是**前缀匹配的白名单**：没有列在这里的 /api/* 路径不会报错，
        // 而是落到 SPA fallback —— 返回 **200 + index.html**。前端拿到 200 后
        // 尝试解析 HTML 当 JSON，失败又被 apiRequest 吞成 { success:false }，
        // 表现为"页面静默停在旧数据"，而不是一个能看出原因的错误。
        // 批次 F 要把 VITE_API_URL 指到 /api/v1，所以这条必须先补上，
        // 否则本地怎么测都是"看起来成功"的假信号。
        // 不加 rewrite：路径 `/api/v1/...` 原样转发（与上面两条一致）。
        '/api/v1': {
          target: env.VITE_BACKEND_URL || 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
      },
      watch: {
        ignored: ['**/data/**'],
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 8081,
      strictPort: true,
    },
  }
})
