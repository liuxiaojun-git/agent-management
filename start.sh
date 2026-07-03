#!/usr/bin/env bash

set -e

# 构建前端
npm install
npm run build

# 启动生产服务器
node server/app.mjs
