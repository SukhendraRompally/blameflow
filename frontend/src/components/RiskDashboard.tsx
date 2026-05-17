"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import { RefreshCw, CheckCircle2, Zap, AlertTriangle, GitCommit } from "lucide-react";
import type { CacheStatus, Thread } from "@/types";

interface Props {
  thread: Thread;
  cacheStatus: CacheStatus;
  cacheMessage: string;
  isLoading: boolean;
}

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

function SkeletonLine({ w = "100%" }: { w?: string }) {
  return (
    <div
      className="h-3 bg-zinc-800 rounded animate-pulse"
      style={{ width: w }}
    />
  );
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

export default function RiskDashboard({ thread, cacheStatus, cacheMessage, isLoading }: Props) {
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
        </div>
      </div>

      {/* ── Analysis content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && !thread.cached_summary ? (
          <LoadingSkeleton />
        ) : thread.cached_summary ? (
          <div className="p-6 max-w-4xl">
            <ReactMarkdown className="bf-markdown" remarkPlugins={[remarkGfm]}>
              {thread.cached_summary}
            </ReactMarkdown>
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
