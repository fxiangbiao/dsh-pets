"""Download and verify fully-local Chinese TTS (Kokoro v1.1-zh).

Everything here stays on the machine: the model and voices are fetched once from
a public release, and synthesis afterwards is pure local ONNX inference.
"""

from __future__ import annotations

import inspect
import os
import time
import urllib.request
import wave

import numpy as np
import kokoro_onnx

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(os.path.dirname(HERE), "models")
BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
ASSETS = {
    # int8 keeps CPU latency low and the download to ~114 MB; quality loss on
    # this model is small because it is already a small, distilled network.
    "kokoro-v1.1-zh.int8.onnx": f"{BASE}/kokoro-v1.1-zh.int8.onnx",
    "voices-v1.1-zh.bin": f"{BASE}/voices-v1.1-zh.bin",
}
VOICE = "zf_001"
TEXT = "你好，我是银月。这是一次完全本地的语音合成测试，不联网。"


def fetch(name: str, url: str) -> str:
    """Download one asset unless it is already cached."""
    target = os.path.join(MODELS, name)
    if os.path.exists(target) and os.path.getsize(target) > 1000:
        print(f"cached  {name} ({os.path.getsize(target):,} bytes)")
        return target
    print(f"fetching {name} ...")
    started = time.time()
    os.makedirs(MODELS, exist_ok=True)
    partial = f"{target}.part"
    with urllib.request.urlopen(url, timeout=120) as response, open(partial, "wb") as handle:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            handle.write(chunk)
    os.replace(partial, target)
    size = os.path.getsize(target)
    print(f"  done {size:,} bytes in {time.time() - started:.1f}s")
    return target


def main() -> int:
    paths = {name: fetch(name, url) for name, url in ASSETS.items()}

    started = time.time()
    kokoro = kokoro_onnx.Kokoro(
        os.path.join(MODELS, "kokoro-v1.1-zh.int8.onnx"),
        os.path.join(MODELS, "voices-v1.1-zh.bin"),
    )
    print(f"model loaded in {time.time() - started:.1f}s")
    print("create signature:", inspect.signature(kokoro.create))

    chinese = [v for v in kokoro.get_voices() if v.startswith(("zf_", "zm_"))]
    print(f"chinese voices: {len(chinese)} (zf_* female, zm_* male)")
    if VOICE not in chinese:
        print(f"WARNING: {VOICE} not among them")

    started = time.time()
    samples, rate = kokoro.create(TEXT, voice=VOICE, lang="zh", speed=1.0)
    elapsed = time.time() - started
    seconds = len(samples) / rate

    out = os.path.join(HERE, "kokoro-local-test.wav")
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(out, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())

    print(f"voice      : {VOICE}")
    print(f"text       : {len(TEXT)} chars")
    print(f"audio      : {seconds:.2f}s @ {rate} Hz")
    print(f"latency    : {elapsed:.2f}s  (real-time factor {elapsed / max(seconds, 0.01):.2f})")
    print(f"wav bytes  : {os.path.getsize(out):,}")
    print("RESULT:", "OK" if seconds > 1.0 else "SUSPICIOUS")
    return 0 if seconds > 1.0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
