"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import { Send, Bot, User, Loader2, Terminal } from "lucide-react";
import type { ChatMessage } from "@/types";

interface Props {
  chatHistory: ChatMessage[];
  onSendMessage: (msg: string) => void;
  isLoading: boolean;
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end gap-2.5 animate-fade-in">
      <div className="max-w-[75%]">
        <div className="bg-zinc-800 border border-zinc-700/60 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-zinc-200 leading-relaxed">
          {content}
        </div>
      </div>
      <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
        <User size={13} className="text-zinc-300" />
      </div>
    </div>
  );
}

function AssistantBubble({ content }: { content: string }) {
  return (
    <div className="flex gap-2.5 animate-fade-in">
      <div className="w-7 h-7 rounded-full bg-[rgba(229,20,20,0.15)] border border-[rgba(229,20,20,0.25)] flex items-center justify-center flex-shrink-0 mt-0.5">
        <Bot size={13} className="text-[#e51414]" />
      </div>
      <div className="flex-1 min-w-0">
        {/* Header chip */}
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[10px] font-semibold text-[#e51414] tracking-widest uppercase">
            Blameflow
          </span>
          <div className="h-px flex-1 bg-[#27272a]" />
        </div>
        <div className="bg-[#18181b] border border-[#27272a] rounded-xl rounded-tl-sm p-4">
          <ReactMarkdown className="bf-chat-markdown" remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5">
      <div className="w-7 h-7 rounded-full bg-[rgba(229,20,20,0.15)] border border-[rgba(229,20,20,0.25)] flex items-center justify-center flex-shrink-0">
        <Bot size={13} className="text-[#e51414]" />
      </div>
      <div className="bg-[#18181b] border border-[#27272a] rounded-xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
        {[0, 0.2, 0.4].map((delay, i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyChat() {
  const hints = [
    "Users are getting 401 errors after logging in on mobile",
    "The checkout button stopped working after the last deploy",
    "Profile updates are not persisting after clicking save",
    "Search returns stale results since yesterday's push",
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-6">
      <div className="text-center">
        <div className="w-12 h-12 rounded-xl bg-[rgba(229,20,20,0.1)] border border-[rgba(229,20,20,0.2)] flex items-center justify-center mx-auto mb-3">
          <Terminal size={20} className="text-[#e51414]" />
        </div>
        <h3 className="text-sm font-semibold text-zinc-200 mb-1">Blameflow Debugger</h3>
        <p className="text-xs text-zinc-500 max-w-[280px] leading-relaxed">
          Describe a production symptom in plain English. Blameflow will trace it to the exact commit and lines responsible.
        </p>
      </div>
      <div className="w-full max-w-sm space-y-2">
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest text-center mb-3">
          Example symptoms
        </p>
        {hints.map((h) => (
          <div
            key={h}
            className="px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-500 leading-relaxed"
          >
            "{h}"
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChatInterface({ chatHistory, onSendMessage, isLoading }: Props) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, isLoading]);

  // Auto-grow textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || isLoading) return;
    setInput("");
    onSendMessage(msg);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden border-t border-[#27272a]">
      {/* ── Chat header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-b border-[#27272a] flex-shrink-0 bg-[#111113]">
        <Terminal size={12} className="text-[#e51414]" />
        <span className="text-[11px] font-semibold text-zinc-400 tracking-widest uppercase">
          Debugger
        </span>
        {chatHistory.length > 0 && (
          <span className="text-[10px] text-zinc-700 ml-auto">
            {Math.ceil(chatHistory.length / 2)} session{chatHistory.length > 2 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ── Messages ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {chatHistory.length === 0 && !isLoading ? (
          <EmptyChat />
        ) : (
          <div className="space-y-5 max-w-3xl">
            {chatHistory.map((msg, i) =>
              msg.role === "user" ? (
                <UserBubble key={i} content={msg.content} />
              ) : (
                <AssistantBubble key={i} content={msg.content} />
              )
            )}
            {isLoading && <TypingIndicator />}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* ── Input bar ───────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-[#27272a] bg-[#111113]">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="flex-1 bg-[#1a1a1e] border border-[#3f3f46] rounded-xl overflow-hidden focus-within:border-[#e51414] transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe a production symptom… (⏎ to send, ⇧⏎ for newline)"
              rows={1}
              className={clsx(
                "w-full bg-transparent px-4 py-3 text-sm text-zinc-200",
                "placeholder:text-zinc-600 outline-none resize-none leading-relaxed",
                "font-sans"
              )}
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className={clsx(
              "flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center",
              "bg-[#e51414] text-white transition-all",
              "hover:bg-[#c10d0d] active:scale-95",
              "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[#e51414]"
            )}
          >
            {isLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
          </button>
        </form>
        <p className="text-[10px] text-zinc-700 mt-1.5 px-1">
          Analysis is limited to the diff context of the selected thread.
        </p>
      </div>
    </div>
  );
}
