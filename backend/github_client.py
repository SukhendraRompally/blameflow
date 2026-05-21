import base64
import os
import time
from urllib.parse import urlparse

import httpx

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
BASE_URL = "https://api.github.com"
MAX_README_CHARS = 8_000
MAX_DIFF_CHARS = 40_000
MAX_FILE_CHARS = 6_000       # per file in full-codebase scan
MAX_CODEBASE_CHARS = 120_000 # total across all files
MAX_FILES = 80               # max individual files to fetch

# Directories that are never useful to read
_SKIP_DIRS = frozenset({
    "node_modules", ".git", "dist", "build", ".next", "out", "vendor",
    "__pycache__", ".venv", "venv", "coverage", ".pytest_cache", "target",
    ".turbo", ".cache", "eggs", ".eggs", "htmlcov", ".mypy_cache",
})

# Extensions that are binary or generated — skip entirely
_SKIP_EXTENSIONS = frozenset({
    ".lock", ".min.js", ".min.css", ".map", ".png", ".jpg", ".jpeg",
    ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".pdf",
    ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".dylib", ".pyc",
    ".pyo", ".class", ".bin", ".dat", ".db", ".sqlite", ".DS_Store",
})

# Source files ranked by how much the LLM learns from them
_PRIORITY = {
    # Tier 0 — project manifests
    "package.json": 0, "requirements.txt": 0, "pyproject.toml": 0,
    "go.mod": 0, "Cargo.toml": 0, "pom.xml": 0, "build.gradle": 0,
    # Tier 1 — source code
    **{ext: 1 for ext in (
        ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs",
        ".java", ".rb", ".php", ".cs", ".cpp", ".c", ".swift", ".kt",
    )},
    # Tier 2 — config / infra
    **{ext: 2 for ext in (".yaml", ".yml", ".toml", ".json", ".env.example")},
    # Tier 3 — docs
    **{ext: 3 for ext in (".md", ".rst", ".txt")},
}


def _headers() -> dict:
    h = {"Accept": "application/vnd.github.v3+json", "X-GitHub-Api-Version": "2022-11-28"}
    if GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return h


def parse_repo_url(url: str) -> tuple[str, str]:
    url = url.strip().rstrip("/")
    if "://" not in url:
        url = "https://" + url
    parsed = urlparse(url)
    parts = [p for p in parsed.path.strip("/").split("/") if p]
    if parsed.netloc not in ("github.com", "www.github.com") or len(parts) < 2:
        raise ValueError(f"Expected a public GitHub URL, got: {url}")
    return parts[0], parts[1]


def fetch_recent_commits(owner: str, repo: str, n: int = 5) -> list[dict]:
    with httpx.Client(headers=_headers(), timeout=30) as client:
        resp = client.get(f"{BASE_URL}/repos/{owner}/{repo}/commits?per_page={n}")
        resp.raise_for_status()
        raw = resp.json()

    return [
        {
            "sha": c["sha"],
            "short_sha": c["sha"][:7],
            "message": c["commit"]["message"].split("\n")[0][:120],
            "author": c["commit"]["author"]["name"],
            "date": c["commit"]["author"]["date"],
        }
        for c in raw
    ]


def fetch_readme(owner: str, repo: str) -> str:
    with httpx.Client(headers=_headers(), timeout=30) as client:
        resp = client.get(f"{BASE_URL}/repos/{owner}/{repo}/readme")
        if resp.status_code == 404:
            return ""
        resp.raise_for_status()
        data = resp.json()

    content = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    return content[:MAX_README_CHARS]


