// Service-role Supabase client shared by all Edge Functions (bypasses RLS).
import { createClient } from "npm:@supabase/supabase-js@2";
import { env } from "./env.ts";

export const supabase = createClient(
  env.required("SUPABASE_URL"),
  env.required("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

export type WaMessage = {
  id: string;
  chat_id: string;
  sender: string | null;
  body: string | null;
  ts: string;
};

export type WaChat = {
  chat_id: string;
  name: string | null;
  enabled: boolean;
  bot_enabled: boolean;
};

export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskStatus = "todo" | "in_progress" | "done";

export type WaTaskInsert = {
  summary_id?: string | null;
  chat_id: string;
  title: string;
  description?: string | null;
  assignee?: string | null;
  due?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  source: "summary" | "bot";
};
