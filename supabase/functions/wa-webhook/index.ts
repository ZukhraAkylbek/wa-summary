// Receives WAHA webhooks ("message.any") and stores group messages in wa_messages.
// URL: /functions/v1/wa-webhook?secret=<WEBHOOK_SECRET>   (deployed with --no-verify-jwt)
//
// Bot replies are NOT implemented yet: first we log real payloads
// (LOG_RAW_EVENTS=true -> wa_raw_events) to learn the exact field names.
import { supabase } from "../_shared/supabase.ts";
import { env } from "../_shared/env.ts";
import { log, errorMessage } from "../_shared/log.ts";
import { isGroupJid, isPrivateJid, phoneFromJid } from "../_shared/waha.ts";
import { detectTrigger, rateLimited, deliverReply, BOT_PHONE } from "../_shared/bot.ts";
import { runCommand } from "./commands.ts";
import { parseEvent, type ParsedMessage } from "./payload.ts";

const WEBHOOK_SECRET = env.get("WEBHOOK_SECRET");
const LOG_RAW_EVENTS = env.bool("LOG_RAW_EVENTS", false);

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function logRaw(event: string | undefined, payload: unknown) {
  if (!LOG_RAW_EVENTS) return;
  const { error } = await supabase.from("wa_raw_events").insert({ event, payload });
  if (error) log.warn("raw event insert failed", { error: error.message });
}

// True if this message id was produced by our own sendText (recorded in wa_bot_replies)
async function isBotReply(messageId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("wa_bot_replies").select("id").eq("message_id", messageId).limit(1);
  if (error) log.warn("wa_bot_replies lookup failed", { error: error.message });
  return Boolean(data?.length);
}

async function storeGroupMessage(m: ParsedMessage) {
  const row = {
    id: m.id, chat_id: m.chatId, sender: m.sender, sender_jid: m.senderJid, body: m.body, ts: m.ts,
  };
  const { error } = await supabase
    .from("wa_messages")
    .upsert(row, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(`wa_messages upsert: ${error.message}`);

  // Register the chat (opt-in: new chats start disabled). Existing rows only get last_seen.
  const { data: existing } = await supabase
    .from("wa_chats").select("chat_id").eq("chat_id", m.chatId).maybeSingle();
  const { error: e2 } = existing
    ? await supabase.from("wa_chats").update({ last_seen: m.ts }).eq("chat_id", m.chatId)
    : await supabase.from("wa_chats").insert({
      chat_id: m.chatId, last_seen: m.ts, enabled: false, bot_enabled: false,
    });
  if (e2) log.warn("wa_chats upsert failed", { chat_id: m.chatId, error: e2.message });
}

async function chatFlags(chatId: string) {
  const { data } = await supabase
    .from("wa_chats")
    .select("name, bot_enabled")
    .eq("chat_id", chatId)
    .maybeSingle();
  return { name: (data?.name as string | null) ?? null, botEnabled: data?.bot_enabled !== false };
}

async function isAllowedPrivate(senderJid: string | null): Promise<boolean> {
  const phone = phoneFromJid(senderJid);
  if (!phone) return false;
  const { data } = await supabase
    .from("wa_allowed_users")
    .select("phone")
    .eq("phone", phone)
    .maybeSingle();
  return Boolean(data);
}

async function maybeReply(m: ParsedMessage) {
  if (!m.body) return { skipped: "empty" };
  const trigger = detectTrigger(m.body, m.mentionedJids);
  if (!trigger) return { skipped: "no-trigger" };

  const flags = m.isGroup ? await chatFlags(m.chatId) : { name: null, botEnabled: true };
  if (m.isGroup && !flags.botEnabled) return { skipped: "bot-disabled" };
  if (!m.isGroup && !(await isAllowedPrivate(m.senderJid))) return { skipped: "not-allowed" };

  const limited = await rateLimited(m.chatId);
  if (limited === "cooldown") return { skipped: "cooldown" };
  if (limited) {
    await deliverReply(m.chatId, limited, trigger.via);
    return { replied: "rate-limit" };
  }

  const text = await runCommand(m.chatId, flags.name, trigger);
  const out = await deliverReply(m.chatId, text, trigger.via);
  log.info("bot reply", { chat_id: m.chatId, via: trigger.via, kind: trigger.kind, ...out });
  return { replied: trigger.kind, via: trigger.via, ...out };
}

Deno.serve(async (req) => {
  if (req.method === "GET") return new Response("ok");
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const url = new URL(req.url);
  if (!WEBHOOK_SECRET || url.searchParams.get("secret") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const ev = raw as { event?: string; payload?: unknown };
  await logRaw(ev.event, raw);

  if (!ev.event?.startsWith("message") || !ev.payload) {
    return json({ skipped: ev.event ?? "no-event" });
  }

  let m: ParsedMessage;
  try {
    m = parseEvent(ev.payload);
  } catch (e) {
    log.warn("unparseable message payload", { error: errorMessage(e) });
    return json({ skipped: "unparseable" }, 200);
  }

  const ctx = { chat_id: m.chatId, message_id: m.id };

  // WhatsApp status updates arrive as messages from "status@broadcast"
  if (m.isStatus) return json({ skipped: "status", ...ctx });

  // Personal account: store fromMe messages. Only WAHA sendText echoes are dropped.
  // Commands typed from this phone (/summary, code word) still trigger the bot.
  const isOwn = m.fromMe || (BOT_PHONE && phoneFromJid(m.senderJid) === BOT_PHONE);
  if (isOwn && await isBotReply(m.id)) {
    return json({ skipped: "bot-reply", ...ctx });
  }

  if (isGroupJid(m.chatId)) {
    if (!m.body) return json({ skipped: "empty-body", ...ctx });
    try {
      await storeGroupMessage(m);
    } catch (e) {
      log.error("store failed", { ...ctx, error: errorMessage(e) });
      return new Response("db error", { status: 500 });
    }
    log.info("stored", { ...ctx, sender: m.sender, own: isOwn, mentions: m.mentionedJids.length });
    try {
      const bot = await maybeReply(m);
      return json({ ok: true, own: isOwn, ...ctx, bot });
    } catch (e) {
      log.error("bot failed", { ...ctx, error: errorMessage(e) });
      return json({ ok: true, own: isOwn, ...ctx, bot: { error: errorMessage(e) } });
    }
  }

  if (isPrivateJid(m.chatId)) {
    try {
      const bot = await maybeReply(m);
      return json({ ...ctx, bot });
    } catch (e) {
      log.error("bot failed", { ...ctx, error: errorMessage(e) });
      return json({ ...ctx, bot: { error: errorMessage(e) } });
    }
  }

  return json({ skipped: "unknown-chat-type", ...ctx });
});
