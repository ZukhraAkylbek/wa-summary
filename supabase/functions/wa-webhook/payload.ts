// Normalizes a WAHA "message.*" payload into ParsedMessage.
//
// Field names CONFIRMED against real payloads (WAHA 2026.9.2, WEBJS engine, 2026-10-14):
//   id            string, "<fromMe>_<chatJid>_<hash>[_<participantJid>]"
//   from          incoming: chat jid (group "@g.us" / private "@lid"); outgoing: OUR OWN lid
//   to            outgoing: chat jid; incoming private: our "@c.us"
//   participant   group sender, almost always "<n>@lid" (LID addressing), not a phone
//   fromMe        boolean
//   body          text or caption; empty for media without caption
//   hasMedia      boolean; _data.type = chat | image | video | sticker | ptt | document | ...
//   timestamp     unix seconds
//   mentionedIds  array of jids (may be empty even when mentions exist -> also check _data.mentionedJidList)
//   _data.notifyName  often EMPTY -> display names must come from the contacts API / cache
//   from = "status@broadcast"  -> WhatsApp status updates, must be ignored
// LIDs resolve to phones via WAHA: GET /api/{session}/lids/{lid} -> {lid, pn}

export type ParsedMessage = {
  id: string;
  chatId: string;           // "<group>@g.us" | "<n>@lid" | "<phone>@c.us"
  senderJid: string | null; // participant in groups, chat jid in private; may be "@lid"
  sender: string;           // display fallback: "Name (+996...)" | "+996..." | "lid:<n>"
  body: string | null;
  ts: string;               // ISO
  fromMe: boolean;
  mentionedJids: string[];
  isGroup: boolean;
  isStatus: boolean;        // status@broadcast
  mediaType: string | null; // _data.type when not "chat"
};

type Raw = {
  id?: string | { _serialized?: string; id?: string };
  timestamp?: number;
  from?: string;
  to?: string;
  fromMe?: boolean;
  participant?: string;
  author?: string;
  body?: string;
  caption?: string;
  hasMedia?: boolean;
  type?: string;
  mentionedIds?: string[];
  _data?: {
    notifyName?: string;
    pushName?: string;
    type?: string;
    caption?: string;
    mentionedJidList?: string[];
  };
};

function messageId(p: Raw): string | null {
  if (typeof p.id === "string") return p.id;
  return p.id?._serialized ?? p.id?.id ?? null;
}

// "false_120363409049160418@g.us_3EB0..._166@lid" -> "120363409049160418@g.us"
function chatIdFromMessageId(id: string): string | null {
  const parts = id.split("_");
  return parts.length >= 2 && parts[1].includes("@") ? parts[1] : null;
}

function phone(jid?: string | null): string | null {
  if (!jid) return null;
  if (!jid.endsWith("@c.us") && !jid.endsWith("@s.whatsapp.net")) return null;
  return jid.replace(/@.*$/, "").replace(/:\d+$/, "") || null;
}

function displaySender(name: string | null, jid: string | null): string {
  const num = phone(jid);
  if (name && num) return `${name} (+${num})`;
  if (name) return name;
  if (num) return `+${num}`;
  if (jid?.endsWith("@lid")) return `lid:${jid.replace(/@.*$/, "")}`;
  return "unknown";
}

function bodyOf(p: Raw, mediaType: string | null): string | null {
  const text = (p.body ?? p.caption ?? p._data?.caption ?? "").trim();
  if (text) return text;
  // Media without caption: keep a marker so the day transcript shows activity
  if (p.hasMedia || mediaType) return `[${mediaType ?? "media"}]`;
  return null;
}

function mentions(p: Raw): string[] {
  const a = p.mentionedIds ?? [];
  const b = p._data?.mentionedJidList ?? [];
  return [...new Set([...a, ...b])];
}

export function parseEvent(payload: unknown): ParsedMessage {
  const p = payload as Raw;
  const id = messageId(p);
  if (!id) throw new Error("payload.id missing");

  const fromMe = Boolean(p.fromMe);
  const isStatus = p.from === "status@broadcast" || p.to === "status@broadcast";

  // Outgoing: "from" is our own lid, the chat is in "to". Fall back to the id encoding.
  const chatId = (fromMe ? p.to : p.from) ?? chatIdFromMessageId(id);
  if (!chatId) throw new Error("payload.from/to missing");

  const isGroup = chatId.endsWith("@g.us");
  const senderJid = fromMe
    ? (p.from ?? null)
    : isGroup ? (p.participant ?? p.author ?? null) : chatId;

  const name = p._data?.notifyName?.trim() || p._data?.pushName?.trim() || null;
  const rawType = p._data?.type ?? p.type ?? null;
  const mediaType = rawType && rawType !== "chat" ? rawType : null;
  const tsSec = typeof p.timestamp === "number" ? p.timestamp : Date.now() / 1000;

  return {
    id,
    chatId,
    senderJid,
    sender: displaySender(name, senderJid),
    body: bodyOf(p, mediaType),
    ts: new Date(tsSec * 1000).toISOString(),
    fromMe,
    mentionedJids: mentions(p),
    isGroup,
    isStatus,
    mediaType,
  };
}
