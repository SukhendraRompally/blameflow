export interface Thread {
  thread_id: string;
  repo_url: string;
  repo_name: string;
  last_analyzed_commit: string | null;
  cached_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type CacheStatus = "hit" | "miss" | "updated" | "";

export interface SyncResponse {
  thread: Thread;
  chat_history: ChatMessage[];
  cache_status: CacheStatus;
  message: string;
}

export interface ThreadDetailResponse {
  thread: Thread;
  chat_history: ChatMessage[];
}
