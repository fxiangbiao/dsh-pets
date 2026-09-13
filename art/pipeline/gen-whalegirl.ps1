param(
  [Parameter(Mandatory=$true)][string]$SourceDir,
  [Parameter(Mandatory=$true)][string]$PreviewDir,
  [Parameter(Mandatory=$false)][int]$CellW = 180,
  [Parameter(Mandatory=$false)][int]$CellH = 180
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# This script is deliberately pure ASCII: Windows PowerShell 5.1 reads a
# BOM-less script as ANSI, so any CJK path baked into it would arrive mangled.
# Sources are found by their numeric suffix instead, and the folder comes in as
# an argument (arguments are not affected by the script encoding).

# The new whale-girl art ships as flat RGB renders: a near-white background (some
# with a faint checkerboard), a soft drop shadow under the feet, and a light grey
# watermark in the bottom-right corner. Everything about the cut-out is therefore
# "what is connected to the background and light enough to be background", done
# in two passes so the watermark and the shadow go with it while the character's
# own whites (apron, frill) stay, because they sit behind the dark outline.
$csharp = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class WhaleGirl
{
    public class Frame
    {
        public Bitmap Image;
        public string Name;
        public int BoxX, BoxY, BoxW, BoxH;
        public long ClearedLoose;
        public bool BoxTouchesCorner;
    }

    const int LooseMin = 190;
    const int LooseSpread = 22;
    const int StrictMin = 236;
    const int StrictSpread = 14;
    const int AlphaFloor = 8;

    static bool IsBackground(byte[] p, int i, int min, int spread)
    {
        byte b = p[i], g = p[i + 1], r = p[i + 2];
        int lo = Math.Min(r, Math.Min(g, b));
        int hi = Math.Max(r, Math.Max(g, b));
        return lo >= min && hi - lo <= spread;
    }

    static byte[] Load(string path, out int w, out int h)
    {
        using (var src = new Bitmap(path))
        {
            w = src.Width; h = src.Height;
            using (var copy = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(copy)) g.DrawImage(src, 0, 0, w, h);
                var rect = new Rectangle(0, 0, w, h);
                var data = copy.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                var bytes = new byte[Math.Abs(data.Stride) * h];
                System.Runtime.InteropServices.Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
                copy.UnlockBits(data);
                return bytes;
            }
        }
    }

    /// Flood the background in from the border, then let a looser pass eat the
    /// shadow and the watermark that the strict pass had to stop at.
    static void CutBackground(byte[] p, int w, int h, out long loose)
    {
        int stride = w * 4;
        var stack = new Stack<int>();
        for (int x = 0; x < w; x++)
        {
            for (int k = 0; k < 2; k++)
            {
                int y = k == 0 ? 0 : h - 1;
                int i = y * stride + x * 4;
                if (p[i + 3] != 0 && IsBackground(p, i, StrictMin, StrictSpread))
                {
                    p[i + 3] = 0;
                    stack.Push(y * w + x);
                }
            }
        }
        for (int y = 0; y < h; y++)
        {
            for (int k = 0; k < 2; k++)
            {
                int x = k == 0 ? 0 : w - 1;
                int i = y * stride + x * 4;
                if (p[i + 3] != 0 && IsBackground(p, i, StrictMin, StrictSpread))
                {
                    p[i + 3] = 0;
                    stack.Push(y * w + x);
                }
            }
        }
        Spread(p, w, h, stack, StrictMin, StrictSpread);

        // Second pass: a light, neutral pixel touching the now-transparent
        // background is background too, so the shadow gradient and the watermark
        // text dissolve from the outside in and stop at the dark outline.
        loose = 0;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int i = y * stride + x * 4;
                if (p[i + 3] == 0 || !IsBackground(p, i, LooseMin, LooseSpread)) continue;
                bool touches = false;
                if (x > 0 && p[i - 4 + 3] == 0) touches = true;
                else if (x < w - 1 && p[i + 4 + 3] == 0) touches = true;
                else if (y > 0 && p[i - stride + 3] == 0) touches = true;
                else if (y < h - 1 && p[i + stride + 3] == 0) touches = true;
                if (!touches) continue;
                p[i + 3] = 0;
                stack.Push(y * w + x);
                loose++;
            }
        }
        Spread(p, w, h, stack, LooseMin, LooseSpread);
    }

    static void Spread(byte[] p, int w, int h, Stack<int> stack, int min, int spread)
    {
        int stride = w * 4;
        while (stack.Count > 0)
        {
            int at = stack.Pop();
            int x = at % w, y = at / w;
            for (int k = 0; k < 4; k++)
            {
                int nx = x + (k == 0 ? -1 : k == 1 ? 1 : 0);
                int ny = y + (k == 2 ? -1 : k == 3 ? 1 : 0);
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                int i = ny * stride + nx * 4;
                if (p[i + 3] == 0 || !IsBackground(p, i, min, spread)) continue;
                p[i + 3] = 0;
                stack.Push(ny * w + nx);
            }
        }
    }

    static void Bounds(byte[] p, int w, int h, out int x0, out int y0, out int x1, out int y1)
    {
        int stride = w * 4;
        x0 = w; y0 = h; x1 = -1; y1 = -1;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                if (p[y * stride + x * 4 + 3] <= AlphaFloor) continue;
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }

    public static Frame Prepare(string path, string name)
    {
        int w, h;
        var p = Load(path, out w, out h);
        long loose;
        CutBackground(p, w, h, out loose);
        int x0, y0, x1, y1;
        Bounds(p, w, h, out x0, out y0, out x1, out y1);
        if (x1 < 0) throw new InvalidOperationException("nothing left after cut-out: " + path);
        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        var rect = new Rectangle(0, 0, w, h);
        var data = bmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        System.Runtime.InteropServices.Marshal.Copy(p, 0, data.Scan0, p.Length);
        bmp.UnlockBits(data);
        return new Frame
        {
            Image = bmp,
            Name = name,
            BoxX = x0,
            BoxY = y0,
            BoxW = x1 - x0 + 1,
            BoxH = y1 - y0 + 1,
            ClearedLoose = loose,
            BoxTouchesCorner = (x1 > w - 520) && (y1 > h - 220)
        };
    }

    /// One frame drawn into a grid cell: scaled to fit, centred across, anchored
    /// to the bottom so every pose shares a baseline.
    static void DrawInto(Graphics g, Frame f, int cellW, int cellH, int col, int row)
    {
        double scale = Math.Min((double)cellW / f.BoxW, (double)cellH / f.BoxH);
        int rw = Math.Max(1, (int)Math.Round(f.BoxW * scale));
        int rh = Math.Max(1, (int)Math.Round(f.BoxH * scale));
        int dx = col * cellW + (cellW - rw) / 2;
        int dy = row * cellH + cellH - rh;
        g.DrawImage(f.Image, new Rectangle(dx, dy, rw, rh),
            new Rectangle(f.BoxX, f.BoxY, f.BoxW, f.BoxH), GraphicsUnit.Pixel);
    }

    /// Opaque pixels left inside the watermark's corner after the cut-out. Zero
    /// means the watermark is gone; anything else means it survived.
    public static long CornerLeftovers(Frame f)
    {
        var bmp = f.Image;
        int x0 = Math.Max(0, bmp.Width - 520);
        int y0 = Math.Max(0, bmp.Height - 220);
        var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
        var data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var bytes = new byte[Math.Abs(data.Stride) * bmp.Height];
        System.Runtime.InteropServices.Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
        bmp.UnlockBits(data);
        long left = 0;
        for (int y = y0; y < bmp.Height; y++)
        {
            for (int x = x0; x < bmp.Width; x++)
            {
                if (bytes[y * Math.Abs(data.Stride) + x * 4 + 3] > AlphaFloor) left++;
            }
        }
        return left;
    }

    public static byte[] Compose(List<Frame> frames, int cellW, int cellH)
    {
        using (var strip = new Bitmap(cellW * frames.Count, cellH, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(strip))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.Clear(Color.Transparent);
                for (int i = 0; i < frames.Count; i++) DrawInto(g, frames[i], cellW, cellH, i, 0);
            }
            using (var ms = new MemoryStream())
            {
                strip.Save(ms, ImageFormat.Png);
                return ms.ToArray();
            }
        }
    }

    /// Contact sheet of the composed cells, on a light background, for review.
    public static void WriteContact(List<Frame> frames, int cellW, int cellH, int cols, string path)
    {
        int rows = (frames.Count + cols - 1) / cols;
        using (var sheet = new Bitmap(cols * cellW, rows * cellH, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(sheet))
            {
                g.Clear(Color.FromArgb(255, 246, 247, 250));
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                for (int i = 0; i < frames.Count; i++) DrawInto(g, frames[i], cellW, cellH, i % cols, i / cols);
                using (var pen = new Pen(Color.FromArgb(70, 120, 120, 130)))
                {
                    for (int i = 0; i < frames.Count; i++)
                    {
                        g.DrawRectangle(pen, (i % cols) * cellW, (i / cols) * cellH, cellW - 1, cellH - 1);
                    }
                }
            }
            sheet.Save(path, ImageFormat.Png);
        }
    }
}
'@

