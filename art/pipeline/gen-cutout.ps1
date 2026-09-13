param(
  [Parameter(Mandatory=$true)][string]$WhaleSrc,
  [Parameter(Mandatory=$true)][string]$RobotSrc,
  [Parameter(Mandatory=$true)][string]$SilverSrc,
  [Parameter(Mandatory=$true)][string]$OutTs
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.InteropServices
$Fmt=[System.Drawing.Imaging.PixelFormat]::Format32bppArgb

function Read-Bmp([System.Drawing.Bitmap]$bmp){
  $r=New-Object System.Drawing.Rectangle(0,0,$bmp.Width,$bmp.Height)
  $d=$bmp.LockBits($r,[System.Drawing.Imaging.ImageLockMode]::ReadOnly,$Fmt)
  $stride=[Math]::Abs($d.Stride); $len=$stride*$bmp.Height
  $bytes=[byte[]]::new($len)
  [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0,$bytes,0,$len)
  $bmp.UnlockBits($d)
  return [pscustomobject]@{W=$bmp.Width;H=$bmp.Height;Stride=$stride;B=$bytes}
}

function New-Bmp([int]$w,[int]$h,[int]$stride,[byte[]]$bytes){
  $bmp=[System.Drawing.Bitmap]::new($w,$h,$Fmt)
  $r=New-Object System.Drawing.Rectangle(0,0,$w,$h)
  $d=$bmp.LockBits($r,[System.Drawing.Imaging.ImageLockMode]::WriteOnly,$Fmt)
  [System.Runtime.InteropServices.Marshal]::Copy($bytes,0,$d.Scan0,$bytes.Length)
  $bmp.UnlockBits($d)
  return $bmp
}

function Get-BBoxBytes([int]$w,[int]$h,[int]$stride,[byte[]]$b){
  $minX=$w;$minY=$h;$maxX=-1;$maxY=-1
  for($y=0;$y -lt $h;$y++){ $base=$y*$stride; $row=$y*$w
    for($x=0;$x -lt $w;$x++){ $a=$b[$base+$x*4+3]; if($a -gt 8){ if($x -lt $minX){$minX=$x}; if($x -gt $maxX){$maxX=$x}; if($y -lt $minY){$minY=$y}; if($y -gt $maxY){$maxY=$y} } } }
  return [pscustomobject]@{X=$minX;Y=$minY;W=($maxX-$minX+1);H=($maxY-$minY+1)}
}

# Slice the already-transparent cutout grid into 12 frames and compose a strip.
function Build-Strip([string]$srcPath,[int]$fw,[int]$fh){
  $srcImg=[System.Drawing.Bitmap]::FromFile($srcPath)
  $cw=[int]($srcImg.Width/4); $ch=[int]($srcImg.Height/3)
  $frames=New-Object System.Collections.ArrayList
  for($ri=0;$ri -lt 3;$ri++){ for($ci=0;$ci -lt 4;$ci++){
    $rect=New-Object System.Drawing.Rectangle(($ci*$cw),($ri*$ch),$cw,$ch)
    $cell=$srcImg.Clone($rect,$srcImg.PixelFormat)
    $cd=Read-Bmp $cell; $cell.Dispose()
    $bb=Get-BBoxBytes $cd.W $cd.H $cd.Stride $cd.B
    $frames+=,[pscustomobject]@{W=$cd.W;H=$cd.H;Stride=$cd.Stride;B=$cd.B;BB=$bb}
  } }
  $srcImg.Dispose()
  $strip=[System.Drawing.Bitmap]::new($fw*12,$fh,$Fmt)
  $gfx=[System.Drawing.Graphics]::FromImage($strip)
  $gfx.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  for($i=0;$i -lt 12;$i++){
    $e=$frames[$i]; $bb=$e.BB; $sw=$bb.W; $sh=$bb.H; $sx=$bb.X; $sy=$bb.Y
    $scale=[Math]::Min($fw/$sw,$fh/$sh)
    $rw=[int]($sw*$scale); $rh=[int]($sh*$scale)
    $dx=[int]($i*$fw + ($fw-$rw)/2); $dy=[int](($fh-$rh)/2)
    $fb=New-Bmp $e.W $e.H $e.Stride $e.B
    $gfx.DrawImage($fb,(New-Object System.Drawing.Rectangle($dx,$dy,$rw,$rh)),(New-Object System.Drawing.Rectangle($sx,$sy,$sw,$sh)),[System.Drawing.GraphicsUnit]::Pixel)
    $fb.Dispose()
  }
  $gfx.Dispose()
  $ms=New-Object System.IO.MemoryStream
  $strip.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); $strip.Dispose()
  $b64=[Convert]::ToBase64String($ms.ToArray()); $ms.Dispose()
  return [pscustomobject]@{Url="data:image/png;base64,$b64";FrameWidth=$fw;FrameHeight=$fh;Len=$b64.Length}
}

Write-Host 'building whale...'
$whale=Build-Strip $WhaleSrc 180 162
Write-Host "  whale b64 len: $($whale.Len)"
Write-Host 'building robot...'
$robot=Build-Strip $RobotSrc 180 162
Write-Host "  robot b64 len: $($robot.Len)"
Write-Host 'building silver...'
$silver=Build-Strip $SilverSrc 180 180
Write-Host "  silver b64 len: $($silver.Len)"

$tl=New-Object System.Collections.ArrayList
[void]$tl.Add('/** AUTO-GENERATED transparent sprite strips from the cutout pet expression sheets. */')
[void]$tl.Add('// Each url is one horizontal strip of 12 character frames (select frame i via background-position).')
[void]$tl.Add('export interface PetArtSheet { readonly url: string; readonly frameWidth: number; readonly frameHeight: number; readonly frameCount: number }')
[void]$tl.Add('export const PET_ART: Record<string, PetArtSheet> = {')
[void]$tl.Add("  'whale': { url: '$($whale.Url)', frameWidth: $($whale.FrameWidth), frameHeight: $($whale.FrameHeight), frameCount: 12 },")
[void]$tl.Add("  'robot': { url: '$($robot.Url)', frameWidth: $($robot.FrameWidth), frameHeight: $($robot.FrameHeight), frameCount: 12 },")
[void]$tl.Add("  'silver-moon': { url: '$($silver.Url)', frameWidth: $($silver.FrameWidth), frameHeight: $($silver.FrameHeight), frameCount: 12 },")
[void]$tl.Add('}')
$tl | Set-Content -Path $OutTs -Encoding UTF8
Write-Host "wrote $OutTs"
