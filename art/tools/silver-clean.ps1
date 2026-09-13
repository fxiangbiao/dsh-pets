$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$outDir='D:\ALAN\Codes\dsh-pets\plugin\src\client\arts'

# label removal (small dark components in edge band, filled with surrounding bg)
function Invoke-CropClean([System.Drawing.Bitmap]$crop){
  $w=$crop.Width; $h=$crop.Height; $N=$w*$h
  $col=[System.Drawing.Color[]]::new($N); $lum=[double[]]::new($N)
  for($y=0;$y -lt $h;$y++){ $row=$y*$w; for($x=0;$x -lt $w;$x++){ $i=$row+$x
    $c=$crop.GetPixel($x,$y); $col[$i]=$c; $lum[$i]=0.299*$c.R+0.587*$c.G+0.114*$c.B }}
  $darkThresh=150.0; $visited=[bool[]]::new($N); $textMask=[bool[]]::new($N)
  $q=New-Object 'System.Collections.Generic.Queue[int]'
  $dirs=@(@(1,0),@(-1,0),@(0,1),@(0,-1),@(1,1),@(1,-1),@(-1,1),@(-1,-1))
  for($y=0;$y -lt $h;$y++){ for($x=0;$x -lt $w;$x++){
    $start=$y*$w+$x
    if($visited[$start]){continue}
    if($lum[$start] -ge $darkThresh){$visited[$start]=$true;continue}
    $q.Enqueue($start); $visited[$start]=$true
    $comp=New-Object System.Collections.ArrayList; $minX=$x;$maxX=$x;$minY=$y;$maxY=$y;$count=0
    while($q.Count -gt 0){ $idx=$q.Dequeue(); [void]$comp.Add($idx); $px=$idx % $w; $py=[int][math]::Floor($idx/$w); $count++
      if($px -lt $minX){$minX=$px}; if($px -gt $maxX){$maxX=$px}; if($py -lt $minY){$minY=$py}; if($py -gt $maxY){$maxY=$py}
      foreach($d in $dirs){ $nx=$px+$d[0];$ny=$py+$d[1]; if($nx -lt 0 -or $nx -ge $w -or $ny -lt 0 -or $ny -ge $h){continue}; $ni=$ny*$w+$nx
        if($visited[$ni]){continue}; if($lum[$ni] -ge $darkThresh){continue}; $visited[$ni]=$true; $q.Enqueue($ni) } }
    $cx=($minX+$maxX)/2.0; $cy=($minY+$maxY)/2.0; $edgeBand=0.30
    $inBand=($cx -lt $w*$edgeBand)-or($cx -gt $w*(1-$edgeBand))-or($cy -lt $h*$edgeBand)-or($cy -gt $h*(1-$edgeBand))
    $bottomCenter=($cy -gt 0.78*$h)-and($cx -ge 0.25*$w)-and($cx -le 0.75*$w)
    if($inBand -and ($count -lt 1300) -and (-not $bottomCenter)){ foreach($i2 in $comp){$textMask[$i2]=$true} }
  }}
  $dil=[bool[]]::new($N)
  for($y=0;$y -lt $h;$y++){ for($x=0;$x -lt $w;$x++){ $isT=$false
    for($dy=-2;$dy -le 2;$dy++){ for($dx=-2;$dx -le 2;$dx++){ $nx=$x+$dx;$ny=$y+$dy; if($nx -lt 0 -or $nx -ge $w -or $ny -lt 0 -or $ny -ge $h){continue}; if($textMask[$ny*$w+$nx]){$isT=$true;break} }; if($isT){break} }
    $dil[$y*$w+$x]=$isT }}
  $out=New-Object System.Drawing.Bitmap $w,$h
  for($y=0;$y -lt $h;$y++){ for($x=0;$x -lt $w;$x++){ $i=$y*$w+$x
    if(-not $dil[$i]){ $out.SetPixel($x,$y,$col[$i]); continue }
    $rr=0;$gg=0;$bb=0;$n=0
    for($d=1;$d -le 14;$d++){ if($x-$d -lt 0){break}; $j=$i-$d; if(-not $dil[$j]){ $c=$col[$j];$rr+=$c.R;$gg+=$c.G;$bb+=$c.B;$n++;break } }
    for($d=1;$d -le 14;$d++){ if($x+$d -ge $w){break}; $j=$i+$d; if(-not $dil[$j]){ $c=$col[$j];$rr+=$c.R;$gg+=$c.G;$bb+=$c.B;$n++;break } }
    for($d=1;$d -le 14;$d++){ if($y-$d -lt 0){break}; $j=$i-$d*$w; if(-not $dil[$j]){ $c=$col[$j];$rr+=$c.R;$gg+=$c.G;$bb+=$c.B;$n++;break } }
    for($d=1;$d -le 14;$d++){ if($y+$d -ge $h){break}; $j=$i+$d*$w; if(-not $dil[$j]){ $c=$col[$j];$rr+=$c.R;$gg+=$c.G;$bb+=$c.B;$n++;break } }
    if($n -gt 0){ $out.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(255,[int]($rr/$n),[int]($gg/$n),[int]($bb/$n))) } else { $out.SetPixel($x,$y,$col[$i]) }
  }}
  return $out
}

