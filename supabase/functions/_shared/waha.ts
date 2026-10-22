// WAHA HTTP API client (send only). WAHA_URL must be reachable from Supabase.
import { env } from "./env.ts";
import { log } from "./log.ts";

const WAHA_URL = env.get("WAHA_URL")?.replace(/\/$/, "");
const WAHA_API_KEY = env.get("WAHA_API_KEY");
const WAHA_SESSION = env.get("WAHA_SESSION") ?? "default";

export const wahaConfigured = Boolean(WAHA_URL);

// WhatsApp caps a single message at ~65k chars; keep ours readable.
const MAX_TEXT = 4000;

// Returns the WhatsApp message id of the sent message (null if WAHA is not configured
// or the engine did not report one). Callers record it in wa_bot_replies.
export async function sendText(chatId: string, text: string): Promise<string | null> {
  if (!WAHA_URL) {
    log.warn("WAHA_URL not set, skipping sendText", { chat_id: chatId });
    return null;
  }
  const body = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - 1) + "…" : text;
  const r = await fetch(`${WAHA_URL}/api/sendText`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(WAHA_API_KEY ? { "X-Api-Key": WAHA_API_KEY } : {}),
    },
    body: JSON.stringify({ session: WAHA_SESSION, chatId, text: body }),
  });
  if (!r.ok) {
    throw new Error(`WAHA sendText ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  // WEBJS returns the sent message object; id may be a string or {_serialized}
  const sent = await r.json().catch(() => null) as
    | { id?: string | { _serialized?: string } }
    | null;
  const id = sent?.id;
  return typeof id === "string" ? id : id?._serialized ?? null;
}

// "996555123456@c.us" -> "996555123456"; also strips device suffix ":12"
export function phoneFromJid(jid: string | undefined | null): string | null {
  if (!jid) return null;
  return jid.replace(/@.*$/, "").replace(/:\d+$/, "") || null;
}

export const isGroupJid = (jid?: string | null) => Boolean(jid?.endsWith("@g.us"));
export const isPrivateJid = (jid?: string | null) =>
  Boolean(jid && (jid.endsWith("@c.us") || jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid")));

export type GroupMember = { name: string; phone: string | null; admin: boolean };

export async function getGroupMembers(chatId: string): Promise<GroupMember[]> {
  if (!WAHA_URL) return [];
  const r = await fetch(
    `${WAHA_URL}/api/${WAHA_SESSION}/groups/${encodeURIComponent(chatId)}`,
    { headers: { ...(WAHA_API_KEY ? { "X-Api-Key": WAHA_API_KEY } : {}) } },
  );
  if (!r.ok) return [];
  const g = await r.json() as {
    groupMetadata?: {
      participants?: { id?: { user?: string; _serialized?: string }; isAdmin?: boolean }[];
    };
    participants?: { id?: string; name?: string; isAdmin?: boolean }[];
  };
  const raw = g.groupMetadata?.participants ?? [];
  return raw.map((p) => {
    const jid = p.id?._serialized ?? "";
    const phone = phoneFromJid(jid.endsWith("@c.us") ? jid : `${p.id?.user ?? ""}@c.us`);
    return { name: p.id?.user ?? phone ?? jid, phone, admin: Boolean(p.isAdmin) };
  });
}
