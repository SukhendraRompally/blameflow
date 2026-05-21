"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import {
  RefreshCw,
  CheckCircle2,
  Zap,
  AlertTriangle,
  GitCommit,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  FileCode,
} from "lucide-react";
import type { CacheStatus, RiskFeedback, Thread } from "@/types";
import { submitFeedback } from "@/lib/api";

interface Props {
  thread: Thread;
  cacheStatus: CacheStatus;
  cacheMessage: string;
  isLoading: boolean;
  onReanalyze: () => void;
}

// ── Cache badge ───────────────────────────────────────────────────────────────

function CacheBadge({ status, message }: { status: CacheStatus; message: string }) {
  const cfg = {
    hit: {
      icon: <CheckCircle2 size={11} />,
      label: "Cached",
      cls: "bg-blue-950/60 text-blue-400 border-blue-800/50",
    },
    miss: {
      icon: <Zap size={11} />,
      label: "New Analysis",
      cls: "bg-emerald-950/60 text-emerald-400 border-emerald-800/50",
    },
    updated: {
      icon: <RefreshCw size={11} />,
      label: "Updated",
      cls: "bg-amber-950/60 text-amber-400 border-amber-800/50",
    },
    "": null,
  }[status];

  if (!cfg) return null;

  return (
    <div
      className={clsx(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10.5px] font-medium",
        cfg.cls
      )}
      title={message}
    >
      {cfg.icon}
      {cfg.label}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonLine({ w = "100%" }: { w?: string }) {
  return <div className="h-3 bg-zinc-800 rounded animate-pulse" style={{ width: w }} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 p-6">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2.5">
          <SkeletonLine w="40%" />
          <SkeletonLine />
          <SkeletonLine w="90%" />
          <SkeletonLine w="75%" />
        </div>
      ))}
    </div>
  );
}

// ── Scan metadata panel ───────────────────────────────────────────────────────

