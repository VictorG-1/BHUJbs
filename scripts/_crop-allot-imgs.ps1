Add-Type -AssemblyName System.Drawing
$assets = 'C:\Users\DELL\.cursor\projects\c-Users-DELL-Documents-New-project\assets'
$outRoot = 'C:\Users\DELL\Documents\New project\scripts\_allot-img-crops2'
New-Item -ItemType Directory -Force -Path $outRoot | Out-Null

$files = @(
  'image-6dbec39a-458b-483e-92bc-953d246e9b84.jpg',
  'image-8ec2a68c-4725-442e-880c-5fe715abe02d.jpg'
)

foreach ($f in $files) {
  $src = Join-Path $assets $f
  $dir = Join-Path $outRoot ($f -replace '\.jpg$','')
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $img = [System.Drawing.Image]::FromFile($src)
  Write-Output ("FILE " + $f + " " + $img.Width + "x" + $img.Height)

  # Upscale narrow strips for readability
  $scale = if ($img.Width -lt 400) { [Math]::Max(4, [Math]::Ceiling(800.0 / $img.Width)) } else { 2 }
  $w = $img.Width * $scale
  $h = $img.Height * $scale
  $big = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($big)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.DrawImage($img, 0, 0, $w, $h)
  $g.Dispose()

  $parts = 10
  $partH = [Math]::Ceiling($big.Height / $parts)
  for ($i = 0; $i -lt $parts; $i++) {
    $y = $i * $partH
    $hh = [Math]::Min($partH, $big.Height - $y)
    if ($hh -le 0) { break }
    $rect = New-Object System.Drawing.Rectangle 0, $y, $big.Width, $hh
    $bmp = $big.Clone($rect, $big.PixelFormat)
    $path = Join-Path $dir ("part-" + $i.ToString('00') + ".jpg")
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $bmp.Dispose()
  }
  $big.Dispose()
  $img.Dispose()
  Write-Output ("wrote " + $dir)
}
