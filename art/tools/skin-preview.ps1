param(
  [Parameter(Mandatory=$true)][string]$SpriteData,
  [Parameter(Mandatory=$true)][string]$OutPng,
  [Parameter(Mandatory=$false)][string]$Avatar = 'silver-moon',
  [switch]$FilterOnly
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$refs=@([System.Drawing.Bitmap].Assembly.Location)
Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

public static class SkinFx {
    static float[][] Identity() {
        return new float[][] {
            new float[]{1,0,0,0,0}, new float[]{0,1,0,0,0}, new float[]{0,0,1,0,0},
            new float[]{0,0,0,1,0}, new float[]{0,0,0,0,1}
        };
    }
    static float[][] Mul(float[][] a, float[][] b) {
        var c = new float[5][];
        for (int i = 0; i < 5; i++) {
            c[i] = new float[5];
            for (int j = 0; j < 5; j++) {
                float sum = 0;
                for (int k = 0; k < 5; k++) sum += a[i][k] * b[k][j];
                c[i][j] = sum;
            }
        }
        return c;
    }
    static float[][] Saturate(float s) {
        float lr = 0.2126f, lg = 0.7152f, lb = 0.0722f;
        float sr = (1 - s) * lr, sg = (1 - s) * lg, sb = (1 - s) * lb;
        return new float[][] {
            new float[]{ sr + s, sg, sb, 0, 0 },
            new float[]{ sr, sg + s, sb, 0, 0 },
            new float[]{ sr, sg, sb + s, 0, 0 },
            new float[]{ 0, 0, 0, 1, 0 },
            new float[]{ 0, 0, 0, 0, 1 }
        };
    }
    static float[][] Bright(float b) {
        var m = Identity(); m[0][0] = b; m[1][1] = b; m[2][2] = b; return m;
    }
    static float[][] Hue(float deg) {
        double r = deg * Math.PI / 180.0; float c = (float)Math.Cos(r), s = (float)Math.Sin(r);
        return new float[][] {
            new float[]{ 0.213f + c*0.787f - s*0.213f, 0.715f - c*0.715f - s*0.715f, 0.072f - c*0.072f + s*0.928f, 0, 0 },
            new float[]{ 0.213f - c*0.213f + s*0.143f, 0.715f + c*0.285f + s*0.140f, 0.072f - c*0.072f - s*0.283f, 0, 0 },
            new float[]{ 0.213f - c*0.213f - s*0.787f, 0.715f - c*0.715f + s*0.715f, 0.072f + c*0.928f + s*0.072f, 0, 0 },
            new float[]{ 0, 0, 0, 1, 0 },
            new float[]{ 0, 0, 0, 0, 1 }
        };
    }
    // .NET's ColorMatrix indexes rows by INPUT channel and columns by OUTPUT, i.e.
    // the transpose of the (output,input) form used above. Transpose the 4x4 colour
    // block and keep the 5th row (translation) where it is.
    static float[][] Fix(float[][] m) {
        var n = new float[5][];
        for (int i = 0; i < 5; i++) n[i] = new float[5];
        for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) n[i][j] = m[j][i];
        for (int j = 0; j < 4; j++) n[4][j] = m[4][j];
        n[4][4] = 1f;
        return n;
    }
    static Bitmap Draw(Bitmap src, float[][] m) {
        var dst = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(dst)) {
            var ia = new ImageAttributes();
            ia.SetColorMatrix(new ColorMatrix(Fix(m)));
            g.DrawImage(src, new Rectangle(0, 0, src.Width, src.Height), 0, 0, src.Width, src.Height, GraphicsUnit.Pixel, ia);
        }
        return dst;
    }
    // Coloured silhouette (alpha preserved, rgb replaced) used for the rim light.
    static Bitmap Silhouette(Bitmap src, Color color, float alpha) {
        var m = new float[][] {
            new float[]{0,0,0,0,0}, new float[]{0,0,0,0,0}, new float[]{0,0,0,0,0},
            new float[]{0,0,0,alpha,0},
            new float[]{ color.R/255f, color.G/255f, color.B/255f, 0, 1 }
        };
        var dst = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(dst)) {
            var ia = new ImageAttributes();
            ia.SetColorMatrix(new ColorMatrix(Fix(m)));
            g.DrawImage(src, new Rectangle(0,0,src.Width,src.Height), 0,0,src.Width,src.Height, GraphicsUnit.Pixel, ia);
        }
        return dst;
    }
    public static Bitmap Render(Bitmap src, float sat, float bri, float hue,
        int rimA, int rimR, int rimG, int rimB,
        int glowA, int glowR, int glowG, int glowB, int pad) {
        int w = src.Width, h = src.Height;
        var canvas = new Bitmap(w + pad*2, h + pad*2, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(canvas)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            // aura
            if (glowA > 0) {
                var glow = Color.FromArgb(glowA, glowR, glowG, glowB);
                int d = Math.Min(canvas.Width, canvas.Height);
                var rect = new Rectangle((canvas.Width-d)/2, (canvas.Height-d)/2, d, d);
                var gp = new GraphicsPath();
                gp.AddEllipse(rect);
                using (var pg = new PathGradientBrush(gp)) {
                    pg.CenterColor = glow;
                    pg.SurroundColors = new Color[]{ Color.FromArgb(0, glowR, glowG, glowB) };
                    pg.SetSigmaBellShape(0.55f);
                    g.FillEllipse(pg, rect);
                }
                gp.Dispose();
            }
            // rim light
            var filtered = Draw(src, Mul(Mul(Saturate(sat), Hue(hue)), Bright(bri)));
            if (rimA > 0) {
                var rim = Color.FromArgb(rimA, rimR, rimG, rimB);
                var sil = Silhouette(filtered, rim, 0.85f);
                int r = 3;
                for (int a = 0; a < 16; a++) {
                    double th = a * Math.PI / 8.0;
                    int dx = (int)Math.Round(Math.Cos(th) * r);
                    int dy = (int)Math.Round(Math.Sin(th) * r);
                    g.DrawImage(sil, new Rectangle(pad+dx, pad+dy, w, h));
                }
                sil.Dispose();
            }
            g.DrawImage(filtered, new Rectangle(pad, pad, w, h));
            filtered.Dispose();
        }
        return canvas;
    }
}
'@

