param(
  [Parameter(Mandatory=$true)][string]$WhaleSrc,
  [Parameter(Mandatory=$true)][string]$RobotSrc,
  [Parameter(Mandatory=$true)][string]$SilverSrc,
  [Parameter(Mandatory=$true)][string]$OutTs,
  [Parameter(Mandatory=$false)][string]$PreviewDir = ''
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$Fmt=[System.Drawing.Imaging.PixelFormat]::Format32bppArgb

function Read-Bmp([System.Drawing.Bitmap]$bmp){
  $w=$bmp.Width; $h=$bmp.Height
  $r=New-Object System.Drawing.Rectangle(0,0,$w,$h)
  $d=$bmp.LockBits($r,[System.Drawing.Imaging.ImageLockMode]::ReadOnly,$Fmt)
  $stride=[Math]::Abs($d.Stride); $len=$stride*$h
  $bytes=[byte[]]::new($len)
  [System.Runtime.InteropServices.Marshal]::Copy($d.Scan0,$bytes,0,$len)
  $bmp.UnlockBits($d); $bmp.Dispose()
  return [pscustomobject]@{W=$w;H=$h;Stride=$stride;B=$bytes}
}
function New-Bmp([int]$w,[int]$h,[int]$stride,[byte[]]$bytes){
  $bmp=[System.Drawing.Bitmap]::new($w,$h,$Fmt)
  $r=New-Object System.Drawing.Rectangle(0,0,$w,$h)
  $d=$bmp.LockBits($r,[System.Drawing.Imaging.ImageLockMode]::WriteOnly,$Fmt)
  [System.Runtime.InteropServices.Marshal]::Copy($bytes,0,$d.Scan0,$bytes.Length)
  $bmp.UnlockBits($d)
  return $bmp
}
# The watermark is byte-identical across all three grids; the characters differ.
# Zero ONLY pixels that match in all three, restricted to the bottom-right corner,
# so no character pixel is ever carved.
function Clear-WatermarkCross($W,$R,$S){
  $tol=4
  $x0=1990; $y0=1590; $x1=[Math]::Min($W.W,[Math]::Min($R.W,$S.W)); $y1=$W.H
  for($y=$y0;$y -lt $y1;$y++){
    $bw=$y*$W.Stride; $br=$y*$R.Stride; $bs=$y*$S.Stride
    for($x=$x0;$x -lt $x1;$x++){
      $iw=$bw+$x*4; $ir=$br+$x*4; $is=$bs+$x*4
      if($W.B[$iw+3] -le 8){ continue }
      if([Math]::Abs($W.B[$iw]-$R.B[$ir])-le $tol -and [Math]::Abs($W.B[$iw+1]-$R.B[$ir+1])-le $tol -and [Math]::Abs($W.B[$iw+2]-$R.B[$ir+2])-le $tol -and [Math]::Abs($W.B[$iw+3]-$R.B[$ir+3])-le $tol -and [Math]::Abs($W.B[$iw]-$S.B[$is])-le $tol -and [Math]::Abs($W.B[$iw+1]-$S.B[$is+1])-le $tol -and [Math]::Abs($W.B[$iw+2]-$S.B[$is+2])-le $tol -and [Math]::Abs($W.B[$iw+3]-$S.B[$is+3])-le $tol){
        $W.B[$iw+3]=0; $R.B[$ir+3]=0; $S.B[$is+3]=0
      }
    }
  }
}
function Get-BBoxBytes([int]$w,[int]$h,[int]$stride,[byte[]]$b){
  $minX=$w;$minY=$h;$maxX=-1;$maxY=-1
  for($y=0;$y -lt $h;$y++){ $base=$y*$stride
    for($x=0;$x -lt $w;$x++){ $a=$b[$base+$x*4+3]; if($a -gt 8){ if($x -lt $minX){$minX=$x}; if($x -gt $maxX){$maxX=$x}; if($y -lt $minY){$minY=$y}; if($y -gt $maxY){$maxY=$y} } } }
  if($maxX -lt 0){return [pscustomobject]@{X=0;Y=0;W=1;H=1}}
  return [pscustomobject]@{X=$minX;Y=$minY;W=($maxX-$minX+1);H=($maxY-$minY+1)}
}

# Compose one horizontal strip of $fw x $fh cells from selected grid frames.
function Build-Strip($g,[int]$fw,[int]$fh,[int[]]$idx,[string]$label){
  $cw=[int]($g.W/4); $ch=[int]($g.H/3); $stride=$cw*4
  $n=$idx.Count
  $frames=New-Object System.Collections.ArrayList
  foreach($gi in $idx){
    $ri=[int][Math]::Floor($gi/4); $ci=$gi%4
    $sub=[byte[]]::new($stride*$ch)
    for($y=0;$y -lt $ch;$y++){
      $srcRow=(($ri*$ch+$y)*$g.Stride)+($ci*$cw*4)
      [Array]::Copy($g.B,$srcRow,$sub,$y*$stride,$stride)
    }
    $bb=Get-BBoxBytes $cw $ch $stride $sub
    $frames+=,[pscustomobject]@{W=$cw;H=$ch;Stride=$stride;B=$sub;BB=$bb}
  }
  $strip=[System.Drawing.Bitmap]::new($fw*$n,$fh,$Fmt)
  $gfx=[System.Drawing.Graphics]::FromImage($strip)
  $gfx.Clear([System.Drawing.Color]::Transparent)
  $gfx.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  for($i=0;$i -lt $n;$i++){
    $e=$frames[$i]; $bb=$e.BB; $sw=$bb.W; $sh=$bb.H; $sx=$bb.X; $sy=$bb.Y
    $scale=[Math]::Min($fw/$sw,$fh/$sh)
    $rw=[int]($sw*$scale); $rh=[int]($sh*$scale)
    $dx=[int]($i*$fw + ($fw-$rw)/2)
    # Bottom-anchor so feet/pillow sit on the same baseline instead of floating.
    $dy=[int]($fh-$rh)
    $fb=New-Bmp $e.W $e.H $e.Stride $e.B
    $gfx.DrawImage($fb,(New-Object System.Drawing.Rectangle($dx,$dy,$rw,$rh)),(New-Object System.Drawing.Rectangle($sx,$sy,$sw,$sh)),[System.Drawing.GraphicsUnit]::Pixel)
    $fb.Dispose()
  }
  $gfx.Dispose()
  $ms=New-Object System.IO.MemoryStream
  $strip.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); $strip.Dispose()
  $pngBytes=$ms.ToArray(); $ms.Dispose()
  $b64=[Convert]::ToBase64String($pngBytes)
  if($PreviewDir -ne ''){
    $sc=0.5; $pw=[int]($fw*$n*$sc); $ph=[int]($fh*$sc)
    $pv=New-Object System.Drawing.Bitmap($pw,$ph)
    $pg=[System.Drawing.Graphics]::FromImage($pv)
    $pg.Clear([System.Drawing.Color]::White)
    $img=[System.Drawing.Image]::FromStream([System.IO.MemoryStream]::new($pngBytes))
    $pg.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $pg.DrawImage($img,0,0,$pw,$ph); $pg.Dispose(); $img.Dispose()
    $out=Join-Path $PreviewDir ($label+'-strip.png')
    $pv.Save($out,[System.Drawing.Imaging.ImageFormat]::Png); $pv.Dispose()
  }
  return [pscustomobject]@{Url="data:image/png;base64,$b64";FrameWidth=$fw;FrameHeight=$fh;FrameCount=$n;Len=$b64.Length}
}

