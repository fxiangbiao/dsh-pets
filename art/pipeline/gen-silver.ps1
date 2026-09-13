param(
  [Parameter(Mandatory=$true)][string]$Img1,
  [Parameter(Mandatory=$true)][string]$Img2,
  [Parameter(Mandatory=$true)][string]$OutTs,
  [Parameter(Mandatory=$false)][string]$PreviewDir = '',
  [Parameter(Mandatory=$false)][string]$CleanDir = ''
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

public static class FigCut5 {
    public class Result {
        public byte[] Pixels; public int[] Labels; public int W, H, Stride;
        public List<int[]> Boxes = new List<int[]>();   // x,y,w,h,area,id
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
        var res=new Result(); res.Pixels=px; res.W=w; res.H=h; res.Stride=stride;
        int[] labels=new int[w*h];
        bool[] seen=new bool[w*h]; var s2=new Stack<int>(); int id=0;
        for(int y=0;y<h;y++){ for(int x=0;x<w;x++){ int p=y*w+x; if(seen[p]||bg[p]) continue;
            id++;
            int minX=x,maxX=x,minY=y,maxY=y; long area=0; seen[p]=true; s2.Push(p); labels[p]=id;
            while(s2.Count>0){ int c=s2.Pop(); int cx=c%w, cy=c/w; area++;
                if(cx<minX)minX=cx; if(cx>maxX)maxX=cx; if(cy<minY)minY=cy; if(cy>maxY)maxY=cy;
                for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){ if(dx==0&&dy==0)continue; int nx=cx+dx, ny=cy+dy;
                    if(nx<0||nx>=w||ny<0||ny>=h)continue; int q=ny*w+nx; if(seen[q]||bg[q])continue; seen[q]=true; labels[q]=id; s2.Push(q); } }
            if(area>=minArea) res.Boxes.Add(new int[]{minX,minY,maxX-minX+1,maxY-minY+1,(int)area,id}); } }
        res.Labels=labels;
        return res;
    }
    // Return a copy where every pixel NOT belonging to a kept component is transparent.
    public static byte[] Masked(byte[] px, int w, int h, int stride, int[] labels, bool[] keep) {
        byte[] outPx = (byte[])px.Clone();
        for (int y=0;y<h;y++){ int rb=y*stride; int lb=y*w;
            for (int x=0;x<w;x++){ int lab=labels[lb+x];
                if(lab<=0 || lab>=keep.Length || !keep[lab]) outPx[rb+x*4+3]=0; } }
        return outPx;
    }
    public static byte[] Bgra(byte[] px, int w, int h, int stride, int[] labels, bool[] keep) {
        return Masked(px, w, h, stride, labels, keep);
    }
    // Zero every connected blob smaller than minArea: kills stray text edges / specks
    // that survive the cut and would otherwise float beside the character.
    public static byte[] DropSmall(byte[] px, int w, int h, int stride, int minArea) {
        byte[] outPx = (byte[])px.Clone();
        bool[] fg = new bool[w*h];
        for (int y=0;y<h;y++){ int rb=y*stride; for(int x=0;x<w;x++) fg[y*w+x]=outPx[rb+x*4+3]>8; }
        bool[] seen=new bool[w*h]; var st=new Stack<int>();
        for(int y=0;y<h;y++){ for(int x=0;x<w;x++){ int p=y*w+x; if(seen[p]||!fg[p]) continue;
            var members=new List<int>(); seen[p]=true; st.Push(p);
            while(st.Count>0){ int c=st.Pop(); int cx=c%w, cy=c/w; members.Add(c);
                for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){ if(dx==0&&dy==0)continue; int nx=cx+dx, ny=cy+dy;
                    if(nx<0||nx>=w||ny<0||ny>=h)continue; int q=ny*w+nx; if(seen[q]||!fg[q])continue; seen[q]=true; st.Push(q); } }
            if(members.Count<minArea){ foreach(int c in members){ int cx=c%w, cy=c/w; outPx[cy*stride+cx*4+3]=0; } } } }
        return outPx;
    }
}
'@

