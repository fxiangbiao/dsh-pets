$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing

$srcDir='D:\Pictures\pets'
$outDir='D:\ALAN\Codes\dsh-pets\plugin\src\client\arts'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Erase label text: remove small dark connected components that sit in the crop's
# outer edge band, filling them with the nearest surrounding background colour.
function Invoke-CropClean([System.Drawing.Bitmap]$crop){
  $w=$crop.Width; $h=$crop.Height; $N=$w*$h
  $col=[System.Drawing.Color[]]::new($N)
  $lum=[double[]]::new($N)
  for($y=0;$y -lt $h;$y++){ $row=$y*$w; for($x=0;$x -lt $w;$x++){ $i=$row+$x
    $c=$crop.GetPixel($x,$y); $col[$i]=$c
    $lum[$i]=0.299*$c.R+0.587*$c.G+0.114*$c.B
  }}
  $darkThresh=150.0
  $visited=[bool[]]::new($N)
  $textMask=[bool[]]::new($N)
  $q=New-Object 'System.Collections.Generic.Queue[int]'
  $dirs=@(@(1,0),@(-1,0),@(0,1),@(0,-1),@(1,1),@(1,-1),@(-1,1),@(-1,-1))
  for($y=0;$y -lt $h;$y++){ for($x=0;$x -lt $w;$x++){
    $start=$y*$w+$x
    if($visited[$start]){continue}
    if($lum[$start] -ge $darkThresh){$visited[$start]=$true;continue}
    $q.Enqueue($start); $visited[$start]=$true
    $comp=New-Object System.Collections.ArrayList
    $minX=$x;$maxX=$x;$minY=$y;$maxY=$y;$count=0
    while($q.Count -gt 0){
      $idx=$q.Dequeue(); [void]$comp.Add($idx)
      $px=$idx % $w; $py=[int][math]::Floor($idx/$w)
      $count++
      if($px -lt $minX){$minX=$px}; if($px -gt $maxX){$maxX=$px}
      if($py -lt $minY){$minY=$py}; if($py -gt $maxY){$maxY=$py}
      foreach($d in $dirs){
        $nx=$px+$d[0]; $ny=$py+$d[1]
        if($nx -lt 0 -or $nx -ge $w -or $ny -lt 0 -or $ny -ge $h){continue}
        $ni=$ny*$w+$nx
        if($visited[$ni]){continue}
        if($lum[$ni] -ge $darkThresh){continue}
        $visited[$ni]=$true; $q.Enqueue($ni)
      }
    }
    $cx=($minX+$maxX)/2.0; $cy=($minY+$maxY)/2.0
    $edgeBand=0.30
    $inBand = ($cx -lt $w*$edgeBand) -or ($cx -gt $w*(1-$edgeBand)) -or ($cy -lt $h*$edgeBand) -or ($cy -gt $h*(1-$edgeBand))
    $bottomCenter = ($cy -gt 0.78*$h) -and ($cx -ge 0.25*$w) -and ($cx -le 0.75*$w)
    if($inBand -and ($count -lt 1300) -and (-not $bottomCenter)){
      foreach($idx2 in $comp){ $textMask[$idx2]=$true }
    }
  }}
  # Dilate the text mask by 2px so the anti-aliased halo is covered too.
  $dil=[bool[]]::new($N)
  for($y=0;$y -lt $h;$y++){ for($x=0;$x -lt $w;$x++){
    $isText=$false
    for($dy=-2;$dy -le 2;$dy++){ for($dx=-2;$dx -le 2;$dx++){
      $nx=$x+$dx;$ny=$y+$dy
      if($nx -lt 0 -or $nx -ge $w -or $ny -lt 0 -or $ny -ge $h){continue}
      if($textMask[$ny*$w+$nx]){$isText=$true; break}
    }; if($isText){break} }
    $dil[$y*$w+$x]=$isText
  }}
  $out=New-Object System.Drawing.Bitmap $w,$h
  for($y=0;$y -lt $h;$y++){ for($x=0;$x -lt $w;$x++){
    $i=$y*$w+$x
    if(-not $dil[$i]){ $out.SetPixel($x,$y,$col[$i]); continue }
    $rr=0;$gg=0;$bb=0;$n=0
    for($d=1;$d -le 14;$d++){ if($x-$d -lt 0){break}; $j=$i-$d; if(-not $dil[$j]){ $c=$col[$j];$rr+=$c.R;$gg+=$c.G;$bb+=$c.B;$n++;break } }
    for($d=1;$d -le 14;$d++){ if($x+$d -ge $w){break}; $j=$i+$d; if(-not $dil[$j]){ $c=$col[$j];$rr+=$c.R;$gg+=$c.G;$bb+=$c.B;$n++;break } }
    for($d=1;$d -le 14;$d++){ if($y-$d -lt 0){break}; $j=$i-$d*$w; if(-not $dil[$j]){ $c=$col[$j];$rr+=$c.R;$gg+=$c.G;$bb+=$c.B;$n++;break } }
    for($d=1;$d -le 14;$d++){ if($y+$d -ge $h){break}; $j=$i+$d*$w; if(-not $dil[$j]){ $c=$col[$j];$rr+=$c.R;$gg+=$c.G;$bb+=$c.B;$n++;break } }
    if($n -gt 0){ $out.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(255,[int]($rr/$n),[int]($gg/$n),[int]($bb/$n))) }
    else { $out.SetPixel($x,$y,$col[$i]) }
  }}
  return $out
}

