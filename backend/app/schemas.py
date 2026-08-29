from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


ResultStatus = Literal["확인됨", "일부 확인됨", "담당자 확인 필요"]


class Demographics(BaseModel):
    age_group: str | None = None
    gender: str | None = None


class ConversationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    demographics: Demographics = Field(default_factory=Demographics)
    answers: dict[str, str] = Field(default_factory=dict)


class Source(BaseModel):
    name: str
    url: str
    checked_at: str


class Recommendation(BaseModel):
    program_id: str
    name: str
    plain_name: str
    status: ResultStatus
    guidance: str
    preparation_items: list[str]
    needs_confirmation: list[str]
    office_hint: str
    source: Source


class ConversationResponse(BaseModel):
    session_id: str
    masked_text: str
    assistant_text: str
    clarifying_question: str | None = None
    clarification_key: str | None = None
    recommendations: list[Recommendation] = Field(default_factory=list)
    staff_handoff: bool = False


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)


class SpeechResponse(BaseModel):
    provider: str
    audio_url: str | None = None
    browser_fallback: bool = False


class AvatarJobRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    audio_url: str | None = None


class AvatarJobResponse(BaseModel):
    id: str
    status: Literal["queued", "processing", "ready", "fallback"]
    video_url: str | None = None


class SummaryRequest(BaseModel):
    session_id: str
    recommendation_ids: list[str] = Field(min_length=1, max_length=3)


class SummaryResponse(BaseModel):
    token: str
    expires_at: datetime
    public_url: str


class LoginRequest(BaseModel):
    password: str = Field(min_length=1)


class LoginResponse(BaseModel):
    token: str


class AdminSummary(BaseModel):
    token: str
    created_at: datetime
    expires_at: datetime
    masked_text: str
    recommendation_names: list[str]


class AdminOverview(BaseModel):
    summaries: list[AdminSummary]
    total_sessions: int
    handoff_count: int
    approved_programs: int
