# Build stage
FROM node:20-alpine AS builder
WORKDIR /app

# 1. 设置淘宝 npm 镜像源
RUN npm config set registry https://registry.npmmirror.com

# 2. 复制依赖清单文件和 Vite 的入口文件
COPY package*.json index.html ./

# 3. 安装依赖
RUN npm install

# 4. 复制业务代码、配置文件以及 server 目录
COPY tsconfig*.json vite.config.ts .env.production ./
COPY public ./public
COPY src ./src
COPY server ./server

# 5. 执行构建
RUN npm run build

# Production stage
FROM nginx:stable-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