Add-Type -TypeDefinition $csharp -ReferencedAssemblies System.Drawing

# Slot order is the strip's frame order, and the pose table reads specific slots,
# so each source is picked for what its pose has to mean:
#   1 happy, 2 confused, 3 cheer, 4 calm (idle A), 5 working, 6 talking,
#   7 waving, 8 cheek (idle B), 9 jump, 10 resting, 11 crying, 12 cheek again
#   (there are eleven distinct renders and the talent show walks all twelve).
$sources = Get-ChildItem -Path $SourceDir -Filter '*.png' -File
$byNumber = @{}
$sitting = $null
foreach ($file in $sources) {
  if ($file.BaseName -match '-(\d+)$') { $byNumber[[int]$Matches[1]] = $file.FullName }
  elseif ($sitting -eq $null) { $sitting = $file.FullName }
}
if ($sitting -eq $null) { throw "no un-numbered (sitting) render found in $SourceDir" }

$plan = New-Object System.Collections.ArrayList
$add = {
  param($slot, $number, $what)
  if ($number -eq 0) { $path = $sitting } else { $path = $byNumber[$number] }
  if ($path -eq $null) { throw "source #$number not found in $SourceDir" }
  [void]$plan.Add([pscustomobject]@{ Slot = $slot; Path = $path; What = $what; Name = [System.IO.Path]::GetFileName($path) })
}
& $add 1  3  'happy: hands clasped, bright smile'
& $add 2  8  'confused: hands at mouth'
& $add 3  9  'cheer: fist raised'
& $add 4  11 'calm standing (idle A)'
& $add 5  4  'working: holo panel'
& $add 6  6  'talking: glowing bowl'
& $add 7  7  'waving'
& $add 8  2  'cheek (idle B)'
& $add 9  5  'jump: arms up'
& $add 10 0  'resting: sitting'
& $add 11 10 'crying'
& $add 12 2  'cheek again (frame 12)'

