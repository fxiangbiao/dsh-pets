$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing

$srcDir='D:\Pictures\pets'
$outDir='D:\ALAN\Codes\dsh-pets\plugin\src\client\arts'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# classifies a pixel as background by its colour cast + luminance
function Test-Bg([System.Drawing.Color]$c,[string]$mode,[double]$tintTh,[double]$lumTh){
  $lum=0.299*$c.R+0.587*$c.G+0.114*$c.B
  if($mode -eq 'cool'){ $tint=$c.B-$c.R; return (($tint -gt $tintTh) -and ($lum -gt $lumTh)) }
  else { $tint=$c.R-$c.B; return (($tint -gt $tintTh) -and ($lum -gt $lumTh)) }
}

# flood-remove background, refill enclosed holes, keep the largest opaque blob.
function Remove-Bg([System.Drawing.Bitmap]$bmp,[string]$mode,[double]$tintTh,[double]$lumTh){
  $w=$bmp.Width; $h=$bmp.Height; $N=$w*$h
  $col=[System.Drawing.Color[]]::new($N)
  for($y=0;$y -lt $h;$y++){ $row=$y*$w; for($x=0;$x -lt $w;$x++){ $col[$row+$x]=$bmp.GetPixel($x,$y) } }
  $dirs=@(@(1,0),@(-1,0),@(0,1),@(0,-1))

  $bgMask=[bool[]]::new($N)
  $q=New-Object 'System.Collections.Generic.Queue[int]'
  for($x=0;$x -lt $w;$x++){ foreach($y in @(0,($h-1))){ $i=$y*$w+$x; if(Test-Bg $col[$i] $mode $tintTh $lumTh){ $bgMask[$i]=$true; $q.Enqueue($i) } } }
  for($y=0;$y -lt $h;$y++){ foreach($x in @(0,($w-1))){ $i=$y*$w+$x; if(-not $bgMask[$i] -and (Test-Bg $col[$i] $mode $tintTh $lumTh)){ $bgMask[$i]=$true; $q.Enqueue($i) } } }
  while($q.Count -gt 0){
    $idx=$q.Dequeue(); $px=$idx % $w; $py=[int][math]::Floor($idx/$w)
    foreach($d in $dirs){ $nx=$px+$d[0];$ny=$py+$d[1]
      if($nx -lt 0 -or $nx -ge $w -or $ny -lt 0 -or $ny -ge $h){continue}
      $ni=$ny*$w+$nx
      if($bgMask[$ni]){continue}
      if(Test-Bg $col[$ni] $mode $tintTh $lumTh){ $bgMask[$ni]=$true; $q.Enqueue($ni) }
    }
  }

  # reachable transparent (outer) region
  $reach=[bool[]]::new($N)
  $q2=New-Object 'System.Collections.Generic.Queue[int]'
  for($x=0;$x -lt $w;$x++){ foreach($y in @(0,($h-1))){ $i=$y*$w+$x; if($bgMask[$i] -and -not $reach[$i]){ $reach[$i]=$true; $q2.Enqueue($i) } } }
  for($y=0;$y -lt $h;$y++){ foreach($x in @(0,($w-1))){ $i=$y*$w+$x; if($bgMask[$i] -and -not $reach[$i]){ $reach[$i]=$true; $q2.Enqueue($i) } } }
  while($q2.Count -gt 0){
    $idx=$q2.Dequeue(); $px=$idx % $w; $py=[int][math]::Floor($idx/$w)
    foreach($d in $dirs){ $nx=$px+$d[0];$ny=$py+$d[1]
      if($nx -lt 0 -or $nx -ge $w -or $ny -lt 0 -or $ny -ge $h){continue}
      $ni=$ny*$w+$nx
      if($bgMask[$ni] -and -not $reach[$ni]){ $reach[$ni]=$true; $q2.Enqueue($ni) }
    }
  }
  # transparent that is away from the border = enclosed hole -> keep opaque
  $opaque=[bool[]]::new($N)
  for($i=0;$i -lt $N;$i++){ $opaque[$i] = (-not $bgMask[$i]) -or (-not $reach[$i]) }

  # keep largest connected opaque component
  $vis=[bool[]]::new($N); $compId=[int[]]::new($N); for($i=0;$i -lt $N;$i++){ $compId[$i]=-1 }
  $sizes=New-Object System.Collections.ArrayList
  $q3=New-Object 'System.Collections.Generic.Queue[int]'; $cid=0
  for($i=0;$i -lt $N;$i++){
    if($vis[$i] -or (-not $opaque[$i])){continue}
    $vis[$i]=$true; $q3.Enqueue($i); $size=0
    while($q3.Count -gt 0){
      $idx=$q3.Dequeue(); $compId[$idx]=$cid; $size++
      $px=$idx % $w; $py=[int][math]::Floor($idx/$w)
      foreach($d in $dirs){ $nx=$px+$d[0];$ny=$py+$d[1]
        if($nx -lt 0 -or $nx -ge $w -or $ny -lt 0 -or $ny -ge $h){continue}
        $ni=$ny*$w+$nx
        if($vis[$ni] -or (-not $opaque[$ni])){continue}
        $vis[$ni]=$true; $q3.Enqueue($ni)
      }
    }
    [void]$sizes.Add($size); $cid++
  }
  $big=0; for($c=1;$c -lt $sizes.Count;$c++){ if($sizes[$c] -gt $sizes[$big]){$big=$c} }

  $out=[System.Drawing.Bitmap]::new($w,$h,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for($i=0;$i -lt $N;$i++){
    if($compId[$i] -eq $big){ $x=$i % $w; $y=[int][math]::Floor($i/$w); $out.SetPixel($x,$y,$col[$i]) }
    else { $x=$i % $w; $y=[int][math]::Floor($i/$w); $out.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(0,0,0,0)) }
  }
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

function Build-Sheet([string]$src,[string]$mode,[double]$tintTh,[double]$lumTh,[double]$xIn,[double]$xW,[double]$yT,[double]$yH){
  $bmp=[System.Drawing.Bitmap]::FromFile($src)
  $w=$bmp.Width; $h=$bmp.Height
  $cw=150; $ch=126
  $strip=[System.Drawing.Bitmap]::new($cw*12,$ch,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gfx=[System.Drawing.Graphics]::FromImage($strip)
  $gfx.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  for($ri=0;$ri -lt 3;$ri++){ for($ci=0;$ci -lt 4;$ci++){
    $col=$cols[$ci]; $row=$rows[$ri]
    $x0=$col.L; $x1=$col.R; $y0=$row.T; $y1=$row.B
    $cropX=[int]($x0+($x1-$x0)*$xIn); $cropW=[int](($x1-$x0)*$xW)
    $cropY=[int]($y0+($y1-$y0)*$yT); $cropH=[int](($y1-$y0)*$yH)
    if($cropX+$cropW -gt $w){$cropW=$w-$cropX}
    if($cropY+$cropH -gt $h){$cropH=$h-$cropY}
    $frame=$bmp.Clone((New-Object System.Drawing.Rectangle($cropX,$cropY,$cropW,$cropH)),$bmp.PixelFormat)
    $trans=Remove-Bg $frame $mode $tintTh $lumTh
    $frame.Dispose()
    $fi=$ri*4+$ci; $dstX=[int]($fi*$cw)
    $gfx.DrawImage($trans,(New-Object System.Drawing.Rectangle($dstX,0,$cw,$ch)),(New-Object System.Drawing.Rectangle(0,0,$trans.Width,$trans.Height)),[System.Drawing.GraphicsUnit]::Pixel)
    $trans.Dispose()
  }}
  $gfx.Dispose()
  $ms=New-Object System.IO.MemoryStream
  $strip.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
  $b64=[Convert]::ToBase64String($ms.ToArray()); $ms.Dispose()
  $strip.Dispose(); $bmp.Dispose()
  return [pscustomobject]@{url="data:image/png;base64,$b64"; len=$b64.Length}
}

$whale = Build-Sheet "$srcDir\pet_ds_2.png" 'cool' 4 210 0.03 0.94 0.02 0.84
Write-Host "whale png: $($whale.len)"
$robot = Build-Sheet "$srcDir\pet_robot_2.png" 'cool' 3 175 0.03 0.94 0.02 0.84
Write-Host "robot png: $($robot.len)"
$silverSrc=(Get-ChildItem -LiteralPath $srcDir -Filter '*.png' | Where-Object { $_.Name -notlike 'pet_*' -and $_.BaseName -like '*_2' } | Select-Object -First 1).FullName
$silver = Build-Sheet $silverSrc 'warm' 3 195 0.11 0.78 0.03 0.80
Write-Host "silver png: $($silver.len)"

# contact sheet on a checkerboard to reveal transparency
$cw=150;$ch=126
$contact=New-Object System.Drawing.Bitmap ($cw*4),($ch*3)
$cg=[System.Drawing.Graphics]::FromImage($contact)
# checkerboard
$cell=24
for($yy=0;$yy -lt ($ch*3);$yy+=$cell){ for($xx=0;$xx -lt ($cw*4);$xx+=$cell){
  $c= if((($xx/$cell)+($yy/$cell)) % 2 -eq 0){[System.Drawing.Color]::Gray}else{[System.Drawing.Color]::FromArgb(160,160,160)}
  $cg.FillRectangle((New-Object System.Drawing.SolidBrush $c),$xx,$yy,$cell,$cell)
}}
function DrawStrip([string]$b64,[string]$tag){
  $sb=[System.Convert]::FromBase64String(($b64 -replace '^data:image/png;base64,',''))
  $ms=New-Object System.IO.MemoryStream(,$sb)
  $img=[System.Drawing.Bitmap]::new($ms)
  for($i=0;$i -lt 12;$i++){ $dx=[int](($i%4)*$cw); $dy=[int]([math]::Floor($i/4)*$ch); $sx=[int]($i*$cw)
    $cg.DrawImage($img,(New-Object System.Drawing.Rectangle($dx,$dy,$cw,$ch)),(New-Object System.Drawing.Rectangle($sx,0,$cw,$ch)),[System.Drawing.GraphicsUnit]::Pixel) }
  $img.Dispose(); $ms.Dispose()
}
DrawStrip $whale.url 'whale'
DrawStrip $robot.url 'robot'
DrawStrip $silver.url 'silver'
$cg.Dispose()
$contact.Save("${outDir}_alpha_contact.png",[System.Drawing.Imaging.ImageFormat]::Png); $contact.Dispose()
Write-Host "wrote ${outDir}_alpha_contact.png"

$tl=New-Object System.Collections.ArrayList
[void]$tl.Add('/** AUTO-GENERATED transparent sprite strips from the pet expression sheets. */')
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
