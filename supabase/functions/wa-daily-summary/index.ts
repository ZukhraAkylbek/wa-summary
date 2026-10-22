// Daily job (pg_cron, 12:00 UTC) and manual trigger (?hours=N).
// For each enabled chat with enough messages in the window: ask Claude for a
// summary + tasks, upsert wa_summaries, replace that summary's tasks (idempotent),
// optionally post the result back to the group.
import { supabase, type WaMessage, type WaTaskInsert } from "../_shared/supabase.ts";
import { env, TZ } from "../_shared/env.ts";
import { askClaudeJson } from "../_shared/claude.ts";
import { sendText } from "../_shared/waha.ts";
import { log, errorMessage } from "../_shared/log.ts";
import { SUMMARY_SYSTEM, type SummaryOutput, normalizeTask } from "./prompt.ts";

const MIN_MESSAGES = env.int("MIN_MESSAGES", 2);
const POST_TO_GROUP = env.bool("POST_TO_GROUP", false);
const MAX_TRANSCRIPT = 60_000;

function buildTranscript(list: WaMessage[]): string {
  const text = list.map((m) => {
    const t = new Date(m.ts).toLocaleTimeString("ru-RU", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit",
    });
    return `[${t}] ${m.sender ?? "?"}: ${m.body ?? ""}`;
  }).join("\n");
  return text.length > MAX_TRANSCRIPT ? text.slice(-MAX_TRANSCRIPT) : text;
}

function formatGroupPost(day: string, out: SummaryOutput, tasks: WaTaskInsert[]): string {
  const taskLines = tasks
    .map((t) => `• ${t.title}${t.assignee ? ` (${t.assignee})` : ""}${t.due ? ` — до ${t.due}` : ""}`)
    .join("\n");
  return `Итоги дня (${day}):\n${out.summary}` + (taskLines ? `\n\nЗадачи:\n${taskLines}` : "");
}

async function processChat(chatId: string, list: WaMessage[], day: string) {
  const out = await askClaudeJson<SummaryOutput>({
    system: SUMMARY_SYSTEM,
    user: buildTranscript(list),
    maxTokens: 2000,
  });
  if (typeof out?.summary !== "string") throw new Error("summary missing in Claude output");

  const { data: s, error: e1 } = await supabase
    .from("wa_summaries")
    .upsert(
      { chat_id: chatId, day, summary: out.summary, messages_count: list.length },
      { onConflict: "chat_id,day" },
    )
    .select("id")
    .single();
  if (e1) throw new Error(`wa_summaries upsert: ${e1.message}`);

  // Re-running for the same day must not duplicate tasks
  const { error: eDel } = await supabase.from("wa_tasks").delete().eq("summary_id", s.id);
  if (eDel) throw new Error(`wa_tasks delete: ${eDel.message}`);

  const tasks: WaTaskInsert[] = (Array.isArray(out.tasks) ? out.tasks : [])
    .map((t) => normalizeTask(t, chatId, s.id))
    .filter((t): t is WaTaskInsert => t !== null);

  if (tasks.length) {
    const { error: eIns } = await supabase.from("wa_tasks").insert(tasks);
    if (eIns) throw new Error(`wa_tasks insert: ${eIns.message}`);
  }

  if (POST_TO_GROUP) {
    await sendText(chatId, formatGroupPost(day, out, tasks));
  }

  return { messages: list.length, tasks: tasks.length };
}

Deno.serve(async (req) => {
  const hours = env.int("DEFAULT_WINDOW_HOURS", 24);
  const param = Number(new URL(req.url).searchParams.get("hours"));
  const window = Number.isFinite(param) && param > 0 && param <= 24 * 14 ? param : hours;
  const since = new Date(Date.now() - window * 3600 * 1000).toISOString();
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date());

  const [{ data: msgs, error }, { data: chats, error: eChats }] = await Promise.all([
    supabase.from("wa_messages").select("id, chat_id, sender, body, ts")
      .gte("ts", since).order("ts", { ascending: true }),
    supabase.from("wa_chats").select("chat_id, name, enabled"),
  ]);
  if (error) return new Response(error.message, { status: 500 });
  if (eChats) return new Response(eChats.message, { status: 500 });

  const disabled = new Set((chats ?? []).filter((c) => !c.enabled).map((c) => c.chat_id));
  const names = new Map((chats ?? []).map((c) => [c.chat_id, c.name as string | null]));

  const byChat = new Map<string, WaMessage[]>();
  for (const m of (msgs ?? []) as WaMessage[]) {
    if (disabled.has(m.chat_id)) continue;
    byChat.set(m.chat_id, [...(byChat.get(m.chat_id) ?? []), m]);
  }

  const results: unknown[] = [];
  for (const [chatId, list] of byChat) {
    const base = { chat_id: chatId, name: names.get(chatId) ?? null };
    if (list.length < MIN_MESSAGES) {
      results.push({ ...base, skipped: `only ${list.length} messages` });
      continue;
    }
    try {
      const r = await processChat(chatId, list, day);
      log.info("summarized", { ...base, ...r, day });
      results.push({ ...base, ...r });
    } catch (e) {
      // One failing chat must not abort the others
      log.error("summary failed", { ...base, day, error: errorMessage(e) });
      results.push({ ...base, error: errorMessage(e) });
    }
  }

  return Response.json({ day, window_hours: window, results });
});
