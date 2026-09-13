# Blow a composed sprite strip up into halves, so seams and halving artifacts can
# be eyeballed instead of argued about. Works on whatever is in art\out: the
# strips there are the ones that were sliced into sprite-data.ts.
#
#   pwsh -File art\tools\scan-strips.ps1
#
# Writes art\out\scan\*.png, which is disposable — delete the folder whenever.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$d='D:\ALAN\Codes\dsh-pets\art\out'
$o=Join-Path $d 'scan'
New-Item -ItemType Directory -Force -Path $o | Out-Null
function Save-Zoom {
  param([string]$Src,[string]$Out,[int]$X,[int]$Y,[int]$CW,[int]$CH,[int]$Zoom)
  if (-not (Test-Path $Src)) { Write-Output "skip (no such strip): $Src"; return }
  $img=[System.Drawing.Image]::FromFile($Src)
  $cut=New-Object System.Drawing.Bitmap -ArgumentList @($CW,$CH)
  $gr=[System.Drawing.Graphics]::FromImage($cut)
  $gr.Clear([System.Drawing.Color]::White)
  $rect=New-Object System.Drawing.Rectangle -ArgumentList @($X,$Y,$CW,$CH)
  $gr.DrawImage($img,0,0,$rect,[System.Drawing.GraphicsUnit]::Pixel)
  $gr.Dispose(); $img.Dispose()
  $OW=[int]$CW*[int]$Zoom; $OH=[int]$CH*[int]$Zoom
  $big=New-Object System.Drawing.Bitmap -ArgumentList @($OW,$OH)
  $gr2=[System.Drawing.Graphics]::FromImage($big)
  $gr2.Clear([System.Drawing.Color]::White)
  $gr2.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gr2.DrawImage($cut,0,0,$OW,$OH); $gr2.Dispose(); $cut.Dispose()
  $big.Save($Out,[System.Drawing.Imaging.ImageFormat]::Png); $big.Dispose()
  Write-Output "wrote $Out"
}
# Current sheets: whale-girl 2160x180 (12x180), silver-moon 2160x180, robot 1440x162 (8x180).
Save-Zoom -Src "$d\whalegirl-strip.png"     -Out "$o\whale-a.png"  -X 0    -Y 0 -CW 1080 -CH 180 -Zoom 1
Save-Zoom -Src "$d\whalegirl-strip.png"     -Out "$o\whale-b.png"  -X 1080 -Y 0 -CW 1080 -CH 180 -Zoom 1
Save-Zoom -Src "$d\strip_silver-moon.png"   -Out "$o\silver-a.png" -X 0    -Y 0 -CW 1080 -CH 180 -Zoom 1
Save-Zoom -Src "$d\strip_silver-moon.png"   -Out "$o\silver-b.png" -X 1080 -Y 0 -CW 1080 -CH 180 -Zoom 1
Save-Zoom -Src "$d\strip_robot.png"         -Out "$o\robot-a.png"  -X 0    -Y 0 -CW 720  -CH 162 -Zoom 2
Save-Zoom -Src "$d\strip_robot.png"         -Out "$o\robot-b.png"  -X 720  -Y 0 -CW 720  -CH 162 -Zoom 2
