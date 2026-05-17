# Blameflow

> **Trace the fault. Own the code.**

Blameflow is an AI-powered git forensics tool that analyzes a public GitHub repository's recent commit history to:

- **Pre-emptively flag architectural risks** introduced by rapid or non-technical commits
- **Debug production symptoms** by pinpointing the exact commit, file, and lines responsible

Built with FastAPI + Next.js, designed to deploy on **Railway** (backend) + **Vercel** (frontend).

---

## Architecture

```
blameflow/
├── backend/          # FastAPI — deploy on Railway
│   ├── main.py       # API routes
│   ├── database.py   # SQLite thread store
│   ├── github_client.py  # GitHub REST API (commits, readme, diff)
│   ├── analyzer.py   # LLM prompt orchestration
│   └── llm/          # Swappable LLM provider layer
│       ├── base.py
│       ├── azure_openai.py   # default
│       ├── anthropic.py
│       └── openai_provider.py
└── frontend/         # Next.js 14 — deploy on Vercel
    └── src/
        ├── app/
        ├── components/
        │   ├── ThreadSidebar.tsx
        │   ├── RiskDashboard.tsx
        │   └── ChatInterface.tsx
        └── lib/api.ts
```

---

## Local Development

### Backend

```bash
cd backend
cp .env.example .env          # fill in your LLM credentials
python -m venv .venv
source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
# API running at http://localhost:8000
```

### Frontend

```bash
cd frontend
cp .env.example .env.local    # set NEXT_PUBLIC_API_URL=http://localhost:8000
npm install
npm run dev
# UI running at http://localhost:3000
```

---

## LLM Configuration

Set `LLM_PROVIDER` in your `.env` to switch the AI brain:

| Provider | `LLM_PROVIDER` value | Required env vars |
|---|---|---|
| Azure OpenAI (default) | `azure_openai` | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `OPENAI_API_KEY` |

---

## Deployment

### Railway (Backend)

1. Connect this repo in Railway → select the `backend/` root directory
2. Set all env vars from `backend/.env.example` in the Railway dashboard
3. Add a **Volume** mounted at `/app` and set `DB_PATH=/app/workspace.db` for persistence
4. Railway auto-detects `railway.toml` — start command is pre-configured

### Vercel (Frontend)

1. Connect this repo in Vercel → set **Root Directory** to `frontend/`
2. Add env var: `NEXT_PUBLIC_API_URL=https://your-app.railway.app`
3. Deploy — Vercel detects Next.js automatically

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check + active LLM provider |
| `GET` | `/api/threads` | List all analyzed repositories |
| `POST` | `/api/threads/sync` | Ingest or sync a repo `{ repo_url }` |
| `GET` | `/api/threads/{id}` | Get thread + full chat history |
| `POST` | `/api/threads/{id}/chat` | Submit a symptom `{ message }` |

---

## Features

- **Incremental ledger caching** — only diffs new commits since last sync, no redundant LLM calls
- **Risk Dashboard** — overview, recent activity summary, and 2–4 pre-emptive architectural risk flags
- **Natural language debugger** — pinpoints culprit commit, author, file, and exact diff lines
- **Provider-agnostic LLM layer** — swap Azure OpenAI / Anthropic / OpenAI via one env var
