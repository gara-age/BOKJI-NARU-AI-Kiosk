from pathlib import Path

import numpy as np

from app.config import Settings
from app.schemas import SpeechRequest
from app.services import TranscriptionService, WakeWordService


def test_voice_defaults_use_medium_whisper_and_safe_cpu_mode() -> None:
    configured = Settings()

    assert configured.stt_model == "medium"
    assert configured.stt_device == "cpu"
    assert configured.stt_compute_type == "int8"
    assert configured.stt_cpu_threads == 4
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


def test_transcription_closes_and_removes_temporary_recording() -> None:
    service = TranscriptionService(Settings())
    seen: list[Path] = []

    class Decoder:
        def transcribe(self, path: str, **_kwargs: object) -> tuple[list[object], None]:
            source = Path(path)
            assert source.read_bytes() == b"recorded-audio"
            seen.append(source)
            return [type("Segment", (), {"text": "안녕하세요"})()], None

    service.model = Decoder()

    assert service.transcribe(b"recorded-audio", ".m4a") == "안녕하세요"
    assert seen and not seen[0].exists()


def test_wake_word_ignores_ambient_noise_before_sustained_voice(tmp_path: Path) -> None:
    model_path = tmp_path / "naruya.onnx"
    model_path.write_bytes(b"test-model")
    service = WakeWordService(Settings(wake_word_enabled=True, wake_word_model_path=model_path, wake_word_threshold=0.75, wake_word_min_rms=0.02))

    class HighScoringModel:
        def predict(self, _frame: np.ndarray) -> dict[str, float]:
            return {"naruya": 0.99}

    service._model = HighScoringModel()
    ambient = np.full(service.frame_samples, 300, dtype=np.int16).tobytes()
    voice = np.full(service.frame_samples, 5000, dtype=np.int16).tobytes()

    assert all(service.detect(ambient) is None for _ in range(30))
    assert service.detect(voice) is None
    assert service.detect(voice) == 0.99
