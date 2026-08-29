from __future__ import annotations

import asyncio
import secrets
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

import httpx

from .config import Settings
from .official_info import OfficialInfoProvider
from .schemas import AvatarJobResponse, ConversationRequest, ConversationResponse, SpeechResponse
from .security import contains_sensitive_input, mask_sensitive_text, safe_staff_message
from .store import Store


KEYWORDS = {
    "basic": ("생활", "기초", "생계", "소득", "어려", "가난"),
    "emergency": ("긴급", "갑자기", "위기", "실직", "병", "퇴거"),
    "elder": ("어르신", "노인", "돌봄", "부모님", "치매"),
    "disability": ("장애", "활동지원", "활동 지원"),
    "youth": ("청년", "월세", "주거", "임대", "전세"),
}


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
        prompt = "다음 한국어 민원 문장을 basic, emergency, elder, disability, youth 중 하나로만 분류하세요. 모르면 unknown.\n문장: " + text
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
        category = await self.classifier.classify(masked_text)
        handoff = sensitive or category is None
        session_id = self.store.create_session(masked_text, request.demographics.age_group, request.demographics.gender, handoff)
        if sensitive:
            return ConversationResponse(
                session_id=session_id, masked_text=masked_text,
                assistant_text="개인정보는 안전하게 가렸습니다. 번호나 계좌 정보는 말씀하지 않아도 됩니다.",
                clarifying_question="어떤 종류의 도움이 필요한지 간단히 말씀해 주세요.", clarification_key="support_type", staff_handoff=True,
            )
        if category is None:
            return ConversationResponse(
                session_id=session_id, masked_text=masked_text,
                assistant_text="도움이 필요한 상황을 확인하고 있습니다.",
                clarifying_question="생활비, 갑작스러운 위기, 어르신 돌봄, 장애인 활동, 청년 주거 중 가까운 내용을 골라 주세요.",
                clarification_key="support_type", staff_handoff=True,
            )
        recommendations = self.provider.search(category)
        if not recommendations:
            return ConversationResponse(
                session_id=session_id, masked_text=masked_text,
                assistant_text="공식 정보를 바로 확인하지 못했습니다. 담당자와 함께 확인해 주세요.", staff_handoff=True,
            )
        if not request.demographics.age_group:
            return ConversationResponse(
                session_id=session_id, masked_text=masked_text,
                assistant_text="관련 상담 분야를 찾았습니다. 몇 가지 기본 정보만 확인하면 준비사항을 더 잘 안내할 수 있습니다.",
                clarifying_question="연령대를 선택해 주세요. 선택하지 않고 바로 결과를 볼 수도 있습니다.", clarification_key="age_group",
                recommendations=recommendations,
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
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(self.settings.musetalk_api_url + "/jobs", json={"text": text, "audio_url": audio_url})
                self.jobs[job_id] = AvatarJob(status="ready", video_url=response.json().get("video_url"))
        except httpx.HTTPError:
            self.jobs[job_id] = AvatarJob(status="fallback")

    def get(self, job_id: str) -> AvatarJobResponse:
        job = self.jobs.get(job_id, AvatarJob(status="fallback"))
        return AvatarJobResponse(id=job_id, status=job.status, video_url=job.video_url)


class SpeechService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.output_dir = Path("./runtime/tts")

    async def synthesize(self, text: str) -> SpeechResponse:
        if self.settings.tts_provider != "edge":
            return SpeechResponse(provider=self.settings.tts_provider, browser_fallback=True)
        try:
            import edge_tts
            self.output_dir.mkdir(parents=True, exist_ok=True)
            filename = f"{uuid.uuid4().hex}.mp3"
            output = self.output_dir / filename
            await edge_tts.Communicate(text=text, voice=self.settings.tts_edge_voice_ko).save(str(output))
            return SpeechResponse(provider="edge", audio_url=f"/runtime/tts/{filename}")
        except Exception:
            return SpeechResponse(provider="browser", browser_fallback=True)


class TranscriptionService:
    """VisionNavi-compatible faster-whisper adapter that never retains source audio."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.model = None

    def transcribe(self, payload: bytes, suffix: str) -> str:
        if self.model is None:
            from faster_whisper import WhisperModel
            self.model = WhisperModel(self.settings.stt_model, device="cpu", compute_type="int8")
        with tempfile.NamedTemporaryFile(suffix=suffix or ".webm", delete=True) as source:
            source.write(payload)
            source.flush()
            segments, _ = self.model.transcribe(source.name, language="ko", vad_filter=True, beam_size=5, condition_on_previous_text=False)
            return " ".join(segment.text.strip() for segment in segments if segment.text.strip())


def issue_admin_token() -> str:
    return secrets.token_urlsafe(32)
