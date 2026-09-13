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

function Remove-BgBytes([int]$w,[int]$h,[int]$stride,[byte[]]$src,[double]$lumTh,[double]$satTh,[double]$minAreaFrac){
  $N=$w*$h
  $isFg=[bool[]]::new($N)
  for($y=0;$y -lt $h;$y++){ $base=$y*$stride; $row=$y*$w
    for($x=0;$x -lt $w;$x++){ $o=$base+$x*4; $b=$src[$o]; $g=$src[$o+1]; $r=$src[$o+2]; $a=$src[$o+3]
      $mx=[Math]::Max($r,[Math]::Max($g,$b)); $mn=[Math]::Min($r,[Math]::Min($g,$b)); $lum=0.299*$r+0.587*$g+0.114*$b
      $isFg[$row+$x] = -not (($a -ne 0) -and ($lum -gt $lumTh) -and (($mx-$mn) -lt $satTh))
    } }
  $bg=[bool[]]::new($N)
  $q=New-Object 'System.Collections.Generic.Queue[int]'
  for($x=0;$x -lt $w;$x++){ foreach($y in @(0,($h-1))){ $i=$y*$w+$x; if(-not $isFg[$i] -and -not $bg[$i]){ $bg[$i]=$true; $q.Enqueue($i) } } }
  for($y=0;$y -lt $h;$y++){ foreach($x in @(0,($w-1))){ $i=$y*$w+$x; if(-not $isFg[$i] -and -not $bg[$i]){ $bg[$i]=$true; $q.Enqueue($i) } } }
  while($q.Count -gt 0){
    $idx=$q.Dequeue(); $px=$idx % $w; $py=[int][math]::Floor($idx/$w)
    $n1=$idx+1; if(($px+1) -lt $w -and -not $bg[$n1] -and -not $isFg[$n1]){ $bg[$n1]=$true; $q.Enqueue($n1) }
    $n2=$idx-1; if($px -gt 0 -and -not $bg[$n2] -and -not $isFg[$n2]){ $bg[$n2]=$true; $q.Enqueue($n2) }
    $n3=$idx+$w; if(($py+1) -lt $h -and -not $bg[$n3] -and -not $isFg[$n3]){ $bg[$n3]=$true; $q.Enqueue($n3) }
    $n4=$idx-$w; if($py -gt 0 -and -not $bg[$n4] -and -not $isFg[$n4]){ $bg[$n4]=$true; $q.Enqueue($n4) }
  }
  $cand=[bool[]]::new($N)
  for($i=0;$i -lt $N;$i++){ $cand[$i] = (-not $bg[$i]) }
  $vis=[bool[]]::new($N); $keep=[bool[]]::new($N)
  $minArea=[int]($N*$minAreaFrac)
  for($i=0;$i -lt $N;$i++){
    if($vis[$i] -or (-not $cand[$i])){continue}
    $comp=New-Object 'System.Collections.Generic.List[int]'
    $vis[$i]=$true; $q2=New-Object 'System.Collections.Generic.Queue[int]'; $q2.Enqueue($i)
    while($q2.Count -gt 0){
      $idx=$q2.Dequeue(); $comp.Add($idx); $px=$idx % $w; $py=[int][math]::Floor($idx/$w)
      $n1=$idx+1; if(($px+1) -lt $w -and -not $vis[$n1] -and $cand[$n1]){ $vis[$n1]=$true; $q2.Enqueue($n1) }
      $n2=$idx-1; if($px -gt 0 -and -not $vis[$n2] -and $cand[$n2]){ $vis[$n2]=$true; $q2.Enqueue($n2) }
      $n3=$idx+$w; if(($py+1) -lt $h -and -not $vis[$n3] -and $cand[$n3]){ $vis[$n3]=$true; $q2.Enqueue($n3) }
      $n4=$idx-$w; if($py -gt 0 -and -not $vis[$n4] -and $cand[$n4]){ $vis[$n4]=$true; $q2.Enqueue($n4) }
    }
    if($comp.Count -ge $minArea){ foreach($c in $comp){ $keep[$c]=$true } }
  }
  $out=[byte[]]::new($stride*$h)
  for($y=0;$y -lt $h;$y++){ $base=$y*$stride; $row=$y*$w
    for($x=0;$x -lt $w;$x++){ $o=$base+$x*4; $i=$row+$x
      if($keep[$i]){ $out[$o]=$src[$o];$out[$o+1]=$src[$o+1];$out[$o+2]=$src[$o+2];$out[$o+3]=$src[$o+3] }
      else { $out[$o]=0;$out[$o+1]=0;$out[$o+2]=0;$out[$o+3]=0 }
    } }
  return [pscustomobject]@{W=$w;H=$h;Stride=$stride;B=$out}
}

