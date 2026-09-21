<#
  由 StartFrontendBackend.cs 重新编译根目录的「启动前后端.exe」。

  修改启动逻辑后执行：
    powershell -ExecutionPolicy Bypass -File .\tools\build-launcher.ps1

  使用 .NET Framework 自带的 csc.exe（Windows 内置，无需安装 .NET SDK）。
  注意：编译参数必须用 - 前缀（如 -nologo），/ 前缀会被 MSYS/Git Bash 当作路径转换。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$toolsDirectory = $PSScriptRoot
$projectDirectory = Split-Path $toolsDirectory -Parent
$sourceFile = Join-Path $toolsDirectory 'StartFrontendBackend.cs'
$outputFile = Join-Path $projectDirectory '启动前后端.exe'

$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $compiler)) {
  $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $compiler)) {
  throw '未找到 .NET Framework 的 csc.exe，无法编译启动器。'
}

Write-Host "编译 $outputFile" -ForegroundColor Cyan
& $compiler -nologo -target:exe -codepage:65001 -utf8output "-out:$outputFile" $sourceFile
if ($LASTEXITCODE -ne 0) { throw '启动器编译失败。' }

Write-Host '编译完成。' -ForegroundColor Green
