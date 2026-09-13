$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$d='D:\ALAN\Codes\dsh-pets\_probe'

function Save-Zoom {
  param([string]$Src,[string]$Out,[int]$X,[int]$Y,[int]$CW,[int]$CH,[int]$Zoom)
  $img=[System.Drawing.Image]::FromFile($Src)
  $cut=New-Object System.Drawing.Bitmap -ArgumentList @($CW,$CH)
  $gr=[System.Drawing.Graphics]::FromImage($cut)
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

Save-Zoom -Src "$d\strip_whale.png"  -Out "$d\susp_whale_c11.png"  -X 2060 -Y 10 -CW 100 -CH 80 -Zoom 5
Save-Zoom -Src "$d\strip_robot.png"  -Out "$d\susp_robot_c3.png"   -X 640  -Y 80 -CW 90  -CH 60 -Zoom 6
Save-Zoom -Src "$d\strip_robot.png"  -Out "$d\susp_robot_c6.png"   -X 1195 -Y 0  -CW 70  -CH 40 -Zoom 6
Save-Zoom -Src "$d\strip_silver-moon.png" -Out "$d\susp_silver_tail.png" -X 1960 -Y 85 -CW 200 -CH 95 -Zoom 3
Save-Zoom -Src "$d\strip_silver-moon.png" -Out "$d\susp_silver_c0.png"   -X 0    -Y 90 -CW 80  -CH 90 -Zoom 5
