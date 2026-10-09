# Move the graph-framework tool into D:\AI驱动盘\Deepseek\git kuangjia and repoint
# the desktop shortcut there.
#
# That folder is part of the Node installation tree and grants only
# ReadAndExecute to normal users, so this script MUST run elevated:
#   right-click PowerShell -> "Run as administrator" ->
#   powershell -ExecutionPolicy Bypass -File "<path>\tools\relocate-to-deepseek.ps1"
#
# ASCII-only on purpose (PS 5.1 reads unsigned UTF-8 as ANSI); the Chinese path is
# assembled from code points.
param(
  [string]$Target = ''
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$displayName = [string][char]0x56FE + [string][char]0x8C31 + [string][char]0x6846 + [string][char]0x67B6
$linkPath = Join-Path $desktop ($displayName + '.lnk')

if ($Target -eq '') {
  # D:\AI<U+9A71><U+52A8><U+76D8>\Deepseek\git kuangjia
  $Target = 'D:\AI' + [string][char]0x9A71 + [string][char]0x52A8 + [string][char]0x76D8 + '\Deepseek\git kuangjia'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host "source : $root"
Write-Host "target : $Target"
Write-Host ('elevated: ' + $elevated)
Write-Host ''

if (-not $elevated) {
  Write-Host 'Not elevated. The target folder is read-only for normal users.'
  Write-Host 'Run this instead (an Administrator PowerShell):'
  Write-Host ''
  Write-Host ('  icacls "' + $Target + '" /grant "' + $identity.Name + ':(OI)(CI)M"')
  Write-Host ('  robocopy "' + $root + '" "' + $Target + '" /E /NFL /NDL /NJH /NJS /XF *.tmp')
  Write-Host ('  powershell -ExecutionPolicy Bypass -File "' + (Join-Path $Target 'tools\install.ps1') + '"')
  Write-Host ''
  Write-Host 'Or simply re-run this script from an elevated PowerShell and it does all three.'
  exit 1
}

if (-not (Test-Path -LiteralPath $Target)) {
  New-Item -ItemType Directory -Force -Path $Target | Out-Null
}

Write-Host '1/3 granting write permission on the target folder ...'
& icacls $Target /grant ($identity.Name + ':(OI)(CI)M') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'icacls failed' }

Write-Host '2/3 copying the tool tree ...'
& robocopy $root $Target /E /NFL /NDL /NJH /NJS /XF *.tmp | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
$LASTEXITCODE = 0

Write-Host '3/3 repointing the desktop shortcut ...'
$moved = Join-Path $Target 'tools\install.ps1'
if (Test-Path -LiteralPath $moved) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $moved
} else {
  Write-Host 'warning: copied install.ps1 not found, shortcut left as is'
}

Write-Host ''
Write-Host 'done. Graphs now live in:'
Write-Host ('  ' + (Join-Path $Target 'graphs'))
Write-Host 'The old copy can be deleted once the shortcut works.'
