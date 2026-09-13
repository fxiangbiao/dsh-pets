$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$ts=Get-Content 'D:\ALAN\Codes\dsh-pets\plugin\src\client\arts\sprite-data.ts' -Raw
$names=@('whale','robot','silver-moon')
$b64s=@{}
foreach($n in $names){
  $m=[regex]::Match($ts,"'$n': \{ url: 'data:image/png;base64,([^']+)'")
  if($m.Success){ $b64s[$n]=$m.Groups[1].Value } else { "MISSING $n" }
}
$cw=150;$ch=126
$contact=[System.Drawing.Bitmap]::new($cw*12,$ch*$names.Count)
$cg=[System.Drawing.Graphics]::FromImage($contact)
$cell=24
for($yy=0;$yy -lt ($ch*$names.Count);$yy+=$cell){ for($xx=0;$xx -lt ($cw*12);$xx+=$cell){
  $c= if((($xx/$cell)+($yy/$cell)) % 2 -eq 0){[System.Drawing.Color]::Gray}else{[System.Drawing.Color]::FromArgb(168,168,168)}
  $cg.FillRectangle((New-Object System.Drawing.SolidBrush $c),$xx,$yy,$cell,$cell)
}}
$rowIdx=0
foreach($n in $names){
  $sb=[System.Convert]::FromBase64String($b64s[$n])
  $ms=New-Object System.IO.MemoryStream(,$sb)
  $img=[System.Drawing.Bitmap]::new($ms)
  for($i=0;$i -lt 12;$i++){ $dx=[int]($i*$cw); $dy=[int]($rowIdx*$ch); $sx=[int]($i*$cw)
    $cg.DrawImage($img,(New-Object System.Drawing.Rectangle($dx,$dy,$cw,$ch)),(New-Object System.Drawing.Rectangle($sx,0,$cw,$ch)),[System.Drawing.GraphicsUnit]::Pixel) }
  $img.Dispose(); $ms.Dispose()
  $rowIdx++
}
$cg.Dispose()
$contact.Save('D:\ALAN\Codes\dsh-pets\_alpha_verify.png',[System.Drawing.Imaging.ImageFormat]::Png)
$contact.Dispose()
"wrote _alpha_verify.png ; rows: whale,robot,silver-moon"