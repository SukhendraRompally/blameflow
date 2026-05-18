from llm.base import LLMProvider

_SYSTEM = """You are Blameflow — an expert git forensics engine and code archaeologist.
Your role is to analyze full codebases and commit histories to surface hidden architectural
risks, and to pinpoint the exact commits and lines responsible for production regressions.

Rules:
- Always output clean, structured Markdown using the exact section headers requested.
- Be precise: reference specific commit SHAs (short), file paths, and line numbers.
- When flagging risks, focus on cross-cutting concerns, missing validations, silent
  dependency side-effects, and logic shared across features.
- For new threads you have the FULL source tree — use it. Reference actual function names,
  class hierarchies, and module dependencies you can see in the code.
- Never speculate beyond what the code and diffs actually show. If uncertain, say so.
"""


def _commits_text(commits: list[dict]) -> str:
    return "\n".join(
        f"- `{c['short_sha']}` ({c['date'][:10]}) — {c['message']}  [{c['author']}]"
        for c in commits
    )


# ── Flow A: New thread (full codebase scan) ───────────────────────────────────

def analyze_new_thread(
    readme: str,
    codebase: str,
    commits: list[dict],
    llm: LLMProvider,
) -> str:
    prompt = f"""Analyze this repository and produce a structured Blameflow report.
You have access to the FULL source tree, not just a diff. Use it to build a deep
understanding of the architecture before flagging risks.

## README
{readme or "(No README found)"}

## Recent Commits (newest → oldest)
{_commits_text(commits)}

## Full Source Tree
{codebase or "(Source tree unavailable)"}

Produce a report with EXACTLY these sections and no others:

## Codebase Overview
[3–4 paragraphs. Cover: what this repo does, the overall architecture (layers, modules,
key patterns), the tech stack, and how the major components interact. Reference actual
file paths and function/class names you can see in the source.]

## Recent Activity Summary
[Plain-English summary of what these {len(commits)} commits changed — not just which
files, but how those changes affect the architecture and which other modules they touch.]

## ⚠️ Pre-emptive Risk Flags
- **[Risk title]:** [What the risk is, why it's dangerous, and which file/function is the
  blast radius.] *(commit `SHA` if introduced recently, file `path/to/file:line`)*

[List 3–5 distinct risk flags grounded in the actual source code. Flag things like:
missing input validation, shared utilities modified without updating all callers,
unhandled error paths, implicit coupling between modules, security anti-patterns.]

---
*Full scan · HEAD `{commits[0]['short_sha']}` · {len(commits)} recent commits indexed*
"""
    return llm.complete([{"role": "user", "content": prompt}], system=_SYSTEM)


# ── Flow A: Incremental update ────────────────────────────────────────────────

def analyze_incremental(
    cached_summary: str,
    delta_diff: str,
    new_commits: list[dict],
    llm: LLMProvider,
) -> str:
    prompt = f"""Update the existing Blameflow report with new commit activity.

## Existing Report
{cached_summary}

## New Commits Since Last Analysis
{_commits_text(new_commits)}

## Delta Diff (only new changes)
```diff
{delta_diff or "(No diff available)"}
```

Instructions:
1. Keep "Codebase Overview" exactly as-is unless this delta fundamentally changes the architecture.
2. REPLACE "Recent Activity Summary" with a fresh summary covering only these new commits.
3. APPEND any new risk flags discovered in this delta to "⚠️ Pre-emptive Risk Flags". Keep prior flags.
4. Update the footer line with the new HEAD SHA.

Output the COMPLETE updated report (all sections, full text).
"""
    return llm.complete([{"role": "user", "content": prompt}], system=_SYSTEM)


# ── Flow C: Interactive debugger ──────────────────────────────────────────────

def debug_symptom(
    cached_summary: str,
    chat_history: list[dict],
    symptom: str,
    llm: LLMProvider,
) -> str:
    # Seed the conversation with the full codebase context
    messages: list[dict] = [
        {
            "role": "user",
            "content": (
                "Here is the Blameflow codebase report for context:\n\n"
                "<blameflow_context>\n"
                f"{cached_summary}\n"
                "</blameflow_context>\n\n"
                "I will ask you debugging questions. Use the commit history and diffs above "
                "to answer with commit-level precision."
            ),
        },
        {
            "role": "assistant",
            "content": (
                "Blameflow context loaded. I have the full commit history, diffs, "
                "codebase overview, and risk flags in scope. Ready to diagnose."
            ),
        },
    ]

    messages.extend(chat_history)

    messages.append(
        {
            "role": "user",
            "content": f"""Production symptom reported:

"{symptom}"

Diagnose this using the commit history and diffs in the Blameflow context.
Output EXACTLY this structure (use all four sections):

## 🔍 The Culprit
**Commit:** `[short SHA]` · **Author:** [name] · **Date:** [YYYY-MM-DD]
**File:** `[path/to/file]`

## 💉 The Diagnosis
[Explain the exact broken assumption, dependency side-effect, or regression. Be specific
about what changed in that commit and precisely how it produces the reported symptom.]

## 📍 Line-Level Pinpoint
```diff
[Paste the exact diff hunk or lines from that commit that caused the issue]
```
**Lines [X–Y]** in `[path/to/file]` — [One sentence: what this code does and how it breaks the symptom.]

## 🛠 Suggested Fix
[Concrete, actionable fix referencing exact lines. If a fix requires understanding runtime state, say so.]

---
*If you cannot confidently identify a single culprit from the available diff data, explicitly say so
and list the top 2 candidates with your reasoning for each.*
""",
        }
    )

    return llm.complete(messages, system=_SYSTEM)