def fetch_diff(owner: str, repo: str, base_sha: str, head_sha: str) -> str:
    """Unified diff between two commits for incremental updates."""
    with httpx.Client(headers=_headers(), timeout=60) as client:
        resp = client.get(f"{BASE_URL}/repos/{owner}/{repo}/compare/{base_sha}...{head_sha}")
        resp.raise_for_status()
        data = resp.json()

    files = data.get("files", [])
    parts: list[str] = []
    total = 0

    for f in files:
        filename = f.get("filename", "")
        patch = f.get("patch", "")
        status = f.get("status", "modified")

        if not patch:
            parts.append(f"[{status.upper()}] {filename} — (no text diff)\n")
            continue

        chunk = f"--- a/{filename}\n+++ b/{filename}  [{status}]\n{patch}\n\n"

        if total + len(chunk) > MAX_DIFF_CHARS:
            remaining = MAX_DIFF_CHARS - total
            if remaining > 300:
                parts.append(chunk[:remaining] + "\n... [diff truncated]\n")
            break

        parts.append(chunk)
        total += len(chunk)

    return "".join(parts)


# ── Full codebase scan (new threads only) ─────────────────────────────────────

def _file_priority(path: str) -> int:
    """Lower = fetched first. Skipped files return 99."""
    segments = path.split("/")
    # Drop anything inside a skip directory
    if any(seg in _SKIP_DIRS for seg in segments[:-1]):
        return 99
    filename = segments[-1]
    ext = os.path.splitext(filename)[1].lower()
    if ext in _SKIP_EXTENSIONS:
        return 99
    # Exact filename match (e.g. package.json)
    if filename in _PRIORITY:
        return _PRIORITY[filename]
    # Extension match
    return _PRIORITY.get(ext, 10)


def _fetch_file_tree(owner: str, repo: str, sha: str) -> list[str]:
    """Return all blob paths in the repo at sha, filtered and priority-sorted."""
    with httpx.Client(headers=_headers(), timeout=30) as client:
        resp = client.get(
            f"{BASE_URL}/repos/{owner}/{repo}/git/trees/{sha}",
            params={"recursive": "1"},
        )
        resp.raise_for_status()
        data = resp.json()

    paths = [
        item["path"]
        for item in data.get("tree", [])
        if item["type"] == "blob" and _file_priority(item["path"]) < 99
    ]
    paths.sort(key=_file_priority)
    return paths


def _fetch_file_content(owner: str, repo: str, path: str) -> str:
    with httpx.Client(headers=_headers(), timeout=20) as client:
        resp = client.get(f"{BASE_URL}/repos/{owner}/{repo}/contents/{path}")
        if resp.status_code in (404, 403):
            return ""
        resp.raise_for_status()
        data = resp.json()

    if data.get("encoding") != "base64" or not data.get("content"):
        return ""

    try:
        return base64.b64decode(data["content"]).decode("utf-8", errors="replace")[:MAX_FILE_CHARS]
    except Exception:
        return ""


def fetch_full_codebase(owner: str, repo: str, sha: str) -> tuple[str, dict]:
    """
    Fetch the full source tree at HEAD for first-time thread analysis.
    Returns (codebase_str, metadata_dict) where metadata contains scan stats.
    """
    start = time.time()
    try:
        paths = _fetch_file_tree(owner, repo, sha)
    except Exception:
        return "", {}

    total_files = len(paths)
    parts: list[str] = []
    total = 0
    fetched = 0

    for path in paths:
        if fetched >= MAX_FILES or total >= MAX_CODEBASE_CHARS:
            remaining = total_files - fetched
            parts.append(
                f"\n\n... [{remaining} more files not shown — "
                f"limit of {MAX_FILES} files / {MAX_CODEBASE_CHARS:,} chars reached]\n"
            )
            break

        content = _fetch_file_content(owner, repo, path)
        if not content.strip():
            continue

        chunk = f"### {path}\n```\n{content}\n```\n\n"
        parts.append(chunk)
        total += len(chunk)
        fetched += 1

    metadata = {
        "files_scanned": fetched,
        "total_files": total_files,
        "chars_sent": total,
        "excluded_dirs": sorted(_SKIP_DIRS),
        "duration_ms": int((time.time() - start) * 1000),
    }
    return "".join(parts), metadata
