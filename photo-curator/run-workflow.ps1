param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Data,
  [ValidateRange(0, 1000000)][int]$ScanLimit = 100,
  [ValidateRange(1, 500)][int]$Batch = 25,
  [ValidateRange(0, 100)][double]$MinimumScore = 80,
  [ValidateRange(0, 1000000)][int]$Top = 100,
  [ValidateRange(1, 100)][int]$Years = 5,
  [string]$Model = 'gemma3:4b',
  [ValidateRange(1024, 65535)][int]$Port = 4317
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
  throw "PHOTO_CURATOR_SOURCE is not an accessible directory: $Source"
}

New-Item -ItemType Directory -Path $Data -Force | Out-Null
$ollama = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 10
if ($Model -notin @($ollama.models.name)) {
  throw "Ollama model '$Model' is not installed on this runner."
}

$serverArguments = @(
  'server.js',
  '--source', ('"{0}"' -f $Source),
  '--data', ('"{0}"' -f $Data),
  '--model', $Model,
  '--years', $Years,
  '--port', $Port
)
$stdout = Join-Path $Data 'workflow-curator.stdout.log'
$stderr = Join-Path $Data 'workflow-curator.stderr.log'
$server = Start-Process -FilePath 'node.exe' -ArgumentList $serverArguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

try {
  $baseUrl = "http://127.0.0.1:$Port"
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
      $status = Invoke-RestMethod -Uri "$baseUrl/api/status" -TimeoutSec 2
      if ($status.source -ne (Resolve-Path -LiteralPath $Source).Path) {
        throw "Curator started with an unexpected source: $($status.source)"
      }
      $ready = $true
      break
    } catch {
      if ($server.HasExited) {
        throw "Photo curator stopped during startup. See $stderr"
      }
      Start-Sleep -Seconds 1
    }
  }
  if (-not $ready) { throw "Photo curator did not become ready. See $stderr" }

  $output = Join-Path $Data 'best-selection.json'
  $selectionArguments = @(
    'run', 'select-best', '--',
    '--url', $baseUrl,
    '--scan-limit', $ScanLimit,
    '--batch', $Batch,
    '--minimum-score', $MinimumScore,
    '--top', $Top,
    '--output', $output
  )
  & npm.cmd @selectionArguments
  if ($LASTEXITCODE -ne 0) { throw "Photo selection exited with code $LASTEXITCODE" }

  $result = Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
  Write-Output "Reviewed $($result.totalReviewed) items; selected $($result.selected)."
  if ($env:GITHUB_STEP_SUMMARY) {
    @(
      '## Photo curation complete',
      '',
      "- Reviewed: $($result.totalReviewed)",
      "- Selected: $($result.selected)",
      "- Minimum score: $($result.minimumScore)",
      "- Scan limit: $ScanLimit (0 means the full library)"
    ) | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
  }
} finally {
  if (-not $server.HasExited) { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
}
