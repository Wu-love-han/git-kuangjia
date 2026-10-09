# Install / refresh the graph-framework tool:
#   1. generate assets\graph.ico (unless it already exists and -SkipIcon is given)
#   2. create the desktop shortcut that launches start-graph.vbs
#   3. verify everything it needs is in place
#
# ASCII-only on purpose: PS 5.1 reads unsigned UTF-8 scripts as ANSI, so Chinese
# text is assembled from code points at runtime (never written as a literal).
param(
  [switch]$SkipIcon
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
# U+56FE U+8C31 U+6846 U+67B6 = graph / framework
$displayName = [string][char]0x56FE + [string][char]0x8C31 + [string][char]0x6846 + [string][char]0x67B6
$linkPath = Join-Path $desktop ($displayName + '.lnk')
$iconPath = Join-Path $root 'assets\graph.ico'
$vbsPath = Join-Path $root 'start-graph.vbs'
$serverPath = Join-Path $root 'app\server.mjs'
$pagePath = Join-Path $root 'app\index.html'

Write-Host "tool root : $root"
Write-Host "shortcut  : $linkPath"

foreach ($required in @($vbsPath, $serverPath, $pagePath)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "missing file: $required" }
}

# 1. icon
if ($SkipIcon -and (Test-Path -LiteralPath $iconPath)) {
  Write-Host 'icon: kept existing'
} else {
  & node (Join-Path $root 'tools\make-icon.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'icon generation failed' }
}

# 2. desktop shortcut (points at wscript so no console window flashes)
if (-not (Test-Path -LiteralPath $iconPath)) { throw 'assets\graph.ico was not produced' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$shortcut.Arguments = '"' + $vbsPath + '"'
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = $iconPath + ',0'
$shortcut.Description = 'Relationship / framework graph editor (local)'
$shortcut.Save()

# 3. verify
Write-Host ''
Write-Host '=== installed ==='
foreach ($file in @($pagePath, $serverPath, $vbsPath, $iconPath)) {
  $info = Get-Item -LiteralPath $file
  "{0,10}  {1}" -f $info.Length, $info.FullName
}
$check = $shell.CreateShortcut($linkPath)
Write-Host ''
Write-Host ('shortcut target : ' + $check.TargetPath)
Write-Host ('shortcut args   : ' + $check.Arguments)
Write-Host ('shortcut icon   : ' + $check.IconLocation)
Write-Host ('shortcut exists : ' + (Test-Path -LiteralPath $linkPath))
Write-Host ''
Write-Host 'Double-click the desktop shortcut to open the editor.'
Write-Host 'Overrides for 1-2 graphs per project: put extra .json files into graphs\ and pick them in the dropdown.'
