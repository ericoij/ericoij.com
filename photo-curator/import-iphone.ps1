param(
  [string]$Destination = "$env:USERPROFILE\Pictures\iPhone-Curator-Staging"
)

$ErrorActionPreference = 'Stop'
$imageTypes = 'HEIC|HEIF|JPEG|JPG|PNG|WEBP|TIFF|TIF'
$statePath = Join-Path $Destination '.imported-folders.txt'
$logPath = Join-Path $Destination 'import.log'
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$completed = if (Test-Path -LiteralPath $statePath) { @(Get-Content -LiteralPath $statePath) } else { @() }

function Log([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $logPath -Value $line
  Write-Output $line
}

$shell = New-Object -ComObject Shell.Application
$phone = $shell.Namespace(17).Items() | Where-Object Name -eq 'Apple iPhone' | Select-Object -First 1
if (-not $phone) { throw 'Apple iPhone not found. Reconnect and unlock it.' }
$storage = @($phone.GetFolder.Items()) | Where-Object Name -eq 'Internal Storage' | Select-Object -First 1
if (-not $storage) { throw 'Internal Storage unavailable. Unlock the iPhone and tap Trust or Allow.' }
$folders = @($storage.GetFolder.Items()) | Where-Object IsFolder | Sort-Object Name

foreach ($folder in $folders) {
  if ($completed -contains $folder.Name) { continue }
  Log "Reading $($folder.Name)"
  $targetFolder = Join-Path $Destination $folder.Name
  New-Item -ItemType Directory -Path $targetFolder -Force | Out-Null
  $targetShell = $shell.Namespace($targetFolder)
  $images = @($folder.GetFolder.Items()) | Where-Object {
    -not $_.IsFolder -and ($_.Type -match $imageTypes -or $_.Name -match '\.(heic|heif|jpe?g|png|webp|tiff?)$')
  }
  foreach ($image in $images) {
    $existing = Get-ChildItem -LiteralPath $targetFolder -File -ErrorAction SilentlyContinue | Where-Object BaseName -eq $image.Name | Select-Object -First 1
    if ($existing) { continue }
    $targetShell.CopyHere($image, 20)
    $deadline = (Get-Date).AddMinutes(5)
    do {
      Start-Sleep -Milliseconds 500
      $copied = Get-ChildItem -LiteralPath $targetFolder -File -ErrorAction SilentlyContinue | Where-Object BaseName -eq $image.Name | Select-Object -First 1
    } while (-not $copied -and (Get-Date) -lt $deadline)
    if (-not $copied) { throw "Timed out copying $($image.Name)" }
  }
  Add-Content -LiteralPath $statePath -Value $folder.Name
  Log "Completed $($folder.Name): $($images.Count) images"
}

Log 'iPhone image import complete'
