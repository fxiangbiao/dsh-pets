param([Parameter(Mandatory=$true)][string]$SrcPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$outDir='D:\ALAN\Codes\dsh-pets'

function Test-NearWhite([System.Drawing.Color]$c){
  $mx=[Math]::Max($c.R,[Math]::Max($c.G,$c.B)); $mn=[Math]::Min($c.R,[Math]::Min($c.G,$c.B))
  $lum=0.299*$c.R+0.587*$c.G+0.114*$c.B
  return (($lum -gt 195) -and (($mx-$mn) -lt 26))
}

function Remove-BgNearWhite([System.Drawing.Bitmap]$bmp,[double]$minAreaFrac){
  $w=$bmp.Width; $h=$bmp.Height; $N=$w*$h
  $col=[System.Drawing.Color[]]::new($N)
  for($y=0;$y -lt $h;$y++){ $row=$y*$w; for($x=0;$x -lt $w;$x++){ $col[$row+$x]=$bmp.GetPixel($x,$y) } }
  $isFg=[bool[]]::new($N)
  for($i=0;$i -lt $N;$i++){ $isFg[$i] = -not (Test-NearWhite $col[$i]) }
  $bg=[bool[]]::new($N)
  $q=New-Object 'System.Collections.Generic.Queue[int]'
  for($x=0;$x -lt $w;$x++){ foreach($y in @(0,($h-1))){ $i=$y*$w+$x; if(-not $isFg[$i] -and -not $bg[$i]){ $bg[$i]=$true; $q.Enqueue($i) } } }
  for($y=0;$y -lt $h;$y++){ foreach($x in @(0,($w-1))){ $i=$y*$w+$x; if(-not $isFg[$i] -and -not $bg[$i]){ $bg[$i]=$true; $q.Enqueue($i) } } }
  while($q.Count -gt 0){
    $idx=$q.Dequeue(); $px=$idx % $w; $py=[int][math]::Floor($idx/$w)
    foreach($d in @(@(1,0),@(-1,0),@(0,1),@(0,-1))){
      $nx=$px+$d[0];$ny=$py+$d[1]
      if($nx -lt 0 -or $nx -ge $w -or $ny -lt 0 -or $ny -ge $h){continue}
      $ni=$ny*$w+$nx
      if($bg[$ni]){continue}
      if(-not $isFg[$ni]){ $bg[$ni]=$true; $q.Enqueue($ni) }
    }
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
      $idx=$q2.Dequeue(); $comp.Add($idx)
      $px=$idx % $w; $py=[int][math]::Floor($idx/$w)
      foreach($d in @(@(1,0),@(-1,0),@(0,1),@(0,-1))){
        $nx=$px+$d[0];$ny=$py+$d[1]
        if($nx -lt 0 -or $nx -ge $w -or $ny -lt 0 -or $ny -ge $h){continue}
        $ni=$ny*$w+$nx
        if($vis[$ni] -or (-not $cand[$ni])){continue}
        $vis[$ni]=$true; $q2.Enqueue($ni)
      }
    }
    if($comp.Count -ge $minArea){ foreach($c in $comp){ $keep[$c]=$true } }
  }
  $out=[System.Drawing.Bitmap]::new($w,$h,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for($i=0;$i -lt $N;$i++){
    $x=$i % $w; $y=[int][math]::Floor($i/$w)
    if($keep[$i]){ $out.SetPixel($x,$y,$col[$i]) }
    else { $out.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(0,0,0,0)) }
  }
  return $out
}

function Get-Cell([System.Drawing.Bitmap]$bmp,[int]$col,[int]$row,[double]$labelCutFrac){
  $cw=[int]($bmp.Width/4); $ch=[int]($bmp.Height/3)
  $x0=$col*$cw; $y0=$row*$ch
  $h=[int]($ch*(1-$labelCutFrac))
  $rect=New-Object System.Drawing.Rectangle($x0,$y0,$cw,$h)
  return $bmp.Clone($rect,$bmp.PixelFormat)
}

$bmp=[System.Drawing.Bitmap]::FromFile($SrcPath)
$cell=Get-Cell $bmp 0 0 0.14
Write-Host "cell0 size: $($cell.Width)x$($cell.Height)"
$trans=Remove-BgNearWhite $cell 0.004
$trans.Save("$outDir\_proto_cell0.png",[System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "wrote _proto_cell0.png"
$trans.Dispose(); $cell.Dispose(); $bmp.Dispose()
