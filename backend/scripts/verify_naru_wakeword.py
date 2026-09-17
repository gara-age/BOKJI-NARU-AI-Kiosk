from __future__ import annotations

import argparse
import wave
from pathlib import Path

import numpy as np
from openwakeword.model import Model


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate a 나루야 OpenWakeWord ONNX model against one WAV file.")
    parser.add_argument("audio", type=Path, help="16 kHz, mono, 16-bit PCM WAV file")
    parser.add_argument("--model", type=Path, default=Path("models/naruya.onnx"))
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()

    with wave.open(str(args.audio), "rb") as source:
        if source.getframerate() != 16_000 or source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise SystemExit("Use a 16 kHz, mono, 16-bit PCM WAV file.")
        audio = np.frombuffer(source.readframes(source.getnframes()), dtype=np.int16)

    detector = Model(wakeword_models=[str(args.model)])
    peak = 0.0
    for start in range(0, len(audio) - 1_280 + 1, 1_280):
        score = max(float(value) for value in detector.predict(audio[start:start + 1_280]).values())
        peak = max(peak, score)
    print(f"peak_score={peak:.3f} threshold={args.threshold:.3f} activated={peak >= args.threshold}")
    return 0 if peak >= args.threshold else 1


if __name__ == "__main__":
    raise SystemExit(main())
