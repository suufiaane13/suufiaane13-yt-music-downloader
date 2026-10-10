Add-Type -AssemblyName System.Drawing

function New-BrandBmp([int]$w, [int]$h, [string]$path, [bool]$vertical) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.Clear([System.Drawing.Color]::FromArgb(255, 11, 12, 14))

  $c1 = [System.Drawing.Color]::FromArgb(255, 255, 59, 92)
  $c2 = [System.Drawing.Color]::FromArgb(255, 180, 30, 70)
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 240, 240, 245))
  $muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(180, 180, 185, 195))
  $font = New-Object System.Drawing.Font "Segoe UI", 11, ([System.Drawing.FontStyle]::Bold)
  $fontSm = New-Object System.Drawing.Font "Segoe UI", 8

  if ($vertical) {
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
      [System.Drawing.Point]::new(0, 0),
      [System.Drawing.Point]::new($w, 0),
      $c1,
      $c2
    )
    $g.FillRectangle($brush, 0, 0, 8, $h)
    $brush.Dispose()
    $glow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 255, 59, 92))
    $g.FillEllipse($glow, -40, [int]($h / 2 - 80), 160, 160)
    $glow.Dispose()
    $g.DrawString("YT Music", $font, $white, 18, 40)
    $g.DrawString("Downloader", $fontSm, $muted, 18, 62)
    $g.DrawString("YouTube to MP3 / MP4", $fontSm, $muted, 18, ($h - 48))
  }
  else {
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
      [System.Drawing.Point]::new(0, 0),
      [System.Drawing.Point]::new($w, 0),
      $c1,
      $c2
    )
    $g.FillRectangle($brush, 0, ($h - 4), $w, 4)
    $brush.Dispose()
    $g.DrawString("YT Music Downloader", $font, $white, 10, 16)
  }

  $font.Dispose()
  $fontSm.Dispose()
  $white.Dispose()
  $muted.Dispose()
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bmp.Dispose()
  Write-Host "Wrote $path"
}

$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root "nsis-img"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
New-BrandBmp 150 57 (Join-Path $dir "header-tauri.bmp") $false
New-BrandBmp 164 314 (Join-Path $dir "sidebar-tauri.bmp") $true
