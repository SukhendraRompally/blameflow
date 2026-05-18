# Blameflow

**Trace the fault. Own the code.**

Blameflow is an AI-powered git forensics tool built for engineers who need to understand what a codebase is doing — and who broke what. Point it at any public GitHub repository and it performs a full source tree scan on first pull, builds a deep architectural model, surfaces pre-emptive risks, and lets you debug production symptoms in plain English — pinpointing the exact commit hash, filename, and line numbers responsible. Every subsequent visit only analyzes new commits, keeping it fast and cheap.

---

## Table of Contents

- [What Does It Do](#what-does-it-do)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [File Structure](#file-structure)
- [State Management](#state-management)
- [API Reference](#api-reference)
- [LLM Configuration](#llm-configuration)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Deployment](#deployment)
  - [Backend on Render](#backend-on-render)
  - [Frontend on Vercel](#frontend-on-vercel)

---

## What Does It Do

Blameflow has three core capabilities:

### 1. Repository Ingestion and Incremental Caching
When you enter a GitHub repo URL for the first time, Blameflow performs a **full source tree scan**: it fetches every relevant source file in the repository (up to 80 files / 120k characters, prioritised by file type), along with the README and recent commits. This full context is sent to the LLM to build a deep architectural model and risk report, which is stored as a persistent **Thread**.

Every subsequent visit compares the current HEAD commit SHA against the stored one. If nothing has changed, the cached report loads instantly with zero LLM calls. If new commits have landed, Blameflow fetches **only the delta diff** since the last sync and incrementally updates the report — never re-processing history that was already analyzed.

### 2. Pre-emptive Risk Dashboard
Every thread produces a structured risk report with three sections:
- **Codebase Overview** — a deep architectural summary covering the repo's purpose, module structure, key patterns, and how major components interact — grounded in actual function names and file paths from the source tree
- **Recent Activity Summary** — plain-English explanation of what the latest commits changed structurally, and which other modules those changes touch
- **Pre-emptive Risk Flags** — 3–5 specific warnings about hidden architectural risks visible in the code, such as a utility function being modified without updating all callers, missing input validation on a new API parameter, or implicit coupling between modules that wasn't obvious from the commit message

### 3. Natural Language Debugger
A persistent chat interface lets you describe a production symptom in plain English. Blameflow evaluates the symptom against the full cached context (the architecture model plus the commit diff history) and returns a structured forensic response:

- **The Culprit** — the specific commit hash, author, date, and filename most likely responsible
- **The Diagnosis** — the exact broken assumption or dependency side-effect that causes the symptom
- **Line-Level Pinpoint** — the exact diff hunk from that commit showing the lines that introduced the regression
- **Suggested Fix** — a concrete, actionable remediation

---

## How It Works

```
User enters GitHub URL
        │
        ▼
┌───────────────────┐
│  Parse owner/repo │
│  from URL         │
└────────┬──────────┘
         │
         ▼
┌────────────────────────────────────┐
│  Fetch last 5 commits via          │
│  GitHub REST API                   │
│  GET /repos/{owner}/{repo}/commits │
└────────┬───────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│  Check PostgreSQL for existing     │
│  thread matching this repo URL     │
└────────┬───────────────────────────┘
         │
    ─────┴──────────────────────────────────
    │                                      │
No thread                           Thread exists
    │                                      │
    ▼                               ───────┴────────
Fetch README                    HEAD SHA        HEAD SHA
+ FULL source tree          matches stored   differs from stored
  (recursive tree API,            │                  │
   up to 80 files / 120k)         ▼                  ▼
+ analyze (LLM)           Load from cache    Fetch delta diff only
+ save thread             (0 LLM calls)      + incremental update (LLM)
                                             + update stored SHA
```

All LLM interaction happens through a generic `LLMProvider` abstract interface. Swapping the AI brain is a one-line environment variable change.

---

## Architecture

```
blameflow/
├── backend/                         # FastAPI — deploys on Render
│   ├── main.py                      # API routes and request handling
│   ├── database.py                  # SQLite CRUD for threads and chat messages
│   ├── github_client.py             # GitHub REST API: commits, README, diffs
│   ├── analyzer.py                  # LLM prompt orchestration (3 prompt paths)
│   ├── llm/
│   │   ├── base.py                  # Abstract LLMProvider interface
│   │   ├── azure_openai.py          # Azure OpenAI implementation (default)
│   │   ├── anthropic.py             # Anthropic Claude implementation
│   │   └── openai_provider.py       # OpenAI implementation
│   ├── render.yaml                  # Render deployment config (auto-detected)
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/                        # Next.js 14 — deploys on Vercel
    └── src/
        ├── app/
        │   ├── page.tsx             # Main page: routing, state, tab bar
        │   ├── layout.tsx           # Root layout with fonts and metadata
        │   └── globals.css          # Tailwind base + custom markdown styles
        ├── components/
        │   ├── ThreadSidebar.tsx    # Repo thread list + new repo input
        │   ├── RiskDashboard.tsx    # Analysis tab: renders cached markdown report
        │   └── ChatInterface.tsx    # Debugger tab: chat history + symptom input
        ├── lib/
        │   └── api.ts               # Typed fetch client for all backend endpoints
        └── types/
            └── index.ts             # Shared TypeScript interfaces
```

### Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Backend framework | FastAPI (Python) | Clean async routes, automatic OpenAPI docs, Pydantic validation |
| Database | PostgreSQL via `psycopg2-binary` | Free managed instance on Render, persists across restarts and deploys |
| GitHub integration | `httpx` + GitHub REST API | Full tree scan on first pull via recursive tree API; delta diffs on subsequent syncs |
| LLM abstraction | Custom `LLMProvider` ABC | Provider-agnostic: swap Azure / Anthropic / OpenAI via env var |
| Default LLM | Azure OpenAI | Enterprise-grade, private endpoint, compatible with OpenAI SDK |
| Frontend framework | Next.js 15 (App Router) | React server/client split, Vercel-native, fast cold starts |
| Styling | Tailwind CSS | Utility-first, zero runtime, dark theme via CSS variables |
| Markdown rendering | `react-markdown` + `remark-gfm` | Safe server-side markdown from LLM responses |
| Icons | `lucide-react` | Consistent, lightweight, tree-shakeable |

---

## File Structure

### Backend

#### `main.py`
The FastAPI application entrypoint. Initializes the database and LLM provider at startup, registers CORS middleware, and defines four route handlers. The `sync_thread` route contains the core branching logic (new thread vs. cache hit vs. incremental update).

#### `database.py`
Manages a PostgreSQL database with two tables:

- `threads` — one row per repository, storing the full analysis state including the cached LLM report
- `chat_messages` — append-only log of all debugger conversations per thread

Uses `psycopg2` with `RealDictCursor` for dict-like row access. Automatically rewrites `postgres://` URLs to `postgresql://` to handle Render's connection string format.

#### `github_client.py`
Five functions wrapping the GitHub REST API:

- `fetch_recent_commits` — retrieves the last N commits with SHA, message, author, and date
- `fetch_readme` — decodes the base64-encoded README, capped at 8,000 characters
- `fetch_full_codebase` — **new-thread only**: fetches the entire source tree via the recursive tree API, filters out binary files and build artefacts, prioritises source code over config over docs, and concatenates file contents up to 80 files / 120,000 characters
- `fetch_diff` — **incremental only**: calls the compare API and stitches `files[].patch` fields into a unified diff string, capped at 40,000 characters
- `_fetch_file_tree` / `_fetch_file_content` — internal helpers used by `fetch_full_codebase`

Respects a `GITHUB_TOKEN` env var. Without it, GitHub's unauthenticated rate limit is 60 requests/hour — which can be a problem for large repos during the initial full scan. With a token the limit rises to 5,000/hour.

#### `analyzer.py`
Contains three LLM prompt functions, each accepting a `LLMProvider` instance:

- `analyze_new_thread(readme, codebase, commits, llm)` — generates the initial report from the full source tree. The prompt instructs the LLM to reference actual function names, class hierarchies, and module dependencies visible in the code
- `analyze_incremental(cached_summary, delta_diff, new_commits, llm)` — appends new findings to an existing report using only the new delta, preserving prior context
- `debug_symptom(cached_summary, chat_history, symptom, llm)` — injects the full cached report as conversation context, then processes the user's symptom to produce a commit-level forensic diagnosis

All three prompts instruct the LLM to output strict structured Markdown so the frontend can render it predictably.

#### `llm/`
An abstract `LLMProvider` base class with a single method: `complete(messages, system) -> str`. Three concrete implementations cover Azure OpenAI, Anthropic, and standard OpenAI. The `get_provider()` factory reads `LLM_PROVIDER` from the environment and returns the appropriate instance.

### Frontend

#### `page.tsx`
Client component that owns all application state: active thread, chat history, cache status, loading state, and the active tab. Handles three async flows: `handleSyncRepo` (ingest), `handleSelectThread` (re-sync on click), and `handleSendMessage` (chat with optimistic UI).

#### `ThreadSidebar.tsx`
Displays the list of analyzed repository threads. Each item shows the repo name, time since last analysis, and the HEAD commit SHA. The active thread is highlighted with a left red accent bar. Contains an inline repo URL input that validates for GitHub URLs before submitting.

#### `RiskDashboard.tsx`
Renders the `cached_summary` markdown from the active thread using `react-markdown`. Shows a cache status badge (Cached / Updated / New Analysis) and a loading skeleton when a first-time analysis is in progress.

#### `ChatInterface.tsx`
A scrollable chat history with role-differentiated bubbles. User messages are right-aligned with a zinc background. Assistant responses are left-aligned cards with full markdown rendering, including code diff blocks. The input textarea auto-grows with content and submits on Enter (Shift+Enter for newlines).

---

## State Management

Every analyzed repository is stored as a persistent **Thread** in SQLite:

```
threads table
├── thread_id            TEXT  — 8-char hex slug (e.g. "8eb71b6b")
├── repo_url             TEXT  — canonical https://github.com/owner/repo
├── repo_name            TEXT  — "owner/repo" display name
├── last_analyzed_commit TEXT  — SHA of the most recently analyzed HEAD commit
├── cached_summary       TEXT  — full Markdown report from the LLM
├── created_at           TEXT  — ISO 8601 UTC timestamp
└── updated_at           TEXT  — ISO 8601 UTC timestamp

chat_messages table
├── id                   BIGSERIAL — auto-incrementing primary key
├── thread_id            TEXT      — foreign key → threads.thread_id
├── role                 TEXT    — "user" or "assistant"
├── content              TEXT    — raw message content
└── created_at           TEXT    — ISO 8601 UTC timestamp
```

### Cache Logic

```
incoming HEAD SHA == stored last_analyzed_commit
    → return cached_summary immediately, no LLM call

incoming HEAD SHA != stored last_analyzed_commit
    → fetch diff between stored SHA and new HEAD only
    → pass delta to LLM to update cached_summary incrementally
    → store new HEAD SHA

no thread exists for this repo_url
    → fetch README
    → fetch FULL source tree (recursive tree API, up to 80 files / 120k chars)
      prioritised: source code > config > docs, binaries and build dirs skipped
    → pass both to LLM for deep initial analysis
    → create new thread row with HEAD SHA
```

---

## API Reference

All endpoints are prefixed at the backend's base URL.

### `GET /health`
Returns the service status and active LLM provider name. Use this to confirm the backend is running and correctly configured.

```json
{ "status": "ok", "llm_provider": "azure_openai" }
```

### `GET /api/threads`
Returns all stored threads sorted by most recently updated. Used to populate the sidebar on page load.

```json
[
  {
    "thread_id": "8eb71b6b",
    "repo_url": "https://github.com/vercel/next.js",
    "repo_name": "vercel/next.js",
    "last_analyzed_commit": "a1b2c3d...",
    "cached_summary": "## Codebase Overview\n...",
    "created_at": "2025-05-17T10:00:00+00:00",
    "updated_at": "2025-05-17T12:30:00+00:00"
  }
]
```

### `POST /api/threads/sync`
The core ingest endpoint. Accepts a GitHub repo URL, runs the cache branching logic, and returns the thread state plus a cache status indicator.

**Request:**
```json
{ "repo_url": "https://github.com/owner/repo" }
```

**Response:**
```json
{
  "thread": { ...thread object... },
  "chat_history": [...],
  "cache_status": "hit" | "miss" | "updated",
  "message": "Loaded from cache — 0 new commits found."
}
```

`cache_status` values:
- `miss` — new thread created, full source tree scanned and analyzed
- `hit` — no new commits, cached report returned instantly (0 LLM calls)
- `updated` — new commits found, delta diff analyzed and report updated

### `GET /api/threads/{thread_id}`
Returns a single thread with its full chat history. Used when loading a specific thread directly.

### `POST /api/threads/{thread_id}/chat`
Submits a natural language symptom and returns a structured forensic diagnosis.

**Request:**
```json
{ "message": "Users are being logged out immediately after clicking save" }
```

**Response:**
```json
{
  "role": "assistant",
  "content": "## 🔍 The Culprit\n**Commit:** `a1b2c3d`..."
}
```

---

## LLM Configuration

The AI layer is fully provider-agnostic. Set the `LLM_PROVIDER` environment variable to switch:

| `LLM_PROVIDER` | Provider | Required Variables |
|---|---|---|
| `azure_openai` (default) | Azure OpenAI | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION` |
| `anthropic` | Anthropic Claude | `ANTHROPIC_API_KEY`, optionally `ANTHROPIC_MODEL` |
| `openai` | OpenAI | `OPENAI_API_KEY`, optionally `OPENAI_MODEL` |

To add a new provider, create a class in `backend/llm/` that extends `LLMProvider` and implements `complete(messages, system) -> str`, then register it in `llm/__init__.py`.

---

## Environment Variables

### Backend

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string — auto-injected on Render, set manually for local dev |
| `LLM_PROVIDER` | No | `azure_openai` | Which LLM backend to use |
| `AZURE_OPENAI_ENDPOINT` | If Azure | — | Your Azure OpenAI resource endpoint |
| `AZURE_OPENAI_API_KEY` | If Azure | — | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | If Azure | — | Deployment name (e.g. `gpt-4o`) |
| `AZURE_OPENAI_API_VERSION` | No | `2024-02-01` | Azure OpenAI API version |
| `ANTHROPIC_API_KEY` | If Anthropic | — | Anthropic API key |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-4-6` | Anthropic model ID |
| `OPENAI_API_KEY` | If OpenAI | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o` | OpenAI model ID |
| `GITHUB_TOKEN` | Strongly recommended | — | GitHub PAT — raises rate limit from 60 to 5,000 req/hr. Without it, the full source tree scan on a large repo can exhaust the unauthenticated quota |
| `ALLOWED_ORIGINS` | No | `*` | Comma-separated CORS allowed origins |

### Frontend

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes (production) | `http://localhost:8000` | Full URL of the deployed backend |

---

## Local Development

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL 14+ running locally (or a free cloud Postgres — [Supabase](https://supabase.com) and [Neon](https://neon.tech) both have free tiers)
- A GitHub account (token optional but recommended)
- An LLM API key (Azure OpenAI, Anthropic, or OpenAI)

### Backend

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your LLM credentials and optionally GITHUB_TOKEN

# Start the API server
uvicorn main:app --reload
# API running at http://localhost:8000
# Interactive docs at http://localhost:8000/docs
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# .env.local already contains: NEXT_PUBLIC_API_URL=http://localhost:8000

# Start the dev server
npm run dev
# UI running at http://localhost:3000
```

Open `http://localhost:3000`, enter a public GitHub repo URL (e.g. `https://github.com/fastapi/fastapi`), and click **Analyze**.

---

## Deployment

### Backend on Render

Blameflow ships a `render.yaml` Blueprint at the repo root that provisions both the **web service** and a **free managed PostgreSQL database** in one step. `DATABASE_URL` is automatically injected — no manual wiring needed.

1. Go to [render.com](https://render.com) → **New** → **Blueprint**
2. Connect your GitHub account and select the `blameflow` repository
3. Render reads `render.yaml` and shows you two resources to create:
   - `blameflow-postgres` — free managed Postgres instance
   - `blameflow-api` — Python web service pointed at `backend/`
4. Click **Apply** — Render provisions the database first, injects `DATABASE_URL` into the web service, then builds and starts the API
5. Once deployed, go to the `blameflow-api` service → **Environment** and fill in the secrets marked `sync: false`:

   | Key | Value |
   |---|---|
   | `AZURE_OPENAI_ENDPOINT` | your Azure endpoint |
   | `AZURE_OPENAI_API_KEY` | your Azure key |
   | `AZURE_OPENAI_DEPLOYMENT` | your deployment name (e.g. `gpt-4o`) |
   | `GITHUB_TOKEN` | your GitHub PAT (recommended) |
   | `ALLOWED_ORIGINS` | `https://your-app.vercel.app` |

6. Save — Render redeploys automatically

> **Free tier note:** The free Postgres instance on Render expires after 90 days and has a 1 GB storage limit. It is sufficient for development and early testing. The web service on the free plan spins down after 15 minutes of inactivity and takes ~30 seconds to cold-start on the next request.

### Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the `blameflow` repository
2. Set **Framework Preset** to `Next.js`
3. Set **Root Directory** to `frontend`
4. Under **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://your-render-service.onrender.com` |

5. Click **Deploy**

Once both services are live:
- Copy the Render backend URL → update `NEXT_PUBLIC_API_URL` in Vercel
- Copy the Vercel frontend URL → update `ALLOWED_ORIGINS` in Render

Vercel re-deploys automatically on every push to `main`. Render does too by default.
