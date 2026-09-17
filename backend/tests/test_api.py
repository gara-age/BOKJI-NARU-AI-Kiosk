from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.main import app, store
from app.official_info import SeedOfficialInfoProvider


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


def test_summary_expires() -> None:
    session_id = store.create_session("생활 지원 문의", None, None, False)
    token, _ = store.create_summary(session_id, ["basic-livelihood"], 30)
    with store._connection() as connection:
        connection.execute("UPDATE summaries SET expires_at = ? WHERE token = ?", ((datetime.now(UTC) - timedelta(minutes=1)).isoformat(), token))
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
