from __future__ import annotations

import secrets
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .official_info import SeedOfficialInfoProvider, build_official_info_provider
from .schemas import (AdminOverview, AdminProgramReview, AdminSummary, AvatarJobRequest, AvatarJobResponse,
                      ConversationRequest, ConversationResponse, LoginRequest, LoginResponse,
                      AdminPilotArea, PilotAreaUpdate, ProgramReviewHistory, ProgramReviewUpdate, SpeechRequest, SpeechResponse,
                      SummaryDetailResponse, SummaryRequest, SummaryResponse)
from .services import AvatarService, ConversationService, SpeechService, TranscriptionService, WakeWordService, issue_admin_token
from .store import Store


app = FastAPI(title="Navi 주민센터 데모 API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)
Path("./runtime/tts").mkdir(parents=True, exist_ok=True)
app.mount("/runtime", StaticFiles(directory="./runtime"), name="runtime")

store = Store(settings.database_path)
provider = build_official_info_provider(settings, store)
# The kiosk never receives a location picker. A local-service API area is applied
# only from the persisted administrator setting.
if hasattr(provider, "set_local_area"):
    pilot_area = store.get_pilot_area()
    provider.set_local_area(str(pilot_area["sido"] or "") or None, str(pilot_area["sigungu"] or "") or None)
conversations = ConversationService(settings, store, provider)
speech = SpeechService(settings)
avatars = AvatarService(settings)
transcriptions = TranscriptionService(settings)
wake_words = WakeWordService(settings)
admin_tokens: set[str] = set()


def require_admin(authorization: str | None = Header(default=None)) -> None:
    if not authorization or not authorization.startswith("Bearer ") or authorization[7:] not in admin_tokens:
        raise HTTPException(status_code=401, detail="관리자 로그인이 필요합니다.")


@app.get("/api/health")
def health() -> dict[str, object]:
    public_data = provider.status() if hasattr(provider, "status") else {"mode": "seed", "configured": False}
    return {
        "status": "ok",
        "ollama_enabled": settings.ollama_enabled,
        "musetalk_enabled": bool(settings.musetalk_api_url),
        "stt": transcriptions.status(),
        "wake_word": wake_words.status(),
        "public_data": public_data,
    }


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
    return await speech.synthesize(request.text, request.voice)


@app.get("/api/wake-word/status")
def wake_word_status() -> dict[str, object]:
    return wake_words.status()


@app.websocket("/api/wake-word/stream")
async def wake_word_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    status = wake_words.status()
    if not status["ready"]:
        await websocket.send_json({"type": "unavailable", **status})
        await websocket.close(code=1008)
        return
    wake_words.reset()
    await websocket.send_json({"type": "ready", "sample_rate": wake_words.sample_rate})
    try:
        while True:
            pcm = await websocket.receive_bytes()
            score = await __import__("asyncio").to_thread(wake_words.detect, pcm)
            if score is not None and score >= settings.wake_word_threshold:
                await websocket.send_json({"type": "activated", "score": round(score, 3)})
                return
    except WebSocketDisconnect:
        return
    finally:
        wake_words.reset()


@app.post("/api/avatar-jobs", response_model=AvatarJobResponse)
async def avatar_job(request: AvatarJobRequest) -> AvatarJobResponse:
    return await avatars.create(request.text, request.audio_url)


@app.get("/api/avatar-jobs/{job_id}", response_model=AvatarJobResponse)
def avatar_job_status(job_id: str) -> AvatarJobResponse:
    return avatars.get(job_id)


@app.post("/api/summaries", response_model=SummaryResponse)
def create_summary(request: SummaryRequest) -> SummaryResponse:
    session = store.get_session(request.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="상담 세션을 찾을 수 없습니다.")
    recommendations = provider.search(str(session.get("category") or ""))
    selected = [item for item in recommendations if item.program_id in request.recommendation_ids]
    selected_ids = {item.program_id for item in selected}
    if missing_ids := [item for item in request.recommendation_ids if item not in selected_ids]:
        # A previously displayed seed result can still be summarized after the live API returns different records.
        fallback = SeedOfficialInfoProvider(store).search(str(session.get("category") or ""))
        selected.extend(item for item in fallback if item.program_id in missing_ids)
    token, expires_at = store.create_summary(
        request.session_id,
        request.recommendation_ids,
        settings.summary_ttl_minutes,
        [item.model_dump(mode="json") for item in selected],
    )
    return SummaryResponse(token=token, expires_at=expires_at, public_url=f"/summary/{token}")


@app.get("/api/summaries/{token}", response_model=SummaryDetailResponse)
def get_summary(token: str) -> SummaryDetailResponse:
    record = store.get_summary(token)
    if record is None:
        raise HTTPException(status_code=404, detail="상담 요약이 없거나 만료되었습니다.")
    return SummaryDetailResponse(
        masked_text=str(record["masked_text"]),
        created_at=str(record["created_at"]),
        recommendation_names=provider.names_for(__import__("json").loads(str(record["program_ids"]))),
        recommendations=__import__("json").loads(str(record.get("recommendations") or "[]")),
    )


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
    programs = provider.admin_programs()
    return AdminOverview(
        summaries=summaries, total_sessions=total, handoff_count=handoff,
        approved_programs=provider.approved_count(),
        needs_review_programs=sum(item.review_status == "needs_review" for item in programs),
    )


@app.get("/api/admin/pilot-area", response_model=AdminPilotArea, dependencies=[Depends(require_admin)])
def get_pilot_area() -> AdminPilotArea:
    return AdminPilotArea(**store.get_pilot_area())


@app.put("/api/admin/pilot-area", response_model=AdminPilotArea, dependencies=[Depends(require_admin)])
def update_pilot_area(request: PilotAreaUpdate) -> AdminPilotArea:
    # A district without a province is ambiguous for the local welfare API.
    if request.sigungu and not request.sido:
        raise HTTPException(status_code=422, detail="시·도 선택 후 시·군·구를 입력해 주세요.")
    area = store.update_pilot_area(request.sido, request.sigungu, "local-admin")
    if hasattr(provider, "set_local_area"):
        provider.set_local_area(area["sido"], area["sigungu"])
    return AdminPilotArea(**area)


@app.get("/api/admin/programs", response_model=list[AdminProgramReview], dependencies=[Depends(require_admin)])
def admin_programs() -> list[AdminProgramReview]:
    return provider.admin_programs()


@app.put("/api/admin/programs/{program_id}", response_model=AdminProgramReview, dependencies=[Depends(require_admin)])
def update_program(program_id: str, request: ProgramReviewUpdate) -> AdminProgramReview:
    programs = {item.program_id: item for item in provider.admin_programs()}
    if program_id not in programs:
        raise HTTPException(status_code=404, detail="안내 항목을 찾지 못했습니다.")
    store.update_program_review(program_id, request.review_status, request.note, "local-admin")
    return {item.program_id: item for item in provider.admin_programs()}[program_id]


@app.get("/api/admin/programs/{program_id}/history", response_model=list[ProgramReviewHistory], dependencies=[Depends(require_admin)])
def program_history(program_id: str) -> list[ProgramReviewHistory]:
    programs = {item.program_id for item in provider.admin_programs()}
    if program_id not in programs:
        raise HTTPException(status_code=404, detail="안내 항목을 찾지 못했습니다.")
    return [ProgramReviewHistory(**row) for row in store.program_review_history(program_id)]
