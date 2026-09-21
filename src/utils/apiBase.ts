// 后端 base URL 的**单一事实源**（批次 F：统一收敛到 v1 根）。
//
// 迁移前全仓有三套互不相同的 base URL（`/api/data`、VITE_BACKEND_URL+'/api'、`//host:3000`），
// 分散在 6 个文件里。迁移后全部换成这里导出的 `V1_BASE` / `KNOWLEDGE_BASE`。
//
// **必须是绝对地址**：生产环境 nginx 没有 `/api/*` 转发（nginx.conf 显式删掉了），
// 相对路径 `/api/v1/...` 会落到 SPA fallback 返回 **200 + index.html** ——
// `response.ok` 为真、解析 JSON 失败又被吞成 `{ success:false }`，表现为"页面静默停在旧数据"。
// dev 下绝对地址直连 3000 同样可用（迁移前 chatService 就一直是这么连的），
// 并顺带消灭了「一部分请求走 Vite 代理、另一部分直连 3000」的两条通路差异。
//
// `VITE_API_BASE_URL` 是逃生舱：需要换后端地址时用它覆盖（不设则回落到当前主机的 3000 端口）。

export const SERVER_BASE = import.meta.env.VITE_API_BASE_URL
  ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '')
  : `${window.location.protocol}//${window.location.hostname}:3000`

export const V1_BASE = `${SERVER_BASE}/api/v1`
export const KNOWLEDGE_BASE = `${SERVER_BASE}/api/v1/knowledge`