$frames = New-Object 'System.Collections.Generic.List[WhaleGirl+Frame]'
foreach ($entry in ($plan | Sort-Object Slot)) {
  $frame = [WhaleGirl]::Prepare($entry.Path, $entry.Name)
  $frames.Add($frame)
  $left = [WhaleGirl]::CornerLeftovers($frame)
  $warn = ''
  if ($left -gt 0) { $warn = "  <-- $left watermark pixels survived" }
  Write-Host ("  slot {0,2}  {1,-30} box {2,4}x{3,-4} at {4},{5}  loose {6}{7}" -f `
    $entry.Slot, $entry.What, $frame.BoxW, $frame.BoxH, $frame.BoxX, $frame.BoxY, $frame.ClearedLoose, $warn)
}

$png = [WhaleGirl]::Compose($frames, $CellW, $CellH)
[WhaleGirl]::WriteContact($frames, $CellW, $CellH, 6, (Join-Path $PreviewDir 'whalegirl-frames.png'))
$stripPath = Join-Path $PreviewDir 'whalegirl-strip.png'
$img = [System.Drawing.Image]::FromStream([System.IO.MemoryStream]::new($png))
$flat = New-Object System.Drawing.Bitmap($img.Width, $img.Height)
$fg = [System.Drawing.Graphics]::FromImage($flat)
$fg.Clear([System.Drawing.Color]::FromArgb(255, 26, 30, 38))
$fg.DrawImage($img, 0, 0, $img.Width, $img.Height)
$fg.Dispose(); $flat.Save($stripPath, [System.Drawing.Imaging.ImageFormat]::Png); $flat.Dispose(); $img.Dispose()

$b64 = [Convert]::ToBase64String($png)
[pscustomobject]@{ Url = "data:image/png;base64,$b64"; FrameWidth = $CellW; FrameHeight = $CellH; FrameCount = $frames.Count } |
  ConvertTo-Json -Compress | Set-Content -Path (Join-Path $PreviewDir 'whalegirl.json') -Encoding ascii

Write-Host ''
Write-Host "strip:  $CellW x $CellH x $($frames.Count) frames  (png $($png.Length) bytes, base64 $($b64.Length) chars)"
Write-Host "wrote:  $stripPath"
Write-Host "wrote:  $(Join-Path $PreviewDir 'whalegirl-frames.png')"
Write-Host "wrote:  $(Join-Path $PreviewDir 'whalegirl.json')"
