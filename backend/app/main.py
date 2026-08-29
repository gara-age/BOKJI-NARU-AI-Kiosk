from __future__ import annotations

import secrets
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .official_info import SeedOfficialInfoProvider
from .schemas import (AdminOverview, AdminSummary, AvatarJobRequest, AvatarJobResponse, ConversationRequest,
                      ConversationResponse, LoginRequest, LoginResponse, SpeechRequest, SpeechResponse,
                      SummaryRequest, SummaryResponse)
from .services import AvatarService, ConversationService, SpeechService, TranscriptionService, issue_admin_token
from .store import Store


app = FastAPI(title="Navi 주민센터 데모 API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])
Path("./runtime/tts").mkdir(parents=True, exist_ok=True)
app.mount("/runtime", StaticFiles(directory="./runtime"), name="runtime")

store = Store(settings.database_path)
provider = SeedOfficialInfoProvider()
conversations = ConversationService(settings, store, provider)
speech = SpeechService(settings)
avatars = AvatarService(settings)
transcriptions = TranscriptionService(settings)
admin_tokens: set[str] = set()


def require_admin(authorization: str | None = Header(default=None)) -> None:
    if not authorization or not authorization.startswith("Bearer ") or authorization[7:] not in admin_tokens:
        raise HTTPException(status_code=401, detail="관리자 로그인이 필요합니다.")


@app.get("/api/health")
def health() -> dict[str, object]:
    return {"status": "ok", "ollama_enabled": settings.ollama_enabled, "musetalk_enabled": bool(settings.musetalk_api_url)}


@app.post("/api/conversations", response_model=ConversationResponse)
async def conversation(request: ConversationRequest) -> ConversationResponse:
    return await conversations.respond(request)


@app.post("/api/transcriptions")
async def transcription(audio: UploadFile = File(...)) -> dict[str, object]:
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="오디오 파일만 올릴 수 있습니다.")
    payload = await audio.read()
    try:
        text = await __import__("asyncio").to_thread(transcriptions.transcribe, payload, Path(audio.filename or "audio.webm").suffix)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="음성 인식 서비스를 사용할 수 없습니다. 내용을 직접 입력해 주세요.") from exc
    return {"text": text, "stored": False}


@app.post("/api/speech", response_model=SpeechResponse)
async def synthesize(request: SpeechRequest) -> SpeechResponse:
    return await speech.synthesize(request.text)


@app.post("/api/avatar-jobs", response_model=AvatarJobResponse)
async def avatar_job(request: AvatarJobRequest) -> AvatarJobResponse:
    return await avatars.create(request.text, request.audio_url)


@app.get("/api/avatar-jobs/{job_id}", response_model=AvatarJobResponse)
def avatar_job_status(job_id: str) -> AvatarJobResponse:
    return avatars.get(job_id)


@app.post("/api/summaries", response_model=SummaryResponse)
def create_summary(request: SummaryRequest) -> SummaryResponse:
    token, expires_at = store.create_summary(request.session_id, request.recommendation_ids, settings.summary_ttl_minutes)
    return SummaryResponse(token=token, expires_at=expires_at, public_url=f"/summary/{token}")


@app.get("/api/summaries/{token}")
def get_summary(token: str) -> dict[str, object]:
    record = store.get_summary(token)
    if record is None:
        raise HTTPException(status_code=404, detail="상담 요약이 없거나 만료되었습니다.")
    return {"masked_text": record["masked_text"], "created_at": record["created_at"], "recommendation_names": provider.names_for(__import__("json").loads(str(record["program_ids"])))}


@app.post("/api/admin/login", response_model=LoginResponse)
def admin_login(request: LoginRequest) -> LoginResponse:
    if not secrets.compare_digest(request.password, settings.admin_password):
        raise HTTPException(status_code=401, detail="비밀번호가 맞지 않습니다.")
    token = issue_admin_token()
    admin_tokens.add(token)
    return LoginResponse(token=token)


@app.get("/api/admin/overview", response_model=AdminOverview, dependencies=[Depends(require_admin)])
def admin_overview() -> AdminOverview:
    records = store.admin_summaries()
    total, handoff = store.counts()
    summaries = [
        AdminSummary(
            token=row["token"],
            created_at=datetime.fromisoformat(str(row["created_at"])),
            expires_at=datetime.fromisoformat(str(row["expires_at"])),
            masked_text=str(row["masked_text"]),
            recommendation_names=provider.names_for(__import__("json").loads(str(row["program_ids"]))),
        )
        for row in records
    ]
    return AdminOverview(summaries=summaries, total_sessions=total, handoff_count=handoff, approved_programs=provider.approved_count())
