from __future__ import annotations

import asyncio
import secrets
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from .config import Settings
from .official_info import OfficialInfoProvider
from .schemas import AvatarJobResponse, ClarificationOption, ConversationRequest, ConversationResponse, SpeechResponse
from .security import contains_sensitive_input, mask_sensitive_text, safe_staff_message
from .store import Store


KEYWORDS = {
    "basic": ("생활", "기초", "생계", "소득", "어려", "가난"),
    "emergency": ("긴급", "갑자기", "위기", "실직", "병", "퇴거"),
    "elder": ("어르신", "노인", "돌봄", "부모님", "치매"),
    "disability": ("장애", "활동지원", "활동 지원"),
    "youth": ("청년", "대학생", "취업준비", "청년월세"),
    "housing": ("주거", "월세", "임대", "전세", "주택", "보증금"),
    "employment": ("취업", "고용", "직업훈련", "일자리", "자활", "구직"),
    "pregnancy": ("임신", "출산", "산모", "영아", "첫만남"),
    "child": ("아동", "청소년", "보육", "돌봄", "방과후"),
    "education": ("교육", "장학", "학자금", "학습", "등록금"),
    "health": ("의료비", "건강", "질환", "치료", "병원비"),
    "mental": ("정신건강", "중독", "자살", "심리", "우울"),
    "family": ("한부모", "다문화", "가족", "양육비", "이주"),
    "veteran": ("보훈", "국가유공자", "북한이탈", "제대군인"),
    "local": ("지역복지", "마을", "복지관", "주민센터 프로그램"),
}

SUPPORT_OPTIONS = (
    ClarificationOption(value="basic", label="생활비·기초생활 지원"),
    ClarificationOption(value="emergency", label="갑작스러운 위기·긴급복지"),
    ClarificationOption(value="elder", label="어르신 돌봄"),
    ClarificationOption(value="disability", label="장애인 활동 지원"),
    ClarificationOption(value="youth", label="청년 주거·월세"),
    ClarificationOption(value="housing", label="주거·주택 지원"),
    ClarificationOption(value="employment", label="취업·자활·직업훈련"),
    ClarificationOption(value="pregnancy", label="임신·출산 지원"),
    ClarificationOption(value="child", label="아동·청소년 지원"),
    ClarificationOption(value="education", label="교육·장학 지원"),
    ClarificationOption(value="health", label="건강·의료비 지원"),
    ClarificationOption(value="mental", label="정신건강·중독 지원"),
    ClarificationOption(value="family", label="한부모·다문화·가족"),
    ClarificationOption(value="veteran", label="보훈·정착 지원"),
    ClarificationOption(value="local", label="지역 특화 복지"),
)
AGE_OPTIONS = tuple(ClarificationOption(value=value, label=value) for value in ("19세 이하", "20~34세", "35~64세", "65세 이상", "선택하지 않음"))


def classify_locally(text: str) -> str | None:
    normalized = text.replace(" ", "")
    scores = {category: sum(keyword.replace(" ", "") in normalized for keyword in words) for category, words in KEYWORDS.items()}
    category, score = max(scores.items(), key=lambda item: item[1])
    return category if score else None


class OllamaClassifier:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def classify(self, text: str) -> str | None:
        local = classify_locally(text)
        if not self.settings.ollama_enabled:
            return local
        categories = ", ".join(KEYWORDS)
        prompt = f"다음 한국어 복지 상담 문장을 {categories} 중 하나로만 분류하세요. 모르면 unknown.\n문장: " + text
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                response = await client.post(
                    f"{self.settings.ollama_base_url.rstrip('/')}/api/generate",
                    json={"model": self.settings.ollama_model, "prompt": prompt, "stream": False, "options": {"temperature": 0}},
                )
                answer = str(response.json().get("response", "")).lower()
        except (httpx.HTTPError, ValueError):
            return local
        return next((key for key in KEYWORDS if key in answer), local)


