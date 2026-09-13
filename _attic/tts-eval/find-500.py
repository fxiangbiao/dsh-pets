"""Find which audio shapes make the local STT server answer 500.

The server's error path returns the reason in the JSON body, so the body is the
diagnostic. Cases mirror what a browser MediaRecorder can actually emit.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid

import av

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "stt-test.wav")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8758
URL = f"http://127.0.0.1:{PORT}/v1/audio/transcriptions"


def encode(rate: int, layout: str, max_seconds: float | None) -> bytes:
    """Encode the source clip to WebM/Opus with the given shape."""
    out_path = os.path.join(HERE, "_probe-case.webm")
    with av.open(SRC) as inp:
        istream = inp.streams.audio[0]
        with av.open(out_path, mode="w", format="webm") as out:
            ostream = out.add_stream("libopus", rate=rate)
            ostream.layout = layout
            resampler = av.AudioResampler(format=ostream.format.name, layout=layout, rate=rate)
            written = 0
            for frame in inp.decode(istream):
                if max_seconds is not None and written / rate > max_seconds:
                    break
                for resampled in resampler.resample(frame):
                    written += resampled.samples
                    for packet in ostream.encode(resampled):
                        out.mux(packet)
            for packet in ostream.encode(None):
                out.mux(packet)
    with open(out_path, "rb") as handle:
        return handle.read()


def header_only() -> bytes:
    """A WebM container with the audio stream declared but no frames muxed.

    PyAV writes no file at all when nothing is muxed, in which case there is no
    payload shape to test and the caller skips it.
    """
    out_path = os.path.join(HERE, "_probe-empty.webm")
    if os.path.exists(out_path):
        os.remove(out_path)
    try:
        with av.open(out_path, mode="w", format="webm") as out:
            ostream = out.add_stream("libopus", rate=48000)
            ostream.layout = "mono"
            for packet in ostream.encode(None):
                out.mux(packet)
    except Exception as error:  # noqa: BLE001 - the shape simply cannot be produced
        print(f"note: could not build the header-only case: {error}")
        return b""
    if not os.path.exists(out_path):
        return b""
    with open(out_path, "rb") as handle:
        return handle.read()


def post(data: bytes, name: str) -> tuple[int, str]:
    boundary = "----probe" + uuid.uuid4().hex
    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'.encode()
    body += b"Content-Type: audio/webm\r\n\r\n"
    body += data
    body += b"\r\n"
    for key, value in (("model", "whisper-1"), ("language", "zh")):
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
        body += value.encode()
        body += b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    request = urllib.request.Request(URL, data=bytes(body), method="POST")
    request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    request.add_header("Origin", "http://127.0.0.1:3080")
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return response.status, response.read().decode("utf-8", "replace")[:300]
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")[:300]


def main() -> int:
    cases: list[tuple[str, bytes]] = []
    cases.append(("control 48k mono (full speech)", encode(48000, "mono", None)))
    cases.append(("short 0.3s @48k mono", encode(48000, "mono", 0.3)))
    cases.append(("stereo @48k", encode(48000, "stereo", None)))
    cases.append(("low rate 8k mono", encode(8000, "mono", None)))
    cases.append(("random bytes named .webm", bytes(range(256)) * 40))
    empty = header_only()
    if empty != b"":
        cases.append(("header only, no frames", empty))

    for label, data in cases:
        status, body = post(data, "speech.webm")
        flag = "OK  " if status == 200 else "FAIL"
        print(f"{flag} {label:34} {len(data):>7} bytes  HTTP {status}")
        if status != 200:
            print(f"       body: {body}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
