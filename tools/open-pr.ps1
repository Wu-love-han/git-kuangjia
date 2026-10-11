# Push the current branch and open a Pull Request.
#
# main is protected (repository ruleset): direct pushes are rejected, so this
# script is the normal way in. It pushes the branch, then creates the PR through
# the GitHub API and prints the link.
#
# Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File tools\open-pr.ps1
#   powershell -ExecutionPolicy Bypass -File tools\open-pr.ps1 -Base main -Title "feat: xxx"
#
# Credentials: reuses the GitHub credential git already stored (Windows
# Credential Manager entry git:https://github.com). If you have never pushed
# from this machine, run `git push` once and sign in first.
#
# ASCII only on purpose: Windows PowerShell 5.1 reads an unsigned UTF-8 script as
# ANSI, which mangles non-ASCII text and breaks string parsing. Chinese docs live
# in CONTRIBUTING.md instead.

param(
  [string]$Base = 'main',
  [string]$Title = '',
  [string]$Body = '',
  [switch]$Draft
)
$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 defaults to TLS 1.0/1.1; GitHub's API requires TLS 1.2+,
# otherwise Invoke-RestMethod fails with "The underlying connection was closed".
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.ServicePointManager]::SecurityProtocol
} catch {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}
# Also honour an explicit proxy if git is configured with one.
$proxyUrl = (& git config --get http.proxy 2>$null)
if (-not [string]::IsNullOrWhiteSpace($proxyUrl)) {
  Write-Host ('proxy  : ' + $proxyUrl)
  $global:__openPrProxy = New-Object System.Net.WebProxy($proxyUrl.Trim())
}

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
  if ($branch -eq $Base) {
    throw ("refusing to run on '$Base' itself - create a branch first: git checkout -b feat/your-change")
  }
  Write-Host ("branch : " + $branch)
  Write-Host ("base   : " + $Base)

  # 1) Safety gate: never let private graph data or junk reach the public repo.
  $staged = & git diff --cached --name-only
  $risky = $staged | Where-Object { $_ -match '^graphs/.*\.json$' -or $_ -match '\.(bak|tmp|log|orig-bak)$' }
  if ($risky) {
    Write-Host ''
    Write-Host 'Sensitive files are staged and must not be published:'
    $risky | ForEach-Object { Write-Host ('  ' + $_) }
    Write-Host ''
    Write-Host 'Fix with: git restore --staged <file>'
    throw 'aborted: staged private data'
  }
  Write-Host 'staged : no private data / junk (ok)'

  # 2) Remind about uncommitted work (this script pushes only commits).
  $dirty = & git status --porcelain
  if ($dirty) { Write-Host 'note   : uncommitted changes exist and will NOT be pushed' }

  # 3) Push the branch.
  Write-Host ''
  Write-Host 'pushing branch ...'
  & git push -u origin $branch
  if ($LASTEXITCODE -ne 0) { throw 'push failed' }

  # 4) Read the stored credential (never printed).
  $cred = ("protocol=https`nhost=github.com`n`n" | & git credential fill 2>$null)
  $token = ($cred | Select-String -Pattern '^password=') -replace '^password=',''
  if ([string]::IsNullOrWhiteSpace($token)) {
    throw 'no GitHub credential found - run a normal git push once to sign in'
  }

  # 5) Derive owner/repo from the remote.
  $remoteUrl = (& git remote get-url origin).Trim()
  $match = [regex]::Match($remoteUrl, 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+)')
  if (-not $match.Success) { throw ('cannot parse remote url: ' + $remoteUrl) }
  $owner = $match.Groups['owner'].Value
  $repo = $match.Groups['repo'].Value
  Write-Host ("repo   : " + $owner + '/' + $repo)

  if ($Title -eq '') { $Title = (& git log -1 --pretty=%s).Trim() }
  if ($Body -eq '') {
    $Body = (& git log -1 --pretty=%b).Trim()
    if ($Body -eq '') { $Body = 'See the commit message.' }
  }

  # 6) Reuse an existing open PR for this branch instead of opening a duplicate.
  $headers = @{
    'User-Agent'    = 'open-pr'
    'Authorization' = 'token ' + $token
    'Accept'        = 'application/vnd.github+json'
  }
  $listUrl = 'https://api.github.com/repos/' + $owner + '/' + $repo + '/pulls?state=open&head=' + $owner + ':' + $branch
  $existing = Invoke-RestMethod -Uri $listUrl -Headers $headers -TimeoutSec 30
  if ($existing.Count -gt 0) {
    Write-Host ''
    Write-Host ('open PR already exists: ' + $existing[0].html_url)
    return
  }

  Write-Host 'creating pull request ...'
  $payload = @{
    title = $Title
    head  = $branch
    base  = $Base
    body  = $Body
    draft = [bool]$Draft
  } | ConvertTo-Json
  $pr = Invoke-RestMethod -Method Post -Uri ('https://api.github.com/repos/' + $owner + '/' + $repo + '/pulls') -Headers $headers -Body $payload -ContentType 'application/json; charset=utf-8' -TimeoutSec 30

  Write-Host ''
  Write-Host '=== PR created ==='
  Write-Host ('  #' + $pr.number + '  ' + $pr.title)
  Write-Host ('  ' + $pr.html_url)
  Write-Host ''
  Write-Host 'Open the link and click Merge. main is protected, so this is the only way in.'
} finally {
  Pop-Location
}