class ConversationService:
    def __init__(self, settings: Settings, store: Store, provider: OfficialInfoProvider) -> None:
        self.settings = settings
        self.store = store
        self.provider = provider
        self.classifier = OllamaClassifier(settings)

    async def respond(self, request: ConversationRequest) -> ConversationResponse:
        masked_text = mask_sensitive_text(request.text)
        sensitive = contains_sensitive_input(request.text)
        if request.session_id:
            return await self._continue(request, masked_text, sensitive)
        return await self._start(request, masked_text, sensitive)

    async def _start(self, request: ConversationRequest, masked_text: str, sensitive: bool) -> ConversationResponse:
        category = await self.classifier.classify(masked_text)
        if sensitive:
            session_id = self.store.create_session(masked_text, request.demographics.age_group, request.demographics.gender, True, pending_key="support_type")
            return ConversationResponse(
                session_id=session_id, masked_text=masked_text,
                assistant_text="개인정보는 안전하게 가렸습니다. 번호나 계좌 정보는 말씀하지 않아도 됩니다.",
                clarifying_question="어떤 종류의 도움이 필요한지 골라 주세요.",
                clarification_key="support_type", clarification_options=list(SUPPORT_OPTIONS), staff_handoff=True,
            )
        if category is None:
            session_id = self.store.create_session(masked_text, request.demographics.age_group, request.demographics.gender, True, pending_key="support_type")
            return ConversationResponse(
                session_id=session_id, masked_text=masked_text,
                assistant_text="도움이 필요한 상황을 확인하고 있습니다.",
                clarifying_question="가까운 상담 분야를 골라 주세요.",
                clarification_key="support_type", clarification_options=list(SUPPORT_OPTIONS), staff_handoff=True,
            )
        session_id = self.store.create_session(
            masked_text, request.demographics.age_group, request.demographics.gender, False,
            category=category, pending_key="age_group",
        )
        if request.demographics.age_group:
            self.store.update_session(session_id, age_group=request.demographics.age_group, pending_key="complete", handoff=True)
            return self._final_response(session_id, masked_text, category, request)
        return ConversationResponse(
            session_id=session_id,
            masked_text=masked_text,
            assistant_text="관련 상담 분야를 찾았습니다. 준비사항을 안내하기 전에 기본 정보 한 가지만 확인할게요.",
            clarifying_question="연령대를 골라 주세요. 정확한 자격 판정에는 사용하지 않습니다.",
            clarification_key="age_group",
            clarification_options=list(AGE_OPTIONS),
        )

    async def _continue(self, request: ConversationRequest, masked_text: str, sensitive: bool) -> ConversationResponse:
        session = self.store.get_session(request.session_id or "")
        if session is None:
            return ConversationResponse(
                session_id=request.session_id or "",
                masked_text=masked_text,
                assistant_text="이전 상담을 찾지 못했습니다. 처음부터 다시 시작해 주세요.",
                staff_handoff=True,
            )
        self.store.add_turn(str(session["id"]), "user", masked_text)
        if sensitive:
            self.store.update_session(str(session["id"]), handoff=True)
            return ConversationResponse(
                session_id=str(session["id"]),
                masked_text=masked_text,
                assistant_text="개인정보는 안전하게 가렸습니다. 번호나 계좌 정보는 말씀하지 않아도 됩니다.",
                clarifying_question="번호 없이 도움이 필요한 분야를 골라 주세요.",
                clarification_key="support_type",
                clarification_options=list(SUPPORT_OPTIONS),
                staff_handoff=True,
            )
        pending_key = str(session.get("pending_key") or "")
        answer = request.answers.get(pending_key, masked_text)
        if pending_key == "support_type":
            category = answer if answer in KEYWORDS else await self.classifier.classify(answer)
            if category is None:
                return ConversationResponse(
                    session_id=str(session["id"]), masked_text=masked_text,
                    assistant_text="상담 분야를 다시 확인해 주세요.",
                    clarifying_question="가까운 상담 분야를 골라 주세요.",
                    clarification_key="support_type", clarification_options=list(SUPPORT_OPTIONS), staff_handoff=True,
                )
            self.store.update_session(str(session["id"]), category=category, pending_key="age_group")
            return ConversationResponse(
                session_id=str(session["id"]), masked_text=masked_text,
                assistant_text="관련 상담 분야를 찾았습니다. 준비사항을 안내하기 전에 기본 정보 한 가지만 확인할게요.",
                clarifying_question="연령대를 골라 주세요. 정확한 자격 판정에는 사용하지 않습니다.",
                clarification_key="age_group", clarification_options=list(AGE_OPTIONS),
            )
        if pending_key == "age_group":
            age_group = answer if answer in {item.value for item in AGE_OPTIONS} else "선택하지 않음"
            category = str(session.get("category") or "")
            if category not in KEYWORDS:
                self.store.update_session(str(session["id"]), pending_key="support_type", handoff=True)
                return ConversationResponse(
                    session_id=str(session["id"]), masked_text=masked_text,
                    assistant_text="상담 분야를 다시 확인해 주세요.",
                    clarifying_question="가까운 상담 분야를 골라 주세요.",
                    clarification_key="support_type", clarification_options=list(SUPPORT_OPTIONS), staff_handoff=True,
                )
            self.store.update_session(str(session["id"]), age_group=age_group, pending_key="complete", handoff=True)
            return self._final_response(str(session["id"]), masked_text, category, request)
        category = str(session.get("category") or "")
        if category in KEYWORDS:
            return self._final_response(str(session["id"]), masked_text, category, request)
        return ConversationResponse(
            session_id=str(session["id"]), masked_text=masked_text,
            assistant_text="담당자와 함께 확인해 주세요.", staff_handoff=True,
        )

    def _final_response(self, session_id: str, masked_text: str, category: str, request: ConversationRequest) -> ConversationResponse:
        if request.region_sido and hasattr(self.provider, "search_region"):
            recommendations = self.provider.search_region(category, request.region_sido, request.region_sigungu)
        else:
            recommendations = self.provider.search(category)
        if not recommendations:
            return ConversationResponse(
                session_id=session_id, masked_text=masked_text,
                assistant_text="공식 정보를 바로 확인하지 못했습니다. 담당자와 함께 확인해 주세요.", staff_handoff=True,
            )
        return ConversationResponse(
            session_id=session_id, masked_text=masked_text,
            assistant_text=f"{recommendations[0].plain_name}에 관한 기본 안내를 찾았습니다. {safe_staff_message()}",
            recommendations=recommendations,
            staff_handoff=True,
        )


