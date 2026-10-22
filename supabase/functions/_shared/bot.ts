// Trigger detection, rate limits, and outbound reply queue.
import { supabase } from "./supabase.ts";
import { env } from "./env.ts";
import { log } from "./log.ts";
import { sendText, wahaConfigured, phoneFromJid } from "./waha.ts";

export const BOT_PHONE = env.get("BOT_PHONE")?.replace(/\D/g, "") ?? "";
export const BOT_LID = (env.get("BOT_LID") ?? "").toLowerCase();
export const BOT_CODE_WORD = (env.get("BOT_CODE_WORD") ?? "сводка").trim();
const MENTION_NAMES = (env.get("BOT_MENTION_NAMES") ?? "Zuhra")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const PER_CHAT_MS = env.int("BOT_CHAT_COOLDOWN_MS", 10_000);
const PER_HOUR = env.int("BOT_REPLIES_PER_HOUR", 30);

export type TriggerKind = "summary" | "tasks" | "ask" | "task";
export type Trigger = { kind: TriggerKind; arg: string; hours: number; via: string };

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isBotMentioned(mentionedJids: string[], body: string): boolean {
  const ids = mentionedJids.map((j) => j.toLowerCase());
  if (BOT_LID && ids.some((j) => j === BOT_LID || j.startsWith(BOT_LID.replace(/@.*$/, "")))) {
    return true;
  }
  if (BOT_PHONE && ids.some((j) => phoneFromJid(j) === BOT_PHONE)) return true;
  const lower = body.toLowerCase();
  if (BOT_PHONE && lower.includes(`@${BOT_PHONE}`)) return true;
  return MENTION_NAMES.some((n) =>
    lower.includes(`@${n}`) || new RegExp(`@${escapeRe(n)}\\b`, "i").test(body)
  );
}

export function detectTrigger(body: string, mentionedJids: string[]): Trigger | null {
  const text = body.trim();
  if (!text) return null;

  const cmd = text.match(/^\/(summary|саммари|сводка|tasks|задачи|ask|task)\s*([\s\S]*)?$/i);
  if (cmd) {
    const raw = cmd[1].toLowerCase();
    const arg = (cmd[2] ?? "").trim();
    const kind: TriggerKind =
      raw === "tasks" || raw === "задачи" ? "tasks" :
      raw === "ask" ? "ask" :
      raw === "task" ? "task" : "summary";
    const hours = kind === "summary" ? (Number(arg) || 24) : 24;
    return { kind, arg: kind === "summary" ? "" : arg, hours, via: `/${raw}` };
  }

  if (BOT_CODE_WORD) {
    const re = new RegExp(`(?:^|[\\s.,!?])${escapeRe(BOT_CODE_WORD)}(?:$|[\\s.,!?])`, "i");
    if (re.test(text)) {
      const rest = text.replace(re, " ").trim();
      const hours = Number(rest) || 24;
      return { kind: "summary", arg: rest && !Number(rest) ? rest : "", hours, via: "code-word" };
    }
  }

  if (isBotMentioned(mentionedJids, text)) {
    const stripped = text
      .replace(new RegExp(`@(${MENTION_NAMES.map(escapeRe).join("|")}|${BOT_PHONE})\\b`, "gi"), "")
      .trim();
    if (stripped.startsWith("/")) return detectTrigger(stripped, []);
    if (stripped) return { kind: "ask", arg: stripped, hours: 24, via: "mention" };
    return { kind: "summary", arg: "", hours: 24, via: "mention" };
  }

  return null;
}

export async function rateLimited(chatId: string): Promise<string | null> {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { data: recent, error } = await supabase
    .from("wa_bot_replies")
    .select("chat_id, sent_at")
    .gte("sent_at", hourAgo);
  if (error) {
    log.warn("rate-limit lookup failed", { error: error.message });
    return null;
  }
  const rows = recent ?? [];
  if (rows.length >= PER_HOUR) return "Слишком много ответов за час, подожди немного.";
  const last = rows
    .filter((r) => r.chat_id === chatId)
    .map((r) => new Date(r.sent_at as string).getTime())
    .sort((a, b) => b - a)[0];
  if (last && Date.now() - last < PER_CHAT_MS) return "cooldown";
  return null;
}

export async function deliverReply(
  chatId: string,
  text: string,
  trigger: string,
): Promise<{ queued: boolean; sent: boolean; messageId: string | null }> {
  const { data: job, error } = await supabase
    .from("wa_bot_jobs")
    .insert({ chat_id: chatId, trigger, reply: text, status: "pending" })
    .select("id")
    .single();
  if (error) log.warn("bot job insert failed", { error: error.message, chat_id: chatId });

  if (!wahaConfigured) {
    return { queued: true, sent: false, messageId: null };
  }
  try {
    const messageId = await sendText(chatId, text);
    await recordReply(chatId, trigger, messageId);
    if (job?.id) {
      await supabase.from("wa_bot_jobs").update({
        status: "sent", message_id: messageId, sent_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
    return { queued: false, sent: true, messageId };
  } catch (e) {
    log.error("sendText failed, job stays pending", { chat_id: chatId, error: String(e) });
    return { queued: true, sent: false, messageId: null };
  }
}

export async function recordReply(
  chatId: string,
  trigger: string,
  messageId: string | null,
) {
  const { error } = await supabase.from("wa_bot_replies").insert({
    chat_id: chatId,
    trigger,
    message_id: messageId,
  });
  if (error) log.warn("wa_bot_replies insert failed", { error: error.message });
}
