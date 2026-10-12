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

# English uses the fast "base" model. Hindi and other languages use a larger multilingual
# model ("small" by default): "base" mangles Indian languages. Set STT_MODEL_MULTI=base to
# share one model, or "medium" for more accuracy on a bigger box.
MULTI_MODEL_NAME = os.environ.get("STT_MODEL_MULTI", "small")
PRELOAD_MULTI = os.environ.get("STT_PRELOAD_MULTI", "1") != "0"


def _load(name: str) -> WhisperModel:
    print(f"[stt] loading faster-whisper '{name}' on cpu, int8, {THREADS} threads", flush=True)
    t0 = time.time()
    model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=THREADS)
    print(f"[stt] '{name}' ready in {time.time() - t0:.1f}s", flush=True)
    return model


MODEL = _load(MODEL_NAME)
_MULTI = MODEL if MULTI_MODEL_NAME == MODEL_NAME else None
_MULTI_LOCK = threading.Lock()
DECODE_LOCK = threading.Lock()


def _multi_model() -> WhisperModel:
    global _MULTI
    if _MULTI is None:
        with _MULTI_LOCK:
            if _MULTI is None:
                _MULTI = _load(MULTI_MODEL_NAME)
    return _MULTI


if PRELOAD_MULTI and _MULTI is None:
    threading.Thread(target=_multi_model, daemon=True).start()

# Whisper invents these on silence, noise or breathing. Dropped when they are the whole clip.
HALLUCINATIONS = {
    "thank you", "thank you.", "thanks for watching", "thanks for watching!", "thank you for watching",
    "please subscribe", "subtitles by the amara.org community", "you", "bye", "bye.", ".", "...",
    "धन्यवाद", "धन्यवाद।", "शुक्रिया", "सब्सक्राइब करें", "please like and subscribe",
}


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


def _run(model: WhisperModel, audio, language):
    segments, info = model.transcribe(
        audio,
        language=language,
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
        without_timestamps=True,
    )
    kept = []
    for seg in segments:
        # Mostly-silence segments with low confidence are hallucinations, not speech.
        if seg.no_speech_prob > 0.6 and seg.avg_logprob < -0.9:
            continue
        kept.append(seg.text.strip())
    return " ".join(kept).strip(), info


def transcribe(raw: bytes, language: str = "en", alternates=()) -> dict:
    """Transcribe in `language`. With `alternates`, detect whether the caller switched to one of them."""
    started = time.time()
    audio = _decode_in_process(raw)
    if audio is None:
        audio = _decode_with_ffmpeg(raw)
    if audio is None or audio.size == 0:
        return {"text": "", "seconds": round(time.time() - started, 3), "audio_seconds": 0.0, "language": language}
    allowed = {language, *alternates}
    model = MODEL if allowed == {"en"} else _multi_model()
    with DECODE_LOCK:
        # Pass the array, never a filename (bundled PyAV mismatch crashes on some installs).
        if alternates:
            text, info = _run(model, audio, None)  # auto-detect
            detected = info.language
            if detected == "ur" and "hi" in allowed:
                detected = "hi"  # spoken Hindi and Urdu sound alike; keep the expected script
                text, info = _run(model, audio, "hi")
            elif detected not in allowed or info.language_probability < 0.5:
                detected = language
                text, info = _run(model, audio, language)
        else:
            detected = language
            text, info = _run(model, audio, language)
    audio_seconds = audio.size / SAMPLE_RATE
    if text.lower().strip() in HALLUCINATIONS and audio_seconds < 4:
        text = ""
    return {
        "text": text,
        "language": detected,
        "seconds": round(time.time() - started, 3),
        "audio_seconds": round(audio_seconds, 3),
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
            query = parse_qs(url.query)
            lang = (query.get("lang") or ["en"])[0]
            if not re.fullmatch(r"[a-z]{2,3}", lang):
                lang = "en"
            alts = tuple(
                a for a in (query.get("alt") or [""])[0].split(",")
                if re.fullmatch(r"[a-z]{2,3}", a) and a != lang
            )[:3]
            self._json(200, transcribe(raw, lang, alts))
        except Exception as error:  # noqa: BLE001
            print(f"[stt] transcribe failed: {error}", flush=True)
            self._json(500, {"error": "transcribe failed"})

    def log_message(self, fmt, *args):
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[stt] listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()
