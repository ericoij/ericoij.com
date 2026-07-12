param(
  [string]$ImportDirectory = "$env:USERPROFILE\Pictures\iPhone-Curator-Staging",
  [string]$CuratorUrl = 'http://127.0.0.1:4318',
  [int]$BatchSize = 25
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$logPath = Join-Path $projectDirectory 'data-iphone\pipeline.log'
New-Item -ItemType Directory -Path (Split-Path $logPath -Parent) -Force | Out-Null

function Log([string]$Message) {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $Message"
}

function Status {
  Invoke-RestMethod -Uri "$CuratorUrl/api/status" -TimeoutSec 10
}

function Wait-ForIdle {
  do {
    Start-Sleep -Seconds 3
    $status = Status
    Log "$($status.message) $($status.completed)/$($status.total)"
  } while ($status.task)
  if ($status.error) { throw $status.error }
}

try {
  Log 'Waiting for iPhone import to complete'
  $importLog = Join-Path $ImportDirectory 'import.log'
  while (-not (Select-String -LiteralPath $importLog -Pattern 'iPhone image import complete' -Quiet -ErrorAction SilentlyContinue)) {
    Start-Sleep -Seconds 5
  }

  Log 'Import complete; waiting for initial scan to become idle'
  Wait-ForIdle
  Log 'Starting final scan so late-arriving files are included'
  Invoke-RestMethod -Method Post -Uri "$CuratorUrl/api/scan" -ContentType 'application/json' -Body '{}' | Out-Null
  Wait-ForIdle

  while ($true) {
    $items = @(Invoke-RestMethod -Uri "$CuratorUrl/api/items" -TimeoutSec 30)
    $remaining = @($items | Where-Object { -not $_.duplicateOf -and -not $_.analysis }).Count
    if ($remaining -eq 0) { break }
    $batch = [Math]::Min($BatchSize, $remaining)
    Log "Starting local classification batch of $batch; $remaining remaining"
    Invoke-RestMethod -Method Post -Uri "$CuratorUrl/api/curate" -ContentType 'application/json' -Body (@{limit=$batch} | ConvertTo-Json -Compress) | Out-Null
    Wait-ForIdle
  }

  $envFile = Join-Path (Split-Path $projectDirectory -Parent) '.env.local'
  $tokenLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^BLOB_READ_WRITE_TOKEN=' } | Select-Object -First 1
  if (-not $tokenLine) { throw 'BLOB_READ_WRITE_TOKEN was not found in the root .env.local file' }
  $env:BLOB_READ_WRITE_TOKEN = ($tokenLine -replace '^BLOB_READ_WRITE_TOKEN=', '').Trim().Trim('"').Trim("'")
  Log 'Classification complete; uploading safe painting matches to private Vercel Blob'
  Push-Location $projectDirectory
  try { & node upload-paintings.js "--url=$CuratorUrl" *>> $logPath; if ($LASTEXITCODE -ne 0) { throw "Uploader exited $LASTEXITCODE" } }
  finally { Pop-Location }
  Log 'PIPELINE COMPLETE'
} catch {
  Log "PIPELINE ERROR: $($_.Exception.Message)"
  throw
}
