import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required");
}

export const supabase = createClient(url, key);

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export type Task = {
  id: string;
  summary_id: string | null;
  chat_id: string;
  title: string;
  description: string | null;
  assignee: string | null;
  due: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  source: string;
  created_at: string;
};

export type Chat = {
  chat_id: string;
  name: string | null;
  enabled: boolean;
  bot_enabled: boolean;
  last_seen: string | null;
};

export type Summary = {
  id: string;
  chat_id: string;
  day: string;
  summary: string;
  messages_count: number | null;
  created_at: string;
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "К выполнению",
  in_progress: "В работе",
  done: "Готово",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "низкий",
  normal: "обычный",
  high: "высокий",
  urgent: "срочно",
};
