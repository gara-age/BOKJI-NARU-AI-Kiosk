from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi.testclient import TestClient

from app.main import app, store
from app.official_info import SeedOfficialInfoProvider
from app.services import WakeWordService


client = TestClient(app)


def test_admin_login_protects_overview() -> None:
    assert client.get("/api/admin/overview").status_code == 401
    assert client.post("/api/admin/login", json={"password": "wrong"}).status_code == 401
    login = client.post("/api/admin/login", json={"password": "navi-demo"})
    assert login.status_code == 200
    token = login.json()["token"]
    assert client.get("/api/admin/overview", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_wake_word_status_is_exposed() -> None:
    response = client.get("/api/wake-word/status")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload["ready"], bool)
    assert isinstance(payload["enabled"], bool)


def test_wake_word_rms_gate_distinguishes_silence_from_voice_energy() -> None:
    assert WakeWordService._normalized_rms(np.zeros(1280, dtype=np.int16)) == 0
    assert WakeWordService._normalized_rms(np.full(1280, 2_000, dtype=np.int16)) > 0.008


def test_summary_expires() -> None:
    session_id = store.create_session("생활 지원 문의", None, None, False)
    token, _ = store.create_summary(session_id, ["basic-livelihood"], 30)
    with store._connection() as connection:
        connection.execute("UPDATE summaries SET expires_at = ? WHERE token = ?", ((datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(), token))
    assert store.get_summary(token) is None


def test_summary_keeps_a_safe_guidance_snapshot() -> None:
    session_id = store.create_session("생활 지원 문의", None, None, False, category="basic")
    response = client.post("/api/summaries", json={"session_id": session_id, "recommendation_ids": ["basic-livelihood"]})

    assert response.status_code == 200
    summary = client.get(f"/api/summaries/{response.json()['token']}")
    assert summary.status_code == 200
    assert summary.json()["recommendations"][0]["preparation_items"]


def test_seed_information_is_reviewable() -> None:
    result = SeedOfficialInfoProvider().search("youth")
    assert result[0].status == "일부 확인됨"
    assert result[0].source.url.startswith("https://")


def test_admin_can_change_program_review_status() -> None:
    login = client.post("/api/admin/login", json={"password": "navi-demo"})
    token = login.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    programs = client.get("/api/admin/programs", headers=headers)
    assert programs.status_code == 200
    program_id = programs.json()[0]["program_id"]
    updated = client.put(
        f"/api/admin/programs/{program_id}",
        headers=headers,
        json={"review_status": "needs_review", "note": "공식 안내문 재확인 필요"},
    )
    assert updated.status_code == 200
    assert updated.json()["review_status"] == "needs_review"
    history = client.get(f"/api/admin/programs/{program_id}/history", headers=headers)
    assert history.status_code == 200
    assert history.json()[0]["note"] == "공식 안내문 재확인 필요"
    restored = client.put(
        f"/api/admin/programs/{program_id}",
        headers=headers,
        json={"review_status": "approved", "note": "테스트 후 기본 상태 복구"},
    )
    assert restored.status_code == 200


def test_only_an_admin_can_set_the_local_welfare_pilot_area() -> None:
    assert client.get("/api/admin/pilot-area").status_code == 401
    login = client.post("/api/admin/login", json={"password": "navi-demo"})
    headers = {"Authorization": f"Bearer {login.json()['token']}"}

    invalid = client.put("/api/admin/pilot-area", headers=headers, json={"sigungu": "성동구"})
    assert invalid.status_code == 422

    updated = client.put(
        "/api/admin/pilot-area", headers=headers,
        json={"sido": "서울특별시", "sigungu": "성동구"},
    )
    assert updated.status_code == 200
    assert updated.json()["sido"] == "서울특별시"
    assert updated.json()["sigungu"] == "성동구"

    cleared = client.put("/api/admin/pilot-area", headers=headers, json={"sido": None, "sigungu": None})
    assert cleared.status_code == 200
    assert cleared.json()["sido"] is None
