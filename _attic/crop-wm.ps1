$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$d='D:\ALAN\Codes\dsh-pets\_probe'
function Save-Zoom {
  param([string]$Src,[string]$Out,[int]$X,[int]$Y,[int]$CW,[int]$CH,[int]$Zoom)
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
  $gr2.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $gr2.DrawImage($cut,0,0,$OW,$OH); $gr2.Dispose(); $cut.Dispose()
  $big.Save($Out,[System.Drawing.Imaging.ImageFormat]::Png); $big.Dispose()
  Write-Output "wrote $Out"
}
Save-Zoom -Src "$d\..\_clean\silver-actions-1-clean.png" -Out "$d\wm_clean1.png" -X 1180 -Y 2080 -CW 548 -CH 224 -Zoom 2
Save-Zoom -Src "$d\..\_clean\silver-actions-2-clean.png" -Out "$d\wm_clean2.png" -X 1180 -Y 2080 -CW 548 -CH 224 -Zoom 2
