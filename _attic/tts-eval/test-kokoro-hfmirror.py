"""Retry Kokoro through hf-mirror, building the voice pack from its parts.

Findings that made this possible:

* GitHub release downloads throttled to a standstill, but `hf-mirror.com` serves
  the same model family (onnx-community/Kokoro-82M-v1.1-zh-ONNX).
* kokoro-onnx loads its voice pack with `np.load(voices_path)` — it is a plain
  `.npz`, and the per-voice `voices/*.bin` files are the raw arrays it contains,
  so the pack can be assembled locally instead of downloaded as one bundle.
* `_style_for` indexes `voice[len - 1]`, so each entry is `(510, 256)` float32.

The question this answers is unchanged: is Kokoro's CPU speed actually usable, or
was the earlier RTF 2.0 real?
"""

from __future__ import annotations

import os
import time
import urllib.request

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(os.path.dirname(HERE), "models")
REPO = "https://hf-mirror.com/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/main"
TEXT = "你好，我是银月。这是一次完全本地的语音合成测试，不联网。"
# A few female and male candidates, so the voice can be chosen by ear later.
VOICES = ["zf_001", "zf_002", "zf_003", "zf_017", "zm_009", "zm_010"]


def fetch(path: str, target: str, attempts: int = 6) -> str:
    """Download one file with resume."""
    dest = os.path.join(MODELS, target)
    os.makedirs(MODELS, exist_ok=True)
    expected = 0
    for attempt in range(1, attempts + 1):
        have = os.path.getsize(dest) if os.path.exists(dest) else 0
        headers = {"User-Agent": "dsh-pet/1.0"}
        if have:
            headers["Range"] = f"bytes={have}-"
        try:
            request = urllib.request.Request(f"{REPO}/{path}", headers=headers)
            with urllib.request.urlopen(request, timeout=60) as response, open(dest, "ab") as handle:
                expected = int(response.headers.get("Content-Length", 0)) + (have if response.status == 206 else 0)
                if have and response.status != 206:
                    handle.seek(0)
                    handle.truncate()
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    handle.write(chunk)
        except Exception as error:  # noqa: BLE001 - retry loop
            print(f"    {target}: retry {attempt} ({type(error).__name__})")
            time.sleep(1)
            continue
        size = os.path.getsize(dest)
        if expected and size >= expected:
            print(f"    {target}: {size:,} bytes")
            return dest
    print(f"    {target}: gave up at {os.path.getsize(dest) if os.path.exists(dest) else 0:,}")
    return dest


def build_voice_pack() -> str:
    """Assemble the .npz pack kokoro-onnx expects from the per-voice arrays."""
    pack = os.path.join(MODELS, "voices-v1.1-zh.npz")
    arrays = {}
    for name in VOICES:
        raw = os.path.join(MODELS, f"voice_{name}.bin")
        if not os.path.exists(raw):
            continue
        data = np.frombuffer(open(raw, "rb").read(), dtype="<f4")
        if data.size % 256 != 0:
            print(f"    {name}: unexpected size {data.size}")
            continue
        # (buckets, 1, 256), not (buckets, 256): `_style_for` slices one bucket
        # and this export requires a rank-2 `style`, so the extra axis is needed.
        arrays[name] = data.reshape(data.size // 256, 1, 256)
        print(f"    {name}: {arrays[name].shape} float32")
    np.savez(pack, **arrays)
    print(f"    pack: {os.path.getsize(pack):,} bytes, {len(arrays)} voices")
    return pack


def main() -> int:
    print("--- fetching the int8 model from hf-mirror")
    model = fetch("onnx/model_int8.onnx", "kokoro-zh-int8.onnx")

    print("--- fetching voices")
    for name in VOICES:
        fetch(f"voices/{name}.bin", f"voice_{name}.bin")

    print("--- assembling the voice pack")
    pack = build_voice_pack()

    from kokoro_onnx import Kokoro
    import onnxruntime as ort

    print("\n--- int8, thread sweep")
    for threads in (1, 8, 24):
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(model, sess_options=options, providers=["CPUExecutionProvider"])
        print(f"    session inputs: {[i.name for i in session.get_inputs()]}")
        kokoro = Kokoro.from_session(session, pack)
        kokoro.create(TEXT, voice="zf_001", lang="cmn", speed=1.0)
        started = time.time()
        samples, rate = kokoro.create(TEXT, voice="zf_001", lang="cmn", speed=1.0)
        elapsed = time.time() - started
        seconds = len(samples) / rate
        print(f"    intra_op={threads:<3} {elapsed:6.2f}s synth / {seconds:5.2f}s audio  rtf={elapsed / seconds:.2f}")

    out = os.path.join(HERE, "kokoro-hfmirror.wav")
    import wave
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(out, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm.tobytes())
    print(f"\nwav: {out} ({os.path.getsize(out):,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
