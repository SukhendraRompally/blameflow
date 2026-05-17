import type { ChatMessage, SyncResponse, ThreadDetailResponse } from "@/types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail ?? "Request failed");
  }
  return res.json() as Promise<T>;
}

export const listThreads = () =>
  request<import("@/types").Thread[]>("/api/threads");

export const syncThread = (repo_url: string) =>
  request<SyncResponse>("/api/threads/sync", {
    method: "POST",
    body: JSON.stringify({ repo_url }),
  });

export const getThread = (thread_id: string) =>
  request<ThreadDetailResponse>(`/api/threads/${thread_id}`);

export const sendChat = (thread_id: string, message: string) =>
  request<ChatMessage>(`/api/threads/${thread_id}/chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
