"""Fills the current project of a running instance with synthetic 'word-like' clips, for tests and screenshots.

Runs inside the container (numpy, soundfile and requests are there):
    docker compose -p ww-test exec app python /app/scripts/demo_data.py
No real speech is involved: a wake-word-like three-syllable sound for positives, other patterns for negatives.
Never point it at a project you care about.
"""
import io
import os
import sys

import numpy as np
import requests
import soundfile as sf

API = os.environ.get("API", "http://127.0.0.1:8000")
POSITIVE = int(sys.argv[1]) if len(sys.argv) > 1 else 32
NEGATIVE = int(sys.argv[2]) if len(sys.argv) > 2 else 8
SR = 16000
rng = np.random.default_rng(1)


def word(f0: float, pattern: int, dur: float) -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    f = f0 * (1 + 0.15 * np.sin(2 * np.pi * 1.5 * t))  # a pitch contour with a few harmonics
    phase = 2 * np.pi * np.cumsum(f) / SR
    sig = sum((0.6 / k) * np.sin(k * phase) for k in range(1, 6))
    syllables = np.abs(np.sin(np.pi * pattern * t / dur)) ** 0.5
    env = np.minimum(1, t / 0.05) * np.minimum(1, (dur - t) / 0.08)
    bursts = rng.standard_normal(t.size) * 0.15 * (np.sin(2 * np.pi * pattern * t / dur) > 0.95)  # 'consonants'
    return (sig * syllables * env + bursts).astype(np.float32)


def clip(kind: str) -> bytes:
    total = np.zeros(int(2.0 * SR), np.float32)
    if kind == "positive":
        w = word(rng.uniform(110, 220), 3, rng.uniform(0.55, 0.85))
    else:
        w = word(rng.uniform(90, 260), int(rng.choice([1, 2, 5])), rng.uniform(0.3, 1.2))
    start = int(rng.uniform(0.35, 0.6) * SR)
    total[start : start + w.size] += w[: total.size - start] * rng.uniform(0.3, 0.6)
    total += rng.standard_normal(total.size).astype(np.float32) * 0.002
    buf = io.BytesIO()
    sf.write(buf, np.clip(total, -1, 1), SR, subtype="PCM_16", format="WAV")
    return buf.getvalue()


for kind, count in (("positive", POSITIVE), ("negative", NEGATIVE)):
    for i in range(count):
        res = requests.post(f"{API}/api/recordings", data={"kind": kind}, files={"file": (f"{kind}_{i:02d}.wav", clip(kind), "audio/wav")})
        res.raise_for_status()
print("recordings:", requests.get(f"{API}/api/recordings/counts").json())
