param(
  [Parameter(Mandatory=$true)][string]$RobotHi,
  [Parameter(Mandatory=$true)][string]$RobotBlink,
  [Parameter(Mandatory=$true)][string]$RobotMerge,
  [Parameter(Mandatory=$true)][string]$SilverHop,
  [Parameter(Mandatory=$true)][string]$SilverYawn,
  [Parameter(Mandatory=$true)][string]$SilverAngry,
  [Parameter(Mandatory=$true)][string]$SilverShy,
  [Parameter(Mandatory=$false)][string]$Whale1,
  [Parameter(Mandatory=$false)][string]$Whale2,
  [Parameter(Mandatory=$true)][string]$OutTs
)
$ErrorActionPreference='Stop'
$ff='D:\Apps\JianyingPro\11.3.0.14362\ffmpeg.exe'
$tmp='D:\ALAN\Codes\dsh-pets\art\sfx'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# clip definition: avatar -> name -> @{src;ss;t}
# voice/avatar are one-shots that carry a full feel -> longer clips w/ fades.
# perform clips ride the 1.4s step; the two-player crossfade covers the seam.
$clips=@{
  robot = @(
    @{n='voice';    src=$RobotHi;    ss=0.0; t=2.4},
    @{n='avatar';   src=$RobotBlink; ss=0.0; t=2.2},
    @{n='perform0'; src=$RobotHi;    ss=0.0; t=1.5},
    @{n='perform1'; src=$RobotBlink; ss=0.0; t=1.5},
    @{n='perform2'; src=$RobotMerge; ss=2.0; t=1.5},
    @{n='perform3'; src=$RobotMerge; ss=5.5; t=1.5}
  );
  'silver-moon' = @(
    @{n='voice';    src=$SilverHop;  ss=0.0; t=2.4},
    @{n='avatar';   src=$SilverShy;  ss=0.0; t=2.2},
    @{n='perform0'; src=$SilverHop;  ss=0.0; t=1.5},
    @{n='perform1'; src=$SilverYawn; ss=0.0; t=1.5},
    @{n='perform2'; src=$SilverAngry;ss=0.0; t=1.5},
    @{n='perform3'; src=$SilverShy;  ss=0.0; t=1.5}
  );
  whale = @(
    @{n='voice';    src=$Whale1; ss=0.0; t=2.4},
    @{n='avatar';   src=$Whale2; ss=0.0; t=2.2},
    @{n='perform0'; src=$Whale1; ss=0.0; t=1.5},
    @{n='perform1'; src=$Whale2; ss=0.0; t=1.5},
    @{n='perform2'; src=$Whale1; ss=4.0; t=1.5},
    @{n='perform3'; src=$Whale2; ss=4.0; t=1.5}
  )
}