@dataclass
class AvatarJob:
    status: str
    video_url: str | None = None
    download_url: str | None = None


class AvatarService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.jobs: dict[str, AvatarJob] = {}

    async def create(self, text: str, audio_url: str | None) -> AvatarJobResponse:
        job_id = uuid.uuid4().hex
        if not self.settings.musetalk_api_url:
            self.jobs[job_id] = AvatarJob(status="fallback")
            return AvatarJobResponse(id=job_id, status="fallback")
        self.jobs[job_id] = AvatarJob(status="queued")
        asyncio.create_task(self._submit(job_id, text, audio_url))
        return AvatarJobResponse(id=job_id, status="queued")

    async def _submit(self, job_id: str, text: str, audio_url: str | None) -> None:
        self.jobs[job_id] = AvatarJob(status="processing")
        try:
            if not audio_url:
                raise ValueError("MuseTalk requires a TTS audio URL")
            public_audio_url = audio_url if audio_url.startswith("http") else self.settings.navi_api_public_url.rstrip("/") + audio_url
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(self.settings.musetalk_api_url.rstrip("/") + "/jobs", json={"text": text, "audio_url": public_audio_url})
                response.raise_for_status()
                remote_id = str(response.json()["id"])
                # A cold MuseTalk process can take several minutes to load GPU models.
                for _ in range(180):
                    await asyncio.sleep(2)
                    status = await client.get(self.settings.musetalk_api_url.rstrip("/") + f"/jobs/{remote_id}")
                    status.raise_for_status()
                    payload = status.json()
                    if payload.get("status") == "ready" and payload.get("video_url"):
                        self.jobs[job_id] = AvatarJob(
                            status="ready",
                            video_url=str(payload["video_url"]),
                            download_url=str(payload["download_url"]) if payload.get("download_url") else None,
                        )
                        return
                    if payload.get("status") == "failed":
                        break
        except (httpx.HTTPError, KeyError, ValueError):
            pass
        self.jobs[job_id] = AvatarJob(status="fallback")

    def get(self, job_id: str) -> AvatarJobResponse:
        job = self.jobs.get(job_id, AvatarJob(status="fallback"))
        return AvatarJobResponse(id=job_id, status=job.status, video_url=job.video_url, download_url=job.download_url)


