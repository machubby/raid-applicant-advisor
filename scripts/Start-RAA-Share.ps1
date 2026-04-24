param(
  [int]$Port = 4177,
  [switch]$RestartServer,
  [switch]$SkipTunnel
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$EnvPath = Join-Path $Root ".env"
$ArtifactsDir = Join-Path $Root "artifacts"
$NodePath = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$ServerUrl = "http://127.0.0.1:$Port"

function Get-DotEnvValue {
  param([string]$Name)
  if (-not (Test-Path -LiteralPath $EnvPath)) {
    return ""
  }

  foreach ($Line in Get-Content -LiteralPath $EnvPath) {
    if ($Line -match "^\s*$([regex]::Escape($Name))\s*=(.*)$") {
      $Value = $Matches[1].Trim()
      if (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or ($Value.StartsWith("'") -and $Value.EndsWith("'"))) {
        $Value = $Value.Substring(1, $Value.Length - 2)
      }
      return $Value
    }
  }

  return ""
}

function Test-RaaServer {
  try {
    if ($script:Token) {
      $Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
      $EncodedToken = [uri]::EscapeDataString($script:Token)
      Invoke-WebRequest -UseBasicParsing "$ServerUrl/r/$EncodedToken/" -WebSession $Session -TimeoutSec 2 | Out-Null
      $Response = Invoke-WebRequest -UseBasicParsing "$ServerUrl/api/health" -WebSession $Session -TimeoutSec 2
    } else {
      $Response = Invoke-WebRequest -UseBasicParsing "$ServerUrl/api/health" -TimeoutSec 2
    }
    return $Response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-ShareUrlReady {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$Attempts = 45,
    [int]$DelayMilliseconds = 1000
  )

  for ($Attempt = 0; $Attempt -lt $Attempts; $Attempt += 1) {
    try {
      $Response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
      if ($Response.StatusCode -ge 200 -and $Response.StatusCode -lt 400) {
        return $true
      }
    } catch {
      $StatusCode = $null
      if ($_.Exception.Response) {
        $StatusCode = [int]$_.Exception.Response.StatusCode
      }
      if ($StatusCode -ge 200 -and $StatusCode -lt 400) {
        return $true
      }
    }

    Start-Sleep -Milliseconds $DelayMilliseconds
  }

  return $false
}

function Stop-RaaServer {
  Get-CimInstance Win32_Process |
    Where-Object { $_.Name -match "node" -and $_.CommandLine -match "server\.js" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

function Start-RaaServer {
  if (-not (Test-Path -LiteralPath $NodePath)) {
    $NodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $NodeCommand) {
      throw "Node.js was not found. Start the app from Codex once, or install Node.js."
    }
    $script:NodePath = $NodeCommand.Source
  }

  New-Item -ItemType Directory -Force -Path $ArtifactsDir | Out-Null
  Remove-Item -LiteralPath (Join-Path $ArtifactsDir "server-share.log") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $ArtifactsDir "server-share.err.log") -Force -ErrorAction SilentlyContinue
  Start-Process `
    -FilePath $NodePath `
    -ArgumentList "server.js" `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $ArtifactsDir "server-share.log") `
    -RedirectStandardError (Join-Path $ArtifactsDir "server-share.err.log") |
    Out-Null

  for ($Attempt = 0; $Attempt -lt 20; $Attempt += 1) {
    if (Test-RaaServer) {
      return
    }
    Start-Sleep -Milliseconds 500
  }

  throw "RAA server did not start at $ServerUrl. Check artifacts\server-share.err.log."
}

$Token = Get-DotEnvValue "RAA_SHARE_TOKEN"
$CreatedToken = $false
if (-not $Token) {
  $Token = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
  if (-not (Test-Path -LiteralPath $EnvPath)) {
    New-Item -ItemType File -Path $EnvPath | Out-Null
  }
  Add-Content -LiteralPath $EnvPath -Value "RAA_SHARE_TOKEN=$Token"
  $CreatedToken = $true
  Write-Host "Created RAA_SHARE_TOKEN in .env"
}

if ($CreatedToken -or $RestartServer -or -not (Test-RaaServer)) {
  if ($RestartServer -or $CreatedToken) {
    Stop-RaaServer
    Start-Sleep -Milliseconds 400
  }
  Write-Host "Starting Raid Applicant Advisor at $ServerUrl"
  Start-RaaServer
} else {
  Write-Host "Raid Applicant Advisor is already running at $ServerUrl"
}

$EncodedToken = [uri]::EscapeDataString($Token)
$LocalShareLink = "$ServerUrl/r/$EncodedToken/"
Write-Host ""
Write-Host "Local browser link:" -ForegroundColor Green
Write-Host $LocalShareLink -ForegroundColor Green

if ($SkipTunnel) {
  Write-Host "SkipTunnel was set; not starting Cloudflare Quick Tunnel."
  exit 0
}

$Cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $Cloudflared) {
  Write-Host ""
  Write-Host "cloudflared is not installed or is not on PATH." -ForegroundColor Yellow
  Write-Host "Install it, open a new PowerShell window, then run this script again:"
  Write-Host "  winget install --id Cloudflare.cloudflared" -ForegroundColor Cyan
  exit 1
}

Write-Host ""
Write-Host "Starting Cloudflare Quick Tunnel. Keep this window open." -ForegroundColor Cyan
Write-Host "Waiting for trycloudflare.com URL..."
Write-Host ""

$PrintedShareLink = $false
$CloudflaredCommand = '"' + $Cloudflared.Source + '" tunnel --url ' + $ServerUrl + ' 2>&1'
& cmd.exe /d /s /c $CloudflaredCommand | ForEach-Object {
  $Line = $_.ToString()
  Write-Host $Line

  if (-not $PrintedShareLink -and $Line -match "https://[A-Za-z0-9.-]+\.trycloudflare\.com") {
    $PublicUrl = $Matches[0].TrimEnd("/")
    $ShareLink = "$PublicUrl/r/$EncodedToken/"
    Write-Host ""
    Write-Host "Tunnel URL detected. Waiting for the public share link to respond (this can take ~30-45 seconds)..." -ForegroundColor Cyan
    if (Test-ShareUrlReady -Url $ShareLink) {
      $PrintedShareLink = $true
      Write-Host "Send this link to your buddy:" -ForegroundColor Green
      Write-Host $ShareLink -ForegroundColor Green
      try {
        Set-Clipboard -Value $ShareLink
        Write-Host "Copied the share link to your clipboard." -ForegroundColor Green
      } catch {
        Write-Host "Could not copy to clipboard; copy the link above manually." -ForegroundColor Yellow
      }
    } else {
      Write-Host "Cloudflare announced a tunnel URL, but it never became reachable from this PC." -ForegroundColor Yellow
      Write-Host "Keep this window open and try again in a few seconds, or rerun the script for a fresh tunnel." -ForegroundColor Yellow
      Write-Host "Last announced URL:" -ForegroundColor Yellow
      Write-Host $ShareLink -ForegroundColor Yellow
    }
    Write-Host ""
  }
}
