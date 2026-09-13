"""Find the working Chinese path for local Kokoro synthesis.

kokoro-onnx phonemizes through espeak, whose Mandarin code is `cmn` — not `zh`.
But the v1.1-zh model was trained on misaki's pinyin G2P, so feeding it espeak
phonemes may mispronounce. Both are tried here; the choice is made on evidence.
"""

from __future__ import annotations

import os
import time
import wave

import numpy as np
import kokoro_onnx

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(os.path.dirname(HERE), "models")
MODEL = os.path.join(MODELS, "kokoro-v1.1-zh.int8.onnx")
VOICES = os.path.join(MODELS, "voices-v1.1-zh.bin")
VOICE = "zf_001"
TEXT = "你好，我是银月。这是一次完全本地的语音合成测试，不联网。"


def write_wav(name: str, samples, rate: int) -> int:
    out = os.path.join(HERE, name)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(out, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())
    return os.path.getsize(out)


def main() -> int:
    kokoro = kokoro_onnx.Kokoro(MODEL, VOICES)
    print(f"voices available: {len(kokoro.get_voices())}")

    # --- path A: espeak Mandarin phonemes
    print("\n--- A: lang='cmn' (espeak)")
    try:
        started = time.time()
        samples, rate = kokoro.create(TEXT, voice=VOICE, lang="cmn", speed=1.0)
        seconds = len(samples) / rate
        size = write_wav("kokoro-cmn.wav", samples, rate)
        print(f"    OK  audio={seconds:.2f}s rate={rate} latency={time.time() - started:.2f}s wav={size:,}B")
        print(f"    rtf={((time.time() - started) / max(seconds, 0.01)):.2f}")
    except Exception as error:  # noqa: BLE001 - this path is a probe
        print(f"    FAILED {type(error).__name__}: {error}")

    # --- path B: misaki pinyin G2P, fed as phonemes
    print("\n--- B: misaki ZhungG2P + is_phonemes=True")
    try:
        from misaki import zh as misaki_zh

        g2p = misaki_zh.ZhungG2P()
        phonemes, _ = g2p(TEXT)
        print(f"    phonemes: {phonemes[:80]}")
        started = time.time()
        samples, rate = kokoro.create(phonemes, voice=VOICE, is_phonemes=True, speed=1.0)
        seconds = len(samples) / rate
        size = write_wav("kokoro-misaki.wav", samples, rate)
        print(f"    OK  audio={seconds:.2f}s rate={rate} latency={time.time() - started:.2f}s wav={size:,}B")
        print(f"    rtf={((time.time() - started) / max(seconds, 0.01)):.2f}")
    except Exception as error:  # noqa: BLE001 - this path is a probe
        print(f"    FAILED {type(error).__name__}: {error}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
