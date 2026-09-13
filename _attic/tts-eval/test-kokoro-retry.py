"""Retry the Kokoro question properly.

RTF 2.0 for an 82M model on a 12-core / 24-thread Zen 5 is anomalous, so this
measures the two untested explanations instead of repeating the failure:

* int8 dynamic quantization can be *slower* than fp32 on CPUs where the
  dequantize overhead outruns the faster matmul;
* a session that is not actually using the available threads.

Downloads resume, because GitHub throttled a plain fetch part-way last time.
"""

from __future__ import annotations

import os
import time
import urllib.request

import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(os.path.dirname(HERE), "models")
UPSTREAM = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
# Direct GitHub throttled this repo to a standstill; these domestic proxies
# mirror release assets and answer at full speed.
BASES = (
    "https://ghproxy.net/" + UPSTREAM,
    "https://gh-proxy.com/" + UPSTREAM,
    UPSTREAM,
)
VOICE = "zf_001"
TEXT = "你好，我是银月。这是一次完全本地的语音合成测试，不联网。"

ASSETS = {
    "kokoro-v1.1-zh.int8.onnx": 114_120_125,
    "kokoro-v1.1-zh.onnx": 325_506_167,
    "voices-v1.1-zh.bin": 53_815_880,
}


def fetch(name: str, size: int, attempts: int = 10) -> str:
    """Download with resume, so a throttled connection costs only the gap."""
    target = os.path.join(MODELS, name)
    os.makedirs(MODELS, exist_ok=True)
    for attempt in range(1, attempts + 1):
        base = BASES[(attempt - 1) % len(BASES)]
        have = os.path.getsize(target) if os.path.exists(target) else 0
        if have >= size:
            print(f"  {name}: complete ({have:,})")
            return target
        headers = {"User-Agent": "dsh-pet/1.0"}
        if have:
            headers["Range"] = f"bytes={have}-"
        try:
            request = urllib.request.Request(f"{base}/{name}", headers=headers)
            with urllib.request.urlopen(request, timeout=60) as response, open(target, "ab") as handle:
                if have and response.status != 206:
                    handle.seek(0)
                    handle.truncate()
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    handle.write(chunk)
        except Exception as error:  # noqa: BLE001 - retry loop
            have = os.path.getsize(target) if os.path.exists(target) else 0
            print(f"  {name}: attempt {attempt} via {base.split('/')[2]} stopped at {have:,} ({type(error).__name__})")
            time.sleep(1)
            continue
        have = os.path.getsize(target)
        print(f"  {name}: {have:,} / {size:,} via {base.split('/')[2]}")
        if have >= size:
            return target
    raise RuntimeError(f"{name} did not finish downloading")


def model_of(path: str):
    from kokoro_onnx import Kokoro

    return Kokoro(path, os.path.join(MODELS, "voices-v1.1-zh.bin"))


def bench(label: str, kokoro) -> float:
    kokoro.create(TEXT, voice=VOICE, lang="cmn", speed=1.0)  # warm up
    started = time.time()
    samples, rate = kokoro.create(TEXT, voice=VOICE, lang="cmn", speed=1.0)
    elapsed = time.time() - started
    seconds = len(samples) / rate
    rtf = elapsed / seconds
    print(f"  {label:<30} {elapsed:6.2f}s synth / {seconds:5.2f}s audio   rtf={rtf:.2f}")
    return rtf


def main() -> int:
    print("--- downloading (resumable)")
    paths = {name: fetch(name, size) for name, size in ASSETS.items()}

    print("\n--- fp32 with an explicit thread sweep")
    for threads in (1, 8, 24):
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(paths["kokoro-v1.1-zh.onnx"], sess_options=options,
                                       providers=["CPUExecutionProvider"])
        from kokoro_onnx import Kokoro
        bench(f"fp32 intra_op={threads}", Kokoro.from_session(session, paths["voices-v1.1-zh.bin"]))

    print("\n--- int8 with an explicit thread sweep (what failed before)")
    for threads in (8, 24):
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(paths["kokoro-v1.1-zh.int8.onnx"], sess_options=options,
                                       providers=["CPUExecutionProvider"])
        from kokoro_onnx import Kokoro
        bench(f"int8 intra_op={threads}", Kokoro.from_session(session, paths["voices-v1.1-zh.bin"]))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
