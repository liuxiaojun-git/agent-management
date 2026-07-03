# agent-management
知航控制台

## 部署（DEV 环境）

以下说明演示如何将本项目构建并部署到 DEV 域名，例如 https://qingzhou-dev.heyshare.cn。

- 构建：

  ```bash
  npm install
  npm run build
  ```

- 环境变量：

  - 在仓库根目录创建或修改 `.env.production`，设置：
    - `VITE_APP_BASE`：应用的 base 路径（若部署到根域名保留 `/`）
    - `VITE_API_URL`：指向后端数据接口，例如 `https://qingzhou-dev.heyshare.cn/api/data`

  已添加示例：`.env.development`、`.env.production`

- 预览/本地测试：

  ```bash
  # 本地开发
  npm run dev

  # 本地预览构建产物（仅用于调试，不建议用于正式生产）
  npm run preview
  ```

- 推荐生产部署：

  1. Nginx 静态托管

     ```nginx
     server {
       listen 80;
       server_name qingzhou-dev.heyshare.cn;

       root /var/www/agent-management/dist;
       index index.html;

       location / {
         try_files $uri $uri/ /index.html;
       }

       location /api/ {
         proxy_pass https://backend-server.example.com/api/;
         proxy_set_header Host $host;
         proxy_set_header X-Real-IP $remote_addr;
         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
         proxy_set_header X-Forwarded-Proto $scheme;
       }
     }
     ```

  2. Docker 容器部署

     根目录已添加 `Dockerfile`。构建并运行：

     ```bash
     # 构建镜像
     docker build -t agent-management:latest .

     # 直接运行
     docker run -d --name agent-management -p 80:80 agent-management:latest
     ```

     注意：`Dockerfile` 已包含 `.env.production`，构建时会读取其中的 `VITE_API_URL`。

  3. Docker Compose

     根目录已添加 `docker-compose.yml`，可直接启动：

     ```bash
     docker compose up -d --build
     ```

- 注意点：
  - `VITE_API_URL` 应在构建前设定为 DEV 后端完整地址，前端会在运行时通过 `import.meta.env.VITE_API_URL` 读取。
  - 若托管为子路径（例如 `https://.../app/`），请将 `VITE_APP_BASE=/app/`。
  - 本仓库中的 `/api/data` 仅在 Vite 开发服务器下可用；生产环境请使用真实后端 API 或 Nginx 代理。

如果你同意，我可以：

- 把 `vite.config.ts` 调整为按 `mode` 读取 env（已完成）
- 补充示例 `.env.production`（已添加）
- 如果需要，我可以为后端提供 nginx + systemd 的部署示例或帮助生成 Dockerfile。

