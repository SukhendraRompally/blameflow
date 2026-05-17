import base64
import os
from urllib.parse import urlparse

import httpx

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
BASE_URL = "https://api.github.com"
MAX_DIFF_CHARS = 40_000
MAX_README_CHARS = 8_000


def _headers() -> dict:
    h = {"Accept": "application/vnd.github.v3+json", "X-GitHub-Api-Version": "2022-11-28"}
    if GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return h


def parse_repo_url(url: str) -> tuple[str, str]:
    url = url.strip().rstrip("/")
    # Handle both https://github.com/owner/repo and github.com/owner/repo
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
    """Fetch and stitch the unified diff between two commits via the GitHub compare API."""
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
            # Binary or too-large file — note it but skip the patch
            parts.append(f"[{status.upper()}] {filename} — (no text diff available)\n")
            continue

        header = f"--- a/{filename}\n+++ b/{filename}  [{status}]\n"
        chunk = header + patch + "\n\n"

        if total + len(chunk) > MAX_DIFF_CHARS:
            remaining = MAX_DIFF_CHARS - total
            if remaining > 300:
                parts.append(chunk[:remaining] + "\n... [diff truncated at limit]\n")
            break

        parts.append(chunk)
        total += len(chunk)

    return "".join(parts)
