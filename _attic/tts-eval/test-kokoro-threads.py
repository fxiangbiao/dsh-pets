"""Why is Kokoro slow? Test thread count and execution provider.

RTF 2.0 on a 12-core / 24-thread Zen 5 is anomalous for an 82M-parameter model,
so the likely cause is a thread-starved or badly scheduled ONNX session rather
than raw compute. The model is rebuilt here with explicit session options so the
difference is measurable instead of guessed.
"""

from __future__ import annotations

import os
import time
import urllib.request

import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(os.path.dirname(HERE), "models")
BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
MODEL = os.path.join(MODELS, "kokoro-v1.1-zh.int8.onnx")
VOICES = os.path.join(MODELS, "voices-v1.1-zh.bin")
VOICE = "zf_001"
TEXT = "你好，我是银月。这是一次完全本地的语音合成测试，不联网。"


def fetch(url: str, target: str) -> str:
    if os.path.exists(target) and os.path.getsize(target) > 1000:
        return target
    os.makedirs(MODELS, exist_ok=True)
    print(f"fetching {os.path.basename(target)} ...")
    request = urllib.request.Request(url, headers={"User-Agent": "dsh-pet/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response, open(f"{target}.part", "wb") as handle:
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            handle.write(chunk)
    os.replace(f"{target}.part", target)
    print(f"  {os.path.getsize(target):,} bytes")
    return target


def bench(label: str, sessions) -> float:
    from kokoro_onnx import Kokoro

    kokoro = Kokoro.from_session(sessions, VOICES)
    kokoro.create(TEXT, voice=VOICE, lang="cmn", speed=1.0)  # warm up
    started = time.time()
    samples, rate = kokoro.create(TEXT, voice=VOICE, lang="cmn", speed=1.0)
    elapsed = time.time() - started
    seconds = len(samples) / rate
    print(f"  {label:<34} synth {elapsed:6.2f}s for {seconds:5.2f}s audio  rtf={elapsed / seconds:.2f}")
    return elapsed / seconds


def main() -> int:
    fetch(f"{BASE}/kokoro-v1.1-zh.int8.onnx", MODEL)
    fetch(f"{BASE}/voices-v1.1-zh.bin", VOICES)

    print(f"providers available: {ort.get_available_providers()}")
    print(f"cpu threads: {os.cpu_count()}\n")
    print("--- RTF by session configuration:")

    for threads in (1, 8, 24):
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(MODEL, sess_options=options, providers=["CPUExecutionProvider"])
        bench(f"CPU, intra_op={threads}", session)

    # Default construction, for comparison with the packaged wrapper.
    bench("CPU, library defaults", ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