# ---- pull the requested avatar's frame 0 out of sprite-data.ts ----
Write-Host "mark:1 read sprite-data ($Avatar)"
$raw=[System.IO.File]::ReadAllText($SpriteData)
$pattern = "'" + [regex]::Escape($Avatar) + "':\s*\{ url: 'data:image/png;base64,(?<b64>[A-Za-z0-9+/=]+)', frameWidth: (?<fw>\d+), frameHeight: (?<fh>\d+), frameCount: (?<fc>\d+)"
$m=[regex]::Match($raw, $pattern)
if(-not $m.Success){ throw "$Avatar entry not found" }
$fw=[int]$m.Groups['fw'].Value; $fh=[int]$m.Groups['fh'].Value
Write-Host "mark:2 fw=$fw fh=$fh type=$($fw.GetType().Name)"
$strip=[System.Drawing.Bitmap]::FromStream([System.IO.MemoryStream]::new([Convert]::FromBase64String($m.Groups['b64'].Value)))
$frame=New-Object System.Drawing.Bitmap -ArgumentList @($fw,$fh)
$gg=[System.Drawing.Graphics]::FromImage($frame)
$gg.DrawImage($strip,0,0,(New-Object System.Drawing.Rectangle -ArgumentList @(0,0,$fw,$fh)),[System.Drawing.GraphicsUnit]::Pixel)
$gg.Dispose(); $strip.Dispose()
Write-Host 'mark:3 frame cropped'

