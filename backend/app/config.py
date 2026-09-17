from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


# Load only local configuration; real environment variables keep priority.
load_dotenv()


@dataclass(frozen=True)
class Settings:
    admin_password: str = os.getenv("ADMIN_PASSWORD", "navi-demo")
    database_path: Path = Path(os.getenv("DATABASE_PATH", "./data/navi.sqlite3"))
    summary_ttl_minutes: int = int(os.getenv("SUMMARY_TTL_MINUTES", "30"))
    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
    ollama_enabled: bool = os.getenv("OLLAMA_ENABLED", "false").lower() == "true"
    public_data_api_key: str | None = os.getenv("PUBLIC_DATA_API_KEY") or None
    public_data_mode: str = os.getenv("PUBLIC_DATA_MODE", "auto").lower()
    public_data_timeout_seconds: float = float(os.getenv("PUBLIC_DATA_TIMEOUT_SECONDS", "5"))
    public_data_cache_minutes: int = int(os.getenv("PUBLIC_DATA_CACHE_MINUTES", "360"))
    public_data_max_pages: int = int(os.getenv("PUBLIC_DATA_MAX_PAGES", "20"))
    public_data_local_sido: str | None = os.getenv("PUBLIC_DATA_LOCAL_SIDO") or None
    public_data_local_sigungu: str | None = os.getenv("PUBLIC_DATA_LOCAL_SIGUNGU") or None
    musetalk_api_url: str | None = os.getenv("MUSETALK_API_URL") or None
    navi_api_public_url: str = os.getenv("NAVI_API_PUBLIC_URL", "http://127.0.0.1:8000")
    tts_provider: str = os.getenv("TTS_PROVIDER", "auto")
    tts_edge_voice_ko: str = os.getenv("TTS_EDGE_VOICE_KO", "ko-KR-SunHiNeural")
    tts_melo_device: str = os.getenv("TTS_MELO_DEVICE", "cpu")
    tts_melo_speaker_ko: str = os.getenv("TTS_MELO_SPEAKER_KO", "KR")
    tts_melo_speed: float = float(os.getenv("TTS_MELO_SPEED", "1.0"))
    tts_melo_api_url: str | None = os.getenv("TTS_MELO_API_URL") or None
    stt_model: str = os.getenv("STT_MODEL", "medium")
    stt_device: str = os.getenv("STT_DEVICE", "cpu")
    stt_compute_type: str = os.getenv("STT_COMPUTE_TYPE", "int8")
    wake_word_enabled: bool = os.getenv("WAKE_WORD_ENABLED", "false").lower() == "true"
    wake_word_model_path: Path = Path(os.getenv("WAKE_WORD_MODEL_PATH", "./models/naruya.onnx"))
    wake_word_threshold: float = float(os.getenv("WAKE_WORD_THRESHOLD", "0.5"))


settings = Settings()