class SpeechService:
    edge_voice_options = frozenset({
        "ko-KR-SunHiNeural",
        "ko-KR-InJoonNeural",
        "ko-KR-HyunsuMultilingualNeural",
    })

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.output_dir = Path("./runtime/tts")
        self._melo_model: Any | None = None

    async def synthesize(self, text: str, voice: str | None = None) -> SpeechResponse:
        provider = self.settings.tts_provider.lower()
        selected_voice = voice if voice in self.edge_voice_options else None
        # Melo does not expose the same named voices. An explicit selection therefore uses Edge.
        providers = ("edge",) if selected_voice else (("melo", "edge") if provider == "auto" else (provider,))
        for candidate in providers:
            if candidate == "melo":
                result = await self._synthesize_melo(text)
            elif candidate == "edge":
                result = await self._synthesize_edge(text, selected_voice)
            else:
                result = None
            if result is not None:
                return result
        return SpeechResponse(provider="browser", browser_fallback=True)

    async def _synthesize_edge(self, text: str, voice: str | None = None) -> SpeechResponse | None:
        try:
            import edge_tts
            self.output_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{uuid.uuid4().hex}.mp3"
            output = self.output_dir / filename
            await edge_tts.Communicate(text=text, voice=voice or self.settings.tts_edge_voice_ko).save(str(output))
            return SpeechResponse(provider="edge", audio_url=f"/runtime/tts/{filename}")
        except Exception:
            return None

    async def _synthesize_melo(self, text: str) -> SpeechResponse | None:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid.uuid4().hex}.wav"
        output = self.output_dir / filename
        try:
            if self.settings.tts_melo_api_url:
                async with httpx.AsyncClient(timeout=90.0) as client:
                    response = await client.post(
                        self.settings.tts_melo_api_url,
                        json={"text": text, "speed": self.settings.tts_melo_speed},
                    )
                    response.raise_for_status()
                    if not response.content:
                        return None
                    output.write_bytes(response.content)
            else:
                await asyncio.to_thread(self._melo_to_file, text, output)
            return SpeechResponse(provider="melo", audio_url=f"/runtime/tts/{filename}")
        except Exception:
            return None

    def _melo_to_file(self, text: str, output: Path) -> None:
        if self._melo_model is None:
            from melo.api import TTS
            self._melo_model = TTS(language="KR", device=self.settings.tts_melo_device)
        speaker_ids = self._melo_model.hps.data.spk2id
        speaker_id = speaker_ids.get(self.settings.tts_melo_speaker_ko)
        if speaker_id is None:
            speaker_id = next(iter(speaker_ids.values()))
        self._melo_model.tts_to_file(text, speaker_id, str(output), speed=self.settings.tts_melo_speed)