function To-Bitmap($px,$w,$h,$stride){
  $bmp=[System.Drawing.Bitmap]::new($w,$h,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bd=$bmp.LockBits((New-Object System.Drawing.Rectangle -ArgumentList @(0,0,$w,$h)),[System.Drawing.Imaging.ImageLockMode]::WriteOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  [System.Runtime.InteropServices.Marshal]::Copy($px,0,$bd.Scan0,$px.Length)
  $bmp.UnlockBits($bd)
  return $bmp
}

# Cut out figures; returns the run result plus reading-ordered boxes.
# Figures overlapping the bottom-right watermark zone are dropped outright: the
# "豆包AI生成" stamp is painted ON the pillow there, so it is fused into that
# figure's pixels and cannot be separated. That duplicate sleeping pose is unused.
function Load-Sheet([string]$path){
  $src=[System.Drawing.Bitmap]::FromFile($path)
  $r=[FigCut5]::Run($src, 248, 50000)
  $src.Dispose()
  $sorted = $r.Boxes | Sort-Object @{E={[int](($_[1]+$_[3]/2)/500)}}, @{E={$_[0]+$_[2]/2}}
  $kept = $sorted | Where-Object { -not (($_[0]+$_[2]) -gt 1400 -and ($_[1]+$_[3]) -gt 2100) }
  return [pscustomobject]@{R=$r; Boxes=$kept}
}

Write-Host 'cutting image 1...'
$sheetA=Load-Sheet $Img1
Write-Host "  figures: $($sheetA.Boxes.Count)"
Write-Host 'cutting image 2...'
$sheetB=Load-Sheet $Img2
Write-Host "  figures: $($sheetB.Boxes.Count)"

# Keep ONLY the figure components themselves: every text edge, watermark speck and
# JPEG noise blob is a different component and is therefore dropped.
function Keep-Set($sheet){
  $keep=New-Object bool[] ($sheet.R.Labels.Length + 1)
  foreach($bx in $sheet.Boxes){ $keep[$bx[5]]=$true }
  return $keep
}
$keepA=Keep-Set $sheetA
$keepB=Keep-Set $sheetB
$maskedA=New-Object byte[] $sheetA.R.Pixels.Length
$maskedB=New-Object byte[] $sheetB.R.Pixels.Length
$maskedA=[FigCut5]::Masked($sheetA.R.Pixels,$sheetA.R.W,$sheetA.R.H,$sheetA.R.Stride,$sheetA.R.Labels,$keepA)
$maskedB=[FigCut5]::Masked($sheetB.R.Pixels,$sheetB.R.W,$sheetB.R.H,$sheetB.R.Stride,$sheetB.R.Labels,$keepB)
$cleanA=To-Bitmap $maskedA $sheetA.R.W $sheetA.R.H $sheetA.R.Stride
$cleanB=To-Bitmap $maskedB $sheetB.R.W $sheetB.R.H $sheetB.R.Stride

if($CleanDir -ne ''){
  New-Item -ItemType Directory -Force -Path $CleanDir | Out-Null
  $cleanA.Save((Join-Path $CleanDir 'silver-actions-1-clean.png'),[System.Drawing.Imaging.ImageFormat]::Png)
  $cleanB.Save((Join-Path $CleanDir 'silver-actions-2-clean.png'),[System.Drawing.Imaging.ImageFormat]::Png)
  Write-Host "wrote cleaned source sheets to $CleanDir"
}

# Chosen figures: @(sheet;reading-order index) -> 12 full-body silver frames.
$sel=@(
  @{s=2;i=3},   # 0 calm standing            -> idle
  @{s=2;i=0},   # 1 both arms up cheer       -> happy
  @{s=2;i=4},   # 2 holding a heart          -> cute
  @{s=2;i=7},   # 3 talking, mouth open      -> working
  @{s=2;i=6},   # 4 holding teddy bear       -> thinking
  @{s=2;i=5},   # 5 shy, hands near face     -> listen
  @{s=2;i=2},   # 6 tired, half-lidded       -> confused
  @{s=2;i=8},   # 7 asleep on pillow         -> sleepy
  @{s=1;i=4},   # 8 mouth open, hand to chest-> frustrated
  @{s=1;i=11},  # 9 holding a lantern
  @{s=1;i=0},   # 10 big open smile standing
  @{s=1;i=3}    # 11 calm, eyes closed
)

$FW=180; $FH=180; $N=$sel.Count
$strip=[System.Drawing.Bitmap]::new($FW*$N,$FH,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gfx=[System.Drawing.Graphics]::FromImage($strip)
$gfx.Clear([System.Drawing.Color]::Transparent)
$gfx.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
for($k=0;$k -lt $N;$k++){
  $e=$sel[$k]
  if($e.s -eq 1){ $sheet=$sheetA; $clean=$cleanA } else { $sheet=$sheetB; $clean=$cleanB }
  $bx=$sheet.Boxes[$e.i]
  if($null -eq $bx){ throw "missing figure sheet=$($e.s) idx=$($e.i)" }
  $sw=$bx[2]; $sh=$bx[3]
  $scale=[Math]::Min($FW/$sw,$FH/$sh)
  $rw=[int]($sw*$scale); $rh=[int]($sh*$scale)
  $dx=[int]($k*$FW + ($FW-$rw)/2)
  $dy=[int]($FH-$rh)   # bottom-anchor so every pose stands on the same baseline
  $gfx.DrawImage($clean,(New-Object System.Drawing.Rectangle -ArgumentList @($dx,$dy,$rw,$rh)),(New-Object System.Drawing.Rectangle -ArgumentList @($bx[0],$bx[1],$sw,$sh)),[System.Drawing.GraphicsUnit]::Pixel)
}
$gfx.Dispose()
# Final pass: drop any small detached blob (text edges, specks) from the strip.
$SW=$FW*$N; $SH=$FH
$sbd=$strip.LockBits((New-Object System.Drawing.Rectangle -ArgumentList @(0,0,$SW,$SH)),[System.Drawing.Imaging.ImageLockMode]::ReadOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$sStride=[Math]::Abs($sbd.Stride)
$sPx=New-Object byte[] ($sStride*$SH)
[System.Runtime.InteropServices.Marshal]::Copy($sbd.Scan0,$sPx,0,$sPx.Length)
$strip.UnlockBits($sbd)
$sPx=[FigCut5]::DropSmall($sPx,$SW,$SH,$sStride,1500)
$sbd2=$strip.LockBits((New-Object System.Drawing.Rectangle -ArgumentList @(0,0,$SW,$SH)),[System.Drawing.Imaging.ImageLockMode]::WriteOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
[System.Runtime.InteropServices.Marshal]::Copy($sPx,0,$sbd2.Scan0,$sPx.Length)
$strip.UnlockBits($sbd2)
$ms=New-Object System.IO.MemoryStream
$strip.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); $strip.Dispose()
$pngBytes=$ms.ToArray(); $ms.Dispose()
$b64=[Convert]::ToBase64String($pngBytes)
Write-Host "silver strip b64 len: $($b64.Length)"

if($PreviewDir -ne ''){
  $sc=0.5; $pw=[int]($FW*$N*$sc); $ph=[int]($FH*$sc)
  $pv=New-Object System.Drawing.Bitmap -ArgumentList @($pw,$ph)
  $pg=[System.Drawing.Graphics]::FromImage($pv); $pg.Clear([System.Drawing.Color]::White)
  $img=[System.Drawing.Image]::FromStream([System.IO.MemoryStream]::new($pngBytes))
  $pg.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $pg.DrawImage($img,0,0,$pw,$ph); $pg.Dispose(); $img.Dispose()
  $pv.Save((Join-Path $PreviewDir 'silver-strip.png'),[System.Drawing.Imaging.ImageFormat]::Png); $pv.Dispose()
}
$cleanA.Dispose(); $cleanB.Dispose()

# Splice the new silver entry into sprite-data.ts, keeping whale and robot intact.
$raw=[System.IO.File]::ReadAllText($OutTs)
$entry="  'silver-moon': { url: 'data:image/png;base64,$b64', frameWidth: $FW, frameHeight: $FH, frameCount: $N },"
$rx=[regex]"(?m)^\s*'silver-moon':.*$"
if(-not $rx.IsMatch($raw)){ throw 'silver-moon entry not found in sprite-data.ts' }
$new=$rx.Replace($raw, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $entry })
[System.IO.File]::WriteAllText($OutTs,$new,(New-Object System.Text.UTF8Encoding($false)))
Write-Host "updated $OutTs"
