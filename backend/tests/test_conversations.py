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