class TranscriptionService:
    """VisionNavi-compatible faster-whisper adapter that never retains source audio."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.model = None

    def status(self) -> dict[str, object]:
        try:
            import faster_whisper  # noqa: F401
            available = True
            reason = None
        except ImportError:
            available = False
            reason = "faster-whisper 패키지가 설치되지 않았습니다."
        return {
            "available": available,
            "loaded": self.model is not None,
            "model": self.settings.stt_model,
            "device": self.settings.stt_device,
            "compute_type": self.settings.stt_compute_type,
            "cpu_threads": self.settings.stt_cpu_threads,
            "reason": reason,
        }

    def transcribe(self, payload: bytes, suffix: str) -> str:
        if self.model is None:
            from faster_whisper import WhisperModel
            self.model = WhisperModel(
                self.settings.stt_model,
                device=self.settings.stt_device,
                compute_type=self.settings.stt_compute_type,
                cpu_threads=self.settings.stt_cpu_threads,
            )
        with tempfile.NamedTemporaryFile(suffix=suffix or ".webm", delete=False) as source:
            source_path = Path(source.name)
        try:
            source_path.write_bytes(payload)
            segments, _ = self.model.transcribe(str(source_path), language="ko", vad_filter=True, beam_size=5, condition_on_previous_text=False)
            return " ".join(segment.text.strip() for segment in segments if segment.text.strip())
        finally:
            source_path.unlink(missing_ok=True)


class WakeWordService:
    """Local OpenWakeWord detector. Browser PCM is evaluated in memory and never stored."""

    sample_rate = 16_000
    frame_samples = 1_280

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model: Any | None = None
        self._model_error: str | None = None
        self._pending_samples: Any | None = None
        self._noise_rms = 0.0
        self._calibration_frames = 0
        self._positive_frames = 0

    def status(self) -> dict[str, object]:
        configured = self.settings.wake_word_enabled and self.settings.wake_word_model_path.is_file()
        return {
            "enabled": self.settings.wake_word_enabled,
            "ready": configured and self._model_error is None,
            "model_path": str(self.settings.wake_word_model_path),
            "threshold": self.settings.wake_word_threshold,
            "min_rms": self.settings.wake_word_min_rms,
            "reason": self._model_error or (None if configured else "WAKE_WORD_ENABLED와 나루야 ONNX 모델 경로를 확인해 주세요."),
        }

    def reset(self) -> None:
        self._pending_samples = None
        self._noise_rms = 0.0
        self._calibration_frames = 0
        self._positive_frames = 0
        reset_model = getattr(self._model, "reset", None)
        if callable(reset_model):
            reset_model()

    @staticmethod
    def _normalized_rms(samples: Any) -> float:
        import numpy as np

        normalized = samples.astype(np.float32) / np.iinfo(np.int16).max
        return float(np.sqrt(np.mean(normalized * normalized)))

    def detect(self, pcm: bytes) -> float | None:
        if not self.settings.wake_word_enabled or not self.settings.wake_word_model_path.is_file():
            return None
        try:
            import numpy as np
            from openwakeword.model import Model
            if self._model is None:
                self._model = Model(wakeword_models=[str(self.settings.wake_word_model_path)])
            samples = np.frombuffer(pcm, dtype=np.int16)
            if self._pending_samples is not None:
                samples = np.concatenate((self._pending_samples, samples))
            while len(samples) >= self.frame_samples:
                frame, samples = samples[:self.frame_samples], samples[self.frame_samples:]
                rms = self._normalized_rms(frame)
                if self._calibration_frames < 12:
                    self._noise_rms = (self._noise_rms * self._calibration_frames + rms) / (self._calibration_frames + 1)
                    self._calibration_frames += 1
                    self._positive_frames = 0
                    continue
                min_rms = max(self.settings.wake_word_min_rms, self._noise_rms * 2.5)
                if rms < min_rms:
                    self._noise_rms = self._noise_rms * 0.98 + rms * 0.02
                    self._positive_frames = 0
                    continue
                scores = self._model.predict(frame)
                score = max((float(value) for value in scores.values()), default=0.0)
                if score >= self.settings.wake_word_threshold:
                    self._positive_frames += 1
                    if self._positive_frames >= 2:
                        self._pending_samples = None
                        self._positive_frames = 0
                        return score
                else:
                    self._positive_frames = 0
            self._pending_samples = samples.copy()
            return None
        except Exception as exc:
            self._model_error = str(exc)
            return None


def issue_admin_token() -> str:
    return secrets.token_urlsafe(32)
