"""Local Whisper speech-to-text service for Voxa.

GET  /health      -> {"ok": true, "model": "<name>"}
POST /transcribe  -> raw audio bytes in, {"text", "seconds", "audio_seconds"} out

The model is loaded once at import and kept warm, so each request only pays the decode.
"""
import json
import os
import subprocess
import tempfile
import threading
import re
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("STT_MODEL", "base")
PORT = int(os.environ.get("STT_PORT", "8897"))
HOST = os.environ.get("STT_HOST", "127.0.0.1")
THREADS = int(os.environ.get("STT_THREADS", str(min(os.cpu_count() or 2, 4))))
MAX_BYTES = 25 * 1024 * 1024
TOKEN = os.environ.get("STT_TOKEN", "")
SAMPLE_RATE = 16000

print(f"[stt] loading faster-whisper '{MODEL_NAME}' on cpu, int8, {THREADS} threads", flush=True)
_t = time.time()
MODEL = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=THREADS)
print(f"[stt] model ready in {time.time() - _t:.1f}s", flush=True)
DECODE_LOCK = threading.Lock()


def _decode_in_process(raw: bytes):
    """Returns float32 mono 16k audio, or None if this build cannot read the input."""
    try:
        import av
    except ImportError:
        return None
    try:
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "input.bin"
            src.write_bytes(raw)
            pieces = []
            with av.open(str(src)) as container:
                if not container.streams.audio:
                    return None
                stream = container.streams.audio[0]
                resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
                for frame in container.decode(stream):
                    for out in resampler.resample(frame):
                        pieces.append(out.to_ndarray().reshape(-1))
                for out in resampler.resample(None):
                    pieces.append(out.to_ndarray().reshape(-1))
        if not pieces:
            return None
        return np.concatenate(pieces).astype(np.float32) / 32768.0
    except Exception as error:  # noqa: BLE001
        print(f"[stt] in-process decode failed ({error}), using ffmpeg", flush=True)
        return None


def _decode_with_ffmpeg(raw: bytes):
    try:
        proc = subprocess.run(
            ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", "pipe:0",
             "-f", "s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"],
            input=raw, capture_output=True, timeout=30, check=True,
        )
    except Exception as error:  # noqa: BLE001
        print(f"[stt] ffmpeg decode failed ({error})", flush=True)
        return None
    if not proc.stdout:
        return None
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def transcribe(raw: bytes, language: str = "en") -> dict:
    started = time.time()
    audio = _decode_in_process(raw)
    if audio is None:
        audio = _decode_with_ffmpeg(raw)
    if audio is None or audio.size == 0:
        return {"text": "", "seconds": round(time.time() - started, 3), "audio_seconds": 0.0}
    with DECODE_LOCK:
        # Pass the array, never a filename (bundled PyAV mismatch crashes on some installs).
        segments, _info = MODEL.transcribe(
            audio,
            language=language,
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
    return {
        "text": text,
        "seconds": round(time.time() - started, 3),
        "audio_seconds": round(audio.size / SAMPLE_RATE, 3),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "VoxaSTT/1.0"

    def _json(self, status: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") == "/health":
            self._json(200, {"ok": True, "model": MODEL_NAME})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if TOKEN and self.headers.get("Authorization", "") != f"Bearer {TOKEN}":
            self._json(401, {"error": "unauthorized"})
            return
        url = urlparse(self.path)
        if url.path.rstrip("/") != "/transcribe":
            self._json(404, {"error": "not found"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._json(400, {"error": "empty body"})
            return
        if length > MAX_BYTES:
            self._json(413, {"error": "too large"})
            return
        raw = self.rfile.read(length)
        try:
            lang = (parse_qs(url.query).get("lang") or ["en"])[0]
            if not re.fullmatch(r"[a-z]{2,3}", lang):
                lang = "en"
            self._json(200, transcribe(raw, lang))
        except Exception as error:  # noqa: BLE001
            print(f"[stt] transcribe failed: {error}", flush=True)
            self._json(500, {"error": "transcribe failed"})

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[stt] listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()
