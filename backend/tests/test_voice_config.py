from pathlib import Path

from app.config import Settings
from app.schemas import SpeechRequest
from app.services import WakeWordService


def test_voice_defaults_use_medium_whisper_and_safe_cpu_mode() -> None:
    configured = Settings()

    assert configured.stt_model == "medium"
    assert configured.stt_device == "cpu"
    assert configured.stt_compute_type == "int8"
    assert configured.tts_provider == "auto"
    assert configured.tts_melo_api_url is None


def test_wake_word_stays_unavailable_without_an_enabled_model(tmp_path: Path) -> None:
    service = WakeWordService(
        Settings(wake_word_enabled=True, wake_word_model_path=tmp_path / "naruya.onnx")
    )

    status = service.status()

    assert status["ready"] is False
    assert status["enabled"] is True
    assert status["reason"]


def test_speech_request_can_select_an_edge_voice() -> None:
    request = SpeechRequest(text="안내 음성을 확인합니다.", voice="ko-KR-InJoonNeural")

    assert request.voice == "ko-KR-InJoonNeural"