# Load the three grids, erase the shared watermark once, then build strips.
$whaleG=Read-Bmp ([System.Drawing.Bitmap]::FromFile($WhaleSrc))
$robotG=Read-Bmp ([System.Drawing.Bitmap]::FromFile($RobotSrc))
$silverG=Read-Bmp ([System.Drawing.Bitmap]::FromFile($SilverSrc))
Clear-WatermarkCross $whaleG $robotG $silverG

$all=@(0,1,2,3,4,5,6,7,8,9,10,11)
$fullBody=@(4,5,6,7,8,9,10,11)

Write-Host 'building whale (12 full-body frames)...'
$whale=Build-Strip $whaleG 180 162 $all 'whale'
Write-Host "  whale b64 len: $($whale.Len) frames=$($whale.FrameCount)"
Write-Host 'building robot (8 full-body frames)...'
$robot=Build-Strip $robotG 180 162 $fullBody 'robot'
Write-Host "  robot b64 len: $($robot.Len) frames=$($robot.FrameCount)"
Write-Host 'building silver (8 full-body frames)...'
$silver=Build-Strip $silverG 180 180 $fullBody 'silver'
Write-Host "  silver b64 len: $($silver.Len) frames=$($silver.FrameCount)"

$tl=New-Object System.Collections.ArrayList
[void]$tl.Add('/** AUTO-GENERATED full-body sprite strips from the cleaned cutout pet sheets. */')
[void]$tl.Add('// Head-only close-up cells were dropped; leftover watermark text was erased.')
[void]$tl.Add('export interface PetArtSheet { readonly url: string; readonly frameWidth: number; readonly frameHeight: number; readonly frameCount: number }')
[void]$tl.Add('export const PET_ART: Record<string, PetArtSheet> = {')
[void]$tl.Add("  'whale': { url: '$($whale.Url)', frameWidth: $($whale.FrameWidth), frameHeight: $($whale.FrameHeight), frameCount: $($whale.FrameCount) },")
[void]$tl.Add("  'robot': { url: '$($robot.Url)', frameWidth: $($robot.FrameWidth), frameHeight: $($robot.FrameHeight), frameCount: $($robot.FrameCount) },")
[void]$tl.Add("  'silver-moon': { url: '$($silver.Url)', frameWidth: $($silver.FrameWidth), frameHeight: $($silver.FrameHeight), frameCount: $($silver.FrameCount) },")
[void]$tl.Add('}')
$tl | Set-Content -Path $OutTs -Encoding UTF8
Write-Host "wrote $OutTs"
