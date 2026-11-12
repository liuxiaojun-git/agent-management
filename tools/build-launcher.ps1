<#
  Rebuild the root launcher executable from StartFrontendBackend.cs.
  Run this script after changing the launcher source.
  Use .NET Framework's built-in csc.exe; no .NET SDK is required.
  Compiler options use a - prefix because MSYS/Git Bash may rewrite / prefixes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$toolsDirectory = $PSScriptRoot
$projectDirectory = Split-Path $toolsDirectory -Parent
$sourceFile = Join-Path $toolsDirectory 'StartFrontendBackend.cs'
$launcherName = [string]::Concat([char]0x542F, [char]0x52A8, [char]0x524D, [char]0x540E, [char]0x7AEF, '.exe')
$outputFile = Join-Path $projectDirectory $launcherName
$temporaryFile = Join-Path $projectDirectory ([string]::Concat([char]0x542F, [char]0x52A8, [char]0x524D, [char]0x540E, [char]0x7AEF, '.new.exe'))

$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $compiler)) {
  $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $compiler)) {
  throw 'The .NET Framework csc.exe compiler was not found.'
}

Write-Host "Compiling $outputFile" -ForegroundColor Cyan
try {
  & $compiler -nologo -target:exe -codepage:65001 -utf8output "-out:$temporaryFile" $sourceFile
  if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
  Move-Item -LiteralPath $temporaryFile -Destination $outputFile -Force
}
finally {
  if (Test-Path $temporaryFile) { Remove-Item -LiteralPath $temporaryFile }
}

Write-Host 'Compilation complete.' -ForegroundColor Green
