from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    admin_password: str = os.getenv("ADMIN_PASSWORD", "navi-demo")
    database_path: Path = Path(os.getenv("DATABASE_PATH", "./data/navi.sqlite3"))
    summary_ttl_minutes: int = int(os.getenv("SUMMARY_TTL_MINUTES", "30"))
    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
    ollama_enabled: bool = os.getenv("OLLAMA_ENABLED", "false").lower() == "true"
    public_data_api_key: str | None = os.getenv("PUBLIC_DATA_API_KEY") or None
    musetalk_api_url: str | None = os.getenv("MUSETALK_API_URL") or None
    tts_provider: str = os.getenv("TTS_PROVIDER", "edge")
    tts_edge_voice_ko: str = os.getenv("TTS_EDGE_VOICE_KO", "ko-KR-SunHiNeural")
    stt_model: str = os.getenv("STT_MODEL", "small")


settings = Settings()
