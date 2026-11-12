<#
  本地一键启动前端（Vite）和后端（Express）。

  用法：
    .\start-dev.ps1
    .\start-dev.ps1 -Install
#>
[CmdletBinding()]
param(
  [switch]$Install
)

$ErrorActionPreference = 'Stop'
$frontendDirectory = $PSScriptRoot
$backendDirectory = Join-Path (Split-Path $frontendDirectory -Parent) 'zhiyu-backend'

function Assert-Project([string]$directory, [string]$name) {
  if (-not (Test-Path (Join-Path $directory 'package.json'))) {
    throw "$name项目不存在或缺少 package.json：$directory"
  }
}

function Install-DependenciesIfNeeded([string]$directory, [string]$name) {
  if ($Install -or -not (Test-Path (Join-Path $directory 'node_modules'))) {
    Write-Host "安装$name依赖..." -ForegroundColor Yellow
    & npm.cmd install --prefix $directory
    if ($LASTEXITCODE -ne 0) { throw "$name依赖安装失败。" }
  }
}

Assert-Project $frontendDirectory '前端'
Assert-Project $backendDirectory '后端'
Install-DependenciesIfNeeded $frontendDirectory '前端'
Install-DependenciesIfNeeded $backendDirectory '后端'

Write-Host '启动后端：http://localhost:3000/api/health' -ForegroundColor Cyan
$backendProcess = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev' -WorkingDirectory $backendDirectory -PassThru -NoNewWindow

try {
  Write-Host '启动前端：http://localhost:8081' -ForegroundColor Cyan
  Write-Host '按 Ctrl+C 会同时停止前后端服务。' -ForegroundColor DarkGray
  & npm.cmd run dev --prefix $frontendDirectory
}
finally {
  if ($backendProcess -and -not $backendProcess.HasExited) {
    Write-Host '正在停止后端服务...' -ForegroundColor Yellow
    # npm.cmd 会派生 node --watch；/T 确保一并终止整个后端进程树。
    & taskkill.exe /PID $backendProcess.Id /T /F 2>$null | Out-Null
  }
}