# ---- the five skins, mirroring PetWidget.module.css ----
# silver-moon ships a human palette: her variants avoid a hue rotation (it turns
# skin green and wrecks the sash) and use chroma + a rim light + an aura instead.
# The whale-girl still ran on the older rule, which rotates the whole sprite:
# these values are what the stylesheet applies to her today.
if ($Avatar -eq 'whale') {
  $skins=@(
    @{ n='classic';  sat=1.0;  bri=1.0;  hue=0.0;  rimA=0; rimR=0; rimG=0; rimB=0; glowA=0; glowR=0; glowG=0; glowB=0 },
    @{ n='sakura';   sat=1.2;  bri=1.0;  hue=-18;  rimA=0; rimR=0; rimG=0; rimB=0; glowA=140; glowR=255; glowG=150; glowB=190 },
    @{ n='mint';     sat=1.1;  bri=1.0;  hue=70;   rimA=0; rimR=0; rimG=0; rimB=0; glowA=128; glowR=90;  glowG=230; glowB=190 },
    @{ n='midnight'; sat=0.9;  bri=0.82; hue=15;   rimA=0; rimR=0; rimG=0; rimB=0; glowA=140; glowR=120; glowG=140; glowB=255 },
    @{ n='gold';     sat=1.3;  bri=1.06; hue=28;   rimA=0; rimR=0; rimG=0; rimB=0; glowA=153; glowR=255; glowG=205; glowB=110 }
  )
} else {
  $skins=@(
    @{ n='classic';  sat=1.0;  bri=1.0;  hue=0.0; rimA=0;   rimR=0;   rimG=0;   rimB=0;   glowA=0;   glowR=0;   glowG=0;   glowB=0 },
    @{ n='sakura';   sat=1.35; bri=1.03; hue=0.0; rimA=230; rimR=255; rimG=138; rimB=186; glowA=158; glowR=255; glowG=138; glowB=186 },
    @{ n='mint';     sat=0.55; bri=1.06; hue=0.0; rimA=230; rimR=92;  rimG=226; rimB=190; glowA=148; glowR=92;  glowG=226; glowB=190 },
    @{ n='midnight'; sat=0.75; bri=0.78; hue=0.0; rimA=242; rimR=126; rimG=146; rimB=255; glowA=158; glowR=126; glowG=146; glowB=255 },
    @{ n='gold';     sat=1.45; bri=1.05; hue=8.0; rimA=242; rimR=255; rimG=200; rimB=110; glowA=158; glowR=255; glowG=200; glowB=110 }
  )
}
$PAD=46
$CW=[int]($fw + $PAD*2)
$CH=[int]($fh + $PAD*2 + 26)
$totalW=[int]($CW * $skins.Count)
Write-Host "mark:4 CW=$CW CH=$CH totalW=$totalW"
$sheet=New-Object System.Drawing.Bitmap -ArgumentList @($totalW,$CH)
$sg=[System.Drawing.Graphics]::FromImage($sheet)
$sg.Clear([System.Drawing.Color]::FromArgb(255,32,36,46))
$font=New-Object System.Drawing.Font -ArgumentList @('Segoe UI',13,[System.Drawing.FontStyle]::Bold)
for($i=0;$i -lt $skins.Count;$i++){
  $s=$skins[$i]
  Write-Host "mark:5 rendering $($s.n)"
  $ra=[int]$s.rimA; $ga=[int]$s.glowA
  if($FilterOnly){ $ra=0; $ga=0 }
  $cell=[SkinFx]::Render($frame,[float]$s.sat,[float]$s.bri,[float]$s.hue,$ra,[int]$s.rimR,[int]$s.rimG,[int]$s.rimB,$ga,[int]$s.glowR,[int]$s.glowG,[int]$s.glowB,$PAD)
  $sg.DrawImage($cell,([int]($i*$CW)),0)
  $cell.Dispose()
  $sg.DrawString([string]$s.n,$font,[System.Drawing.Brushes]::White,([int]($i*$CW)+10),([int]($CH-24)))
}
$sg.Dispose(); $font.Dispose(); $frame.Dispose()
$sheet.Save($OutPng,[System.Drawing.Imaging.ImageFormat]::Png); $sheet.Dispose()
Write-Output "wrote $OutPng"