$cols=@(
  [pscustomobject]@{L=75;  R=593},
  [pscustomobject]@{L=612; R=1144},
  [pscustomobject]@{L=1161;R=1693},
  [pscustomobject]@{L=1710;R=2243}
)
$rows=@(
  [pscustomobject]@{T=72;  B=543},
  [pscustomobject]@{T=588; B=1096},
  [pscustomobject]@{T=1141;B=1652}
)

function Build-Sheet([string]$src,[double]$xIn,[double]$xW,[double]$yT,[double]$yH,[bool]$clean){
  $bmp=[System.Drawing.Bitmap]::FromFile($src)
  $w=$bmp.Width; $h=$bmp.Height
  $cw=150; $ch=126
  $strip=New-Object System.Drawing.Bitmap ($cw*12), $ch
  $gfx=[System.Drawing.Graphics]::FromImage($strip)
  $gfx.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gfx.Clear([System.Drawing.Color]::Transparent)
  for($ri=0;$ri -lt 3;$ri++){ for($ci=0;$ci -lt 4;$ci++){
    $col=$cols[$ci]; $row=$rows[$ri]
    $x0=$col.L; $x1=$col.R; $y0=$row.T; $y1=$row.B
    $cropX=[int]($x0+($x1-$x0)*$xIn); $cropW=[int](($x1-$x0)*$xW)
    $cropY=[int]($y0+($y1-$y0)*$yT); $cropH=[int](($y1-$y0)*$yH)
    if($cropX+$cropW -gt $w){$cropW=$w-$cropX}
    if($cropY+$cropH -gt $h){$cropH=$h-$cropY}
    $frame=$bmp.Clone((New-Object System.Drawing.Rectangle($cropX,$cropY,$cropW,$cropH)),$bmp.PixelFormat)
    if($clean){ $cleaned=Invoke-CropClean $frame; $frame.Dispose(); $frame=$cleaned }
    $fi=$ri*4+$ci; $dstX=[int]($fi*$cw)
    $gfx.DrawImage($frame,(New-Object System.Drawing.Rectangle($dstX,0,$cw,$ch)),(New-Object System.Drawing.Rectangle(0,0,$frame.Width,$frame.Height)),[System.Drawing.GraphicsUnit]::Pixel)
    $frame.Dispose()
  }}
  $gfx.Dispose()
  $ms=New-Object System.IO.MemoryStream
  $strip.Save($ms,[System.Drawing.Imaging.ImageFormat]::Jpeg)
  $b64=[Convert]::ToBase64String($ms.ToArray()); $ms.Dispose()
  $strip.Dispose(); $bmp.Dispose()
  return [pscustomobject]@{url="data:image/jpeg;base64,$b64"; len=$b64.Length}
}

$whale = Build-Sheet "$srcDir\pet_ds_2.png" 0.03 0.94 0.02 0.84 $false
Write-Host "whale base64: $($whale.len)"
$robot = Build-Sheet "$srcDir\pet_robot_2.png" 0.03 0.94 0.02 0.84 $false
Write-Host "robot base64: $($robot.len)"
$silverSrc=(Get-ChildItem -LiteralPath $srcDir -Filter '*.png' | Where-Object { $_.Name -notlike 'pet_*' -and $_.BaseName -like '*_2' } | Select-Object -First 1).FullName
$silver = Build-Sheet $silverSrc 0.11 0.78 0.03 0.80 $true
Write-Host "silver base64: $($silver.len)"

# contact sheet for silver to verify
$cw=150;$ch=126
$contact=New-Object System.Drawing.Bitmap ($cw*4),($ch*3)
$cg=[System.Drawing.Graphics]::FromImage($contact)
$cg.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
# rebuild a temp strip for contact from silver base64
$sb=[System.Convert]::FromBase64String(($silver.url -replace '^data:image/jpeg;base64,',''))
$ms2=New-Object System.IO.MemoryStream(,$sb)
$silverBitmap=[System.Drawing.Bitmap]::new($ms2)
for($i=0;$i -lt 12;$i++){ $dx=[int](($i%4)*$cw); $dy=[int]([math]::Floor($i/4)*$ch); $sx=[int]($i*$cw)
  $cg.DrawImage($silverBitmap,(New-Object System.Drawing.Rectangle($dx,$dy,$cw,$ch)),(New-Object System.Drawing.Rectangle($sx,0,$cw,$ch)),[System.Drawing.GraphicsUnit]::Pixel) }
$cg.Dispose(); $silverBitmap.Dispose(); $ms2.Dispose()
$contact.Save("${outDir}_silver_contact.png",[System.Drawing.Imaging.ImageFormat]::Png); $contact.Dispose()
Write-Host "wrote ${outDir}_silver_contact.png"

$tl=New-Object System.Collections.ArrayList
[void]$tl.Add('/** AUTO-GENERATED sprite strips from the pet expression sheets. */')
[void]$tl.Add('// Each url is one horizontal strip of 12 character frames (select frame i via background-position).')
[void]$tl.Add('export interface PetArtSheet { readonly url: string; readonly frameWidth: number; readonly frameHeight: number; readonly frameCount: number }')
[void]$tl.Add('export const PET_ART: Record<string, PetArtSheet> = {')
[void]$tl.Add("  'whale': { url: '$($whale.url)', frameWidth: 150, frameHeight: 126, frameCount: 12 },")
[void]$tl.Add("  'robot': { url: '$($robot.url)', frameWidth: 150, frameHeight: 126, frameCount: 12 },")
[void]$tl.Add("  'silver-moon': { url: '$($silver.url)', frameWidth: 150, frameHeight: 126, frameCount: 12 },")
[void]$tl.Add('}')
$tsPath="$outDir\sprite-data.ts"
$tl | Set-Content -Path $tsPath -Encoding UTF8
Write-Host "wrote $tsPath"
