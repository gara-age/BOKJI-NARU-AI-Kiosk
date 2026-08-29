from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self._connection() as connection:
            connection.execute("""CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY, created_at TEXT NOT NULL, masked_text TEXT NOT NULL,
                age_group TEXT, gender TEXT, handoff INTEGER NOT NULL DEFAULT 0
            )""")
            connection.execute("""CREATE TABLE IF NOT EXISTS summaries (
                token TEXT PRIMARY KEY, session_id TEXT NOT NULL, created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL, program_ids TEXT NOT NULL
            )""")

    def _connection(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def create_session(self, masked_text: str, age_group: str | None, gender: str | None, handoff: bool) -> str:
        session_id = str(uuid.uuid4())
        with self._connection() as connection:
            connection.execute(
                "INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, datetime.now(UTC).isoformat(), masked_text, age_group, gender, int(handoff)),
            )
        return session_id

    def create_summary(self, session_id: str, program_ids: list[str], ttl_minutes: int) -> tuple[str, datetime]:
        token = uuid.uuid4().hex
        now = datetime.now(UTC)
        expires_at = now + timedelta(minutes=ttl_minutes)
        with self._connection() as connection:
            connection.execute(
                "INSERT INTO summaries VALUES (?, ?, ?, ?, ?)",
                (token, session_id, now.isoformat(), expires_at.isoformat(), json.dumps(program_ids)),
            )
        return token, expires_at

    def admin_summaries(self) -> list[dict[str, object]]:
        with self._connection() as connection:
            rows = connection.execute("""SELECT summaries.token, summaries.created_at, summaries.expires_at,
                summaries.program_ids, sessions.masked_text FROM summaries
                JOIN sessions ON sessions.id = summaries.session_id ORDER BY summaries.created_at DESC""").fetchall()
        return [dict(row) for row in rows]

    def get_summary(self, token: str) -> dict[str, object] | None:
        with self._connection() as connection:
            row = connection.execute("""SELECT summaries.token, summaries.created_at, summaries.expires_at,
                summaries.program_ids, sessions.masked_text FROM summaries
                JOIN sessions ON sessions.id = summaries.session_id WHERE summaries.token = ?""", (token,)).fetchone()
        if row is None or datetime.fromisoformat(str(row["expires_at"])) <= datetime.now(UTC):
            return None
        return dict(row)

    def counts(self) -> tuple[int, int]:
        with self._connection() as connection:
            total = connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
            handoff = connection.execute("SELECT COUNT(*) FROM sessions WHERE handoff = 1").fetchone()[0]
        return int(total), int(handoff)
