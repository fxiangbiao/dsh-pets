param(
  [Parameter(Mandatory=$true)][string]$SpriteData
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
public static class Specks {
    public static List<int[]> Run(Bitmap bmp, int minA) {
        int w=bmp.Width,h=bmp.Height;
        var bd=bmp.LockBits(new Rectangle(0,0,w,h),ImageLockMode.ReadOnly,PixelFormat.Format32bppArgb);
        int stride=Math.Abs(bd.Stride); byte[] px=new byte[stride*h];
        Marshal.Copy(bd.Scan0,px,0,px.Length); bmp.UnlockBits(bd);
        bool[] fg=new bool[w*h];
        for(int y=0;y<h;y++){int rb=y*stride; for(int x=0;x<w;x++){ fg[y*w+x]=px[rb+x*4+3]>minA; }}
        bool[] seen=new bool[w*h]; var res=new List<int[]>(); var st=new Stack<int>();
        for(int y=0;y<h;y++){ for(int x=0;x<w;x++){ int p=y*w+x; if(seen[p]||!fg[p])continue;
            int minX=x,maxX=x,minY=y,maxY=y; long area=0; seen[p]=true; st.Push(p);
            while(st.Count>0){int c=st.Pop(); int cx=c%w, cy=c/w; area++;
                if(cx<minX)minX=cx; if(cx>maxX)maxX=cx; if(cy<minY)minY=cy; if(cy>maxY)maxY=cy;
                for(int dy=-1;dy<=1;dy++)for(int dx=-1;dx<=1;dx++){ if(dx==0&&dy==0)continue; int nx=cx+dx,ny=cy+dy;
                    if(nx<0||nx>=w||ny<0||ny>=h)continue; int q=ny*w+nx; if(seen[q]||!fg[q])continue; seen[q]=true; st.Push(q);}}
            res.Add(new int[]{minX,minY,maxX-minX+1,maxY-minY+1,(int)area}); } }
        return res;
    }
}
'@

$raw=[System.IO.File]::ReadAllText($SpriteData)
$rx=[regex]"'(?<name>[a-z\-]+)':\s*\{ url: 'data:image/png;base64,(?<b64>[A-Za-z0-9+/=]+)', frameWidth: (?<fw>\d+), frameHeight: (?<fh>\d+), frameCount: (?<fc>\d+)"
foreach($m in $rx.Matches($raw)){
  $name=$m.Groups['name'].Value
  $bytes=[Convert]::FromBase64String($m.Groups['b64'].Value)
  $ms=[System.IO.MemoryStream]::new($bytes)
  $bmp=[System.Drawing.Bitmap]::FromStream($ms)
  $comps=[Specks]::Run($bmp,8)
  $fw=[int]$m.Groups['fw'].Value; $fc=[int]$m.Groups['fc'].Value
  $big=$comps | Where-Object { $_[4] -ge 5000 }
  $small=$comps | Where-Object { $_[4] -lt 5000 } | Sort-Object { -$_[4] }
  Write-Output "=== $name  strip=$($bmp.Width)x$($bmp.Height) frame=${fw}x$($m.Groups['fh'].Value) x$fc ==="
  Write-Output "  components total=$($comps.Count)  big(>=5000)=$($big.Count)  small(<5000)=$($small.Count)"
  $i=0
  foreach($s in ($small | Select-Object -First 25)){
    Write-Output ("    small #{0,2} x={1,4} y={2,3} w={3,3} h={4,3} area={5,6}" -f $i,$s[0],$s[1],$s[2],$s[3],$s[4])
    $i++
  }
  $bmp.Dispose(); $ms.Dispose()
}
