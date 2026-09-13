param(
  [Parameter(Mandatory=$true)][string]$SrcPath,
  [Parameter(Mandatory=$true)][string]$OutName,
  [double]$LumTh=195,
  [double]$SatTh=26,
  [double]$MinAreaFrac=0.004,
  [double]$LabelCut0=0.13,
  [double]$LabelCut1=0.13,
  [double]$LabelCut2=0.13,
  [int]$FrameW=200,
  [int]$FrameH=180
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.InteropServices
$outDir='D:\ALAN\Codes\dsh-pets'
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

# classify + flood-remove near-white background over a byte-array image
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
  # foreground candidate = not border-background
  $cand=[bool[]]::new($N)
  for($i=0;$i -lt $N;$i++){ $cand[$i] = (-not $bg[$i]) }
  # keep components over min area
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

$srcImg=[System.Drawing.Bitmap]::FromFile($SrcPath)
$labelCuts=@($LabelCut0,$LabelCut1,$LabelCut2)
$cw=[int]($srcImg.Width/4); $ch=[int]($srcImg.Height/3)
$frames=New-Object System.Collections.ArrayList
for($ri=0;$ri -lt 3;$ri++){ for($ci=0;$ci -lt 4;$ci++){
  $hh=[int]($ch*(1-$labelCuts[$ri]))
  $rect=New-Object System.Drawing.Rectangle(($ci*$cw),($ri*$ch),$cw,$hh)
  $cell=$srcImg.Clone($rect,$srcImg.PixelFormat)
  $cd=Read-Bmp $cell; $cell.Dispose()
  $tr=Remove-BgBytes $cd.W $cd.H $cd.Stride $cd.B $LumTh $SatTh $MinAreaFrac
  $bb=Get-BBoxBytes $tr.W $tr.H $tr.Stride $tr.B
  $frames+=,[pscustomobject]@{W=$tr.W;H=$tr.H;Stride=$tr.Stride;B=$tr.B;BB=$bb}
} }
$srcImg.Dispose()

$uW=0;$uH=0
foreach($e in $frames){ if($e.BB.W -gt $uW){$uW=$e.BB.W}; if($e.BB.H -gt $uH){$uH=$e.BB.H} }
Write-Host "tight unified bbox: ${uW}x${uH}"

$strip=[System.Drawing.Bitmap]::new($FrameW*12,$FrameH,$Fmt)
$gfx=[System.Drawing.Graphics]::FromImage($strip)
$gfx.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
for($i=0;$i -lt 12;$i++){
  $e=$frames[$i]; $bb=$e.BB; $sw=$bb.W; $sh=$bb.H; $sx=$bb.X; $sy=$bb.Y
  $scale=[Math]::Min($FrameW/$sw,$FrameH/$sh)
  $rw=[int]($sw*$scale); $rh=[int]($sh*$scale)
  $dx=[int]($i*$FrameW + ($FrameW-$rw)/2); $dy=[int](($FrameH-$rh)/2)
  $fb=New-Bmp $e.W $e.H $e.Stride $e.B
  $gfx.DrawImage($fb,(New-Object System.Drawing.Rectangle($dx,$dy,$rw,$rh)),(New-Object System.Drawing.Rectangle($sx,$sy,$sw,$sh)),[System.Drawing.GraphicsUnit]::Pixel)
  $fb.Dispose()
}
$gfx.Dispose()
$strip.Save("$outDir\_strip_$OutName.png",[System.Drawing.Imaging.ImageFormat]::Png)
$strip.Dispose()
Write-Host "wrote _strip_$OutName.png"

# checkerboard contact
$contact=[System.Drawing.Bitmap]::new($FrameW*4,$FrameH*3,$Fmt)
$cg=[System.Drawing.Graphics]::FromImage($contact)
$cl=18
for($yy=0;$yy -lt ($FrameH*3);$yy+=$cl){ for($xx=0;$xx -lt ($FrameW*4);$xx+=$cl){
  $c= if((([math]::Floor($xx/$cl))+([math]::Floor($yy/$cl))) % 2 -eq 0){[System.Drawing.Color]::FromArgb(120,120,120)}else{[System.Drawing.Color]::FromArgb(200,200,200)}
  $cg.FillRectangle((New-Object System.Drawing.SolidBrush $c),$xx,$yy,$cl,$cl)
}}
$strip2=[System.Drawing.Bitmap]::FromFile("$outDir\_strip_$OutName.png")
for($i=0;$i -lt 12;$i++){ $dx=[int](($i%4)*$FrameW); $dy=[int]([math]::Floor($i/4)*$FrameH); $sx=[int]($i*$FrameW)
  $cg.DrawImage($strip2,(New-Object System.Drawing.Rectangle($dx,$dy,$FrameW,$FrameH)),(New-Object System.Drawing.Rectangle($sx,0,$FrameW,$FrameH)),[System.Drawing.GraphicsUnit]::Pixel) }
$strip2.Dispose(); $cg.Dispose()
$contact.Save("$outDir\_contact_$OutName.png",[System.Drawing.Imaging.ImageFormat]::Png); $contact.Dispose()
Write-Host "wrote _contact_$OutName.png"
