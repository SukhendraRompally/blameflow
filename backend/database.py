import os
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Generator, Optional

import psycopg2
import psycopg2.extras

# Render provides postgres:// but psycopg2 requires postgresql://
_RAW_URL = os.environ.get("DATABASE_URL")
if not _RAW_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. "
        "On Render: create a free PostgreSQL instance, then add its Internal Database URL "
        "as the DATABASE_URL environment variable on this web service."
    )
DATABASE_URL = (
    _RAW_URL.replace("postgres://", "postgresql://", 1)
    if _RAW_URL.startswith("postgres://")
    else _RAW_URL
)


@contextmanager
def _conn() -> Generator[psycopg2.extensions.connection, None, None]:
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS threads (
                    thread_id            TEXT PRIMARY KEY,
                    repo_url             TEXT UNIQUE NOT NULL,
                    repo_name            TEXT NOT NULL,
                    last_analyzed_commit TEXT,
                    cached_summary       TEXT,
                    created_at           TEXT NOT NULL,
                    updated_at           TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id         BIGSERIAL PRIMARY KEY,
                    thread_id  TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
                    role       TEXT NOT NULL,
                    content    TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS risk_feedback (
                    id         BIGSERIAL PRIMARY KEY,
                    thread_id  TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
                    flag_index INTEGER NOT NULL,
                    verdict    TEXT NOT NULL,
                    note       TEXT,
                    created_at TEXT NOT NULL,
                    UNIQUE(thread_id, flag_index)
                )
            """)
            # migrations for existing deployments
            cur.execute("""
                ALTER TABLE threads ADD COLUMN IF NOT EXISTS scan_metadata JSONB
            """)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Thread CRUD ───────────────────────────────────────────────────────────────

def get_thread(repo_url: str) -> Optional[dict]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM threads WHERE repo_url = %s", (repo_url,))
            row = cur.fetchone()
            return dict(row) if row else None


def get_thread_by_id(thread_id: str) -> Optional[dict]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM threads WHERE thread_id = %s", (thread_id,))
            row = cur.fetchone()
            return dict(row) if row else None


def list_threads() -> list[dict]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM threads ORDER BY updated_at DESC")
            return [dict(r) for r in cur.fetchall()]


def create_thread(
    repo_url: str,
    repo_name: str,
    last_analyzed_commit: str,
    cached_summary: str,
    scan_metadata: Optional[dict] = None,
) -> dict:
    thread_id = uuid.uuid4().hex[:8]
    now = _now()
    meta_val = psycopg2.extras.Json(scan_metadata) if scan_metadata else None
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO threads
                    (thread_id, repo_url, repo_name, last_analyzed_commit, cached_summary,
                     scan_metadata, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (thread_id, repo_url, repo_name, last_analyzed_commit, cached_summary,
                 meta_val, now, now),
            )
    return get_thread_by_id(thread_id)


def update_thread(
    thread_id: str,
    last_analyzed_commit: str,
    cached_summary: str,
) -> dict:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE threads
                SET last_analyzed_commit = %s, cached_summary = %s, updated_at = %s
                WHERE thread_id = %s
                """,
                (last_analyzed_commit, cached_summary, _now(), thread_id),
            )
    return get_thread_by_id(thread_id)


# ── Chat CRUD ─────────────────────────────────────────────────────────────────

def get_chat_history(thread_id: str) -> list[dict]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT role, content FROM chat_messages WHERE thread_id = %s ORDER BY created_at ASC",
                (thread_id,),
            )
            return [{"role": r["role"], "content": r["content"]} for r in cur.fetchall()]


def add_chat_message(thread_id: str, role: str, content: str) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO chat_messages (thread_id, role, content, created_at) VALUES (%s, %s, %s, %s)",
                (thread_id, role, content, _now()),
            )


# ── Risk feedback CRUD ────────────────────────────────────────────────────────

def get_feedback(thread_id: str) -> list[dict]:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT flag_index, verdict, note FROM risk_feedback WHERE thread_id = %s ORDER BY flag_index",
                (thread_id,),
            )
            return [dict(r) for r in cur.fetchall()]


def upsert_feedback(thread_id: str, flag_index: int, verdict: str, note: str = "") -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO risk_feedback (thread_id, flag_index, verdict, note, created_at)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (thread_id, flag_index)
                DO UPDATE SET verdict = EXCLUDED.verdict, note = EXCLUDED.note
                """,
                (thread_id, flag_index, verdict, note or None, _now()),
            )


def reset_thread(thread_id: str) -> None:
    with _conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE threads
                SET cached_summary = NULL, last_analyzed_commit = NULL,
                    scan_metadata = NULL, updated_at = %s
                WHERE thread_id = %s
                """,
                (_now(), thread_id),
            )
            cur.execute("DELETE FROM chat_messages WHERE thread_id = %s", (thread_id,))
            cur.execute("DELETE FROM risk_feedback WHERE thread_id = %s", (thread_id,))
