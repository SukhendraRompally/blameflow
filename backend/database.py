import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Optional

DB_PATH = os.getenv("DB_PATH", "./workspace.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS threads (
                thread_id   TEXT PRIMARY KEY,
                repo_url    TEXT UNIQUE NOT NULL,
                repo_name   TEXT NOT NULL,
                last_analyzed_commit TEXT,
                cached_summary       TEXT,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id   TEXT NOT NULL,
                role        TEXT NOT NULL,
                content     TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                FOREIGN KEY (thread_id) REFERENCES threads(thread_id)
            )
        """)
        conn.commit()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Thread CRUD ───────────────────────────────────────────────────────────────

def get_thread(repo_url: str) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM threads WHERE repo_url = ?", (repo_url,)
        ).fetchone()
        return dict(row) if row else None


def get_thread_by_id(thread_id: str) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM threads WHERE thread_id = ?", (thread_id,)
        ).fetchone()
        return dict(row) if row else None


def list_threads() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM threads ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def create_thread(
    repo_url: str,
    repo_name: str,
    last_analyzed_commit: str,
    cached_summary: str,
) -> dict:
    thread_id = uuid.uuid4().hex[:8]
    now = _now()
    with _connect() as conn:
        conn.execute(
            """INSERT INTO threads
               (thread_id, repo_url, repo_name, last_analyzed_commit, cached_summary, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (thread_id, repo_url, repo_name, last_analyzed_commit, cached_summary, now, now),
        )
        conn.commit()
    return get_thread_by_id(thread_id)


def update_thread(
    thread_id: str,
    last_analyzed_commit: str,
    cached_summary: str,
) -> dict:
    with _connect() as conn:
        conn.execute(
            """UPDATE threads
               SET last_analyzed_commit = ?, cached_summary = ?, updated_at = ?
               WHERE thread_id = ?""",
            (last_analyzed_commit, cached_summary, _now(), thread_id),
        )
        conn.commit()
    return get_thread_by_id(thread_id)


# ── Chat CRUD ─────────────────────────────────────────────────────────────────

def get_chat_history(thread_id: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT role, content FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC",
            (thread_id,),
        ).fetchall()
        return [{"role": r["role"], "content": r["content"]} for r in rows]


def add_chat_message(thread_id: str, role: str, content: str) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO chat_messages (thread_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (thread_id, role, content, _now()),
        )
        conn.commit()
