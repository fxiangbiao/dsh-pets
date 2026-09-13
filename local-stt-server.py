#!/usr/bin/env python3
"""Local Whisper speech-to-text endpoint for the DSH pet plugin.

The browser's own recognizer routes audio through Google's speech service, which
some networks block (and the offline language pack comes from the same blocked
origin). This script keeps transcription on the machine instead.

It speaks the OpenAI transcription shape — a multipart POST with a `file` part,
answering {"text": "..."} — and, importantly, sends the CORS headers a browser
page needs when it calls a different port.

It also serves the matching `/v1/audio/speech` shape, with two interchangeable
engines:

* `edge` — Microsoft's neural voices through `edge-tts`. The default, because it
  is markedly more natural; the reply text leaves the machine.
* `piper` — a bundled ONNX voice. Entirely offline and measured at RTF 0.03 on
  CPU, but noticeably mechanical in Chinese.

Pick with `--tts-engine`; `auto` prefers the offline voice and only falls back to
the online one when the local model is unavailable. `off` disables speech.

Setup
-----
    pip install faster-whisper
    pip install piper-tts           # offline voice (recommended: nothing leaves)
    pip install edge-tts            # optional: higher-quality online voice
    python local-stt-server.py                 # http://127.0.0.1:8756

    python local-stt-server.py --model base    # faster, lower accuracy
    python local-stt-server.py --model medium  # slower, better accuracy
    python local-stt-server.py --tts-engine edge --tts-voice zh-CN-YunxiNeural

The local voice model lives in ./models (zh_CN-huayan-medium.onnx, ~60 MB, from
the rhasspy/piper-voices repository); download it once and it is reused forever.

Then open the pet's keyboard bubble, press the gear, and either leave the
endpoint blank (it auto-detects http://127.0.0.1:8756/...) or paste the URL.

Check it is alive:
    curl http://127.0.0.1:8756/health
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import sys
import time
import email
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL = None
MODEL_NAME = "?"
LANGUAGE = "zh"
VERBOSE = False
# Decoding defaults.
#
# `initial_prompt` biases vocabulary *and* punctuation: Whisper treats it as
# preceding context, so domain words stop being heard as homophones (「银月」
# becomes 「音乐」) and the transcript keeps its 。，？ instead of arriving as one
# bare run of characters.
DEFAULT_PROMPT = (
    "以下是与桌面电子宠物「银月」的中文对话。常用词：银月、深鲸、探机器、"
    "电子宠物、语音输入、麦克风、任务、代码、文件、终端、会话。"
)
PROMPT = DEFAULT_PROMPT
# Beam width. 1 is pure greedy decoding — noticeably less accurate on short
# clips, which is exactly the shape of a spoken pet command.
BEAM = 5
# Neural voice used by the online engine. Xiaoxiao is the warmest of the six
# zh-CN neural voices Microsoft serves.
DEFAULT_TTS_VOICE = "zh-CN-XiaoxiaoNeural"
TTS_VOICE = DEFAULT_TTS_VOICE
# Which speech engine /v1/audio/speech uses: edge, piper, auto, or off.
#
# Measured on this class of machine: the offline Piper voice runs at RTF 0.03 but
# sounds mechanical, while the online neural voice is markedly more natural.
# Quality wins as the default, and choosing otherwise is one flag away:
#   --tts-engine piper  → fully offline, nothing leaves the machine
#   --tts-engine auto   → offline first, online only as a fallback
DEFAULT_TTS_ENGINE = "edge"
TTS_ENGINE = DEFAULT_TTS_ENGINE
# Where the local ONNX voice lives; set in main() to sit beside this script.
TTS_MODEL_DIR = ""
PIPER_VOICE = None

DOWNLOAD_HELP = """
[stt] the model could not be fetched.
      On a restricted network HuggingFace's xet transfer service often answers
      "401 Unauthorized" (cas-server.xethub.hf.co). Three ways out, easiest first:

  1) use the mirror — recommended in mainland China:
       $env:HF_ENDPOINT = "https://hf-mirror.com"
       python local-stt-server.py

  2) pass it as a flag (xet is already disabled by this script):
       python local-stt-server.py --hf-endpoint https://hf-mirror.com

  3) download the snapshot by hand once, then load it from disk:
       python local-stt-server.py --model-dir D:\\models\\faster-whisper-small
     (any folder containing model.bin + config.json + tokenizer.json works)
