$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$silverSrc='D:\Pictures\pets\pet_ds_2.png'
$bmp=[System.Drawing.Bitmap]::FromFile($silverSrc)
$rect=New-Object System.Drawing.Rectangle(90,81,487,395)
$crop=$bmp.Clone($rect,$bmp.PixelFormat)
$bmp.Dispose()
$w=$crop.Width; $h=$crop.Height; $N=$w*$h

# bgSeed = average of a small block at each corner
function CornerAvg([int]$cx,[int]$cy){
  $r=0;$g=0;$b=0;$n=0
  for($y=$cy;$y -lt [math]::Min($cy+12,$h);$y++){ for($x=$cx;$x -lt [math]::Min($cx+12,$w);$x++){
    $c=$crop.GetPixel($x,$y); $r+=$c.R;$g+=$c.G;$b+=$c.B;$n++ } }
  [pscustomobject]@{R=[int]($r/$n);G=[int]($g/$n);B=[int]($b/$n)}
}
$seed=CornerAvg 0 0; $s2=CornerAvg ($w-12) 0; $s3=CornerAvg 0 ($h-12); $s4=CornerAvg ($w-12) ($h-12)
$sR=[int](($seed.R+$s2.R+$s3.R+$s4.R)/4);$sG=[int](($seed.G+$s2.G+$s3.G+$s4.G)/4);$sB=[int](($seed.B+$s2.B+$s3.B+$s4.B)/4)
Write-Host "bgSeed=($sR,$sG,$sB)"
$T=52

$col=[System.Drawing.Color[]]::new($N)
for($y=0;$y -lt $h;$y++){ $row=$y*$w; for($x=0;$x -lt $w;$x++){ $col[$row+$x]=$crop.GetPixel($x,$y) } }
$crop.Dispose()

function isBg([int]$i){ $c=$col[$i]; $tint=$c.B-$c.R; $lum=0.299*$c.R+0.587*$c.G+0.114*$c.B; return (($tint -gt 4) -and ($lum -gt 190)) }

$visited=[bool[]]::new($N)
$q=New-Object 'System.Collections.Generic.Queue[int]'
for($x=0;$x -lt $w;$x++){ foreach($y in @(0,($h-1))){ $i=$y*$w+$x; if(isBg $i){ $visited[$i]=$true; $q.Enqueue($i) } } }
for($y=0;$y -lt $h;$y++){ foreach($x in @(0,($w-1))){ $i=$y*$w+$x; if(-not $visited[$i] -and (isBg $i)){ $visited[$i]=$true; $q.Enqueue($i) } } }
$dirs=@(@(1,0),@(-1,0),@(0,1),@(0,-1))
while($q.Count -gt 0){
  $idx=$q.Dequeue(); $px=$idx % $w; $py=[int][math]::Floor($idx/$w)
  foreach($d in $dirs){
    $nx=$px+$d[0]; $ny=$py+$d[1]
    if($nx -lt 0 -or $nx -ge $w -or $ny -lt 0 -or $ny -ge $h){continue}
    $ni=$ny*$w+$nx
    if($visited[$ni]){continue}
    if(isBg $ni){ $visited[$ni]=$true; $q.Enqueue($ni) }
  }
}
# Refill enclosed transparent holes (belly) that are NOT reachable from the border.
$reachTrans=[bool[]]::new($N)
$q2=New-Object 'System.Collections.Generic.Queue[int]'
for($x=0;$x -lt $w;$x++){ foreach($y in @(0,($h-1))){ $i=$y*$w+$x; if($visited[$i] -and -not $reachTrans[$i]){ $reachTrans[$i]=$true; $q2.Enqueue($i) } } }
for($y=0;$y -lt $h;$y++){ foreach($x in @(0,($w-1))){ $i=$y*$w+$x; if($visited[$i] -and -not $reachTrans[$i]){ $reachTrans[$i]=$true; $q2.Enqueue($i) } } }
while($q2.Count -gt 0){
  $idx=$q2.Dequeue(); $px=$idx % $w; $py=[int][math]::Floor($idx/$w)
  foreach($d in $dirs){
    $nx=$px+$d[0]; $ny=$py+$d[1]
    if($nx -lt 0 -or $nx -ge $w -or $ny -lt 0 -or $ny -ge $h){continue}
    $ni=$ny*$w+$nx
    if($visited[$ni] -and -not $reachTrans[$ni]){ $reachTrans[$ni]=$true; $q2.Enqueue($ni) }
  }
}
# visited (bg) but NOT reachTrans = enclosed hole -> keep original colour (opaque).
$removed=0
$out=[System.Drawing.Bitmap]::new($w,$h,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
for($y=0;$y -lt $h;$y++){ for($x=0;$x -lt $w;$x++){ $i=$y*$w+$x
  if($visited[$i] -and $reachTrans[$i]){ $out.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(0,0,0,0)); $removed++ }
  else { $out.SetPixel($x,$y,$col[$i]) }
}}
# composite on magenta to see transparency
$bg=New-Object System.Drawing.Bitmap $w,$h
$g=[System.Drawing.Graphics]::FromImage($bg)
$g.Clear([System.Drawing.Color]::Magenta)
$g.DrawImage($out,0,0,$w,$h); $g.Dispose()
$bg.Save('D:\ALAN\Codes\dsh-pets\_bg_proto.png',[System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose();$bg.Dispose()
Write-Host "removed $removed / $N px (T=$T)"