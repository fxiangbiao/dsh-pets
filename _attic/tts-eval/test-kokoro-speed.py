"""Measure Kokoro's steady-state speed (the first call includes warm-up) and
inspect the misaki Chinese API for the correct G2P entry point.
"""

from __future__ import annotations

import os
import time

import kokoro_onnx

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(os.path.dirname(HERE), "models")
MODEL = os.path.join(MODELS, "kokoro-v1.1-zh.int8.onnx")
VOICES = os.path.join(MODELS, "voices-v1.1-zh.bin")
VOICE = "zf_001"
TEXT = "你好，我是银月。这是一次完全本地的语音合成测试，不联网。"


def main() -> int:
    print("--- misaki.zh API:")
    try:
        from misaki import zh as misaki_zh
        public = [n for n in dir(misaki_zh) if not n.startswith('_')]
        print(f"    {public}")
    except Exception as error:  # noqa: BLE001
        print(f"    unavailable: {error}")

    kokoro = kokoro_onnx.Kokoro(MODEL, VOICES)
    print("\n--- Kokoro latency per call (first includes warm-up):")
    for index in range(4):
        started = time.time()
        samples, rate = kokoro.create(TEXT, voice=VOICE, lang="cmn", speed=1.0)
        elapsed = time.time() - started
        seconds = len(samples) / rate
        print(f"    call {index + 1}: synth {elapsed:6.2f}s for {seconds:5.2f}s audio  rtf={elapsed / seconds:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
