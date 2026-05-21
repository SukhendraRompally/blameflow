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

export async function streamChat(
  thread_id: string,
  message: string,
  onToken: (token: string) => void,
  onDone: () => void,
): Promise<void> {
  const res = await fetch(`${BASE}/api/threads/${thread_id}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail ?? "Request failed");
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") {
        onDone();
        return;
      }
      try {
        onToken(JSON.parse(data));
      } catch {
        // ignore malformed chunks
      }
    }
  }

  onDone();
}

export const submitFeedback = (
  thread_id: string,
  flag_index: number,
  verdict: "helpful" | "false_positive",
  note = "",
) =>
  request<{ status: string }>(`/api/threads/${thread_id}/feedback`, {
    method: "POST",
    body: JSON.stringify({ flag_index, verdict, note }),
  });

export const resetThread = (thread_id: string) =>
  request<{ status: string; thread_id: string }>(`/api/threads/${thread_id}/reset`, {
    method: "POST",
  });
