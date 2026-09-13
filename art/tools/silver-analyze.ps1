param(
  [Parameter(Mandatory=$true)][string]$Img,
  [Parameter(Mandatory=$false)][int]$WhiteT = 248,
  [Parameter(Mandatory=$false)][int]$MinArea = 3000
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$refs=@([System.Drawing.Bitmap].Assembly.Location)
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class FigCut {
    public class Result {
        public byte[] Pixels;
        public int W, H, Stride;
        public List<int[]> Boxes = new List<int[]>();
    }
    public static Result Run(Bitmap bmp, int whiteT, int minArea) {
        int w = bmp.Width, h = bmp.Height;
        var rect = new Rectangle(0, 0, w, h);
        var bd = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int stride = Math.Abs(bd.Stride);
        byte[] px = new byte[stride * h];
        Marshal.Copy(bd.Scan0, px, 0, px.Length);
        bmp.UnlockBits(bd);
        for (int i = 3; i < px.Length; i += 4) px[i] = 255;
        bool[] isWhite = new bool[w * h];
        for (int y = 0; y < h; y++) {
            int rb = y * stride;
            for (int x = 0; x < w; x++) {
                int i = rb + x * 4;
                isWhite[y * w + x] = px[i] >= whiteT && px[i + 1] >= whiteT && px[i + 2] >= whiteT;
            }
        }
        bool[] bg = new bool[w * h];
        var stack = new Stack<int>();
        for (int x = 0; x < w; x++) {
            int a = x; if (isWhite[a] && !bg[a]) { bg[a] = true; stack.Push(a); }
            int b = (h - 1) * w + x; if (isWhite[b] && !bg[b]) { bg[b] = true; stack.Push(b); }
        }
        for (int y = 0; y < h; y++) {
            int a = y * w; if (isWhite[a] && !bg[a]) { bg[a] = true; stack.Push(a); }
            int b = y * w + (w - 1); if (isWhite[b] && !bg[b]) { bg[b] = true; stack.Push(b); }
        }
        while (stack.Count > 0) {
            int p = stack.Pop(); int cxp = p % w, cyp = p / w;
            if (cxp > 0) { int q = p - 1; if (isWhite[q] && !bg[q]) { bg[q] = true; stack.Push(q); } }
            if (cxp < w - 1) { int q = p + 1; if (isWhite[q] && !bg[q]) { bg[q] = true; stack.Push(q); } }
            if (cyp > 0) { int q = p - w; if (isWhite[q] && !bg[q]) { bg[q] = true; stack.Push(q); } }
            if (cyp < h - 1) { int q = p + w; if (isWhite[q] && !bg[q]) { bg[q] = true; stack.Push(q); } }
        }
        for (int y = 0; y < h; y++) { int rb = y * stride; for (int x = 0; x < w; x++) { if (bg[y * w + x]) px[rb + x * 4 + 3] = 0; } }
        var res = new Result(); res.Pixels = px; res.W = w; res.H = h; res.Stride = stride;
        bool[] seen = new bool[w * h];
        var st2 = new Stack<int>();
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int p = y * w + x;
                if (seen[p] || bg[p]) continue;
                int minX = x, maxX = x, minY = y, maxY = y; long area = 0;
                seen[p] = true; st2.Push(p);
                while (st2.Count > 0) {
                    int c = st2.Pop(); int cx = c % w, cy = c / w; area++;
                    if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
                    for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
                        if (dx == 0 && dy == 0) continue;
                        int nx = cx + dx, ny = cy + dy;
                        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                        int q = ny * w + nx;
                        if (seen[q] || bg[q]) continue;
                        seen[q] = true; st2.Push(q);
                    }
                }
                res.Boxes.Add(new int[] { minX, minY, maxX - minX + 1, maxY - minY + 1, (int)area });
            }
        }
        return res;
    }
}
'@ -ReferencedAssemblies $refs

$bmp=[System.Drawing.Bitmap]::FromFile($Img)
$r=[FigCut]::Run($bmp, $WhiteT, $MinArea)
$bmp.Dispose()
Write-Output "image: $(Split-Path $Img -Leaf)  $($r.W)x$($r.H)  components(area>=$MinArea): $($r.Boxes.Count)"
$sorted = $r.Boxes | Sort-Object { -$_[4] }
$i=0
foreach($b in $sorted){
  Write-Output ("  #{0,2}  x={1,4} y={2,4} w={3,3} h={4,4} area={5,8}  cx={6,4} cy={7,4}" -f $i,$b[0],$b[1],$b[2],$b[3],$b[4],($b[0]+$b[2]/2),($b[1]+$b[3]/2))
  $i++
}
