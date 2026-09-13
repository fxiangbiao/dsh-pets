"""Verify the local service's neural-speech endpoint the way the browser calls it.

Checks the exact request the pet makes (JSON POST), the response shape, and the
CORS preflight that a JSON content type forces.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

import av

PORT = 8756
BASE = f"http://127.0.0.1:{PORT}"
URL = f"{BASE}/v1/audio/speech"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "endpoint-tts-test.mp3")
ORIGIN = "http://127.0.0.1:3080"
TEXT = "银月在这里。神经语音已经接通了。"


def preflight() -> None:
    request = urllib.request.Request(URL, method="OPTIONS")
    request.add_header("Origin", ORIGIN)
    request.add_header("Access-Control-Request-Method", "POST")
    request.add_header("Access-Control-Request-Headers", "content-type")
    with urllib.request.urlopen(request, timeout=10) as response:
        print("--- preflight OPTIONS")
        print(f"    status            : {response.status}")
        print(f"    allow-origin      : {response.headers.get('Access-Control-Allow-Origin')}")
        print(f"    allow-methods     : {response.headers.get('Access-Control-Allow-Methods')}")
        print(f"    allow-headers     : {response.headers.get('Access-Control-Allow-Headers')}")


def synthesize() -> bool:
    body = json.dumps({"input": TEXT}).encode("utf-8")
    request = urllib.request.Request(URL, data=body, method="POST")
    request.add_header("Content-Type", "application/json")
    request.add_header("Origin", ORIGIN)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            audio = response.read()
            print("--- synthesis POST")
            print(f"    status            : {response.status}")
            print(f"    content-type      : {response.headers.get('Content-Type')}")
            print(f"    allow-origin      : {response.headers.get('Access-Control-Allow-Origin')}")
            print(f"    bytes             : {len(audio)}")
    except urllib.error.HTTPError as error:
        print(f"--- synthesis POST FAILED: HTTP {error.code}")
        print("    body:", error.read().decode("utf-8", "replace")[:300])
        return False
    with open(OUT, "wb") as handle:
        handle.write(audio)
    with av.open(OUT) as container:
        stream = container.streams.audio[0]
        seconds = float(stream.duration * stream.time_base) if stream.duration else 0.0
    print(f"    audio             : {seconds:.2f}s, {stream.sample_rate} Hz, {stream.layout.name}")
    return len(audio) > 2000


def main() -> int:
    try:
        preflight()
    except Exception as error:  # noqa: BLE001 - report and keep going
        print(f"--- preflight FAILED: {error}")
    ok = synthesize()
    print("\nRESULT:", "OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
