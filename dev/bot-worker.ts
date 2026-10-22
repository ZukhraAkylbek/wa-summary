// Sends queued bot replies through local WAHA. Edge Functions cannot reach localhost.
//   npx --yes deno@2 run --allow-net --allow-env --allow-read dev/bot-worker.ts
import { createClient } from "npm:@supabase/supabase-js@2";

function envOf(name: string, fallback = ""): string {
  return (Deno.env.get(name) || fallback).trim();
}

// Load .env next to this repo when run from the project root
try {
  const text = await Deno.readTextFile(new URL("../.env", import.meta.url));
  for (const line of text.split(/\r?\n/)) {
    const raw = line.split("#")[0].trim();
    const i = raw.indexOf("=");
    if (i < 1) continue;
    const k = raw.slice(0, i).trim();
    const v = raw.slice(i + 1).trim();
    if (k && v && !Deno.env.get(k)) Deno.env.set(k, v);
  }
} catch { /* .env optional if vars are already set */ }

const supabase = createClient(
  envOf("VITE_SUPABASE_URL") || envOf("SUPABASE_URL"),
  envOf("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);
const WAHA = (envOf("WAHA_LOCAL_URL") || "http://localhost:3001").replace(/\/$/, "");
const KEY = envOf("WAHA_API_KEY");
const SESSION = envOf("WAHA_SESSION") || "default";

async function send(chatId: string, text: string): Promise<string | null> {
  const r = await fetch(`${WAHA}/api/sendText`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(KEY ? { "X-Api-Key": KEY } : {}) },
    body: JSON.stringify({ session: SESSION, chatId, text }),
  });
  if (!r.ok) throw new Error(`WAHA ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const sent = await r.json().catch(() => null) as { id?: string | { _serialized?: string } } | null;
  const id = sent?.id;
  return typeof id === "string" ? id : id?._serialized ?? null;
}

async function tick() {
  const { data, error } = await supabase
    .from("wa_bot_jobs")
    .select("id, chat_id, trigger, reply")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(5);
  if (error) throw new Error(error.message);
  for (const job of data ?? []) {
    try {
      const messageId = await send(job.chat_id, job.reply);
      await supabase.from("wa_bot_jobs").update({
        status: "sent", message_id: messageId, sent_at: new Date().toISOString(),
      }).eq("id", job.id);
      await supabase.from("wa_bot_replies").insert({
        chat_id: job.chat_id, trigger: job.trigger, message_id: messageId,
      });
      console.log("sent", job.id, job.trigger, job.chat_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from("wa_bot_jobs").update({ status: "failed", error: msg }).eq("id", job.id);
      console.error("fail", job.id, msg);
    }
  }
}

console.log("bot-worker ->", WAHA);
while (true) {
  try { await tick(); } catch (e) { console.error(e); }
  await new Promise((r) => setTimeout(r, 2000));
}
