from llm.base import LLMProvider

_SYSTEM = """You are Blameflow — an expert git forensics engine and code archaeologist.
Your role is to analyze commit histories and diffs to surface hidden architectural risks,
and to pinpoint the exact commits and lines responsible for production regressions.

Rules:
- Always output clean, structured Markdown using the exact section headers requested.
- Be precise: reference specific commit SHAs (short), file paths, and line numbers.
- When flagging risks, focus on cross-cutting concerns, missing validations, silent
  dependency side-effects, and logic shared across features.
- Never speculate beyond what the diffs actually show. If uncertain, say so.
"""


def _commits_text(commits: list[dict]) -> str:
    return "\n".join(
        f"- `{c['short_sha']}` ({c['date'][:10]}) — {c['message']}  [{c['author']}]"
        for c in commits
    )


# ── Flow A: New thread ────────────────────────────────────────────────────────

def analyze_new_thread(
    readme: str,
    diff: str,
    commits: list[dict],
    llm: LLMProvider,
) -> str:
    prompt = f"""Analyze this repository and produce a structured Blameflow report.

## README
{readme or "(No README found)"}

## Recent Commits (newest → oldest)
{_commits_text(commits)}

## Cumulative Diff (last {len(commits)} commits)
```diff
{diff or "(No diff available — repository may have a single commit)"}
```

Produce a report with EXACTLY these sections and no others:

## Codebase Overview
[2–3 paragraphs on what this repo does architecturally. Identify key modules, patterns, and tech stack inferred from the diff and README.]

## Recent Activity Summary
[Plain-English summary of what these {len(commits)} commits changed structurally — not just what files changed, but why it matters architecturally.]

## ⚠️ Pre-emptive Risk Flags
- **[Risk title]:** [What the risk is, which commit introduced it, and why it's dangerous.] *(commit `SHA`, file `path/to/file`)*

[List 2–4 distinct risk flags. If there are genuinely no risks, say "No significant risks detected in this delta."]

---
*Analyzed {len(commits)} commits · `{commits[-1]['short_sha']}` → `{commits[0]['short_sha']}`*
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