function ScanMetaPanel({ meta }: { meta: NonNullable<Thread["scan_metadata"]> }) {
  const [open, setOpen] = useState(false);
  const kb = Math.round(meta.chars_sent / 1024);
  const pct = meta.total_files > 0 ? Math.round((meta.files_scanned / meta.total_files) * 100) : 0;

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-zinc-900/60 hover:bg-zinc-800/60 transition-colors text-zinc-400"
      >
        <div className="flex items-center gap-2">
          <FileCode size={12} className="text-zinc-500" />
          <span className="font-medium">Scan details</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">
            {meta.files_scanned}/{meta.total_files} files · {kb} KB sent · {meta.duration_ms}ms
          </span>
        </div>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div className="px-4 py-3 bg-zinc-950/40 space-y-2 text-zinc-500 border-t border-zinc-800">
          <div className="flex items-center gap-3">
            <span>Coverage:</span>
            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#e51414] rounded-full"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-zinc-400">{pct}%</span>
          </div>
          <div>
            <span className="text-zinc-600">Excluded dirs: </span>
            {meta.excluded_dirs.slice(0, 8).map((d) => (
              <span key={d} className="font-mono text-zinc-600 text-[10px] mr-1.5">
                {d}
              </span>
            ))}
            {meta.excluded_dirs.length > 8 && (
              <span className="text-zinc-700 text-[10px]">+{meta.excluded_dirs.length - 8} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Clickable SHA / file-path code wrapper ────────────────────────────────────

function makeCodeComponent(repoUrl: string, headSha: string | null) {
  const repoPath = repoUrl.replace("https://github.com/", "");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function CodeEl({ children, ...props }: any) {
    const text = String(children).trim();

    if (/^[0-9a-f]{7}$/.test(text) && repoPath) {
      return (
        <a
          href={`https://github.com/${repoPath}/commit/${text}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#e51414] hover:underline"
        >
          <code {...props}>{children}</code>
        </a>
      );
    }

    if (
      headSha &&
      repoPath &&
      /^[\w\-./]+\.[a-z]{1,8}(:[0-9]+(-[0-9]+)?)?$/.test(text) &&
      text.includes("/") &&
      !text.includes(" ")
    ) {
      const [filePath, lineRef] = text.split(":");
      const hash = lineRef ? `#L${lineRef}` : "";
      return (
        <a
          href={`https://github.com/${repoPath}/blob/${headSha}/${filePath}${hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline"
        >
          <code {...props}>{children}</code>
        </a>
      );
    }

    return <code {...props}>{children}</code>;
  };
}

// ── Risk flag cards ───────────────────────────────────────────────────────────

function parseRiskFlags(summary: string): string[] {
  const match = summary.match(/##\s*⚠️\s*Pre-emptive Risk Flags\s*\n([\s\S]*?)(?=\n##\s|---|\*Full scan|$)/i);
  if (!match) return [];

  return match[1]
    .split(/\n(?=-\s\*\*)/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("- **"));
}

function RiskFlagCard({
  text,
  index,
  threadId,
  initialFeedback,
  repoUrl,
  headSha,
}: {
  text: string;
  index: number;
  threadId: string;
  initialFeedback?: RiskFeedback;
  repoUrl: string;
  headSha: string | null;
}) {
  const [feedback, setFeedback] = useState<RiskFeedback | undefined>(initialFeedback);
  const [saving, setSaving] = useState(false);
  const CodeEl = makeCodeComponent(repoUrl, headSha);

  async function vote(verdict: "helpful" | "false_positive") {
    if (saving) return;
    const next: RiskFeedback = { flag_index: index, verdict };
    setFeedback(next);
    setSaving(true);
    try {
      await submitFeedback(threadId, index, verdict);
    } catch {
      setFeedback(feedback);
    } finally {
      setSaving(false);
    }
  }

  const isFalsePos = feedback?.verdict === "false_positive";
  const isHelpful = feedback?.verdict === "helpful";

  return (
    <div
      className={clsx(
        "border rounded-lg px-4 py-3 transition-all",
        isFalsePos
          ? "border-zinc-800 bg-zinc-900/30 opacity-50"
          : "border-[#3f1515]/60 bg-[rgba(229,20,20,0.04)]"
      )}
    >
      <div className={clsx("bf-markdown text-sm", isFalsePos && "line-through decoration-zinc-600")}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeEl }}>
          {text}
        </ReactMarkdown>
      </div>
      <div className="flex items-center gap-2 mt-2.5 pt-2 border-t border-zinc-800/50">
        <span className="text-[10px] text-zinc-600 mr-1">Flag #{index + 1}</span>
        <button
          onClick={() => vote("helpful")}
          disabled={saving}
          title="This flag is useful"
          className={clsx(
            "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors",
            isHelpful
              ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/50"
              : "border-zinc-800 text-zinc-600 hover:text-emerald-400 hover:border-emerald-800/50"
          )}
        >
          <ThumbsUp size={9} />
          Helpful
        </button>
        <button
          onClick={() => vote("false_positive")}
          disabled={saving}
          title="This is a false positive"
          className={clsx(
            "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors",
            isFalsePos
              ? "bg-red-950/60 text-red-400 border-red-800/50"
              : "border-zinc-800 text-zinc-600 hover:text-red-400 hover:border-red-800/50"
          )}
        >
          <ThumbsDown size={9} />
          False positive
        </button>
        {feedback && (
          <span className="ml-auto text-[10px] text-zinc-600 italic">
            {isFalsePos ? "Marked false positive" : "Marked helpful"}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function RiskDashboard({
  thread,
  cacheStatus,
  cacheMessage,
  isLoading,
  onReanalyze,
}: Props) {
  const [confirmReset, setConfirmReset] = useState(false);
  const CodeEl = makeCodeComponent(thread.repo_url, thread.last_analyzed_commit);

  const riskFlags = thread.cached_summary ? parseRiskFlags(thread.cached_summary) : [];

  // Split summary into before-risks / risks section / after-risks
  const summaryWithoutFlags = thread.cached_summary
    ? thread.cached_summary.replace(
        /##\s*⚠️\s*Pre-emptive Risk Flags[\s\S]*?(?=\n---|\*Full scan|$)/i,
        ""
      )
    : "";

  function handleReanalyzeClick() {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    setConfirmReset(false);
    onReanalyze();
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Sub-header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#27272a] flex-shrink-0 bg-[#111113]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-1.5 text-zinc-400 flex-shrink-0">
            <GitCommit size={13} className="text-[#e51414]" />
            <span className="text-xs font-semibold text-zinc-200">{thread.repo_name}</span>
          </div>
          {thread.last_analyzed_commit && (
            <span className="font-mono text-[10.5px] text-zinc-600 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded hidden sm:block">
              {thread.last_analyzed_commit.slice(0, 7)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isLoading && (
            <div className="flex items-center gap-1.5 text-[10.5px] text-zinc-500">
              <RefreshCw size={11} className="animate-spin" />
              Syncing…
            </div>
          )}
          <CacheBadge status={cacheStatus} message={cacheMessage} />
          <button
            onClick={handleReanalyzeClick}
            disabled={isLoading}
            title={confirmReset ? "Click again to confirm full re-scan" : "Re-analyze from scratch"}
            className={clsx(
              "flex items-center gap-1 text-[10.5px] px-2.5 py-1 rounded-full border transition-all",
              confirmReset
                ? "border-amber-700/60 text-amber-400 bg-amber-950/40"
                : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500",
              "disabled:opacity-30 disabled:cursor-not-allowed"
            )}
          >
            <RotateCcw size={10} />
            {confirmReset ? "Confirm?" : "Re-analyze"}
          </button>
        </div>
      </div>

      {/* ── Analysis content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && !thread.cached_summary ? (
          <LoadingSkeleton />
        ) : thread.cached_summary ? (
          <div className="p-6 max-w-4xl space-y-6">
            {/* Scan metadata bar */}
            {thread.scan_metadata && <ScanMetaPanel meta={thread.scan_metadata} />}

            {/* Main report (everything except risk flags section) */}
            <ReactMarkdown
              className="bf-markdown"
              remarkPlugins={[remarkGfm]}
              components={{ code: CodeEl }}
            >
              {summaryWithoutFlags}
            </ReactMarkdown>

            {/* Risk flags as interactive cards */}
            {riskFlags.length > 0 && (
              <div>
                <h2 className="text-base font-bold text-zinc-100 mb-3 flex items-center gap-2">
                  <span className="text-amber-400">⚠️</span> Pre-emptive Risk Flags
                  <span className="text-xs font-normal text-zinc-600 ml-1">
                    — rate flags to improve future analyses
                  </span>
                </h2>
                <div className="space-y-3">
                  {riskFlags.map((flag, i) => (
                    <RiskFlagCard
                      key={i}
                      text={flag}
                      index={i}
                      threadId={thread.thread_id}
                      repoUrl={thread.repo_url}
                      headSha={thread.last_analyzed_commit}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <AlertTriangle size={28} className="text-zinc-700" />
            <p className="text-sm text-zinc-500">No analysis available yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
