"use client";

import { useState } from "react";
import clsx from "clsx";
import { GitBranch, Plus, X, Search, Clock, ChevronRight, Loader2 } from "lucide-react";
import type { Thread } from "@/types";

interface Props {
  threads: Thread[];
  activeThreadId?: string;
  onSelectThread: (thread: Thread) => void;
  onSyncRepo: (url: string) => void;
  isLoading: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 1) return "just now";
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  const diffD = diffH / 24;
  if (diffD < 7) return `${Math.floor(diffD)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ThreadSidebar({
  threads,
  activeThreadId,
  onSelectThread,
  onSyncRepo,
  isLoading,
}: Props) {
  const [inputOpen, setInputOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!trimmed.includes("github.com")) {
      setUrlError("Please enter a public GitHub URL.");
      return;
    }
    setUrlError("");
    onSyncRepo(trimmed);
    setUrl("");
    setInputOpen(false);
  }

  return (
    <aside className="w-[280px] flex-shrink-0 flex flex-col border-r border-[#27272a] bg-[#111113] overflow-hidden">
      {/* ── Logo ─────────────────────────────────────────────────────── */}
      <div className="px-5 pt-5 pb-4 border-b border-[#27272a]">
        <div className="flex items-center gap-2.5 mb-1">
          {/* Brand mark */}
          <div className="w-7 h-7 rounded-md bg-[#e51414] flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_rgba(229,20,20,0.35)]">
            <GitBranch size={14} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-[15px] font-bold tracking-tight">
            <span className="text-[#e51414]">Blame</span>
            <span className="text-zinc-100">flow</span>
          </span>
        </div>
        <p className="text-[10.5px] text-zinc-500 pl-[38px] leading-none tracking-wide">
          Trace the fault. Own the code.
        </p>
      </div>

      {/* ── Analyze new repo ─────────────────────────────────────────── */}
      <div className="px-3 pt-3">
        {inputOpen ? (
          <form onSubmit={handleSubmit} className="animate-fade-in">
            <div className="flex items-center gap-1.5 mb-1.5">
              <input
                autoFocus
                type="text"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setUrlError(""); }}
                placeholder="github.com/owner/repo"
                className={clsx(
                  "flex-1 bg-[#1a1a1e] border rounded-md px-3 py-2 text-xs text-zinc-200",
                  "placeholder:text-zinc-600 outline-none transition-colors font-mono",
                  urlError
                    ? "border-red-700 focus:border-red-500"
                    : "border-[#3f3f46] focus:border-[#e51414]"
                )}
              />
              <button
                type="button"
                onClick={() => { setInputOpen(false); setUrl(""); setUrlError(""); }}
                className="p-2 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <X size={13} />
              </button>
            </div>
            {urlError && (
              <p className="text-[10.5px] text-red-500 mb-2 px-1">{urlError}</p>
            )}
            <button
              type="submit"
              disabled={isLoading || !url.trim()}
              className={clsx(
                "w-full py-2 rounded-md text-xs font-semibold tracking-wide transition-all",
                "bg-[#e51414] text-white hover:bg-[#c10d0d] active:scale-[0.98]",
                "disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              )}
            >
              {isLoading ? (
                <><Loader2 size={12} className="animate-spin" /> Analyzing…</>
              ) : (
                "Analyze Repo →"
              )}
            </button>
          </form>
        ) : (
          <button
            onClick={() => setInputOpen(true)}
            className={clsx(
              "w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium",
              "text-zinc-400 hover:text-zinc-100 border border-dashed border-[#3f3f46]",
              "hover:border-[#e51414] hover:bg-[var(--blame-dim)] transition-all"
            )}
          >
            <Plus size={13} />
            Analyze a repository
          </button>
        )}
      </div>

      {/* ── Thread list ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto mt-3 px-3 pb-4">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <Search size={22} className="text-zinc-700" />
            <p className="text-[11px] text-zinc-600 text-center">
              No repositories analyzed yet.
              <br />Add one to get started.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-[10px] font-semibold tracking-widest text-zinc-600 uppercase px-2 mb-1">
              Threads ({threads.length})
            </p>
            {threads.map((t) => {
              const isActive = t.thread_id === activeThreadId;
              return (
                <button
                  key={t.thread_id}
                  onClick={() => onSelectThread(t)}
                  className={clsx(
                    "w-full text-left px-3 py-2.5 rounded-md transition-all group",
                    "flex items-center gap-2 relative",
                    isActive
                      ? "bg-[var(--blame-dim)] border border-[rgba(229,20,20,0.25)]"
                      : "hover:bg-zinc-800/50 border border-transparent"
                  )}
                >
                  {/* Active accent bar */}
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-[#e51414] rounded-r-full" />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={clsx(
                          "text-xs font-medium truncate",
                          isActive ? "text-zinc-100" : "text-zinc-300 group-hover:text-zinc-100"
                        )}
                      >
                        {t.repo_name}
                      </span>
                      <ChevronRight
                        size={11}
                        className={clsx(
                          "flex-shrink-0 transition-colors",
                          isActive ? "text-[#e51414]" : "text-zinc-700 group-hover:text-zinc-500"
                        )}
                      />
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Clock size={9} className="text-zinc-600 flex-shrink-0" />
                      <span className="text-[10px] text-zinc-600">
                        {formatDate(t.updated_at)}
                      </span>
                      {t.last_analyzed_commit && (
                        <>
                          <span className="text-zinc-700">·</span>
                          <span className="text-[10px] font-mono text-zinc-600">
                            {t.last_analyzed_commit.slice(0, 7)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-t border-[#27272a]">
        <p className="text-[10px] text-zinc-700 text-center">
          Powered by AI · Blameflow v1.0
        </p>
      </div>
    </aside>
  );
}
