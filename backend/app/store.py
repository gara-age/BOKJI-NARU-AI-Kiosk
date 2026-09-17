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
                age_group TEXT, gender TEXT, handoff INTEGER NOT NULL DEFAULT 0,
                category TEXT, pending_key TEXT
            )""")
            connection.execute("""CREATE TABLE IF NOT EXISTS summaries (
                token TEXT PRIMARY KEY, session_id TEXT NOT NULL, created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL, program_ids TEXT NOT NULL, recommendations TEXT NOT NULL DEFAULT '[]'
            )""")
            connection.execute("""CREATE TABLE IF NOT EXISTS conversation_turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
                created_at TEXT NOT NULL, role TEXT NOT NULL, masked_text TEXT NOT NULL
            )""")
            connection.execute("""CREATE TABLE IF NOT EXISTS program_reviews (
                program_id TEXT PRIMARY KEY, review_status TEXT NOT NULL, reviewed_at TEXT,
                reviewed_by TEXT, note TEXT NOT NULL DEFAULT ''
            )""")
            connection.execute("""CREATE TABLE IF NOT EXISTS program_review_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT, program_id TEXT NOT NULL,
                changed_at TEXT NOT NULL, changed_by TEXT NOT NULL,
                review_status TEXT NOT NULL, note TEXT NOT NULL
            )""")
            self._add_column_if_missing(connection, "sessions", "category", "TEXT")
            self._add_column_if_missing(connection, "sessions", "pending_key", "TEXT")
            self._add_column_if_missing(connection, "summaries", "recommendations", "TEXT NOT NULL DEFAULT '[]'")

    @staticmethod
    def _add_column_if_missing(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
        columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
        if column not in columns:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def _connection(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def create_session(
        self, masked_text: str, age_group: str | None, gender: str | None, handoff: bool,
        category: str | None = None, pending_key: str | None = None,
    ) -> str:
        session_id = str(uuid.uuid4())
        with self._connection() as connection:
            connection.execute(
                """INSERT INTO sessions
                (id, created_at, masked_text, age_group, gender, handoff, category, pending_key)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (session_id, datetime.now(UTC).isoformat(), masked_text, age_group, gender, int(handoff), category, pending_key),
            )
        self.add_turn(session_id, "user", masked_text)
        return session_id

    def get_session(self, session_id: str) -> dict[str, object] | None:
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return dict(row) if row else None

    def update_session(
        self, session_id: str, *, category: str | None = None, pending_key: str | None = None,
        age_group: str | None = None, handoff: bool | None = None,
    ) -> None:
        changes: list[str] = []
        values: list[object] = []
        for column, value in (("category", category), ("pending_key", pending_key), ("age_group", age_group)):
            if value is not None:
                changes.append(f"{column} = ?")
                values.append(value)
        if handoff is not None:
            changes.append("handoff = ?")
            values.append(int(handoff))
        if not changes:
            return
        values.append(session_id)
        with self._connection() as connection:
            connection.execute(f"UPDATE sessions SET {', '.join(changes)} WHERE id = ?", values)

    def add_turn(self, session_id: str, role: str, masked_text: str) -> None:
        with self._connection() as connection:
            connection.execute(
                "INSERT INTO conversation_turns (session_id, created_at, role, masked_text) VALUES (?, ?, ?, ?)",
                (session_id, datetime.now(UTC).isoformat(), role, masked_text),
            )

    def create_summary(
        self, session_id: str, program_ids: list[str], ttl_minutes: int,
        recommendations: list[dict[str, object]] | None = None,
    ) -> tuple[str, datetime]:
        token = uuid.uuid4().hex
        now = datetime.now(UTC)
        expires_at = now + timedelta(minutes=ttl_minutes)
        with self._connection() as connection:
            connection.execute(
                """INSERT INTO summaries
                (token, session_id, created_at, expires_at, program_ids, recommendations)
                VALUES (?, ?, ?, ?, ?, ?)""",
                (token, session_id, now.isoformat(), expires_at.isoformat(), json.dumps(program_ids), json.dumps(recommendations or [], ensure_ascii=False)),
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
                summaries.program_ids, summaries.recommendations, sessions.masked_text FROM summaries
                JOIN sessions ON sessions.id = summaries.session_id WHERE summaries.token = ?""", (token,)).fetchone()
        if row is None or datetime.fromisoformat(str(row["expires_at"])) <= datetime.now(UTC):
            return None
        return dict(row)

    def counts(self) -> tuple[int, int]:
        with self._connection() as connection:
            total = connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
            handoff = connection.execute("SELECT COUNT(*) FROM sessions WHERE handoff = 1").fetchone()[0]
        return int(total), int(handoff)

    def ensure_program_reviews(self, program_ids: list[str]) -> None:
        with self._connection() as connection:
            for program_id in program_ids:
                connection.execute(
                    """INSERT OR IGNORE INTO program_reviews
                    (program_id, review_status, reviewed_at, reviewed_by, note)
                    VALUES (?, 'approved', ?, 'seed', '초기 시드 정보 검토')""",
                    (program_id, datetime.now(UTC).isoformat()),
                )

    def program_reviews(self) -> dict[str, dict[str, object]]:
        with self._connection() as connection:
            rows = connection.execute("SELECT * FROM program_reviews").fetchall()
        return {str(row["program_id"]): dict(row) for row in rows}

    def update_program_review(self, program_id: str, review_status: str, note: str, changed_by: str) -> dict[str, object]:
        now = datetime.now(UTC).isoformat()
        with self._connection() as connection:
            connection.execute(
                """INSERT INTO program_reviews (program_id, review_status, reviewed_at, reviewed_by, note)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(program_id) DO UPDATE SET review_status = excluded.review_status,
                reviewed_at = excluded.reviewed_at, reviewed_by = excluded.reviewed_by, note = excluded.note""",
                (program_id, review_status, now, changed_by, note),
            )
            connection.execute(
                """INSERT INTO program_review_history
                (program_id, changed_at, changed_by, review_status, note) VALUES (?, ?, ?, ?, ?)""",
                (program_id, now, changed_by, review_status, note),
            )
        return self.program_reviews()[program_id]

    def program_review_history(self, program_id: str) -> list[dict[str, object]]:
        with self._connection() as connection:
            rows = connection.execute(
                """SELECT changed_at, changed_by, review_status, note FROM program_review_history
                WHERE program_id = ? ORDER BY id DESC""", (program_id,),
            ).fetchall()
        return [dict(row) for row in rows]
