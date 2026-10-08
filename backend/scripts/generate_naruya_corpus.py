"""Generate a Korean prototype corpus for the local '나루야' wake-word model."""

from __future__ import annotations

import argparse
import asyncio
import json
import random
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import edge_tts


DEFAULT_ROOT = Path(r"D:\NaviWakeWord")
TARGET_PHRASES = (
    "나루야", "나루야", "나루야", "나루야 도와줘", "나루야 안내해 줘",
    "안녕 나루야", "저기 나루야", "나루야 잠깐만", "나루야 도와 줄래",
)
NEGATIVE_PHRASES = (
    "나무야", "하루야", "나리야", "나루", "나야", "나라야", "나도야",
    "나루아", "나로야", "나루야야", "안녕하세요", "도움이 필요해요",
    "기초생활 지원이 궁금해요", "주민센터는 어디에 있나요", "신청 서류를 알려 주세요",
    "오늘 날씨가 어떤가요", "직원 상담을 받고 싶어요", "복지 서비스를 찾고 있어요",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_status(path: Path, **values: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    current: dict[str, object] = {}
    if path.exists():
        try:
            current = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    current.update(values)
    current["updated_at"] = utc_now()
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


async def korean_voices() -> list[str]:
    try:
        voices = await edge_tts.list_voices()
        names = [str(voice["ShortName"]) for voice in voices if str(voice.get("Locale", "")).lower() == "ko-kr"]
        if names:
            return names
    except Exception:
        pass
    return ["ko-KR-SunHiNeural", "ko-KR-InJoonNeural"]


async def create_clip(text: str, voice: str, output: Path, rate: str, pitch: str, semaphore: asyncio.Semaphore) -> None:
    if output.exists():
        return
    async with semaphore:
        with tempfile.TemporaryDirectory(prefix="naruya-") as temp_dir:
            mp3 = Path(temp_dir) / "speech.mp3"
            await edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch).save(str(mp3))
            command = [
                "ffmpeg", "-y", "-loglevel", "error", "-i", str(mp3), "-ac", "1", "-ar", "16000",
                "-c:a", "pcm_s16le", str(output),
            ]
            subprocess.run(command, check=True)


async def generate_group(
    output_dir: Path,
    phrases: tuple[str, ...],
    count: int,
    voices: list[str],
    status_path: Path,
    label: str,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    pending = [index for index in range(count) if not (output_dir / f"{index:05d}.wav").exists()]
    completed = count - len(pending)
    write_status(status_path, phase="corpus", current_group=label, completed=completed, total=count, state="running")
    semaphore = asyncio.Semaphore(3)
    rates = ("-12%", "-6%", "+0%", "+6%", "+12%")
    pitches = ("-8Hz", "-4Hz", "+0Hz", "+4Hz", "+8Hz")

    async def one(index: int) -> None:
        nonlocal completed
        random.seed(f"{label}-{index}")
        phrase = random.choice(phrases)
        await create_clip(phrase, random.choice(voices), output_dir / f"{index:05d}.wav", random.choice(rates), random.choice(pitches), semaphore)
        completed += 1
        if completed % 10 == 0 or completed == count:
            write_status(status_path, phase="corpus", current_group=label, completed=completed, total=count, state="running")

    for start in range(0, len(pending), 12):
        await asyncio.gather(*(one(index) for index in pending[start:start + 12]))


async def main() -> None:
    parser = argparse.ArgumentParser(description="Create a resumable Korean wake-word corpus with Edge TTS.")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--model-name", default="naruya")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--status-path", type=Path)
    parser.add_argument("--train-count", type=int, default=400)
    parser.add_argument("--validation-count", type=int, default=100)
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg가 필요합니다. WinGet으로 설치된 ffmpeg 경로를 확인해 주세요.")

    model_dir = args.output_dir or args.root / "output" / args.model_name
    status_path = args.status_path or args.root / "status.json"
    write_status(status_path, phase="corpus", state="starting", model=args.model_name, target_phrase="나루야")
    voices = await korean_voices()
    await generate_group(model_dir / "positive_train", TARGET_PHRASES, args.train_count, voices, status_path, "positive_train")
    await generate_group(model_dir / "negative_train", NEGATIVE_PHRASES, args.train_count, voices, status_path, "negative_train")
    await generate_group(model_dir / "positive_test", TARGET_PHRASES, args.validation_count, voices, status_path, "positive_test")
    await generate_group(model_dir / "negative_test", NEGATIVE_PHRASES, args.validation_count, voices, status_path, "negative_test")
    write_status(status_path, phase="corpus", state="complete", voices=voices, output_dir=str(model_dir))


if __name__ == "__main__":
    asyncio.run(main())
