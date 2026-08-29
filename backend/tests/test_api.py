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


def test_summary_expires() -> None:
    session_id = store.create_session("생활 지원 문의", None, None, False)
    token, _ = store.create_summary(session_id, ["basic-livelihood"], 30)
    with store._connection() as connection:
        connection.execute("UPDATE summaries SET expires_at = ? WHERE token = ?", ((datetime.now(UTC) - timedelta(minutes=1)).isoformat(), token))
    assert store.get_summary(token) is None


def test_seed_information_is_reviewable() -> None:
    result = SeedOfficialInfoProvider().search("youth")
    assert result[0].status == "일부 확인됨"
    assert result[0].source.url.startswith("https://")