function Get-BBoxBytes([int]$w,[int]$h,[int]$stride,[byte[]]$b){
  $minX=$w;$minY=$h;$maxX=-1;$maxY=-1
  for($y=0;$y -lt $h;$y++){ $base=$y*$stride; $row=$y*$w
    for($x=0;$x -lt $w;$x++){ $a=$b[$base+$x*4+3]; if($a -gt 8){ if($x -lt $minX){$minX=$x}; if($x -gt $maxX){$maxX=$x}; if($y -lt $minY){$minY=$y}; if($y -gt $maxY){$maxY=$y} } } }
  return [pscustomobject]@{X=$minX;Y=$minY;W=($maxX-$minX+1);H=($maxY-$minY+1)}
}

function Build-Strip([string]$srcPath,[double[]]$labelCuts,[double]$lumTh,[double]$satTh,[double]$minAreaFrac,[int]$fw,[int]$fh){
  $srcImg=[System.Drawing.Bitmap]::FromFile($srcPath)
  $cw=[int]($srcImg.Width/4); $ch=[int]($srcImg.Height/3)
  $frames=New-Object System.Collections.ArrayList
  for($ri=0;$ri -lt 3;$ri++){ for($ci=0;$ci -lt 4;$ci++){
    $hh=[int]($ch*(1-$labelCuts[$ri]))
    $rect=New-Object System.Drawing.Rectangle(($ci*$cw),($ri*$ch),$cw,$hh)
    $cell=$srcImg.Clone($rect,$srcImg.PixelFormat)
    $cd=Read-Bmp $cell; $cell.Dispose()
    $tr=Remove-BgBytes $cd.W $cd.H $cd.Stride $cd.B $lumTh $satTh $minAreaFrac
    $bb=Get-BBoxBytes $tr.W $tr.H $tr.Stride $tr.B
    $frames+=,[pscustomobject]@{W=$tr.W;H=$tr.H;Stride=$tr.Stride;B=$tr.B;BB=$bb}
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
$whale=Build-Strip $WhaleSrc @(0.13,0.13,0.13) 195 26 0.004 180 162
Write-Host "  whale b64 len: $($whale.Len)"
Write-Host 'building robot...'
$robot=Build-Strip $RobotSrc @(0.13,0.13,0.13) 195 26 0.004 180 162
Write-Host "  robot b64 len: $($robot.Len)"
Write-Host 'building silver...'
$silver=Build-Strip $SilverSrc @(0.13,0.13,0.13) 195 26 0.004 180 180
Write-Host "  silver b64 len: $($silver.Len)"

$tl=New-Object System.Collections.ArrayList
[void]$tl.Add('/** AUTO-GENERATED transparent sprite strips from the pet expression sheets. */')
[void]$tl.Add('// Each url is one horizontal strip of 12 character frames (select frame i via background-position).')
[void]$tl.Add('export interface PetArtSheet { readonly url: string; readonly frameWidth: number; readonly frameHeight: number; readonly frameCount: number }')
[void]$tl.Add('export const PET_ART: Record<string, PetArtSheet> = {')
[void]$tl.Add("  'whale': { url: '$($whale.Url)', frameWidth: $($whale.FrameWidth), frameHeight: $($whale.FrameHeight), frameCount: 12 },")
[void]$tl.Add("  'robot': { url: '$($robot.Url)', frameWidth: $($robot.FrameWidth), frameHeight: $($robot.FrameHeight), frameCount: 12 },")
[void]$tl.Add("  'silver-moon': { url: '$($silver.Url)', frameWidth: $($silver.FrameWidth), frameHeight: $($silver.FrameHeight), frameCount: 12 },")
[void]$tl.Add('}')
$tl | Set-Content -Path $OutTs -Encoding UTF8
Write-Host "wrote $OutTs"
