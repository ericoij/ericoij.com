param(
  [string]$Destination = "$env:USERPROFILE\Pictures\iPhone-Curator-Staging"
)

$ErrorActionPreference = 'Stop'
$mediaTypes = 'HEIC|HEIF|JPEG|JPG|PNG|WEBP|TIFF|TIF|AVIF|MOV|MP4|M4V|AVI'
$logPath = Join-Path $Destination 'import.log'
New-Item -ItemType Directory -Path $Destination -Force | Out-Null

$script:copied = 0
$script:skipped = 0
$script:visited = 0

function Log([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $logPath -Value $line
  Write-Output $line
}

function Media-Exists([string]$Directory, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Directory)) { return $false }
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($Name)
  return [bool](Get-ChildItem -LiteralPath $Directory -File -ErrorAction SilentlyContinue |
    Where-Object BaseName -eq $baseName |
    Select-Object -First 1)
}

$shell = New-Object -ComObject Shell.Application
$phone = $shell.Namespace(17).Items() | Where-Object Name -eq 'Apple iPhone' | Select-Object -First 1
if (-not $phone) { throw 'Apple iPhone not found. Reconnect and unlock it.' }
$storage = @($phone.GetFolder.Items()) | Where-Object Name -eq 'Internal Storage' | Select-Object -First 1
if (-not $storage) { throw 'Internal Storage unavailable. Unlock the iPhone and tap Trust or Allow.' }

function Import-Folder([object]$Folder, [string]$RelativePath = '') {
  $items = @($Folder.Items()) | Sort-Object Name
  foreach ($item in $items) {
    if ($item.IsFolder) {
      $childRelative = if ($RelativePath) { Join-Path $RelativePath $item.Name } else { $item.Name }
      Log "Reading $childRelative"
      Import-Folder -Folder $item.GetFolder -RelativePath $childRelative
      continue
    }

    $script:visited++
    if ($item.Type -notmatch $mediaTypes -and $item.Name -notmatch '\.(heic|heif|jpe?g|png|webp|tiff?|avif|mov|mp4|m4v|avi)$') {
      continue
    }

    $targetFolder = if ($RelativePath) { Join-Path $Destination $RelativePath } else { $Destination }
    New-Item -ItemType Directory -Path $targetFolder -Force | Out-Null

    if (Media-Exists -Directory $targetFolder -Name $item.Name) {
      $script:skipped++
      continue
    }

    $targetShell = $shell.Namespace($targetFolder)
    $targetShell.CopyHere($item, 20)
    $deadline = (Get-Date).AddMinutes(5)
    do {
      Start-Sleep -Milliseconds 500
      $copied = Media-Exists -Directory $targetFolder -Name $item.Name
    } while (-not $copied -and (Get-Date) -lt $deadline)

    if (-not $copied) { throw "Timed out copying $($item.Name) from $RelativePath" }
    $script:copied++
    if (($script:copied % 25) -eq 0) {
      Log "Copied $script:copied media files ($script:skipped already present)"
    }
  }
}

Log "Starting recursive iPhone media import to $Destination"
Import-Folder -Folder $storage.GetFolder
Log "iPhone media import complete: copied $script:copied, skipped $script:skipped, inspected $script:visited files"
