param(
  [Parameter(Mandatory=$true)][string]$Img,
  [Parameter(Mandatory=$true)][string]$OutPng,
  [Parameter(Mandatory=$false)][int]$MinArea = 50000,
  [Parameter(Mandatory=$false)][int]$Tag = 0
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$refs=@([System.Drawing.Bitmap].Assembly.Location)
Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class FigCut2 {
    public class Result {
        public byte[] Pixels; public int W, H, Stride;
        public List<int[]> Boxes = new List<int[]>();
    }
    public static Result Run(Bitmap bmp, int whiteT, int minArea) {
        int w = bmp.Width, h = bmp.Height;
        var bd = bmp.LockBits(new Rectangle(0,0,w,h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int stride = Math.Abs(bd.Stride);
        byte[] px = new byte[stride*h];
        Marshal.Copy(bd.Scan0, px, 0, px.Length);
        bmp.UnlockBits(bd);
        for (int i=3;i<px.Length;i+=4) px[i]=255;
        bool[] isWhite = new bool[w*h];
        for (int y=0;y<h;y++){ int rb=y*stride; for(int x=0;x<w;x++){ int i=rb+x*4; isWhite[y*w+x]=px[i]>=whiteT&&px[i+1]>=whiteT&&px[i+2]>=whiteT; } }
        bool[] bg = new bool[w*h];
        var st = new Stack<int>();
        for (int x=0;x<w;x++){ int a=x; if(isWhite[a]&&!bg[a]){bg[a]=true;st.Push(a);} int b=(h-1)*w+x; if(isWhite[b]&&!bg[b]){bg[b]=true;st.Push(b);} }
        for (int y=0;y<h;y++){ int a=y*w; if(isWhite[a]&&!bg[a]){bg[a]=true;st.Push(a);} int b=y*w+(w-1); if(isWhite[b]&&!bg[b]){bg[b]=true;st.Push(b);} }
        while(st.Count>0){ int p=st.Pop(); int cx=p%w, cy=p/w;
            if(cx>0){int q=p-1; if(isWhite[q]&&!bg[q]){bg[q]=true;st.Push(q);}}
            if(cx<w-1){int q=p+1; if(isWhite[q]&&!bg[q]){bg[q]=true;st.Push(q);}}
            if(cy>0){int q=p-w; if(isWhite[q]&&!bg[q]){bg[q]=true;st.Push(q);}}
            if(cy<h-1){int q=p+w; if(isWhite[q]&&!bg[q]){bg[q]=true;st.Push(q);}} }
        for (int y=0;y<h;y++){ int rb=y*stride; for(int x=0;x<w;x++){ if(bg[y*w+x]) px[rb+x*4+3]=0; } }
        var res=new Result(); res.Pixels=px; res.W=w; res.H=h; res.Stride=stride;
        bool[] seen=new bool[w*h]; var s2=new Stack<int>();
        for(int y=0;y<h;y++){ for(int x=0;x<w;x++){ int p=y*w+x; if(seen[p]||bg[p]) continue;
            int minX=x,maxX=x,minY=y,maxY=y; long area=0; seen[p]=true; s2.Push(p);
            while(s2.Count>0){ int c=s2.Pop(); int cx=c%w, cy=c/w; area++;
                if(cx<minX)minX=cx; if(cx>maxX)maxX=cx; if(cy<minY)minY=cy; if(cy>maxY)maxY=cy;
                for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){ if(dx==0&&dy==0)continue; int nx=cx+dx, ny=cy+dy;
                    if(nx<0||nx>=w||ny<0||ny>=h)continue; int q=ny*w+nx; if(seen[q]||bg[q])continue; seen[q]=true; s2.Push(q); } }
            if(area>=minArea) res.Boxes.Add(new int[]{minX,minY,maxX-minX+1,maxY-minY+1,(int)area}); } }
        return res;
    }
}
'@

function Read-Clean([string]$path){
  $bmp=[System.Drawing.Bitmap]::FromFile($path)
  $r=[FigCut2]::Run($bmp, 248, $MinArea)
  $bmp.Dispose()
  $clean=[System.Drawing.Bitmap]::new($r.W,$r.H,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bd=$clean.LockBits((New-Object System.Drawing.Rectangle(0,0,$r.W,$r.H)),[System.Drawing.Imaging.ImageLockMode]::WriteOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  [System.Runtime.InteropServices.Marshal]::Copy($r.Pixels,0,$bd.Scan0,$r.Pixels.Length)
  $clean.UnlockBits($bd)
  # reading order: band by cy/500 then cx
  $boxes = $r.Boxes | Sort-Object @{E={[int](($_[1]+$_[3]/2)/500)}}, @{E={$_[0]+$_[2]/2}}
  return [pscustomobject]@{Bmp=$clean; Boxes=$boxes}
}

$res=Read-Clean $Img
$n=$res.Boxes.Count
Write-Output "$(Split-Path $Img -Leaf): $n figures"
# contact sheet: cell 260x360, 5 per row, label with global index
$cellW=260; $cellH=380; $perRow=5
$rows=[int][Math]::Ceiling($n/$perRow)
$sheet=[System.Drawing.Bitmap]::new($cellW*$perRow, $cellH*$rows)
$g=[System.Drawing.Graphics]::FromImage($sheet)
$g.Clear([System.Drawing.Color]::White)
$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$font=New-Object System.Drawing.Font('Consolas',18,[System.Drawing.FontStyle]::Bold)
$brush=[System.Drawing.Brushes]::Red
for($i=0;$i -lt $n;$i++){
  $b=$res.Boxes[$i]
  $sc=[Math]::Min(($cellW-10)/$b[2], ($cellH-40)/$b[3])
  $dw=[int]($b[2]*$sc); $dh=[int]($b[3]*$sc)
  $col=$i%$perRow; $row=[int][Math]::Floor($i/$perRow)
  $cx=$col*$cellW + [int](($cellW-$dw)/2)
  $cy=$row*$cellH + 30 + [int](($cellH-40-$dh)/2)
  $g.DrawImage($res.Bmp,(New-Object System.Drawing.Rectangle($cx,$cy,$dw,$dh)),(New-Object System.Drawing.Rectangle($b[0],$b[1],$b[2],$b[3])),[System.Drawing.GraphicsUnit]::Pixel)
  $label = if($Tag -gt 0){ "img$Tag#$i" } else { "#$i" }
  $g.DrawString($label, $font, $brush, ($col*$cellW+6), ($row*$cellH+4))
}
$g.Dispose()
$sheet.Save($OutPng,[System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose(); $res.Bmp.Dispose()
Write-Output "wrote $OutPng"
