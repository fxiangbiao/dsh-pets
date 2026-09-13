param([Parameter(Mandatory=$true)][string]$TsPath,[string]$OutDir='D:\ALAN\Codes\dsh-pets')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$Fmt=[System.Drawing.Imaging.PixelFormat]::Format32bppArgb
$txt=Get-Content $TsPath -Raw
$names=@('whale','robot','silver-moon')
foreach($n in $names){
  $m=[regex]::Match($txt,"'$n': \{ url: 'data:image/png;base64,([^']+)'")
  if(-not $m.Success){ Write-Host "no match for $n"; continue }
  $b64=$m.Groups[1].Value
  $bytes=[Convert]::FromBase64String($b64)
  $ms=New-Object System.IO.MemoryStream(,$bytes)
  $strip=[System.Drawing.Bitmap]::new($ms)
  $fw=[int]($strip.Width/12); $fh=$strip.Height
  $contact=[System.Drawing.Bitmap]::new($fw*4,$fh*3,$Fmt)
  $cg=[System.Drawing.Graphics]::FromImage($contact)
  $cl=18
  for($yy=0;$yy -lt ($fh*3);$yy+=$cl){ for($xx=0;$xx -lt ($fw*4);$xx+=$cl){
    $c= if((([math]::Floor($xx/$cl))+([math]::Floor($yy/$cl))) % 2 -eq 0){[System.Drawing.Color]::FromArgb(120,120,120)}else{[System.Drawing.Color]::FromArgb(200,200,200)}
    $cg.FillRectangle((New-Object System.Drawing.SolidBrush $c),$xx,$yy,$cl,$cl)
  }}
  for($i=0;$i -lt 12;$i++){ $dx=[int](($i%4)*$fw); $dy=[int]([math]::Floor($i/4)*$fh); $sx=[int]($i*$fw)
    $cg.DrawImage($strip,(New-Object System.Drawing.Rectangle($dx,$dy,$fw,$fh)),(New-Object System.Drawing.Rectangle($sx,0,$fw,$fh)),[System.Drawing.GraphicsUnit]::Pixel) }
  $strip.Dispose(); $ms.Dispose(); $cg.Dispose()
  $tag=$n -replace '-',''
  $contact.Save("$OutDir\_contact_$tag.png",[System.Drawing.Imaging.ImageFormat]::Png); $contact.Dispose()
  Write-Host "wrote _contact_$tag.png"
}