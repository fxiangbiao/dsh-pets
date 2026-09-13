"""Produce an A/B listening kit: the same sentence through Kokoro's local voices
and through the online neural voice the pet currently uses.

Kokoro is measured at RTF ~2.3 on this CPU, so whether it is worth pursuing at
all now depends on one thing only — which voice the user actually prefers. That
has to be heard, not argued.
"""

from __future__ import annotations

import io
import json
import os
import time
import urllib.request
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(os.path.dirname(HERE), "models")
OUT = os.path.join(HERE, "ab")
TEXT = "你好，我是银月。这是一次完全本地的语音合成测试，不联网。"
LOCAL_VOICES = ["zf_001", "zf_002", "zf_003", "zf_017", "zm_009", "zm_010"]


def write_wav(path: str, samples, rate: int) -> int:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(path, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())
    return os.path.getsize(path)


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    from kokoro_onnx import Kokoro

    kokoro = Kokoro(
        os.path.join(MODELS, "kokoro-zh-int8.onnx"),
        os.path.join(MODELS, "voices-v1.1-zh.npz"),
    )

    print("--- Kokoro (fully offline)")
    for name in LOCAL_VOICES:
        try:
            started = time.time()
            samples, rate = kokoro.create(TEXT, voice=name, lang="cmn", speed=1.0)
            elapsed = time.time() - started
            path = os.path.join(OUT, f"kokoro-{name}.wav")
            size = write_wav(path, samples, rate)
            print(f"    {name:<8} {len(samples) / rate:5.2f}s audio  synth {elapsed:5.1f}s  -> {os.path.basename(path)} ({size:,}B)")
        except Exception as error:  # noqa: BLE001 - report and continue
            print(f"    {name:<8} FAILED {type(error).__name__}: {error}")

    print("\n--- online neural voice (what the pet uses now)")
    try:
        body = json.dumps({"input": TEXT}).encode("utf-8")
        request = urllib.request.Request(
            "http://127.0.0.1:8756/v1/audio/speech", data=body, method="POST")
        request.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(request, timeout=60) as response:
            audio = response.read()
        path = os.path.join(OUT, "online-xiaoxiao.mp3")
        with open(path, "wb") as handle:
            handle.write(audio)
        print(f"    xiaoxiao -> {os.path.basename(path)} ({len(audio):,}B)")
    except Exception as error:  # noqa: BLE001 - the service may be down
        print(f"    FAILED {error}")

    print(f"\nlistening kit: {OUT}")
    for name in sorted(os.listdir(OUT)):
        print(f"    {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
