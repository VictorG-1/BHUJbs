Add-Type -AssemblyName System.Drawing
$src = 'C:\Users\DELL\.cursor\projects\c-Users-DELL-Documents-New-project\assets\image-6018b119-f440-48e2-95ce-7321313406a4.jpg'
$outDir = 'C:\Users\DELL\Documents\New project\scripts\_allot-img-crops'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$img = [System.Drawing.Image]::FromFile($src)
Write-Output ("size=" + $img.Width + "x" + $img.Height)
$parts = 8
$partH = [Math]::Ceiling($img.Height / $parts)
for ($i = 0; $i -lt $parts; $i++) {
  $y = $i * $partH
  $h = [Math]::Min($partH, $img.Height - $y)
  $rect = New-Object System.Drawing.Rectangle 0, $y, $img.Width, $h
  $bmp = $img.Clone($rect, $img.PixelFormat)
  $path = Join-Path $outDir ("part-" + $i + ".jpg")
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $bmp.Dispose()
  Write-Output ("wrote " + $path)
}
$img.Dispose()
