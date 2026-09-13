"""Reproduce the pet's click-to-record upload exactly: webm/opus -> local Whisper.

The pet records with MediaRecorder (Chrome/Quark emit WebM + Opus) and POSTs a
multipart `file` part. Earlier verification used a WAV, which does not prove the
container the browser actually sends can be decoded. This does.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
import uuid

import av

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "stt-test.wav")
WEBM = os.path.join(HERE, "stt-test.webm")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8756
URL = f"http://127.0.0.1:{PORT}/v1/audio/transcriptions"


def transcode() -> bytes:
    """Encode the source clip to 48 kHz mono WebM/Opus, as MediaRecorder does."""
    with av.open(SRC) as inp:
        istream = inp.streams.audio[0]
        with av.open(WEBM, mode="w", format="webm") as out:
            ostream = out.add_stream("libopus", rate=48000)
            ostream.layout = "mono"
            resampler = av.AudioResampler(format=ostream.format.name, layout="mono", rate=48000)
            for frame in inp.decode(istream):
                for resampled in resampler.resample(frame):
                    for packet in ostream.encode(resampled):
                        out.mux(packet)
            for packet in ostream.encode(None):
                out.mux(packet)
    with open(WEBM, "rb") as handle:
        return handle.read()


def multipart(data: bytes) -> tuple[bytes, str]:
    """Build the same body the widget's `transcribe()` builds."""
    boundary = "----dshpet" + uuid.uuid4().hex
    body = bytearray()
    body += f"--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="file"; filename="speech.webm"\r\n'
    body += b"Content-Type: audio/webm\r\n\r\n"
    body += data
    body += b"\r\n"
    for key, value in (("model", "whisper-1"), ("language", "zh")):
        body += f"--{boundary}\r\n".encode()
        body += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
        body += value.encode()
        body += b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return bytes(body), boundary


def main() -> int:
    data = transcode()
    print(f"webm/opus payload: {len(data)} bytes (magic {data[:4]!r})")
    body, boundary = multipart(data)
    request = urllib.request.Request(URL, data=body, method="POST")
    request.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    request.add_header("Origin", "http://127.0.0.1:3080")
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        print("HTTP ERROR", error.code, error.read().decode("utf-8", "replace")[:400])
        return 1
    print("RESULT:", json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
