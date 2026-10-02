"""WAV normalisation: whatever the browser sends becomes 16 kHz / mono / 16-bit PCM."""
from __future__ import annotations

import io
import shutil
import subprocess

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

TARGET_SR = 16000


def _ffmpeg_convert(raw: bytes) -> bytes | None:
    if shutil.which("ffmpeg") is None:
        return None
    proc = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", "pipe:0",
            "-ac", "1", "-ar", str(TARGET_SR), "-sample_fmt", "s16",
            "-f", "wav", "pipe:1",
        ],
        input=raw,
        capture_output=True,
    )
    if proc.returncode != 0 or not proc.stdout:
        return None
    return proc.stdout


def _python_convert(raw: bytes) -> bytes:
    data, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    if sr != TARGET_SR:
        from math import gcd

        g = gcd(sr, TARGET_SR)
        mono = resample_poly(mono, TARGET_SR // g, sr // g).astype(np.float32)
    mono = np.clip(mono, -1.0, 1.0)
    out = io.BytesIO()
    sf.write(out, mono, TARGET_SR, subtype="PCM_16", format="WAV")
    return out.getvalue()


def normalize_wav(raw: bytes) -> tuple[bytes, float]:
    """Returns (wav_bytes, duration_seconds)."""
    converted = _ffmpeg_convert(raw)
    if converted is None:
        converted = _python_convert(raw)
    info = sf.info(io.BytesIO(converted))
    if info.samplerate != TARGET_SR or info.channels != 1 or info.subtype != "PCM_16":
        converted = _python_convert(converted)
        info = sf.info(io.BytesIO(converted))
    return converted, float(info.frames) / info.samplerate


def speech_bounds(audio: np.ndarray, sr: int, threshold_db: float = -32.0) -> tuple[int, int] | None:
    """First and last sample of the spoken part, or None when there is no sound.

    The threshold is relative to the loudest 10 ms frame but never inside the room noise: a quiet take with an
    audible noise floor would otherwise count as speech from the first frame to the last. The noise term is
    capped so a take that is speech from edge to edge still has a spoken part.
    """
    n = audio.shape[0]
    frame = max(1, sr // 100)
    if n < frame * 10:
        return None
    rms = np.sqrt((audio[: (n // frame) * frame].reshape(-1, frame) ** 2).mean(axis=1) + 1e-12)
    peak = float(rms.max())
    if peak < 1e-3:
        return None
    noise = float(np.percentile(rms, 10))
    threshold = max(peak * 10 ** (threshold_db / 20.0), min(noise * 10 ** (15 / 20.0), peak * 0.25), 0.004)
    active = np.where(rms > threshold)[0]
    if active.size == 0:
        return None
    return int(active[0]) * frame, (int(active[-1]) + 1) * frame


def levels(audio: np.ndarray, sr: int) -> tuple[float | None, float | None]:
    """Loudness of the spoken part and of the quiet part (dBFS), to compare takes with each other."""
    frame = max(1, sr // 100)
    n = audio.shape[0]
    if n < frame * 10:
        return None, None
    rms = np.sqrt((audio[: (n // frame) * frame].reshape(-1, frame) ** 2).mean(axis=1) + 1e-12)
    peak = float(rms.max())
    if peak < 1e-3:
        return None, None
    speech = rms[rms > peak * 10 ** (-20 / 20.0)]
    pauses = rms[rms < peak * 10 ** (-30 / 20.0)]
    speech_db = round(float(20 * np.log10(speech.mean())), 1)
    if pauses.size < 10:  # less than 0.1 s of quiet: no reliable noise floor
        return speech_db, None
    return speech_db, round(float(20 * np.log10(pauses.mean())), 1)


def trim_edges(wav: bytes, keep_ms: int = 250, min_silence_ms: int = 350, threshold_db: float = -32.0) -> tuple[bytes, float]:
    """Removes long silence at the start/end of a recording (keeps ``keep_ms`` of context around the speech).

    Recordings now stop automatically after the word, but the beginning often contains a second of silence
    while the person gets ready; trimming keeps the dataset compact and the quality checks meaningful.
    """
    data, sr = sf.read(io.BytesIO(wav), dtype="float32", always_2d=True)
    audio = data[:, 0]
    n = audio.shape[0]
    bounds = speech_bounds(audio, sr, threshold_db)
    if bounds is None:
        return wav, n / sr
    keep = int(sr * keep_ms / 1000)
    start = max(0, bounds[0] - keep)
    end = min(n, bounds[1] + keep)
    min_silence = int(sr * min_silence_ms / 1000)
    if start < min_silence and n - end < min_silence:
        return wav, n / sr
    trimmed = audio[start:end]
    out = io.BytesIO()
    sf.write(out, trimmed, sr, subtype="PCM_16", format="WAV")
    return out.getvalue(), trimmed.shape[0] / sr


def wav_duration(path) -> float:
    try:
        info = sf.info(str(path))
        return float(info.frames) / info.samplerate
    except Exception:
        return 0.0
