"""Verify edge-tts neural synthesis works from this machine, and measure it."""

from __future__ import annotations

import asyncio
import os
import time

import av
import edge_tts

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "neural-tts-test.mp3")
TEXT = "你好，我是银月。这是一次神经语音合成的测试。"
VOICE = "zh-CN-XiaoxiaoNeural"


async def synth() -> float:
    started = time.time()
    communicate = edge_tts.Communicate(TEXT, VOICE)
    audio = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
    with open(OUT, "wb") as handle:
        handle.write(bytes(audio))
    return time.time() - started


def main() -> int:
    elapsed = asyncio.run(synth())
    size = os.path.getsize(OUT)
    with av.open(OUT) as container:
        stream = container.streams.audio[0]
        seconds = float(stream.duration * stream.time_base) if stream.duration else 0.0
    print(f"voice      : {VOICE}")
    print(f"text       : {TEXT}")
    print(f"bytes      : {size}")
    print(f"audio      : {seconds:.2f}s @ {stream.sample_rate} Hz, {stream.layout.name}")
    print(f"latency    : {elapsed:.2f}s for {len(TEXT)} chars")
    print("RESULT:", "OK" if size > 2000 else "SUSPICIOUS (too small)")
    return 0 if size > 2000 else 1


if __name__ == "__main__":
    raise SystemExit(main())
