"""Download and verify fully-local Piper Chinese TTS.

Piper is a small VITS model: unlike Kokoro (measured at RTF 2.0 on this CPU,
i.e. slower than real time), it is built for CPU inference, which is the whole
point when the voice has to answer a question promptly and stay on the machine.
"""

from __future__ import annotations

import os
import time
import urllib.request
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(os.path.dirname(HERE), "models")
BASE = "https://hf-mirror.com/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium"
ASSETS = ("zh_CN-huayan-medium.onnx", "zh_CN-huayan-medium.onnx.json")
TEXT = "你好，我是银月。这是一次完全本地的语音合成测试，不联网。"


def fetch(name: str) -> str:
    target = os.path.join(MODELS, name)
    if os.path.exists(target) and os.path.getsize(target) > 500:
        print(f"cached   {name} ({os.path.getsize(target):,} bytes)")
        return target
    print(f"fetching {name} ...")
    started = time.time()
    os.makedirs(MODELS, exist_ok=True)
    partial = f"{target}.part"
    # hf-mirror answers 403 to the bare urllib agent, so identify properly.
    request = urllib.request.Request(
        f"{BASE}/{name}",
        headers={"User-Agent": "dsh-pet/1.0 (+local-tts-setup)"},
    )
    with urllib.request.urlopen(request, timeout=180) as response, open(partial, "wb") as handle:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            handle.write(chunk)
    os.replace(partial, target)
    print(f"  done {os.path.getsize(target):,} bytes in {time.time() - started:.1f}s")
    return target


def main() -> int:
    paths = [fetch(name) for name in ASSETS]

    from piper import PiperVoice

    started = time.time()
    voice = PiperVoice.load(paths[0], config_path=paths[1])
    print(f"loaded in {time.time() - started:.2f}s  sample_rate={voice.config.sample_rate}")

    out = os.path.join(HERE, "piper-local-test.wav")
    print("\n--- Piper latency per call:")
    for index in range(4):
        started = time.time()
        with wave.open(out, "wb") as handle:
            voice.synthesize_wav(TEXT, handle)
        elapsed = time.time() - started
        with wave.open(out, "rb") as handle:
            seconds = handle.getnframes() / handle.getframerate()
        print(f"    call {index + 1}: synth {elapsed:6.2f}s for {seconds:5.2f}s audio  rtf={elapsed / max(seconds, 0.01):.2f}")

    print(f"\nwav: {os.path.getsize(out):,} bytes")
    print("RESULT:", "OK" if seconds > 1.0 else "SUSPICIOUS")
    return 0 if seconds > 1.0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
