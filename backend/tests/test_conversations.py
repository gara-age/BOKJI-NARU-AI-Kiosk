import asyncio
from pathlib import Path

from app.config import Settings
from app.official_info import SeedOfficialInfoProvider
from app.schemas import ConversationRequest, Demographics
from app.services import ConversationService
from app.store import Store


def service(tmp_path: Path) -> ConversationService:
    settings = Settings(database_path=tmp_path / "test.sqlite3")
    return ConversationService(settings, Store(settings.database_path), SeedOfficialInfoProvider())


def test_returns_welfare_guidance(tmp_path: Path) -> None:
    response = asyncio.run(service(tmp_path).respond(ConversationRequest(text="생활비가 어려워서 지원을 받고 싶어요", demographics=Demographics(age_group="40대"))))
    assert response.recommendations[0].program_id == "basic-livelihood"
    assert response.staff_handoff is True


def test_sensitive_question_requires_handoff(tmp_path: Path) -> None:
    response = asyncio.run(service(tmp_path).respond(ConversationRequest(text="주민번호 900101-1234567로 지원 확인해줘")))
    assert response.staff_handoff is True
    assert "900101" not in response.masked_text


def test_multi_turn_conversation_returns_result_after_age_answer(tmp_path: Path) -> None:
    conversation_service = service(tmp_path)
    first = asyncio.run(conversation_service.respond(ConversationRequest(text="생활비가 어려워서 도움을 받고 싶어요")))
    assert first.clarification_key == "age_group"
    assert first.recommendations == []
    final = asyncio.run(conversation_service.respond(ConversationRequest(
        text="35~64세",
        session_id=first.session_id,
        answers={"age_group": "35~64세"},
    )))
    assert final.clarifying_question is None
    assert final.recommendations[0].program_id == "basic-livelihood"


def test_unknown_request_can_be_narrowed_by_support_option(tmp_path: Path) -> None:
    conversation_service = service(tmp_path)
    first = asyncio.run(conversation_service.respond(ConversationRequest(text="무엇을 신청해야 할지 모르겠어요")))
    assert first.clarification_key == "support_type"
    second = asyncio.run(conversation_service.respond(ConversationRequest(
        text="청년 주거·월세",
        session_id=first.session_id,
        answers={"support_type": "youth"},
    )))
    assert second.clarification_key == "age_group"