$tl=New-Object System.Collections.ArrayList
[void]$tl.Add('/** AUTO-GENERATED short SFX clips (base64 audio/mp4) derived from the pet videos. */')
[void]$tl.Add('// Wire playback in PetWidget on the action buttons.')
[void]$tl.Add("export type SfxName = 'voice' | 'avatar' | 'perform0' | 'perform1' | 'perform2' | 'perform3'")
[void]$tl.Add('const LIB: Record<string, Partial<Record<SfxName, string>>> = {')
foreach($avatar in @('whale','robot','silver-moon')){
  if($clips[$avatar].Count -eq 0){
    [void]$tl.Add("  '$avatar': {},")
    continue
  }
  [void]$tl.Add("  '$avatar': {")
  $idx=0
  foreach($c in $clips[$avatar]){
    $uniq="{0}_{1}" -f ($avatar -replace '[^A-Za-z]',''),$c.n
    $outm=Join-Path $tmp ($uniq+'.m4a')
    $fadeOut=[Math]::Round($c.t-0.25,2)
    & $ff -y -hide_banner -loglevel error -ss $c.ss -t $c.t -i $c.src -vn -acodec aac -b:a 40k -ar 44100 -ac 1 -af "afade=t=in:st=0:d=0.18,afade=t=out:st=${fadeOut}:d=0.25" -movflags +faststart $outm 2>&1 | Out-String | Out-Null
    $b64=[Convert]::ToBase64String([System.IO.File]::ReadAllBytes($outm))
    $comma = if($idx -lt ($clips[$avatar].Count-1)){','}else{''}
    [void]$tl.Add("    '$($c.n)': 'data:audio/mp4;base64,$b64'$comma")
    $idx++
    Write-Host "  $avatar/$($c.n)  $($b64.Length) chars"
  }
  [void]$tl.Add('  },')
}
[void]$tl.Add('}')
[void]$tl.Add('')
[void]$tl.Add('/** Two ping-pong players so consecutive clips crossfade instead of hard-cutting. */')
[void]$tl.Add('let players: HTMLAudioElement[] | null = null')
[void]$tl.Add('let active = 0')
[void]$tl.Add('')
[void]$tl.Add('/** Clamp a value into the media element legal volume range. */')
[void]$tl.Add('function clamp01(value: number): number {')
[void]$tl.Add('  return value < 0 ? 0 : value > 1 ? 1 : value')
[void]$tl.Add('}')
[void]$tl.Add('')
[void]$tl.Add('/** Per-element ramp token, so a stale ramp cannot fight a newer one. */')
[void]$tl.Add('const rampToken = new WeakMap<HTMLAudioElement, number>()')
[void]$tl.Add('')
[void]$tl.Add('/** Ramp an element volume to `to` over `ms` ms (smooth fade in/out). */')
[void]$tl.Add('function ramp(el: HTMLAudioElement, to: number, ms: number): void {')
[void]$tl.Add('  const target = clamp01(to)')
[void]$tl.Add('  const token = (rampToken.get(el) ?? 0) + 1')
[void]$tl.Add('  rampToken.set(el, token)')
[void]$tl.Add('  const from = clamp01(el.volume)')
[void]$tl.Add('  const t0 = performance.now()')
[void]$tl.Add('  const step = (now: number): void => {')
[void]$tl.Add('    if (rampToken.get(el) !== token) return')
[void]$tl.Add('    // The rAF timestamp is the frame start and can precede t0, so the')
[void]$tl.Add('    // progress must be clamped at both ends or the volume goes negative.')
[void]$tl.Add('    const p = clamp01((now - t0) / ms)')
[void]$tl.Add('    try {')
[void]$tl.Add('      el.volume = clamp01(from + (target - from) * p)')
[void]$tl.Add('    } catch {')
[void]$tl.Add('      return')
[void]$tl.Add('    }')
[void]$tl.Add('    if (p < 1) requestAnimationFrame(step)')
[void]$tl.Add('  }')
[void]$tl.Add('  requestAnimationFrame(step)')
[void]$tl.Add('}')
[void]$tl.Add('')
[void]$tl.Add('/** Play a short SFX clip for an avatar + cue, crossfading from the previous one. */')
[void]$tl.Add('export function playSfx(avatar: string, name: SfxName): void {')
[void]$tl.Add('  const url = LIB[avatar]?.[name]')
[void]$tl.Add('  if (url === undefined) return')
[void]$tl.Add('  try {')
[void]$tl.Add('    if (players === null) players = [new Audio(), new Audio()]')
[void]$tl.Add('    const a = players[active]!')
[void]$tl.Add('    const other = players[1 - active]!')
[void]$tl.Add('    // Fade the previous clip out while the new one fades in -> smooth seam.')
[void]$tl.Add('    if (!other.paused && other.src !== "") ramp(other, 0, 140)')
[void]$tl.Add('    a.src = url')
[void]$tl.Add('    a.currentTime = 0')
[void]$tl.Add('    a.volume = 0')
[void]$tl.Add('    void a.play().then(() => {')
[void]$tl.Add('      ramp(a, 0.7, 180)')
[void]$tl.Add('      window.setTimeout(() => { if (!other.paused) other.pause() }, 240)')
[void]$tl.Add('    }).catch(() => {})')
[void]$tl.Add('    active = 1 - active')
[void]$tl.Add('  } catch { /* audio unavailable; ignore */ }')
[void]$tl.Add('}')
$tl | Set-Content -Path $OutTs -Encoding UTF8
Write-Host "wrote $OutTs"
