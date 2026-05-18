import os

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import database
from analyzer import analyze_incremental, analyze_new_thread, debug_symptom
from github_client import fetch_diff, fetch_full_codebase, fetch_readme, fetch_recent_commits, parse_repo_url
from llm import LLMProvider, get_provider

# ── Boot ──────────────────────────────────────────────────────────────────────

database.init_db()

# Lazy — instantiated on first request so the server starts even if LLM
# credentials haven't been added to Render's env vars yet.
_llm: LLMProvider | None = None

def get_llm() -> LLMProvider:
    global _llm
    if _llm is None:
        _llm = get_provider()
    return _llm

app = FastAPI(title="Blameflow API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request/Response models ───────────────────────────────────────────────────

class SyncRequest(BaseModel):
    repo_url: str


class ChatRequest(BaseModel):
    message: str


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    provider_name = os.getenv("LLM_PROVIDER", "azure_openai")
    return {"status": "ok", "llm_provider": provider_name}


@app.get("/api/threads")
def list_threads():
    return database.list_threads()


@app.post("/api/threads/sync")
def sync_thread(req: SyncRequest):
    repo_url = req.repo_url.strip().rstrip("/")

    try:
        owner, repo = parse_repo_url(repo_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Normalise the URL so variations of the same repo collapse to one thread
    canonical_url = f"https://github.com/{owner}/{repo}"

    try:
        commits = fetch_recent_commits(owner, repo, n=5)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"GitHub API error: {exc}")

    if not commits:
        raise HTTPException(status_code=422, detail="No commits found in repository.")

    head_sha = commits[0]["sha"]
    existing = database.get_thread(canonical_url)

    # ── Case 1: cache hit — nothing new ──────────────────────────────────────
    if existing and existing["last_analyzed_commit"] == head_sha:
        return {
            "thread": existing,
            "chat_history": database.get_chat_history(existing["thread_id"]),
            "cache_status": "hit",
            "message": "Loaded from cache — 0 new commits found.",
        }

    repo_name = f"{owner}/{repo}"

    # ── Case 2: existing thread, new commits ──────────────────────────────────
    if existing:
        try:
            delta_diff = fetch_diff(owner, repo, existing["last_analyzed_commit"], head_sha)
        except Exception:
            delta_diff = ""

        # Keep only commits newer than the stored SHA
        new_commits = []
        for c in commits:
            if c["sha"] == existing["last_analyzed_commit"]:
                break
            new_commits.append(c)

        updated_summary = analyze_incremental(
            existing["cached_summary"], delta_diff, new_commits or commits, llm
        )
        thread = database.update_thread(existing["thread_id"], head_sha, updated_summary)
        return {
            "thread": thread,
            "chat_history": database.get_chat_history(thread["thread_id"]),
            "cache_status": "updated",
            "message": f"Synced {len(new_commits)} new commit(s).",
        }

    # ── Case 3: brand-new thread — full codebase scan ────────────────────────
    readme = fetch_readme(owner, repo)

    try:
        codebase = fetch_full_codebase(owner, repo, head_sha)
    except Exception:
        codebase = ""

    cached_summary = analyze_new_thread(readme, codebase, commits, get_llm())
    thread = database.create_thread(canonical_url, repo_name, head_sha, cached_summary)

    return {
        "thread": thread,
        "chat_history": [],
        "cache_status": "miss",
        "message": f"New thread created — full codebase scanned.",
    }


@app.get("/api/threads/{thread_id}")
def get_thread(thread_id: str):
    thread = database.get_thread_by_id(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    return {
        "thread": thread,
        "chat_history": database.get_chat_history(thread_id),
    }


@app.post("/api/threads/{thread_id}/chat")
def chat(thread_id: str, req: ChatRequest):
    thread = database.get_thread_by_id(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found.")
    if not thread.get("cached_summary"):
        raise HTTPException(status_code=422, detail="Thread has no analysis yet. Run a sync first.")

    history = database.get_chat_history(thread_id)
    response_text = debug_symptom(thread["cached_summary"], history, req.message, get_llm())

    database.add_chat_message(thread_id, "user", req.message)
    database.add_chat_message(thread_id, "assistant", response_text)

    return {"role": "assistant", "content": response_text}
