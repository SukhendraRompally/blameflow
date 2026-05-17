# Blameflow

**Trace the fault. Own the code.**

Blameflow is an AI-powered git forensics tool built for engineers who need to understand what a codebase has been doing recently — and who broke what. Point it at any public GitHub repository and it will analyze the last five commits, surface pre-emptive architectural risks, and let you debug production symptoms in plain English, pinpointing the exact commit hash, filename, and line numbers responsible.

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
When you enter a GitHub repo URL, Blameflow fetches the last five commits, the README, and the cumulative diff across those commits. It sends this to an LLM to generate a structured codebase overview and risk report. This report is stored as a persistent **Thread**.

The next time the same repo is opened, Blameflow compares the current HEAD commit against the stored one. If no new commits have landed, it loads the cached report instantly with zero LLM calls. If new commits exist, it fetches **only the delta diff** and incrementally updates the report, never re-analyzing commits that were already processed.

### 2. Pre-emptive Risk Dashboard
Every thread produces a structured risk report with three sections:
- **Codebase Overview** — what the repo does architecturally, key modules and patterns inferred from the diff and README
- **Recent Activity Summary** — plain-English explanation of what the last commits changed structurally, not just which files touched
- **Pre-emptive Risk Flags** — 2–4 specific warnings about hidden architectural risks introduced by those commits, such as a utility function being modified without updating callers, missing validation on a new API parameter, or a silent breaking change to a shared interface

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
│  Check workspace.db for existing   │
│  thread matching this repo URL     │
└────────┬───────────────────────────┘
         │
    ─────┴──────────────────────────
    │                              │
No thread                    Thread exists
    │                              │
    ▼                         ─────┴──────
Fetch README              HEAD SHA      HEAD SHA
+ full diff          matches stored  differs from stored
+ analyze (LLM)           │                │
+ save thread             ▼                ▼
                    Load from cache   Fetch delta diff only
                    (0 LLM calls)     + incremental update (LLM)
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
| Database | SQLite via stdlib `sqlite3` | Zero-dependency, file-based, easy to persist on Render disk |
| GitHub integration | `httpx` + GitHub REST API | No local git cloning needed; diffs fetched via compare API |
| LLM abstraction | Custom `LLMProvider` ABC | Provider-agnostic: swap Azure / Anthropic / OpenAI via env var |
| Default LLM | Azure OpenAI | Enterprise-grade, private endpoint, compatible with OpenAI SDK |
| Frontend framework | Next.js 14 (App Router) | React server/client split, Vercel-native, fast cold starts |
| Styling | Tailwind CSS | Utility-first, zero runtime, dark theme via CSS variables |
| Markdown rendering | `react-markdown` + `remark-gfm` | Safe server-side markdown from LLM responses |
| Icons | `lucide-react` | Consistent, lightweight, tree-shakeable |

---

## File Structure

### Backend

#### `main.py`
The FastAPI application entrypoint. Initializes the database and LLM provider at startup, registers CORS middleware, and defines four route handlers. The `sync_thread` route contains the core branching logic (new thread vs. cache hit vs. incremental update).

#### `database.py`
Manages a local SQLite database (`workspace.db`) with two tables:

- `threads` — one row per repository, storing the analysis state
- `chat_messages` — append-only log of all debugger conversations per thread

All functions use the stdlib `sqlite3` module with `row_factory = sqlite3.Row` for dict-like access.

#### `github_client.py`
Three functions wrapping the GitHub REST API:

- `fetch_recent_commits` — retrieves the last N commits with SHA, message, author, and date
- `fetch_readme` — decodes the base64-encoded README content, capped at 8,000 characters
- `fetch_diff` — calls the compare API, stitches together `files[].patch` fields into a unified diff string, hard-capped at 40,000 characters to control token costs

Respects a `GITHUB_TOKEN` env var. Without it, GitHub's unauthenticated rate limit of 60 requests/hour applies. With it, the limit rises to 5,000/hour.

#### `analyzer.py`
Contains three LLM prompt functions, each accepting a `LLMProvider` instance:

- `analyze_new_thread(readme, diff, commits, llm)` — generates the initial full report from README + cumulative diff
- `analyze_incremental(cached_summary, delta_diff, new_commits, llm)` — appends new findings to an existing report using only the new delta
- `debug_symptom(cached_summary, chat_history, symptom, llm)` — injects the full cached report as conversation context, then processes the user's symptom against it

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
├── id                   INTEGER — autoincrement primary key
├── thread_id            TEXT    — foreign key → threads.thread_id
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
    → fetch README + cumulative diff across last 5 commits
    → pass both to LLM for full initial analysis
    → create new thread row
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
- `miss` — new thread created, full analysis performed
- `hit` — no new commits, cached report returned
- `updated` — new commits found, delta analyzed and report updated

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
| `LLM_PROVIDER` | No | `azure_openai` | Which LLM backend to use |
| `AZURE_OPENAI_ENDPOINT` | If Azure | — | Your Azure OpenAI resource endpoint |
| `AZURE_OPENAI_API_KEY` | If Azure | — | Azure OpenAI API key |
| `AZURE_OPENAI_DEPLOYMENT` | If Azure | — | Deployment name (e.g. `gpt-4o`) |
| `AZURE_OPENAI_API_VERSION` | No | `2024-02-01` | Azure OpenAI API version |
| `ANTHROPIC_API_KEY` | If Anthropic | — | Anthropic API key |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-4-6` | Anthropic model ID |
| `OPENAI_API_KEY` | If OpenAI | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o` | OpenAI model ID |
| `GITHUB_TOKEN` | No | — | GitHub PAT — raises rate limit from 60 to 5,000 req/hr |
| `DB_PATH` | No | `./workspace.db` | Path to the SQLite database file |
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

Blameflow includes a `render.yaml` in the `backend/` directory that Render auto-detects.

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repository and select it
3. Set **Root Directory** to `backend`
4. Render reads `render.yaml` automatically — build and start commands are pre-configured
5. Under **Environment**, add the following variables:

   | Key | Value |
   |---|---|
   | `LLM_PROVIDER` | `azure_openai` |
   | `AZURE_OPENAI_ENDPOINT` | your endpoint |
   | `AZURE_OPENAI_API_KEY` | your key |
   | `AZURE_OPENAI_DEPLOYMENT` | your deployment name |
   | `GITHUB_TOKEN` | your GitHub PAT (recommended) |
   | `ALLOWED_ORIGINS` | `https://your-app.vercel.app` |

6. Under **Disks**, add a disk:
   - Name: `blameflow-db`
   - Mount path: `/var/data`
   - The `DB_PATH=/var/data/workspace.db` env var is already set in `render.yaml`

7. Click **Create Web Service** — Render will build and deploy automatically

> **Note on the free tier:** Render's free tier does not include persistent disks. The SQLite database will reset on each deploy/restart. For persistent threads across restarts, use a paid plan with a disk, or replace `database.py` with a Postgres-backed implementation using a free Render Postgres instance.

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
