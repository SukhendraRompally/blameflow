"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { GitBranch, BarChart2, Terminal, AlertCircle, X, Loader2 } from "lucide-react";
import type { CacheStatus, ChatMessage, Thread } from "@/types";
import { listThreads, sendChat, syncThread } from "@/lib/api";
import ThreadSidebar from "@/components/ThreadSidebar";
import RiskDashboard from "@/components/RiskDashboard";
import ChatInterface from "@/components/ChatInterface";

// ── Tab type ─────────────────────────────────────────────────────────────────
type Tab = "analysis" | "debugger";

// ── Empty / splash state ─────────────────────────────────────────────────────
function EmptyState({
  onSync,
  isLoading,
}: {
  onSync: (url: string) => void;
  isLoading: boolean;
}) {
  const [url, setUrl] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (url.trim()) onSync(url.trim());
  }

  const examples = [
    "https://github.com/vercel/next.js",
    "https://github.com/fastapi/fastapi",
    "https://github.com/facebook/react",
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
      {/* Hero mark */}
      <div className="w-16 h-16 rounded-2xl bg-[rgba(229,20,20,0.1)] border border-[rgba(229,20,20,0.2)] flex items-center justify-center mb-5 shadow-[0_0_40px_rgba(229,20,20,0.08)]">
        <GitBranch size={26} className="text-[#e51414]" strokeWidth={1.5} />
      </div>

      <h1 className="text-2xl font-bold text-zinc-100 mb-2 tracking-tight">
        <span className="text-[#e51414]">Blame</span>flow
      </h1>
      <p className="text-sm text-zinc-500 mb-8 max-w-sm leading-relaxed">
        Enter a public GitHub repository URL to analyze its recent commit history,
        surface architectural risks, and debug production symptoms.
      </p>

      {/* Input */}
      <form onSubmit={handleSubmit} className="w-full max-w-md mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className={clsx(
              "flex-1 bg-[#18181b] border border-[#3f3f46] rounded-xl px-4 py-3",
              "text-sm text-zinc-200 placeholder:text-zinc-600 font-mono",
              "outline-none focus:border-[#e51414] transition-colors"
            )}
          />
          <button
            type="submit"
            disabled={isLoading || !url.trim()}
            className={clsx(
              "px-5 py-3 rounded-xl text-sm font-semibold transition-all",
              "bg-[#e51414] text-white hover:bg-[#c10d0d] active:scale-[0.98]",
              "disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
            )}
          >
            {isLoading ? (
              <><Loader2 size={14} className="animate-spin" /> Analyzing</>
            ) : (
              "Analyze →"
            )}
          </button>
        </div>
      </form>

      {/* Example repos */}
      <div className="flex flex-wrap gap-2 justify-center">
        {examples.map((ex) => (
          <button
            key={ex}
            onClick={() => onSync(ex)}
            disabled={isLoading}
            className={clsx(
              "text-[10.5px] font-mono px-3 py-1.5 rounded-full",
              "border border-[#3f3f46] text-zinc-500 hover:text-zinc-300",
              "hover:border-zinc-500 transition-colors disabled:opacity-40"
            )}
          >
            {ex.replace("https://github.com/", "")}
          </button>
        ))}
      </div>

      {/* Feature pills */}
      <div className="flex gap-4 mt-12 flex-wrap justify-center">
        {[
          { icon: "⚡", label: "Incremental caching" },
          { icon: "🔍", label: "Commit-level blame" },
          { icon: "🛡", label: "Risk pre-screening" },
        ].map(({ icon, label }) => (
          <div
            key={label}
            className="flex items-center gap-2 text-xs text-zinc-600 bg-zinc-900/50 border border-zinc-800 px-3 py-1.5 rounded-full"
          >
            <span>{icon}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus>("");
  const [cacheMessage, setCacheMessage] = useState("");
  const [tab, setTab] = useState<Tab>("analysis");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const data = await listThreads();
      setThreads(data);
    } catch {
      // Non-critical — sidebar just stays empty
    }
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  async function handleSyncRepo(url: string) {
    setIsLoading(true);
    setError(null);
    try {
      const result = await syncThread(url);
      setActiveThread(result.thread);
      setChatHistory(result.chat_history);
      setCacheStatus(result.cache_status);
      setCacheMessage(result.message);
      setTab("analysis");
      await loadThreads();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to analyze repository.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectThread(thread: Thread) {
    // Re-sync to pick up any new commits
    await handleSyncRepo(thread.repo_url);
  }

  async function handleSendMessage(message: string) {
    if (!activeThread) return;
    // Optimistic user message
    setChatHistory((prev) => [...prev, { role: "user", content: message }]);
    setIsLoading(true);
    setError(null);
    try {
      const reply = await sendChat(activeThread.thread_id, message);
      setChatHistory((prev) => [...prev, reply]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to get a response.");
      // Remove optimistic message on failure
      setChatHistory((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="h-screen flex overflow-hidden bg-[#09090b]">
      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <ThreadSidebar
        threads={threads}
        activeThreadId={activeThread?.thread_id}
        onSelectThread={handleSelectThread}
        onSyncRepo={handleSyncRepo}
        isLoading={isLoading}
      />

      {/* ── Main area ──────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-red-950/50 border-b border-red-900/60 text-sm text-red-400 flex-shrink-0">
            <AlertCircle size={13} className="flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-300 transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {activeThread ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* ── Tab bar ──────────────────────────────────────────── */}
            <div className="flex items-center gap-0 border-b border-[#27272a] flex-shrink-0 bg-[#0e0e10] px-4">
              {(
                [
                  { id: "analysis", label: "Analysis", icon: <BarChart2 size={12} /> },
                  { id: "debugger", label: "Debugger", icon: <Terminal size={12} /> },
                ] as { id: Tab; label: string; icon: React.ReactNode }[]
              ).map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={clsx(
                    "flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-all",
                    tab === id
                      ? "border-[#e51414] text-zinc-100"
                      : "border-transparent text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <span
                    className={clsx(tab === id ? "text-[#e51414]" : "text-zinc-600")}
                  >
                    {icon}
                  </span>
                  {label}
                  {id === "debugger" && chatHistory.length > 0 && (
                    <span className="ml-0.5 bg-[#e51414] text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                      {Math.ceil(chatHistory.length / 2)}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* ── Tab content ──────────────────────────────────────── */}
            <div className="flex-1 overflow-hidden">
              {tab === "analysis" ? (
                <RiskDashboard
                  thread={activeThread}
                  cacheStatus={cacheStatus}
                  cacheMessage={cacheMessage}
                  isLoading={isLoading}
                />
              ) : (
                <ChatInterface
                  chatHistory={chatHistory}
                  onSendMessage={handleSendMessage}
                  isLoading={isLoading}
                />
              )}
            </div>
          </div>
        ) : (
          <EmptyState onSync={handleSyncRepo} isLoading={isLoading} />
        )}
      </main>
    </div>
  );
}