$cols=@([pscustomobject]@{L=75;R=593},[pscustomobject]@{L=612;R=1144},[pscustomobject]@{L=1161;R=1693},[pscustomobject]@{L=1710;R=2243})
$rows=@([pscustomobject]@{T=72;B=543},[pscustomobject]@{T=588;B=1096},[pscustomobject]@{T=1141;B=1652})
$silverSrc=(Get-ChildItem -LiteralPath 'D:\Pictures\pets' -Filter '*.png' | Where-Object { $_.Name -notlike 'pet_*' -and $_.BaseName -like '*_2' } | Select-Object -First 1).FullName
$bmp=[System.Drawing.Bitmap]::FromFile($silverSrc)
$w=$bmp.Width; $h=$bmp.Height
$cw=150;$ch=126
$strip=[System.Drawing.Bitmap]::new($cw*12,$ch,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gfx=[System.Drawing.Graphics]::FromImage($strip); $gfx.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
for($ri=0;$ri -lt 3;$ri++){ for($ci=0;$ci -lt 4;$ci++){
  $col=$cols[$ci];$row=$rows[$ri];$x0=$col.L;$x1=$col.R;$y0=$row.T;$y1=$row.B
  $cropX=[int]($x0+($x1-$x0)*0.11); $cropW=[int](($x1-$x0)*0.78)
  $cropY=[int]($y0+($y1-$y0)*0.03); $cropH=[int](($y1-$y0)*0.80)
  if($cropX+$cropW -gt $w){$cropW=$w-$cropX}; if($cropY+$cropH -gt $h){$cropH=$h-$cropY}
  $frame=$bmp.Clone((New-Object System.Drawing.Rectangle($cropX,$cropY,$cropW,$cropH)),$bmp.PixelFormat)
  $clean=Invoke-CropClean $frame
  $fi=$ri*4+$ci; $dstX=[int]($fi*$cw)
  $gfx.DrawImage($clean,(New-Object System.Drawing.Rectangle($dstX,0,$cw,$ch)),(New-Object System.Drawing.Rectangle(0,0,$clean.Width,$clean.Height)),[System.Drawing.GraphicsUnit]::Pixel)
  $clean.Dispose(); $frame.Dispose()
}}
$gfx.Dispose(); $bmp.Dispose()
$ms=New-Object System.IO.MemoryStream
$strip.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
$b64=[Convert]::ToBase64String($ms.ToArray()); $ms.Dispose(); $strip.Dispose()
$silverUrl="data:image/png;base64,$b64"
Write-Host "silver clean opaque png b64: $($b64.Length)"

# patch sprite-data.ts silver url
$tsPath="$outDir\sprite-data.ts"
$ts=Get-Content $tsPath -Raw
$m=[regex]::Match($ts,"('silver-moon': \{ url: ')[^']*(')")
if($m.Success){
  $ts = [regex]::Replace($ts,"('silver-moon': \{ url: ')[^']*(')", "`${1}$silverUrl`${2}", 1)
  Set-Content -Path $tsPath -Value $ts -Encoding UTF8 -NoNewline
  Write-Host "patched silver-moon url in sprite-data.ts"
} else { Write-Host "silver-moon entry not found!" }
# reread and trim any >compose safe? just report size
Write-Host "sprite-data.ts size: $((Get-Item $tsPath).Length)"