"""


def hub_reachable(timeout: float = 4.0) -> bool:
    """Whether huggingface.co actually answers (a TCP connect is not enough —
    restricted networks often accept the socket and then drop the request)."""
    import urllib.request

    try:
        request = urllib.request.Request("https://huggingface.co/api/models?limit=1")
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return 200 <= response.status < 500
    except Exception:  # noqa: BLE001 - any failure means "not reachable"
        return False


def parse_multipart(body: bytes, content_type: str) -> dict[str, bytes]:
    """Extract {field_name: raw_bytes} from a multipart/form-data body.

    Uses the stdlib email parser so the script needs no web framework (the old
    `cgi` module it would otherwise use is gone in Python 3.13).
    """
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode()
    message = email.message_from_bytes(header + body, policy=HTTP)
    fields: dict[str, bytes] = {}
    if not message.is_multipart():
        return fields
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not name:
            continue
        payload = part.get_payload(decode=True)
        if payload is not None:
            fields[name] = payload
    return fields


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "PetWhisper/1.0"

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003 - stdlib signature
        sys.stderr.write("[stt] " + (fmt % args) + "\n")

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def _send_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib signature
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802 - stdlib signature
        if self.path.startswith("/health"):
            self._send_json(200, {"ok": True, "model": MODEL_NAME, "tts": TTS_ENGINE, "voice": TTS_VOICE})
        else:
            self._send_json(404, {"error": "unknown path"})

    def _speak(self) -> None:
        """Answer with synthesized speech, following the OpenAI /v1/audio/speech shape."""
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json(400, {"error": "expected a JSON body"})
            return
        text = payload.get("input") if isinstance(payload, dict) else None
        if not isinstance(text, str) or text.strip() == "":
            self._send_json(400, {"error": "missing 'input' text"})
            return
        requested = payload.get("voice") if isinstance(payload, dict) else None
        voice = requested if isinstance(requested, str) and requested else TTS_VOICE

        # `auto` prefers the on-machine voice: the reply text is private, and it
        # is fast enough that the answer starts immediately. The online voice is
        # only reached when the local model genuinely cannot be used.
        engines = ["piper", "edge"] if TTS_ENGINE == "auto" else [TTS_ENGINE]
        audio = None
        content_type = "audio/wav"
        failures: list[str] = []
        for engine in engines:
            if engine == "off":
                failures.append("off: speech is disabled by --tts-engine off")
                continue
            try:
                if engine == "piper":
                    audio = synthesize_local(text)
                    content_type = "audio/wav"
                else:
                    audio = synthesize_neural(text, str(voice))
                    content_type = "audio/mpeg"
                sys.stderr.write(f"[stt] tts {len(text)} chars -> {len(audio) / 1024:.0f} KiB ({engine})\n")
                break
            except ImportError as error:
                failures.append(f"{engine}: not installed ({error})")
            except Exception as error:  # noqa: BLE001 - the message is the whole point
                failures.append(f"{engine}: {type(error).__name__}: {error}")
        if audio is None:
            detail = "; ".join(failures) or "no speech engine is configured"
            sys.stderr.write(f"[stt] tts failed: {detail}\n")
            self._send_json(503, {"error": f"speech synthesis unavailable ({detail})"})
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(audio)))
        self._cors()
        self.end_headers()
        self.wfile.write(audio)

    def do_POST(self) -> None:  # noqa: N802 - stdlib signature
        if self.path.startswith("/v1/audio/speech"):
            self._speak()
            return
        accepted = ("/v1/audio/transcriptions", "/inference")
        if not any(self.path.startswith(prefix) for prefix in accepted):
            self._send_json(404, {"error": "unknown path"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        fields = parse_multipart(body, self.headers.get("Content-Type", ""))
        audio = fields.get("file")
        if not audio:
            # The pet's reachability probe deliberately posts nothing, so a 400
            # here is expected and simply means "the endpoint is alive".
            self._send_json(400, {"error": "missing 'file' part"})
            return
        started = time.time()
        try:
            segments, _info = MODEL.transcribe(  # type: ignore[union-attr]
                io.BytesIO(audio),
                language=LANGUAGE,
                beam_size=BEAM,
                initial_prompt=PROMPT or None,
                vad_filter=True,
            )
            text = "".join(segment.text for segment in segments).strip()
        except Exception as error:  # noqa: BLE001 - surface anything to the client
            # A clip the decoder cannot read is a client-input problem, not a
            # server fault: answer 400 with the decoder's own words, so the pet
            # can show a reason instead of a bare status code. Log it as well —
            # the response body alone is invisible in this service's own log.
            detail = f"{type(error).__name__}: {error}"
            sys.stderr.write(f"[stt] decode failed ({len(audio)} bytes): {detail}\n")
            self._send_json(400, {"error": f"audio could not be decoded ({detail})"})
            return
        elapsed = time.time() - started
        sys.stderr.write(f"[stt] {len(audio) / 1024:.0f} KiB -> {elapsed:.1f}s : {text[:60]!r}\n")
        self._send_json(200, {"text": text})


# The bundled offline Chinese voice. Piper's zh_CN-huayan-medium is a
# single-speaker VITS model: less expressive than Microsoft's neural voices, but
# it runs at RTF 0.03 on this class of CPU and never leaves the machine.
PIPER_MODEL_NAME = "zh_CN-huayan-medium.onnx"


def load_piper():
    """Build the local ONNX voice on first use (about a second), then reuse it."""
    global PIPER_VOICE
    if PIPER_VOICE is not None:
        return PIPER_VOICE
    from piper import PiperVoice  # noqa: PLC0415 - optional dependency, deliberately lazy

    model = os.path.join(TTS_MODEL_DIR, PIPER_MODEL_NAME)
    if not os.path.exists(model):
        raise FileNotFoundError(
            f"local voice model missing at {model} "
            "(download zh_CN-huayan-medium.onnx from rhasspy/piper-voices)"
        )
    config = f"{model}.json"
    started = time.time()
    PIPER_VOICE = PiperVoice.load(model, config_path=config if os.path.exists(config) else None)
    sys.stderr.write(f"[stt] offline voice loaded in {time.time() - started:.2f}s ({PIPER_MODEL_NAME})\n")
    return PIPER_VOICE


def synthesize_local(text: str) -> bytes:
    """Synthesize with the bundled offline voice.
    @param text - the line to speak.
    @returns mono 16-bit WAV bytes.
    """
    import wave as wave_module  # noqa: PLC0415 - only this path needs it

    voice = load_piper()
    started = time.time()
    buffer = io.BytesIO()
    with wave_module.open(buffer, "wb") as handle:
        voice.synthesize_wav(text, handle)
    audio = buffer.getvalue()
    sys.stderr.write(f"[stt] offline tts {len(text)} chars in {time.time() - started:.2f}s\n")
    return audio


def synthesize_neural(text: str, voice: str) -> bytes:
    """Synthesize one line with Microsoft's neural voices through `edge-tts`.

    `edge_tts` is imported lazily so transcription keeps working on a machine
    that never installed the optional package; the caller turns the ImportError
    into a 503 that names the fix.
    @param text - the line to speak.
    @param voice - a `zh-CN-*Neural` short name.
    @returns MP3 bytes.
    """
    import edge_tts  # noqa: PLC0415 - optional dependency, deliberately lazy

    async def collect() -> bytes:
        communicate = edge_tts.Communicate(text, voice)
        audio = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.extend(chunk["data"])
        return bytes(audio)

    return asyncio.run(collect())


def main() -> int:
    global MODEL, MODEL_NAME, LANGUAGE, VERBOSE, PROMPT, BEAM, TTS_VOICE, TTS_ENGINE, TTS_MODEL_DIR
    parser = argparse.ArgumentParser(description="Local Whisper STT for the DSH pet.")
    parser.add_argument("--model", default="small", help="tiny/base/small/medium/large-v3")
    parser.add_argument("--model-dir", default=None, help="load a pre-downloaded model folder")
    parser.add_argument("--lang", default="zh", help="spoken language code")
    parser.add_argument("--beam", type=int, default=BEAM, help="beam search width; 1 = greedy (fastest)")
    parser.add_argument(
        "--prompt",
        default=DEFAULT_PROMPT,
        help="vocabulary hint that biases decoding; pass an empty string to disable",
    )
    parser.add_argument(
        "--tts-voice",
        default=DEFAULT_TTS_VOICE,
        help="neural voice for the edge engine, e.g. zh-CN-XiaoxiaoNeural or zh-CN-YunxiNeural",
    )
    parser.add_argument(
        "--tts-engine",
        default=DEFAULT_TTS_ENGINE,
        choices=("auto", "piper", "edge", "off"),
        help="speech engine for /v1/audio/speech; auto prefers the offline voice",
    )
    parser.add_argument(
        "--tts-model-dir",
        default=None,
        help="directory holding the offline voice model (default: ./models beside this script)",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8756)
    parser.add_argument("--device", default="auto", help="auto/cpu/cuda")
    parser.add_argument("--compute-type", default="int8", help="int8/float16/float32")
    parser.add_argument(
        "--hf-endpoint",
        default=None,
        help="HuggingFace endpoint to download from, e.g. https://hf-mirror.com",
    )
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    LANGUAGE = args.lang
    VERBOSE = args.verbose
    PROMPT = args.prompt
    BEAM = max(1, args.beam)
    TTS_VOICE = args.tts_voice
    TTS_ENGINE = args.tts_engine
    TTS_MODEL_DIR = args.tts_model_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "models"
    )
    sys.stderr.write(f"[stt] decoding: beam={BEAM} lang={LANGUAGE} prompt={'on' if PROMPT else 'off'}\n")
    sys.stderr.write(f"[stt] tts engine: {TTS_ENGINE} (offline models in {TTS_MODEL_DIR})\n")
    sys.stderr.write(f"[stt] online voice: {TTS_VOICE}\n")

    # Must be set before huggingface_hub is imported. The xet transfer service
    # is a common failure point behind proxies/firewalls; the classic HTTPS
    # download path is far more forgiving. setdefault keeps an explicit override.
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    if args.hf_endpoint:
        os.environ["HF_ENDPOINT"] = args.hf_endpoint
    # huggingface_hub reads HF_ENDPOINT at import time, so a blocked Hub has to
    # be detected *before* faster_whisper is imported. The switch is announced,
    # never silent: a mirror is still a third party.
    if args.model_dir is None and os.environ.get("HF_ENDPOINT") is None:
        if not hub_reachable():
            os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
            sys.stderr.write(
                "[stt] huggingface.co is unreachable — falling back to https://hf-mirror.com\n"
                "[stt] (pass --hf-endpoint to choose a different mirror, or --model-dir to go offline)\n"
            )
    endpoint = os.environ.get("HF_ENDPOINT")
    if endpoint:
        sys.stderr.write(f"[stt] using HuggingFace endpoint {endpoint}\n")

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.stderr.write("faster-whisper is missing. Install it first:\n    pip install faster-whisper\n")
        return 2

    source = args.model_dir if args.model_dir else args.model
    MODEL_NAME = str(source)
    sys.stderr.write(f"[stt] loading model {source} ({args.device}/{args.compute_type})…\n")
    try:
        MODEL = WhisperModel(source, device=args.device, compute_type=args.compute_type)
    except Exception as error:  # noqa: BLE001 - the message is the whole point
        sys.stderr.write(f"\n[stt] load failed: {type(error).__name__}: {error}\n")
        if args.model_dir:
            sys.stderr.write("[stt] check that --model-dir points at a complete snapshot.\n")
        else:
            sys.stderr.write(DOWNLOAD_HELP)
        return 3

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    sys.stderr.write(
        f"[stt] ready on http://{args.host}:{args.port}/v1/audio/transcriptions\n"
        f"[stt] leave the pet's endpoint blank to auto-detect it; Ctrl+C to stop.\n"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("\n[stt] bye\n")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
