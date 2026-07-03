import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// @ts-expect-error .mjs file has no type declarations
import { dataApiPlugin } from './server/api.mjs'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // load env variables prefixed with VITE_ for the current mode
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_APP_BASE || '/'

  return {
    base,
    plugins: [react(), tailwindcss(), ...(command === 'serve' ? [dataApiPlugin()] : [])],
    server: {
      host: '0.0.0.0',
      port: Number(env.VITE_DEV_PORT) || 5173,
      allowedHosts: true,
      watch: {
        ignored: ['**/data/**'],
      },
    },
    preview: {
      host: '0.0.0.0',
      port: Number(env.VITE_PREVIEW_PORT) || 5173,
    },
  }
})
